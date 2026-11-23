import CalendarImport from '#models/calendar_import'
import CalendarPdfService from '#services/calendar_pdf_service'
import CalendarSyncService, { AlreadyImported } from '#services/calendar_sync_service'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { readFile } from 'node:fs/promises'

/**
 * Calendários Acadêmicos do campus que vêm com o sistema (PDFs publicados pela instituição). Ficam em
 * `database/seeders/data`, que o `metaFiles` do `adonisrc.ts` leva para o build.
 */
export const BUNDLED_CALENDARS = {
  2026: 'database/seeders/data/calendario-ifms-2026-tres-lagoas.pdf',
  2027: 'database/seeders/data/calendario-ifms-2027-tres-lagoas.pdf',
} as const

/**
 * Importa os calendários que ainda não estão no banco, como a tela faz: as datas só de servidores
 * (PIT, RAD, diários) ficam de fora e o que já está no calendário oficial (mesmo título no mesmo
 * dia) não repete. Roda a cada início da API: o PDF só é lido quando o arquivo (pelo checksum)
 * ainda não foi importado, e uma importação desfeita pela tela não volta.
 */
export default class BundledCalendarsService {
  static async importMissing(importedById: number | null = null) {
    const imported: string[] = []
    for (const path of Object.values(BUNDLED_CALENDARS)) {
      let data: Uint8Array
      try {
        data = new Uint8Array(await readFile(app.makePath(path)))
      } catch {
        // um PDF faltando não pode derrubar o início da API
        logger.warn(`calendário não encontrado (${path}): segue sem ele`)
        continue
      }
      if (await CalendarImport.findBy('checksum', CalendarPdfService.checksumOf(data))) {
        continue
      }
      const calendar = await CalendarPdfService.parse(data)
      try {
        await CalendarSyncService.importEvents({
          sourceName: calendar.sourceName,
          checksum: calendar.checksum,
          importedById,
          events: calendar.events
            .filter((event) => event.audience === 'all')
            .map(({ title, description, category, startsAt, endsAt, sourceExternalId }) => ({
              title,
              description,
              category,
              startsAt,
              // como na tela (sync-view.tsx): término só com o dia vale até 23:59 dele
              endsAt: endsAt ? `${endsAt}T23:59` : null,
              sourceExternalId,
            })),
        })
        imported.push(calendar.sourceName)
      } catch (error) {
        if (!(error instanceof AlreadyImported)) throw error
      }
    }
    return imported
  }
}
