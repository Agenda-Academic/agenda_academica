import User from '#models/user'
import AcademicAccessService, { ROLES } from '#services/academic_access_service'
import AccountPolicyService from '#services/account_policy_service'
import { conflict, fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AuditLogService from '#services/audit_log_service'
import GuardianLinkService from '#services/guardian_link_service'
import DirectoryUserTransformer from '#transformers/directory_user_transformer'
import { updateUserValidator } from '#validators/guardian'
import { updateUserRoleValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

/** Mensagens da troca de papel (PATCH /users/:id/role), também usadas nos testes. */
export const ROLE_MESSAGES = {
  forbidden: 'Só a administração principal define quem é coordenação.',
  notTeacher: 'Só uma conta de docente pode entrar na coordenação. Aluno e responsável não entram.',
  notAdmin: 'Só quem é da coordenação pode voltar a ser docente.',
  ownAccess:
    'Você não pode tirar o seu próprio acesso de coordenação. Peça a outra pessoa da coordenação.',
  rootAdmin:
    'Esta é a coordenação principal, definida na configuração do servidor. Ela não sai pela tela.',
} as const

/**
 * GET /users: a administração busca docentes e alunos por nome ou e-mail (até 20; a coordenação,
 * com `role=admin`, vem inteira, até 100).
 * PATCH /users/:id: a administração marca ou desmarca o aluno menor de idade.
 * PATCH /users/:id/role: a administração principal nomeia uma docente ou devolve alguém à docência.
 */
export default class UsersController {
  /**
   * PATCH /users/:id/role com `{ role: 'admin' | 'teacher' }`. Só a administração principal (conta de
   * administração com o e-mail em ADMIN_EMAILS) pede; as outras administrações, como a coordenação nomeada e a
   * conta de demonstração, recebem 403, como docente, aluno e responsável.
   * - `admin`: só quem já é docente entra na coordenação (aluno e responsável nunca: 422 em `role`).
   * - `teacher`: só quem é da coordenação volta a docente (senão, 422 em `role`). Ninguém tira o
   *   próprio acesso (409 `OWN_ACCESS`) e a coordenação principal, com o e-mail em ADMIN_EMAILS,
   *   não sai pela tela (409 `ROOT_ADMIN`).
   * Pedir o papel que a pessoa já tem não muda nada (200). Os vínculos de docente continuam: quem
   * entra na coordenação para de lançar notas e, se voltar a docente, lança de novo nas disciplinas
   * dela. O login com o Google não desfaz a troca: ele só promove quem está em ADMIN_EMAILS.
   */
  async updateRole({ auth, params, request, response, serialize }: HttpContext) {
    const actor = auth.getUserOrFail()
    if (!AcademicAccessService.allow(actor, ['admin']) || !AccountPolicyService.isRootAdmin(actor)) {
      return forbidden(response, ROLE_MESSAGES.forbidden)
    }

    const user = await User.find(routeId(params.id))
    if (!user) {
      return notFound(response, 'Pessoa não encontrada.')
    }
    const { role } = await request.validateUsing(updateUserRoleValidator)

    if (user.role !== role) {
      if (role === 'admin' && user.role !== 'teacher') {
        return fieldError(response, 'role', ROLE_MESSAGES.notTeacher, 'invalid')
      }
      if (role === 'teacher') {
        if (user.role !== 'admin') {
          return fieldError(response, 'role', ROLE_MESSAGES.notAdmin, 'invalid')
        }
        if (user.id === actor.id) {
          return conflict(response, 'OWN_ACCESS', ROLE_MESSAGES.ownAccess)
        }
        if (AccountPolicyService.isAdminEmail(user.email)) {
          return conflict(response, 'ROOT_ADMIN', ROLE_MESSAGES.rootAdmin)
        }
      }

      const before = user.role
      await db.transaction(async (trx) => {
        user.useTransaction(trx)
        user.role = role
        await user.save()
        await AuditLogService.record(
          {
            actorId: actor.id,
            action: role === 'admin' ? 'user.admin_grant' : 'user.admin_revoke',
            entity: 'user',
            entityId: user.id,
            subjectUserId: user.id,
            meta: { from: before, to: role },
          },
          trx
        )
      })
    }

    return serialize(DirectoryUserTransformer.transform(user, actor.id))
  }

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
    const viewer = auth.getUserOrFail()
    if (!AcademicAccessService.allow(viewer, ['admin'])) {
      return forbidden(response, 'Só a administração busca pessoas.')
    }

    const { role, q } = request.qs()
    // a lista da coordenação (card Coordenação da tela Turmas) vem inteira; as buscas, até 20
    const query = User.query()
      .orderBy('fullName', 'asc')
      .orderBy('email', 'asc')
      .limit(role === 'admin' ? 100 : 20)

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
        scope.whereILike('fullName', `%${term}%`).orWhereILike('email', `%${term}%`)
      })
    }

    return serialize(DirectoryUserTransformer.transform(await query, viewer.id))
  }
}
