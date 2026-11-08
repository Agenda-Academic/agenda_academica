import type GradeImport from '#models/grade_import'
import type GradeImportRow from '#models/grade_import_row'
import { GRADE_ROW_KINDS } from '#models/grade_import_row'
import { sortRows } from '#services/grade_service'
import GradeImportRowTransformer from '#transformers/grade_import_row_transformer'
import { BaseTransformer } from '@adonisjs/core/transformers'

/** O que a pessoa pode fazer com a importação (botões Aplicar, Descartar e Desfazer). */
export type GradeImportPermissions = { canApply: boolean; canDiscard: boolean; canUndo: boolean }

/**
 * Importação de notas: o resumo com os totais e, no rascunho, as linhas da prévia (as com
 * problema primeiro). Depois de aplicar ou descartar, as linhas não existem mais.
 */
export default class GradeImportTransformer extends BaseTransformer<GradeImport> {
  constructor(
    resource: GradeImport,
    protected permissions: GradeImportPermissions | null = null,
    protected rows: GradeImportRow[] | null = null
  ) {
    super(resource)
  }

  toObject() {
    const item = this.resource
    const createdBy = item.createdById ? item.createdBy : null
    const breakdown = this.rows
      ? Object.fromEntries(
          GRADE_ROW_KINDS.map((kind) => [
            kind,
            this.rows!.filter((row) => row.kind === kind).length,
          ])
        )
      : null
    return {
      id: item.id,
      academicEventId: item.academicEventId,
      source: item.source,
      fileName: item.fileName,
      checksum: item.checksum,
      mapping: item.parsedMapping,
      fileModifiedAt: item.fileModifiedAt ?? null,
      status: item.status,
      totals: {
        new: item.newCount,
        changed: item.changedCount,
        same: item.sameCount,
        newerInAgenda: item.newerCount,
        rejected: item.rejectedCount,
      },
      createdAt: item.createdAt,
      // Importação recém-criada não tem as colunas carregadas: saem null, não somem.
      appliedAt: item.appliedAt ?? null,
      undoneAt: item.undoneAt ?? null,
      createdBy: createdBy ? { id: createdBy.id, fullName: createdBy.fullName } : null,
      ...(this.permissions ?? {}),
      ...(breakdown ? { breakdown } : {}),
      ...(this.rows ? { rows: GradeImportRowTransformer.transform(sortRows(this.rows)) } : {}),
    }
  }
}
