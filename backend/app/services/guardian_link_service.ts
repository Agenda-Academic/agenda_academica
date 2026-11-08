import AuditLog from '#models/audit_log'
import GuardianLink, {
  OPEN_LINK_STATUSES,
  type GuardianLinkOrigin,
  type GuardianRelationship,
} from '#models/guardian_link'
import GuardianLinkCode, { type GuardianCodeKind } from '#models/guardian_link_code'
import type User from '#models/user'
import AuditLogService from '#services/audit_log_service'
import JoinCodeService from '#services/join_code_service'
import NotificationService from '#services/notification_service'
import { countOf } from '#services/query_helpers'
import env from '#start/env'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { createHmac } from 'node:crypto'

/** No máximo 4 vínculos `active` ou `pending` por aluno. */
export const MAX_OPEN_LINKS = 4
/** No máximo 3 códigos válidos por aluno ao mesmo tempo. */
export const MAX_VALID_CODES = 3
export const STUDENT_CODE_DAYS = 7
export const ADMIN_CODE_DAYS = 30
/** Prazo do Desfazer depois de desfazer um vínculo. */
export const UNDO_MINUTES = 10

/**
 * A mesma resposta para código inexistente, mal digitado, expirado, usado, cancelado, de quem
 * não é aluno ou de vínculo bloqueado.
 */
export const INVALID_GUARDIAN_CODE =
  'Código inválido ou expirado. Confira com quem passou o código.'

export const LINK_LIMIT_MESSAGE = `Este aluno já tem ${MAX_OPEN_LINKS} responsáveis vinculados ou pendentes. Para incluir outro, um vínculo precisa ser desfeito antes.`

/** Parentesco nos avisos ao aluno; `outro` não aparece no texto. */
const RELATIONSHIP_LABELS: Record<GuardianRelationship, string | null> = {
  mae: 'mãe',
  pai: 'pai',
  responsavel_legal: 'responsável legal',
  outro: null,
}

const PROFILE_LINK = '?tela=perfil'
const DASHBOARD_LINK = '?tela=painel'
const ADMIN_LINK = '?tela=turmas'

/** Nome para os avisos ao aluno. */
function guardianName(guardian: User) {
  return guardian.fullName?.trim() || 'Um responsável'
}

/** Primeiro nome do aluno, para os avisos ao responsável ("Agora você acompanha Diogo"). */
export function studentFirstName(student: User) {
  return student.fullName?.trim().split(/\s+/)[0] || 'o aluno'
}

/**
 * O responsável vê as notas publicadas? Só com o vínculo ativo: de aluno menor, sempre; de
 * aluno adulto, só se ele compartilhar.
 */
export function effectiveShareGrades(link: GuardianLink, student: User) {
  return link.status === 'active' && (student.isMinor || link.shareGrades)
}

type OpenInput = {
  trx: TransactionClientContract
  guardian: User
  student: User
  relationship: GuardianRelationship
  status: 'active' | 'pending'
  origin: GuardianLinkOrigin
  actor: User
  /** Quem aprovou, quando o vínculo já nasce ativo pela secretaria. */
  approvedById: number | null
  meta?: Record<string, unknown>
}

type CloseInput = {
  trx: TransactionClientContract
  link: GuardianLink
  guardian: User
  student: User
  status: 'revoked' | 'blocked'
  actor: User
  reason: string | null
}

/**
 * Vínculos de responsável e códigos: criar, reativar, aprovar, desfazer, restaurar e bloquear.
 * Toda mudança grava audit_logs e os avisos na mesma transação. A linha nunca é apagada.
 */
export default class GuardianLinkService {
  /** HMAC-SHA256 do código normalizado, com a APP_KEY. É o que fica no banco. */
  static hash(normalizedCode: string) {
    return createHmac('sha256', env.get('APP_KEY').release()).update(normalizedCode).digest('hex')
  }

