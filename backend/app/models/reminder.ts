import { ReminderSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import User from '#models/user'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Reminder extends ReminderSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => AcademicEvent)
  declare academicEvent: BelongsTo<typeof AcademicEvent>
}
