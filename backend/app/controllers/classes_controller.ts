import AcademicClass, { ANNUAL_SEMESTER, classTerm } from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import ClassInvite from '#models/class_invite'
import ClassSubject from '#models/class_subject'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import TeachingAssignment from '#models/teaching_assignment'
import type User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import { conflict, fieldError, forbidden, notFound, routeId } from '#services/api_errors'
import AuditLogService from '#services/audit_log_service'
import ClassStatsService from '#services/class_stats_service'
import JoinCodeService from '#services/join_code_service'
import { countOf } from '#services/query_helpers'
import AcademicClassTransformer from '#transformers/academic_class_transformer'
import ClassDetailTransformer from '#transformers/class_detail_transformer'
import { createClassValidator, updateClassValidator } from '#validators/management'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const ONLY_ADMIN = 'Só a administração cria, edita, arquiva e exclui turmas.'
const NOT_FOUND = 'Turma não encontrada.'
const ARCHIVED =
  'Esta turma está arquivada e fica somente leitura. Restaure a turma para mudar algo.'
const ANNUAL_ONLY_INTEGRADO = 'Turma de curso integrado é anual e não tem semestre.'
const SEMESTER_NOT_ANNUAL = 'Só a turma de curso integrado é anual. Escolha o 1º ou o 2º semestre.'
const SEMESTER_REQUIRED = 'Escolha o semestre da turma: 1º ou 2º.'
const SEMESTER_LEAVING_INTEGRADO =
  'A turma deixa de ser anual fora do curso integrado. Escolha o 1º ou o 2º semestre.'

type SemesterChoice = { semester: number } | { rule: string; message: string }

/**
 * Turmas. A administração vê e muda todas; a docente vê só as turmas em que tem vínculo em
 * vigor e cuida do código delas. Turma fora do alcance devolve 404.
 */
export default class ClassesController {
  async index({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não tem acesso à gestão de turmas.')
    }

    const query = AcademicClass.query()
      .preload('course')
      .orderBy('year', 'desc')
      .orderBy('semester', 'desc')
      .orderBy('name', 'asc')

    if (AcademicAccessService.isTeacher(user)) {
      query.whereIn('id', await AcademicAccessService.teacherClassIds(user))
    }

    const { courseId, year, semester, archived, q } = request.qs()
    if (['1', 'true'].includes(String(archived ?? '').toLowerCase())) {
      query.whereNotNull('archivedAt')
    } else {
      query.whereNull('archivedAt')
    }
    // Filtro numérico inválido é ignorado, como os outros filtros vazios.
    const asInteger = (value: unknown) =>
      value !== undefined && value !== '' && Number.isInteger(Number(value)) ? Number(value) : null
    for (const [column, value] of [
      ['courseId', courseId],
      ['year', year],
    ] as const) {
      const number = asInteger(value)
      if (number !== null) {
        query.where(column, number)
      }
    }
    // A turma anual (curso integrado, semestre 0) vale o ano inteiro: entra no filtro do 1º e
    // do 2º semestre. `semester=0` traz só as anuais.
    const semesterFilter = asInteger(semester)
    if (semesterFilter !== null) {
      query.where((semesterQuery) => {
        semesterQuery.where('semester', semesterFilter)
        if (semesterFilter !== ANNUAL_SEMESTER) {
          semesterQuery.orWhere('semester', ANNUAL_SEMESTER)
        }
      })
    }
    if (q && String(q).trim()) {
      query.where('name', 'like', `%${String(q).trim()}%`)
    }

    const classes = await query
    const stats = await ClassStatsService.forClasses(classes.map((item) => item.id))
    return serialize(AcademicClassTransformer.transform(classes, stats))
  }

  async show({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não tem acesso à gestão de turmas.')
    }

    const academicClass = await this.findVisible(user, params.id)
    if (!academicClass) {
      return notFound(response, NOT_FOUND)
    }

    return serialize(ClassDetailTransformer.transform(await this.detail(academicClass)))
  }

