import User from '#models/user'
import AccountPolicyService, { DEMO_ACCOUNTS_OFF } from '#services/account_policy_service'
import { forbidden } from '#services/api_errors'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'
import AttemptLimiterService from '#services/attempt_limiter_service'
import GoogleOAuthService from '#services/google_oauth_service'

/** Senhas erradas aceitas por e-mail e por IP a cada 15 minutos. */
export const MAX_FAILED_LOGINS = 10
export const MAX_FAILED_LOGINS_PER_IP = 100

/** "1 minuto" ou "12 minutos", arredondando para cima. */
function waitText(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`
}

export default class AccessTokensController {
  async store({ request, response, serialize }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    if (AccountPolicyService.isBlocked(email)) {
      return forbidden(response, DEMO_ACCOUNTS_OFF)
    }

    // Senha errada demais trava o e-mail por um tempo (quem chuta senhas para logo). O teto do IP
    // é alto porque uma escola inteira pode sair pelo mesmo IP.
    const keys = [
      { key: `login:email:${email}`, max: MAX_FAILED_LOGINS },
      { key: `login:ip:${request.ip()}`, max: MAX_FAILED_LOGINS_PER_IP },
    ]
    const retryAfter = AttemptLimiterService.retryAfter(keys)
    if (retryAfter > 0) {
      response.header('Retry-After', String(retryAfter))
      return response.tooManyRequests({
        code: 'TOO_MANY_ATTEMPTS',
        message: `Muitas tentativas com a senha errada. Espere ${waitText(retryAfter)} e tente de novo, ou use "Esqueci minha senha".`,
        retryAfter,
      })
    }

    let user: User
    try {
      user = await User.verifyCredentials(email, password)
    } catch (error) {
      AttemptLimiterService.fail(keys)
      throw error
    }
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }

  /**
   * Público: o que a tela de entrar mostra. `demoAccounts`: os atalhos das contas de demonstração.
   * `google`: o botão "Entrar com o Google" (sem as chaves, como na demonstração, ele só daria erro).
   */
  async options() {
    return {
      data: {
        demoAccounts: AccountPolicyService.demoAccountsEnabled(),
        google: GoogleOAuthService.settings() !== null,
      },
    }
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
