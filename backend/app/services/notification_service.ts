import Notification, { type NotificationKind } from '#models/notification'
import User from '#models/user'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export type NotificationInput = {
  kind: NotificationKind
  title: string
  body?: string | null
  /** Endereço da tela no front, por exemplo `?tela=perfil`. */
  link?: string | null
}

/** Avisos no sistema, gravados na mesma transação da ação que os gera. */
export default class NotificationService {
  static async notify(userId: number, input: NotificationInput, trx?: TransactionClientContract) {
    return Notification.create(
      {
        userId,
        kind: input.kind,
        title: input.title.slice(0, 160),
        body: input.body ?? null,
        link: input.link ?? null,
      },
      { client: trx }
    )
  }

  /** O mesmo aviso para cada conta da administração (por exemplo, vínculo pendente). */
  static async notifyAdmins(input: NotificationInput, trx?: TransactionClientContract) {
    const admins = await User.query({ client: trx }).where('role', 'admin').select('id')
    for (const admin of admins) {
      await this.notify(admin.id, input, trx)
    }
  }
}
