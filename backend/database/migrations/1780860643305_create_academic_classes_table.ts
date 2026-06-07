import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'academic_classes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('course_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('courses')
        .onDelete('CASCADE')
      table.string('name').notNullable()
      table.string('period').notNullable()
      table.integer('year').notNullable()
      table.integer('semester').notNullable()
      table.string('shift').notNullable().defaultTo('matutino')
      table.boolean('active').notNullable().defaultTo(true)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['course_id', 'name', 'year', 'semester'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
