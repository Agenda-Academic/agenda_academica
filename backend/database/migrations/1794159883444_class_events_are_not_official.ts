import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Evento com turma é da turma. Antes, o evento de turma criado pela administração nascia
 * "oficial" e aparecia para todas as turmas (e a docente da disciplina não conseguia editar).
 * Aqui os que já existem voltam a ser só da turma. O calendário importado não tem turma.
 */
export default class extends BaseSchema {
  protected tableName = 'academic_events'

  async up() {
    this.defer(async (db) => {
      await db
        .from(this.tableName)
        .whereNotNull('academic_class_id')
        .where('source', 'official')
        .update({ source: 'teacher', official_priority: false })
    })
  }

  async down() {
    // Sem volta: não dá para saber quais eventos eram oficiais por engano.
  }
}
