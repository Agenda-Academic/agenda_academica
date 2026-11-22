import type User from '#models/user'
import AccountPolicyService from '#services/account_policy_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * A conta de quem está logado (login, Google, cadastro, perfil e /context). `canManageCoordination` só é
 * verdadeiro para a administração principal (ADMIN_EMAILS): a tela Turmas mostra o card Coordenação só para ela.
 * A lista ADMIN_EMAILS não sai daqui.
 */
export default class UserTransformer extends BaseTransformer<User> {
  toObject() {
    return {
      ...this.pick(this.resource, [
        'id',
        'fullName',
        'email',
        'role',
        'registration',
        'defaultReminderMinutes',
        'notificationChannel',
        'createdAt',
        'updatedAt',
        'initials',
        'isMinor',
      ]),
      canManageCoordination: AccountPolicyService.isRootAdmin(this.resource),
    }
  }
}
