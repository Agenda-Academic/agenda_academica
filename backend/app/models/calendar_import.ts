import { CalendarImportSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import User from '#models/user'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class CalendarImport extends CalendarImportSchema {
  @belongsTo(() => User, { foreignKey: 'importedById' })
  declare importedBy: BelongsTo<typeof User>

  @hasMany(() => AcademicEvent)
  declare events: HasMany<typeof AcademicEvent>
}
