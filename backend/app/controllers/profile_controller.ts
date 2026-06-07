import UserTransformer from '#transformers/user_transformer'
import { updateProfileValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProfileController {
  async show({ auth, serialize }: HttpContext) {
    return serialize(UserTransformer.transform(auth.getUserOrFail()))
  }

  async update({ auth, request, serialize }: HttpContext) {
    const payload = await request.validateUsing(updateProfileValidator)
    const user = auth.getUserOrFail()

    user.merge(payload)
    await user.save()

    return serialize(UserTransformer.transform(user))
  }
}
