import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * M8: notas. Colunas de publicação em academic_events e as tabelas grade_imports, grades,
 * grade_changes e grade_import_rows.
 *
 * As colunas novas de academic_events entram com ADD COLUMN: a FK de grades_published_by_id
 * vai em SQL direto, porque o Knex recriaria a tabela para acrescentar uma FK no SQLite, e o
 * DROP TABLE interno dispararia o CASCADE em reminders.
 *
 * Nota em centésimos (7,5 vira 750). Célula vazia não cria linha. As FKs para o evento são
 * RESTRICT: a API devolve 409 antes de excluir evento com nota, e o banco é a segunda barreira.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('academic_events', (table) => {
      table.timestamp('grades_published_at').nullable()
    })
    this.schema.raw(
      'ALTER TABLE academic_events ADD COLUMN grades_published_by_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL'
    )

    this.schema.createTable('grade_imports', (table) => {
      table.increments('id')
      table
        .integer('academic_event_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('academic_events')
        .onDelete('RESTRICT')
      table
        .integer('created_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // modelo, suap, moodle ou classroom
      table.string('source', 20).notNullable()
      table.string('file_name', 200).notNullable()
      table.string('checksum', 128).nullable()
      // JSON com a coluna do identificador, o tipo dele e a coluna da nota.
      table.text('mapping').notNullable()
      // Data do arquivo no computador da docente: nota mudada na Agenda depois dela é
      // `newer_in_agenda` na prévia.
      table.timestamp('file_modified_at').nullable()
      // draft, applied, discarded ou undone
      table.string('status', 20).notNullable().defaultTo('draft')
      table.integer('new_count').notNullable().defaultTo(0)
      table.integer('changed_count').notNullable().defaultTo(0)
      table.integer('same_count').notNullable().defaultTo(0)
      table.integer('newer_count').notNullable().defaultTo(0)
      table.integer('rejected_count').notNullable().defaultTo(0)
      table.timestamp('applied_at').nullable()
      table.timestamp('undone_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.index(['academic_event_id', 'status'])
    })

    this.schema.createTable('grades', (table) => {
      table.increments('id')
      table
        .integer('academic_event_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('academic_events')
        .onDelete('RESTRICT')
      table
        .integer('student_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      // Centésimos: 7,5 vira 750. Nulo só para falta ou dispensa.
      table.integer('score').nullable()
      // graded, absent ou excused
      table.string('status', 20).notNullable().defaultTo('graded')
      table
        .integer('grade_import_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('grade_imports')
        .onDelete('SET NULL')
      table
        .integer('updated_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at')

      table.unique(['academic_event_id', 'student_id'])
      table.index(['student_id'])
    })

    this.schema.createTable('grade_changes', (table) => {
      table.increments('id')
      table
        .integer('grade_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('grades')
        .onDelete('CASCADE')
      table.integer('old_score').nullable()
      table.integer('new_score').nullable()
      // Nulo em old_status: a nota não existia antes desta mudança.
      table.string('old_status', 20).nullable()
      table.string('new_status', 20).nullable()
      // import, manual ou undo
      table.string('source', 10).notNullable()
      // A importação de onde veio o valor depois desta mudança (nulo quando foi manual).
      table
        .integer('grade_import_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('grade_imports')
        .onDelete('SET NULL')
      table
        .integer('changed_by_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()

      table.index(['grade_id'])
      table.index(['grade_import_id'])
    })

    this.schema.createTable('grade_import_rows', (table) => {
      table.increments('id')
      table
        .integer('grade_import_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('grade_imports')
        .onDelete('CASCADE')
      table.integer('row_number').notNullable()
      // Normalizado: minúsculo, sem espaços e, na matrícula, sem zeros à esquerda.
      table.string('identifier', 254).nullable()
      // Só para conferir na prévia.
      table.string('name_hint', 160).nullable()
      table.string('raw_score', 40).nullable()
      table
        .integer('student_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.integer('score').nullable()
      table.integer('previous_score').nullable()
      table.string('previous_status', 20).nullable()
      // new, changed, same, no_match, not_enrolled, invalid, duplicate ou newer_in_agenda
      table.string('kind', 20).notNullable()
      table.string('message', 200).nullable()

      table.index(['grade_import_id'])
    })
  }

  async down() {
    this.schema.dropTable('grade_import_rows')
    this.schema.dropTable('grade_changes')
    this.schema.dropTable('grades')
    this.schema.dropTable('grade_imports')
    // DROP COLUMN direto: o dropColumn do Knex recriaria academic_events, e o DROP TABLE
    // interno dispararia o CASCADE em reminders.
    this.schema.raw('ALTER TABLE academic_events DROP COLUMN grades_published_by_id')
    this.schema.raw('ALTER TABLE academic_events DROP COLUMN grades_published_at')
  }
}
