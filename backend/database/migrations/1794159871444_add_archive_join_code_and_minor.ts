import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M2: arquivamento, código da turma, aluno menor, status da matrícula e fim do vínculo docente.
 *
 * Só ADD COLUMN e índices: nenhuma tabela é recriada, então nenhum CASCADE dispara.
 * A FK de enrollments.decided_by_id vai em SQL direto, porque o Knex recriaria a tabela
 * para acrescentar uma FK no SQLite.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.boolean('is_minor').notNullable().defaultTo(false)
    })

    this.schema.alterTable('courses', (table) => {
      table.string('modality').notNullable().defaultTo('superior')
      table.timestamp('archived_at').nullable()
    })

    this.schema.alterTable('academic_classes', (table) => {
      table.timestamp('archived_at').nullable()
      table.string('join_code', 8).nullable().unique()
      table.boolean('join_code_active').notNullable().defaultTo(false)
    })

    this.schema.alterTable('subjects', (table) => {
      table.timestamp('archived_at').nullable()
    })

    this.schema.alterTable('enrollments', (table) => {
      table.string('source').notNullable().defaultTo('admin')
      table.string('registration').nullable()
      table.timestamp('decided_at').nullable()
      table.index(['academic_class_id', 'status'])
    })
    this.schema.raw(
      'ALTER TABLE enrollments ADD COLUMN decided_by_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL'
    )
    this.schema.raw(
      'CREATE UNIQUE INDEX enrollments_class_registration_unique ON enrollments (academic_class_id, registration) WHERE registration IS NOT NULL'
    )

    this.schema.alterTable('teaching_assignments', (table) => {
      table.string('role').notNullable().defaultTo('titular')
      table.timestamp('ended_at').nullable()
    })
  }

  async down() {
    // DROP COLUMN direto: o dropColumn do Knex recriaria users, courses, academic_classes e
    // subjects, e o DROP TABLE interno dispararia o CASCADE nas tabelas filhas.
    this.schema.raw('ALTER TABLE teaching_assignments DROP COLUMN ended_at')
    this.schema.raw('ALTER TABLE teaching_assignments DROP COLUMN role')

    this.schema.raw('DROP INDEX IF EXISTS enrollments_class_registration_unique')
    this.schema.alterTable('enrollments', (table) => {
      table.dropIndex(['academic_class_id', 'status'])
    })
    // enrollments não tem tabela filha, então recriá-la para tirar a FK não apaga nada.
    this.schema.alterTable('enrollments', (table) => {
      table.dropColumn('decided_by_id')
    })
    this.schema.raw('ALTER TABLE enrollments DROP COLUMN decided_at')
    this.schema.raw('ALTER TABLE enrollments DROP COLUMN registration')
    this.schema.raw('ALTER TABLE enrollments DROP COLUMN source')

    this.schema.raw('ALTER TABLE subjects DROP COLUMN archived_at')

    this.schema.raw('DROP INDEX IF EXISTS academic_classes_join_code_unique')
    this.schema.raw('ALTER TABLE academic_classes DROP COLUMN join_code_active')
    this.schema.raw('ALTER TABLE academic_classes DROP COLUMN join_code')
    this.schema.raw('ALTER TABLE academic_classes DROP COLUMN archived_at')

    this.schema.raw('ALTER TABLE courses DROP COLUMN archived_at')
    this.schema.raw('ALTER TABLE courses DROP COLUMN modality')

    this.schema.raw('ALTER TABLE users DROP COLUMN is_minor')
  }
}
