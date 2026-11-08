import { AcademicEventSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import CalendarImport from '#models/calendar_import'
import Grade from '#models/grade'
import Reminder from '#models/reminder'
import Subject from '#models/subject'
import User from '#models/user'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class AcademicEvent extends AcademicEventSchema {
  // Quem publicou as notas fica no audit_logs; nos eventos sai só a data (`gradesPublishedAt`).
  @column({ serializeAs: null })
  declare gradesPublishedById: number | null

  @belongsTo(() => AcademicClass)
  declare academicClass: BelongsTo<typeof AcademicClass>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>

  @belongsTo(() => User, { foreignKey: 'teacherId' })
  declare teacher: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'createdById' })
  declare createdBy: BelongsTo<typeof User>

  @belongsTo(() => CalendarImport)
  declare calendarImport: BelongsTo<typeof CalendarImport>

  @hasMany(() => Reminder)
  declare reminders: HasMany<typeof Reminder>

  @hasMany(() => Grade)
  declare grades: HasMany<typeof Grade>
}
