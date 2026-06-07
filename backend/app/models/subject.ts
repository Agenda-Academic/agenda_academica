import { SubjectSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import TeachingAssignment from '#models/teaching_assignment'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export default class Subject extends SubjectSchema {
  @hasMany(() => TeachingAssignment)
  declare teachingAssignments: HasMany<typeof TeachingAssignment>

  @hasMany(() => AcademicEvent)
  declare events: HasMany<typeof AcademicEvent>
}
