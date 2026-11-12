import User from '#models/user'
import PasswordResetService, { RESET_TTL_MINUTES } from '#services/password_reset_service'
import UserTransformer from '#transformers/user_transformer'
import { forgotPasswordValidator, resetPasswordValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export const RESET_REQUEST_MESSAGE = `Se existir uma conta com esse e-mail, enviamos um link para criar uma senha nova. Ele vale por ${RESET_TTL_MINUTES / 60} hora.`
export const RESET_TOKEN_INVALID =
  'Este link não vale mais: ele já foi usado ou passou de 1 hora. Peça outro em Esqueci minha senha.'

export default class PasswordResetsController {
  /** Pede o link. A resposta é a mesma com ou sem conta. */
  async request({ request, response }: HttpContext) {
    const { email } = await request.validateUsing(forgotPasswordValidator)

    const retryAfter = PasswordResetService.throttle(email.trim().toLowerCase(), request.ip())
    if (retryAfter > 0) {
      response.header('Retry-After', String(retryAfter))
      return response.tooManyRequests({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Muitos pedidos de link. Espere alguns minutos e tente de novo.',
        retryAfter,
      })
    }

    await PasswordResetService.request(email)
    return { message: RESET_REQUEST_MESSAGE }
  }

  /** Troca a senha pelo link e já entra, no mesmo formato do login por senha. */
  async reset({ request, response, serialize }: HttpContext) {
    const { token, password } = await request.validateUsing(resetPasswordValidator)
    const user = await PasswordResetService.reset(token, password)
    if (!user) {
      return response.unprocessableEntity({
        errors: [{ field: 'token', rule: 'invalid', message: RESET_TOKEN_INVALID }],
      })
    }

    const accessToken = await User.accessTokens.create(user)
    return serialize({
      user: UserTransformer.transform(user),
      token: accessToken.value!.release(),
    })
  }
}
