import type Course from '#models/course'
import { BaseTransformer } from '@adonisjs/core/transformers'

export type CourseStats = { classes: number; activeClasses: number }

export default class CourseTransformer extends BaseTransformer<Course> {
  constructor(
    resource: Course,
    protected stats?: Map<number, CourseStats>
  ) {
    super(resource)
  }

  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'code', 'name', 'campus', 'modality', 'archivedAt']),
      active: Boolean(this.resource.active),
      counts: this.stats?.get(this.resource.id) ?? { classes: 0, activeClasses: 0 },
    }
  }
}
