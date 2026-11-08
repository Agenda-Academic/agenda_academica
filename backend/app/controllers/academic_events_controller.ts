import AcademicEvent from '#models/academic_event'
import Reminder from '#models/reminder'
import AcademicClass from '#models/academic_class'
import Grade from '#models/grade'
import GradeImport from '#models/grade_import'
import type User from '#models/user'
import AcademicAccessService, { type VisibilityOptions } from '#services/academic_access_service'
import { guardianChoiceError } from '#services/api_errors'
import { parseIsoDateTime, reminderSendAt } from '#services/date_time_service'
import GradeService, { formatScore, GRADABLE_CATEGORIES } from '#services/grade_service'
import { countOf, publicTeacher } from '#services/query_helpers'
import { createAcademicEventValidator, updateAcademicEventValidator } from '#validators/academic'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { DateTime } from 'luxon'

const ADMIN_ONLY_CATEGORIES = ['institutional', 'holiday', 'recess']
const CLASS_ARCHIVED =
  'Esta turma está arquivada e fica somente leitura. Restaure a turma para mudar os eventos dela.'

export default class AcademicEventsController {
  async index({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.isKnownRole(user)) {
      return response.forbidden({ message: 'Seu perfil não tem acesso à agenda.' })
    }
    const query = AcademicEvent.query()
      .preload('subject')
      .preload('teacher', publicTeacher)
      .preload('academicClass', (classQuery) => classQuery.preload('course'))
      .orderBy('startsAt', 'asc')

    // O responsável vê a agenda de um aluno vinculado por vez (`studentId`).
    let options: VisibilityOptions = {}
    if (AcademicAccessService.isGuardian(user)) {
      const choice = await AcademicAccessService.guardianStudentChoice(
        user,
        request.input('studentId')
      )
      if (!choice.ok) {
        return guardianChoiceError(response, choice.reason)
      }
      options = { studentId: choice.studentId }
    }

    await this.applyVisibility(query, user, options)

    const { category, from, to, academicClassId, q, status } = request.qs()
    if (category) {
      const categories = String(category)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      if (categories.length) {
        query.whereIn('category', categories)
      }
    }

    if (status) {
      query.where('status', String(status))
    }

    if (academicClassId) {
      query.where('academicClassId', Number(academicClassId))
    }

    if (q) {
      query.where((scope) => {
        scope.where('title', 'like', `%${q}%`).orWhere('description', 'like', `%${q}%`)
      })
    }

    const fromDate = this.optionalDate(from)
    const toDate = this.optionalDate(to)
    if ((from && !fromDate) || (to && !toDate)) {
      return response.badRequest({ message: 'Periodo informado em formato invalido.' })
    }
    if (fromDate) {
      query.where('startsAt', '>=', this.toSql(fromDate))
    }
    if (toDate) {
      query.where('startsAt', '<=', this.toSql(toDate))
    }

    const events = await query
    return { data: events.map((event) => event.serialize()) }
  }

