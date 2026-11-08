import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M7 (1/2): vínculo entre responsável e aluno. O responsável fica ligado ao aluno, não à
 * turma. A linha nunca é apagada pela API: muda para `revoked` ou `blocked`, com autor,
 * data e motivo. As FKs para users são CASCADE, que é o caminho da eliminação de conta.
 */
export default class extends BaseSchema {
  protected tableName = 'guardian_links'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('guardian_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('student_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      // mae, pai, responsavel_legal ou outro
      table.string('relationship', 30).notNullable()
      // pending, active, revoked ou blocked
      table.string('status', 20).notNullable().defaultTo('pending')
      // student_code, admin_code ou admin
      table.string('origin', 20).notNullable()
      // O aluno adulto escolhe; para o aluno menor o campo é ignorado.
      table.boolean('share_grades').notNullable().defaultTo(false)
      // Ligado quando o aluno deixa de ser menor: ele confirma ou encerra o vínculo.
      table.boolean('needs_review').notNullable().defaultTo(false)
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('approved_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('approved_at').nullable()
      table
        .integer('revoked_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('revoked_at').nullable()
      table.string('revoke_reason', 200).nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['guardian_id', 'student_id'])
      table.index(['student_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
