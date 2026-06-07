import CalendarSyncService from '#services/calendar_sync_service'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile } from 'node:fs/promises'

export default class SyncInstitutionalCalendar extends BaseCommand {
  static commandName = 'calendar:sync-official'
  static description = 'Import official academic calendar events from JSON or demo data'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'HTTP URL or local JSON file with calendar events' })
  declare source?: string

  @flags.string({ description: 'Friendly source name saved in the import history' })
  declare sourceName?: string

  async run() {
    const payload = this.source
      ? await this.readPayload(this.source)
      : CalendarSyncService.demoPayload()
    const result = await CalendarSyncService.importEvents({
      ...payload,
      sourceName: this.sourceName ?? payload.sourceName,
      sourceUrl: this.source?.startsWith('http') ? this.source : payload.sourceUrl,
    })

    this.logger.info(
      `Imported ${result.events.length} official events from "${result.calendarImport.sourceName}"`
    )
  }

  private async readPayload(source: string) {
    const raw = source.startsWith('http')
      ? await fetch(source).then((response) => response.text())
      : await readFile(source, 'utf8')

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? {
          sourceName: this.sourceName ?? 'Calendario oficial',
          sourceUrl: source.startsWith('http') ? source : null,
          events: parsed,
        }
      : parsed
  }
}
