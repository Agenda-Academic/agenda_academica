import AcademicEvent from '#models/academic_event'
import Enrollment from '#models/enrollment'
import Grade, { type GradeStatus } from '#models/grade'
import GuardianLink from '#models/guardian_link'
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
import AuditLogService from '#services/audit_log_service'
import GradeService, { formatScore, isGradable, maxScoreOf } from '#services/grade_service'
import { effectiveShareGrades } from '#services/guardian_link_service'
import { countOf } from '#services/query_helpers'
import { bulkGradesValidator, updateGradeValidator } from '#validators/grades'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

const EVENT_NOT_FOUND = 'Evento não encontrado.'
const ROLE_FORBIDDEN = 'Seu perfil não lança nem publica notas.'
const OFFER_FORBIDDEN =
  'Só a docente da disciplina e a administração mexem nas notas desta avaliação.'
const NOT_GRADABLE = 'Só prova e trabalho de turma recebem nota.'
const CLASS_ARCHIVED =
  'Esta turma está arquivada e fica somente leitura. Restaure a turma para mudar as notas.'
const STUDENT_NOT_IN_CLASS = 'Aluno não encontrado nesta turma.'

type Response = HttpContext['response']
type EventLoad =
  | { ok: true; event: AcademicEvent }
  | {
      ok: false
      reply:
        | ReturnType<typeof notFound>
        | ReturnType<typeof forbidden>
        | ReturnType<typeof conflict>
    }

/**
 * Notas de uma avaliação (docente da oferta e administração): lista, lançamento, publicação.
 * E as notas publicadas que o aluno e o responsável veem.
 */
export default class GradesController {
  /** GET /events/:id/grades: todos os alunos ativos da turma, com e sem nota. */
  async index({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não vê as notas da turma.')
    }
    const loaded = await this.loadEvent(user, params.id, response)
    if (!loaded.ok) {
      return loaded.reply
    }
    return {
      data: await GradeService.eventReport(loaded.event, AcademicAccessService.isAdmin(user)),
    }
  }

  /**
   * PUT /events/:id/grades/:studentId: `score` em centésimos, de 0 até o valor da avaliação,
   * ou `status` falta ou dispensa. `{ score: null }` apaga a nota (célula vazia nunca vira 0).
   */
  async update({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }
    const loaded = await this.loadEvent(user, params.id, response)
    if (!loaded.ok) {
      return loaded.reply
    }
    const { event } = loaded
    if (await this.isArchived(event)) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const studentId = routeId(params.studentId)
    const enrollment = await Enrollment.query()
      .where('academicClassId', event.academicClassId!)
      .where('userId', studentId)
      .first()
    const current = await Grade.query()
      .where('academicEventId', event.id)
      .where('studentId', studentId)
      .first()
    // Aluno ativo na turma, ou quem já tem nota (para corrigir ou apagar depois de sair).
    if (enrollment?.status !== 'active' && !current) {
      return notFound(response, STUDENT_NOT_IN_CLASS)
    }

    const payload = await request.validateUsing(updateGradeValidator)
    if (payload.score === undefined && (payload.status ?? 'graded') === 'graded') {
      return fieldError(response, 'score', 'Informe a nota ou a situação do aluno.', 'required')
    }

    const status: GradeStatus = payload.status ?? 'graded'
    let score: number | null = payload.score ?? null
    if (status !== 'graded') {
      if (score !== null) {
        return fieldError(
          response,
          'score',
          'Falta e dispensa não têm nota. Deixe a nota em branco.',
          'prohibited'
        )
      }
      score = null
    } else if (score !== null) {
      const maxScore = maxScoreOf(event)
      if (maxScore === null) {
        return fieldError(
          response,
          'score',
          'Defina quanto vale a avaliação (a pontuação do evento) antes de lançar a nota.',
          'points'
        )
      }
      if (score > maxScore) {
        return fieldError(
          response,
          'score',
          `A nota precisa estar entre 0 e ${formatScore(maxScore)}.`,
          'range'
        )
      }
    }

    const forAdmin = AcademicAccessService.isAdmin(user)
    // `{ score: null }` sem situação: apaga a nota. Nunca grava zero no lugar.
    if (status === 'graded' && score === null) {
      if (current) {
        await db.transaction((trx) =>
          GradeService.clear({ trx, grade: current, eventId: event.id, actorId: user.id })
        )
      }
      return {
        data: await GradeService.eventStudentRow(event, studentId, forAdmin),
        message: 'Nota apagada.',
      }
    }

    if (current && current.status === status && current.score === score) {
      return { data: await GradeService.eventStudentRow(event, studentId, forAdmin) }
    }

    await db.transaction(async (trx) => {
      const grade = await GradeService.write({
        trx,
        eventId: event.id,
        studentId,
        current,
        score,
        status,
        source: 'manual',
        gradeImportId: null,
        actorId: user.id,
      })
      await AuditLogService.record(
        {
          actorId: user.id,
          action: current ? 'grade.update' : 'grade.create',
          entity: 'grade',
          entityId: grade.id,
          subjectUserId: studentId,
          // Sem o valor da nota: só ids e a situação.
          meta: { academicEventId: event.id, status },
        },
        trx
      )
    })

    response.status(current ? 200 : 201)
    return { data: await GradeService.eventStudentRow(event, studentId, forAdmin) }
  }

