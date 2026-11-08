import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Turma anual: a turma do curso integrado não tem semestre e grava `semester = 0`.
 *
 * Só UPDATE: a coluna continua `integer NOT NULL`. Mudar a coluna no SQLite recriaria
 * academic_classes, e o DROP da tabela antiga dispararia o CASCADE em matrículas, convites,
 * eventos, ofertas e vínculos de docente.
 *
 * A unique (course_id, name, year, semester) continua valendo. Se o curso integrado tiver a
 * mesma turma em 2026/1 e 2026/2, só a de menor id vira anual e a outra fica como está (a
 * administração renomeia ou exclui); assim o UPDATE nunca quebra a unique nem trava o deploy.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      UPDATE academic_classes SET semester = 0
      WHERE semester <> 0
        AND course_id IN (SELECT id FROM courses WHERE modality = 'integrado')
        AND NOT EXISTS (
          SELECT 1 FROM academic_classes AS other
          WHERE other.course_id = academic_classes.course_id
            AND other.name = academic_classes.name
            AND other.year = academic_classes.year
            AND other.id <> academic_classes.id
            AND (other.semester = 0 OR other.id < academic_classes.id)
        )
    `)
  }

  async down() {
    // Volta para o 1º semestre; se já existe a mesma turma no 1º, vai para o 2º.
    this.schema.raw(`
      UPDATE academic_classes SET semester = 1
      WHERE semester = 0
        AND NOT EXISTS (
          SELECT 1 FROM academic_classes AS other
          WHERE other.course_id = academic_classes.course_id
            AND other.name = academic_classes.name
            AND other.year = academic_classes.year
            AND other.semester = 1
        )
    `)
    this.schema.raw(`
      UPDATE academic_classes SET semester = 2
      WHERE semester = 0
        AND NOT EXISTS (
          SELECT 1 FROM academic_classes AS other
          WHERE other.course_id = academic_classes.course_id
            AND other.name = academic_classes.name
            AND other.year = academic_classes.year
            AND other.semester = 2
        )
    `)
  }
}
