import Notification from '#models/notification'
import AcademicAccessService from '#services/academic_access_service'
import { forbidden, notFound, routeId } from '#services/api_errors'
import { countOf } from '#services/query_helpers'
import NotificationTransformer from '#transformers/notification_transformer'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

/** Quantos avisos a lista devolve, dos mais novos para os mais antigos. */
const LIST_LIMIT = 50

/** Avisos no sistema: cada pessoa vê e marca como lidos só os próprios. */
export default class NotificationsController {
  /** GET /notifications?unread=1: os avisos mais novos e o total de não lidos. */
  async index({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.isKnownRole(user)) {
      return forbidden(response, 'Seu perfil não tem acesso aos avisos.')
    }

    const query = Notification.query()
      .where('userId', user.id)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(LIST_LIMIT)
    if (['1', 'true'].includes(String(request.input('unread', '')))) {
      query.whereNull('readAt')
    }

    const notifications = await query
    const unreadCount = await countOf(
      Notification.query().where('userId', user.id).whereNull('readAt')
    )
    return serialize({
      notifications: NotificationTransformer.transform(notifications),
      unreadCount,
    })
  }

  /** POST /notifications/:id/read: aviso de outra pessoa é 404. */
  async read({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.isKnownRole(user)) {
      return forbidden(response, 'Seu perfil não tem acesso aos avisos.')
    }

    const notification = await Notification.query()
      .where('id', routeId(params.id))
      .where('userId', user.id)
      .first()
    if (!notification) {
      return notFound(response, 'Aviso não encontrado.')
    }
    if (!notification.readAt) {
      notification.readAt = DateTime.now()
      await notification.save()
    }
    return serialize(NotificationTransformer.transform(notification))
  }

  /** POST /notifications/read-all: marca todos os avisos da pessoa como lidos. */
  async readAll({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.isKnownRole(user)) {
      return forbidden(response, 'Seu perfil não tem acesso aos avisos.')
    }

    const unread = await Notification.query().where('userId', user.id).whereNull('readAt')
    const now = DateTime.now()
    for (const notification of unread) {
      notification.readAt = now
      await notification.save()
    }
    return { data: { updated: unread.length } }
  }
}