  /**
   * PUT /events/:id/grades: lançamento em lote da planilha de notas. Cada linha passa pelas
   * mesmas regras do PUT por aluno; se alguma falha, nada é gravado (422 com o erro de cada
   * linha em `grades.<i>.<campo>`). Tudo numa transação. Com as notas já publicadas, quem teve
   * a nota mudada (e seus responsáveis com direito) recebe um aviso. Devolve o relatório do
   * evento (o mesmo do GET) e o resumo do que mudou.
   */
  async bulkUpdate({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }
    const loaded = await this.loadEvent(user, params.id, response)
    if (!loaded.ok) {
      return loaded.reply
    }
    const { event } = loaded
    if (await this.isArchived(event)) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }

    const { grades: rows } = await request.validateUsing(bulkGradesValidator)
    const studentIds = [...new Set(rows.map((row) => row.studentId))]
    const [enrollments, currentGrades] = await Promise.all([
      Enrollment.query()
        .where('academicClassId', event.academicClassId!)
        .whereIn('userId', studentIds)
        .preload('user'),
      Grade.query().where('academicEventId', event.id).whereIn('studentId', studentIds),
    ])
    const activeIds = new Set(
      enrollments
        .filter((item) => item.status === 'active' && item.user?.role === 'student')
        .map((item) => item.userId)
    )
    const gradedIds = new Set(currentGrades.map((grade) => grade.studentId))
    const maxScore = maxScoreOf(event)

    type BulkError = {
      field: string
      rule: string
      message: string
      index: number
      studentId: number
    }
    const errors: BulkError[] = []
    const seen = new Set<number>()
    rows.forEach((row, index) => {
      const fail = (field: string, rule: string, message: string) =>
        errors.push({
          field: `grades.${index}.${field}`,
          rule,
          message,
          index,
          studentId: row.studentId,
        })
      if (seen.has(row.studentId)) {
        return fail('studentId', 'distinct', 'Este aluno aparece mais de uma vez na lista.')
      }
      seen.add(row.studentId)
      // Aluno ativo na turma, ou quem já tem nota (para corrigir ou apagar depois de sair).
      if (!activeIds.has(row.studentId) && !gradedIds.has(row.studentId)) {
        return fail('studentId', 'not_in_class', STUDENT_NOT_IN_CLASS)
      }
      const score = row.score ?? null
      if (row.status === 'graded') {
        if (score === null) {
          return fail('score', 'required', 'Informe a nota ou a situação do aluno.')
        }
        if (maxScore === null) {
          return fail(
            'score',
            'points',
            'Defina quanto vale a avaliação (a pontuação do evento) antes de lançar a nota.'
          )
        }
        if (score > maxScore) {
          return fail('score', 'range', `A nota precisa estar entre 0 e ${formatScore(maxScore)}.`)
        }
      } else if (score !== null) {
        return fail(
          'score',
          'prohibited',
          row.status === 'cleared'
            ? 'Para apagar a nota, deixe a nota em branco.'
            : 'Falta e dispensa não têm nota. Deixe a nota em branco.'
        )
      }
    })
    if (errors.length) {
      return response.unprocessableEntity({ errors })
    }