  static validCodesQuery(studentId: number, trx?: TransactionClientContract) {
    return GuardianLinkCode.query({ client: trx })
      .where('studentId', studentId)
      .withScopes((scopes) => scopes.valid())
  }

  static async validCodeCount(studentId: number, trx?: TransactionClientContract) {
    return countOf(this.validCodesQuery(studentId, trx))
  }

  /** Vínculos que contam no limite do aluno, sem contar a linha deste responsável. */
  static async openLinkCount(
    studentId: number,
    exceptGuardianId: number | null,
    trx?: TransactionClientContract
  ) {
    const query = GuardianLink.query({ client: trx })
      .where('studentId', studentId)
      .whereIn('status', [...OPEN_LINK_STATUSES])
    if (exceptGuardianId) {
      query.whereNot('guardianId', exceptGuardianId)
    }
    return countOf(query)
  }

  /**
   * Gera um código de 8 caracteres (Crockford, crypto.randomInt) e guarda só o HMAC. O código
   * em claro só existe na resposta que o cria.
   */
  static async createCode(input: {
    trx: TransactionClientContract
    student: User
    kind: GuardianCodeKind
    actor: User
  }) {
    const days = input.kind === 'admin' ? ADMIN_CODE_DAYS : STUDENT_CODE_DAYS
    for (;;) {
      const code = JoinCodeService.generate()
      const codeHash = this.hash(code)
      const taken = await GuardianLinkCode.query({ client: input.trx })
        .where('codeHash', codeHash)
        .first()
      if (taken) {
        continue
      }
      const record = await GuardianLinkCode.create(
        {
          studentId: input.student.id,
          codeHash,
          kind: input.kind,
          createdById: input.actor.id,
          expiresAt: DateTime.now().plus({ days }),
        },
        { client: input.trx }
      )
      await AuditLogService.record(
        {
          actorId: input.actor.id,
          action: 'guardian_code.create',
          entity: 'guardian_link_code',
          entityId: record.id,
          subjectUserId: input.student.id,
          meta: { kind: input.kind, expiresAt: record.expiresAt.toISO() },
        },
        input.trx
      )
      return { record, code }
    }
  }

  /** O código válido que bate com o texto digitado, com o aluno; null para qualquer erro. */
  static async findValidCode(rawCode: string, trx: TransactionClientContract) {
    const code = JoinCodeService.normalize(rawCode)
    if (!code) {
      return null
    }
    const record = await GuardianLinkCode.query({ client: trx })
      .where('codeHash', this.hash(code))
      .withScopes((scopes) => scopes.valid())
      .preload('student')
      .first()
    if (!record || record.student?.role !== 'student') {
      return null
    }
    return record
  }

