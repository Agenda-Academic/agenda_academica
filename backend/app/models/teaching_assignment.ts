import { TeachingAssignmentSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import Subject from '#models/subject'
import User from '#models/user'
import { belongsTo, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export const TEACHING_ROLES = ['titular', 'substituto'] as const

export default class TeachingAssignment extends TeachingAssignmentSchema {
  /** Vínculos em vigor: desvincular preenche ended_at em vez de apagar a linha. */
  static current = scope((query) => {
    query.whereNull('endedAt')
  })

  @belongsTo(() => User, { foreignKey: 'teacherId' })
  declare teacher: BelongsTo<typeof User>

  @belongsTo(() => AcademicClass)
  declare academicClass: BelongsTo<typeof AcademicClass>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>
}
