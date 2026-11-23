import JoinCodeService from '#services/join_code_service'
import { BaseSchema } from '@adonisjs/lucid/schema'
import { DateTime } from 'luxon'

/**
 * Entrar na turma pelo código deixou de ser um pedido (decisão de 2026-11-23): quem tem o código
 * entra na hora, e o código é da turma, cuidado pela coordenação. Aqui os dados antigos entram na
 * regra nova:
 * - os pedidos que estavam esperando viram matrícula ativa, e quem entra numa turma do integrado
 *   fica marcado como menor de idade, como na entrada pela tela;
 * - toda turma ainda sem código ganha um, já ligado. Turma com código desligado pela coordenação
 *   continua desligada, e a arquivada fica sem código.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      const now = DateTime.utc().toSQL({ includeOffset: false })

      const integradoPending = await db
        .from('enrollments')
        .join('academic_classes', 'academic_classes.id', 'enrollments.academic_class_id')
        .join('courses', 'courses.id', 'academic_classes.course_id')
        .where('enrollments.status', 'pending')
        .where('courses.modality', 'integrado')
        .select('enrollments.user_id')
      const minors = [...new Set(integradoPending.map((row: { user_id: number }) => row.user_id))]
      if (minors.length) {
        await db.from('users').whereIn('id', minors).update({ is_minor: true, updated_at: now })
      }
      await db
        .from('enrollments')
        .where('status', 'pending')
        .update({ status: 'active', updated_at: now })

      const withoutCode: { id: number }[] = await db
        .from('academic_classes')
        .whereNull('join_code')
        .whereNull('archived_at')
        .select('id')
      const withCode: { join_code: string }[] = await db
        .from('academic_classes')
        .whereNotNull('join_code')
        .select('join_code')
      const taken = new Set(withCode.map((row) => row.join_code))
      for (const academicClass of withoutCode) {
        let code = JoinCodeService.generate()
        while (taken.has(code)) code = JoinCodeService.generate()
        taken.add(code)
        await db
          .from('academic_classes')
          .where('id', academicClass.id)
          .update({ join_code: code, join_code_active: true, updated_at: now })
      }
    })
  }

  /** Não há volta: os pedidos aprovados e os códigos gerados ficam como estão. */
  async down() {}
}
