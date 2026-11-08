import AcademicEvent from '#models/academic_event'
import AuditLog from '#models/audit_log'
import Enrollment from '#models/enrollment'
import Grade, { type GradeStatus } from '#models/grade'
import GradeChange, { type GradeChangeSource } from '#models/grade_change'
import GradeImport, { type GradeImportMapping } from '#models/grade_import'
import GradeImportRow, { REJECTED_ROW_KINDS, type GradeRowKind } from '#models/grade_import_row'
import GuardianLink from '#models/guardian_link'
import Notification from '#models/notification'
import User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import AuditLogService from '#services/audit_log_service'
import { effectiveShareGrades, studentFirstName } from '#services/guardian_link_service'
import NotificationService from '#services/notification_service'
import { countOf } from '#services/query_helpers'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

/** Só prova e trabalho recebem nota. */
export const GRADABLE_CATEGORIES = ['exam', 'assignment'] as const

const ZONE = 'America/Sao_Paulo'
const NOTES_LINK = '?tela=notas'
/** Marca em audit_logs: nota de uma importação aplicada apagada depois na Agenda. */
const CLEARED_AFTER_IMPORT = 'grade_import.grade_cleared'

/** Evento que recebe nota: prova ou trabalho de uma turma. */
export function isGradable(event: AcademicEvent) {
  return (
    !!event.academicClassId && (GRADABLE_CATEGORIES as readonly string[]).includes(event.category)
  )
}

/** Valor máximo da avaliação em centésimos (o `points` do evento); nulo se não foi definido. */
export function maxScoreOf(event: AcademicEvent) {
  if (event.points === null || event.points === undefined) {
    return null
  }
  const points = Number(event.points)
  return Number.isFinite(points) && points > 0 ? Math.round(points * 100) : null
}

/** 750 vira "7,5"; 1000 vira "10"; 725 vira "7,25". */
export function formatScore(score: number | null | undefined) {
  if (score === null || score === undefined) {
    return null
  }
  const sign = score < 0 ? '-' : ''
  const absolute = Math.abs(score)
  const integer = Math.trunc(absolute / 100)
  const cents = absolute % 100
  if (cents === 0) {
    return `${sign}${integer}`
  }
  return `${sign}${integer},${String(cents).padStart(2, '0').replace(/0$/, '')}`
}

export function normalizeEmail(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

/** Matrícula escolar para casar: minúscula, sem espaços e sem zeros à esquerda. */
export function normalizeRegistration(value: string) {
  return value
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/^0+(?=.)/, '')
}

type ParsedScore = { ok: true; score: number } | { ok: false; message: string }

/**
 * Lê a nota de uma célula: "7,5", "7.5", "10" ou o número 7.5 do XLSX. Célula vazia nunca vira
 * zero: é recusada. A nota vai de 0 até o valor da avaliação, com até duas casas decimais.
 */
export function parseScore(raw: unknown, maxScore: number): ParsedScore {
  const outOfRange = `A nota precisa estar entre 0 e ${formatScore(maxScore)}.`
  let cents: number
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { ok: false, message: 'Nota inválida. Use um número, como 7,5.' }
    }
    cents = Math.round(raw * 100)
    if (Math.abs(raw * 100 - cents) > 1e-6) {
      return { ok: false, message: 'Use no máximo duas casas decimais, como 7,25.' }
    }
  } else {
    const text = raw === null || raw === undefined ? '' : String(raw).replace(/\s+/g, '')
    if (!text) {
      return {
        ok: false,
        message: 'Nota em branco. A linha fica de fora e nenhuma nota é gravada.',
      }
    }
    const match = /^(-?)(\d{1,6})(?:[.,](\d+))?$/.exec(text)
    if (!match) {
      return { ok: false, message: 'Nota inválida. Use um número, como 7,5.' }
    }
    const decimals = (match[3] ?? '').replace(/0+$/, '')
    if (decimals.length > 2) {
      return { ok: false, message: 'Use no máximo duas casas decimais, como 7,25.' }
    }
    cents = Number(match[2]) * 100 + Number(decimals.padEnd(2, '0'))
    if (match[1] === '-' && cents !== 0) {
      return { ok: false, message: outOfRange }
    }
  }
  if (cents < 0 || cents > maxScore) {
    return { ok: false, message: outOfRange }
  }
  return { ok: true, score: cents }
}

