import User from '#models/user'
import AuditLogService from '#services/audit_log_service'
import ClassMembershipService from '#services/class_membership_service'
import env from '#start/env'
import { safeEqual } from '@adonisjs/core/helpers'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { createHash, randomBytes } from 'node:crypto'

/**
 * Entrar com o Google (OpenID Connect, código de autorização com PKCE S256 e state).
 *
 * 1. `/auth/google/redirect` sorteia o state e o code_verifier, guarda os dois num cookie
 *    criptografado e manda a pessoa para o Google.
 * 2. `/auth/google/callback` confere o state, troca o code pelo id_token, valida os claims e
 *    entra na conta (ou cria a do IFMS). O front recebe só um código de uso único no endereço.
 * 3. `/auth/google/exchange` troca esse código pelo mesmo token de acesso do login por senha.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

/** Cookie do state e do code_verifier: só vai para as rotas do Google. */
export const GOOGLE_STATE_COOKIE = 'google_oauth'
export const GOOGLE_COOKIE_PATH = '/api/v1/auth/google'
export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000

/** Validade do código que o front troca pelo token de acesso. */
export const LOGIN_CODE_TTL_MS = 2 * 60 * 1000

const DEFAULT_FRONTEND_URL = 'http://localhost:3000'
const TOKEN_TIMEOUT_MS = 10_000

/** Motivo que volta para o front em `?google_erro=`. */
export type GoogleErrorReason = 'nao_configurado' | 'cancelado' | 'estado' | 'falhou' | 'dominio'

export type GoogleSettings = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/** O que fica no cookie entre a ida ao Google e a volta. */
export type GoogleStatePayload = {
  state: string
  codeVerifier: string
  createdAt: number
}

/** Os dados do id_token que a API usa, já conferidos. */
export type GoogleIdentity = {
  email: string
  name: string | null
  hd: string | null
}

export type GoogleCallbackResult =
  | { ok: true; loginCode: string }
  | { ok: false; reason: GoogleErrorReason }

type LoginCodeEntry = { userId: number; expiresAt: number }

/**
 * Códigos de uso único em memória. O Render roda uma instância só, então um mapa no processo
 * basta; um código perdido num reinício só faz a pessoa clicar no botão de novo.
 */
const loginCodes = new Map<string, LoginCodeEntry>()

function randomToken() {
  return randomBytes(32).toString('base64url')
}

function isIfmsDomain(hd: string | null) {
  if (!hd) {
    return false
  }
  const domain = hd.toLowerCase()
  return domain === 'ifms.edu.br' || domain.endsWith('.ifms.edu.br')
}

/** Perfil da conta nova pelo e-mail do IFMS; null quando o e-mail não é de aluno nem de servidor. */
function roleForEmail(email: string): 'student' | 'teacher' | null {
  if (email.endsWith('@estudante.ifms.edu.br')) {
    return 'student'
  }
  if (email.endsWith('@ifms.edu.br')) {
    return 'teacher'
  }
  return null
}

export default class GoogleOAuthService {
  /** Client ID, segredo e redirect_uri; null quando o login com o Google não está configurado. */
  static settings(): GoogleSettings | null {
    const clientId = env.get('GOOGLE_CLIENT_ID')?.trim()
    const secret = env.get('GOOGLE_CLIENT_SECRET')
    const clientSecret = typeof secret?.release === 'function' ? secret.release().trim() : ''
    if (!clientId || !clientSecret) {
      return null
    }
    return { clientId, clientSecret, redirectUri: this.redirectUri() }
  }

  /** Tem de ser igual, letra por letra, ao URI cadastrado na credencial do Google Cloud. */
  static redirectUri() {
    return `${env.get('APP_URL').replace(/\/+$/, '')}/api/v1/auth/google/callback`
  }

  /** Endereço do front com os parâmetros da volta (`?google=` ou `?google_erro=`). */
  static frontendUrl(params: Record<string, string>) {
    const base = (env.get('FRONTEND_URL') || DEFAULT_FRONTEND_URL).replace(/\/+$/, '')
    return `${base}/?${new URLSearchParams(params).toString()}`
  }

  /** Sorteia state e code_verifier e monta o endereço de autorização do Google. */
  static authorization(settings: GoogleSettings) {
    const state = randomToken()
    const codeVerifier = randomToken()
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const params = new URLSearchParams({
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    const payload: GoogleStatePayload = { state, codeVerifier, createdAt: Date.now() }
    return { url: `${GOOGLE_AUTH_URL}?${params.toString()}`, payload }
  }

  /** Lê o cookie (já decifrado) e confere o state que o Google devolveu. */
  static checkState(stored: unknown, state: unknown, now = Date.now()): GoogleStatePayload | null {
    if (!stored || typeof stored !== 'object' || typeof state !== 'string' || !state) {
      return null
    }
    const payload = stored as Partial<GoogleStatePayload>
    if (
      typeof payload.state !== 'string' ||
      typeof payload.codeVerifier !== 'string' ||
      typeof payload.createdAt !== 'number' ||
      now - payload.createdAt > GOOGLE_STATE_TTL_MS
    ) {
      return null
    }
    return safeEqual(payload.state, state) ? (payload as GoogleStatePayload) : null
  }

  /**
   * Troca o code pelo id_token no endpoint de token do Google. Os testes substituem este método
   * para não usar a rede. Nada da resposta (tokens) nem o segredo vão para o log.
   */
  static async exchangeCode(
    code: string,
    codeVerifier: string,
    settings: GoogleSettings
  ): Promise<string> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: settings.redirectUri,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!response.ok || typeof body?.id_token !== 'string') {
      // só a situação HTTP e o código de erro do Google (ex.: invalid_grant), nunca tokens
      logger.warn(
        { status: response.status, error: typeof body?.error === 'string' ? body.error : null },
        'google token exchange failed'
      )
      throw new Error('Google token exchange failed')
    }
    return body.id_token
  }

