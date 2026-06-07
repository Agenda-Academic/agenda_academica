import CalendarImport from '#models/calendar_import'
import CalendarSyncService, { InvalidCalendarEventDate } from '#services/calendar_sync_service'
import { calendarImportValidator } from '#validators/academic'
import type { HttpContext } from '@adonisjs/core/http'

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
    const result = await CalendarSyncService.importEvents({
      ...payload,
      importedById: user.id,
    }).catch((error) => {
      if (error instanceof InvalidCalendarEventDate) {
        return error
      }
      throw error
    })

    if (result instanceof InvalidCalendarEventDate) {
      return response.badRequest({ message: result.message })
    }

    return response.created({
      data: {
        import: result.calendarImport.serialize(),
        events: result.events.map((event) => event.serialize()),
      },
    })
  }
}