    const published = event.gradesPublishedAt !== null
    const result = await db.transaction(async (trx) => {
      const summary = { created: 0, updated: 0, cleared: 0, unchanged: 0 }
      const changes: { studentId: number; created: boolean }[] = []
      const fresh = await Grade.query({ client: trx })
        .where('academicEventId', event.id)
        .whereIn('studentId', studentIds)
      const currentByStudent = new Map(fresh.map((grade) => [grade.studentId, grade]))

      for (const row of rows) {
        const current = currentByStudent.get(row.studentId) ?? null
        if (row.status === 'cleared') {
          if (!current) {
            summary.unchanged++
            continue
          }
          await GradeService.clear({ trx, grade: current, eventId: event.id, actorId: user.id })
          summary.cleared++
          changes.push({ studentId: row.studentId, created: false })
          continue
        }
        const status: GradeStatus = row.status
        const score = status === 'graded' ? (row.score ?? null) : null
        if (current && current.status === status && current.score === score) {
          summary.unchanged++
          continue
        }
        const grade = await GradeService.write({
          trx,
          eventId: event.id,
          studentId: row.studentId,
          current,
          score,
          status,
          source: 'manual',
          gradeImportId: null,
          actorId: user.id,
        })
        await AuditLogService.record(
          {
            actorId: user.id,
            action: current ? 'grade.update' : 'grade.create',
            entity: 'grade',
            entityId: grade.id,
            subjectUserId: row.studentId,
            // Sem o valor da nota: só ids e a situação.
            meta: { academicEventId: event.id, status, bulk: true },
          },
          trx
        )
        summary[current ? 'updated' : 'created']++
        changes.push({ studentId: row.studentId, created: !current })
      }

      const notified = published ? await GradeService.notifyChanges({ trx, event, changes }) : null
      return { summary, notified }
    })

    const saved = result.summary.created + result.summary.updated + result.summary.cleared
    let message = saved
      ? `${saved} ${saved === 1 ? 'nota salva' : 'notas salvas'}.`
      : 'Nenhuma nota mudou.'
    if (result.notified && result.notified.students) {
      const { students, guardians } = result.notified
      const who = `${students} ${students === 1 ? 'aluno' : 'alunos'}`
      message += guardians
        ? ` Avisamos ${who} e ${guardians} ${guardians === 1 ? 'responsável' : 'responsáveis'} da mudança.`
        : ` Avisamos ${who} da mudança.`
    }

