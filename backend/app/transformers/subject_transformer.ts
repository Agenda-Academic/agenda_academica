import type Subject from '#models/subject'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class SubjectTransformer extends BaseTransformer<Subject> {
  /** `usedIn` vai só para a administração: em quantas turmas não arquivadas é ofertada. */
  constructor(
    resource: Subject,
    protected usedIn?: Map<number, number>
  ) {
    super(resource)
  }

  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'code', 'name', 'workloadHours', 'archivedAt']),
      active: Boolean(this.resource.active),
      ...(this.usedIn ? { usedIn: this.usedIn.get(this.resource.id) ?? 0 } : {}),
    }
  }
}
