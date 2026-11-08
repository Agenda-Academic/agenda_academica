import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M3: a disciplina ofertada na turma, com ou sem docente.
 * Já nasce com uma oferta para cada par de turma e disciplina usado em vínculos ou eventos.
 */
export default class extends BaseSchema {
  protected tableName = 'class_subjects'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('academic_class_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('academic_classes')
        .onDelete('RESTRICT')
      table
        .integer('subject_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('subjects')
        .onDelete('RESTRICT')
      table.timestamp('archived_at').nullable()
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['academic_class_id', 'subject_id'])
    })

    this.schema.raw(`
      INSERT INTO class_subjects (academic_class_id, subject_id, created_at, updated_at)
      SELECT academic_class_id, subject_id, datetime('now'), datetime('now') FROM (
        SELECT academic_class_id, subject_id FROM teaching_assignments
        UNION
        SELECT academic_class_id, subject_id FROM academic_events
        WHERE academic_class_id IS NOT NULL AND subject_id IS NOT NULL
      )
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
