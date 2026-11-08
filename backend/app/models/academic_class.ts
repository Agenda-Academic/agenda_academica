import { AcademicClassSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import ClassInvite from '#models/class_invite'
import ClassSubject from '#models/class_subject'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import TeachingAssignment from '#models/teaching_assignment'
import { belongsTo, column, hasMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

/**
 * Semestre da turma anual. A turma do curso integrado é anual ("INF 3A, 2026, 3º ano") e
 * grava semestre 0; a coluna continua NOT NULL, porque mudar a coluna no SQLite recriaria a
 * tabela, e o DROP dela dispararia o CASCADE em matrículas, eventos e ofertas.
 */
export const ANNUAL_SEMESTER = 0

/** Ano e semestre para texto montado pela API: "2026/2", ou só "2026" na turma anual. */
export function classTerm(year: number, semester: number) {
  return semester === ANNUAL_SEMESTER ? String(year) : `${year}/${semester}`
}

export default class AcademicClass extends AcademicClassSchema {
  // O código da turma nunca sai no serialize (catalog, eventos): só nas rotas da turma,
  // para a administração e a docente da turma.
  @column({ serializeAs: null })
  declare joinCode: string | null

  @column({ serializeAs: null, consume: (value) => Boolean(value) })
  declare joinCodeActive: boolean

  /** Turmas que não foram arquivadas: catalog, seletores, busca, painéis e permissões. */
  static withoutArchived = scope((query) => {
    query.whereNull('archivedAt')
  })

  get isArchived() {
    return this.archivedAt !== null
  }

  /** Turma anual (curso integrado): sem semestre. */
  get isAnnual() {
    return this.semester === ANNUAL_SEMESTER
  }

  @belongsTo(() => Course)
  declare course: BelongsTo<typeof Course>

  @hasMany(() => Enrollment)
  declare enrollments: HasMany<typeof Enrollment>

  @hasMany(() => TeachingAssignment)
  declare teachingAssignments: HasMany<typeof TeachingAssignment>

  @hasMany(() => AcademicEvent)
  declare events: HasMany<typeof AcademicEvent>

  @hasMany(() => ClassSubject)
  declare classSubjects: HasMany<typeof ClassSubject>

  @hasMany(() => ClassInvite)
  declare invites: HasMany<typeof ClassInvite>
}
