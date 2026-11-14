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
    // Serviço carregado aqui: o Ace lê os arquivos de comando antes de a aplicação subir, e
    // carregar os modelos cedo deixa o de usuário sem o serviço de senha (quebra o db:seed-if-empty)
    const { default: ReminderDeliveryService } = await import('#services/reminder_delivery_service')
    const result = await ReminderDeliveryService.sendDue({ dryRun: this.dryRun })
    this.logger.info(
      `${this.dryRun ? 'Found' : 'Sent'} ${this.dryRun ? result.dueCount : result.sentCount} due reminders`
    )

    for (const delivery of result.deliveries) {
      const outcome = delivery.outcome ? ` (${delivery.outcome})` : ''
      this.logger.info(
        `${delivery.channel}: ${delivery.userEmail} -> ${delivery.eventTitle}${outcome}`
      )
    }
  }
}
