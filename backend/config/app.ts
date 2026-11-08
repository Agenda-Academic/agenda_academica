import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/core/http'

/**
 * The app URL can be used in various places where you want to create absolute
 * URLs to your application. For example, when sending emails, images should
 * use absolute URLs.
 */
export const appUrl = env.get('APP_URL')

/**
 * Endereços de proxy em que a API confia para ler o X-Forwarded-For: loopback, link-local e
 * redes privadas (10/8, 172.16/12, 192.168/16, fc00::/7), os mesmos de `loopback`,
 * `linklocal` e `uniquelocal` do proxy-addr.
 *
 * No Render o pedido chega pelo proxy da plataforma, que conecta de um endereço da rede
 * interna. Sem confiar nele, `request.ip()` devolve o IP do proxy para todo mundo, e o
 * limite de tentativas por IP vira um limite único para o sistema inteiro. Lendo o
 * cabeçalho da direita para a esquerda e parando no primeiro endereço público, o IP vem
 * de quem acessou, e um X-Forwarded-For inventado pelo cliente não passa na frente.
 */
function isTrustedProxy(address: string) {
  const ip = address.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')
  const v4 = ip.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (v4) {
    const [first, second] = [Number(v4[1]), Number(v4[2])]
    return (
      first === 127 ||
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    )
  }
  return ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip)
}

/**
 * The configuration settings used by the HTTP server
 */
export const http = defineConfig({
  /**
   * Proxies confiáveis para `request.ip()`; ver `isTrustedProxy` acima.
   */
  trustProxy: (address) => isTrustedProxy(address),

  /**
   * Generate a unique request id for each incoming request.
   * Useful to correlate logs and debug a request flow.
   */
  generateRequestId: true,

  /**
   * Allow HTTP method spoofing via the "_method" form/query parameter.
   * This lets HTML forms target PUT/PATCH/DELETE routes while still
   * submitting with POST.
   */
  allowMethodSpoofing: false,

  /**
   * Enabling async local storage will let you access HTTP context
   * from anywhere inside your application.
   */
  useAsyncLocalStorage: false,

  /**
   * Redirect configuration controls the behavior of
   * response.redirect().back() and query string forwarding.
   */
  redirect: {
    /**
     * When enabled, all redirects automatically carry over the current
     * request's query string parameters to the redirect destination.
     * Use withQs(false) to opt out for a specific redirect.
     */
    forwardQueryString: true,
  },

  /**
   * Manage cookies configuration. The settings for the session id cookie are
   * defined inside the "config/session.ts" file.
   */
  cookie: {
    /**
     * Restrict the cookie to a specific domain.
     * Keep empty to use the current host.
     */
    domain: '',

    /**
     * Restrict the cookie to a URL path. '/' means all routes.
     */
    path: '/',

    /**
     * Default lifetime for cookies managed by the HTTP layer.
     */
    maxAge: '2h',

    /**
     * Prevent JavaScript access to the cookie in the browser.
     */
    httpOnly: true,

    /**
     * Send cookies only over HTTPS in production.
     */
    secure: app.inProduction,

    /**
     * Cross-site policy for cookie sending.
     */
    sameSite: 'lax',
  },
})
