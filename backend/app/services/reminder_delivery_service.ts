import Reminder from '#models/reminder'
import AcademicAccessService from '#services/academic_access_service'
import MailService from '#services/mail_service'
import { buildReminderEmail } from '#services/reminder_email'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

type DeliveryOptions = {
  now?: DateTime
  dryRun?: boolean
}

/**
 * Como cada lembrete vencido terminou:
 * - `email`: o e-mail saiu.
 * - `system`: só o aviso no sistema (envio sem configuração ou endereço de teste).
 * - `late`: o evento já começou (a API estava parada), então não manda e-mail atrasado.
 * - `failed`: o envio falhou de vez (endereço recusado).
 * - `retry`: falhou agora e fica para a próxima rodada.
 */
type DeliveryOutcome = 'email' | 'system' | 'late' | 'failed' | 'retry'

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
      .preload('academicEvent', (eventQuery) => eventQuery.preload('subject'))
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
        emailedCount: 0,
        dueCount: dueReminders.length,
        deliveries: dueReminders.map((reminder) => this.serializeDelivery(reminder, null)),
      }
    }

    const deliveries = []
    let sentCount = 0
    let emailedCount = 0
    for (const reminder of dueReminders) {
      const outcome = await this.deliver(reminder, now)
      if (outcome !== 'retry') {
        reminder.sentAt = now
        await reminder.save()
        sentCount += 1
      }
      if (outcome === 'email') {
        emailedCount += 1
      }
      deliveries.push(this.serializeDelivery(reminder, outcome))
    }

    return {
      sentCount,
      emailedCount,
      dueCount: dueReminders.length,
      deliveries,
    }
  }

  private static async deliver(reminder: Reminder, now: DateTime): Promise<DeliveryOutcome> {
    const event = reminder.academicEvent
    if (event.startsAt <= now) {
      return 'late'
    }

    const result = await MailService.send(buildReminderEmail(reminder.user, event, now))
    switch (result.status) {
      case 'sent':
        return 'email'
      case 'skipped':
      case 'disabled':
        return 'system'
      case 'failed':
        logger.warn(
          { reminderId: reminder.id, reason: result.reason, retry: result.retry },
          'lembrete: e-mail não saiu'
        )
        return result.retry ? 'retry' : 'failed'
    }
  }

  private static serializeDelivery(reminder: Reminder, outcome: DeliveryOutcome | null) {
    return {
      reminderId: reminder.id,
      channel: reminder.channel,
      outcome,
      userEmail: reminder.user?.email,
      eventTitle: reminder.academicEvent?.title,
      sendAt: reminder.sendAt.toISO(),
    }
  }
}
