import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M4: e-mail da lista da turma que ainda não tem conta. Vira matrícula no cadastro.
 */
export default class extends BaseSchema {
  protected tableName = 'class_invites'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('academic_class_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('academic_classes')
        .onDelete('CASCADE')
      table.string('email', 254).notNullable()
      table.string('registration').nullable()
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('accepted_at').nullable()

      table.timestamp('created_at').notNullable()

      table.unique(['academic_class_id', 'email'])
      table.index(['email'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
