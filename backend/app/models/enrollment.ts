import { EnrollmentSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import User from '#models/user'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export const ENROLLMENT_STATUSES = ['pending', 'active', 'inactive', 'completed'] as const
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]

export default class Enrollment extends EnrollmentSchema {
  // A matrícula escolar só aparece para a administração, na lista de alunos da turma.
  @column({ serializeAs: null })
  declare registration: string | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => AcademicClass)
  declare academicClass: BelongsTo<typeof AcademicClass>

  @belongsTo(() => User, { foreignKey: 'decidedById' })
  declare decidedBy: BelongsTo<typeof User>
}
