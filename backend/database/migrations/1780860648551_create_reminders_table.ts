import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'reminders'

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
      table
        .integer('academic_event_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('academic_events')
        .onDelete('CASCADE')
      table.string('channel').notNullable().defaultTo('email')
      table.integer('offset_minutes').notNullable().defaultTo(1440)
      table.timestamp('send_at').notNullable()
      table.timestamp('sent_at').nullable()
      table.boolean('enabled').notNullable().defaultTo(true)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['user_id', 'academic_event_id', 'channel'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
