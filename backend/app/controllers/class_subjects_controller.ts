import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import ClassSubject from '#models/class_subject'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import { conflict, fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AuditLogService from '#services/audit_log_service'
import { countOf } from '#services/query_helpers'
import TeachingAssignmentTransformer from '#transformers/teaching_assignment_transformer'
import {
  assignTeacherValidator,
  offerSubjectValidator,
  updateTeachingAssignmentValidator,
} from '#validators/management'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

const ONLY_ADMIN = 'Só a administração oferta disciplinas e vincula docentes.'
const CLASS_NOT_FOUND = 'Turma não encontrada.'
const OFFER_NOT_FOUND = 'Esta disciplina não é ofertada nesta turma.'
const ASSIGNMENT_NOT_FOUND = 'Vínculo de docente não encontrado.'
const CLASS_ARCHIVED =
  'Esta turma está arquivada e fica somente leitura. Restaure a turma para mudar algo.'

/** Ofertas (disciplina na turma) e vínculos de docente. Tudo só da administração. */
export default class ClassSubjectsController {
  /** POST /classes/:id/subjects: oferta a disciplina na turma, com ou sem docente. */
  async store({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const academicClass = await AcademicClass.find(routeId(params.id))
    if (!academicClass) {
      return notFound(response, CLASS_NOT_FOUND)
    }
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const { subjectId } = await request.validateUsing(offerSubjectValidator)
    const subject = await Subject.find(subjectId)
    if (!subject) {
      return fieldError(response, 'subjectId', 'Disciplina não encontrada. Escolha uma da lista.')
    }
    if (subject.isArchived) {
      return fieldError(
        response,
        'subjectId',
        'Esta disciplina está arquivada. Restaure a disciplina antes de ofertar.'
      )
    }

    const existing = await ClassSubject.query()
      .where('academicClassId', academicClass.id)
      .where('subjectId', subject.id)
      .first()
    if (existing && existing.archivedAt === null) {
      return fieldError(
        response,
        'subjectId',
        `${subject.name} já é ofertada nesta turma.`,
        'unique'
      )
    }

    const offer = await db.transaction(async (trx) => {
      if (existing) {
        existing.useTransaction(trx)
        existing.archivedAt = null
        await existing.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'offer.restore',
            entity: 'class_subject',
            entityId: existing.id,
            meta: { academicClassId: academicClass.id, subjectId: subject.id },
          },
          trx
        )
        return existing
      }
      const created = await ClassSubject.create(
        { academicClassId: academicClass.id, subjectId: subject.id, createdById: user.id },
        { client: trx }
      )
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'offer.create',
          entity: 'class_subject',
          entityId: created.id,
          meta: { academicClassId: academicClass.id, subjectId: subject.id },
        },
        trx
      )
      return created
    })

    response.status(existing ? 200 : 201)
    return {
      data: {
        id: offer.id,
        academicClassId: offer.academicClassId,
        subjectId: offer.subjectId,
        archivedAt: null,
        subject: { id: subject.id, code: subject.code, name: subject.name },
        teachers: [],
        withoutTeacher: true,
        restored: Boolean(existing),
      },
    }
  }

  /** Arquiva a oferta e encerra os vínculos de docente em vigor nela. */
  async archive({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const found = await this.findOffer(params)
    if (found.error !== undefined) {
      return notFound(response, found.error)
    }
    const { academicClass, offer } = found
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    let endedAssignments = 0
    if (offer.archivedAt === null) {
      await db.transaction(async (trx) => {
        const now = DateTime.now()
        offer.useTransaction(trx)
        offer.archivedAt = now
        await offer.save()

        const current = await TeachingAssignment.query({ client: trx })
          .where('academicClassId', offer.academicClassId)
          .where('subjectId', offer.subjectId)
          .whereNull('endedAt')
        for (const assignment of current) {
          assignment.endedAt = now
          await assignment.save()
        }
        endedAssignments = current.length

        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'offer.archive',
            entity: 'class_subject',
            entityId: offer.id,
            meta: {
              academicClassId: offer.academicClassId,
              subjectId: offer.subjectId,
              endedAssignmentIds: current.map((assignment) => assignment.id),
            },
          },
          trx
        )
      })
    }

    return {
      data: {
        id: offer.id,
        academicClassId: offer.academicClassId,
        subjectId: offer.subjectId,
        archivedAt: offer.archivedAt,
        endedAssignments,
      },
    }
  }

  /** Exclui só a oferta sem evento e sem docente (nem encerrado). */
  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const found = await this.findOffer(params)
    if (found.error !== undefined) {
      return notFound(response, found.error)
    }
    const { academicClass, offer } = found
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    // Conferência e exclusão na mesma transação.
    const blocked = await db.transaction(async (trx) => {
      const events = await countOf(
        AcademicEvent.query({ client: trx })
          .where('academicClassId', offer.academicClassId)
          .where('subjectId', offer.subjectId)
      )
      const teachingAssignments = await countOf(
        TeachingAssignment.query({ client: trx })
          .where('academicClassId', offer.academicClassId)
          .where('subjectId', offer.subjectId)
      )
      if (events + teachingAssignments > 0) {
        return { events, teachingAssignments }
      }
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'offer.delete',
          entity: 'class_subject',
          entityId: offer.id,
          meta: { academicClassId: offer.academicClassId, subjectId: offer.subjectId },
        },
        trx
      )
      offer.useTransaction(trx)
      await offer.delete()
      return null
    })

    if (blocked) {
      return conflict(
        response,
        'HAS_DEPENDENTS',
        'Esta oferta tem eventos ou docentes. Só dá para excluir uma oferta sem uso; arquive a oferta em vez de excluir.',
        { counts: blocked }
      )
    }
    return { message: 'Disciplina retirada da turma.' }
  }

  /** POST /classes/:id/subjects/:subjectId/teachers: vincula ou reativa a docente. */
  async assignTeacher({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const found = await this.findOffer(params)
    if (found.error !== undefined) {
      return notFound(response, found.error)
    }
    const { academicClass, offer } = found
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }
    if (offer.archivedAt !== null) {
      return conflict(
        response,
        'OFFER_ARCHIVED',
        'Esta disciplina está arquivada na turma. Oferte de novo antes de vincular docente.'
      )
    }

    const payload = await request.validateUsing(assignTeacherValidator)
    const teacher = await User.find(payload.teacherId)
    if (!teacher || teacher.role !== 'teacher') {
      return fieldError(response, 'teacherId', 'Escolha uma conta de docente.')
    }

    const existing = await TeachingAssignment.query()
      .where('teacherId', teacher.id)
      .where('academicClassId', offer.academicClassId)
      .where('subjectId', offer.subjectId)
      .first()
    if (existing && existing.endedAt === null) {
      return fieldError(
        response,
        'teacherId',
        'Esta docente já está vinculada a esta disciplina na turma.',
        'unique'
      )
    }

    const role = payload.role ?? 'titular'
    const assignment = await db.transaction(async (trx) => {
      if (existing) {
        // Vincular de novo limpa o ended_at da mesma linha.
        existing.useTransaction(trx)
        existing.endedAt = null
        existing.role = role
        await existing.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'teaching.reactivate',
            entity: 'teaching_assignment',
            entityId: existing.id,
            subjectUserId: teacher.id,
            meta: { academicClassId: offer.academicClassId, subjectId: offer.subjectId, role },
          },
          trx
        )
        return existing
      }
      const created = await TeachingAssignment.create(
        {
          teacherId: teacher.id,
          academicClassId: offer.academicClassId,
          subjectId: offer.subjectId,
          role,
        },
        { client: trx }
      )
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'teaching.create',
          entity: 'teaching_assignment',
          entityId: created.id,
          subjectUserId: teacher.id,
          meta: { academicClassId: offer.academicClassId, subjectId: offer.subjectId, role },
        },
        trx
      )
      return created
    })

    await assignment.load('teacher')
    response.status(existing ? 200 : 201)
    return serialize(TeachingAssignmentTransformer.transform(assignment))
  }

  /** PUT /teaching-assignments/:id: troca titular e substituto. */
  async updateAssignment({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const assignment = await TeachingAssignment.query()
      .where('id', routeId(params.id))
      .preload('academicClass')
      .first()
    if (!assignment) {
      return notFound(response, ASSIGNMENT_NOT_FOUND)
    }
    if (assignment.academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }
    if (assignment.endedAt !== null) {
      return conflict(
        response,
        'ENDED',
        'Este vínculo já foi encerrado. Vincule a docente de novo para mudar o tipo.'
      )
    }

    const { role } = await request.validateUsing(updateTeachingAssignmentValidator)
    const before = assignment.role
    await db.transaction(async (trx) => {
      assignment.useTransaction(trx)
      assignment.role = role
      await assignment.save()
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'teaching.update',
          entity: 'teaching_assignment',
          entityId: assignment.id,
          subjectUserId: assignment.teacherId,
          meta: { before: { role: before }, after: { role } },
        },
        trx
      )
    })

    await assignment.load('teacher')
    return serialize(TeachingAssignmentTransformer.transform(assignment))
  }

  /** DELETE /teaching-assignments/:id: preenche ended_at; a autoria dos eventos não muda. */
  async endAssignment({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const assignment = await TeachingAssignment.find(routeId(params.id))
    if (!assignment) {
      return notFound(response, ASSIGNMENT_NOT_FOUND)
    }

    if (assignment.endedAt === null) {
      await db.transaction(async (trx) => {
        assignment.useTransaction(trx)
        assignment.endedAt = DateTime.now()
        await assignment.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'teaching.end',
            entity: 'teaching_assignment',
            entityId: assignment.id,
            subjectUserId: assignment.teacherId,
            meta: {
              academicClassId: assignment.academicClassId,
              subjectId: assignment.subjectId,
            },
          },
          trx
        )
      })
    }

    await assignment.load('teacher')
    return serialize(TeachingAssignmentTransformer.transform(assignment))
  }

  /** A oferta da rota `/classes/:id/subjects/:subjectId`, ou a mensagem do 404. */
  private async findOffer(params: Record<string, unknown>) {
    const academicClass = await AcademicClass.find(routeId(params.id))
    if (!academicClass) {
      return { error: CLASS_NOT_FOUND } as const
    }
    const offer = await ClassSubject.query()
      .where('academicClassId', academicClass.id)
      .where('subjectId', routeId(params.subjectId))
      .first()
    if (!offer) {
      return { error: OFFER_NOT_FOUND } as const
    }
    return { academicClass, offer }
  }
}
