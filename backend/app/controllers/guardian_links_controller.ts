import GuardianLink, { GUARDIAN_LINK_STATUSES, OPEN_LINK_STATUSES } from '#models/guardian_link'
import GuardianLinkCode, { type GuardianCodeKind } from '#models/guardian_link_code'
import User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import {
  conflict,
  fieldError,
  forbidden,
  notFound,
  routeId,
  STUDENT_NOT_FOUND,
} from '#services/api_errors'
import AttemptLimiterService from '#services/attempt_limiter_service'
import AuditLogService from '#services/audit_log_service'
import GuardianLinkService, {
  ADMIN_CODE_DAYS,
  INVALID_GUARDIAN_CODE,
  LINK_LIMIT_MESSAGE,
  MAX_OPEN_LINKS,
  MAX_VALID_CODES,
  STUDENT_CODE_DAYS,
  UNDO_MINUTES,
  studentFirstName,
} from '#services/guardian_link_service'
import JoinCodeService from '#services/join_code_service'
import GuardianCodeTransformer from '#transformers/guardian_code_transformer'
import GuardianLinkSummaryTransformer from '#transformers/guardian_link_summary_transformer'
import GuardianLinkTransformer from '#transformers/guardian_link_transformer'
import {
  blockGuardianLinkValidator,
  claimGuardianCodeValidator,
  linkGuardianByEmailValidator,
  revokeGuardianLinkValidator,
  updateMyGuardianValidator,
} from '#validators/guardian'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const LINK_NOT_FOUND = 'Vínculo não encontrado.'
const CODE_NOT_FOUND = 'Código não encontrado.'
const CODE_LIMIT_MESSAGE = `Já existem ${MAX_VALID_CODES} códigos válidos para este aluno. Cancele um antes de gerar outro.`
const BLOCKED_MESSAGE =
  'Este vínculo está bloqueado pela secretaria. Ele não é desfeito nem restaurado por aqui.'

type Response = HttpContext['response']

/**
 * Vínculos de responsável: o responsável usa o código; o aluno vê quem acompanha, gera e
 * cancela códigos e compartilha as notas; a administração vincula por e-mail, gera código de
 * 30 dias, aprova e bloqueia. Desfazer muda o status para `revoked` e tem 10 minutos de
 * Desfazer. Nada é apagado.
 */
export default class GuardianLinksController {
  /**
   * POST /guardian-links/claim: o responsável digita o código do aluno ou da secretaria.
   * Código de aluno adulto ou da secretaria: vínculo ativo. Código de aluno menor: pendente
   * até a secretaria aprovar. Limite de 5 erros em 15 minutos.
   */
  async claim({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['guardian'])) {
      return forbidden(response, 'Só a conta de responsável usa código para acompanhar um aluno.')
    }

    const keys = AttemptLimiterService.keysFor('guardian', user.id, request.ip())
    const retryAfter = AttemptLimiterService.retryAfter(keys)
    if (retryAfter > 0) {
      response.header('Retry-After', String(retryAfter))
      return response.tooManyRequests({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Muitas tentativas com código errado. Espere alguns minutos e tente de novo.',
        retryAfter,
      })
    }

    const payload = await request.validateUsing(claimGuardianCodeValidator)

