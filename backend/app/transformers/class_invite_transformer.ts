import type ClassInvite from '#models/class_invite'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class ClassInviteTransformer extends BaseTransformer<ClassInvite> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'academicClassId',
      'email',
      'registration',
      'createdAt',
      'acceptedAt',
    ])
  }
}
