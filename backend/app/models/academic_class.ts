import { AcademicClassSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import TeachingAssignment from '#models/teaching_assignment'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class AcademicClass extends AcademicClassSchema {
  @belongsTo(() => Course)
  declare course: BelongsTo<typeof Course>

  @hasMany(() => Enrollment)
  declare enrollments: HasMany<typeof Enrollment>

  @hasMany(() => TeachingAssignment)
  declare teachingAssignments: HasMany<typeof TeachingAssignment>

  @hasMany(() => AcademicEvent)
  declare events: HasMany<typeof AcademicEvent>
}
