import { ClassSubjectSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import Subject from '#models/subject'
import User from '#models/user'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/** A disciplina ofertada na turma, com ou sem docente. */
export default class ClassSubject extends ClassSubjectSchema {
  @belongsTo(() => AcademicClass)
  declare academicClass: BelongsTo<typeof AcademicClass>

  @belongsTo(() => Subject)
  declare subject: BelongsTo<typeof Subject>

  @belongsTo(() => User, { foreignKey: 'createdById' })
  declare createdBy: BelongsTo<typeof User>
}
