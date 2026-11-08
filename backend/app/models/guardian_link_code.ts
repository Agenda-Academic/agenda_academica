import { GuardianLinkCodeSchema } from '#database/schema'
import User from '#models/user'
import { belongsTo, column, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

export type GuardianCodeKind = 'student' | 'admin'

/** Código de uso único para o responsável se vincular. Só o HMAC fica no banco. */
export default class GuardianLinkCode extends GuardianLinkCodeSchema {
  // O hash nunca sai em resposta nenhuma.
  @column({ serializeAs: null })
  declare codeHash: string

  /** Códigos que ainda valem: sem uso, sem cancelamento e dentro do prazo. */
  static valid = scope((query) => {
    query
      .whereNull('usedAt')
      .whereNull('revokedAt')
      // Mesmo formato em que o Lucid grava datas no SQLite.
      .where('expiresAt', '>', DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'))
  })

  get isValid() {
    return this.usedAt === null && this.revokedAt === null && this.expiresAt > DateTime.now()
  }

  @belongsTo(() => User, { foreignKey: 'studentId' })
  declare student: BelongsTo<typeof User>
}
