import { GradeSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import GradeChange from '#models/grade_change'
import GradeImport from '#models/grade_import'
import User from '#models/user'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

/** Situação da nota: com valor (`graded`), falta (`absent`) ou dispensa (`excused`). */
export const GRADE_STATUSES = ['graded', 'absent', 'excused'] as const
export type GradeStatus = (typeof GRADE_STATUSES)[number]

/**
 * Nota de um aluno numa prova ou trabalho, em centésimos (7,5 vira 750). Fica oculta para o
 * aluno e o responsável até a docente publicar as notas do evento.
 */
export default class Grade extends GradeSchema {
  @belongsTo(() => AcademicEvent)
  declare academicEvent: BelongsTo<typeof AcademicEvent>

  @belongsTo(() => User, { foreignKey: 'studentId' })
  declare student: BelongsTo<typeof User>

  @belongsTo(() => GradeImport)
  declare gradeImport: BelongsTo<typeof GradeImport>

  @hasMany(() => GradeChange)
  declare changes: HasMany<typeof GradeChange>
}
