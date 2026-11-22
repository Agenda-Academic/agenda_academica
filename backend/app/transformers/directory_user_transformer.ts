import type User from '#models/user'
import AccountPolicyService from '#services/account_policy_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Pessoa na busca da administração (GET /users e PATCH /users/:id/role): id, nome, e-mail, papel e
 * duas marcas para o card Coordenação da tela Turmas:
 * - `isRoot`: coordenação principal, com o e-mail em ADMIN_EMAILS (a tela não remove);
 * - `isSelf`: é quem está logado (ninguém tira o próprio acesso).
 */
export default class DirectoryUserTransformer extends BaseTransformer<User> {
  constructor(
    resource: User,
    /** Id de quem pediu a lista. */
    protected viewerId: number | null = null
  ) {
    super(resource)
  }

  toObject() {
    const user = this.resource
    return {
      ...this.pick(user, ['id', 'fullName', 'email', 'role']),
      isRoot: AccountPolicyService.isRootAdmin(user),
      isSelf: this.viewerId !== null && user.id === this.viewerId,
    }
  }
}
