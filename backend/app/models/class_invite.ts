import { ClassInviteSchema } from '#database/schema'
import AcademicClass from '#models/academic_class'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/** E-mail da lista da turma que ainda não tem conta; vira matrícula no cadastro. */
export default class ClassInvite extends ClassInviteSchema {
  @belongsTo(() => AcademicClass)
  declare academicClass: BelongsTo<typeof AcademicClass>
}
