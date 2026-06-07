import AcademicEvent from '#models/academic_event'
import Reminder from '#models/reminder'
import type User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import { parseIsoDateTime } from '#services/date_time_service'
import { createAcademicEventValidator, updateAcademicEventValidator } from '#validators/academic'
import type { HttpContext } from '@adonisjs/core/http'
import type { DateTime } from 'luxon'

export default class AcademicEventsController {
  async index({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const query = AcademicEvent.query()
      .preload('subject')
      .preload('teacher')
      .preload('academicClass', (classQuery) => classQuery.preload('course'))
      .orderBy('startsAt', 'asc')

    await this.applyVisibility(query, user)

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

  async show({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const event = await this.findWithRelations(Number(params.id))

    if (!event) {
      return response.notFound({ message: 'Evento nao encontrado.' })
    }

    if (!(await AcademicAccessService.canViewEvent(user, event))) {
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

    if (user.role === 'student') {
      return response.forbidden({ message: 'Alunos nao podem criar eventos academicos.' })
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
    const targetClassId =
      payload.academicClassId === undefined ? event.academicClassId : payload.academicClassId
    const targetSubjectId = payload.subjectId === undefined ? event.subjectId : payload.subjectId

    if (!(await AcademicAccessService.teacherCanManage(user, targetClassId, targetSubjectId))) {
      return response.forbidden({
        message: 'Professor so pode mover eventos para turmas que ministra.',
      })
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
    await event.save()

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

    await event.delete()
    return { message: 'Evento removido com sucesso.' }
  }

  private async findWithRelations(id: number) {
    return AcademicEvent.query()
      .where('id', id)
      .preload('subject')
      .preload('teacher')
      .preload('academicClass', (classQuery) => classQuery.preload('course'))
      .first()
  }

  private async applyVisibility(query: ReturnType<typeof AcademicEvent.query>, user: User) {
    const visibleClassIds = await AcademicAccessService.visibleClassIdsFor(user)
    if (visibleClassIds === null) {
      return
    }

    query.where((scope) => {
      scope.whereIn('source', ['official', 'imported']).orWhere('officialPriority', true)
      if (visibleClassIds.length) {
        scope.orWhereIn('academicClassId', visibleClassIds)
      }
    })
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
