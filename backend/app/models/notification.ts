import { NotificationSchema } from '#database/schema'
import User from '#models/user'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * Tipos de aviso. `guardian_review` é o aviso ao aluno que deixou de ser menor, para
 * confirmar ou encerrar cada vínculo.
 */
export const NOTIFICATION_KINDS = [
  'guardian_linked',
  'guardian_unlinked',
  'guardian_pending',
  'guardian_review',
  'grades_published',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** Aviso no sistema. Cada pessoa vê só os próprios. */
export default class Notification extends NotificationSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
