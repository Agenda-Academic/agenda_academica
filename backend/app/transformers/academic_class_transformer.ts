import type AcademicClass from '#models/academic_class'
import type { ClassStats } from '#services/class_stats_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

/** Turma na lista da gestão: dados, curso e contagens. Nunca leva o código da turma. */
export default class AcademicClassTransformer extends BaseTransformer<AcademicClass> {
  constructor(
    resource: AcademicClass,
    protected stats?: Map<number, ClassStats>
  ) {
    super(resource)
  }

  toObject() {
    const course = this.resource.course
    return {
      ...this.pick(this.resource, [
        'id',
        'courseId',
        'name',
        'period',
        'year',
        'semester',
        'shift',
        'archivedAt',
      ]),
      active: Boolean(this.resource.active),
      course: course
        ? { id: course.id, code: course.code, name: course.name, modality: course.modality }
        : null,
      counts: this.stats?.get(this.resource.id) ?? null,
    }
  }
}
