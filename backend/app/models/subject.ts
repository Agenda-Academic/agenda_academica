import { SubjectSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import ClassSubject from '#models/class_subject'
import TeachingAssignment from '#models/teaching_assignment'
import { hasMany, scope } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export default class Subject extends SubjectSchema {
  /** Disciplinas que não foram arquivadas. */
  static withoutArchived = scope((query) => {
    query.whereNull('archivedAt')
  })

  get isArchived() {
    return this.archivedAt !== null
  }

  @hasMany(() => TeachingAssignment)
  declare teachingAssignments: HasMany<typeof TeachingAssignment>

  @hasMany(() => AcademicEvent)
  declare events: HasMany<typeof AcademicEvent>

  @hasMany(() => ClassSubject)
  declare classSubjects: HasMany<typeof ClassSubject>
}
