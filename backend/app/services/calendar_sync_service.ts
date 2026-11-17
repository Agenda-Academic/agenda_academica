import AcademicEvent from '#models/academic_event'
import CalendarImport from '#models/calendar_import'
import { appTimezone, parseIsoDateTime } from '#services/date_time_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
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
export class AlreadyImported extends Error {}

/** Mesmo título (sem diferenciar maiúsculas e espaços) no mesmo dia, no fuso da instituição. */
function dayKey(title: string, startsAt: DateTime) {
  const day = startsAt.setZone(appTimezone()).toISODate()
  return `${title.trim().replace(/\s+/g, ' ').toLowerCase()}|${day}`
}

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

  /**
   * Grava as datas numa transação. As que já estão no calendário oficial (mesmo título no mesmo
   * dia, sem estarem canceladas) ficam de fora, como na prévia da tela: importar o mesmo PDF duas
   * vezes não duplica nada. Sem nenhuma data nova, lança AlreadyImported.
   */
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

    return db.transaction(async (trx) => {
      const known = await this.officialDayKeys(
        parsedEvents.map((event) => event.startsAt!),
        trx
      )
      const fresh: typeof parsedEvents = []
      for (const event of parsedEvents) {
        const key = dayKey(event.title, event.startsAt!)
        if (!known.has(key)) {
          known.add(key)
          fresh.push(event)
        }
      }
      if (!fresh.length) {
        throw new AlreadyImported(
          'Essas datas já estão no calendário oficial. Nada novo para importar.'
        )
      }

      const calendarImport = await CalendarImport.create(
        {
          sourceName: payload.sourceName,
          sourceUrl: payload.sourceUrl ?? null,
          checksum: payload.checksum ?? null,
          importedById: payload.importedById ?? null,
          importedAt: DateTime.now(),
          status: 'completed',
          totalEvents: fresh.length,
          rawPayload: JSON.stringify(payload.events),
        },
        { client: trx }
      )

      const events = await AcademicEvent.createMany(
        fresh.map((event) => ({
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
        })),
        { client: trx }
      )

      return { calendarImport, events, skipped: parsedEvents.length - fresh.length }
    })
  }

  /** Tira do calendário, de uma vez, as datas que uma importação trouxe. Devolve quantas saíram. */
  static async undoImport(calendarImportId: number) {
    return db.transaction(async (trx) => {
      const removed = await AcademicEvent.query({ client: trx })
        .where('calendarImportId', calendarImportId)
        .where('source', 'imported')
        .select('id')
      if (!removed.length) {
        return 0
      }
      // os lembretes dessas datas saem junto (chave estrangeira com CASCADE)
      await AcademicEvent.query({ client: trx })
        .whereIn(
          'id',
          removed.map((event) => event.id)
        )
        .delete()
      return removed.length
    })
  }

  /** Chaves "título|dia" das datas oficiais em vigor perto das datas novas. */
  private static async officialDayKeys(dates: DateTime[], trx: TransactionClientContract) {
    const keys = new Set<string>()
    if (!dates.length) {
      return keys
    }
    const millis = dates.map((date) => date.toMillis())
    const from = DateTime.fromMillis(Math.min(...millis))
      .minus({ days: 2 })
      .toUTC()
    const to = DateTime.fromMillis(Math.max(...millis))
      .plus({ days: 2 })
      .toUTC()
    const existing = await AcademicEvent.query({ client: trx })
      .where((query) => {
        query.whereIn('source', ['official', 'imported']).orWhere('officialPriority', true)
      })
      .whereNull('academicClassId')
      .whereNot('status', 'cancelled')
      .whereBetween('startsAt', [
        from.toSQL({ includeOffset: false })!,
        to.toSQL({ includeOffset: false })!,
      ])
      .select('title', 'startsAt')
    for (const event of existing) {
      keys.add(dayKey(event.title, event.startsAt))
    }
    return keys
  }
}
