import AcademicEvent from '#models/academic_event'
import GradeImport, { type GradeImportMapping } from '#models/grade_import'
import GradeImportRow from '#models/grade_import_row'
import type User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import { conflict, fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AuditLogService from '#services/audit_log_service'
import { parseIsoDateTime } from '#services/date_time_service'
import GradeService, { formatScore, isGradable, maxScoreOf } from '#services/grade_service'
import GradeImportTransformer, {
  type GradeImportPermissions,
} from '#transformers/grade_import_transformer'
import { applyGradeImportValidator, createGradeImportValidator } from '#validators/grades'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

const EVENT_NOT_FOUND = 'Evento não encontrado.'
const IMPORT_NOT_FOUND = 'Importação não encontrada.'
const ROLE_FORBIDDEN = 'Seu perfil não importa notas.'
const OFFER_FORBIDDEN =
  'Só a docente da disciplina e a administração importam as notas desta avaliação.'
const NOT_GRADABLE = 'Só prova e trabalho de turma recebem nota.'
const CLASS_ARCHIVED =
  'Esta turma está arquivada e fica somente leitura. Restaure a turma para mudar as notas.'

type Response = HttpContext['response']

/** Plural simples para as mensagens ("1 nota importada", "20 notas importadas"). */
function grades(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Importação de notas em quatro passos: o front lê o arquivo e manda só as linhas (rascunho
 * com a prévia), a docente confere e aplica, e pode desfazer depois. O arquivo nunca é
 * guardado. Importar não é publicar: as notas ficam ocultas até a docente publicar.
 */
export default class GradeImportsController {
  /**
   * POST /grade-imports: casa cada linha com um aluno da turma (e-mail da conta ou matrícula
   * gravada pela administração), classifica e grava o rascunho. Devolve os totais e as linhas.
   */
  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }

    const payload = await request.validateUsing(createGradeImportValidator)

    const event = await AcademicEvent.find(payload.academicEventId)
    const access = await this.eventAccess(user, event)
    if (access !== 'ok') {
      return this.denyEvent(response, access)
    }
    const target = event!
    if (!isGradable(target)) {
      return conflict(response, 'NOT_GRADABLE', NOT_GRADABLE)
    }
    if (await this.isArchived(target)) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    let fileModifiedAt = null
    if (payload.fileModifiedAt) {
      fileModifiedAt = parseIsoDateTime(payload.fileModifiedAt)
      if (!fileModifiedAt) {
        return fieldError(
          response,
          'fileModifiedAt',
          'Data do arquivo em formato inválido. Use o formato ISO, como 2026-11-04T10:30:00Z.',
          'date'
        )
      }
    }

    // O valor máximo da avaliação: o `points` do evento. Vazio, a importação pede e grava.
    const currentMax = maxScoreOf(target)
    const askedPoints = payload.points ?? null
    if (currentMax === null && askedPoints === null) {
      return fieldError(
        response,
        'points',
        'Informe quanto vale a avaliação (por exemplo, 10) para conferir as notas.',
        'required'
      )
    }
    if (
      currentMax !== null &&
      askedPoints !== null &&
      Math.round(askedPoints * 100) !== currentMax
    ) {
      return fieldError(
        response,
        'points',
        `Esta avaliação já vale ${formatScore(currentMax)}. Para mudar o valor, edite o evento.`,
        'points'
      )
    }
    const maxScore = currentMax ?? Math.round(askedPoints! * 100)

    const mapping: GradeImportMapping = {
      identifierType: payload.mapping.identifierType,
      identifierColumn: payload.mapping.identifierColumn,
      scoreColumn: payload.mapping.scoreColumn,
      nameColumn: payload.mapping.nameColumn ?? null,
    }

    const created = await db.transaction(async (trx) => {
      if (currentMax === null) {
        target.useTransaction(trx)
        target.points = maxScore / 100
        await target.save()
      }
      const { rows, counts } = await GradeService.classify({
        event: target,
        maxScore,
        mapping,
        rows: payload.rows,
        fileModifiedAt,
        trx,
      })
      const gradeImport = await GradeImport.create(
        {
          academicEventId: target.id,
          createdById: user.id,
          source: payload.source,
          fileName: payload.fileName,
          checksum: payload.checksum,
          mapping: JSON.stringify(mapping),
          fileModifiedAt,
          status: 'draft',
          ...counts,
        },
        { client: trx }
      )
      if (rows.length) {
        await GradeImportRow.createMany(
          rows.map((row) => ({ ...row, gradeImportId: gradeImport.id })),
          { client: trx }
        )
      }
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'grade_import.create',
          entity: 'grade_import',
          entityId: gradeImport.id,
          meta: {
            academicEventId: target.id,
            source: payload.source,
            rows: rows.length,
            ...counts,
            ...(currentMax === null ? { pointsSet: maxScore / 100 } : {}),
          },
        },
        trx
      )
      return gradeImport
    })

    response.status(201)
    return serialize(await this.detail(user, created))
  }

  /** GET /grade-imports?eventId=: as importações do evento, das mais novas para as antigas. */
  async index({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }

    const rawEventId = request.input('eventId')
    if (rawEventId === undefined || rawEventId === null || rawEventId === '') {
      return fieldError(response, 'eventId', 'Escolha a avaliação.', 'required')
    }
    const event = await AcademicEvent.find(routeId(rawEventId))
    const access = await this.eventAccess(user, event)
    if (access !== 'ok') {
      return this.denyEvent(response, access)
    }

    const imports = await GradeImport.query()
      .where('academicEventId', event!.id)
      .preload('createdBy')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
    const items = []
    for (const item of imports) {
      items.push(
        new GradeImportTransformer(item, await this.permissionsFor(user, item, event!)).toObject()
      )
    }
    return { data: items }
  }

  /** GET /grade-imports/:id: o resumo e, no rascunho, as linhas da prévia. */
  async show({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }
    const found = await this.findVisible(user, params.id)
    if (!found) {
      return notFound(response, IMPORT_NOT_FOUND)
    }
    return serialize(await this.detail(user, found.gradeImport))
  }

  /**
   * POST /grade-imports/:id/apply: grava as notas do rascunho em transação, com o histórico em
   * grade_changes. Só quem criou (com a oferta em vigor) e a administração.
   */
  async apply({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }
    const found = await this.findVisible(user, params.id)
    if (!found) {
      return notFound(response, IMPORT_NOT_FOUND)
    }
    const { gradeImport, event } = found
    if (!(await this.canApply(user, gradeImport, event))) {
      return forbidden(response, 'Só quem importou e a administração aplicam esta importação.')
    }
    if (gradeImport.status !== 'draft') {
      return conflict(
        response,
        'NOT_DRAFT',
        gradeImport.status === 'applied'
          ? 'Esta importação já foi aplicada.'
          : 'Esta importação foi descartada ou desfeita. Importe o arquivo de novo.'
      )
    }
    if (!isGradable(event)) {
      return conflict(response, 'NOT_GRADABLE', NOT_GRADABLE)
    }
    if (await this.isArchived(event)) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const payload = await request.validateUsing(applyGradeImportValidator)
    const keepAgendaWhenNewer = payload.keepAgendaWhenNewer ?? true

    const result = await db.transaction(async (trx) => {
      // Relê dentro da transação: dois cliques em Aplicar não gravam duas vezes.
      const locked = await GradeImport.query({ client: trx })
        .where('id', gradeImport.id)
        .where('status', 'draft')
        .first()
      if (!locked) {
        return null
      }
      const applied = await GradeService.apply({
        trx,
        gradeImport: locked,
        event,
        actor: user,
        keepAgendaWhenNewer,
      })
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'grade_import.apply',
          entity: 'grade_import',
          entityId: locked.id,
          meta: { academicEventId: event.id, keepAgendaWhenNewer, ...applied },
        },
        trx
      )
      return applied
    })
    if (!result) {
      return conflict(response, 'NOT_DRAFT', 'Esta importação já foi aplicada.')
    }

    await gradeImport.refresh()
    const total = result.created + result.updated
    const imported = grades(total, 'nota importada', 'notas importadas')
    const message =
      event.gradesPublishedAt === null
        ? `${imported}. Ficam ocultas até você publicar.`
        : `${imported}. As notas desta avaliação já estão publicadas e aparecem na hora para os alunos.`
    const body = await serialize({ ...(await this.detail(user, gradeImport)), applied: result })
    return { ...body, message }
  }

  /**
   * DELETE /grade-imports/:id: rascunho é descartado; importação aplicada é desfeita, com cada
   * nota de volta ao valor anterior. Se alguma nota mudou depois, 409 com a lista e nada muda.
   */
  async destroy({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }
    const found = await this.findVisible(user, params.id)
    if (!found) {
      return notFound(response, IMPORT_NOT_FOUND)
    }
    const { gradeImport, event } = found
    const isOwnerOrAdmin =
      AcademicAccessService.isAdmin(user) || gradeImport.createdById === user.id
    if (!isOwnerOrAdmin) {
      return forbidden(response, 'Só quem importou e a administração descartam ou desfazem.')
    }

    if (gradeImport.status === 'discarded' || gradeImport.status === 'undone') {
      const body = await serialize(await this.detail(user, gradeImport))
      return {
        ...body,
        message:
          gradeImport.status === 'discarded'
            ? 'Esta importação já foi descartada.'
            : 'Esta importação já foi desfeita.',
      }
    }

    if (gradeImport.status === 'draft') {
      // Só descarta se ainda for rascunho (ver GradeService.discard).
      const discarded = await db.transaction((trx) =>
        GradeService.discard({ trx, gradeImportId: gradeImport.id, actorId: user.id })
      )
      await gradeImport.refresh()
      // Relida do banco: sem a transação, só vale descartada se outro pedido descartou antes.
      const statusNow: string = gradeImport.status
      if (!discarded && statusNow !== 'discarded') {
        return conflict(
          response,
          'NOT_DRAFT',
          'Esta importação foi aplicada enquanto você descartava. Para voltar as notas, use Desfazer importação.'
        )
      }
      const body = await serialize(await this.detail(user, gradeImport))
      return {
        ...body,
        message: discarded
          ? 'Importação descartada. Nenhuma nota mudou.'
          : 'Esta importação já foi descartada.',
      }
    }

    // Desfazer muda notas: a docente precisa da oferta em vigor, e a turma não pode estar
    // arquivada.
    if (!(await AcademicAccessService.canManageGrades(user, event))) {
      return forbidden(response, OFFER_FORBIDDEN)
    }
    if (await this.isArchived(event)) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const result = await db.transaction(async (trx) => {
      // Relê dentro da transação: dois cliques em Desfazer não desfazem duas vezes.
      const locked = await GradeImport.query({ client: trx })
        .where('id', gradeImport.id)
        .where('status', 'applied')
        .first()
      if (!locked) {
        return { ok: true as const, restored: 0, removed: 0 }
      }
      const undone = await GradeService.undo({ trx, gradeImport: locked, actor: user })
      if (undone.ok) {
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'grade_import.undo',
            entity: 'grade_import',
            entityId: gradeImport.id,
            meta: { academicEventId: event.id, restored: undone.restored, removed: undone.removed },
          },
          trx
        )
      }
      return undone
    })

    if (!result.ok) {
      const count = result.conflicts.length
      return conflict(
        response,
        'EDITED_AFTER_IMPORT',
        `${grades(count, 'nota foi editada', 'notas foram editadas')} depois desta importação. Nada foi desfeito: ${count === 1 ? 'ajuste essa nota direto na lista' : 'ajuste essas notas uma a uma na lista'}.`,
        { grades: result.conflicts }
      )
    }

    await gradeImport.refresh()
    const body = await serialize({
      ...(await this.detail(user, gradeImport)),
      undone: { restored: result.restored, removed: result.removed },
    })
    return { ...body, message: 'Importação desfeita. As notas voltaram ao valor anterior.' }
  }

  /** A importação pelo id, se a pessoa pode vê-la (fora do alcance: null, que vira 404). */
  private async findVisible(user: User, rawId: unknown) {
    const gradeImport = await GradeImport.query()
      .where('id', routeId(rawId))
      .preload('createdBy')
      .first()
    if (!gradeImport) {
      return null
    }
    const event = await AcademicEvent.query()
      .where('id', gradeImport.academicEventId)
      .preload('subject')
      .firstOrFail()
    if (!(await AcademicAccessService.canSeeGradeImport(user, gradeImport, event))) {
      return null
    }
    return { gradeImport, event }
  }

  /** O resumo da importação com o que a pessoa pode fazer e, no rascunho, as linhas. */
  private async detail(user: User, gradeImport: GradeImport) {
    await gradeImport.load('createdBy')
    const event = await AcademicEvent.findOrFail(gradeImport.academicEventId)
    const rows =
      gradeImport.status === 'draft'
        ? await GradeImportRow.query()
            .where('gradeImportId', gradeImport.id)
            .preload('student')
            .orderBy('rowNumber', 'asc')
        : null
    // Objeto simples: as linhas (rows) ficam numa chave de primeiro nível, que o serialize
    // resolve, e a resposta pode ganhar campos como applied e undone.
    return new GradeImportTransformer(
      gradeImport,
      await this.permissionsFor(user, gradeImport, event),
      rows
    ).toObject()
  }

  private async canApply(user: User, gradeImport: GradeImport, event: AcademicEvent) {
    if (AcademicAccessService.isAdmin(user)) {
      return true
    }
    return (
      gradeImport.createdById === user.id &&
      (await AcademicAccessService.canManageGrades(user, event))
    )
  }

  private async permissionsFor(
    user: User,
    gradeImport: GradeImport,
    event: AcademicEvent
  ): Promise<GradeImportPermissions> {
    const ownerOrAdmin = AcademicAccessService.isAdmin(user) || gradeImport.createdById === user.id
    const draft = gradeImport.status === 'draft'
    const applied = gradeImport.status === 'applied'
    // Turma arquivada fica somente leitura: aplicar e desfazer devolveriam 409, então os botões
    // saem; descartar o rascunho continua valendo.
    const writable = (draft || applied) && !(await this.isArchived(event))
    const canApply = draft && writable && (await this.canApply(user, gradeImport, event))
    let canUndo = false
    if (applied && writable && (await this.canApply(user, gradeImport, event))) {
      const { conflicts } = await GradeService.undoConflicts(gradeImport)
      canUndo = conflicts.length === 0
    }
    return { canApply, canDiscard: draft && ownerOrAdmin, canUndo }
  }

  /**
   * Quem chega ao evento para importar: a administração e a docente da oferta. Evento que a
   * docente nem vê é 404; evento que ela vê, mas de outra disciplina ou com o vínculo
   * encerrado, é 403.
   */
  private async eventAccess(user: User, event: AcademicEvent | null) {
    if (!event) {
      return 'not_found' as const
    }
    if (!(await AcademicAccessService.canViewEvent(user, event))) {
      return 'not_found' as const
    }
    if (!(await AcademicAccessService.canManageGrades(user, event))) {
      return 'forbidden' as const
    }
    return 'ok' as const
  }

  private denyEvent(response: Response, access: 'not_found' | 'forbidden') {
    return access === 'not_found'
      ? notFound(response, EVENT_NOT_FOUND)
      : forbidden(response, OFFER_FORBIDDEN)
  }

  private async isArchived(event: AcademicEvent) {
    if (!event.academicClassId) {
      return false
    }
    await event.load('academicClass')
    return event.academicClass?.isArchived ?? false
  }
}
