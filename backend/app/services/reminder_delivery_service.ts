import Reminder from '#models/reminder'
import AcademicAccessService from '#services/academic_access_service'
import { DateTime } from 'luxon'

type DeliveryOptions = {
  now?: DateTime
  dryRun?: boolean
}

export default class ReminderDeliveryService {
  static async sendDue(options: DeliveryOptions = {}) {
    const now = options.now ?? DateTime.now()
    const candidates = await Reminder.query()
      .where('enabled', true)
      .whereNull('sentAt')
      .where('sendAt', '<=', now.toSQL({ includeOffset: false })!)
      // Turma arquivada: os eventos continuam visíveis, mas ninguém recebe lembrete deles.
      .whereHas('academicEvent', (eventQuery) => {
        eventQuery.where((scope) => {
          scope.whereNull('academicClassId').orWhereHas('academicClass', (classQuery) => {
            classQuery.whereNull('archivedAt')
          })
        })
      })
      .preload('user')
      .preload('academicEvent')
      .orderBy('sendAt', 'asc')

    // Lembrete do responsável sobre evento de turma só sai enquanto o vínculo com o aluno
    // estiver ativo. Sem vínculo, fica parado (volta a valer se o vínculo for restaurado).
    const dueReminders: Reminder[] = []
    for (const reminder of candidates) {
      if (
        reminder.user?.role === 'guardian' &&
        !(await AcademicAccessService.canViewEvent(reminder.user, reminder.academicEvent))
      ) {
        continue
      }
      dueReminders.push(reminder)
    }

    if (options.dryRun) {
      return {
        sentCount: 0,
        dueCount: dueReminders.length,
        deliveries: dueReminders.map((reminder) => this.serializeDelivery(reminder)),
      }
    }

    for (const reminder of dueReminders) {
      reminder.sentAt = now
      await reminder.save()
    }

    return {
      sentCount: dueReminders.length,
      dueCount: dueReminders.length,
      deliveries: dueReminders.map((reminder) => this.serializeDelivery(reminder)),
    }
  }

  private static serializeDelivery(reminder: Reminder) {
    return {
      reminderId: reminder.id,
      channel: reminder.channel,
      userEmail: reminder.user?.email,
      eventTitle: reminder.academicEvent?.title,
      sendAt: reminder.sendAt.toISO(),
    }
  }
}
