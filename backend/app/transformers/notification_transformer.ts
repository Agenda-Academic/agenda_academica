import type Notification from '#models/notification'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class NotificationTransformer extends BaseTransformer<Notification> {
  toObject() {
    return this.pick(this.resource, ['id', 'kind', 'title', 'body', 'link', 'readAt', 'createdAt'])
  }
}
