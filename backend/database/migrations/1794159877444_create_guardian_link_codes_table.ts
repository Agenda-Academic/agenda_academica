import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M7 (2/2): códigos de uso único para o responsável se vincular ao aluno. O código em claro
 * nunca é guardado: só o HMAC-SHA256 do código normalizado, com a APP_KEY.
 */
export default class extends BaseSchema {
  protected tableName = 'guardian_link_codes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('student_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('code_hash', 64).notNullable().unique()
      // student (7 dias) ou admin (30 dias, para entregar em papel)
      table.string('kind', 10).notNullable()
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('expires_at').notNullable()
      table.timestamp('used_at').nullable()
      table
        .integer('used_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('revoked_at').nullable()

      table.timestamp('created_at').notNullable()

      table.index(['student_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
