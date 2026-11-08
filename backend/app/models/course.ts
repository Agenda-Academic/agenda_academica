import { CourseSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import { hasMany, scope } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export default class Course extends CourseSchema {
  /** Cursos que não foram arquivados. */
  static withoutArchived = scope((query) => {
    query.whereNull('archivedAt')
  })

  get isArchived() {
    return this.archivedAt !== null
  }

  @hasMany(() => AcademicClass)
  declare academicClasses: HasMany<typeof AcademicClass>
}