    return {
      data: await GradeService.eventReport(event, AcademicAccessService.isAdmin(user)),
      summary: result.summary,
      notified: result.notified,
      message,
    }
  }

  /**
   * POST /events/:id/grades/publish: as notas passam a aparecer para os alunos e para os
   * responsáveis com direito, e cada um recebe um aviso. Publicar de novo não avisa de novo.
   */
  async publish({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }
    const loaded = await this.loadEvent(user, params.id, response)
    if (!loaded.ok) {
      return loaded.reply
    }
    const { event } = loaded
    if (await this.isArchived(event)) {
      return conflict(response, 'ARCHIVED', CLASS_ARCHIVED)
    }
    if (event.gradesPublishedAt !== null) {
      return {
        data: {
          eventId: event.id,
          gradesPublishedAt: event.gradesPublishedAt,
          alreadyPublished: true,
          notified: { students: 0, guardians: 0 },
        },
        message: 'As notas desta avaliação já estão publicadas.',
      }
    }
    if ((await countOf(Grade.query().where('academicEventId', event.id))) === 0) {
      return conflict(
        response,
        'NO_GRADES',
        'Lance ou importe pelo menos uma nota antes de publicar.'
      )
    }

    const notified = await db.transaction(async (trx) => {
      const result = await GradeService.publish({ trx, event, actor: user })
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'grades.publish',
          entity: 'academic_event',
          entityId: event.id,
          meta: result,
        },
        trx
      )
      return result
    })

    const students = `${notified.students} ${notified.students === 1 ? 'aluno' : 'alunos'}`
    const guardians = `${notified.guardians} ${notified.guardians === 1 ? 'responsável' : 'responsáveis'}`
    return {
      data: {
        eventId: event.id,
        gradesPublishedAt: event.gradesPublishedAt,
        alreadyPublished: false,
        notified,
      },
      message: `Notas publicadas. Avisamos ${students} e ${guardians}.`,
    }
  }

  /**
   * DELETE /events/:id/grades/publish: as notas voltam a ficar ocultas, e os avisos de
   * publicação ainda não lidos saem. Vale também em turma arquivada, porque só tira acesso.
   */
  async unpublish({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, ROLE_FORBIDDEN)
    }
    const loaded = await this.loadEvent(user, params.id, response)
    if (!loaded.ok) {
      return loaded.reply
    }
    const { event } = loaded
    if (event.gradesPublishedAt === null) {
      return {
        data: { eventId: event.id, gradesPublishedAt: null, removedNotices: 0 },
        message: 'As notas desta avaliação já estão ocultas.',
      }
    }

    const result = await db.transaction(async (trx) => {
      const unpublished = await GradeService.unpublish({ trx, event })
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'grades.unpublish',
          entity: 'academic_event',
          entityId: event.id,
          meta: unpublished,
        },
        trx
      )
      return unpublished
    })

    return {
      data: { eventId: event.id, gradesPublishedAt: null, ...result },
      message:
        'Notas ocultas de novo. Alunos e responsáveis deixam de ver as notas desta avaliação.',
    }
  }

  /** GET /me/grades: o aluno vê só as próprias notas publicadas. */
  async mine({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['student'])) {
      return forbidden(response, 'Só o aluno vê as próprias notas por aqui.')
    }
    return {
      data: {
        student: { id: user.id, fullName: user.fullName, initials: user.initials },
        shareGrades: true,
        ...(await GradeService.studentReport(user)),
      },
    }
  }

  /**
   * GET /students/:id/grades: o responsável com vínculo ativo (de aluno adulto, só se ele
   * compartilha as notas) e a administração. Só notas publicadas, sem média da turma.
   */
  async student({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['guardian', 'admin'])) {
      return forbidden(response, 'Seu perfil não vê as notas de outro aluno.')
    }

    const student = await User.find(routeId(params.id))
    if (!student || student.role !== 'student') {
      return notFound(response, STUDENT_NOT_FOUND)
    }

    let shareGrades = true
    if (AcademicAccessService.isGuardian(user)) {
      // A permissão vem sempre do vínculo ativo, nunca só do papel.
      const link = await GuardianLink.query()
        .where('guardianId', user.id)
        .where('studentId', student.id)
        .where('status', 'active')
        .first()
      if (!link) {
        return notFound(response, STUDENT_NOT_FOUND)
      }
      shareGrades = effectiveShareGrades(link, student)
    }

    const summary = { id: student.id, fullName: student.fullName, initials: student.initials }
    if (!shareGrades) {
      // Aluno adulto que não compartilha: nenhum número, nem a lista de avaliações.
      return {
        data: { student: summary, shareGrades: false, counts: null, subjects: [] },
      }
    }
    return {
      data: {
        student: summary,
        shareGrades: true,
        ...(await GradeService.studentReport(student)),
      },
    }
  }

  /**
   * O evento pela rota, se a pessoa mexe nas notas dele. Evento que a docente nem vê: 404.
   * Evento que ela vê, mas de outra disciplina ou com o vínculo encerrado: 403. Evento que
   * não é prova nem trabalho de turma: 409 NOT_GRADABLE.
   */
  private async loadEvent(user: User, rawId: unknown, response: Response): Promise<EventLoad> {
    const event = await AcademicEvent.query()
      .where('id', routeId(rawId))
      .preload('subject')
      .preload('academicClass')
      .first()
    if (!event || !(await AcademicAccessService.canViewEvent(user, event))) {
      return { ok: false, reply: notFound(response, EVENT_NOT_FOUND) }
    }
    if (!(await AcademicAccessService.canManageGrades(user, event))) {
      return { ok: false, reply: forbidden(response, OFFER_FORBIDDEN) }
    }
    if (!isGradable(event)) {
      return { ok: false, reply: conflict(response, 'NOT_GRADABLE', NOT_GRADABLE) }
    }
    return { ok: true, event }
  }

  private async isArchived(event: AcademicEvent) {
    return event.academicClass?.isArchived ?? false
  }
}
