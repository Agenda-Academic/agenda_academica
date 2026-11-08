import type GradeImportRow from '#models/grade_import_row'
import { formatScore } from '#services/grade_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Linha da prévia da importação. Do aluno casado vão só o id e o nome; `nameHint` é o nome que
 * veio no arquivo, só para conferir.
 */
export default class GradeImportRowTransformer extends BaseTransformer<GradeImportRow> {
  toObject() {
    const row = this.resource
    const student = row.studentId ? row.student : null
    return {
      id: row.id,
      rowNumber: row.rowNumber,
      kind: row.kind,
      message: row.message,
      identifier: row.identifier,
      nameHint: row.nameHint,
      rawScore: row.rawScore,
      student: student ? { id: student.id, fullName: student.fullName } : null,
      score: row.score,
      scoreText: formatScore(row.score),
      previousScore: row.previousScore,
      previousScoreText: formatScore(row.previousScore),
      previousStatus: row.previousStatus,
    }
  }
}
