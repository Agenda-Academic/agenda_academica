import AcademicClass from '#models/academic_class'
import Course from '#models/course'
import AcademicAccessService from '#services/academic_access_service'
import { conflict, fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AuditLogService from '#services/audit_log_service'
import { countOf } from '#services/query_helpers'
import CourseTransformer, { type CourseStats } from '#transformers/course_transformer'
import { createCourseValidator, updateCourseValidator } from '#validators/management'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const ONLY_ADMIN = 'Só a administração cuida dos cursos.'
const NOT_FOUND = 'Curso não encontrado.'

/** Cursos: só a administração cria, edita, arquiva, restaura e exclui. */
export default class CoursesController {
  async index({ auth, request, response, serialize }: HttpContext) {
    if (!AcademicAccessService.allow(auth.getUserOrFail(), ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const query = Course.query().orderBy('name')
    if (isTruthy(request.input('archived'))) {
      query.whereNotNull('archivedAt')
    } else {
      query.whereNull('archivedAt')
    }

    const courses = await query
    return serialize(CourseTransformer.transform(courses, await courseStats(courses)))
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const payload = await request.validateUsing(createCourseValidator)
    const duplicate = await findByCode(payload.code)
    if (duplicate) {
      return duplicateResponse(response, duplicate)
    }

    const course = await db.transaction(async (trx) => {
      const created = await Course.create(
        {
          name: payload.name,
          code: payload.code,
          modality: payload.modality ?? 'superior',
          campus: payload.campus ?? 'Três Lagoas',
          active: true,
        },
        { client: trx }
      )
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'course.create',
          entity: 'course',
          entityId: created.id,
          meta: { code: created.code, modality: created.modality },
        },
        trx
      )
      return created
    })

    await course.refresh()
    response.status(201)
    return serialize(CourseTransformer.transform(course, await courseStats([course])))
  }

  async update({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const course = await Course.find(routeId(params.id))
    if (!course) {
      return notFound(response, NOT_FOUND)
    }
    if (course.isArchived) {
      return conflict(
        response,
        'ARCHIVED',
        'Este curso está arquivado. Restaure o curso para editar.'
      )
    }

    const payload = await request.validateUsing(updateCourseValidator)
    if (payload.code && payload.code !== course.code) {
      const duplicate = await findByCode(payload.code, course.id)
      if (duplicate) {
        return duplicateResponse(response, duplicate)
      }
    }

    const before = { name: course.name, code: course.code, modality: course.modality }
    await db.transaction(async (trx) => {
      course.useTransaction(trx)
      course.merge(payload)
      await course.save()
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'course.update',
          entity: 'course',
          entityId: course.id,
          meta: {
            before,
            after: { name: course.name, code: course.code, modality: course.modality },
          },
        },
        trx
      )
    })

    return serialize(CourseTransformer.transform(course, await courseStats([course])))
  }

  async archive({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const course = await Course.find(routeId(params.id))
    if (!course) {
      return notFound(response, NOT_FOUND)
    }

    if (!course.isArchived) {
      // Conferência e arquivamento na mesma transação.
      const activeClasses = await db.transaction(async (trx) => {
        const total = await countClasses(course.id, true, trx)
        if (total === 0) {
          await setArchived(course, true, user.id, trx)
        }
        return total
      })
      if (activeClasses > 0) {
        return conflict(
          response,
          'HAS_DEPENDENTS',
          `Este curso tem ${plural(activeClasses, 'turma ativa', 'turmas ativas')}. Arquive as turmas antes de arquivar o curso.`,
          { counts: { activeClasses } }
        )
      }
    }

    return serialize(CourseTransformer.transform(course, await courseStats([course])))
  }

  async restore({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const course = await Course.find(routeId(params.id))
    if (!course) {
      return notFound(response, NOT_FOUND)
    }

    if (course.isArchived) {
      await db.transaction((trx) => setArchived(course, false, user.id, trx))
    }

    return serialize(CourseTransformer.transform(course, await courseStats([course])))
  }

  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const course = await Course.find(routeId(params.id))
    if (!course) {
      return notFound(response, NOT_FOUND)
    }

    // A contagem roda na mesma transação do DELETE: a FK das turmas ainda é CASCADE.
    const classes = await db.transaction(async (trx) => {
      const total = await countClasses(course.id, false, trx)
      if (total > 0) {
        return total
      }
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'course.delete',
          entity: 'course',
          entityId: course.id,
          meta: { code: course.code },
        },
        trx
      )
      course.useTransaction(trx)
      await course.delete()
      return 0
    })

    if (classes > 0) {
      return conflict(
        response,
        'HAS_DEPENDENTS',
        `Este curso tem ${plural(classes, 'turma', 'turmas')}. Só dá para excluir um curso sem turmas; arquive o curso em vez de excluir.`,
        { counts: { classes } }
      )
    }
    return { message: 'Curso excluído.' }
  }
}

function isTruthy(value: unknown) {
  return ['1', 'true', 'yes', 'sim'].includes(String(value ?? '').toLowerCase())
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

async function findByCode(code: string, exceptId?: number) {
  const query = Course.query().whereRaw('upper(code) = ?', [code.toUpperCase()])
  if (exceptId) {
    query.whereNot('id', exceptId)
  }
  return query.first()
}

function duplicateResponse(response: HttpContext['response'], duplicate: Course) {
  if (duplicate.isArchived) {
    return conflict(
      response,
      'ARCHIVED_DUPLICATE',
      `Já existe o curso ${duplicate.code}, arquivado. Restaure o curso para usar de novo.`,
      { archivedId: duplicate.id }
    )
  }
  return fieldError(
    response,
    'code',
    `Já existe um curso com o código ${duplicate.code}. Escolha outro código.`,
    'unique'
  )
}

async function countClasses(courseId: number, onlyActive: boolean, trx: TransactionClientContract) {
  const query = AcademicClass.query({ client: trx }).where('courseId', courseId)
  if (onlyActive) {
    query.whereNull('archivedAt')
  }
  return countOf(query)
}

async function courseStats(courses: Course[]) {
  const stats = new Map<number, CourseStats>()
  if (!courses.length) {
    return stats
  }
  const classes = await AcademicClass.query()
    .whereIn(
      'courseId',
      courses.map((course) => course.id)
    )
    .select('courseId', 'archivedAt')
  for (const course of courses) {
    const own = classes.filter((item) => item.courseId === course.id)
    stats.set(course.id, {
      classes: own.length,
      activeClasses: own.filter((item) => item.archivedAt === null).length,
    })
  }
  return stats
}

/** O serviço muda `active` e `archived_at` sempre juntos. */
async function setArchived(
  course: Course,
  archived: boolean,
  actorId: number,
  trx: TransactionClientContract
) {
  course.useTransaction(trx)
  course.archivedAt = archived ? DateTime.now() : null
  course.active = !archived
  await course.save()
  await AuditLogService.record(
    {
      actorId,
      action: archived ? 'course.archive' : 'course.restore',
      entity: 'course',
      entityId: course.id,
    },
    trx
  )
}
