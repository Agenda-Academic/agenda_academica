import type AcademicClass from '#models/academic_class'
import type Subject from '#models/subject'
import type User from '#models/user'
import type { LucidModel, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

/** Quantas linhas a consulta acha. */
export async function countOf(query: ModelQueryBuilderContract<LucidModel, any>) {
  const rows = await query.count('* as total')
  return Number(rows[0]?.$extras.total ?? 0)
}

/**
 * Preload do docente com só o id e o nome: `.preload('teacher', publicTeacher)`.
 * Nada de e-mail, papel ou matrícula do docente nas respostas de eventos e lembretes.
 */
export function publicTeacher(teacherQuery: ModelQueryBuilderContract<typeof User>) {
  teacherQuery.select('id', 'fullName')
}

/**
 * Turma enxuta para a lista de eventos (`GET /events`), que vai inteira para a tela: só o que a
 * tela lê de cada evento. Sem o curso aninhado nem as datas de criação, que pesavam quase 40% de
 * cada evento. O detalhe (`GET /events/:id`) continua com a turma completa.
 */
export function listedClass(classQuery: ModelQueryBuilderContract<typeof AcademicClass>) {
  classQuery.select(
    'id',
    'courseId',
    'name',
    'period',
    'year',
    'semester',
    'shift',
    'active',
    'archivedAt'
  )
}

/** Disciplina enxuta para a lista de eventos (mesmo motivo de `listedClass`). */
export function listedSubject(subjectQuery: ModelQueryBuilderContract<typeof Subject>) {
  subjectQuery.select('id', 'code', 'name', 'active', 'archivedAt')
}
