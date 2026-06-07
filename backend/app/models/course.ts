import { CourseSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export default class Course extends CourseSchema {
  @hasMany(() => AcademicClass)
  declare academicClasses: HasMany<typeof AcademicClass>
}
