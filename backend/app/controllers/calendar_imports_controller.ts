import CalendarImport from '#models/calendar_import'
import CalendarPdfService, { CalendarPdfError } from '#services/calendar_pdf_service'
import CalendarSyncService, {
  AlreadyImported,
  InvalidCalendarEventDate,
} from '#services/calendar_sync_service'
import { calendarImportValidator } from '#validators/academic'
import type { HttpContext } from '@adonisjs/core/http'
import { readFile } from 'node:fs/promises'

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
      if (error instanceof InvalidCalendarEventDate || error instanceof AlreadyImported) {
        return error
      }
      throw error
    })

    if (result instanceof InvalidCalendarEventDate) {
      return response.badRequest({ message: result.message })
    }
    if (result instanceof AlreadyImported) {
      return response.conflict({ code: 'ALREADY_IMPORTED', message: result.message })
    }

    return response.created({
      data: {
        import: result.calendarImport.serialize(),
        events: result.events.map((event) => event.serialize()),
      },
    })
  }

  /**
   * Desfaz uma importação: as datas que ela trouxe saem todas de uma vez, numa transação.
   * Antes, a tela apagava data por data, e uma conexão que caísse no meio deixava metade.
   */
  async undo({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.role !== 'admin') {
      return response.forbidden({ message: 'Apenas administradores desfazem importacoes.' })
    }

    const calendarImport = await CalendarImport.find(Number(params.id))
    if (!calendarImport) {
      return response.notFound({ message: 'Importação não encontrada.' })
    }

    const removed = await CalendarSyncService.undoImport(calendarImport.id)
    return { data: { removed } }
  }

  /**
   * Lê o PDF do Calendário Acadêmico do IFMS e devolve as datas para a prévia.
   * Não grava nada: a administração confere na prévia e importa pelo `store`.
   */
  async readPdf({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.role !== 'admin') {
      return response.forbidden({ message: 'Apenas administradores importam calendario oficial.' })
    }

    const file = request.file('file', { size: '10mb', extnames: ['pdf'] })
    if (!file) {
      return response.unprocessableEntity({ message: 'Envie o PDF do calendário no campo "file".' })
    }
    if (!file.isValid) {
      const error = file.errors[0]
      const message =
        error?.type === 'size'
          ? 'O PDF passa de 10 MB.'
          : error?.type === 'extname'
            ? 'O arquivo precisa ser um PDF.'
            : 'Não foi possível receber o arquivo. Tente de novo.'
      return response.unprocessableEntity({ message })
    }

    try {
      const data = new Uint8Array(await readFile(file.tmpPath!))
      const calendar = await CalendarPdfService.parse(data)
      return {
        data: {
          sourceName: calendar.sourceName,
          checksum: calendar.checksum,
          year: calendar.year,
          campus: calendar.campus,
          events: calendar.events,
        },
      }
    } catch (error) {
      if (error instanceof CalendarPdfError) {
        return response.unprocessableEntity({ message: error.message })
      }
      throw error
    }
  }
}
