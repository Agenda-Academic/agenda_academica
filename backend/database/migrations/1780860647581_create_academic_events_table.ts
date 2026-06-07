import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'academic_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.text('description').nullable()
      table.string('category').notNullable()
      table.string('source').notNullable().defaultTo('teacher')
      table.string('status').notNullable().defaultTo('scheduled')
      table.timestamp('starts_at').notNullable()
      table.timestamp('ends_at').nullable()
      table.decimal('points', 5, 2).nullable()
      table.string('location').nullable()
      table.string('color').nullable()
      table
        .integer('academic_class_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('academic_classes')
        .onDelete('CASCADE')
      table
        .integer('subject_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('subjects')
        .onDelete('SET NULL')
      table
        .integer('teacher_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.integer('calendar_import_id').unsigned().nullable()
      table.string('source_external_id').nullable()
      table.boolean('official_priority').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.index(['category', 'starts_at'])
      table.index(['academic_class_id', 'starts_at'])
      table.index(['source', 'starts_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
