import env from '#start/env'
import { DateTime } from 'luxon'

const DEFAULT_ZONE = 'America/Sao_Paulo'

/**
 * Fuso da instituição (APP_TIMEZONE), usado nas datas que chegam sem fuso (as do PDF do
 * calendário) e nos horários escritos nos e-mails. O campus de Três Lagoas, em MS, é
 * America/Campo_Grande; sem a variável vale America/Sao_Paulo. Valor inválido também cai no padrão.
 */
export function appTimezone() {
  const zone = env.get('APP_TIMEZONE')?.trim()
  return zone && DateTime.local().setZone(zone).isValid ? zone : DEFAULT_ZONE
}

export function parseIsoDateTime(value: string) {
  const date = DateTime.fromISO(value, { zone: appTimezone() })
  // Normaliza para UTC: o Lucid persiste a hora "de parede" do DateTime e o
  // banco e leituras assumem UTC, então manter a zona local deslocaria o
  // horário a cada gravação.
  return date.isValid ? date.toUTC() : null
}

export function reminderSendAt(startsAt: DateTime, offsetMinutes: number) {
  return startsAt.minus({ minutes: offsetMinutes })
}
