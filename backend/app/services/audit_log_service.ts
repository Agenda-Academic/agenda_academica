import AuditLog from '#models/audit_log'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export type AuditEntry = {
  actorId: number | null
  /** Por exemplo `class.archive`, `enrollment.approve` ou `teaching.end`. */
  action: string
  entity: string
  entityId: number | null
  /** De quem são os dados, quando a ação mexe com uma pessoa (o aluno da matrícula). */
  subjectUserId?: number | null
  /** Só ids e valores de antes e depois: nunca nome, e-mail ou nota. */
  meta?: Record<string, unknown>
}

/** Grava o registro de ações na mesma transação da ação. Não guarda IP. */
export default class AuditLogService {
  static async record(entry: AuditEntry, trx?: TransactionClientContract) {
    await AuditLog.create(
      {
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        subjectUserId: entry.subjectUserId ?? null,
        meta: entry.meta ? JSON.stringify(entry.meta) : null,
      },
      { client: trx }
    )
  }
}
