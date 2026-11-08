import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M6: avisos no sistema (vínculo de responsável criado, pendente ou desfeito; notas publicadas
 * na fase 3). Cada pessoa vê só os próprios avisos.
 */
export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('kind', 40).notNullable()
      table.string('title', 160).notNullable()
      table.text('body').nullable()
      table.string('link', 200).nullable()
      table.timestamp('read_at').nullable()

      table.timestamp('created_at').notNullable()

      table.index(['user_id', 'read_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