  /** Cria o vínculo ou reativa a mesma linha (a unique é responsável e aluno). */
  static async open(input: OpenInput) {
    const { trx, guardian, student, actor } = input
    let link = await GuardianLink.query({ client: trx })
      .where('guardianId', guardian.id)
      .where('studentId', student.id)
      .first()
    const previousStatus = link?.status ?? null
    const now = DateTime.now()

    if (!link) {
      link = new GuardianLink()
      link.guardianId = guardian.id
      link.studentId = student.id
    } else {
      // Vincular de novo é um vínculo novo: a data de início volta a ser hoje.
      link.createdAt = now
    }
    link.useTransaction(trx)
    link.merge({
      relationship: input.relationship,
      status: input.status,
      origin: input.origin,
      shareGrades: false,
      needsReview: false,
      createdById: actor.id,
      approvedById: input.status === 'active' ? input.approvedById : null,
      approvedAt: input.status === 'active' && input.approvedById ? now : null,
      revokedById: null,
      revokedAt: null,
      revokeReason: null,
    })
    await link.save()

    await AuditLogService.record(
      {
        actorId: actor.id,
        action: input.status === 'pending' ? 'guardian_link.request' : 'guardian_link.create',
        entity: 'guardian_link',
        entityId: link.id,
        subjectUserId: student.id,
        meta: {
          guardianId: guardian.id,
          from: previousStatus,
          to: input.status,
          origin: input.origin,
          relationship: input.relationship,
          ...input.meta,
        },
      },
      trx
    )

    const name = guardianName(guardian)
    const label = RELATIONSHIP_LABELS[input.relationship]
    const relationship = label ? `Parentesco: ${label}. ` : ''
    if (input.status === 'active') {
      await NotificationService.notify(
        student.id,
        {
          kind: 'guardian_linked',
          title: `${name} agora acompanha sua agenda`,
          body: `${relationship}Você vê quem acompanha sua agenda no seu perfil.`,
          link: PROFILE_LINK,
        },
        trx
      )
      if (actor.id !== guardian.id) {
        await NotificationService.notify(
          guardian.id,
          {
            kind: 'guardian_linked',
            title: `Agora você acompanha ${studentFirstName(student)}`,
            body: 'A secretaria vinculou sua conta.',
            link: DASHBOARD_LINK,
          },
          trx
        )
      }
    } else {
      await NotificationService.notify(
        student.id,
        {
          kind: 'guardian_pending',
          title: `${name} pediu para acompanhar sua agenda`,
          body: `${relationship}A secretaria confirma antes de liberar.`,
          link: PROFILE_LINK,
        },
        trx
      )
      await NotificationService.notifyAdmins(
        {
          kind: 'guardian_pending',
          title: 'Vínculo de responsável aguardando aprovação',
          body: `${name} pediu para acompanhar a agenda de ${student.fullName ?? 'um aluno'}.`,
          link: ADMIN_LINK,
        },
        trx
      )
    }

    return { link, previousStatus }
  }

  /** A secretaria aprova o vínculo pendente. */
  static async approve(input: {
    trx: TransactionClientContract
    link: GuardianLink
    guardian: User
    student: User
    actor: User
  }) {
    const { trx, link, guardian, student, actor } = input
    link.useTransaction(trx)
    link.status = 'active'
    link.approvedById = actor.id
    link.approvedAt = DateTime.now()
    await link.save()

    await AuditLogService.record(
      {
        actorId: actor.id,
        action: 'guardian_link.approve',
        entity: 'guardian_link',
        entityId: link.id,
        subjectUserId: student.id,
        meta: { guardianId: guardian.id, from: 'pending', to: 'active' },
      },
      trx
    )
    await NotificationService.notify(
      student.id,
      {
        kind: 'guardian_linked',
        title: `${guardianName(guardian)} agora acompanha sua agenda`,
        body: 'A secretaria confirmou o vínculo. Você vê quem acompanha sua agenda no seu perfil.',
        link: PROFILE_LINK,
      },
      trx
    )
    await NotificationService.notify(
      guardian.id,
      {
        kind: 'guardian_linked',
        title: `Agora você acompanha ${studentFirstName(student)}`,
        body: 'A secretaria confirmou o vínculo.',
        link: DASHBOARD_LINK,
      },
      trx
    )
  }

