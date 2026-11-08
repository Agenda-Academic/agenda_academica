import { GradeChangeSchema } from '#database/schema'
import Grade from '#models/grade'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/** De onde veio a mudança: importação, edição na Agenda ou Desfazer de uma importação. */
export type GradeChangeSource = 'import' | 'manual' | 'undo'

/**
 * Histórico de cada nota alterada. `gradeImportId` é a importação de onde veio o valor depois
 * da mudança (nulo quando o valor foi digitado na Agenda). `oldStatus` nulo quer dizer que a
 * nota não existia antes.
 */
export default class GradeChange extends GradeChangeSchema {
  @belongsTo(() => Grade)
  declare grade: BelongsTo<typeof Grade>
}
