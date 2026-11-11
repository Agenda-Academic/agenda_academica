import env from '#start/env'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'

/**
 * Envio de e-mail pela API HTTP do Brevo (plano gratuito: 300 e-mails por dia).
 *
 * É HTTP e não SMTP porque o plano gratuito do Render bloqueia as portas de SMTP.
 * Sem BREVO_API_KEY e MAIL_FROM o envio fica desligado e o lembrete só aparece no sistema.
 */

export const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email'
const SEND_TIMEOUT_MS = 10_000
const DEFAULT_FROM_NAME = 'Agenda Acadêmica'

export type MailMessage = {
  to: string
  toName?: string | null
  subject: string
  text: string
  html: string
}

export type MailSettings = {
  apiKey: string
  fromEmail: string
  fromName: string
}

/**
 * - `sent`: o Brevo aceitou a mensagem.
 * - `skipped`: não precisa enviar (endereço de teste, como as contas de demonstração @agenda.test).
 * - `disabled`: envio sem configuração.
 * - `failed`: deu erro; `retry` diz se vale tentar de novo na próxima rodada.
 */
export type MailResult =
  | { status: 'sent'; messageId: string | null }
  | { status: 'skipped' | 'disabled' }
  | { status: 'failed'; retry: boolean; reason: string }

type Transport = (message: MailMessage) => Promise<MailResult>

/** Domínios reservados para teste (RFC 2606 e 6761): nunca recebem e-mail. */
const RESERVED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost']
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']

export function isReservedAddress(email: string) {
  const domain = email.split('@').pop()?.trim().toLowerCase() ?? ''
  if (!domain) {
    return true
  }
  return (
    RESERVED_DOMAINS.includes(domain) ||
    RESERVED_SUFFIXES.some((suffix) => domain === suffix.slice(1) || domain.endsWith(suffix))
  )
}

export default class MailService {
  /** Troca o envio de verdade por outro (os testes usam `fake()`). */
  private static transport: Transport | null = null

  static settings(): MailSettings | null {
    const apiKey = env.get('BREVO_API_KEY')?.release().trim()
    const fromEmail = env.get('MAIL_FROM')?.trim()
    if (!apiKey || !fromEmail) {
      return null
    }
    return {
      apiKey,
      fromEmail,
      fromName: env.get('MAIL_FROM_NAME')?.trim() || DEFAULT_FROM_NAME,
    }
  }

  static isEnabled() {
    return this.transport !== null || this.settings() !== null
  }

  static async send(message: MailMessage): Promise<MailResult> {
    if (isReservedAddress(message.to)) {
      return { status: 'skipped' }
    }
    if (this.transport) {
      return this.transport(message)
    }
    const settings = this.settings()
    // Nos testes nunca sai e-mail de verdade, mesmo com a chave no .env.
    if (!settings || app.inTest) {
      return { status: 'disabled' }
    }
    return this.sendWithBrevo(message, settings)
  }

  static async sendWithBrevo(message: MailMessage, settings: MailSettings): Promise<MailResult> {
    let response: Response
    try {
      response = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': settings.apiKey,
        },
        body: JSON.stringify({
          sender: { email: settings.fromEmail, name: settings.fromName },
          to: [
            message.toName ? { email: message.to, name: message.toName } : { email: message.to },
          ],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
    } catch (error) {
      logger.warn({ err: error }, 'brevo: sem resposta')
      return { status: 'failed', retry: true, reason: 'sem_resposta' }
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { messageId?: string } | null
      return { status: 'sent', messageId: body?.messageId ?? null }
    }

    // 400: a mensagem em si não serve (endereço inválido, por exemplo); repetir não adianta.
    // 401/403 (chave), 429 (limite do dia) e 5xx: tenta de novo na próxima rodada.
    const detail = await response.text().catch(() => '')
    logger.warn({ status: response.status, detail: detail.slice(0, 300) }, 'brevo: envio recusado')
    return {
      status: 'failed',
      retry: response.status !== 400,
      reason: `http_${response.status}`,
    }
  }

  /** Para testes: guarda as mensagens numa lista em vez de enviar. */
  static fake(result?: (message: MailMessage) => MailResult) {
    const outbox: MailMessage[] = []
    this.transport = async (message) => {
      outbox.push(message)
      return result ? result(message) : { status: 'sent', messageId: `fake-${outbox.length}` }
    }
    return outbox
  }

  static restore() {
    this.transport = null
  }
}
