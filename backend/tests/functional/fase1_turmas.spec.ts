import { http } from '#config/app'
import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import AuditLog from '#models/audit_log'
import ClassInvite from '#models/class_invite'
import ClassSubject from '#models/class_subject'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import Reminder from '#models/reminder'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import AttemptLimiterService, {
  MAX_FAILED_ATTEMPTS,
  MAX_FAILED_ATTEMPTS_PER_IP,
} from '#services/attempt_limiter_service'
import ReminderDeliveryService from '#services/reminder_delivery_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

type Envelope<T> = { data: T }
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }

const API = '/api/v1'
const INVALID_CODE = 'Código inválido ou expirado. Confira com quem passou o código.'

async function expectStatus(request: any, status: number) {
  const response = await request
  response.assertStatus(status)
  return response
}

async function loginAs(client: any, email: string) {
  const response = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as Envelope<{ token: string }>).data.token
}

async function signup(client: any, email: string, role = 'student') {
  const response = await client.post(`${API}/auth/signup`).json({
    fullName: 'Conta Nova',
    email,
    password: 'password123',
    passwordConfirmation: 'password123',
    role,
  })
  response.assertStatus(200)
  return (response.body() as Envelope<{ token: string; user: { id: number } }>).data
}

function fieldOf(body: unknown) {
  return ((body as FieldErrors).errors ?? []).map((error) => error.field)
}

async function demo() {
  const [tads, inf, admin, maraisa, marina, diogo, ana, math, dataStructures, databases] =
    await Promise.all([
      AcademicClass.findByOrFail('name', 'TADS 5'),
      AcademicClass.findByOrFail('name', 'INF 3A'),
      User.findByOrFail('email', 'admin@agenda.test'),
      User.findByOrFail('email', 'maraisa@agenda.test'),
      User.findByOrFail('email', 'marina@agenda.test'),
      User.findByOrFail('email', 'diogo@agenda.test'),
      User.findByOrFail('email', 'ana@agenda.test'),
      Subject.findByOrFail('code', 'MAT-401'),
      Subject.findByOrFail('code', 'ED-401'),
      Subject.findByOrFail('code', 'BD-401'),
    ])
  return { tads, inf, admin, maraisa, marina, diogo, ana, math, dataStructures, databases }
}

async function countOf(query: any) {
  const [row] = await query.count('* as total')
  return Number(row.$extras.total)
}

