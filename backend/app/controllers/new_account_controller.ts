import User from '#models/user'
import { fieldError } from '#services/api_errors'
import ClassMembershipService from '#services/class_membership_service'
import { signupValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import UserTransformer from '#transformers/user_transformer'

export default class NewAccountController {
  async store({ request, response, serialize }: HttpContext) {
    const { fullName, email, password, role, registration } =
      await request.validateUsing(signupValidator)

    // Do responsável, só nome, e-mail e parentesco (LGPD art. 6º, III). O nome é obrigatório:
    // o aluno vê quem acompanha a agenda dele.
    if (role === 'guardian') {
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
    }

    // Conta e convites na mesma transação: cada convite da lista da turma com este e-mail
    // vira matrícula ativa (source = invite) e o convite recebe accepted_at.
    const user = await db.transaction(async (trx) => {
      const created = await User.create(
        {
          fullName,
          email,
          password,
          role: role ?? 'student',
          registration: role === 'guardian' ? null : registration,
        },
        { client: trx }
      )
      if (created.role === 'student') {
        await ClassMembershipService.acceptInvites(created, trx)
      }
      return created
    })
    await user.refresh()
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }
}
