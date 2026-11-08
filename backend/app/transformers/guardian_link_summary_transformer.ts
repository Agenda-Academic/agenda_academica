import type GuardianLink from '#models/guardian_link'
import { UNDO_MINUTES } from '#services/guardian_link_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Resumo do vínculo nas respostas das ações (desfazer, restaurar, aprovar, bloquear).
 * `undoUntil` é até quando o Desfazer do toast funciona, só no vínculo desfeito; `message`
 * é o texto do toast, quando a ação mudou algo.
 */
export default class GuardianLinkSummaryTransformer extends BaseTransformer<GuardianLink> {
  constructor(
    resource: GuardianLink,
    protected message: string | null = null
  ) {
    super(resource)
  }

  toObject() {
    const link = this.resource
    return {
      id: link.id,
      guardianId: link.guardianId,
      studentId: link.studentId,
      relationship: link.relationship,
      status: link.status,
      origin: link.origin,
      approvedAt: link.approvedAt,
      revokedAt: link.revokedAt,
      undoUntil:
        link.status === 'revoked' && link.revokedAt
          ? link.revokedAt.plus({ minutes: UNDO_MINUTES })
          : null,
      ...(this.message ? { message: this.message } : {}),
    }
  }
}
