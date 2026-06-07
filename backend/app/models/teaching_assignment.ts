import { TeachingAssignmentSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import Subject from '#models/subject'
import User from '#models/user'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class TeachingAssignment extends TeachingAssignmentSchema {
  @belongsTo(() => User, { foreignKey: 'teacherId' })
  declare teacher: BelongsTo<typeof User>

  @belongsTo(() => AcademicClass)
  declare academicClass: BelongsTo<typeof AcademicClass>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>
}
