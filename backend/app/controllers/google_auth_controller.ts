import User from '#models/user'
import { fieldError } from '#services/api_errors'
import GoogleOAuthService, {
  GOOGLE_COOKIE_PATH,
  GOOGLE_STATE_COOKIE,
  type GoogleErrorReason,
} from '#services/google_oauth_service'
import UserTransformer from '#transformers/user_transformer'
import { googleExchangeValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'

type Response = HttpContext['response']

/** Uma mensagem só para código inválido, vencido ou já usado. */
export const GOOGLE_CODE_INVALID =
  'Não foi possível concluir a entrada com o Google. Clique em Entrar com o Google de novo.'

const stateCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: app.inProduction,
  path: GOOGLE_COOKIE_PATH,
}

/**
 * Redireciona sem levar a query string do pedido: o `config/app.ts` repassa a query por padrão,
 * e na volta do Google ela traz o code e o state, que não podem ir para o front.
 */
function redirectTo(response: Response, url: string) {
  return response.redirect().withQs(false).toPath(url)
}

function backToFront(response: Response, reason: GoogleErrorReason) {
  return redirectTo(response, GoogleOAuthService.frontendUrl({ google_erro: reason }))
}

export default class GoogleAuthController {
  /** Ida ao Google: state e code_verifier ficam num cookie criptografado por 10 minutos. */
  async redirect({ response }: HttpContext) {
    const settings = GoogleOAuthService.settings()
    if (!settings) {
      return backToFront(response, 'nao_configurado')
    }
    const { url, payload } = GoogleOAuthService.authorization(settings)
    response.encryptedCookie(GOOGLE_STATE_COOKIE, payload, { ...stateCookieOptions, maxAge: '10m' })
    return redirectTo(response, url)
  }

  /** Volta do Google com `?code&state` (ou `?error=access_denied` quando a pessoa cancela). */
  async callback({ request, response }: HttpContext) {
    const stored = request.encryptedCookie(GOOGLE_STATE_COOKIE)
    // o state vale uma vez só, deu certo ou não
    response.clearCookie(GOOGLE_STATE_COOKIE, stateCookieOptions)

    const { code, state, error } = request.qs()
    if (error) {
      return backToFront(response, 'cancelado')
    }
    const checked = GoogleOAuthService.checkState(stored, state)
    if (!checked) {
      return backToFront(response, 'estado')
    }
    const settings = GoogleOAuthService.settings()
    if (!settings) {
      return backToFront(response, 'nao_configurado')
    }
    if (typeof code !== 'string' || !code) {
      return backToFront(response, 'falhou')
    }

    const result = await GoogleOAuthService.completeLogin(code, checked.codeVerifier, settings)
    if (!result.ok) {
      return backToFront(response, result.reason)
    }
    // só o código de uso único vai no endereço; o token de acesso sai no exchange
    return redirectTo(response, GoogleOAuthService.frontendUrl({ google: result.loginCode }))
  }

  /** Troca o código de uso único pelo token de acesso, no mesmo formato do login por senha. */
  async exchange({ request, response, serialize }: HttpContext) {
    const { code } = await request.validateUsing(googleExchangeValidator)
    const userId = GoogleOAuthService.consumeLoginCode(code)
    const user = userId ? await User.find(userId) : null
    if (!user) {
      return fieldError(response, 'code', GOOGLE_CODE_INVALID)
    }
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }
}
