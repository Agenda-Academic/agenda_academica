import AccountPolicyService, { DEMO_ACCOUNTS_OFF } from '#services/account_policy_service'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards)
    // contas de demonstração desligadas: a sessão que já estava aberta deixa de valer
    const user = ctx.auth.user as { email: string } | undefined
    if (user && AccountPolicyService.isBlocked(user.email)) {
      return ctx.response.unauthorized({ message: DEMO_ACCOUNTS_OFF })
    }
    return next()
  }
}
