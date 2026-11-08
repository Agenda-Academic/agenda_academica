import { GuardianLinkSchema } from '#database/schema'
import User from '#models/user'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export const GUARDIAN_RELATIONSHIPS = ['mae', 'pai', 'responsavel_legal', 'outro'] as const
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number]

export const GUARDIAN_LINK_STATUSES = ['pending', 'active', 'revoked', 'blocked'] as const
export type GuardianLinkStatus = (typeof GUARDIAN_LINK_STATUSES)[number]

/** student_code: código do aluno; admin_code: código da secretaria; admin: vínculo por e-mail. */
export type GuardianLinkOrigin = 'student_code' | 'admin_code' | 'admin'

/** Vínculos que contam no limite por aluno e aparecem nas listas. */
export const OPEN_LINK_STATUSES = ['active', 'pending'] as const

/**
 * Vínculo entre responsável e aluno. A permissão de ver dados de um aluno vem sempre daqui
 * (status `active`), nunca só do papel `guardian`.
 */
export default class GuardianLink extends GuardianLinkSchema {
  // O SQLite devolve 0 ou 1; a API responde true ou false.
  @column({ consume: (value) => Boolean(value) })
  declare shareGrades: boolean

  @column({ consume: (value) => Boolean(value) })
  declare needsReview: boolean

  get isOpen() {
    return (OPEN_LINK_STATUSES as readonly string[]).includes(this.status)
  }

  @belongsTo(() => User, { foreignKey: 'guardianId' })
  declare guardian: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'studentId' })
  declare student: BelongsTo<typeof User>
}