  /**
   * Lê os claims do id_token e confere iss, aud, exp e email_verified.
   *
   * A assinatura não é conferida de propósito: o id_token chega direto do endpoint de token do
   * Google, numa conexão TLS aberta pela própria API e autenticada com o client_secret. O
   * OpenID Connect Core 1.0 (seção 3.1.3.7, item 6) permite usar a validação do servidor TLS no
   * lugar da assinatura nesse caso. Um id_token vindo do navegador nunca passa por aqui.
   */
  static identityFromIdToken(
    idToken: string,
    clientId: string,
    now = Date.now()
  ): GoogleIdentity | null {
    const parts = idToken.split('.')
    if (parts.length !== 3 || !parts[1]) {
      return null
    }
    let claims: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null
      }
      claims = parsed as Record<string, unknown>
    } catch {
      return null
    }

    if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.includes(claims.iss)) {
      return null
    }
    if (claims.aud !== clientId) {
      return null
    }
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) {
      return null
    }
    if (claims.email_verified !== true) {
      return null
    }
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
    if (!email || !email.includes('@')) {
      return null
    }
    const name = typeof claims.name === 'string' ? claims.name.trim().replace(/\s+/g, ' ') : ''
    return {
      email,
      name: name ? name.slice(0, 255) : null,
      hd: typeof claims.hd === 'string' ? claims.hd : null,
    }
  }

  /**
   * Entra na conta do e-mail (de qualquer domínio) ou cria a conta do IFMS. Sem conta e sem o
   * `hd` do IFMS (conta gerenciada pelo Google do instituto), não cria nada: devolve null.
   */
  static async findOrCreateUser(identity: GoogleIdentity): Promise<User | null> {
    const existing = await User.query().whereRaw('lower(email) = ?', [identity.email]).first()
    if (existing) {
      return existing
    }

    const role = isIfmsDomain(identity.hd) ? roleForEmail(identity.email) : null
    if (!role) {
      return null
    }

    // Conta, convites e registro na mesma transação, como no cadastro por e-mail e senha.
    const user = await db.transaction(async (trx) => {
      const created = await User.create(
        {
          fullName: identity.name,
          email: identity.email,
          // a pessoa entra pelo Google; a senha só existe porque a coluna é obrigatória
          password: randomToken(),
          role,
          registration: null,
        },
        { client: trx }
      )
      if (created.role === 'student') {
        await ClassMembershipService.acceptInvites(created, trx)
      }
      await AuditLogService.record(
        {
          actorId: created.id,
          action: 'auth.google_signup',
          entity: 'user',
          entityId: created.id,
          subjectUserId: created.id,
          meta: { role },
        },
        trx
      )
      return created
    })
    await user.refresh()
    return user
  }

  /** Volta do Google: code e verifier viram usuário e código de uso único para o front. */
  static async completeLogin(
    code: string,
    codeVerifier: string,
    settings: GoogleSettings
  ): Promise<GoogleCallbackResult> {
    let identity: GoogleIdentity | null
    try {
      const idToken = await this.exchangeCode(code, codeVerifier, settings)
      identity = this.identityFromIdToken(idToken, settings.clientId)
    } catch {
      return { ok: false, reason: 'falhou' }
    }
    if (!identity) {
      return { ok: false, reason: 'falhou' }
    }

    let user: User | null
    try {
      user = await this.findOrCreateUser(identity)
    } catch {
      // ex.: duas voltas do Google ao mesmo tempo criando a mesma conta
      return { ok: false, reason: 'falhou' }
    }
    if (!user) {
      return { ok: false, reason: 'dominio' }
    }
    return { ok: true, loginCode: this.issueLoginCode(user.id) }
  }

  /** Código de uso único (32 bytes em base64url) que o front troca pelo token de acesso. */
  static issueLoginCode(userId: number, ttlMs = LOGIN_CODE_TTL_MS, now = Date.now()) {
    for (const [key, entry] of loginCodes) {
      if (entry.expiresAt <= now) {
        loginCodes.delete(key)
      }
    }
    const code = randomToken()
    loginCodes.set(code, { userId, expiresAt: now + ttlMs })
    return code
  }

  /** Apaga o código e devolve o id do usuário; null se não existe, já foi usado ou venceu. */
  static consumeLoginCode(code: string, now = Date.now()) {
    const entry = loginCodes.get(code)
    loginCodes.delete(code)
    if (!entry || entry.expiresAt <= now) {
      return null
    }
    return entry.userId
  }
}
