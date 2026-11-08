import AcademicClass from '#models/academic_class'
import ClassInvite from '#models/class_invite'
import Enrollment, { type EnrollmentStatus } from '#models/enrollment'
import User from '#models/user'
import AuditLogService from '#services/audit_log_service'
import GuardianLinkService from '#services/guardian_link_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

export type EnrollmentSource = 'admin' | 'list' | 'code' | 'invite'

type EnrollInput = {
  trx: TransactionClientContract
  /** Quem fez a ação; null quando é o próprio aluno sem decisão de ninguém. */
  actorId: number
  userId: number
  academicClassId: number
  status: EnrollmentStatus
  source: EnrollmentSource
  registration?: string | null
  /** Grava decided_by e decided_at (inclusão pela administração, aprovação, convite). */
  decided: boolean
  meta?: Record<string, unknown>
}

/**
 * Matrícula: a linha nunca é apagada, só muda de status. Toda mudança grava quem decidiu,
 * o registro em audit_logs e, no curso integrado, a marca de aluno menor.
 */
export default class ClassMembershipService {
  /** Nome da ação em audit_logs para a troca de status. */
  static statusAction(from: string | null, to: string) {
    if (from === null) {
      return to === 'pending' ? 'enrollment.request' : 'enrollment.create'
    }
    if (from === 'pending' && to === 'active') {
      return 'enrollment.approve'
    }
    if (from === 'pending' && to === 'inactive') {
      return 'enrollment.reject'
    }
    if (to === 'inactive') {
      return 'enrollment.inactivate'
    }
    if (to === 'completed') {
      return 'enrollment.complete'
    }
    if (to === 'active') {
      return 'enrollment.reactivate'
    }
    return 'enrollment.request'
  }

  /**
   * Ao matricular em curso integrado, o aluno já vem marcado como menor. Os vínculos de
   * responsável feitos pelo código dele sem aprovação da secretaria voltam a pendentes.
   */
  static async markMinorIfIntegrado(
    userId: number,
    academicClassId: number,
    trx: TransactionClientContract,
    actorId: number
  ) {
    const academicClass = await AcademicClass.query({ client: trx })
      .where('id', academicClassId)
      .preload('course')
      .first()
    if (academicClass?.course?.modality !== 'integrado') {
      return false
    }
    const user = await User.find(userId, { client: trx })
    if (!user || user.isMinor) {
      return false
    }
    user.isMinor = true
    await user.save()
    await GuardianLinkService.applyMinorChange({
      trx,
      student: user,
      before: false,
      after: true,
      actorId,
    })
    return true
  }

  /** Cria a matrícula ou muda a que já existe para o status pedido. */
  static async enroll(input: EnrollInput) {
    const { trx } = input
    let enrollment = await Enrollment.query({ client: trx })
      .where('userId', input.userId)
      .where('academicClassId', input.academicClassId)
      .first()
    const previousStatus = enrollment?.status ?? null

    if (!enrollment) {
      enrollment = new Enrollment()
      enrollment.useTransaction(trx)
      enrollment.userId = input.userId
      enrollment.academicClassId = input.academicClassId
    }
    enrollment.status = input.status
    enrollment.source = input.source
    if (input.registration !== undefined) {
      enrollment.registration = input.registration
    }
    enrollment.decidedById = input.decided ? input.actorId : null
    enrollment.decidedAt = input.decided ? DateTime.now() : null
    await enrollment.save()

    const markedMinor =
      input.status === 'active'
        ? await this.markMinorIfIntegrado(input.userId, input.academicClassId, trx, input.actorId)
        : false

    await AuditLogService.record(
      {
        actorId: input.actorId,
        action: this.statusAction(previousStatus, input.status),
        entity: 'enrollment',
        entityId: enrollment.id,
        subjectUserId: input.userId,
        meta: {
          academicClassId: input.academicClassId,
          from: previousStatus,
          to: input.status,
          source: input.source,
          ...(markedMinor ? { markedMinor: true } : {}),
          ...input.meta,
        },
      },
      trx
    )

    return { enrollment, previousStatus, markedMinor }
  }

  /** Muda o status de uma matrícula existente, com quem decidiu e quando. */
  static async changeStatus(
    enrollment: Enrollment,
    status: EnrollmentStatus,
    actorId: number,
    trx: TransactionClientContract
  ) {
    const previousStatus = enrollment.status
    enrollment.useTransaction(trx)
    enrollment.status = status
    enrollment.decidedById = actorId
    enrollment.decidedAt = DateTime.now()
    await enrollment.save()

    const markedMinor =
      status === 'active'
        ? await this.markMinorIfIntegrado(
            enrollment.userId,
            enrollment.academicClassId,
            trx,
            actorId
          )
        : false

    await AuditLogService.record(
      {
        actorId,
        action: this.statusAction(previousStatus, status),
        entity: 'enrollment',
        entityId: enrollment.id,
        subjectUserId: enrollment.userId,
        meta: {
          academicClassId: enrollment.academicClassId,
          from: previousStatus,
          to: status,
          ...(markedMinor ? { markedMinor: true } : {}),
        },
      },
      trx
    )
    return { previousStatus, markedMinor }
  }

  /** A matrícula escolar já é de outro aluno da mesma turma? */
  static async registrationTaken(
    academicClassId: number,
    registration: string,
    exceptEnrollmentId: number | null,
    trx?: TransactionClientContract
  ) {
    const query = Enrollment.query({ client: trx })
      .where('academicClassId', academicClassId)
      .where('registration', registration)
    if (exceptEnrollmentId) {
      query.whereNot('id', exceptEnrollmentId)
    }
    return !!(await query.first())
  }

  /** Convite da turma (não aceito, turma não arquivada) para o e-mail da pessoa. */
  static pendingInvitesQuery(email: string, trx: TransactionClientContract) {
    return ClassInvite.query({ client: trx })
      .whereRaw('lower(email) = ?', [email.trim().toLowerCase()])
      .whereNull('acceptedAt')
      .whereHas('academicClass', (classQuery) => {
        classQuery.whereNull('archivedAt')
      })
  }

  /** No cadastro do aluno, cada convite do mesmo e-mail vira matrícula ativa. */
  static async acceptInvites(user: User, trx: TransactionClientContract) {
    const invites = await this.pendingInvitesQuery(user.email, trx)
    for (const invite of invites) {
      // Matrícula escolar repetida na turma não trava o cadastro: entra sem ela.
      const registration =
        invite.registration &&
        !(await this.registrationTaken(invite.academicClassId, invite.registration, null, trx))
          ? invite.registration
          : null
      await this.enroll({
        trx,
        actorId: user.id,
        userId: user.id,
        academicClassId: invite.academicClassId,
        status: 'active',
        source: 'invite',
        registration,
        decided: false,
        meta: { inviteId: invite.id },
      })
      invite.useTransaction(trx)
      invite.acceptedAt = DateTime.now()
      await invite.save()
    }
    return invites.length
  }
}
