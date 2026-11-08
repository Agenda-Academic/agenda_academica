import type AcademicClass from '#models/academic_class'
import type GuardianLink from '#models/guardian_link'
import { effectiveShareGrades } from '#services/guardian_link_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Aluno acompanhado, visto pelo responsável (`linkedStudents` do GET /context). Precisa do
 * `student` carregado. Só id, nome, iniciais, parentesco, status, turmas ativas e shareGrades:
 * vínculo pendente ainda não mostra turmas.
 */
export default class LinkedStudentTransformer extends BaseTransformer<GuardianLink> {
  constructor(
    resource: GuardianLink,
    /** Turmas ativas de cada aluno, pelo id do aluno. */
    protected classesByStudent: Map<number, AcademicClass[]> = new Map()
  ) {
    super(resource)
  }

  toObject() {
    const link = this.resource
    const student = link.student
    const active = link.status === 'active'
    return {
      id: link.studentId,
      linkId: link.id,
      fullName: student?.fullName ?? null,
      initials: student?.initials ?? null,
      relationship: link.relationship,
      status: link.status,
      since: link.approvedAt ?? link.createdAt,
      shareGrades: active && student ? effectiveShareGrades(link, student) : false,
      classes: active
        ? (this.classesByStudent.get(link.studentId) ?? []).map((academicClass) => ({
            id: academicClass.id,
            name: academicClass.name,
            period: academicClass.period,
            year: academicClass.year,
            semester: academicClass.semester,
            shift: academicClass.shift,
            course: academicClass.course
              ? {
                  id: academicClass.course.id,
                  code: academicClass.course.code,
                  name: academicClass.course.name,
                }
              : null,
          }))
        : [],
    }
  }
}