/** Linha como chega do front: só as colunas mapeadas, já lidas do CSV ou do XLSX. */
export type ImportRowInput = {
  rowNumber?: number
  identifier?: string | number | null
  name?: string | null
  score?: string | number | null
}

export type ClassifiedRow = {
  rowNumber: number
  identifier: string | null
  nameHint: string | null
  rawScore: string | null
  studentId: number | null
  score: number | null
  previousScore: number | null
  previousStatus: string | null
  kind: GradeRowKind
  message: string | null
}

export type ImportCounts = {
  newCount: number
  changedCount: number
  sameCount: number
  newerCount: number
  rejectedCount: number
}

type ClassifyInput = {
  event: AcademicEvent
  maxScore: number
  mapping: GradeImportMapping
  rows: ImportRowInput[]
  fileModifiedAt: DateTime | null
  trx?: TransactionClientContract
}

/** Ordem da prévia: as linhas com problema primeiro, as iguais por último. */
const KIND_ORDER: Record<GradeRowKind, number> = {
  invalid: 0,
  no_match: 1,
  not_enrolled: 2,
  duplicate: 3,
  newer_in_agenda: 4,
  changed: 5,
  new: 6,
  same: 7,
}

export function sortRows<T extends { kind: string; rowNumber: number }>(rows: T[]) {
  return [...rows].sort(
    (a, b) =>
      (KIND_ORDER[a.kind as GradeRowKind] ?? 9) - (KIND_ORDER[b.kind as GradeRowKind] ?? 9) ||
      a.rowNumber - b.rowNumber
  )
}

function cell(value: unknown, max: number) {
  if (value === null || value === undefined) {
    return null
  }
  const text = String(value).trim().slice(0, max)
  return text || null
}

/** Grava a nota e a linha do histórico. `current` nulo cria a nota. */
type WriteInput = {
  trx: TransactionClientContract
  eventId: number
  studentId: number
  current: Grade | null
  score: number | null
  status: GradeStatus
  source: GradeChangeSource
  gradeImportId: number | null
  actorId: number
}

export type UndoConflict = { studentId: number; fullName: string | null; gradeId: number }

