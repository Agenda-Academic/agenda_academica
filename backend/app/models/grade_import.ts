import { GradeImportSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import GradeImportRow from '#models/grade_import_row'
import User from '#models/user'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export const GRADE_IMPORT_SOURCES = ['modelo', 'suap', 'moodle', 'classroom'] as const
export type GradeImportSource = (typeof GRADE_IMPORT_SOURCES)[number]

/** Linhas por importação. O corpo JSON também tem o teto de 1 MB do bodyparser. */
export const MAX_IMPORT_ROWS = 2000

export const GRADE_IMPORT_STATUSES = ['draft', 'applied', 'discarded', 'undone'] as const
export type GradeImportStatus = (typeof GRADE_IMPORT_STATUSES)[number]

/** Como a docente mapeou as colunas do arquivo (guardado em `mapping`, como JSON). */
export type GradeImportMapping = {
  identifierType: 'email' | 'registration'
  identifierColumn: string
  scoreColumn: string
  nameColumn?: string | null
}

/**
 * Uma importação de notas: rascunho com a prévia, aplicada, descartada ou desfeita. O arquivo
 * nunca é guardado; só as linhas da prévia, que somem ao aplicar ou descartar.
 */
export default class GradeImport extends GradeImportSchema {
  get parsedMapping(): GradeImportMapping | null {
    try {
      return JSON.parse(this.mapping) as GradeImportMapping
    } catch {
      return null
    }
  }

  @belongsTo(() => AcademicEvent)
  declare academicEvent: BelongsTo<typeof AcademicEvent>

  @belongsTo(() => User, { foreignKey: 'createdById' })
  declare createdBy: BelongsTo<typeof User>

  @hasMany(() => GradeImportRow)
  declare rows: HasMany<typeof GradeImportRow>
}
