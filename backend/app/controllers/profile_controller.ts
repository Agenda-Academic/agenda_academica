import { fieldError } from '#services/api_errors'
import UserTransformer from '#transformers/user_transformer'
import { updateProfileValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'

export default class ProfileController {
  async show({ auth, serialize }: HttpContext) {
    return serialize(UserTransformer.transform(auth.getUserOrFail()))
  }

  async update({ auth, request, response, serialize }: HttpContext) {
    const payload = await request.validateUsing(updateProfileValidator)
    const user = auth.getUserOrFail()

    // O aluno vê pelo nome quem acompanha a agenda dele: o responsável não fica sem nome,
    // como no cadastro.
    if (user.role === 'guardian' && payload.fullName !== undefined && !payload.fullName?.trim()) {
      return fieldError(
        response,
        'fullName',
        'Informe seu nome. O aluno vê quem acompanha a agenda dele.',
        'required'
      )
    }

    user.merge(payload)
    await user.save()

    return serialize(UserTransformer.transform(user))
  }
}
