import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M5: registro de quem fez o quê. Guarda só ids e valores de antes e depois, sem IP,
 * nome, e-mail ou nota.
 */
export default class extends BaseSchema {
  protected tableName = 'audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('actor_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('action', 60).notNullable()
      table.string('entity', 40).notNullable()
      table.integer('entity_id').unsigned().nullable()
      // De quem são os dados. Sem FK: o registro guarda só o id, mesmo depois de a conta sair.
      table.integer('subject_user_id').unsigned().nullable()
      table.text('meta').nullable()

      table.timestamp('created_at').notNullable()

      table.index(['entity', 'entity_id'])
      table.index(['subject_user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
