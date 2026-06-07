import { EnrollmentSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import User from '#models/user'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Enrollment extends EnrollmentSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => AcademicClass)
  declare academicClass: BelongsTo<typeof AcademicClass>
}