test.group('Fase 1: turmas, disciplinas e vínculos', (group) => {
  group.each.setup(() => {
    AttemptLimiterService.clear()
    return testUtils.db().withGlobalTransaction()
  })

  test('seed: ofertas da TADS 5 com uma sem docente, INF 3A com aluna menor e códigos ligados', async ({
    assert,
  }) => {
    const { tads, inf, ana, databases } = await demo()
    const offers = await ClassSubject.query().where('academicClassId', tads.id)
    assert.lengthOf(offers, 4)
    assert.isNull(
      await TeachingAssignment.query()
        .where('academicClassId', tads.id)
        .where('subjectId', databases.id)
        .first()
    )
    assert.isTrue(ana.isMinor)
    assert.isTrue(tads.joinCodeActive)
    assert.isTrue(inf.joinCodeActive)
    await inf.load('course')
    assert.equal(inf.course.modality, 'integrado')
  })

  test('cursos: administração cria, edita, arquiva, restaura e exclui o vazio', async ({
    client,
    assert,
  }) => {
    const token = await loginAs(client, 'admin@agenda.test')

    const created = await client
      .post(`${API}/courses`)
      .bearerToken(token)
      .json({ name: 'Licenciatura em Computação', code: 'lc-01', modality: 'superior' })
    created.assertStatus(201)
    const course = (created.body() as Envelope<{ id: number; code: string; active: boolean }>).data
    assert.equal(course.code, 'LC-01')
    assert.isTrue(course.active)

    const duplicate = await client
      .post(`${API}/courses`)
      .bearerToken(token)
      .json({ name: 'Outro', code: 'LC-01' })
    duplicate.assertStatus(422)
    assert.include(fieldOf(duplicate.body()), 'code')

    const invalid = await client
      .post(`${API}/courses`)
      .bearerToken(token)
      .json({ name: 'X', code: 'código ruim!' })
    invalid.assertStatus(422)
    assert.includeMembers(fieldOf(invalid.body()), ['name', 'code'])

    const updated = await client
      .put(`${API}/courses/${course.id}`)
      .bearerToken(token)
      .json({ name: 'Licenciatura em Computação (noturno)' })
    updated.assertStatus(200)

    const archived = await client.post(`${API}/courses/${course.id}/archive`).bearerToken(token)
    archived.assertStatus(200)
    assert.isNotNull((archived.body() as Envelope<{ archivedAt: string }>).data.archivedAt)

    const editArchived = await client
      .put(`${API}/courses/${course.id}`)
      .bearerToken(token)
      .json({ name: 'Nome novo' })
    editArchived.assertStatus(409)

    const sameCode = await client
      .post(`${API}/courses`)
      .bearerToken(token)
      .json({ name: 'Licenciatura de novo', code: 'LC-01' })
    sameCode.assertStatus(409)
    assert.equal((sameCode.body() as { code: string }).code, 'ARCHIVED_DUPLICATE')
    assert.equal((sameCode.body() as { archivedId: number }).archivedId, course.id)

    const list = await client.get(`${API}/courses`).bearerToken(token).qs({ archived: 1 })
    list.assertStatus(200)
    assert.include(
      (list.body() as Envelope<{ id: number }[]>).data.map((item) => item.id),
      course.id
    )

    const restored = await client.post(`${API}/courses/${course.id}/restore`).bearerToken(token)
    restored.assertStatus(200)
    assert.isNull((restored.body() as Envelope<{ archivedAt: string | null }>).data.archivedAt)

    const removed = await client.delete(`${API}/courses/${course.id}`).bearerToken(token)
    removed.assertStatus(200)
    assert.isNull(await Course.find(course.id))

    const audit = await AuditLog.query()
      .where('entity', 'course')
      .where('entityId', course.id)
      .orderBy('id')
    assert.includeMembers(
      audit.map((entry) => entry.action),
      ['course.create', 'course.update', 'course.archive', 'course.restore', 'course.delete']
    )
  })

  test('cursos: com turma ativa não arquiva, com turma não exclui, e nada é apagado', async ({
    client,
    assert,
  }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const tads = await Course.findByOrFail('code', 'TADS')
    const classesBefore = await countOf(AcademicClass.query().where('courseId', tads.id))

    const archive = await client.post(`${API}/courses/${tads.id}/archive`).bearerToken(token)
    archive.assertStatus(409)
    assert.equal((archive.body() as { code: string }).code, 'HAS_DEPENDENTS')

    const remove = await client.delete(`${API}/courses/${tads.id}`).bearerToken(token)
    remove.assertStatus(409)
    assert.equal((remove.body() as { code: string }).code, 'HAS_DEPENDENTS')
    assert.isNotNull(await Course.find(tads.id))
    assert.equal(await countOf(AcademicClass.query().where('courseId', tads.id)), classesBefore)

    const missing = await client.put(`${API}/courses/999999`).bearerToken(token).json({})
    missing.assertStatus(404)
  })

  test('cursos: docente e aluno recebem 403', async ({ client }) => {
    for (const email of ['maraisa@agenda.test', 'diogo@agenda.test']) {
      const token = await loginAs(client, email)
      await expectStatus(client.get(`${API}/courses`).bearerToken(token), 403)
      await expectStatus(
        client.post(`${API}/courses`).bearerToken(token).json({ name: 'Curso', code: 'CUR' }),
        403
      )
      await expectStatus(client.delete(`${API}/courses/1`).bearerToken(token), 403)
    }
  })

  test('turmas: a administração vê todas e a docente só as suas, com contagens', async ({
    client,
    assert,
  }) => {
    const { tads, inf } = await demo()

    const admin = await client
      .get(`${API}/classes`)
      .bearerToken(await loginAs(client, 'admin@agenda.test'))
    admin.assertStatus(200)
    const adminClasses = (
      admin.body() as Envelope<
        { id: number; counts: { activeStudents: number; subjectsWithoutTeacher: number } }[]
      >
    ).data
    assert.includeMembers(
      adminClasses.map((item) => item.id),
      [tads.id, inf.id]
    )
    const tadsSummary = adminClasses.find((item) => item.id === tads.id)!
    assert.equal(tadsSummary.counts.activeStudents, 1)
    assert.equal(tadsSummary.counts.subjectsWithoutTeacher, 1)
    assert.notProperty(tadsSummary, 'joinCode')

    const maraisa = await client
      .get(`${API}/classes`)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
    maraisa.assertStatus(200)
    assert.deepEqual(
      (maraisa.body() as Envelope<{ id: number }[]>).data.map((item) => item.id),
      [tads.id]
    )

    const student = await client
      .get(`${API}/classes`)
      .bearerToken(await loginAs(client, 'diogo@agenda.test'))
    student.assertStatus(403)
  })

  test('turma por id: 404 fora do alcance da docente, 403 para aluno, código só para quem pode', async ({
    client,
    assert,
  }) => {
    const { tads, inf } = await demo()
    const maraisaToken = await loginAs(client, 'maraisa@agenda.test')

    const own = await client.get(`${API}/classes/${tads.id}`).bearerToken(maraisaToken)
    own.assertStatus(200)
    const detail = (
      own.body() as Envelope<{
        joinCode: string
        offers: { subject: { code: string }; withoutTeacher: boolean; teachers: object[] }[]
      }>
    ).data
    assert.equal(detail.joinCode, 'TADS5K7Q')
    const pending = detail.offers.filter((offer) => offer.withoutTeacher)
    assert.deepEqual(
      pending.map((offer) => offer.subject.code),
      ['BD-401']
    )
    for (const offer of detail.offers) {
      for (const teacher of offer.teachers) {
        assert.sameMembers(Object.keys(teacher), ['assignmentId', 'teacherId', 'fullName', 'role'])
      }
    }

    const other = await client.get(`${API}/classes/${inf.id}`).bearerToken(maraisaToken)
    other.assertStatus(404)

    const student = await client
      .get(`${API}/classes/${tads.id}`)
      .bearerToken(await loginAs(client, 'diogo@agenda.test'))
    student.assertStatus(403)

    // Nem o catalog nem os eventos levam o código da turma.
    const context = await client
      .get(`${API}/context`)
      .bearerToken(await loginAs(client, 'diogo@agenda.test'))
    const catalog = (context.body() as Envelope<{ catalog: { classes: object[] } }>).data.catalog
    for (const item of catalog.classes) {
      assert.notProperty(item, 'joinCode')
      assert.notProperty(item, 'joinCodeActive')
    }
  })

  test('turmas: criar, nome repetido, editar, e só a administração', async ({ client, assert }) => {
    const { tads } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const payload = {
      courseId: tads.courseId,
      name: 'TADS 6',
      year: 2026,
      semester: 2,
      shift: 'noturno',
      period: '6º período',
    }

    const created = await client.post(`${API}/classes`).bearerToken(token).json(payload)
    created.assertStatus(201)
    const id = (created.body() as Envelope<{ id: number }>).data.id

    const repeated = await client
      .post(`${API}/classes`)
      .bearerToken(token)
      .json({ ...payload, name: 'tads 6' })
    repeated.assertStatus(422)
    assert.include(fieldOf(repeated.body()), 'name')

    const invalid = await client
      .post(`${API}/classes`)
      .bearerToken(token)
      .json({ ...payload, year: 1999, semester: 3, shift: 'madrugada' })
    invalid.assertStatus(422)
    assert.includeMembers(fieldOf(invalid.body()), ['year', 'semester', 'shift'])

    const edited = await client
      .put(`${API}/classes/${id}`)
      .bearerToken(token)
      .json({ period: '6º período, noturno' })
    edited.assertStatus(200)

    const teacherToken = await loginAs(client, 'maraisa@agenda.test')
    await expectStatus(
      client
        .post(`${API}/classes`)
        .bearerToken(teacherToken)
        .json({ ...payload, name: 'TADS 7' }),
      403
    )
    await expectStatus(
      client.put(`${API}/classes/${tads.id}`).bearerToken(teacherToken).json({ name: 'X' }),
      403
    )
    await expectStatus(
      client.post(`${API}/classes/${tads.id}/archive`).bearerToken(teacherToken),
      403
    )
    await expectStatus(client.delete(`${API}/classes/${tads.id}`).bearerToken(teacherToken), 403)
  })

  test('turma com matrícula, evento e oferta não é excluída e nada é apagado', async ({
    client,
    assert,
  }) => {
    const { tads } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const before = {
      events: await countOf(AcademicEvent.query().where('academicClassId', tads.id)),
      enrollments: await countOf(Enrollment.query().where('academicClassId', tads.id)),
      assignments: await countOf(TeachingAssignment.query().where('academicClassId', tads.id)),
    }

    const response = await client.delete(`${API}/classes/${tads.id}`).bearerToken(token)
    response.assertStatus(409)
    const body = response.body() as {
      code: string
      counts: { enrollments: number; events: number; offers: number }
    }
    assert.equal(body.code, 'HAS_DEPENDENTS')
    assert.equal(body.counts.events, before.events)
    assert.isAbove(body.counts.offers, 0)

    assert.isNotNull(await AcademicClass.find(tads.id))
    assert.equal(
      await countOf(AcademicEvent.query().where('academicClassId', tads.id)),
      before.events
    )
    assert.equal(
      await countOf(Enrollment.query().where('academicClassId', tads.id)),
      before.enrollments
    )
    assert.equal(
      await countOf(TeachingAssignment.query().where('academicClassId', tads.id)),
      before.assignments
    )
  })

  test('turma vazia é excluída', async ({ client, assert }) => {
    const { tads } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const created = await client.post(`${API}/classes`).bearerToken(token).json({
      courseId: tads.courseId,
      name: 'Turma vazia',
      year: 2026,
      semester: 1,
      shift: 'matutino',
      period: '1º período',
    })
    created.assertStatus(201)
    const id = (created.body() as Envelope<{ id: number }>).data.id

    const removed = await client.delete(`${API}/classes/${id}`).bearerToken(token)
    removed.assertStatus(200)
    assert.isNull(await AcademicClass.find(id))
    assert.isNotNull(
      await AuditLog.query().where('action', 'class.delete').where('entityId', id).first()
    )
  })

  test('turma arquivada: somente leitura, código desligado, sem lembretes e restaurável', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, math } = await demo()
    const adminToken = await loginAs(client, 'admin@agenda.test')

    // Lembrete vencido de um evento da turma: depois de arquivar, ninguém recebe.
    const event = await AcademicEvent.query().where('academicClassId', tads.id).firstOrFail()
    const reminder = await Reminder.create({
      userId: diogo.id,
      academicEventId: event.id,
      channel: 'email',
      offsetMinutes: 60,
      sendAt: DateTime.now().minus({ minutes: 5 }),
      enabled: true,
    })

    const archived = await client.post(`${API}/classes/${tads.id}/archive`).bearerToken(adminToken)
    archived.assertStatus(200)
    const body = (
      archived.body() as Envelope<{
        archivedAt: string
        joinCodeActive: boolean
        futureEvents: number
      }>
    ).data
    assert.isNotNull(body.archivedAt)
    assert.isFalse(body.joinCodeActive)
    assert.isAtLeast(body.futureEvents, 1)

    const delivery = await ReminderDeliveryService.sendDue({ now: DateTime.now() })
    assert.notInclude(
      delivery.deliveries.map((item) => item.reminderId),
      reminder.id
    )

    const teacherToken = await loginAs(client, 'maraisa@agenda.test')
    const newEvent = await client.post(`${API}/events`).bearerToken(teacherToken).json({
      title: 'Evento em turma arquivada',
      category: 'activity',
      startsAt: '2026-12-10T19:00',
      academicClassId: tads.id,
      subjectId: math.id,
    })
    newEvent.assertStatus(409)
    const editEvent = await client
      .put(`${API}/events/${event.id}`)
      .bearerToken(teacherToken)
      .json({ title: 'Título novo' })
    editEvent.assertStatus(409)
    await expectStatus(
      client.put(`${API}/classes/${tads.id}`).bearerToken(adminToken).json({ name: 'X' }),
      409
    )
    await expectStatus(
      client
        .post(`${API}/classes/${tads.id}/students`)
        .bearerToken(adminToken)
        .json({ emails: ['alguem@agenda.test'] }),
      409
    )
    await expectStatus(
      client.post(`${API}/classes/${tads.id}/join-code`).bearerToken(adminToken),
      409
    )

    const student = await signup(client, 'novata@agenda.test')
    const join = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(student.token)
      .json({ code: 'TADS5K7Q' })
    join.assertStatus(422)
    assert.equal((join.body() as { message: string }).message, INVALID_CODE)

    // O aluno continua vendo os eventos da turma arquivada no histórico.
    const events = await client
      .get(`${API}/events`)
      .bearerToken(await loginAs(client, 'diogo@agenda.test'))
    assert.include(
      (events.body() as Envelope<{ id: number }[]>).data.map((item) => item.id),
      event.id
    )

    // E a turma sai do catalog e da lista padrão.
    const context = await client
      .get(`${API}/context`)
      .bearerToken(await loginAs(client, 'diogo@agenda.test'))
    const data = (
      context.body() as unknown as Envelope<{
        catalog: { classes: { id: number }[] }
        enrollments: object[]
      }>
    ).data
    assert.notInclude(
      data.catalog.classes.map((item) => item.id),
      tads.id
    )
    assert.lengthOf(data.enrollments, 0)

    const sameName = await client.post(`${API}/classes`).bearerToken(adminToken).json({
      courseId: tads.courseId,
      name: 'TADS 5',
      year: tads.year,
      semester: tads.semester,
      shift: 'noturno',
      period: '5º período',
    })
    sameName.assertStatus(409)
    assert.equal((sameName.body() as { code: string }).code, 'ARCHIVED_DUPLICATE')
    assert.equal((sameName.body() as { archivedId: number }).archivedId, tads.id)

    const restored = await client.post(`${API}/classes/${tads.id}/restore`).bearerToken(adminToken)
    restored.assertStatus(200)
    const restoredBody = (
      restored.body() as Envelope<{ archivedAt: null; joinCodeActive: boolean }>
    ).data
    assert.isNull(restoredBody.archivedAt)
    assert.isFalse(restoredBody.joinCodeActive)

    const classAudit = await AuditLog.query()
      .where('entity', 'academic_class')
      .where('entityId', tads.id)
    const actions = classAudit.map((entry) => entry.action)
    assert.includeMembers(actions, ['class.archive', 'class.restore'])
  })

  test('disciplinas: usedIn, avisos de nome, código repetido e arquivado, excluir só sem uso', async ({
    client,
    assert,
  }) => {
    const { math } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')

    const list = await client.get(`${API}/subjects`).bearerToken(token)
    list.assertStatus(200)
    const mat = (list.body() as Envelope<{ id: number; usedIn: number }[]>).data.find(
      (item) => item.id === math.id
    )!
    assert.equal(mat.usedIn, 1)

    const created = await client
      .post(`${API}/subjects`)
      .bearerToken(token)
      .json({ code: 'MAT-402', name: 'matemática' })
    created.assertStatus(201)
    const createdBody = created.body() as Envelope<{ id: number }> & { warnings: string[] }
    assert.lengthOf(createdBody.warnings, 1)

    const repeated = await client
      .post(`${API}/subjects`)
      .bearerToken(token)
      .json({ code: 'mat-401', name: 'Outra' })
    repeated.assertStatus(422)
    assert.include(fieldOf(repeated.body()), 'code')

    const archived = await client
      .post(`${API}/subjects/${createdBody.data.id}/archive`)
      .bearerToken(token)
    archived.assertStatus(200)
    const again = await client
      .post(`${API}/subjects`)
      .bearerToken(token)
      .json({ code: 'MAT-402', name: 'Matemática II' })
    again.assertStatus(409)
    assert.equal((again.body() as { archivedId: number }).archivedId, createdBody.data.id)

    const used = await client.delete(`${API}/subjects/${math.id}`).bearerToken(token)
    used.assertStatus(409)
    assert.equal((used.body() as { code: string }).code, 'HAS_DEPENDENTS')
    assert.isNotNull(await Subject.find(math.id))

    const removed = await client.delete(`${API}/subjects/${createdBody.data.id}`).bearerToken(token)
    removed.assertStatus(200)
  })

  test('disciplinas: a docente vê só as suas, sem usedIn; aluno recebe 403', async ({
    client,
    assert,
  }) => {
    const response = await client
      .get(`${API}/subjects`)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
    response.assertStatus(200)
    const subjects = (response.body() as Envelope<{ code: string }[]>).data
    assert.sameMembers(
      subjects.map((item) => item.code),
      ['MAT-401', 'ES-401']
    )
    assert.notProperty(subjects[0], 'usedIn')

    const teacherCreate = await client
      .post(`${API}/subjects`)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
      .json({ code: 'XX-1', name: 'Nova' })
    teacherCreate.assertStatus(403)

    const student = await client
      .get(`${API}/subjects`)
      .bearerToken(await loginAs(client, 'diogo@agenda.test'))
    student.assertStatus(403)
  })

  test('ofertas e docentes: ofertar, vincular, trocar tipo, desvincular e reativar a mesma linha', async ({
    client,
    assert,
  }) => {
    const { tads, inf, maraisa, diogo, databases, math } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')

    const duplicateOffer = await client
      .post(`${API}/classes/${tads.id}/subjects`)
      .bearerToken(token)
      .json({ subjectId: math.id })
    duplicateOffer.assertStatus(422)

    const notStudent = await client
      .post(`${API}/classes/${tads.id}/subjects/${databases.id}/teachers`)
      .bearerToken(token)
      .json({ teacherId: diogo.id })
    notStudent.assertStatus(422)
    assert.include(fieldOf(notStudent.body()), 'teacherId')

    // Sem oferta não há vínculo.
    const withoutOffer = await client
      .post(`${API}/classes/${inf.id}/subjects/${databases.id}/teachers`)
      .bearerToken(token)
      .json({ teacherId: maraisa.id })
    withoutOffer.assertStatus(404)

    const linked = await client
      .post(`${API}/classes/${tads.id}/subjects/${databases.id}/teachers`)
      .bearerToken(token)
      .json({ teacherId: maraisa.id, role: 'substituto' })
    linked.assertStatus(201)
    const assignment = (linked.body() as Envelope<{ id: number; role: string; teacher: object }>)
      .data
    assert.equal(assignment.role, 'substituto')
    assert.sameMembers(Object.keys(assignment.teacher), ['id', 'fullName'])

    const twice = await client
      .post(`${API}/classes/${tads.id}/subjects/${databases.id}/teachers`)
      .bearerToken(token)
      .json({ teacherId: maraisa.id })
    twice.assertStatus(422)

    const changed = await client
      .put(`${API}/teaching-assignments/${assignment.id}`)
      .bearerToken(token)
      .json({ role: 'titular' })
    changed.assertStatus(200)

    const ended = await client
      .delete(`${API}/teaching-assignments/${assignment.id}`)
      .bearerToken(token)
    ended.assertStatus(200)
    assert.isNotNull((ended.body() as Envelope<{ endedAt: string }>).data.endedAt)
    assert.isNotNull(await TeachingAssignment.find(assignment.id))

    const changeEnded = await client
      .put(`${API}/teaching-assignments/${assignment.id}`)
      .bearerToken(token)
      .json({ role: 'substituto' })
    changeEnded.assertStatus(409)

    const relinked = await client
      .post(`${API}/classes/${tads.id}/subjects/${databases.id}/teachers`)
      .bearerToken(token)
      .json({ teacherId: maraisa.id })
    relinked.assertStatus(200)
    assert.equal((relinked.body() as Envelope<{ id: number }>).data.id, assignment.id)

    const teachingAudit = await AuditLog.query()
      .where('entity', 'teaching_assignment')
      .where('entityId', assignment.id)
    const actions = teachingAudit.map((entry) => entry.action)
    assert.includeMembers(actions, [
      'teaching.create',
      'teaching.update',
      'teaching.end',
      'teaching.reactivate',
    ])
  })

  test('ofertas: arquivar encerra os docentes, excluir só a oferta sem uso, docente recebe 403', async ({
    client,
    assert,
  }) => {
    const { tads, math, maraisa } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')

    const withEvents = await client
      .delete(`${API}/classes/${tads.id}/subjects/${math.id}`)
      .bearerToken(token)
    withEvents.assertStatus(409)

    const fresh = await Subject.create({
      code: 'NV-01',
      name: 'Disciplina Nova',
      workloadHours: 40,
    })
    const offered = await client
      .post(`${API}/classes/${tads.id}/subjects`)
      .bearerToken(token)
      .json({ subjectId: fresh.id })
    offered.assertStatus(201)
    const removed = await client
      .delete(`${API}/classes/${tads.id}/subjects/${fresh.id}`)
      .bearerToken(token)
    removed.assertStatus(200)

    const archived = await client
      .post(`${API}/classes/${tads.id}/subjects/${math.id}/archive`)
      .bearerToken(token)
    archived.assertStatus(200)
    assert.equal(
      (archived.body() as Envelope<{ endedAssignments: number }>).data.endedAssignments,
      1
    )
    const current = await TeachingAssignment.query()
      .where('teacherId', maraisa.id)
      .where('subjectId', math.id)
      .whereNull('endedAt')
      .first()
    assert.isNull(current)

    // Sem vínculo em vigor, a docente não cria evento daquela disciplina.
    const teacherToken = await loginAs(client, 'maraisa@agenda.test')
    const event = await client.post(`${API}/events`).bearerToken(teacherToken).json({
      title: 'Lista de exercícios',
      category: 'assignment',
      startsAt: '2026-12-10T19:00',
      academicClassId: tads.id,
      subjectId: math.id,
    })
    event.assertStatus(403)

    const teacherOffer = await client
      .post(`${API}/classes/${tads.id}/subjects`)
      .bearerToken(teacherToken)
      .json({ subjectId: fresh.id })
    teacherOffer.assertStatus(403)
  })

  test('GET /users: só a administração, com id, nome, e-mail e papel', async ({
    client,
    assert,
  }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const response = await client
      .get(`${API}/users`)
      .bearerToken(token)
      .qs({ role: 'teacher', q: 'mar' })
    response.assertStatus(200)
    const users = (response.body() as Envelope<{ email: string }[]>).data
    assert.sameMembers(
      users.map((item) => item.email),
      ['maraisa@agenda.test', 'marina@agenda.test']
    )
    for (const item of users) {
      assert.sameMembers(Object.keys(item), ['id', 'fullName', 'email', 'role'])
    }

    const invalid = await client.get(`${API}/users`).bearerToken(token).qs({ role: 'chefe' })
    invalid.assertStatus(422)

    for (const email of ['maraisa@agenda.test', 'diogo@agenda.test']) {
      await expectStatus(client.get(`${API}/users`).bearerToken(await loginAs(client, email)), 403)
    }
  })

  test('alunos: lista de e-mails inclui, convida e rejeita; cadastro aceita o convite', async ({
    client,
    assert,
  }) => {
    const { tads } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')

    const response = await client
      .post(`${API}/classes/${tads.id}/students`)
      .bearerToken(token)
      .json({
        emails: [
          'diogo@agenda.test',
          'ANA@agenda.test',
          'maraisa@agenda.test',
          'sem arroba',
          'novo.aluno@agenda.test',
          'novo.aluno@agenda.test ',
        ],
      })
    response.assertStatus(200)
    const result = (
      response.body() as Envelope<{
        added: number
        invited: number
        rejected: { email: string; reason: string }[]
      }>
    ).data
    assert.equal(result.added, 1)
    assert.equal(result.invited, 1)
    assert.sameMembers(
      result.rejected.map((item) => item.reason),
      ['already_enrolled', 'not_student', 'invalid_email']
    )

    const tooMany = await client
      .post(`${API}/classes/${tads.id}/students`)
      .bearerToken(token)
      .json({ emails: Array.from({ length: 201 }, (_, index) => `a${index}@agenda.test`) })
    tooMany.assertStatus(422)

    const empty = await client
      .post(`${API}/classes/${tads.id}/students`)
      .bearerToken(token)
      .json({})
    empty.assertStatus(422)

    const invites = await client.get(`${API}/classes/${tads.id}/invites`).bearerToken(token)
    invites.assertStatus(200)
    assert.deepEqual(
      (invites.body() as Envelope<{ email: string }[]>).data.map((item) => item.email),
      ['novo.aluno@agenda.test']
    )

    const account = await signup(client, 'Novo.Aluno@agenda.test')
    const enrollment = await Enrollment.query()
      .where('userId', account.user.id)
      .where('academicClassId', tads.id)
      .firstOrFail()
    assert.equal(enrollment.status, 'active')
    assert.equal(enrollment.source, 'invite')
    const invite = await ClassInvite.findByOrFail('email', 'novo.aluno@agenda.test')
    assert.isNotNull(invite.acceptedAt)

    const context = await client.get(`${API}/context`).bearerToken(account.token)
    assert.equal(
      (context.body() as unknown as Envelope<{ enrollments: { academicClassId: number }[] }>).data
        .enrollments[0].academicClassId,
      tads.id
    )
  })

  test('alunos: matrícula escolar só para a administração; docente de fora recebe 404', async ({
    client,
    assert,
  }) => {
    const { tads, inf, diogo } = await demo()
    const adminToken = await loginAs(client, 'admin@agenda.test')

    const diogoEnrollment = await Enrollment.query()
      .where('userId', diogo.id)
      .where('academicClassId', tads.id)
      .firstOrFail()
    const saved = await client
      .patch(`${API}/enrollments/${diogoEnrollment.id}`)
      .bearerToken(adminToken)
      .json({ registration: '2026001' })
    saved.assertStatus(200)

    const adminList = await client.get(`${API}/classes/${tads.id}/students`).bearerToken(adminToken)
    adminList.assertStatus(200)
    const row = (
      adminList.body() as Envelope<{ userId: number; registration: string }[]>
    ).data.find((item) => item.userId === diogo.id)!
    assert.equal(row.registration, '2026001')

    const teacherList = await client
      .get(`${API}/classes/${tads.id}/students`)
      .bearerToken(await loginAs(client, 'marina@agenda.test'))
    teacherList.assertStatus(200)
    for (const item of (teacherList.body() as Envelope<object[]>).data) {
      assert.notProperty(item, 'registration')
    }

    const outside = await client
      .get(`${API}/classes/${inf.id}/students`)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
    outside.assertStatus(404)

    const student = await client
      .get(`${API}/classes/${tads.id}/students`)
      .bearerToken(await loginAs(client, 'diogo@agenda.test'))
    student.assertStatus(403)

    // Matrícula repetida na mesma turma volta como erro do campo.
    const other = await signup(client, 'colega@agenda.test')
    const add = await client
      .post(`${API}/classes/${tads.id}/students`)
      .bearerToken(adminToken)
      .json({ userId: other.user.id, registration: '2026001' })
    add.assertStatus(422)
    assert.include(fieldOf(add.body()), 'registration')
  })

  test('código da turma: pedido pendente, docente aprova, não inativa; aluno não decide', async ({
    client,
    assert,
  }) => {
    const { tads, maraisa } = await demo()
    const student = await signup(client, 'pedido@agenda.test')

    const join = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(student.token)
      .json({ code: 'tads-5k7q' })
    join.assertStatus(201)
    const joined = (
      join.body() as Envelope<{ enrollment: { id: number; status: string }; message: string }>
    ).data
    assert.equal(joined.enrollment.status, 'pending')
    assert.equal(joined.message, 'Pedido enviado para TADS 5. A docente ou a secretaria confirma.')

    const repeat = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(student.token)
      .json({ code: 'TADS5K7Q' })
    repeat.assertStatus(200)
    assert.isTrue((repeat.body() as Envelope<{ alreadyEnrolled: boolean }>).data.alreadyEnrolled)

    const context = await client.get(`${API}/context`).bearerToken(student.token)
    const contextData = (
      context.body() as Envelope<{ enrollments: object[]; pendingEnrollments: object[] }>
    ).data
    assert.lengthOf(contextData.enrollments, 0)
    assert.lengthOf(contextData.pendingEnrollments, 1)

    // Pendente não vê os eventos da turma.
    const events = await client.get(`${API}/events`).bearerToken(student.token)
    const tadsEvents = (
      events.body() as Envelope<{ academicClassId: number | null }[]>
    ).data.filter((event) => event.academicClassId === tads.id)
    assert.lengthOf(tadsEvents, 0)

    const selfApprove = await client
      .patch(`${API}/enrollments/${joined.enrollment.id}`)
      .bearerToken(student.token)
      .json({ status: 'active' })
    selfApprove.assertStatus(403)

    const teacherToken = await loginAs(client, 'maraisa@agenda.test')
    const approved = await client
      .patch(`${API}/enrollments/${joined.enrollment.id}`)
      .bearerToken(teacherToken)
      .json({ status: 'active' })
    approved.assertStatus(200)
    const enrollment = await Enrollment.findOrFail(joined.enrollment.id)
    assert.equal(enrollment.status, 'active')
    assert.equal(enrollment.decidedById, maraisa.id)
    assert.isNotNull(enrollment.decidedAt)

    const inactivate = await client
      .patch(`${API}/enrollments/${joined.enrollment.id}`)
      .bearerToken(teacherToken)
      .json({ status: 'inactive' })
    inactivate.assertStatus(403)

    const audit = await AuditLog.query()
      .where('entity', 'enrollment')
      .where('entityId', joined.enrollment.id)
      .orderBy('id')
    assert.deepEqual(
      audit.map((entry) => entry.action),
      ['enrollment.request', 'enrollment.approve']
    )
    assert.equal(audit[1].actorId, maraisa.id)
    assert.notInclude(audit[1].meta ?? '', 'pedido@agenda.test')

    // A administração inativa: a linha continua lá, só muda o status.
    const adminToken = await loginAs(client, 'admin@agenda.test')
    const removed = await client
      .patch(`${API}/enrollments/${joined.enrollment.id}`)
      .bearerToken(adminToken)
      .json({ status: 'inactive' })
    removed.assertStatus(200)
    await enrollment.refresh()
    assert.equal(enrollment.status, 'inactive')
  })

  test('pedidos em lote: aprova os pendentes da turma e pula o resto; docente de fora 404', async ({
    client,
    assert,
  }) => {
    const { tads, inf, diogo } = await demo()
    const first = await signup(client, 'lote1@agenda.test')
    const second = await signup(client, 'lote2@agenda.test')
    for (const account of [first, second]) {
      await expectStatus(
        client
          .post(`${API}/enrollments/join`)
          .bearerToken(account.token)
          .json({ code: 'TADS5K7Q' }),
        201
      )
    }
    const pending = await Enrollment.query()
      .where('academicClassId', tads.id)
      .where('status', 'pending')
    const diogoEnrollment = await Enrollment.query()
      .where('userId', diogo.id)
      .where('academicClassId', tads.id)
      .firstOrFail()

    const outside = await client
      .post(`${API}/classes/${inf.id}/students/decide`)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
      .json({ enrollmentIds: pending.map((item) => item.id), status: 'active' })
    outside.assertStatus(404)

    const decided = await client
      .post(`${API}/classes/${tads.id}/students/decide`)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
      .json({
        enrollmentIds: [...pending.map((item) => item.id), diogoEnrollment.id],
        status: 'active',
      })
    decided.assertStatus(200)
    const result = (decided.body() as Envelope<{ updated: number; skipped: number[] }>).data
    assert.equal(result.updated, 2)
    assert.deepEqual(result.skipped, [diogoEnrollment.id])
    assert.equal(
      await countOf(
        Enrollment.query().where('academicClassId', tads.id).where('status', 'pending')
      ),
      0
    )
  })

  test('código da turma: convite vira matrícula ativa e o curso integrado marca o aluno menor', async ({
    client,
    assert,
  }) => {
    const { inf } = await demo()
    const account = await signup(client, 'adolescente@agenda.test')
    // Convite criado depois do cadastro (por exemplo, numa turma que estava arquivada).
    await ClassInvite.create({ academicClassId: inf.id, email: 'adolescente@agenda.test' })

    const join = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(account.token)
      .json({ code: 'TEC3AM2X' })
    join.assertStatus(201)
    const data = (
      join.body() as Envelope<{ enrollment: { status: string; source: string }; message: string }>
    ).data
    assert.equal(data.enrollment.status, 'active')
    assert.equal(data.enrollment.source, 'invite')
    assert.equal(data.message, 'Você entrou em INF 3A.')

    const user = await User.findOrFail(account.user.id)
    assert.isTrue(user.isMinor)
  })

  test('código da turma: mesma resposta para todo erro e limite de 5 tentativas erradas', async ({
    client,
    assert,
  }) => {
    const student = await signup(client, 'chute@agenda.test')
    for (const code of ['ZZZZZZZZ', 'curto', 'TADS-5K7U', 'XXXX-XXXX', '00000000']) {
      const response = await client
        .post(`${API}/enrollments/join`)
        .bearerToken(student.token)
        .json({ code })
      response.assertStatus(422)
      assert.equal((response.body() as { message: string }).message, INVALID_CODE)
    }

    const blocked = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(student.token)
      .json({ code: 'TADS5K7Q' })
    blocked.assertStatus(429)
    assert.equal((blocked.body() as { code: string }).code, 'TOO_MANY_ATTEMPTS')

    const teacher = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
      .json({ code: 'TADS5K7Q' })
    teacher.assertStatus(403)
  })

  test('código da turma: docente gera e desliga só nas suas turmas; o antigo para de valer', async ({
    client,
    assert,
  }) => {
    const { tads, inf } = await demo()
    const teacherToken = await loginAs(client, 'maraisa@agenda.test')

    const generated = await client
      .post(`${API}/classes/${tads.id}/join-code`)
      .bearerToken(teacherToken)
    generated.assertStatus(200)
    const code = (generated.body() as Envelope<{ joinCode: string; joinCodeActive: boolean }>).data
    assert.match(code.joinCode, /^[0-9A-HJKMNP-TV-Z]{8}$/)
    assert.notEqual(code.joinCode, 'TADS5K7Q')
    assert.isTrue(code.joinCodeActive)

    const student = await signup(client, 'codigo.novo@agenda.test')
    const old = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(student.token)
      .json({ code: 'TADS5K7Q' })
    old.assertStatus(422)
    const fresh = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(student.token)
      .json({ code: code.joinCode.toLowerCase() })
    fresh.assertStatus(201)

    const disabled = await client
      .delete(`${API}/classes/${tads.id}/join-code`)
      .bearerToken(teacherToken)
    disabled.assertStatus(200)
    assert.isFalse((disabled.body() as Envelope<{ joinCodeActive: boolean }>).data.joinCodeActive)

    const other = await signup(client, 'codigo.desligado@agenda.test')
    const off = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(other.token)
      .json({ code: code.joinCode })
    off.assertStatus(422)
    assert.equal((off.body() as { message: string }).message, INVALID_CODE)
    await expectStatus(
      client.post(`${API}/classes/${inf.id}/join-code`).bearerToken(teacherToken),
      404
    )
    await expectStatus(
      client
        .post(`${API}/classes/${tads.id}/join-code`)
        .bearerToken(await loginAs(client, 'diogo@agenda.test')),
      403
    )

    const audit = await AuditLog.query()
      .where('entity', 'academic_class')
      .where('entityId', tads.id)
      .whereIn('action', ['class.join_code_create', 'class.join_code_disable'])
    assert.lengthOf(audit, 2)
    for (const entry of audit) {
      assert.notInclude(entry.meta ?? '', code.joinCode)
    }
  })

  test('convites: listar e cancelar só a administração; aceito não cancela', async ({
    client,
    assert,
  }) => {
    const { tads } = await demo()
    const adminToken = await loginAs(client, 'admin@agenda.test')
    const pending = await ClassInvite.create({
      academicClassId: tads.id,
      email: 'pendente@agenda.test',
    })
    const accepted = await ClassInvite.create({
      academicClassId: tads.id,
      email: 'aceito@agenda.test',
      acceptedAt: DateTime.now(),
    })

    const teacherToken = await loginAs(client, 'maraisa@agenda.test')
    await expectStatus(
      client.get(`${API}/classes/${tads.id}/invites`).bearerToken(teacherToken),
      403
    )
    await expectStatus(
      client.delete(`${API}/class-invites/${pending.id}`).bearerToken(teacherToken),
      403
    )
    await expectStatus(
      client.delete(`${API}/class-invites/${accepted.id}`).bearerToken(adminToken),
      409
    )
    await expectStatus(
      client.delete(`${API}/class-invites/${pending.id}`).bearerToken(adminToken),
      200
    )
    assert.isNull(await ClassInvite.find(pending.id))
    await expectStatus(
      client.delete(`${API}/class-invites/${pending.id}`).bearerToken(adminToken),
      404
    )
  })

  test('papel desconhecido recebe 403 nas rotas de gestão', async ({ client }) => {
    await User.create({
      fullName: 'Visitante',
      email: 'visitante.gestao@agenda.test',
      password: 'password123',
      role: 'visitor',
    })
    const token = await loginAs(client, 'visitante.gestao@agenda.test')
    for (const path of [
      '/classes',
      '/classes/1',
      '/subjects',
      '/courses',
      '/users',
      '/classes/1/students',
    ]) {
      await expectStatus(client.get(`${API}${path}`).bearerToken(token), 403)
    }
    await expectStatus(
      client.post(`${API}/enrollments/join`).bearerToken(token).json({ code: 'TADS5K7Q' }),
      403
    )
  })
})

