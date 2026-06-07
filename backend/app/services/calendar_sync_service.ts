import AcademicEvent from '#models/academic_event'
import CalendarImport from '#models/calendar_import'
import { parseIsoDateTime } from '#services/date_time_service'
import { DateTime } from 'luxon'

export type InstitutionalCalendarEvent = {
  title: string
  description?: string | null
  category: string
  startsAt: string
  endsAt?: string | null
  location?: string | null
  sourceExternalId?: string | null
  color?: string | null
}

type ImportPayload = {
  sourceName: string
  sourceUrl?: string | null
  checksum?: string | null
  importedById?: number | null
  events: InstitutionalCalendarEvent[]
}

export class InvalidCalendarEventDate extends Error {}

export default class CalendarSyncService {
  static demoPayload(): ImportPayload {
    const now = DateTime.now().startOf('day')
    return {
      sourceName: 'Calendario oficial demo',
      sourceUrl: 'https://www.ifms.edu.br/',
      checksum: `demo-${now.toISODate()}`,
      events: [
        {
          title: 'Semana academica',
          description: 'Evento institucional sincronizado automaticamente.',
          category: 'institutional',
          startsAt: now.plus({ days: 14, hours: 8 }).toISO()!,
          endsAt: now.plus({ days: 16, hours: 22 }).toISO(),
          color: '#2563eb',
        },
        {
          title: 'Prazo final de ajuste de matricula',
          description: 'Data oficial de secretaria academica.',
          category: 'institutional',
          startsAt: now.plus({ days: 18, hours: 17 }).toISO()!,
          color: '#0f766e',
        },
      ],
    }
  }

  static async importEvents(payload: ImportPayload) {
    const parsedEvents = payload.events.map((event) => {
      const startsAt = parseIsoDateTime(event.startsAt)
      const endsAt = event.endsAt ? parseIsoDateTime(event.endsAt) : null
      return {
        ...event,
        startsAt,
        endsAt,
        invalidDate: !startsAt || (event.endsAt ? !endsAt : false),
      }
    })

    if (parsedEvents.some((event) => event.invalidDate)) {
      throw new InvalidCalendarEventDate('Uma ou mais datas da importacao estao invalidas.')
    }

    const calendarImport = await CalendarImport.create({
      sourceName: payload.sourceName,
      sourceUrl: payload.sourceUrl ?? null,
      checksum: payload.checksum ?? null,
      importedById: payload.importedById ?? null,
      importedAt: DateTime.now(),
      status: 'completed',
      totalEvents: parsedEvents.length,
      rawPayload: JSON.stringify(payload.events),
    })

    const events = await AcademicEvent.createMany(
      parsedEvents.map((event) => ({
        title: event.title,
        description: event.description ?? null,
        category: event.category,
        source: 'imported',
        status: 'scheduled',
        startsAt: event.startsAt!,
        endsAt: event.endsAt,
        location: event.location ?? null,
        color: event.color ?? '#2563eb',
        calendarImportId: calendarImport.id,
        sourceExternalId: event.sourceExternalId ?? null,
        officialPriority: true,
        createdById: payload.importedById ?? null,
      }))
    )

    return { calendarImport, events }
  }
}
