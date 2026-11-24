import AcademicEvent from '#models/academic_event'
import Reminder from '#models/reminder'
import AcademicAccessService from '#services/academic_access_service'
import { publicTeacher } from '#services/query_helpers'
import { reminderSendAt } from '#services/date_time_service'
import { reminderValidator } from '#validators/academic'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class RemindersController {
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const query = Reminder.query()
      .where('userId', user.id)
      .preload('academicEvent', (eventQuery) => {
        eventQuery
          .preload('subject')
          .preload('teacher', publicTeacher)
          .preload('academicClass', (classQuery) => classQuery.preload('course'))
      })
      .orderBy('sendAt', 'asc')

    // O responsável que perdeu o vínculo deixa de ver os lembretes sobre a agenda do aluno.
    if (AcademicAccessService.isGuardian(user)) {
      const classIds = (await AcademicAccessService.visibleClassIdsFor(user)) ?? []
      query.whereHas('academicEvent', (eventQuery) => {
        AcademicAccessService.scopeVisibleEvents(eventQuery, classIds)
      })
    }

    const reminders = await query
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
      // O responsável cria lembretes só sobre eventos do aluno vinculado; fora disso, 404.
      if (AcademicAccessService.isGuardian(user)) {
        return response.notFound({ message: 'Evento nao encontrado.' })
      }
      return response.forbidden({ message: 'Voce nao pode criar lembrete para este evento.' })
    }

    const offsetMinutes = payload.offsetMinutes ?? user.defaultReminderMinutes
    const channel = payload.channel ?? user.notificationChannel
    const sendAt = reminderSendAt(event.startsAt, offsetMinutes)
    // Um lembrete por usuario+evento: trocar o canal atualiza o registro
    // existente em vez de criar um segundo lembrete.
    // Se o aviso antigo já tinha saído (sentAt) e o novo cai no futuro (a pessoa mudou a antecedência),
    // o lembrete volta a esperar a hora. O agendador só olha lembretes sem sentAt: sem isto o aviso novo
    // nunca sairia e a tela mostraria "Avisado ontem" e "Próximo aviso hoje" para a mesma prova.
    const reminder = await Reminder.updateOrCreate(
      {
        userId: user.id,
        academicEventId: event.id,
      },
      {
        channel,
        offsetMinutes,
        sendAt,
        enabled: payload.enabled ?? true,
        ...(sendAt > DateTime.now() ? { sentAt: null } : {}),
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
