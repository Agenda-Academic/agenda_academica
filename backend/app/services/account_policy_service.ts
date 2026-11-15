import env from '#start/env'

/** Domínio das contas de demonstração do seed (reservado para teste: nunca recebe e-mail). */
export const DEMO_EMAIL_DOMAIN = '@agenda.test'

export const DEMO_ACCOUNTS_OFF =
  'As contas de demonstração estão desligadas. Entre com a sua conta ou com o Google da instituição.'

export const STAFF_SIGNUP_GOOGLE_ONLY =
  'Aluno e docente não criam conta aqui: entre com o Google, usando o e-mail da instituição.'

/**
 * Quem pode entrar e como, conforme o Environment do servidor. As variáveis são lidas a cada uso,
 * então os testes (e um deploy com valores novos) mudam o comportamento sem reiniciar nada.
 */
export default class AccountPolicyService {
  /** DEMO_ACCOUNTS=false desliga as contas de demonstração; sem a variável, elas ficam ligadas. */
  static demoAccountsEnabled() {
    return env.get('DEMO_ACCOUNTS', true) !== false
  }

  static isDemoEmail(email: string) {
    return email.trim().toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)
  }

  /** Conta de demonstração com as contas desligadas: não entra e a sessão aberta deixa de valer. */
  static isBlocked(email: string) {
    return !this.demoAccountsEnabled() && this.isDemoEmail(email)
  }

  /**
   * E-mails que viram administração ao entrar com o Google (ADMIN_EMAILS, separados por vírgula).
   * Só pelo Google, que confirma que o e-mail é da pessoa: o cadastro com senha não confere isso.
   */
  static isAdminEmail(email: string) {
    const list = (env.get('ADMIN_EMAILS') ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    return list.includes(email.trim().toLowerCase())
  }
}
