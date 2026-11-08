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
