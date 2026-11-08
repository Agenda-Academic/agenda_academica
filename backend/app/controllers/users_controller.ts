import User from '#models/user'
import AcademicAccessService, { ROLES } from '#services/academic_access_service'
import { fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AuditLogService from '#services/audit_log_service'
import GuardianLinkService from '#services/guardian_link_service'
import DirectoryUserTransformer from '#transformers/directory_user_transformer'
import { updateUserValidator } from '#validators/guardian'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

/**
 * GET /users: a administração busca docentes e alunos por nome ou e-mail (até 20).
 * PATCH /users/:id: a administração marca ou desmarca o aluno menor de idade.
 */
export default class UsersController {
  /**
   * PATCH /users/:id com `{ isMinor }`. Quando o aluno deixa de ser menor, o compartilhamento
   * de notas de cada vínculo volta a falso, os vínculos ficam para ele confirmar ou encerrar
   * (`needsReview`) e ele recebe um aviso. Quando passa a ser menor, o vínculo de código dele
   * que a secretaria nunca aprovou volta a pendente (`linksToApprove`).
   */
  async update({ auth, params, request, response }: HttpContext) {
    const admin = auth.getUserOrFail()
    if (!AcademicAccessService.allow(admin, ['admin'])) {
      return forbidden(response, 'Só a administração marca o aluno menor de idade.')
    }

    const user = await User.find(routeId(params.id))
    if (!user) {
      return notFound(response, 'Pessoa não encontrada.')
    }
    const { isMinor } = await request.validateUsing(updateUserValidator)
    if (user.role !== 'student') {
      return fieldError(
        response,
        'isMinor',
        'Só a conta de aluno tem a marca de menor de idade.',
        'invalid'
      )
    }

    let changes = { linksToReview: 0, linksToApprove: 0 }
    if (isMinor !== user.isMinor) {
      const before = user.isMinor
      await db.transaction(async (trx) => {
        user.useTransaction(trx)
        user.isMinor = isMinor
        await user.save()

        changes = await GuardianLinkService.applyMinorChange({
          trx,
          student: user,
          before,
          after: isMinor,
          actorId: admin.id,
        })

        await AuditLogService.record(
          {
            actorId: admin.id,
            action: 'user.minor',
            entity: 'user',
            entityId: user.id,
            subjectUserId: user.id,
            meta: { from: before, to: isMinor, ...changes },
          },
          trx
        )
      })
    }

    return {
      data: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isMinor: user.isMinor,
        linksToReview: changes.linksToReview,
        linksToApprove: changes.linksToApprove,
      },
    }
  }

  async index({ auth, request, response, serialize }: HttpContext) {
    if (!AcademicAccessService.allow(auth.getUserOrFail(), ['admin'])) {
      return forbidden(response, 'Só a administração busca pessoas.')
    }

    const { role, q } = request.qs()
    const query = User.query().orderBy('fullName', 'asc').orderBy('email', 'asc').limit(20)

    if (role !== undefined && role !== '') {
      if (!(ROLES as readonly string[]).includes(String(role))) {
        return fieldError(response, 'role', 'Escolha um papel válido.', 'enum')
      }
      query.where('role', String(role))
    }

    const term = String(q ?? '').trim()
    if (term) {
      if (term.length > 100) {
        return fieldError(response, 'q', 'A busca pode ter no máximo 100 caracteres.', 'maxLength')
      }
      query.where((scope) => {
        scope.where('fullName', 'like', `%${term}%`).orWhere('email', 'like', `%${term}%`)
      })
    }

    return serialize(DirectoryUserTransformer.transform(await query))
  }
}