    const result = await db.transaction(async (trx) => {
      const code = await GuardianLinkService.findValidCode(payload.code, trx)
      if (!code || code.studentId === user.id) {
        return { kind: 'invalid' as const }
      }
      const student = code.student
      const existing = await GuardianLink.query({ client: trx })
        .where('guardianId', user.id)
        .where('studentId', student.id)
        .first()
      // Nenhum código passa por cima do bloqueio, e a resposta não conta que ele existe.
      if (existing?.status === 'blocked') {
        return { kind: 'invalid' as const }
      }
      const fromAdmin = code.kind === 'admin'
      const status = fromAdmin || !student.isMinor ? 'active' : 'pending'
      // Já ativo, ou pendente e o código também daria pendente: nada muda e o código não é
      // gasto. Pendente com o código da secretaria (ou de aluno que já não é menor) vira ativo.
      if (
        existing?.status === 'active' ||
        (existing?.status === 'pending' && status === 'pending')
      ) {
        return { kind: 'already' as const, link: existing, student }
      }
      if ((await GuardianLinkService.openLinkCount(student.id, user.id, trx)) >= MAX_OPEN_LINKS) {
        return { kind: 'limit' as const }
      }

      const { link } = await GuardianLinkService.open({
        trx,
        guardian: user,
        student,
        relationship: payload.relationship,
        status,
        origin: fromAdmin ? 'admin_code' : 'student_code',
        actor: user,
        approvedById: fromAdmin ? code.createdById : null,
        meta: { codeId: code.id, codeKind: code.kind },
      })
      code.useTransaction(trx)
      code.usedAt = DateTime.now()
      code.usedById = user.id
      await code.save()
      return { kind: 'created' as const, link, student }
    })

    if (result.kind === 'invalid') {
      AttemptLimiterService.fail(keys)
      return response.unprocessableEntity({
        message: INVALID_GUARDIAN_CODE,
        errors: [{ field: 'code', rule: 'guardian_code', message: INVALID_GUARDIAN_CODE }],
      })
    }
    if (result.kind === 'limit') {
      return conflict(response, 'LINK_LIMIT', LINK_LIMIT_MESSAGE)
    }

    const { link, student } = result
    const alreadyLinked = result.kind === 'already'
    const name = studentFirstName(student)
    let message: string
    if (link.status === 'active') {
      message = alreadyLinked ? `Você já acompanha ${name}.` : `Agora você acompanha ${name}.`
    } else {
      message = alreadyLinked
        ? 'Seu pedido já foi enviado. A secretaria confirma e você recebe um aviso aqui.'
        : 'Pedido enviado. A secretaria confirma e você recebe um aviso aqui.'
    }

