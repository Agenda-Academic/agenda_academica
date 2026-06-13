import AcademicEvent from '#models/academic_event'
import Reminder from '#models/reminder'
import AcademicAccessService from '#services/academic_access_service'
import { reminderSendAt } from '#services/date_time_service'
import { reminderValidator } from '#validators/academic'
import type { HttpContext } from '@adonisjs/core/http'

export default class RemindersController {
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const reminders = await Reminder.query()
      .where('userId', user.id)
      .preload('academicEvent', (eventQuery) => {
        eventQuery
          .preload('subject')
          .preload('teacher')
          .preload('academicClass', (classQuery) => classQuery.preload('course'))
      })
      .orderBy('sendAt', 'asc')

    return { data: reminders.map((reminder) => reminder.serialize()) }
  }

  async store({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = await request.validateUsing(reminderValidator)
    const event = await AcademicEvent.find(payload.academicEventId)

    if (!event) {
      return response.notFound({ message: 'Evento nao encontrado.' })
    }

    if (!(await AcademicAccessService.canViewEvent(user, event))) {
      return response.forbidden({ message: 'Voce nao pode criar lembrete para este evento.' })
    }

    const offsetMinutes = payload.offsetMinutes ?? user.defaultReminderMinutes
    const channel = payload.channel ?? user.notificationChannel
    // Um lembrete por usuario+evento: trocar o canal atualiza o registro
    // existente em vez de criar um segundo lembrete.
    const reminder = await Reminder.updateOrCreate(
      {
        userId: user.id,
        academicEventId: event.id,
      },
      {
        channel,
        offsetMinutes,
        sendAt: reminderSendAt(event.startsAt, offsetMinutes),
        enabled: payload.enabled ?? true,
      }
    )

    await reminder.load('academicEvent')
    return response.created({ data: reminder.serialize() })
  }

  async destroy({ auth, params, response }: HttpContext) {
    const reminder = await Reminder.query()
      .where('id', Number(params.id))
      .where('userId', auth.getUserOrFail().id)
      .first()

    if (!reminder) {
      return response.notFound({ message: 'Lembrete nao encontrado.' })
    }

    await reminder.delete()
    return { message: 'Lembrete removido com sucesso.' }
  }
}
