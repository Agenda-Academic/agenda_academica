import User from '#models/user'
import AccountPolicyService, { DEMO_ACCOUNTS_OFF } from '#services/account_policy_service'
import { forbidden } from '#services/api_errors'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'

export default class AccessTokensController {
  async store({ request, response, serialize }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    if (AccountPolicyService.isBlocked(email)) {
      return forbidden(response, DEMO_ACCOUNTS_OFF)
    }

    const user = await User.verifyCredentials(email, password)
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }

  /** Público: o que a tela de entrar mostra (os atalhos das contas de demonstração). */
  async options() {
    return { data: { demoAccounts: AccountPolicyService.demoAccountsEnabled() } }
  }

  async destroy({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.currentAccessToken) {
      await User.accessTokens.delete(user, user.currentAccessToken.identifier)
    }

    return {
      message: 'Logged out successfully',
    }
  }
}