/** Tudo o que existe da turma: para provar que uma tentativa barrada não mudou nada. */
async function classSnapshot(academicClassId: number) {
  const academicClass = await AcademicClass.findOrFail(academicClassId)
  await academicClass.load('course')
  const offers = await ClassSubject.query()
    .where('academicClassId', academicClassId)
    .preload('subject')
    .orderBy('id')
  const assignments = await TeachingAssignment.query()
    .where('academicClassId', academicClassId)
    .orderBy('id')
  const enrollments = await Enrollment.query()
    .where('academicClassId', academicClassId)
    .orderBy('id')
  const invites = await ClassInvite.query().where('academicClassId', academicClassId).orderBy('id')
  return {
    academicClass: {
      name: academicClass.name,
      archivedAt: academicClass.archivedAt?.toISO() ?? null,
      joinCode: academicClass.joinCode,
      joinCodeActive: academicClass.joinCodeActive,
    },
    course: {
      name: academicClass.course.name,
      archivedAt: academicClass.course.archivedAt?.toISO() ?? null,
    },
    offers: offers.map((offer) => ({
      id: offer.id,
      archivedAt: offer.archivedAt?.toISO() ?? null,
      subject: offer.subject.name,
      subjectArchivedAt: offer.subject.archivedAt?.toISO() ?? null,
    })),
    assignments: assignments.map((item) => ({
      id: item.id,
      role: item.role,
      endedAt: item.endedAt?.toISO() ?? null,
    })),
    enrollments: enrollments.map((item) => ({
      id: item.id,
      status: item.status,
      registration: item.registration,
    })),
    invites: invites.map((item) => ({ id: item.id, acceptedAt: item.acceptedAt?.toISO() ?? null })),
    auditLogs: await countOf(AuditLog.query()),
  }
}

