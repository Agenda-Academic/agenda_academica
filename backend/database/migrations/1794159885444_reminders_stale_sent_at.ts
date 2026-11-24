import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'

/**
 * Lembrete que já tinha saído e teve a antecedência mudada ficava com o `sent_at` antigo e o `send_at` novo,
 * no futuro: a tela mostrava "Avisado ontem" e "Próximo aviso hoje" para a mesma prova, e o agendador (que só
 * olha lembretes sem `sent_at`) nunca mandava o aviso novo. O controller já limpa o `sent_at` nesse caso; aqui
 * os que ficaram assim voltam a esperar a hora. Um lembrete que de fato saiu tem `sent_at` depois do `send_at`,
 * então "enviado e com o aviso ainda no futuro" só existe nesse estado, e rodar de novo não muda nada.
 */
export default class extends BaseSchema {
  protected tableName = 'reminders'

  async up() {
    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .whereNotNull('sent_at')
        .where('send_at', '>', DateTime.now().toSQL({ includeOffset: false })!)
        .update({ sent_at: null })
    })
  }

  async down() {
    // Sem volta: o `sent_at` apagado era um registro errado.
  }
}
