import AcademicClass from '#models/academic_class'
import ClassInvite from '#models/class_invite'
import Enrollment, { ENROLLMENT_STATUSES, type EnrollmentStatus } from '#models/enrollment'
import User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import { conflict, fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AttemptLimiterService from '#services/attempt_limiter_service'
import AuditLogService from '#services/audit_log_service'
import ClassMembershipService from '#services/class_membership_service'
import JoinCodeService from '#services/join_code_service'
import ClassInviteTransformer from '#transformers/class_invite_transformer'
import ClassStudentTransformer from '#transformers/class_student_transformer'
import {
  addStudentsValidator,
  decideEnrollmentsValidator,
  joinClassValidator,
  updateEnrollmentValidator,
} from '#validators/management'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

const CLASS_NOT_FOUND = 'Turma não encontrada.'
const ENROLLMENT_NOT_FOUND = 'Matrícula não encontrada.'
const CLASS_ARCHIVED =
  'Esta turma está arquivada e fica somente leitura. Restaure a turma para mudar algo.'
/** A mesma resposta para código inexistente, desligado, de turma arquivada ou mal digitado. */
const INVALID_CODE = 'Código inválido ou expirado. Confira com quem passou o código.'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Rejected = { email: string; reason: string; message: string }

/** Alunos na turma: lista, inclusão, convites, pedidos de entrada e entrada por código. */
export default class ClassMembersController {
  /** GET /classes/:id/students: administração e docente da turma; pendentes primeiro. */
  async index({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não vê a lista de alunos da turma.')
    }

    const academicClass = await this.findVisibleClass(user, params.id)
    if (!academicClass) {
      return notFound(response, CLASS_NOT_FOUND)
    }

    const query = Enrollment.query().where('academicClassId', academicClass.id).preload('user')
    const status = request.input('status')
    if (status) {
      if (!(ENROLLMENT_STATUSES as readonly string[]).includes(String(status))) {
        return fieldError(response, 'status', 'Escolha uma situação válida.', 'enum')
      }
      query.where('status', String(status))
    }

    const enrollments = await query
    enrollments.sort(
      (a, b) =>
        statusOrder(a.status) - statusOrder(b.status) ||
        (a.user?.fullName ?? a.user?.email ?? '').localeCompare(
          b.user?.fullName ?? b.user?.email ?? '',
          'pt-BR'
        )
    )
    return serialize(
      ClassStudentTransformer.transform(enrollments, AcademicAccessService.isAdmin(user))
    )
  }

  /**
   * POST /classes/:id/students: `{ userId }` ou `{ emails[] }`. Quem tem conta de aluno
   * entra ativo; quem não tem vira convite. Devolve `{ added, invited, rejected[] }`.
   */
  async store({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração inclui alunos na turma.')
    }

    const academicClass = await AcademicClass.find(routeId(params.id))
    if (!academicClass) {
      return notFound(response, CLASS_NOT_FOUND)
    }
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const payload = await request.validateUsing(addStudentsValidator)

    if (payload.userId !== undefined) {
      const student = await User.find(payload.userId)
      if (!student || student.role !== 'student') {
        return fieldError(response, 'userId', 'Escolha uma conta de aluno.')
      }
      const existing = await Enrollment.query()
        .where('userId', student.id)
        .where('academicClassId', academicClass.id)
        .first()
      if (existing?.status === 'active') {
        return fieldError(response, 'userId', 'Este aluno já está na turma.', 'unique')
      }
      if (
        payload.registration &&
        (await ClassMembershipService.registrationTaken(
          academicClass.id,
          payload.registration,
          existing?.id ?? null
        ))
      ) {
        return fieldError(
          response,
          'registration',
          'Esta matrícula já é de outro aluno da turma. Confira o número.',
          'unique'
        )
      }

      const { enrollment } = await db.transaction((trx) =>
        ClassMembershipService.enroll({
          trx,
          actorId: user.id,
          userId: student.id,
          academicClassId: academicClass.id,
          status: 'active',
          source: 'admin',
          registration: payload.registration,
          decided: true,
        })
      )
      return { data: { added: 1, invited: 0, rejected: [], enrollmentId: enrollment.id } }
    }

    return { data: await this.addEmails(user, academicClass, payload.emails ?? []) }
  }

  /**
   * PATCH /enrollments/:id. Administração: qualquer status e a matrícula escolar. Docente da
   * turma: só de `pending` para `active` ou `inactive`.
   */
  async update({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não muda matrículas.')
    }

    const enrollment = await Enrollment.query()
      .where('id', routeId(params.id))
      .preload('academicClass')
      .first()
    if (
      !enrollment ||
      !(await AcademicAccessService.canAccessClass(user, enrollment.academicClassId))
    ) {
      return notFound(response, ENROLLMENT_NOT_FOUND)
    }
    if (enrollment.academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const payload = await request.validateUsing(updateEnrollmentValidator)
    if (payload.status === undefined && payload.registration === undefined) {
      return fieldError(response, 'status', 'Informe a nova situação ou a matrícula.', 'required')
    }

    if (AcademicAccessService.isTeacher(user)) {
      if (payload.registration !== undefined) {
        return forbidden(response, 'Só a administração grava a matrícula escolar.')
      }
      if (enrollment.status !== 'pending' || !['active', 'inactive'].includes(payload.status!)) {
        return forbidden(
          response,
          'A docente só aprova ou recusa pedidos pendentes. Para inativar ou concluir, fale com a secretaria.'
        )
      }
    }

    const registration =
      payload.registration === undefined ? undefined : payload.registration || null
    if (
      registration &&
      (await ClassMembershipService.registrationTaken(
        enrollment.academicClassId,
        registration,
        enrollment.id
      ))
    ) {
      return fieldError(
        response,
        'registration',
        'Esta matrícula já é de outro aluno da turma. Confira o número.',
        'unique'
      )
    }

    await db.transaction(async (trx) => {
      if (registration !== undefined && registration !== enrollment.registration) {
        const before = enrollment.registration
        enrollment.useTransaction(trx)
        enrollment.registration = registration
        await enrollment.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'enrollment.registration',
            entity: 'enrollment',
            entityId: enrollment.id,
            subjectUserId: enrollment.userId,
            // O número em si não vai para o registro, só se havia e se ficou vazio.
            meta: {
              academicClassId: enrollment.academicClassId,
              hadRegistration: before !== null,
              cleared: registration === null,
            },
          },
          trx
        )
      }
      if (payload.status !== undefined && payload.status !== enrollment.status) {
        await ClassMembershipService.changeStatus(enrollment, payload.status, user.id, trx)
      }
    })

    await enrollment.load('user')
    return serialize(
      ClassStudentTransformer.transform(enrollment, AcademicAccessService.isAdmin(user))
    )
  }

  /** POST /classes/:id/students/decide: aprova ou recusa pedidos pendentes em lote. */
  async decide({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não decide pedidos de entrada.')
    }

    const academicClass = await this.findVisibleClass(user, params.id)
    if (!academicClass) {
      return notFound(response, CLASS_NOT_FOUND)
    }
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const { enrollmentIds, status } = await request.validateUsing(decideEnrollmentsValidator)
    const pending = await Enrollment.query()
      .where('academicClassId', academicClass.id)
      .where('status', 'pending')
      .whereIn('id', enrollmentIds)

    await db.transaction(async (trx) => {
      for (const enrollment of pending) {
        await ClassMembershipService.changeStatus(enrollment, status, user.id, trx)
      }
    })

    const updatedIds = new Set(pending.map((enrollment) => enrollment.id))
    return {
      data: {
        updated: pending.length,
        status,
        // Ids que não são pedidos pendentes desta turma ficam de fora, sem mudar nada.
        skipped: [...new Set(enrollmentIds)].filter((id) => !updatedIds.has(id)),
      },
    }
  }

  /**
   * POST /enrollments/join: o aluno entra com o código da turma. Ativo se o e-mail está num
   * convite da turma; senão, pedido pendente. Limite de 5 erros em 15 minutos.
   */
  async join({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['student'])) {
      return forbidden(response, 'Só alunos entram em turma com código.')
    }

    const keys = AttemptLimiterService.keysFor('join', user.id, request.ip())
    const retryAfter = AttemptLimiterService.retryAfter(keys)
    if (retryAfter > 0) {
      response.header('Retry-After', String(retryAfter))
      return response.tooManyRequests({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Muitas tentativas com código errado. Espere alguns minutos e tente de novo.',
        retryAfter,
      })
    }

    const payload = await request.validateUsing(joinClassValidator)
    const code = JoinCodeService.normalize(payload.code)
    const academicClass = code
      ? await AcademicClass.query()
          .where('joinCode', code)
          .where('joinCodeActive', true)
          .whereNull('archivedAt')
          .preload('course')
          .first()
      : null

    if (!academicClass) {
      AttemptLimiterService.fail(keys)
      return response.unprocessableEntity({
        message: INVALID_CODE,
        errors: [{ field: 'code', rule: 'join_code', message: INVALID_CODE }],
      })
    }

    const result = await db.transaction(async (trx) => {
      const existing = await Enrollment.query({ client: trx })
        .where('userId', user.id)
        .where('academicClassId', academicClass.id)
        .first()
      if (existing && ['active', 'pending'].includes(existing.status)) {
        return { enrollment: existing, alreadyEnrolled: true }
      }

      const invite = await ClassMembershipService.pendingInvitesQuery(user.email, trx)
        .where('academicClassId', academicClass.id)
        .first()
      const registration =
        invite?.registration &&
        !(await ClassMembershipService.registrationTaken(
          academicClass.id,
          invite.registration,
          existing?.id ?? null,
          trx
        ))
          ? invite.registration
          : undefined

      const { enrollment } = await ClassMembershipService.enroll({
        trx,
        actorId: user.id,
        userId: user.id,
        academicClassId: academicClass.id,
        status: invite ? 'active' : 'pending',
        source: invite ? 'invite' : 'code',
        registration,
        decided: false,
        meta: invite ? { inviteId: invite.id, via: 'code' } : { via: 'code' },
      })
      if (invite) {
        invite.useTransaction(trx)
        invite.acceptedAt = DateTime.now()
        await invite.save()
      }
      return { enrollment, alreadyEnrolled: false }
    })

    const { enrollment, alreadyEnrolled } = result
    const name = academicClass.name
    let message: string
    if (enrollment.status === 'active') {
      message = alreadyEnrolled ? `Você já está em ${name}.` : `Você entrou em ${name}.`
    } else {
      message = alreadyEnrolled
        ? `Seu pedido para ${name} já foi enviado. A docente ou a secretaria confirma.`
        : `Pedido enviado para ${name}. A docente ou a secretaria confirma.`
    }

    response.status(alreadyEnrolled ? 200 : 201)
    return {
      data: {
        enrollment: {
          id: enrollment.id,
          academicClassId: enrollment.academicClassId,
          status: enrollment.status,
          source: enrollment.source,
        },
        academicClass: {
          id: academicClass.id,
          name: academicClass.name,
          period: academicClass.period,
          year: academicClass.year,
          semester: academicClass.semester,
          shift: academicClass.shift,
          course: academicClass.course
            ? {
                id: academicClass.course.id,
                code: academicClass.course.code,
                name: academicClass.course.name,
              }
            : null,
        },
        alreadyEnrolled,
        message,
      },
    }
  }

  /** GET /classes/:id/invites: convites ainda não aceitos. */
  async invites({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração vê os convites da turma.')
    }

    const academicClass = await AcademicClass.find(routeId(params.id))
    if (!academicClass) {
      return notFound(response, CLASS_NOT_FOUND)
    }

    const invites = await ClassInvite.query()
      .where('academicClassId', academicClass.id)
      .whereNull('acceptedAt')
      .orderBy('email', 'asc')
    return serialize(ClassInviteTransformer.transform(invites))
  }

  /** DELETE /class-invites/:id: cancela um convite ainda não aceito. */
  async cancelInvite({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, 'Só a administração cancela convites.')
    }

    const invite = await ClassInvite.find(routeId(params.id))
    if (!invite) {
      return notFound(response, 'Convite não encontrado.')
    }
    if (invite.acceptedAt !== null) {
      return conflict(
        response,
        'ALREADY_ACCEPTED',
        'Este convite já virou matrícula. Para tirar o aluno, inative a matrícula.'
      )
    }

    await db.transaction(async (trx) => {
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'invite.cancel',
          entity: 'class_invite',
          entityId: invite.id,
          meta: { academicClassId: invite.academicClassId },
        },
        trx
      )
      invite.useTransaction(trx)
      await invite.delete()
    })

    return { message: 'Convite cancelado.' }
  }

  private async addEmails(admin: User, academicClass: AcademicClass, rawEmails: string[]) {
    const rejected: Rejected[] = []
    const emails: string[] = []
    for (const raw of rawEmails) {
      const email = raw.trim().toLowerCase()
      if (!email) {
        continue
      }
      if (!EMAIL_PATTERN.test(email)) {
        rejected.push({ email: raw.trim(), reason: 'invalid_email', message: 'E-mail inválido.' })
        continue
      }
      if (!emails.includes(email)) {
        emails.push(email)
      }
    }

    let added = 0
    let invited = 0
    if (!emails.length) {
      return { added, invited, rejected }
    }

    const placeholders = emails.map(() => '?').join(', ')
    const users = await User.query().whereRaw(`lower(email) IN (${placeholders})`, emails)
    const usersByEmail = new Map(users.map((item) => [item.email.toLowerCase(), item]))
    const enrollments = await Enrollment.query()
      .where('academicClassId', academicClass.id)
      .whereIn(
        'userId',
        users.map((item) => item.id)
      )
    const enrollmentByUser = new Map(enrollments.map((item) => [item.userId, item]))
    const invites = await ClassInvite.query()
      .where('academicClassId', academicClass.id)
      .whereIn('email', emails)
    const inviteByEmail = new Map(invites.map((item) => [item.email, item]))

    await db.transaction(async (trx) => {
      for (const email of emails) {
        const account = usersByEmail.get(email)
        if (account) {
          if (account.role !== 'student') {
            rejected.push({
              email,
              reason: 'not_student',
              message: 'Esta conta não é de aluno.',
            })
            continue
          }
          if (enrollmentByUser.get(account.id)?.status === 'active') {
            rejected.push({
              email,
              reason: 'already_enrolled',
              message: 'Já está na turma.',
            })
            continue
          }
          await ClassMembershipService.enroll({
            trx,
            actorId: admin.id,
            userId: account.id,
            academicClassId: academicClass.id,
            status: 'active',
            source: 'list',
            decided: true,
          })
          added++
          continue
        }

        const invite = inviteByEmail.get(email)
        if (invite && invite.acceptedAt === null) {
          rejected.push({
            email,
            reason: 'already_invited',
            message: 'Já foi convidado e ainda não criou a conta.',
          })
          continue
        }

        let inviteId: number
        if (invite) {
          // Convite aceito por uma conta que não existe mais: volta a valer.
          invite.useTransaction(trx)
          invite.acceptedAt = null
          invite.createdById = admin.id
          await invite.save()
          inviteId = invite.id
        } else {
          const created = await ClassInvite.create(
            { academicClassId: academicClass.id, email, createdById: admin.id },
            { client: trx }
          )
          inviteId = created.id
        }
        await AuditLogService.record(
          {
            actorId: admin.id,
            action: 'invite.create',
            entity: 'class_invite',
            entityId: inviteId,
            meta: { academicClassId: academicClass.id },
          },
          trx
        )
        invited++
      }
    })

    return { added, invited, rejected }
  }

  /** A turma, se a pessoa pode vê-la (administração ou docente da turma); senão null. */
  private async findVisibleClass(user: User, rawId: unknown) {
    const academicClass = await AcademicClass.find(routeId(rawId))
    if (!academicClass) {
      return null
    }
    return (await AcademicAccessService.canAccessClass(user, academicClass.id))
      ? academicClass
      : null
  }
}

function statusOrder(status: string) {
  const order: Record<EnrollmentStatus, number> = {
    pending: 0,
    active: 1,
    inactive: 2,
    completed: 3,
  }
  return order[status as EnrollmentStatus] ?? 4
}