    response.status(alreadyLinked ? 200 : 201)
    return {
      data: {
        link: {
          id: link.id,
          studentId: link.studentId,
          relationship: link.relationship,
          status: link.status,
          origin: link.origin,
        },
        student: { id: student.id, fullName: student.fullName, initials: student.initials },
        alreadyLinked,
        message,
      },
    }
  }

  /** GET /guardian-links?status=pending: a administração lista vínculos por status. */
  async index({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração lista os vínculos de responsável.')
    }

    const status = String(request.input('status', 'pending'))
    if (!(GUARDIAN_LINK_STATUSES as readonly string[]).includes(status)) {
      return fieldError(response, 'status', 'Escolha uma situação válida.', 'enum')
    }

    const links = await GuardianLink.query()
      .where('status', status)
      .preload('guardian')
      .preload('student')
      .orderBy('createdAt', 'asc')
      .limit(200)
    return serialize(GuardianLinkTransformer.transform(links, null, 'admin'))
  }

  /**
   * GET /me/guardians: o aluno vê quem acompanha a agenda dele (vínculos ativos e pendentes)
   * e os códigos ainda válidos, só com o prazo.
   */
  async myGuardians({ auth, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['student'])) {
      return forbidden(response, 'Só o aluno vê quem acompanha a própria agenda.')
    }

    const links = await GuardianLink.query()
      .where('studentId', user.id)
      .whereIn('status', [...OPEN_LINK_STATUSES])
      .preload('guardian')
      .orderBy('createdAt', 'asc')
    const codes = await GuardianLinkService.validCodesQuery(user.id).orderBy('createdAt', 'desc')

    return serialize({
      isMinor: user.isMinor,
      limits: { maxLinks: MAX_OPEN_LINKS, maxCodes: MAX_VALID_CODES },
      guardians: GuardianLinkTransformer.transform(links, user, 'student'),
      codes: GuardianCodeTransformer.transform(codes, user),
    })
  }

  /** POST /me/guardian-codes: o aluno gera um código de 7 dias; aparece uma vez só. */
  async createMyCode({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['student'])) {
      return forbidden(response, 'Só o aluno gera código para o próprio responsável.')
    }
    return this.createCode(response, user, user, 'student')
  }

  /**
   * DELETE /me/guardian-codes/:id: o aluno cancela um código dele. O aluno menor não cancela
   * o código que a secretaria gerou (como não desfaz o vínculo feito por ela).
   */
  async revokeMyCode({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['student'])) {
      return forbidden(response, 'Só o aluno cancela os próprios códigos.')
    }

    const code = await GuardianLinkCode.query()
      .where('id', routeId(params.id))
      .where('studentId', user.id)
      .first()
    if (!code) {
      return notFound(response, CODE_NOT_FOUND)
    }
    if (!AcademicAccessService.canCancelGuardianCode(user, code)) {
      return forbidden(
        response,
        'Este código foi gerado pela secretaria. Para cancelar, fale com a secretaria.'
      )
    }
    return this.cancelCode(response, user, code)
  }

  /** DELETE /students/:id/guardian-codes/:codeId: a administração cancela um código do aluno. */
  async revokeStudentCode({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração cancela o código de um aluno.')
    }

    const student = await this.findStudent(params.id)
    if (!student) {
      return notFound(response, STUDENT_NOT_FOUND)
    }
    const code = await GuardianLinkCode.query()
      .where('id', routeId(params.codeId))
      .where('studentId', student.id)
      .first()
    if (!code) {
      return notFound(response, CODE_NOT_FOUND)
    }
    return this.cancelCode(response, user, code)
  }

  /**
   * PATCH /me/guardians/:id: o aluno adulto liga ou desliga `shareGrades`; `confirm` mantém o
   * vínculo que ficou para revisão quando ele deixou de ser menor.
   */
  async updateMine({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['student'])) {
      return forbidden(response, 'Só o aluno muda o compartilhamento das próprias notas.')
    }

    const link = await GuardianLink.query()
      .where('id', routeId(params.id))
      .where('studentId', user.id)
      .whereIn('status', [...OPEN_LINK_STATUSES])
      .preload('guardian')
      .first()
    if (!link) {
      return notFound(response, LINK_NOT_FOUND)
    }

    const payload = await request.validateUsing(updateMyGuardianValidator)
    if (payload.shareGrades === undefined && payload.confirm === undefined) {
      return fieldError(
        response,
        'shareGrades',
        'Informe o que mudar: compartilhar notas ou confirmar o vínculo.',
        'required'
      )
    }
    if (payload.shareGrades !== undefined && user.isMinor) {
      return forbidden(
        response,
        'Aluno menor de idade não muda o compartilhamento: o responsável já vê as notas publicadas.'
      )
    }

    await db.transaction(async (trx) => {
      link.useTransaction(trx)
      if (payload.shareGrades !== undefined && payload.shareGrades !== link.shareGrades) {
        const before = link.shareGrades
        link.shareGrades = payload.shareGrades
        await link.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'guardian_link.share_grades',
            entity: 'guardian_link',
            entityId: link.id,
            subjectUserId: user.id,
            meta: { guardianId: link.guardianId, from: before, to: payload.shareGrades },
          },
          trx
        )
      }
      if (payload.confirm === true && link.needsReview) {
        link.needsReview = false
        await link.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'guardian_link.confirm',
            entity: 'guardian_link',
            entityId: link.id,
            subjectUserId: user.id,
            meta: { guardianId: link.guardianId },
          },
          trx
        )
      }
    })

    return serialize(GuardianLinkTransformer.transform(link, user, 'student'))
  }

  /**
   * DELETE /guardian-links/:id: o próprio responsável, o aluno adulto, o aluno menor (só o
   * vínculo que nasceu de código dele) e a administração. Muda para `revoked` e avisa.
   */
  async destroy({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'student', 'guardian'])) {
      return forbidden(response, 'Seu perfil não desfaz vínculos de responsável.')
    }

    const link = await this.findVisibleLink(user, params.id)
    if (!link) {
      return notFound(response, LINK_NOT_FOUND)
    }
    if (!AcademicAccessService.canRemoveGuardianLink(user, link)) {
      return forbidden(
        response,
        'Este vínculo foi feito pela secretaria. Para encerrar, fale com a secretaria.'
      )
    }
    const payload = await request.validateUsing(revokeGuardianLinkValidator)
    if (link.status === 'blocked') {
      return conflict(response, 'BLOCKED', BLOCKED_MESSAGE)
    }

    if (link.status !== 'revoked') {
      await db.transaction(async (trx) => {
        const { guardian, student } = await this.partiesOf(link, trx)
        await GuardianLinkService.close({
          trx,
          link,
          guardian,
          student,
          status: 'revoked',
          actor: user,
          reason: payload.reason || null,
        })
      })
    }

    return serialize(
      GuardianLinkSummaryTransformer.transform(
        link,
        `Vínculo desfeito. Dá para desfazer em até ${UNDO_MINUTES} minutos.`
      )
    )
  }

  /**
   * POST /guardian-links/:id/restore: o Desfazer do toast. Só quem desfez, em até 10
   * minutos; vínculo bloqueado nunca volta por aqui.
   */
  async restore({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'student', 'guardian'])) {
      return forbidden(response, 'Seu perfil não restaura vínculos de responsável.')
    }

    const link = await this.findVisibleLink(user, params.id)
    if (!link) {
      return notFound(response, LINK_NOT_FOUND)
    }
    if (link.status === 'blocked') {
      return conflict(response, 'BLOCKED', BLOCKED_MESSAGE)
    }
    if (link.isOpen) {
      return serialize(GuardianLinkSummaryTransformer.transform(link))
    }
    if (link.revokedById !== user.id) {
      return forbidden(response, 'Só quem desfez o vínculo pode restaurar.')
    }
    if (!link.revokedAt || link.revokedAt.plus({ minutes: UNDO_MINUTES }) < DateTime.now()) {
      return conflict(
        response,
        'UNDO_EXPIRED',
        'O prazo para desfazer acabou. Para vincular de novo, use um código novo.'
      )
    }

    const restored = await db.transaction(async (trx) => {
      if (
        (await GuardianLinkService.openLinkCount(link.studentId, link.guardianId, trx)) >=
        MAX_OPEN_LINKS
      ) {
        return false
      }
      const { guardian, student } = await this.partiesOf(link, trx)
      const status = await GuardianLinkService.statusBeforeRevoke(link, student, trx)
      await GuardianLinkService.restore({ trx, link, guardian, student, actor: user, status })
      return true
    })
    if (!restored) {
      return conflict(response, 'LINK_LIMIT', LINK_LIMIT_MESSAGE)
    }

    return serialize(GuardianLinkSummaryTransformer.transform(link, 'Vínculo restaurado.'))
  }

  /** GET /students/:id/guardians: a administração vê todos os vínculos e os códigos válidos. */
  async studentGuardians({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração vê os responsáveis de um aluno.')
    }

    const student = await this.findStudent(params.id)
    if (!student) {
      return notFound(response, STUDENT_NOT_FOUND)
    }

    const links = await GuardianLink.query()
      .where('studentId', student.id)
      .preload('guardian')
      .orderBy('createdAt', 'asc')
    links.sort((a, b) => Number(b.isOpen) - Number(a.isOpen))
    const codes = await GuardianLinkService.validCodesQuery(student.id).orderBy('createdAt', 'desc')

    return serialize({
      student: {
        id: student.id,
        fullName: student.fullName,
        email: student.email,
        isMinor: student.isMinor,
      },
      limits: { maxLinks: MAX_OPEN_LINKS, maxCodes: MAX_VALID_CODES },
      guardians: GuardianLinkTransformer.transform(links, student, 'admin'),
      codes: GuardianCodeTransformer.transform(codes),
    })
  }

  /**
   * POST /students/:id/guardians: a administração vincula uma conta de responsável que já
   * existe, pelo e-mail. Nasce ativo, com `origin = admin`. Pedido pendente vira ativo;
   * vínculo bloqueado só volta com `unblock: true` (sem ele, 409 `BLOCKED`).
   */
  async linkByEmail({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração vincula responsável por e-mail.')
    }

    const student = await this.findStudent(params.id)
    if (!student) {
      return notFound(response, STUDENT_NOT_FOUND)
    }

    const payload = await request.validateUsing(linkGuardianByEmailValidator)
    const guardian = await User.query().whereRaw('lower(email) = ?', [payload.email]).first()
    if (!guardian || guardian.role !== 'guardian') {
      return fieldError(
        response,
        'email',
        'Não há conta de responsável com este e-mail. Peça para a pessoa se cadastrar como responsável.',
        'exists'
      )
    }

    const existing = await GuardianLink.query()
      .where('guardianId', guardian.id)
      .where('studentId', student.id)
      .first()
    if (existing?.status === 'active') {
      return fieldError(response, 'email', 'Este responsável já acompanha o aluno.', 'unique')
    }
    // O bloqueio (ordem judicial, pais separados) só sai com a confirmação explícita.
    if (existing?.status === 'blocked' && payload.unblock !== true) {
      return conflict(
        response,
        'BLOCKED',
        'Este responsável está bloqueado para este aluno. Para vincular mesmo assim, confirme o desbloqueio.',
        { linkId: existing.id }
      )
    }

    const link = await db.transaction(async (trx) => {
      if (
        (await GuardianLinkService.openLinkCount(student.id, guardian.id, trx)) >= MAX_OPEN_LINKS
      ) {
        return null
      }
      const opened = await GuardianLinkService.open({
        trx,
        guardian,
        student,
        relationship: payload.relationship,
        status: 'active',
        origin: 'admin',
        actor: user,
        approvedById: user.id,
        meta: existing?.status === 'blocked' ? { unblocked: true } : undefined,
      })
      return opened.link
    })
    if (!link) {
      return conflict(response, 'LINK_LIMIT', LINK_LIMIT_MESSAGE)
    }

    await link.load('guardian')
    response.status(201)
    return serialize(GuardianLinkTransformer.transform(link, student, 'admin'))
  }

  /** POST /students/:id/guardian-codes: código de 30 dias, para entregar impresso. */
  async createStudentCode({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração gera código para o responsável de um aluno.')
    }

    const student = await this.findStudent(params.id)
    if (!student) {
      return notFound(response, STUDENT_NOT_FOUND)
    }
    return this.createCode(response, user, student, 'admin')
  }

  /** POST /guardian-links/:id/approve: a administração aprova o vínculo pendente. */
  async approve({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração aprova vínculos de responsável.')
    }

    const link = await GuardianLink.find(routeId(params.id))
    if (!link) {
      return notFound(response, LINK_NOT_FOUND)
    }
    if (link.status === 'active') {
      return serialize(GuardianLinkSummaryTransformer.transform(link))
    }
    if (link.status !== 'pending') {
      return conflict(response, 'NOT_PENDING', 'Só um vínculo pendente pode ser aprovado.')
    }

    await db.transaction(async (trx) => {
      const { guardian, student } = await this.partiesOf(link, trx)
      await GuardianLinkService.approve({ trx, link, guardian, student, actor: user })
    })
    return serialize(GuardianLinkSummaryTransformer.transform(link, 'Vínculo aprovado.'))
  }

  /**
   * POST /guardian-links/:id/block: a administração bloqueia o vínculo (pais separados, ordem
   * judicial), com motivo. Nenhum código passa por cima do bloqueio.
   */
  async block({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração bloqueia vínculos de responsável.')
    }

    const link = await GuardianLink.find(routeId(params.id))
    if (!link) {
      return notFound(response, LINK_NOT_FOUND)
    }
    const payload = await request.validateUsing(blockGuardianLinkValidator)

    if (link.status !== 'blocked') {
      await db.transaction(async (trx) => {
        const { guardian, student } = await this.partiesOf(link, trx)
        await GuardianLinkService.close({
          trx,
          link,
          guardian,
          student,
          status: 'blocked',
          actor: user,
          reason: payload.reason,
        })
      })
    }
    return serialize(GuardianLinkSummaryTransformer.transform(link, 'Vínculo bloqueado.'))
  }

  /** Cancela o código (uso único): já usado é 409; cancelar de novo não muda nada. */
  private async cancelCode(response: Response, actor: User, code: GuardianLinkCode) {
    if (code.usedAt) {
      return conflict(
        response,
        'CODE_USED',
        'Este código já foi usado. Para encerrar o vínculo, remova o responsável.'
      )
    }

    if (!code.revokedAt) {
      await db.transaction(async (trx) => {
        code.useTransaction(trx)
        code.revokedAt = DateTime.now()
        await code.save()
        await AuditLogService.record(
          {
            actorId: actor.id,
            action: 'guardian_code.revoke',
            entity: 'guardian_link_code',
            entityId: code.id,
            subjectUserId: code.studentId,
            meta: { kind: code.kind },
          },
          trx
        )
      })
    }
    return { data: { id: code.id, revokedAt: code.revokedAt }, message: 'Código cancelado.' }
  }

  /** Gera o código (do aluno: 7 dias; da secretaria: 30), com os limites por aluno. */
  private async createCode(response: Response, actor: User, student: User, kind: GuardianCodeKind) {
    const result = await db.transaction(async (trx) => {
      if ((await GuardianLinkService.validCodeCount(student.id, trx)) >= MAX_VALID_CODES) {
        return { error: 'CODE_LIMIT' as const }
      }
      if ((await GuardianLinkService.openLinkCount(student.id, null, trx)) >= MAX_OPEN_LINKS) {
        return { error: 'LINK_LIMIT' as const }
      }
      return GuardianLinkService.createCode({ trx, student, kind, actor })
    })

    if ('error' in result) {
      return result.error === 'CODE_LIMIT'
        ? conflict(response, 'CODE_LIMIT', CODE_LIMIT_MESSAGE)
        : conflict(response, 'LINK_LIMIT', LINK_LIMIT_MESSAGE)
    }

    const { record, code } = result
    const pending = kind === 'student' && student.isMinor
    let message: string
    if (kind === 'admin') {
      message = `Entregue o código impresso só ao responsável. Vale ${ADMIN_CODE_DAYS} dias e uma vez só.`
    } else if (pending) {
      message = `Entregue só a quem você quer que acompanhe sua agenda. Vale ${STUDENT_CODE_DAYS} dias e uma vez só. A secretaria confirma antes de liberar.`
    } else {
      message = `Entregue só a quem você quer que acompanhe sua agenda. Vale ${STUDENT_CODE_DAYS} dias e uma vez só.`
    }

    response.status(201)
    return {
      data: {
        id: record.id,
        studentId: student.id,
        kind: record.kind,
        // O código em claro só aparece nesta resposta.
        code,
        codeFormatted: JoinCodeService.format(code),
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
        linkWillBePending: pending,
        message,
      },
    }
  }

  /** O vínculo, se a pessoa pode vê-lo; senão null (a rota responde 404). */
  private async findVisibleLink(user: User, rawId: unknown) {
    const link = await GuardianLink.find(routeId(rawId))
    if (!link || !AcademicAccessService.canSeeGuardianLink(user, link)) {
      return null
    }
    return link
  }

  private async findStudent(rawId: unknown) {
    const student = await User.find(routeId(rawId))
    return student?.role === 'student' ? student : null
  }

  private async partiesOf(link: GuardianLink, trx: TransactionClientContract) {
    const guardian = await User.findOrFail(link.guardianId, { client: trx })
    const student = await User.findOrFail(link.studentId, { client: trx })
    return { guardian, student }
  }
}
