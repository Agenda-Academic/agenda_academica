import { DateTime } from 'luxon'

const DEFAULT_ZONE = 'America/Sao_Paulo'

export function parseIsoDateTime(value: string) {
  const date = DateTime.fromISO(value, { zone: DEFAULT_ZONE })
  return date.isValid ? date : null
}

export function reminderSendAt(startsAt: DateTime, offsetMinutes: number) {
  return startsAt.minus({ minutes: offsetMinutes })
}
