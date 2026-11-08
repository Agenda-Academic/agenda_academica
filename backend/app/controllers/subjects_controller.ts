import AcademicEvent from '#models/academic_event'
import ClassSubject from '#models/class_subject'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import AcademicAccessService from '#services/academic_access_service'
import { conflict, fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AuditLogService from '#services/audit_log_service'
import { countOf } from '#services/query_helpers'
import SubjectTransformer from '#transformers/subject_transformer'
import { createSubjectValidator, updateSubjectValidator } from '#validators/management'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const ONLY_ADMIN = 'Só a administração cria, edita, arquiva e exclui disciplinas.'
const NOT_FOUND = 'Disciplina não encontrada.'

/**
 * Disciplinas. A administração vê todas, com `usedIn`; a docente vê só as disciplinas em que
 * tem vínculo em vigor.
 */
export default class SubjectsController {
  async index({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não tem acesso à gestão de disciplinas.')
    }

    const query = Subject.query().orderBy('name')
    const { archived, q } = request.qs()
    if (['1', 'true'].includes(String(archived ?? '').toLowerCase())) {
      query.whereNotNull('archivedAt')
    } else {
      query.whereNull('archivedAt')
    }
    if (q && String(q).trim()) {
      const term = `%${String(q).trim()}%`
      query.where((scope) => {
        scope.where('name', 'like', term).orWhere('code', 'like', term)
      })
    }

    if (AcademicAccessService.isTeacher(user)) {
      const assignments = await TeachingAssignment.query()
        .where('teacherId', user.id)
        .whereNull('endedAt')
        .select('subjectId')
      query.whereIn(
        'id',
        assignments.map((assignment) => assignment.subjectId)
      )
      return serialize(SubjectTransformer.transform(await query))
    }

    const subjects = await query
    return serialize(SubjectTransformer.transform(subjects, await usedIn(subjects)))
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const payload = await request.validateUsing(createSubjectValidator)
    const duplicate = await findByCode(payload.code)
    if (duplicate) {
      return duplicateResponse(response, duplicate)
    }

    const subject = await db.transaction(async (trx) => {
      const created = await Subject.create(
        {
          code: payload.code,
          name: payload.name,
          ...(payload.workloadHours ? { workloadHours: payload.workloadHours } : {}),
          active: true,
        },
        { client: trx }
      )
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'subject.create',
          entity: 'subject',
          entityId: created.id,
          meta: { code: created.code },
        },
        trx
      )
      return created
    })

    await subject.refresh()
    const data = await serialize.withoutWrapping(
      SubjectTransformer.transform(subject, await usedIn([subject]))
    )
    return response.created({ data, warnings: await nameWarnings(subject.name, subject.id) })
  }

  async update({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const subject = await Subject.find(routeId(params.id))
    if (!subject) {
      return notFound(response, NOT_FOUND)
    }
    if (subject.isArchived) {
      return conflict(
        response,
        'ARCHIVED',
        'Esta disciplina está arquivada. Restaure a disciplina para editar.'
      )
    }

    const payload = await request.validateUsing(updateSubjectValidator)
    if (payload.code && payload.code !== subject.code) {
      const duplicate = await findByCode(payload.code, subject.id)
      if (duplicate) {
        return duplicateResponse(response, duplicate)
      }
    }

    const before = { code: subject.code, name: subject.name, workloadHours: subject.workloadHours }
    await db.transaction(async (trx) => {
      subject.useTransaction(trx)
      subject.merge(payload)
      await subject.save()
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'subject.update',
          entity: 'subject',
          entityId: subject.id,
          meta: {
            before,
            after: { code: subject.code, name: subject.name, workloadHours: subject.workloadHours },
          },
        },
        trx
      )
    })

    const data = await serialize.withoutWrapping(
      SubjectTransformer.transform(subject, await usedIn([subject]))
    )
    return { data, warnings: await nameWarnings(subject.name, subject.id) }
  }

  /** Arquivar tira a disciplina dos seletores; ofertas e eventos existentes ficam como estão. */
  async archive({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const subject = await Subject.find(routeId(params.id))
    if (!subject) {
      return notFound(response, NOT_FOUND)
    }
    if (!subject.isArchived) {
      await db.transaction((trx) => setArchived(subject, true, user.id, trx))
    }
    return serialize(SubjectTransformer.transform(subject, await usedIn([subject])))
  }

  async restore({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const subject = await Subject.find(routeId(params.id))
    if (!subject) {
      return notFound(response, NOT_FOUND)
    }
    if (subject.isArchived) {
      await db.transaction((trx) => setArchived(subject, false, user.id, trx))
    }
    return serialize(SubjectTransformer.transform(subject, await usedIn([subject])))
  }

  /** Exclui só a disciplina sem oferta, sem evento e sem vínculo de docente. */
  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const subject = await Subject.find(routeId(params.id))
    if (!subject) {
      return notFound(response, NOT_FOUND)
    }

    // A contagem roda na mesma transação do DELETE: os vínculos de docente ainda são CASCADE
    // e os eventos, SET NULL.
    const blocked = await db.transaction(async (trx) => {
      const client = { client: trx }
      const offers = await countOf(ClassSubject.query(client).where('subjectId', subject.id))
      const events = await countOf(AcademicEvent.query(client).where('subjectId', subject.id))
      const teachingAssignments = await countOf(
        TeachingAssignment.query(client).where('subjectId', subject.id)
      )
      if (offers + events + teachingAssignments > 0) {
        return { offers, events, teachingAssignments }
      }
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'subject.delete',
          entity: 'subject',
          entityId: subject.id,
          meta: { code: subject.code },
        },
        trx
      )
      subject.useTransaction(trx)
      await subject.delete()
      return null
    })

    if (blocked) {
      return conflict(
        response,
        'HAS_DEPENDENTS',
        'Esta disciplina é ofertada em turmas ou tem eventos. Só dá para excluir uma disciplina sem uso; arquive a disciplina em vez de excluir.',
        { counts: blocked }
      )
    }
    return { message: 'Disciplina excluída.' }
  }
}

