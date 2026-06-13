import { DateTime } from 'luxon'

const DEFAULT_ZONE = 'America/Sao_Paulo'

export function parseIsoDateTime(value: string) {
  const date = DateTime.fromISO(value, { zone: DEFAULT_ZONE })
  // Normaliza para UTC: o Lucid persiste a hora "de parede" do DateTime e o
  // banco e leituras assumem UTC, então manter a zona local deslocaria o
  // horário a cada gravação.
  return date.isValid ? date.toUTC() : null
}

export function reminderSendAt(startsAt: DateTime, offsetMinutes: number) {
  return startsAt.minus({ minutes: offsetMinutes })
}
