import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'calendar_imports'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('source_name').notNullable()
      table.string('source_url').nullable()
      table
        .integer('imported_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('imported_at').notNullable()
      table.string('status').notNullable().defaultTo('completed')
      table.integer('total_events').notNullable().defaultTo(0)
      table.string('checksum').nullable()
      table.text('raw_payload').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