  /** Desfaz (`revoked`) ou bloqueia (`blocked`) o vínculo. Avisa o aluno e o responsável. */
  static async close(input: CloseInput) {
    const { trx, link, guardian, student, actor } = input
    const previousStatus = link.status
    link.useTransaction(trx)
    link.status = input.status
    link.revokedById = actor.id
    link.revokedAt = DateTime.now()
    link.revokeReason = input.reason
    link.needsReview = false
    await link.save()

    await AuditLogService.record(
      {
        actorId: actor.id,
        action: input.status === 'blocked' ? 'guardian_link.block' : 'guardian_link.revoke',
        entity: 'guardian_link',
        entityId: link.id,
        subjectUserId: student.id,
        // O motivo fica só na linha do vínculo: pode ter nomes, então não vai para o registro.
        meta: {
          guardianId: guardian.id,
          from: previousStatus,
          to: input.status,
          hasReason: Boolean(input.reason),
        },
      },
      trx
    )

    // Vínculo já desfeito e agora bloqueado: ninguém perde acesso, então não há aviso novo.
    if (!(OPEN_LINK_STATUSES as readonly string[]).includes(previousStatus)) {
      return { previousStatus }
    }

    let studentBody: string
    if (actor.id === student.id) {
      studentBody = 'Você desfez o vínculo.'
    } else if (actor.id === guardian.id) {
      studentBody = 'O responsável desfez o vínculo.'
    } else {
      studentBody = 'A secretaria encerrou o vínculo.'
    }
    // Pedido pendente nunca deu acesso: o aviso fala do pedido, não de "deixar de acompanhar".
    const wasPending = previousStatus === 'pending'
    await NotificationService.notify(
      student.id,
      {
        kind: 'guardian_unlinked',
        title: wasPending
          ? `O pedido de ${guardianName(guardian)} para acompanhar sua agenda foi encerrado`
          : `${guardianName(guardian)} deixou de acompanhar sua agenda`,
        body: studentBody,
        link: PROFILE_LINK,
      },
      trx
    )
    if (actor.id !== guardian.id) {
      await NotificationService.notify(
        guardian.id,
        {
          kind: 'guardian_unlinked',
          title: wasPending
            ? `Seu pedido para acompanhar ${studentFirstName(student)} foi encerrado`
            : `Você deixou de acompanhar ${studentFirstName(student)}`,
          body:
            actor.id === student.id
              ? 'O aluno desfez o vínculo.'
              : 'A secretaria encerrou o vínculo.',
          link: DASHBOARD_LINK,
        },
        trx
      )
    }
    return { previousStatus }
  }

  /** Vínculo de código do aluno menor que a secretaria ainda não aprovou: fica pendente. */
  static needsApproval(link: GuardianLink, student: User) {
    return link.origin === 'student_code' && student.isMinor && !link.approvedAt
  }

  /**
   * Status que o vínculo tinha antes de ser desfeito, lido do registro do `revoke` (gravado
   * na mesma transação). Se o aluno passou a ser menor depois disso, o vínculo de código dele
   * sem aprovação volta pendente, nunca ativo.
   */
  static async statusBeforeRevoke(
    link: GuardianLink,
    student: User,
    trx?: TransactionClientContract
  ): Promise<'active' | 'pending'> {
    const entry = await AuditLog.query({ client: trx })
      .where('entity', 'guardian_link')
      .where('entityId', link.id)
      .where('action', 'guardian_link.revoke')
      .orderBy('id', 'desc')
      .first()
    let from: string | undefined
    if (entry?.meta) {
      try {
        from = (JSON.parse(entry.meta) as { from?: string }).from
      } catch {
        // Registro sem JSON válido: vale só a regra do aluno menor.
      }
    }
    return from === 'pending' || this.needsApproval(link, student) ? 'pending' : 'active'
  }