async function findByCode(code: string, exceptId?: number) {
  const query = Subject.query().whereRaw('upper(code) = ?', [code.toUpperCase()])
  if (exceptId) {
    query.whereNot('id', exceptId)
  }
  return query.first()
}

function duplicateResponse(response: HttpContext['response'], duplicate: Subject) {
  if (duplicate.isArchived) {
    return conflict(
      response,
      'ARCHIVED_DUPLICATE',
      `Já existe a disciplina ${duplicate.code}, arquivada. Restaure a disciplina para usar de novo.`,
      { archivedId: duplicate.id }
    )
  }
  return fieldError(
    response,
    'code',
    `Já existe a disciplina ${duplicate.code} (${duplicate.name}). Escolha outro código.`,
    'unique'
  )
}

/** Nome repetido não bloqueia, mas volta como aviso para a administração conferir. */
async function nameWarnings(name: string, exceptId: number) {
  const same = await Subject.query()
    .whereRaw('lower(name) = ?', [name.toLowerCase()])
    .whereNot('id', exceptId)
  return same.map(
    (item) =>
      `Já existe a disciplina ${item.name} com o código ${item.code}${item.isArchived ? ', arquivada' : ''}. Confira se não é a mesma.`
  )
}

/** Em quantas turmas não arquivadas a disciplina tem oferta não arquivada. */
async function usedIn(subjects: Subject[]) {
  const map = new Map<number, number>()
  if (!subjects.length) {
    return map
  }
  const offers = await ClassSubject.query()
    .whereIn(
      'subjectId',
      subjects.map((subject) => subject.id)
    )
    .whereNull('archivedAt')
    .whereHas('academicClass', (classQuery) => {
      classQuery.whereNull('archivedAt')
    })
    .select('subjectId')
  for (const offer of offers) {
    map.set(offer.subjectId, (map.get(offer.subjectId) ?? 0) + 1)
  }
  return map
}

/** O serviço muda `active` e `archived_at` sempre juntos. */
async function setArchived(
  subject: Subject,
  archived: boolean,
  actorId: number,
  trx: TransactionClientContract
) {
  subject.useTransaction(trx)
  subject.archivedAt = archived ? DateTime.now() : null
  subject.active = !archived
  await subject.save()
  await AuditLogService.record(
    {
      actorId,
      action: archived ? 'subject.archive' : 'subject.restore',
      entity: 'subject',
      entityId: subject.id,
    },
    trx
  )
}
