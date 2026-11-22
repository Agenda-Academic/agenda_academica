import { GRADE_STATUSES } from '#models/grade'
import {
  GRADE_IMPORT_IDENTIFIER_TYPES,
  GRADE_IMPORT_SOURCES,
  MAX_IMPORT_ROWS,
} from '#models/grade_import'
import { withMessages } from '#validators/management'
import vine from '@vinejs/vine'

/** Validadores da fase 3 (notas), com as mensagens em português da gestão. */

const columnName = () => vine.string().trim().minLength(1).maxLength(100)

/** Célula do arquivo: texto do CSV ou número do XLSX. */
const cellValue = (max: number) =>
  vine
    .unionOfTypes([vine.string().maxLength(max), vine.number()])
    .nullable()
    .optional()

/**
 * POST /grade-imports: o front lê o CSV ou o XLSX e manda só as linhas, com a coluna do aluno
 * (e-mail, matrícula ou nome) e a da nota. `points` só vale quando o evento ainda não tem
 * valor máximo.
 */
export const createGradeImportValidator = withMessages(
  vine.create({
    academicEventId: vine.number().withoutDecimals().min(1),
    source: vine.enum(GRADE_IMPORT_SOURCES),
    fileName: vine.string().trim().minLength(1).maxLength(200),
    checksum: vine.string().trim().minLength(1).maxLength(128),
    fileModifiedAt: vine.string().trim().maxLength(40).nullable().optional(),
    points: vine.number().min(0.01).max(999.99).nullable().optional(),
    mapping: vine.object({
      identifierType: vine.enum(GRADE_IMPORT_IDENTIFIER_TYPES),
      identifierColumn: columnName(),
      scoreColumn: columnName(),
      nameColumn: columnName().nullable().optional(),
    }),
    rows: vine
      .array(
        vine.object({
          rowNumber: vine.number().withoutDecimals().min(1).max(1_000_000).optional(),
          identifier: cellValue(254),
          name: vine.string().maxLength(200).nullable().optional(),
          score: cellValue(40),
        })
      )
      .minLength(1)
      .maxLength(MAX_IMPORT_ROWS),
  })
)

/** POST /grade-imports/:id/apply: manter (padrão) ou substituir as notas mudadas na Agenda. */
export const applyGradeImportValidator = withMessages(
  vine.create({
    keepAgendaWhenNewer: vine.boolean().optional(),
  })
)

/**
 * PUT /events/:id/grades/:studentId: `score` em centésimos (7,5 é 750), de 0 até o valor da
 * avaliação; `status` falta ou dispensa, sem nota. `{ score: null }` apaga a nota.
 */
export const updateGradeValidator = withMessages(
  vine.create({
    score: vine.number().withoutDecimals().min(0).max(100_000).nullable().optional(),
    status: vine.enum(GRADE_STATUSES).optional(),
  })
)

/** Situações aceitas no lançamento em lote: as da nota e `cleared` (apaga a nota). */
export const BULK_GRADE_STATUSES = [...GRADE_STATUSES, 'cleared'] as const
export type BulkGradeStatus = (typeof BULK_GRADE_STATUSES)[number]

/** Linhas por lançamento em lote (a planilha manda a turma inteira de uma vez). */
export const MAX_BULK_GRADES = 500

/**
 * PUT /events/:id/grades: a planilha de notas manda todas as linhas alteradas de uma vez.
 * `score` em centésimos como no PUT por aluno; `status` obrigatório em cada linha.
 */
export const bulkGradesValidator = withMessages(
  vine.create({
    grades: vine
      .array(
        vine.object({
          studentId: vine.number().withoutDecimals().min(1),
          score: vine.number().withoutDecimals().min(0).max(100_000).nullable().optional(),
          status: vine.enum(BULK_GRADE_STATUSES),
        })
      )
      .minLength(1)
      .maxLength(MAX_BULK_GRADES),
  })
)