/** Notas: importação com prévia, aplicar e desfazer, edição, publicação e as visões de leitura. */
export default class GradeService {
  /**
   * Casa cada linha com um aluno da turma do evento (pelo e-mail da conta ou pela matrícula
   * escolar gravada pela administração) e classifica a linha. Nada é gravado aqui.
   */
  static async classify(input: ClassifyInput) {
    const { event, maxScore, mapping, fileModifiedAt, trx } = input
    const byEmail = mapping.identifierType === 'email'

    const enrollments = await Enrollment.query({ client: trx })
      .where('academicClassId', event.academicClassId!)
      .preload('user')
    const lookup = new Map<string, Enrollment>()
    // Dois alunos da turma com o mesmo identificador depois de normalizar (matrículas "0042" e
    // "42", ou e-mails que só mudam nas maiúsculas): a linha não casa com nenhum, para a nota
    // nunca ir para o aluno errado.
    const ambiguous = new Set<string>()
    for (const enrollment of enrollments) {
      if (enrollment.user?.role !== 'student') {
        continue
      }
      const key = byEmail
        ? normalizeEmail(enrollment.user.email)
        : enrollment.registration
          ? normalizeRegistration(enrollment.registration)
          : null
      if (!key) {
        continue
      }
      if (lookup.has(key) && lookup.get(key)!.userId !== enrollment.userId) {
        ambiguous.add(key)
      }
      lookup.set(key, enrollment)
    }

    const grades = await Grade.query({ client: trx }).where('academicEventId', event.id)
    const gradeByStudent = new Map(grades.map((grade) => [grade.studentId, grade]))

    const classified: ClassifiedRow[] = []
    input.rows.forEach((row, index) => {
      const rawIdentifier = cell(row.identifier, 254)
      const nameHint = cell(row.name, 160)
      const rawScore = cell(row.score, 40)
      // Linha toda em branco (o fim da planilha) não conta.
      if (!rawIdentifier && !nameHint && !rawScore) {
        return
      }
      const identifier = rawIdentifier
        ? (byEmail ? normalizeEmail(rawIdentifier) : normalizeRegistration(rawIdentifier)) || null
        : null
      const base: ClassifiedRow = {
        rowNumber: row.rowNumber ?? index + 1,
        identifier,
        nameHint,
        rawScore,
        studentId: null,
        score: null,
        previousScore: null,
        previousStatus: null,
        kind: 'invalid',
        message: null,
      }

      if (!identifier) {
        classified.push({
          ...base,
          message: byEmail ? 'Linha sem e-mail do aluno.' : 'Linha sem matrícula do aluno.',
        })
        return
      }
      if (ambiguous.has(identifier)) {
        classified.push({
          ...base,
          kind: 'no_match',
          message: byEmail
            ? 'Mais de um aluno da turma com este e-mail. Lance a nota direto na lista.'
            : 'Mais de um aluno da turma com esta matrícula. Peça à secretaria para corrigir a matrícula na turma.',
        })
        return
      }
      const enrollment = lookup.get(identifier)
      if (!enrollment) {
        classified.push({
          ...base,
          kind: 'no_match',
          message: byEmail
            ? 'Nenhum aluno da turma com este e-mail.'
            : 'Nenhum aluno da turma com esta matrícula. Confira a matrícula gravada pela secretaria.',
        })
        return
      }
      if (enrollment.status !== 'active') {
        classified.push({
          ...base,
          studentId: enrollment.userId,
          kind: 'not_enrolled',
          message: 'O aluno não está ativo na turma (pedido pendente, inativo ou concluído).',
        })
        return
      }
      const parsed = parseScore(row.score, maxScore)
      if (!parsed.ok) {
        classified.push({ ...base, studentId: enrollment.userId, message: parsed.message })
        return
      }
      classified.push({
        ...base,
        studentId: enrollment.userId,
        score: parsed.score,
        kind: 'new',
      })
    })

    // O mesmo aluno em mais de uma linha: com a mesma nota, vale a primeira; com notas
    // diferentes, nenhuma vale, para a docente corrigir o arquivo.
    const byStudent = new Map<number, ClassifiedRow[]>()
    for (const row of classified) {
      if (row.kind === 'new' && row.studentId !== null) {
        byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row])
      }
    }
    for (const group of byStudent.values()) {
      if (group.length < 2) {
        continue
      }
      const sameScore = group.every((row) => row.score === group[0].score)
      const lines = group.map((row) => row.rowNumber).join(', ')
      for (const [position, row] of group.entries()) {
        if (sameScore && position === 0) {
          continue
        }
        row.kind = 'duplicate'
        row.message = sameScore
          ? `Aluno repetido no arquivo, com a mesma nota. Vale a linha ${group[0].rowNumber}.`
          : `Aluno em mais de uma linha com notas diferentes (linhas ${lines}). Corrija o arquivo e importe de novo.`
      }
    }

    for (const row of classified) {
      if (row.kind !== 'new' || row.studentId === null) {
        continue
      }
      const existing = gradeByStudent.get(row.studentId)
      if (!existing) {
        continue
      }
      row.previousScore = existing.score
      row.previousStatus = existing.status
      if (existing.status === 'graded' && existing.score === row.score) {
        row.kind = 'same'
        continue
      }
      const changedAt = existing.updatedAt ?? existing.createdAt
      if (fileModifiedAt && changedAt && changedAt.toMillis() > fileModifiedAt.toMillis()) {
        row.kind = 'newer_in_agenda'
        row.message = `Nota mudada na Agenda em ${changedAt.setZone(ZONE).toFormat('dd/MM/yyyy')}, depois do arquivo.`
        continue
      }
      row.kind = 'changed'
    }

    return { rows: classified, counts: this.countRows(classified) }
  }

  static countRows(rows: { kind: string }[]): ImportCounts {
    const counts: ImportCounts = {
      newCount: 0,
      changedCount: 0,
      sameCount: 0,
      newerCount: 0,
      rejectedCount: 0,
    }
    for (const row of rows) {
      if (row.kind === 'new') counts.newCount++
      else if (row.kind === 'changed') counts.changedCount++
      else if (row.kind === 'same') counts.sameCount++
      else if (row.kind === 'newer_in_agenda') counts.newerCount++
      else if ((REJECTED_ROW_KINDS as readonly string[]).includes(row.kind)) counts.rejectedCount++
    }
    return counts
  }

  /** Grava a nota (cria ou muda) e a linha em grade_changes, na transação dada. */
  static async write(input: WriteInput) {
    const { trx, current } = input
    const grade = current ?? new Grade()
    grade.useTransaction(trx)
    const oldScore = current ? current.score : null
    const oldStatus = current ? current.status : null
    grade.academicEventId = input.eventId
    grade.studentId = input.studentId
    grade.score = input.score
    grade.status = input.status
    grade.gradeImportId = input.gradeImportId
    grade.updatedById = input.actorId
    await grade.save()

    await GradeChange.create(
      {
        gradeId: grade.id,
        oldScore,
        newScore: input.score,
        oldStatus,
        newStatus: input.status,
        source: input.source,
        gradeImportId: input.gradeImportId,
        changedById: input.actorId,
      },
      { client: trx }
    )
    return grade
  }

  /**
   * Aplica o rascunho. Cada linha é conferida de novo: aluno ainda ativo, nota dentro do
   * valor atual da avaliação e nota da Agenda igual à da prévia. A nota que mudou na Agenda
   * depois do arquivo (ou depois da prévia) só é substituída com `keepAgendaWhenNewer: false`.
   */
  static async apply(input: {
    trx: TransactionClientContract
    gradeImport: GradeImport
    event: AcademicEvent
    actor: User
    keepAgendaWhenNewer: boolean
  }) {
    const { trx, gradeImport, event, actor } = input
    const rows = await GradeImportRow.query({ client: trx })
      .where('gradeImportId', gradeImport.id)
      .whereIn('kind', ['new', 'changed', 'newer_in_agenda'])
      .orderBy('rowNumber', 'asc')
    const active = await Enrollment.query({ client: trx })
      .where('academicClassId', event.academicClassId!)
      .where('status', 'active')
      .select('userId')
    const activeIds = new Set(active.map((enrollment) => enrollment.userId))
    const grades = await Grade.query({ client: trx }).where('academicEventId', event.id)
    const gradeByStudent = new Map(grades.map((grade) => [grade.studentId, grade]))
    const maxScore = maxScoreOf(event)

    const result = { created: 0, updated: 0, keptAgenda: 0, unchanged: 0, skipped: 0 }
    for (const row of rows) {
      if (
        row.studentId === null ||
        row.score === null ||
        !activeIds.has(row.studentId) ||
        maxScore === null ||
        row.score > maxScore
      ) {
        result.skipped++
        continue
      }
      const current = gradeByStudent.get(row.studentId) ?? null
      const sameAsPreview =
        (current?.score ?? null) === row.previousScore &&
        (current?.status ?? null) === row.previousStatus
      if ((row.kind === 'newer_in_agenda' || !sameAsPreview) && input.keepAgendaWhenNewer) {
        result.keptAgenda++
        continue
      }
      if (current && current.status === 'graded' && current.score === row.score) {
        result.unchanged++
        continue
      }
      const grade = await this.write({
        trx,
        eventId: event.id,
        studentId: row.studentId,
        current,
        score: row.score,
        status: 'graded',
        source: 'import',
        gradeImportId: gradeImport.id,
        actorId: actor.id,
      })
      gradeByStudent.set(row.studentId, grade)
      if (current) {
        result.updated++
      } else {
        result.created++
      }
    }

    gradeImport.useTransaction(trx)
    gradeImport.status = 'applied'
    gradeImport.appliedAt = DateTime.now()
    await gradeImport.save()
    // As linhas da prévia somem; o histórico fica em grade_changes.
    await GradeImportRow.query({ client: trx }).where('gradeImportId', gradeImport.id).delete()
    return result
  }

  /**
   * Descarta o rascunho: as linhas da prévia somem e nenhuma nota muda. Relê a importação na
   * transação e só descarta se ela ainda for rascunho: um Aplicar ao mesmo tempo já pode ter
   * gravado as notas, e marcar essa importação como descartada tiraria o Desfazer dela.
   * Devolve false quando a importação já não era rascunho.
   */
  static async discard(input: {
    trx: TransactionClientContract
    gradeImportId: number
    actorId: number
    reason?: string
  }) {
    const { trx } = input
    const draft = await GradeImport.query({ client: trx })
      .where('id', input.gradeImportId)
      .where('status', 'draft')
      .first()
    if (!draft) {
      return false
    }
    draft.status = 'discarded'
    await draft.save()
    await GradeImportRow.query({ client: trx }).where('gradeImportId', draft.id).delete()
    await AuditLogService.record(
      {
        actorId: input.actorId,
        action: 'grade_import.discard',
        entity: 'grade_import',
        entityId: draft.id,
        meta: {
          academicEventId: draft.academicEventId,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      },
      trx
    )
    return true
  }

  /**
   * Apaga a nota (célula vazia na Agenda nunca vira zero). O CASCADE leva o histórico da
   * nota; por isso cada importação ainda aplicada que mexeu nela ganha uma marca em
   * audit_logs (só ids), e desfazer essa importação passa a devolver 409 com este aluno.
   */
  static async clear(input: {
    trx: TransactionClientContract
    grade: Grade
    eventId: number
    actorId: number
  }) {
    const { trx, grade } = input
    const touched = await GradeChange.query({ client: trx })
      .where('gradeId', grade.id)
      .where('source', 'import')
      .whereNotNull('gradeImportId')
      .select('gradeImportId')
    const touchedIds = [...new Set(touched.map((change) => change.gradeImportId!))]
    const applied = touchedIds.length
      ? await GradeImport.query({ client: trx })
          .whereIn('id', touchedIds)
          .where('status', 'applied')
          .select('id')
      : []

    grade.useTransaction(trx)
    await grade.delete()
    await AuditLogService.record(
      {
        actorId: input.actorId,
        action: 'grade.clear',
        entity: 'grade',
        entityId: grade.id,
        subjectUserId: grade.studentId,
        meta: { academicEventId: input.eventId },
      },
      trx
    )
    for (const item of applied) {
      await AuditLogService.record(
        {
          actorId: input.actorId,
          action: CLEARED_AFTER_IMPORT,
          entity: 'grade_import',
          entityId: item.id,
          subjectUserId: grade.studentId,
          meta: { academicEventId: input.eventId, gradeId: grade.id },
        },
        trx
      )
    }
  }

  /**
   * Notas da importação que mudaram depois dela. Só não contam as mudanças de outra
   * importação que já foi desfeita (e o Desfazer dela): qualquer edição na Agenda ou outra
   * importação ainda aplicada impede desfazer.
   */
  static async undoConflicts(gradeImport: GradeImport, trx?: TransactionClientContract) {
    const changes = await GradeChange.query({ client: trx })
      .where('gradeImportId', gradeImport.id)
      .where('source', 'import')
      .preload('grade', (gradeQuery) => gradeQuery.preload('student'))
      .orderBy('id', 'asc')
    const gradeIds = changes.map((change) => change.gradeId)
    const later = gradeIds.length
      ? await GradeChange.query({ client: trx })
          .whereIn('gradeId', gradeIds)
          .where('id', '>', Math.min(...changes.map((change) => change.id)))
      : []
    const importIds = [
      ...new Set(later.map((change) => change.gradeImportId).filter((id) => id !== null)),
    ] as number[]
    const imports = importIds.length
      ? await GradeImport.query({ client: trx }).whereIn('id', importIds).select('id', 'status')
      : []
    const importStatus = new Map(imports.map((item) => [item.id, item.status]))

    const conflicts: UndoConflict[] = []
    // Nota apagada na Agenda depois da importação: a linha e o histórico dela sumiram, então
    // a marca fica no audit_logs da importação (só ids), gravada por `clear`.
    const cleared = await AuditLog.query({ client: trx })
      .where('entity', 'grade_import')
      .where('entityId', gradeImport.id)
      .where('action', CLEARED_AFTER_IMPORT)
      .orderBy('id', 'asc')
    const clearedIds = cleared
      .map((entry) => entry.subjectUserId)
      .filter((id): id is number => id !== null)
    const clearedUsers = clearedIds.length
      ? await User.query({ client: trx }).whereIn('id', clearedIds).select('id', 'fullName')
      : []
    for (const entry of cleared) {
      if (entry.subjectUserId === null) {
        continue
      }
      const meta = entry.meta ? (JSON.parse(entry.meta) as { gradeId?: number }) : {}
      conflicts.push({
        studentId: entry.subjectUserId,
        fullName: clearedUsers.find((item) => item.id === entry.subjectUserId)?.fullName ?? null,
        gradeId: meta.gradeId ?? 0,
      })
    }

    for (const change of changes) {
      const grade = change.grade
      const blocking = later.some(
        (item) =>
          item.gradeId === change.gradeId &&
          item.id > change.id &&
          (item.source === 'manual' ||
            (item.source === 'import' && importStatus.get(item.gradeImportId ?? 0) !== 'undone'))
      )
      const moved = grade.score !== change.newScore || grade.status !== change.newStatus
      if (blocking || moved) {
        conflicts.push({
          studentId: grade.studentId,
          fullName: grade.student?.fullName ?? null,
          gradeId: grade.id,
        })
      }
    }
    return { changes, conflicts }
  }

  /**
   * Desfaz uma importação aplicada: cada nota volta ao valor anterior, e a nota que a
   * importação criou deixa de existir. Com nota editada depois, nada muda e volta a lista.
   */
  static async undo(input: {
    trx: TransactionClientContract
    gradeImport: GradeImport
    actor: User
  }): Promise<
    { ok: true; restored: number; removed: number } | { ok: false; conflicts: UndoConflict[] }
  > {
    const { trx, gradeImport, actor } = input
    const { changes, conflicts } = await this.undoConflicts(gradeImport, trx)
    if (conflicts.length) {
      return { ok: false, conflicts }
    }

    let restored = 0
    let removed = 0
    for (const change of changes) {
      const grade = change.grade
      grade.useTransaction(trx)
      if (change.oldStatus === null) {
        // A nota não existia antes da importação.
        await grade.delete()
        removed++
        continue
      }
      // De onde veio o valor anterior: a importação da mudança logo antes desta, se houver.
      const previous = await GradeChange.query({ client: trx })
        .where('gradeId', grade.id)
        .where('id', '<', change.id)
        .orderBy('id', 'desc')
        .first()
      const restoredImportId = previous?.gradeImportId ?? null
      await this.write({
        trx,
        eventId: grade.academicEventId,
        studentId: grade.studentId,
        current: grade,
        score: change.oldScore,
        status: change.oldStatus as GradeStatus,
        source: 'undo',
        gradeImportId: restoredImportId,
        actorId: actor.id,
      })
      restored++
    }

    gradeImport.useTransaction(trx)
    gradeImport.status = 'undone'
    gradeImport.undoneAt = DateTime.now()
    await gradeImport.save()
    return { ok: true, restored, removed }
  }

  static studentNoticeLink(eventId: number) {
    return `${NOTES_LINK}&evento=${eventId}`
  }

  static guardianNoticeLink(studentId: number, eventId: number) {
    return `${NOTES_LINK}&aluno=${studentId}&evento=${eventId}`
  }

  /**
   * Publica as notas do evento e avisa cada aluno com nota e os responsáveis com vínculo
   * ativo que têm direito de ver as notas (de aluno adulto, só se ele compartilha).
   */
  static async publish(input: {
    trx: TransactionClientContract
    event: AcademicEvent
    actor: User
  }) {
    const { trx, event, actor } = input
    event.useTransaction(trx)
    event.gradesPublishedAt = DateTime.now()
    event.gradesPublishedById = actor.id
    await event.save()

    const grades = await Grade.query({ client: trx })
      .where('academicEventId', event.id)
      .select('studentId')
    const studentIds = [...new Set(grades.map((grade) => grade.studentId))]
    const subjectName = event.subject?.name
    const body = subjectName ? `${subjectName}. Veja na tela Notas.` : 'Veja na tela Notas.'

    for (const studentId of studentIds) {
      await NotificationService.notify(
        studentId,
        {
          kind: 'grades_published',
          title: `Nota publicada: ${event.title}`,
          body,
          link: this.studentNoticeLink(event.id),
        },
        trx
      )
    }

    let guardians = 0
    if (studentIds.length) {
      const links = await GuardianLink.query({ client: trx })
        .whereIn('studentId', studentIds)
        .where('status', 'active')
        .preload('student')
      for (const link of links) {
        if (!effectiveShareGrades(link, link.student)) {
          continue
        }
        await NotificationService.notify(
          link.guardianId,
          {
            kind: 'grades_published',
            title: `Nota de ${studentFirstName(link.student)} publicada: ${event.title}`,
            body,
            link: this.guardianNoticeLink(link.studentId, event.id),
          },
          trx
        )
        guardians++
      }
    }
    return { students: studentIds.length, guardians }
  }

  /** Oculta as notas de novo e retira os avisos de publicação que ainda não foram lidos. */
  static async unpublish(input: { trx: TransactionClientContract; event: AcademicEvent }) {
    const { trx, event } = input
    event.useTransaction(trx)
    event.gradesPublishedAt = null
    event.gradesPublishedById = null
    await event.save()

    const unread = () =>
      Notification.query({ client: trx })
        .where('kind', 'grades_published')
        .whereNull('readAt')
        .where((scope) => {
          scope
            .where('link', this.studentNoticeLink(event.id))
            .orWhere('link', 'like', `${NOTES_LINK}&aluno=%&evento=${event.id}`)
        })
    const removedNotices = await countOf(unread())
    await unread().delete()
    return { removedNotices }
  }

  /** A nota como a docente e a administração veem: com a importação de onde veio. */
  static staffGrade(grade: Grade) {
    return {
      id: grade.id,
      score: grade.score,
      scoreText: formatScore(grade.score),
      status: grade.status,
      updatedAt: grade.updatedAt ?? grade.createdAt,
      source: this.gradeSource(grade, true),
    }
  }

  /** A nota publicada, como o aluno e o responsável veem. */
  static publicGrade(grade: Grade) {
    return {
      score: grade.score,
      scoreText: formatScore(grade.score),
      status: grade.status,
      updatedAt: grade.updatedAt ?? grade.createdAt,
      source: this.gradeSource(grade, false),
    }
  }

  private static gradeSource(grade: Grade, detailed: boolean) {
    const gradeImport = grade.gradeImportId ? grade.gradeImport : null
    if (!gradeImport) {
      return { type: 'manual' as const }
    }
    return {
      type: 'import' as const,
      source: gradeImport.source,
      importedAt: gradeImport.appliedAt,
      ...(detailed ? { importId: gradeImport.id, fileName: gradeImport.fileName } : {}),
    }
  }

  static eventSummary(event: AcademicEvent) {
    const maxScore = maxScoreOf(event)
    return {
      id: event.id,
      title: event.title,
      category: event.category,
      status: event.status,
      startsAt: event.startsAt,
      points: event.points === null ? null : Number(event.points),
      maxScore,
      maxScoreText: formatScore(maxScore),
      academicClassId: event.academicClassId,
      subjectId: event.subjectId,
      gradesPublishedAt: event.gradesPublishedAt,
      academicClass: event.academicClass
        ? { id: event.academicClass.id, name: event.academicClass.name }
        : null,
      subject: event.subject
        ? { id: event.subject.id, code: event.subject.code, name: event.subject.name }
        : null,
    }
  }

  /**
   * GET /events/:id/grades: todos os alunos ativos da turma, com e sem nota, e quem já tem
   * nota mas saiu da turma. A matrícula escolar vai só para a administração.
   */
  static async eventReport(event: AcademicEvent, forAdmin: boolean) {
    const enrollments = await Enrollment.query()
      .where('academicClassId', event.academicClassId!)
      .preload('user')
    const grades = await Grade.query()
      .where('academicEventId', event.id)
      .preload('gradeImport')
      .preload('student')
    const gradeByStudent = new Map(grades.map((grade) => [grade.studentId, grade]))
    const enrollmentByStudent = new Map(
      enrollments.map((enrollment) => [enrollment.userId, enrollment])
    )

    const studentIds = new Set<number>()
    for (const enrollment of enrollments) {
      if (enrollment.status === 'active' && enrollment.user?.role === 'student') {
        studentIds.add(enrollment.userId)
      }
    }
    for (const grade of grades) {
      studentIds.add(grade.studentId)
    }

    const students = [...studentIds].map((studentId) => {
      const enrollment = enrollmentByStudent.get(studentId) ?? null
      const grade = gradeByStudent.get(studentId) ?? null
      const user = enrollment?.user ?? grade?.student ?? null
      return {
        studentId,
        fullName: user?.fullName ?? null,
        email: user?.email ?? null,
        enrollmentStatus: enrollment?.status ?? null,
        ...(forAdmin ? { registration: enrollment?.registration ?? null } : {}),
        grade: grade ? this.staffGrade(grade) : null,
      }
    })
    students.sort((a, b) =>
      (a.fullName ?? a.email ?? '').localeCompare(b.fullName ?? b.email ?? '', 'pt-BR')
    )

    const active = students.filter((student) => student.enrollmentStatus === 'active')
    const counts = {
      students: active.length,
      graded: grades.filter((grade) => grade.status === 'graded').length,
      absent: grades.filter((grade) => grade.status === 'absent').length,
      excused: grades.filter((grade) => grade.status === 'excused').length,
      missing: active.filter((student) => !student.grade).length,
    }
    return { event: this.eventSummary(event), counts, students }
  }

  /** Uma linha da lista de alunos da avaliação, depois de lançar ou limpar a nota. */
  static async eventStudentRow(event: AcademicEvent, studentId: number, forAdmin: boolean) {
    const report = await this.eventReport(event, forAdmin)
    return report.students.find((student) => student.studentId === studentId) ?? null
  }

  /**
   * As notas que o aluno vê (GET /me/grades) e que o responsável vê (GET /students/:id/grades):
   * só as publicadas, organizadas por disciplina, sem média da turma. Prova ou trabalho das
   * turmas ativas do aluno ainda sem publicação aparece com `published: false` e sem nota.
   */
  static async studentReport(student: User) {
    const classIds = await AcademicAccessService.activeClassIdsOf([student.id])
    const grades = await Grade.query().where('studentId', student.id).preload('gradeImport')
    const gradeByEvent = new Map(grades.map((grade) => [grade.academicEventId, grade]))
    const gradedEventIds = grades.map((grade) => grade.academicEventId)

    let events: AcademicEvent[] = []
    if (classIds.length || gradedEventIds.length) {
      events = await AcademicEvent.query()
        .whereIn('category', [...GRADABLE_CATEGORIES])
        .whereNotNull('academicClassId')
        .where((scope) => {
          if (classIds.length) {
            scope.whereIn('academicClassId', classIds)
          }
          if (gradedEventIds.length) {
            // Nota publicada de turma que o aluno já deixou continua no histórico dele.
            scope.orWhere((graded) => {
              graded.whereIn('id', gradedEventIds).whereNotNull('gradesPublishedAt')
            })
          }
        })
        .preload('subject')
        .preload('academicClass')
        .orderBy('startsAt', 'asc')
        .orderBy('id', 'asc')
    }

    type Group = {
      academicClass: { id: number; name: string; period: string; year: number; semester: number }
      subject: { id: number; code: string; name: string } | null
      evaluations: ReturnType<typeof GradeService.evaluation>[]
    }
    const groups = new Map<string, Group>()
    let published = 0
    let awaiting = 0
    for (const event of events) {
      const isPublished = event.gradesPublishedAt !== null
      const grade = isPublished ? (gradeByEvent.get(event.id) ?? null) : null
      if (event.status === 'cancelled' && !grade) {
        continue
      }
      const key = `${event.academicClassId}:${event.subjectId ?? 0}`
      if (!groups.has(key)) {
        const academicClass = event.academicClass
        groups.set(key, {
          academicClass: {
            id: academicClass.id,
            name: academicClass.name,
            period: academicClass.period,
            year: academicClass.year,
            semester: academicClass.semester,
          },
          subject: event.subject
            ? { id: event.subject.id, code: event.subject.code, name: event.subject.name }
            : null,
          evaluations: [],
        })
      }
      groups.get(key)!.evaluations.push(this.evaluation(event, grade))
      if (grade) published++
      if (!isPublished) awaiting++
    }

    const subjects = [...groups.values()].sort(
      (a, b) =>
        (a.subject?.name ?? '￿').localeCompare(b.subject?.name ?? '￿', 'pt-BR') ||
        a.academicClass.name.localeCompare(b.academicClass.name, 'pt-BR')
    )
    return { counts: { published, awaiting }, subjects }
  }

  private static evaluation(event: AcademicEvent, grade: Grade | null) {
    const maxScore = maxScoreOf(event)
    return {
      eventId: event.id,
      title: event.title,
      category: event.category,
      status: event.status,
      startsAt: event.startsAt,
      maxScore,
      maxScoreText: formatScore(maxScore),
      published: event.gradesPublishedAt !== null,
      publishedAt: event.gradesPublishedAt,
      grade: grade ? this.publicGrade(grade) : null,
    }
  }
}
