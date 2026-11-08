import { GradeImportRowSchema } from '#database/schema'
import GradeImport from '#models/grade_import'
import User from '#models/user'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * Como cada linha do arquivo foi classificada na prévia:
 * - `new`: o aluno ainda não tem nota; `changed`: a nota muda; `same`: a nota é igual;
 * - `newer_in_agenda`: a nota foi mudada na Agenda depois do arquivo;
 * - `no_match`, `not_enrolled`, `invalid` e `duplicate`: a linha fica de fora.
 */
export const GRADE_ROW_KINDS = [
  'new',
  'changed',
  'same',
  'no_match',
  'not_enrolled',
  'invalid',
  'duplicate',
  'newer_in_agenda',
] as const
export type GradeRowKind = (typeof GRADE_ROW_KINDS)[number]

/** Linhas que nunca viram nota. */
export const REJECTED_ROW_KINDS: readonly GradeRowKind[] = [
  'no_match',
  'not_enrolled',
  'invalid',
  'duplicate',
]

/** Linha da prévia de uma importação. Apagada ao aplicar ou descartar. */
export default class GradeImportRow extends GradeImportRowSchema {
  @belongsTo(() => GradeImport)
  declare gradeImport: BelongsTo<typeof GradeImport>

  @belongsTo(() => User, { foreignKey: 'studentId' })
  declare student: BelongsTo<typeof User>
}
