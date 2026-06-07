import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'teaching_assignments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('teacher_id')
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
      table
        .integer('subject_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('CASCADE')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['teacher_id', 'academic_class_id', 'subject_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
