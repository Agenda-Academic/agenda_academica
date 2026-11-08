import type TeachingAssignment from '#models/teaching_assignment'
import { BaseTransformer } from '@adonisjs/core/transformers'

/** Vínculo de docente na oferta; do docente vão só o id e o nome. */
export default class TeachingAssignmentTransformer extends BaseTransformer<TeachingAssignment> {
  toObject() {
    const teacher = this.resource.teacher
    return {
      ...this.pick(this.resource, ['id', 'teacherId', 'academicClassId', 'subjectId', 'role']),
      // Vínculo recém-criado não tem a coluna carregada: sai `null`, não some da resposta.
      endedAt: this.resource.endedAt ?? null,
      teacher: teacher ? { id: teacher.id, fullName: teacher.fullName } : null,
    }
  }
}
