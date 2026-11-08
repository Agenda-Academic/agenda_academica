/**
 * Limite de tentativas dos códigos (turma agora, responsável na fase 2), em memória.
 *
 * O Render roda uma instância só, então um mapa no processo basta. Conta só as tentativas
 * que falham, por usuário e por IP:
 * - por usuário, 5 erros em 15 minutos: quem chuta códigos para logo;
 * - por IP, um teto maior. Uma sala inteira atrás do mesmo IP (e, no Render, todo mundo
 *   que chega pelo mesmo proxy) divide essa chave; com o teto de 5, os erros de digitação
 *   de cinco alunos travariam o código para todos os outros por 15 minutos.
 */
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
export const MAX_FAILED_ATTEMPTS = 5
export const MAX_FAILED_ATTEMPTS_PER_IP = 30

/** Uma chave do limitador e quantos erros ela aceita na janela. */
export type LimiterKey = { key: string; max: number }

const failures = new Map<string, number[]>()

function recent(key: string, now: number) {
  const hits = (failures.get(key) ?? []).filter((time) => now - time < ATTEMPT_WINDOW_MS)
  if (hits.length) {
    failures.set(key, hits)
  } else {
    failures.delete(key)
  }
  return hits
}

export default class AttemptLimiterService {
  /** Chaves de um escopo, por exemplo `keysFor('join', user.id, request.ip())`. */
  static keysFor(scope: string, userId: number, ip: string): LimiterKey[] {
    return [
      { key: `${scope}:user:${userId}`, max: MAX_FAILED_ATTEMPTS },
      { key: `${scope}:ip:${ip}`, max: MAX_FAILED_ATTEMPTS_PER_IP },
    ]
  }

  /** Segundos até liberar, ou 0 se ainda pode tentar. */
  static retryAfter(keys: LimiterKey[], now = Date.now()) {
    let wait = 0
    for (const { key, max } of keys) {
      const hits = recent(key, now)
      if (hits.length >= max) {
        const oldest = hits[hits.length - max]
        wait = Math.max(wait, Math.ceil((oldest + ATTEMPT_WINDOW_MS - now) / 1000))
      }
    }
    return wait
  }

  static fail(keys: LimiterKey[], now = Date.now()) {
    for (const { key } of keys) {
      failures.set(key, [...recent(key, now), now])
    }
    // Sem crescer para sempre: de tempos em tempos tira as chaves vencidas.
    if (failures.size > 5000) {
      for (const key of [...failures.keys()]) {
        recent(key, now)
      }
    }
  }

  /** Zera tudo. Usado pelos testes. */
  static clear() {
    failures.clear()
  }
}
