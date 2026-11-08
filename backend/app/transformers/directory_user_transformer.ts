import type User from '#models/user'
import { BaseTransformer } from '@adonisjs/core/transformers'

/** Pessoa na busca da administração (GET /users): só id, nome, e-mail e papel. */
export default class DirectoryUserTransformer extends BaseTransformer<User> {
  toObject() {
    return this.pick(this.resource, ['id', 'fullName', 'email', 'role'])
  }
}
