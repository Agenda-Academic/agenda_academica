import { CalendarImportSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import User from '#models/user'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class CalendarImport extends CalendarImportSchema {
  // Payload bruto fica fora das respostas da API (pode ser grande).
  @column({ serializeAs: null })
  declare rawPayload: string | null

  @belongsTo(() => User, { foreignKey: 'importedById' })
  declare importedBy: BelongsTo<typeof User>

  @hasMany(() => AcademicEvent)
  declare events: HasMany<typeof AcademicEvent>
}
