import AcademicEvent from '#models/academic_event'
import CalendarImport from '#models/calendar_import'
import { parseIsoDateTime } from '#services/date_time_service'
import { calendarImportValidator } from '#validators/academic'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class CalendarImportsController {
  async index({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.role !== 'admin') {
      return response.forbidden({ message: 'Apenas administradores visualizam importacoes.' })
    }

    const imports = await CalendarImport.query().orderBy('importedAt', 'desc')
    return { data: imports.map((item) => item.serialize()) }
  }

  async store({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.role !== 'admin') {
      return response.forbidden({ message: 'Apenas administradores importam calendario oficial.' })
    }

    const payload = await request.validateUsing(calendarImportValidator)
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
      return response.badRequest({ message: 'Uma ou mais datas da importacao estao invalidas.' })
    }

    const calendarImport = await CalendarImport.create({
      sourceName: payload.sourceName,
      sourceUrl: payload.sourceUrl ?? null,
      checksum: payload.checksum ?? null,
      importedById: user.id,
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
        createdById: user.id,
      }))
    )

    return response.created({
      data: {
        import: calendarImport.serialize(),
        events: events.map((event) => event.serialize()),
      },
    })
  }
}
