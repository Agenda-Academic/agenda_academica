import Reminder from '#models/reminder'
import { DateTime } from 'luxon'

type DeliveryOptions = {
  now?: DateTime
  dryRun?: boolean
}

export default class ReminderDeliveryService {
  static async sendDue(options: DeliveryOptions = {}) {
    const now = options.now ?? DateTime.now()
    const dueReminders = await Reminder.query()
      .where('enabled', true)
      .whereNull('sentAt')
      .where('sendAt', '<=', now.toSQL({ includeOffset: false })!)
      .preload('user')
      .preload('academicEvent')
      .orderBy('sendAt', 'asc')

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
