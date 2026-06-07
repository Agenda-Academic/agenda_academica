import ReminderDeliveryService from '#services/reminder_delivery_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

export default class SendDueReminders extends BaseCommand {
  static commandName = 'reminders:send-due'
  static description = 'Send due academic reminders and mark them as delivered'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.boolean({ description: 'List due reminders without marking them as sent' })
  declare dryRun: boolean

  async run() {
    const result = await ReminderDeliveryService.sendDue({ dryRun: this.dryRun })
    this.logger.info(
      `${this.dryRun ? 'Found' : 'Sent'} ${this.dryRun ? result.dueCount : result.sentCount} due reminders`
    )

    for (const delivery of result.deliveries) {
      this.logger.info(`${delivery.channel}: ${delivery.userEmail} -> ${delivery.eventTitle}`)
    }
  }
}
