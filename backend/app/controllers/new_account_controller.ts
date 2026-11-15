import User from '#models/user'
import { STAFF_SIGNUP_GOOGLE_ONLY } from '#services/account_policy_service'
import { fieldError } from '#services/api_errors'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'

export default class NewAccountController {
  /**
   * Cadastro com e-mail e senha: só do responsável. Aluno e docente entram com o Google do IFMS,
   * que confirma que o e-mail é do instituto e cria a conta no primeiro acesso.
   */
  async store({ request, response, serialize }: HttpContext) {
    const { fullName, email, password, role, registration } =
      await request.validateUsing(signupValidator)

    if ((role ?? 'guardian') !== 'guardian') {
      return fieldError(response, 'role', STAFF_SIGNUP_GOOGLE_ONLY, 'google_only')
    }

    // Do responsável, só nome, e-mail e parentesco (LGPD art. 6º, III). O nome é obrigatório:
    // o aluno vê quem acompanha a agenda dele.
    if (registration) {
      return fieldError(
        response,
        'registration',
        'O responsável não informa matrícula. Deixe o campo em branco.',
        'prohibited'
      )
    }
    if (!fullName?.trim()) {
      return fieldError(
        response,
        'fullName',
        'Informe seu nome. O aluno vê quem acompanha a agenda dele.',
        'required'
      )
    }

    const user = await User.create({
      fullName,
      email,
      password,
      role: 'guardian',
      registration: null,
    })
    await user.refresh()
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }
}
