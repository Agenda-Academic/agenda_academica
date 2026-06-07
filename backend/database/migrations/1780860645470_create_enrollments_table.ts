import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'enrollments'

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
        .integer('academic_class_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('academic_classes')
        .onDelete('CASCADE')
      table.string('status').notNullable().defaultTo('active')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['user_id', 'academic_class_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
