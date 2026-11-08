import type GuardianLinkCode from '#models/guardian_link_code'
import type User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Código válido nas listas: só o prazo, nunca o código nem o hash. Na lista do aluno
 * (`viewer` informado) vem também `canCancel`: o aluno menor não cancela o código da
 * secretaria.
 */
export default class GuardianCodeTransformer extends BaseTransformer<GuardianLinkCode> {
  constructor(
    resource: GuardianLinkCode,
    protected viewer: User | null = null
  ) {
    super(resource)
  }

  toObject() {
    const base = this.pick(this.resource, ['id', 'kind', 'expiresAt', 'createdAt'])
    if (!this.viewer) {
      return base
    }
    return {
      ...base,
      canCancel: AcademicAccessService.canCancelGuardianCode(this.viewer, this.resource),
    }
  }
}
