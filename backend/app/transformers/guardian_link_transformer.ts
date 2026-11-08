import type GuardianLink from '#models/guardian_link'
import type User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import { effectiveShareGrades } from '#services/guardian_link_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Vínculo visto pelo aluno (`student`, em GET /me/guardians) ou pela administração (`admin`,
 * no painel do aluno). Precisa do `guardian` carregado. Do responsável, só nome e parentesco
 * para o aluno; a administração vê também o e-mail e o histórico de quem aprovou ou desfez.
 *
 * `shareGrades` é o efetivo: aluno menor, o responsável sempre vê as notas publicadas.
 */
export default class GuardianLinkTransformer extends BaseTransformer<GuardianLink> {
  constructor(
    resource: GuardianLink,
    /** O aluno do vínculo; sem ele, vale o `student` carregado no vínculo. */
    protected student: User | null,
    protected view: 'student' | 'admin' = 'student'
  ) {
    super(resource)
  }

  toObject() {
    const link = this.resource
    const guardian = link.guardian
    const student = this.student ?? link.student
    const base = {
      id: link.id,
      guardianId: link.guardianId,
      studentId: link.studentId,
      fullName: guardian?.fullName ?? null,
      initials: guardian?.initials ?? null,
      relationship: link.relationship,
      status: link.status,
      origin: link.origin,
      shareGrades: student ? effectiveShareGrades(link, student) : link.shareGrades,
      needsReview: link.needsReview,
      since: link.approvedAt ?? link.createdAt,
      createdAt: link.createdAt,
    }

    if (this.view === 'admin') {
      return {
        ...base,
        email: guardian?.email ?? null,
        // Na lista de vários alunos (GET /guardian-links), cada vínculo diz de quem é.
        ...(!this.student && student
          ? {
              student: {
                id: student.id,
                fullName: student.fullName,
                email: student.email,
                isMinor: student.isMinor,
              },
            }
          : {}),
        createdById: link.createdById,
        approvedById: link.approvedById,
        approvedAt: link.approvedAt,
        revokedById: link.revokedById,
        revokedAt: link.revokedAt,
        revokeReason: link.revokeReason,
      }
    }

    // O aluno adulto desfaz qualquer vínculo; o menor, só os que nasceram de código dele.
    return {
      ...base,
      canRemove: student ? AcademicAccessService.canRemoveGuardianLink(student, link) : false,
      canShareGrades: student ? !student.isMinor : false,
    }
  }
}