  async store({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const payload = await request.validateUsing(createClassValidator)
    const course = await this.activeCourse(payload.courseId)
    if (typeof course === 'string') {
      return fieldError(response, 'courseId', course)
    }

    const choice = this.chooseSemester(course, payload.semester)
    if (!('semester' in choice)) {
      return fieldError(response, 'semester', choice.message, choice.rule)
    }
    const semester = choice.semester

    const duplicate = await this.findDuplicate({ ...payload, semester })
    if (duplicate) {
      return this.duplicateResponse(response, duplicate)
    }

    const academicClass = await db.transaction(async (trx) => {
      const created = await AcademicClass.create(
        {
          courseId: payload.courseId,
          name: payload.name,
          period: payload.period,
          year: payload.year,
          semester,
          shift: payload.shift,
          active: true,
        },
        { client: trx }
      )
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'class.create',
          entity: 'academic_class',
          entityId: created.id,
          meta: { courseId: created.courseId, year: created.year, semester: created.semester },
        },
        trx
      )
      return created
    })

    await academicClass.refresh()
    await academicClass.load('course')
    response.status(201)
    return serialize(ClassDetailTransformer.transform(await this.detail(academicClass)))
  }

  async update({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const academicClass = await AcademicClass.find(routeId(params.id))
    if (!academicClass) {
      return notFound(response, NOT_FOUND)
    }
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', ARCHIVED)
    }

    const payload = await request.validateUsing(updateClassValidator)
    const course =
      payload.courseId !== undefined && payload.courseId !== academicClass.courseId
        ? await this.activeCourse(payload.courseId)
        : await Course.findOrFail(academicClass.courseId)
    if (typeof course === 'string') {
      return fieldError(response, 'courseId', course)
    }

    // A regra do semestre vale para o curso de destino: indo para o integrado, a turma vira
    // anual; saindo dele, o semestre passa a ser obrigatório.
    const choice = this.chooseSemester(course, payload.semester, academicClass)
    if (!('semester' in choice)) {
      return fieldError(response, 'semester', choice.message, choice.rule)
    }

    const target = {
      courseId: course.id,
      name: payload.name ?? academicClass.name,
      year: payload.year ?? academicClass.year,
      semester: choice.semester,
    }
    const duplicate = await this.findDuplicate(target, academicClass.id)
    if (duplicate) {
      return this.duplicateResponse(response, duplicate)
    }

    const fields = ['courseId', 'name', 'period', 'year', 'semester', 'shift'] as const
    const before = Object.fromEntries(fields.map((field) => [field, academicClass[field]]))
    await db.transaction(async (trx) => {
      academicClass.useTransaction(trx)
      // O semestre vem sempre de chooseSemester (o `null` do corpo não chega à coluna).
      academicClass.merge({ ...payload, courseId: course.id, semester: choice.semester })
      await academicClass.save()
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'class.update',
          entity: 'academic_class',
          entityId: academicClass.id,
          meta: {
            before,
            after: Object.fromEntries(fields.map((field) => [field, academicClass[field]])),
          },
        },
        trx
      )
    })

    await academicClass.load('course')
    return serialize(ClassDetailTransformer.transform(await this.detail(academicClass)))
  }

  /** Arquiva: fica somente leitura, sai dos seletores e o código é desligado. */
  async archive({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const academicClass = await AcademicClass.find(routeId(params.id))
    if (!academicClass) {
      return notFound(response, NOT_FOUND)
    }

    if (!academicClass.isArchived) {
      await db.transaction(async (trx) => {
        academicClass.useTransaction(trx)
        academicClass.archivedAt = DateTime.now()
        academicClass.active = false
        academicClass.joinCodeActive = false
        await academicClass.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'class.archive',
            entity: 'academic_class',
            entityId: academicClass.id,
          },
          trx
        )
      })
    }

    await academicClass.load('course')
    return serialize(ClassDetailTransformer.transform(await this.detail(academicClass)))
  }

  /** Restaura: volta aos seletores, mas o código continua desligado. */
  async restore({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const academicClass = await AcademicClass.query()
      .where('id', routeId(params.id))
      .preload('course')
      .first()
    if (!academicClass) {
      return notFound(response, NOT_FOUND)
    }

    if (academicClass.isArchived) {
      if (academicClass.course?.isArchived) {
        return conflict(
          response,
          'COURSE_ARCHIVED',
          'O curso desta turma está arquivado. Restaure o curso antes de restaurar a turma.',
          { courseId: academicClass.courseId }
        )
      }
      await db.transaction(async (trx) => {
        academicClass.useTransaction(trx)
        academicClass.archivedAt = null
        academicClass.active = true
        await academicClass.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'class.restore',
            entity: 'academic_class',
            entityId: academicClass.id,
          },
          trx
        )
      })
    }

    return serialize(ClassDetailTransformer.transform(await this.detail(academicClass)))
  }

  /**
   * Exclui só a turma vazia: sem matrícula de nenhum status, convite, evento, oferta ou
   * docente. A contagem roda na mesma transação da exclusão: as FKs para a turma ainda são
   * CASCADE, e uma matrícula criada entre a conferência e o DELETE seria apagada junto.
   */
  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin'])) {
      return forbidden(response, ONLY_ADMIN)
    }

    const academicClass = await AcademicClass.find(routeId(params.id))
    if (!academicClass) {
      return notFound(response, NOT_FOUND)
    }

    const blocked = await db.transaction(async (trx) => {
      const counts = await this.dependents(academicClass.id, trx)
      if (Object.values(counts).some((total) => total > 0)) {
        return counts
      }
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'class.delete',
          entity: 'academic_class',
          entityId: academicClass.id,
          meta: { courseId: academicClass.courseId },
        },
        trx
      )
      academicClass.useTransaction(trx)
      await academicClass.delete()
      return null
    })

    if (blocked) {
      return conflict(
        response,
        'HAS_DEPENDENTS',
        'Esta turma tem alunos, convites, eventos ou disciplinas. Só dá para excluir uma turma vazia; arquive a turma em vez de excluir.',
        { counts: blocked }
      )
    }
    return { message: 'Turma excluída.' }
  }

  /** Gera um código novo (o antigo para de valer) e liga. */
  async createJoinCode({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não cuida do código da turma.')
    }

    const academicClass = await this.findVisible(user, params.id)
    if (!academicClass) {
      return notFound(response, NOT_FOUND)
    }
    if (academicClass.isArchived) {
      return conflict(response, 'ARCHIVED', ARCHIVED)
    }

    await db.transaction(async (trx) => {
      academicClass.useTransaction(trx)
      academicClass.joinCode = await JoinCodeService.generateUnique(trx)
      academicClass.joinCodeActive = true
      await academicClass.save()
      // O código em si não vai para o registro.
      await AuditLogService.record(
        {
          actorId: user.id,
          action: 'class.join_code_create',
          entity: 'academic_class',
          entityId: academicClass.id,
        },
        trx
      )
    })

    return { data: this.joinCodeData(academicClass) }
  }

  async disableJoinCode({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.allow(user, ['admin', 'teacher'])) {
      return forbidden(response, 'Seu perfil não cuida do código da turma.')
    }

    const academicClass = await this.findVisible(user, params.id)
    if (!academicClass) {
      return notFound(response, NOT_FOUND)
    }

    if (academicClass.joinCodeActive) {
      await db.transaction(async (trx) => {
        academicClass.useTransaction(trx)
        academicClass.joinCodeActive = false
        await academicClass.save()
        await AuditLogService.record(
          {
            actorId: user.id,
            action: 'class.join_code_disable',
            entity: 'academic_class',
            entityId: academicClass.id,
          },
          trx
        )
      })
    }

    return { data: this.joinCodeData(academicClass) }
  }

  private joinCodeData(academicClass: AcademicClass) {
    return {
      academicClassId: academicClass.id,
      joinCode: academicClass.joinCode,
      joinCodeFormatted: JoinCodeService.format(academicClass.joinCode),
      joinCodeActive: Boolean(academicClass.joinCodeActive),
    }
  }

  /** A turma, se a pessoa pode vê-la nas rotas de gestão; senão null (vira 404). */
  private async findVisible(user: User, rawId: unknown) {
    const academicClass = await AcademicClass.query()
      .where('id', routeId(rawId))
      .preload('course')
      .first()
    if (!academicClass) {
      return null
    }
    return (await AcademicAccessService.canAccessClass(user, academicClass.id))
      ? academicClass
      : null
  }

  private async detail(academicClass: AcademicClass) {
    const [offers, assignments, stats, futureEvents] = await Promise.all([
      ClassSubject.query()
        .where('academicClassId', academicClass.id)
        .preload('subject')
        .orderBy('archivedAt', 'asc')
        .orderBy('id', 'asc'),
      TeachingAssignment.query()
        .where('academicClassId', academicClass.id)
        .whereNull('endedAt')
        .preload('teacher', (teacherQuery) => teacherQuery.select('id', 'fullName')),
      ClassStatsService.forClass(academicClass.id),
      ClassStatsService.futureEvents(academicClass.id),
    ])
    return { academicClass, offers, assignments, stats, futureEvents }
  }

  /** O curso, se existe e não está arquivado; senão a mensagem para o campo `courseId`. */
  private async activeCourse(courseId: number) {
    const course = await Course.find(courseId)
    if (!course) {
      return 'Curso não encontrado. Escolha um curso da lista.'
    }
    if (course.isArchived) {
      return 'Este curso está arquivado. Restaure o curso antes de criar turmas nele.'
    }
    return course
  }

  /**
   * Semestre que a turma grava no curso dado. Curso integrado: turma anual, semestre 0 (vazio
   * ou 0 explícito; 1 ou 2 é erro). Outros cursos: 1 ou 2, obrigatório; na edição, sem semestre
   * no corpo, vale o que a turma já tem, desde que não seja o 0 de uma turma anual.
   */
  private chooseSemester(
    course: Course,
    sent: number | null | undefined,
    current?: AcademicClass
  ): SemesterChoice {
    if (course.modality === 'integrado') {
      return sent === undefined || sent === null || sent === ANNUAL_SEMESTER
        ? { semester: ANNUAL_SEMESTER }
        : { rule: 'annual', message: ANNUAL_ONLY_INTEGRADO }
    }
    if (sent === ANNUAL_SEMESTER) {
      return { rule: 'annual', message: SEMESTER_NOT_ANNUAL }
    }
    if (sent !== undefined && sent !== null) {
      return { semester: sent }
    }
    if (current && !current.isAnnual) {
      return { semester: current.semester }
    }
    return {
      rule: 'required',
      message: current ? SEMESTER_LEAVING_INTEGRADO : SEMESTER_REQUIRED,
    }
  }

  private async findDuplicate(
    target: { courseId: number; name: string; year: number; semester: number },
    exceptId?: number
  ) {
    const query = AcademicClass.query()
      .where('courseId', target.courseId)
      .where('year', target.year)
      .where('semester', target.semester)
      .whereRaw('lower(name) = ?', [target.name.toLowerCase()])
    if (exceptId) {
      query.whereNot('id', exceptId)
    }
    return query.first()
  }

  private duplicateResponse(response: HttpContext['response'], duplicate: AcademicClass) {
    // Turma anual sai como "2026", nunca "2026/0".
    const term = classTerm(duplicate.year, duplicate.semester)
    if (duplicate.isArchived) {
      return conflict(
        response,
        'ARCHIVED_DUPLICATE',
        `Já existe a turma ${duplicate.name} em ${term}, arquivada. Restaure a turma para usar de novo.`,
        { archivedId: duplicate.id }
      )
    }
    return fieldError(
      response,
      'name',
      `Já existe a turma ${duplicate.name} em ${term} neste curso. Escolha outro nome.`,
      'unique'
    )
  }

  /** Tudo o que aponta para a turma; os convites também, porque a FK deles é CASCADE. */
  private async dependents(academicClassId: number, trx: TransactionClientContract) {
    const client = { client: trx }
    const enrollments = await countOf(
      Enrollment.query(client).where('academicClassId', academicClassId)
    )
    const invites = await countOf(
      ClassInvite.query(client).where('academicClassId', academicClassId)
    )
    const events = await countOf(
      AcademicEvent.query(client).where('academicClassId', academicClassId)
    )
    const offers = await countOf(
      ClassSubject.query(client).where('academicClassId', academicClassId)
    )
    const teachingAssignments = await countOf(
      TeachingAssignment.query(client).where('academicClassId', academicClassId)
    )
    return { enrollments, invites, events, offers, teachingAssignments }
  }
}