  /**
   * A marca de menor mudou (PATCH /users/:id ou matrícula em curso integrado), na mesma
   * transação da mudança:
   * - deixou de ser menor: cada vínculo aberto perde o compartilhamento de notas e fica para
   *   o aluno confirmar ou encerrar (`needsReview`), com um aviso;
   * - passou a ser menor: o vínculo ativo de código dele que a secretaria nunca aprovou volta
   *   a `pending`, porque o vínculo do menor só vale com a secretaria. A administração, o
   *   responsável e o aluno recebem aviso.
   */
  static async applyMinorChange(input: {
    trx: TransactionClientContract
    student: User
    before: boolean
    after: boolean
    actorId: number
  }) {
    const { trx, student, before, after, actorId } = input
    const result = { linksToReview: 0, linksToApprove: 0 }

    if (before && !after) {
      const links = await GuardianLink.query({ client: trx })
        .where('studentId', student.id)
        .whereIn('status', [...OPEN_LINK_STATUSES])
      for (const link of links) {
        link.useTransaction(trx)
        link.shareGrades = false
        link.needsReview = true
        await link.save()
      }
      result.linksToReview = links.length
      if (links.length) {
        await NotificationService.notify(
          student.id,
          {
            kind: 'guardian_review',
            title: 'Confira quem acompanha sua agenda',
            body: 'A secretaria registrou que você é maior de idade. Confirme ou encerre cada vínculo de responsável no seu perfil.',
            link: PROFILE_LINK,
          },
          trx
        )
      }
    }

    if (!before && after) {
      const links = await GuardianLink.query({ client: trx })
        .where('studentId', student.id)
        .where('status', 'active')
        .where('origin', 'student_code')
        .whereNull('approvedAt')
        .preload('guardian')
      for (const link of links) {
        link.useTransaction(trx)
        link.status = 'pending'
        link.needsReview = false
        await link.save()
        await AuditLogService.record(
          {
            actorId,
            action: 'guardian_link.suspend',
            entity: 'guardian_link',
            entityId: link.id,
            subjectUserId: student.id,
            meta: { guardianId: link.guardianId, from: 'active', to: 'pending', reason: 'minor' },
          },
          trx
        )
        await NotificationService.notify(
          link.guardianId,
          {
            kind: 'guardian_pending',
            title: `A agenda de ${studentFirstName(student)} aguarda a secretaria`,
            body: 'O aluno foi registrado como menor de idade. A secretaria confirma o vínculo e você recebe um aviso aqui.',
            link: DASHBOARD_LINK,
          },
          trx
        )
      }
      result.linksToApprove = links.length
      if (links.length) {
        await NotificationService.notify(
          student.id,
          {
            kind: 'guardian_pending',
            title: 'A secretaria confirma quem acompanha sua agenda',
            body: 'Você foi registrado como menor de idade. Os vínculos feitos com o seu código ficam pendentes até a secretaria confirmar.',
            link: PROFILE_LINK,
          },
          trx
        )
        await NotificationService.notifyAdmins(
          {
            kind: 'guardian_pending',
            title: 'Vínculo de responsável aguardando aprovação',
            body: `${student.fullName ?? 'Um aluno'} foi registrado como menor de idade e tem ${links.length} ${links.length === 1 ? 'vínculo' : 'vínculos'} para aprovar.`,
            link: ADMIN_LINK,
          },
          trx
        )
      }
    }

    return result
  }

  /** O Desfazer do toast: o vínculo volta ao status que tinha. */
  static async restore(input: {
    trx: TransactionClientContract
    link: GuardianLink
    guardian: User
    student: User
    actor: User
    status: 'active' | 'pending'
  }) {
    const { trx, link, guardian, student, actor } = input
    link.useTransaction(trx)
    link.status = input.status
    link.revokedById = null
    link.revokedAt = null
    link.revokeReason = null
    await link.save()

    await AuditLogService.record(
      {
        actorId: actor.id,
        action: 'guardian_link.restore',
        entity: 'guardian_link',
        entityId: link.id,
        subjectUserId: student.id,
        meta: { guardianId: guardian.id, from: 'revoked', to: input.status },
      },
      trx
    )

    const name = guardianName(guardian)
    await NotificationService.notify(
      student.id,
      input.status === 'active'
        ? {
            kind: 'guardian_linked',
            title: `${name} voltou a acompanhar sua agenda`,
            body: 'O vínculo desfeito foi restaurado.',
            link: PROFILE_LINK,
          }
        : {
            kind: 'guardian_pending',
            title: `${name} voltou a pedir para acompanhar sua agenda`,
            body: 'A secretaria confirma antes de liberar.',
            link: PROFILE_LINK,
          },
      trx
    )
    if (actor.id !== guardian.id && input.status === 'active') {
      await NotificationService.notify(
        guardian.id,
        {
          kind: 'guardian_linked',
          title: `Você voltou a acompanhar ${studentFirstName(student)}`,
          body: 'O vínculo desfeito foi restaurado.',
          link: DASHBOARD_LINK,
        },
        trx
      )
    }
  }
}
