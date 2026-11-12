import User from '#models/user'
import { renderCard } from '#services/mail_layout'
import MailService, { type MailMessage } from '#services/mail_service'
import env from '#start/env'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { createHash, randomBytes } from 'node:crypto'

/**
 * "Esqueci minha senha".
 *
 * 1. `request(email)`: se existir conta com o e-mail, cria um token de uso único (1 hora) e manda o
 *    link por e-mail. A resposta é a mesma com ou sem conta, para não revelar quem tem cadastro.
 * 2. `reset(token, senha)`: confere o token, troca a senha, encerra as outras sessões e entra.
 *
 * O token em claro só existe no e-mail; o banco guarda o SHA-256 dele.
 */

export const RESET_TTL_MINUTES = 60
const DEFAULT_FRONTEND_URL = 'http://localhost:3000'

/** Limite de pedidos de link, em memória (uma instância no Render), contando cada pedido. */
const REQUEST_WINDOW_MS = 15 * 60 * 1000
const MAX_REQUESTS_PER_EMAIL = 3
const MAX_REQUESTS_PER_IP = 20
const requests = new Map<string, number[]>()

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function recent(key: string, now: number) {
  const hits = (requests.get(key) ?? []).filter((time) => now - time < REQUEST_WINDOW_MS)
  if (hits.length) {
    requests.set(key, hits)
  } else {
    requests.delete(key)
  }
  return hits
}

export function resetLink(token: string) {
  const base = (env.get('FRONTEND_URL') || DEFAULT_FRONTEND_URL).replace(/\/+$/, '')
  return `${base}/?redefinir=${encodeURIComponent(token)}`
}

export function buildResetEmail(user: User, link: string): MailMessage {
  const firstName = user.fullName?.trim().split(/\s+/)[0] || null
  const greeting = firstName ? `Olá, ${firstName}.` : 'Olá.'
  const intro = 'Recebemos um pedido para criar uma senha nova na sua conta da Agenda Acadêmica.'
  const validity = `O link vale por ${RESET_TTL_MINUTES / 60} hora e funciona uma vez só.`
  const footer =
    'Se não foi você que pediu, ignore este e-mail: a sua senha continua a mesma e ninguém entra na conta sem este link.'

  return {
    to: user.email,
    toName: user.fullName,
    subject: 'Criar senha nova na Agenda Acadêmica',
    text: [greeting, '', intro, validity, '', `Criar senha nova: ${link}`, '', footer].join('\n'),
    html: renderCard({
      kicker: 'Senha',
      title: 'Criar senha nova',
      paragraphs: [greeting, intro, validity],
      button: { label: 'Criar senha nova', href: link },
      footer,
    }),
  }
}

export default class PasswordResetService {
  /** Segundos até poder pedir de novo (0 = pode). Cada pedido conta, com ou sem conta. */
  static throttle(email: string, ip: string, now = Date.now()) {
    const keys = [
      { key: `reset:email:${email}`, max: MAX_REQUESTS_PER_EMAIL },
      { key: `reset:ip:${ip}`, max: MAX_REQUESTS_PER_IP },
    ]
    let wait = 0
    for (const { key, max } of keys) {
      const hits = recent(key, now)
      if (hits.length >= max) {
        const oldest = hits[hits.length - max]
        wait = Math.max(wait, Math.ceil((oldest + REQUEST_WINDOW_MS - now) / 1000))
      }
    }
    if (wait === 0) {
      for (const { key } of keys) {
        requests.set(key, [...recent(key, now), now])
      }
    }
    return wait
  }

  /** Zera o limite. Usado pelos testes. */
  static clearThrottle() {
    requests.clear()
  }

  static async request(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase()
    const user = await User.query().whereRaw('lower(email) = ?', [email]).first()
    if (!user) {
      return
    }

    const token = randomBytes(32).toString('base64url')
    const now = DateTime.utc()
    await db.transaction(async (trx) => {
      // um link novo vale sozinho: os anteriores que não foram usados deixam de valer
      await trx
        .from('password_reset_tokens')
        .where('user_id', user.id)
        .whereNull('used_at')
        .delete()
      await trx.table('password_reset_tokens').insert({
        user_id: user.id,
        token_hash: hashToken(token),
        expires_at: now.plus({ minutes: RESET_TTL_MINUTES }).toSQL({ includeOffset: false }),
        created_at: now.toSQL({ includeOffset: false }),
      })
    })

    const link = resetLink(token)
    const result = await MailService.send(buildResetEmail(user, link))
    if (result.status === 'failed') {
      logger.warn({ userId: user.id, reason: result.reason }, 'senha: e-mail do link não saiu')
    } else if (result.status !== 'sent' && app.inDev) {
      // só no computador de desenvolvimento, sem e-mail configurado ou com conta @agenda.test
      logger.info(
        { userId: user.id, link },
        'senha: link para criar senha nova (só em desenvolvimento)'
      )
    }
  }

  /** Troca a senha. Devolve o usuário, ou null se o link não vale (usado, vencido ou inexistente). */
  static async reset(token: string, password: string) {
    const now = DateTime.utc()
    return db.transaction(async (trx) => {
      const row = await trx
        .from('password_reset_tokens')
        .where('token_hash', hashToken(token))
        .whereNull('used_at')
        .where('expires_at', '>', now.toSQL({ includeOffset: false }))
        .first()
      if (!row) {
        return null
      }

      const user = await User.find(row.user_id, { client: trx })
      if (!user) {
        return null
      }
      user.password = password
      await user.save()

      await trx
        .from('password_reset_tokens')
        .where('id', row.id)
        .update({ used_at: now.toSQL({ includeOffset: false }) })
      // os outros links e todas as sessões abertas (em outro aparelho, por exemplo) deixam de valer
      await trx
        .from('password_reset_tokens')
        .where('user_id', user.id)
        .whereNull('used_at')
        .delete()
      await trx.from('auth_access_tokens').where('tokenable_id', user.id).delete()
      return user
    })
  }
}