type Route = [method: string, path: string, body?: object]

/** Chama uma rota da matriz com o token, com ou sem corpo. */
function send(client: any, token: string, [method, path, body]: Route) {
  const request = client[method](`${API}${path}`).bearerToken(token)
  return body ? request.json(body) : request
}

test.group('Fase 1: revisão (autorização por objeto, limite e exclusão)', (group) => {
  group.each.setup(() => {
    AttemptLimiterService.clear()
    return testUtils.db().withGlobalTransaction()
  })

  test('matriz por papel e por objeto: ninguém de fora alcança a INF 3A e nada muda', async ({
    client,
    assert,
  }) => {
    const { inf, marina } = await demo()
    const logic = await Subject.findByOrFail('code', 'LP-101')
    const assignment = await TeachingAssignment.query()
      .where('academicClassId', inf.id)
      .where('teacherId', marina.id)
      .firstOrFail()
    const anaEnrollment = await Enrollment.query().where('academicClassId', inf.id).firstOrFail()
    const requester = await User.create({
      fullName: 'Pedido INF',
      email: 'pedido.inf@agenda.test',
      password: 'password123',
      role: 'student',
    })
    const pending = await Enrollment.create({
      userId: requester.id,
      academicClassId: inf.id,
      status: 'pending',
      source: 'code',
    })
    const invite = await ClassInvite.create({
      academicClassId: inf.id,
      email: 'convite.inf@agenda.test',
    })

    // Docente que já deu aula na INF 3A, com o vínculo encerrado.
    const endedTeacher = await User.create({
      fullName: 'Docente Encerrada',
      email: 'encerrada@agenda.test',
      password: 'password123',
      role: 'teacher',
    })
    await TeachingAssignment.create({
      teacherId: endedTeacher.id,
      academicClassId: inf.id,
      subjectId: logic.id,
      role: 'substituto',
      endedAt: DateTime.now().minus({ days: 1 }),
    })
    await User.create({
      fullName: 'Responsável Sem Vínculo',
      email: 'responsavel.matriz@agenda.test',
      password: 'password123',
      role: 'guardian',
    })
    const noAssignment = await signup(client, 'docente.sem.vinculo@agenda.test', 'teacher')

    const before = await classSnapshot(inf.id)

    // Rotas em que a docente da turma entra: quem é de fora recebe 404.
    const classRoutes: Route[] = [
      ['get', `/classes/${inf.id}`],
      ['post', `/classes/${inf.id}/join-code`],
      ['delete', `/classes/${inf.id}/join-code`],
      ['get', `/classes/${inf.id}/students`],
      [
        'post',
        `/classes/${inf.id}/students/decide`,
        { enrollmentIds: [pending.id], status: 'active' },
      ],
      ['patch', `/enrollments/${pending.id}`, { status: 'active' }],
      ['patch', `/enrollments/${anaEnrollment.id}`, { status: 'inactive' }],
    ]
    // Rotas só da administração: qualquer outro papel recebe 403.
    const adminRoutes: Route[] = [
      ['put', `/classes/${inf.id}`, { name: 'INF 3B' }],
      ['post', `/classes/${inf.id}/archive`],
      ['post', `/classes/${inf.id}/restore`],
      ['delete', `/classes/${inf.id}`],
      ['post', `/classes/${inf.id}/subjects`, { subjectId: logic.id }],
      ['post', `/classes/${inf.id}/subjects/${logic.id}/archive`],
      ['delete', `/classes/${inf.id}/subjects/${logic.id}`],
      ['post', `/classes/${inf.id}/subjects/${logic.id}/teachers`, { teacherId: marina.id }],
      ['put', `/teaching-assignments/${assignment.id}`, { role: 'substituto' }],
      ['delete', `/teaching-assignments/${assignment.id}`],
      ['post', `/classes/${inf.id}/students`, { emails: ['intruso@agenda.test'] }],
      ['get', `/classes/${inf.id}/invites`],
      ['delete', `/class-invites/${invite.id}`],
      ['put', `/courses/${inf.courseId}`, { name: 'Outro nome' }],
      ['post', `/courses/${inf.courseId}/archive`],
      ['post', `/courses/${inf.courseId}/restore`],
      ['delete', `/courses/${inf.courseId}`],
      ['put', `/subjects/${logic.id}`, { name: 'Outro nome' }],
      ['post', `/subjects/${logic.id}/archive`],
      ['post', `/subjects/${logic.id}/restore`],
      ['delete', `/subjects/${logic.id}`],
      ['get', '/users?q=ana'],
      ['get', '/courses'],
    ]

    const expectEach = async (who: string, token: string, routes: Route[], status: number) => {
      for (const [method, path, body] of routes) {
        const response = await send(client, token, [method, path, body])
        assert.equal(response.status(), status, `${who}: ${method} ${path}`)
      }
    }

    // Docentes de fora: com vínculo em outra turma, sem vínculo e com vínculo encerrado.
    const teachers: Record<string, string> = {
      'docente com vínculo em outra turma': await loginAs(client, 'maraisa@agenda.test'),
      'docente sem vínculo': noAssignment.token,
      'docente com vínculo encerrado': await loginAs(client, 'encerrada@agenda.test'),
    }
    for (const [who, token] of Object.entries(teachers)) {
      await expectEach(who, token, classRoutes, 404)
      await expectEach(who, token, adminRoutes, 403)

      for (const path of ['/classes', '/classes?archived=1']) {
        const classes = await client.get(`${API}${path}`).bearerToken(token)
        classes.assertStatus(200)
        assert.notInclude(
          (classes.body() as Envelope<{ id: number }[]>).data.map((item) => item.id),
          inf.id,
          `${who}: ${path}`
        )
      }
      const subjects = await client.get(`${API}/subjects`).bearerToken(token)
      subjects.assertStatus(200)
      assert.notInclude(
        (subjects.body() as Envelope<{ code: string }[]>).data.map((item) => item.code),
        'LP-101',
        who
      )
    }

    // Aluno de outra turma, a aluna da própria INF 3A e o responsável sem vínculo: 403 em tudo.
    const outsiders: Record<string, string> = {
      'aluno de outra turma': await loginAs(client, 'diogo@agenda.test'),
      'aluna da própria turma': await loginAs(client, 'ana@agenda.test'),
      'responsável sem vínculo': await loginAs(client, 'responsavel.matriz@agenda.test'),
    }
    for (const [who, token] of Object.entries(outsiders)) {
      await expectEach(
        who,
        token,
        [...classRoutes, ...adminRoutes, ['get', '/classes'], ['get', '/subjects']],
        403
      )
    }
    const guardianJoin = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(outsiders['responsável sem vínculo'])
      .json({ code: 'TEC3AM2X' })
    guardianJoin.assertStatus(403)

    assert.deepEqual(await classSnapshot(inf.id), before)
  })

  test('administração: id que não existe dá 404 em toda rota com id, sem mudar nada', async ({
    client,
    assert,
  }) => {
    const { inf, marina } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const before = await classSnapshot(inf.id)

    for (const missing of ['999999', 'abc', '-1', '1.5']) {
      const routes: Route[] = [
        ['get', `/classes/${missing}`],
        ['put', `/classes/${missing}`, { name: 'Nada' }],
        ['post', `/classes/${missing}/archive`],
        ['post', `/classes/${missing}/restore`],
        ['delete', `/classes/${missing}`],
        ['post', `/classes/${missing}/join-code`],
        ['delete', `/classes/${missing}/join-code`],
        ['get', `/classes/${missing}/students`],
        ['post', `/classes/${missing}/students`, { emails: ['ninguem@agenda.test'] }],
        ['post', `/classes/${missing}/students/decide`, { enrollmentIds: [1], status: 'active' }],
        ['get', `/classes/${missing}/invites`],
        ['post', `/classes/${missing}/subjects`, { subjectId: 1 }],
        ['post', `/classes/${inf.id}/subjects/${missing}/archive`],
        ['delete', `/classes/${inf.id}/subjects/${missing}`],
        ['post', `/classes/${inf.id}/subjects/${missing}/teachers`, { teacherId: marina.id }],
        ['put', `/teaching-assignments/${missing}`, { role: 'titular' }],
        ['delete', `/teaching-assignments/${missing}`],
        ['patch', `/enrollments/${missing}`, { status: 'active' }],
        ['delete', `/class-invites/${missing}`],
        ['put', `/courses/${missing}`, { name: 'Nada' }],
        ['post', `/courses/${missing}/archive`],
        ['post', `/courses/${missing}/restore`],
        ['delete', `/courses/${missing}`],
        ['put', `/subjects/${missing}`, { name: 'Nada' }],
        ['post', `/subjects/${missing}/archive`],
        ['post', `/subjects/${missing}/restore`],
        ['delete', `/subjects/${missing}`],
      ]
      for (const [method, path, body] of routes) {
        const response = await send(client, token, [method, path, body])
        assert.equal(response.status(), 404, `${method} ${path}`)
      }
    }

    assert.deepEqual(await classSnapshot(inf.id), before)
  })

  test('limite do código: cinco erros travam o usuário, não o IP que ele divide com a sala', async ({
    client,
    assert,
  }) => {
    const sharedIp = '198.51.100.7'
    const join = (token: string, code: string, forwardedFor = sharedIp) =>
      client
        .post(`${API}/enrollments/join`)
        .header('X-Forwarded-For', forwardedFor)
        .bearerToken(token)
        .json({ code })

    const typo = await signup(client, 'erra.codigo@agenda.test')
    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      const wrong = await join(typo.token, 'ZZZZ-ZZZZ')
      wrong.assertStatus(422)
    }
    const typoBlocked = await join(typo.token, 'TADS5K7Q')
    typoBlocked.assertStatus(429)
    // Trocar de IP não livra o usuário.
    const typoOtherIp = await join(typo.token, 'TADS5K7Q', '198.51.100.99')
    typoOtherIp.assertStatus(429)

    // Outro aluno atrás do mesmo IP (o proxy do Render, a rede do laboratório) entra normalmente.
    const classmate = await signup(client, 'colega.sala@agenda.test')
    const classmateJoin = await join(classmate.token, 'TADS5K7Q')
    classmateJoin.assertStatus(201)

    // O IP só trava quando os erros, vindos de várias contas, chegam ao teto por IP.
    let failures = MAX_FAILED_ATTEMPTS
    let account = 0
    while (failures < MAX_FAILED_ATTEMPTS_PER_IP) {
      const guesser = await signup(client, `chute.${account++}@agenda.test`)
      for (
        let attempt = 0;
        attempt < MAX_FAILED_ATTEMPTS && failures < MAX_FAILED_ATTEMPTS_PER_IP;
        attempt++
      ) {
        const wrong = await join(guesser.token, 'ZZZZ-ZZZZ')
        wrong.assertStatus(422)
        failures++
      }
    }
    const late = await signup(client, 'atrasado@agenda.test')
    const blocked = await join(late.token, 'TADS5K7Q')
    blocked.assertStatus(429)
    assert.equal((blocked.body() as { code: string }).code, 'TOO_MANY_ATTEMPTS')
    // Um X-Forwarded-For inventado à esquerda não muda o IP lido.
    const spoofed = await join(late.token, 'TADS5K7Q', `203.0.113.99, ${sharedIp}`)
    spoofed.assertStatus(429)
    // De outro IP, a mesma conta entra.
    const otherIp = await join(late.token, 'TADS5K7Q', '198.51.100.8')
    otherIp.assertStatus(201)
  })

  test('proxy confiável: só loopback, link-local e redes privadas leem o X-Forwarded-For', async ({
    assert,
  }) => {
    for (const address of [
      '127.0.0.1',
      '::1',
      '10.12.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.10',
      '169.254.10.1',
      '::ffff:10.1.2.3',
      'fd12:3456::1',
      'fe80::1',
    ]) {
      assert.isTrue(http.trustProxy(address, 0), address)
    }
    for (const address of [
      '8.8.8.8',
      '203.0.113.9',
      '172.32.0.1',
      '172.15.0.1',
      '192.169.0.1',
      '::ffff:8.8.8.8',
      '2001:db8::1',
      'fd:1::1',
    ]) {
      assert.isFalse(http.trustProxy(address, 0), address)
    }
  })

  test('vínculo de docente responde sempre com endedAt, também logo depois de criado', async ({
    client,
    assert,
  }) => {
    const { tads, marina, databases } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const created = await client
      .post(`${API}/classes/${tads.id}/subjects/${databases.id}/teachers`)
      .bearerToken(token)
      .json({ teacherId: marina.id, role: 'substituto' })
    created.assertStatus(201)
    const data = (created.body() as Envelope<Record<string, unknown>>).data
    assert.property(data, 'endedAt')
    assert.isNull(data.endedAt)
    assert.equal(data.role, 'substituto')
  })

  test('turma só com convite não é excluída: o convite fica, e sem ele a turma sai', async ({
    client,
    assert,
  }) => {
    const { tads } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const created = await client.post(`${API}/classes`).bearerToken(token).json({
      courseId: tads.courseId,
      name: 'Turma com convite',
      year: 2026,
      semester: 1,
      shift: 'vespertino',
      period: '1º período',
    })
    created.assertStatus(201)
    const id = (created.body() as Envelope<{ id: number }>).data.id

    const listed = await client
      .post(`${API}/classes/${id}/students`)
      .bearerToken(token)
      .json({ emails: ['ainda.sem.conta@agenda.test'] })
    listed.assertStatus(200)
    assert.equal((listed.body() as Envelope<{ invited: number }>).data.invited, 1)

    const refused = await client.delete(`${API}/classes/${id}`).bearerToken(token)
    refused.assertStatus(409)
    const body = refused.body() as { code: string; counts: Record<string, number> }
    assert.equal(body.code, 'HAS_DEPENDENTS')
    assert.equal(body.counts.invites, 1)
    assert.isNotNull(await AcademicClass.find(id))
    const invite = await ClassInvite.query().where('academicClassId', id).firstOrFail()
    assert.isNull(
      await AuditLog.query().where('action', 'class.delete').where('entityId', id).first()
    )

    await expectStatus(client.delete(`${API}/class-invites/${invite.id}`).bearerToken(token), 200)
    await expectStatus(client.delete(`${API}/classes/${id}`).bearerToken(token), 200)
    assert.isNull(await AcademicClass.find(id))
  })
})
