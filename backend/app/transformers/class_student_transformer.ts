import type Enrollment from '#models/enrollment'
import { BaseTransformer } from '@adonisjs/core/transformers'

/**
 * Aluno na lista da turma (matrícula com o usuário carregado). A matrícula escolar e a marca
 * de menor vão só para a administração.
 */
export default class ClassStudentTransformer extends BaseTransformer<Enrollment> {
  constructor(
    resource: Enrollment,
    protected forAdmin = false
  ) {
    super(resource)
  }

  toObject() {
    const user = this.resource.user
    return {
      enrollmentId: this.resource.id,
      userId: this.resource.userId,
      academicClassId: this.resource.academicClassId,
      fullName: user?.fullName ?? null,
      email: user?.email ?? null,
      status: this.resource.status,
      source: this.resource.source,
      createdAt: this.resource.createdAt,
      decidedAt: this.resource.decidedAt,
      ...(this.forAdmin
        ? { registration: this.resource.registration, isMinor: Boolean(user?.isMinor) }
        : {}),
    }
  }
}
