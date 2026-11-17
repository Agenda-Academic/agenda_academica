import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'

export const INTERNAL_ERROR = 'Algo deu errado no servidor. Tente de novo em instantes.'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    // Erro inesperado (do banco, por exemplo) não devolve a mensagem original: ela pode trazer o
    // SQL inteiro, com dados de outras pessoas. O detalhe fica só no log (report).
    const status = (error as { status?: unknown } | null)?.status
    if (typeof status !== 'number' || status >= 500) {
      return ctx.response.status(500).send({ message: INTERNAL_ERROR })
    }
    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