  async show({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const isGuardian = AcademicAccessService.isGuardian(user)

    // `studentId` é opcional aqui: sem ele, vale qualquer aluno com vínculo ativo.
    let options: VisibilityOptions = {}
    const rawStudentId = request.input('studentId')
    if (isGuardian && rawStudentId !== undefined && rawStudentId !== '') {
      const choice = await AcademicAccessService.guardianStudentChoice(user, rawStudentId)
      if (!choice.ok) {
        return guardianChoiceError(response, choice.reason)
      }
      options = { studentId: choice.studentId }
    }

    const event = await this.findWithRelations(Number(params.id))

    if (!event) {
      return response.notFound({ message: 'Evento nao encontrado.' })
    }

    if (!(await AcademicAccessService.canViewEvent(user, event, options))) {
      // Para o responsável, evento fora do alcance é 404, para não revelar que existe.
      if (isGuardian) {
        return response.notFound({ message: 'Evento nao encontrado.' })
      }
      return response.forbidden({ message: 'Voce nao tem acesso a este evento.' })
    }

    const reminder = await Reminder.query()
      .where('userId', user.id)
      .where('academicEventId', event.id)
      .first()

    return {
      data: {
        ...event.serialize(),
        reminder: reminder?.serialize() ?? null,
      },
    }
  }

  async store({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(createAcademicEventValidator)

    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return response.forbidden({ message: 'Seu perfil não pode criar eventos acadêmicos.' })
    }

    if (user.role === 'teacher' && ADMIN_ONLY_CATEGORIES.includes(payload.category)) {
      return response.forbidden({
        message: 'Categorias institucionais sao restritas a administracao.',
      })
    }

    if (
      !(await AcademicAccessService.teacherCanManage(
        user,
        payload.academicClassId,
        payload.subjectId
      ))
    ) {
      return response.forbidden({
        message: 'Professor so pode criar eventos das turmas que ministra.',
      })
    }

    if (await this.isArchivedClass(payload.academicClassId)) {
      return response.conflict({ code: 'ARCHIVED', message: CLASS_ARCHIVED })
    }

    const startsAt = parseIsoDateTime(payload.startsAt)
    const endsAt = payload.endsAt ? parseIsoDateTime(payload.endsAt) : null
    if (!startsAt || (payload.endsAt && !endsAt)) {
      return response.badRequest({ message: 'Data do evento em formato invalido.' })
    }

    const source = user.role === 'admin' ? (payload.source ?? 'official') : 'teacher'
    const event = await AcademicEvent.create({
      title: payload.title,
      description: payload.description ?? null,
      category: payload.category,
      source,
      status: 'scheduled',
      startsAt,
      endsAt,
      points: payload.points ?? null,
      location: payload.location ?? null,
      color: payload.color ?? null,
      academicClassId: payload.academicClassId ?? null,
      subjectId: payload.subjectId ?? null,
      teacherId: user.role === 'teacher' ? user.id : null,
      createdById: user.id,
      officialPriority: ['official', 'imported'].includes(source),
    })

    const stored = await this.findWithRelations(event.id)
    return response.created({ data: stored?.serialize() })
  }

  async update({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const event = await AcademicEvent.find(Number(params.id))

    if (!event) {
      return response.notFound({ message: 'Evento nao encontrado.' })
    }

    if (!(await AcademicAccessService.canManageEvent(user, event))) {
      return response.forbidden({ message: 'Voce nao pode editar este evento.' })
    }

    const payload = await request.validateUsing(updateAcademicEventValidator)

    if (
      user.role === 'teacher' &&
      payload.category !== undefined &&
      ADMIN_ONLY_CATEGORIES.includes(payload.category)
    ) {
      return response.forbidden({
        message: 'Categorias institucionais sao restritas a administracao.',
      })
    }

    const targetClassId =
      payload.academicClassId === undefined ? event.academicClassId : payload.academicClassId
    const targetSubjectId = payload.subjectId === undefined ? event.subjectId : payload.subjectId
    const changingScope =
      targetClassId !== event.academicClassId || targetSubjectId !== event.subjectId

    // O vinculo com a turma de destino so precisa ser revalidado quando o
    // evento muda de turma/disciplina; o dono pode editar o proprio evento.
    if (
      changingScope &&
      !(await AcademicAccessService.teacherCanManage(user, targetClassId, targetSubjectId))
    ) {
      return response.forbidden({
        message: 'Professor so pode mover eventos para turmas que ministra.',
      })
    }

    if (
      (await this.isArchivedClass(event.academicClassId)) ||
      (changingScope && (await this.isArchivedClass(targetClassId)))
    ) {
      return response.conflict({ code: 'ARCHIVED', message: CLASS_ARCHIVED })
    }

    // Com nota lançada, o evento não muda de turma nem de disciplina, não deixa de ser prova ou
    // trabalho e não passa a valer menos que a maior nota.
    const leavesGradable =
      payload.category !== undefined &&
      !(GRADABLE_CATEGORIES as readonly string[]).includes(payload.category)
    if (changingScope || leavesGradable || payload.points !== undefined) {
      const grades = await Grade.query().where('academicEventId', event.id).select('score')
      if (grades.length && (changingScope || leavesGradable)) {
        return response.conflict({
          code: 'HAS_GRADES',
          message:
            'Este evento já tem notas lançadas. Ele não muda de turma nem de disciplina e continua prova ou trabalho.',
        })
      }
      const highest = Math.max(-1, ...grades.map((grade) => grade.score ?? -1))
      if (grades.length && payload.points !== undefined) {
        const newMax = payload.points === null ? null : Math.round(payload.points * 100)
        let message: string | null = null
        if (newMax === null) {
          message = 'Este evento já tem notas lançadas. Informe quanto vale a avaliação.'
        } else if (newMax <= 0) {
          // Valor zero ou negativo apagaria o máximo da avaliação, e nenhuma nota caberia nele.
          message = 'Este evento já tem notas lançadas. A avaliação precisa valer mais que 0.'
        } else if (newMax < highest) {
          message = `Já há nota ${formatScore(highest)} lançada. A avaliação não pode valer menos que isso.`
        }
        if (message) {
          return response.unprocessableEntity({
            errors: [{ field: 'points', rule: 'grades', message }],
          })
        }
      }
    }

    const { startsAt: startsAtInput, endsAt: endsAtInput, ...attributes } = payload
    const startsAt = startsAtInput ? parseIsoDateTime(startsAtInput) : undefined
    let endsAt: DateTime | null | undefined
    if (endsAtInput === undefined) {
      endsAt = undefined
    } else if (endsAtInput === null) {
      endsAt = null
    } else {
      endsAt = parseIsoDateTime(endsAtInput)
    }
    if ((startsAtInput && !startsAt) || (endsAtInput && !endsAt)) {
      return response.badRequest({ message: 'Data do evento em formato invalido.' })
    }

    event.merge({
      ...attributes,
      startsAt: startsAt ?? event.startsAt,
      endsAt: endsAt === undefined ? event.endsAt : endsAt,
    })
    await db.transaction(async (trx) => {
      event.useTransaction(trx)
      await event.save()
      // O rascunho de importação foi casado com os alunos da turma antiga: se o evento muda de
      // turma ou de disciplina, ele sai, para a docente da nova oferta não ver os alunos de
      // outra turma na prévia (as linhas trazem nome e e-mail).
      if (changingScope) {
        await this.discardDrafts(event.id, user.id, trx)
      }
    })

    if (startsAt) {
      // Reposiciona lembretes ja configurados para a nova data do evento.
      const reminders = await Reminder.query()
        .where('academicEventId', event.id)
        .whereNull('sentAt')
      for (const reminder of reminders) {
        reminder.sendAt = reminderSendAt(event.startsAt, reminder.offsetMinutes)
        await reminder.save()
      }
    }

    const stored = await this.findWithRelations(event.id)
    return { data: stored?.serialize() }
  }

  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const event = await AcademicEvent.find(Number(params.id))

    if (!event) {
      return response.notFound({ message: 'Evento nao encontrado.' })
    }

    if (!(await AcademicAccessService.canManageEvent(user, event))) {
      return response.forbidden({ message: 'Voce nao pode excluir este evento.' })
    }

    if (await this.isArchivedClass(event.academicClassId)) {
      return response.conflict({ code: 'ARCHIVED', message: CLASS_ARCHIVED })
    }

    // Evento com nota não é excluído. Sem nota, as importações dele (rascunhos, descartadas
    // ou desfeitas) saem junto, na mesma transação da contagem.
    const removed = await db.transaction(async (trx) => {
      const grades = await countOf(Grade.query({ client: trx }).where('academicEventId', event.id))
      if (grades > 0) {
        return { grades }
      }
      await GradeImport.query({ client: trx }).where('academicEventId', event.id).delete()
      event.useTransaction(trx)
      await event.delete()
      return null
    })
    if (removed) {
      return response.conflict({
        code: 'HAS_DEPENDENTS',
        message: `Este evento tem ${removed.grades === 1 ? '1 nota lançada' : `${removed.grades} notas lançadas`}. Apague as notas antes de excluir, ou mude a situação do evento para cancelado.`,
        counts: removed,
      })
    }
    return { message: 'Evento removido com sucesso.' }
  }

  private async findWithRelations(id: number) {
    return AcademicEvent.query()
      .where('id', id)
      .preload('subject')
      .preload('teacher', publicTeacher)
      .preload('academicClass', (classQuery) => classQuery.preload('course'))
      .first()
  }

  /** Descarta os rascunhos de importação de notas do evento, com o registro de cada um. */
  private async discardDrafts(eventId: number, actorId: number, trx: TransactionClientContract) {
    const drafts = await GradeImport.query({ client: trx })
      .where('academicEventId', eventId)
      .where('status', 'draft')
      .select('id')
    for (const draft of drafts) {
      await GradeService.discard({
        trx,
        gradeImportId: draft.id,
        actorId,
        reason: 'event_scope_changed',
      })
    }
  }

  /** Turma arquivada fica somente leitura: evento novo, edição e exclusão viram 409. */
  private async isArchivedClass(academicClassId?: number | null) {
    if (!academicClassId) {
      return false
    }
    const academicClass = await AcademicClass.find(academicClassId)
    return academicClass?.isArchived ?? false
  }

  private async applyVisibility(
    query: ReturnType<typeof AcademicEvent.query>,
    user: User,
    options: VisibilityOptions = {}
  ) {
    const visibleClassIds = await AcademicAccessService.visibleClassIdsFor(user, options)
    if (visibleClassIds === null) {
      return
    }

    AcademicAccessService.scopeVisibleEvents(query, visibleClassIds)
  }

  private optionalDate(value: unknown) {
    if (!value) {
      return null
    }
    return parseIsoDateTime(String(value))
  }

  private toSql(value: DateTime) {
    return value.toSQL({ includeOffset: false })!
  }
}
