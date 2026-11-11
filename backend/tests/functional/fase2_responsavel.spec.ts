import DemoSeeder from '#database/seeders/demo_datum_seeder'
import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import AuditLog from '#models/audit_log'
import GuardianLink from '#models/guardian_link'
import GuardianLinkCode from '#models/guardian_link_code'
import Notification from '#models/notification'
import Reminder from '#models/reminder'
import Subject from '#models/subject'
import User from '#models/user'
import AttemptLimiterService from '#services/attempt_limiter_service'
import GuardianLinkService from '#services/guardian_link_service'
import ReminderDeliveryService from '#services/reminder_delivery_service'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

type Envelope<T> = { data: T }
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }
type CodeResponse = {
  id: number
  kind: string
  code: string
  codeFormatted: string
  expiresAt: string
  linkWillBePending: boolean
}
type ClaimResponse = {
  link: { id: number; studentId: number; status: string; origin: string; relationship: string }
  student: { id: number; fullName: string }
  alreadyLinked: boolean
  message: string
}
type Summary = { id: number; status: string; undoUntil: string | null; message?: string }
type EventItem = { id: number; academicClassId: number | null }

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
  return (response.body() as unknown as Envelope<{ token: string }>).data.token
}

async function signup(client: any, email: string, role = 'guardian', fullName = 'Conta Nova') {
  const response = await client.post(`${API}/auth/signup`).json({
    fullName,
    email,
    password: 'password123',
    passwordConfirmation: 'password123',
    role,
  })
  response.assertStatus(200)
  return (
    response.body() as unknown as Envelope<{ token: string; user: { id: number; role: string } }>
  ).data
}

function fieldOf(body: unknown) {
  return ((body as FieldErrors).errors ?? []).map((error) => error.field)
}

async function demo() {
  const [tads, inf, admin, maraisa, marina, diogo, ana, maria, carlos, logic] = await Promise.all([
    AcademicClass.findByOrFail('name', 'TADS 5'),
    AcademicClass.findByOrFail('name', 'INF 3A'),
    User.findByOrFail('email', 'admin@agenda.test'),
    User.findByOrFail('email', 'maraisa@agenda.test'),
    User.findByOrFail('email', 'marina@agenda.test'),
    User.findByOrFail('email', 'diogo@agenda.test'),
    User.findByOrFail('email', 'ana@agenda.test'),
    User.findByOrFail('email', 'maria@agenda.test'),
    User.findByOrFail('email', 'carlos@agenda.test'),
    Subject.findByOrFail('code', 'LP-101'),
  ])
  const [mariaLink, carlosLink] = await Promise.all([
    GuardianLink.query().where('guardianId', maria.id).where('studentId', diogo.id).firstOrFail(),
    GuardianLink.query().where('guardianId', carlos.id).where('studentId', ana.id).firstOrFail(),
  ])
  return {
    tads,
    inf,
    admin,
    maraisa,
    marina,
    diogo,
    ana,
    maria,
    carlos,
    logic,
    mariaLink,
    carlosLink,
  }
}

/** Uma prova da INF 3A daqui a 3 dias (o seed não tem eventos nessa turma). */
async function infExam(inf: AcademicClass, logic: Subject, marina: User) {
  return AcademicEvent.create({
    title: 'Prova de Lógica',
    category: 'exam',
    source: 'teacher',
    status: 'scheduled',
    startsAt: DateTime.now().plus({ days: 3 }),
    academicClassId: inf.id,
    subjectId: logic.id,
    teacherId: marina.id,
    createdById: marina.id,
    officialPriority: false,
  })
}

async function tadsExam(tads: AcademicClass) {
  return AcademicEvent.query().where('academicClassId', tads.id).orderBy('startsAt').firstOrFail()
}

async function newCode(client: any, token: string, status = 201) {
  const response = await client.post(`${API}/me/guardian-codes`).bearerToken(token)
  response.assertStatus(status)
  return (response.body() as unknown as Envelope<CodeResponse>).data
}

async function claim(client: any, token: string, code: string, relationship = 'mae') {
  return client.post(`${API}/guardian-links/claim`).bearerToken(token).json({ code, relationship })
}

async function notificationsOf(userId: number, kind?: string) {
  const query = Notification.query().where('userId', userId).orderBy('id', 'asc')
  if (kind) {
    query.where('kind', kind)
  }
  return query
}

async function countNotifications(userId: number, kind?: string) {
  const notifications = await notificationsOf(userId, kind)
  return notifications.length
}

async function notificationTitles(userId: number, kind?: string) {
  const notifications = await notificationsOf(userId, kind)
  return notifications.map((item) => item.title)
}

async function codeUsedAt(codeId: number) {
  const code = await GuardianLinkCode.findOrFail(codeId)
  return code.usedAt
}

function classIdsOf(body: unknown) {
  return (body as Envelope<EventItem[]>).data.map((event) => event.academicClassId)
}

test.group('Fase 2: responsável', (group) => {
  group.each.setup(() => {
    AttemptLimiterService.clear()
    return testUtils.db().withGlobalTransaction()
  })

  test('seed: Maria acompanha o Diogo e Carlos acompanha a Ana; o contexto traz linkedStudents', async ({
    client,
    assert,
  }) => {
    const { tads, inf, admin, diogo, ana, maria, carlos, mariaLink, carlosLink } = await demo()
    assert.equal(maria.role, 'guardian')
    assert.isNull(maria.registration)
    assert.equal(carlos.role, 'guardian')

    assert.equal(mariaLink.status, 'active')
    assert.equal(mariaLink.origin, 'student_code')
    assert.isTrue(mariaLink.shareGrades)
    assert.isFalse(diogo.isMinor)
    assert.equal(carlosLink.status, 'active')
    assert.equal(carlosLink.origin, 'admin')
    assert.equal(carlosLink.approvedById, admin.id)
    assert.isTrue(ana.isMinor)

    const context = await client
      .get(`${API}/context`)
      .bearerToken(await loginAs(client, maria.email))
    context.assertStatus(200)
    const data = (
      context.body() as unknown as Envelope<{
        user: { role: string }
        enrollments: unknown[]
        linkedStudents: {
          id: number
          linkId: number
          fullName: string
          initials: string
          relationship: string
          status: string
          shareGrades: boolean
          classes: { id: number; name: string }[]
        }[]
        catalog: {
          classes: { id: number }[]
          courses: { id: number }[]
          subjects: { id: number }[]
        }
      }>
    ).data
    assert.equal(data.user.role, 'guardian')
    assert.lengthOf(data.enrollments, 0)
    assert.lengthOf(data.linkedStudents, 1)
    const [linked] = data.linkedStudents
    assert.equal(linked.id, diogo.id)
    assert.equal(linked.linkId, mariaLink.id)
    assert.equal(linked.relationship, 'mae')
    assert.equal(linked.status, 'active')
    assert.isTrue(linked.shareGrades)
    assert.equal(linked.initials, 'DQ')
    assert.deepEqual(
      linked.classes.map((item) => item.id),
      [tads.id]
    )
    // O catalog do responsável traz só as turmas dos alunos vinculados.
    assert.deepEqual(
      data.catalog.classes.map((item) => item.id),
      [tads.id]
    )
    assert.deepEqual(
      data.catalog.courses.map((item) => item.id),
      [tads.courseId]
    )
    assert.lengthOf(data.catalog.subjects, 4)

    const carlosContext = await client
      .get(`${API}/context`)
      .bearerToken(await loginAs(client, carlos.email))
    const carlosLinked = (
      carlosContext.body() as unknown as Envelope<{
        linkedStudents: { id: number; shareGrades: boolean; classes: { id: number }[] }[]
      }>
    ).data.linkedStudents
    assert.equal(carlosLinked[0].id, ana.id)
    // Aluna menor: o compartilhamento é ignorado e o responsável sempre vê as notas.
    assert.isTrue(carlosLinked[0].shareGrades)
    assert.deepEqual(
      carlosLinked[0].classes.map((item) => item.id),
      [inf.id]
    )
  })

  test('cadastro de responsável: sem matrícula, com nome; sem vínculo vê só o oficial e pede aluno dos outros com 404', async ({
    client,
    assert,
  }) => {
    const { tads, diogo } = await demo()

    const withRegistration = await client.post(`${API}/auth/signup`).json({
      fullName: 'Responsável Com Matrícula',
      email: 'resp.matricula@agenda.test',
      password: 'password123',
      passwordConfirmation: 'password123',
      role: 'guardian',
      registration: 'RESP-1',
    })
    withRegistration.assertStatus(422)
    assert.include(fieldOf(withRegistration.body()), 'registration')

    const withoutName = await client.post(`${API}/auth/signup`).json({
      fullName: null,
      email: 'resp.sem.nome@agenda.test',
      password: 'password123',
      passwordConfirmation: 'password123',
      role: 'guardian',
    })
    withoutName.assertStatus(422)
    assert.include(fieldOf(withoutName.body()), 'fullName')

    const account = await signup(client, 'resp.novo@agenda.test')
    assert.equal(account.user.role, 'guardian')
    const created = await User.findOrFail(account.user.id)
    assert.isNull(created.registration)

    const context = await client.get(`${API}/context`).bearerToken(account.token)
    context.assertStatus(200)
    const data = (
      context.body() as unknown as Envelope<{
        linkedStudents: unknown[]
        catalog: { classes: unknown[] }
      }>
    ).data
    assert.lengthOf(data.linkedStudents, 0)
    assert.lengthOf(data.catalog.classes, 0)

    const events = await client.get(`${API}/events`).bearerToken(account.token)
    events.assertStatus(200)
    assert.notInclude(classIdsOf(events.body()), tads.id)

    // Responsável sem vínculo pede os dados de outro aluno: 404, como se não existisse.
    const exam = await tadsExam(tads)
    for (const [method, url] of [
      ['get', `${API}/events?studentId=${diogo.id}`],
      ['get', `${API}/dashboard?studentId=${diogo.id}`],
      ['get', `${API}/events/${exam.id}`],
      ['get', `${API}/events/${exam.id}?studentId=${diogo.id}`],
    ] as const) {
      const response = await client[method](url).bearerToken(account.token)
      response.assertStatus(404)
    }
    const reminder = await client
      .post(`${API}/reminders`)
      .bearerToken(account.token)
      .json({ academicEventId: exam.id })
    reminder.assertStatus(404)

    // Responsável não cria evento.
    const createEvent = await client.post(`${API}/events`).bearerToken(account.token).json({
      title: 'Evento indevido',
      category: 'activity',
      startsAt: '2026-12-01T19:00',
      academicClassId: tads.id,
    })
    createEvent.assertStatus(403)
  })

  test('aluno adulto gera código e o responsável usa: vínculo ativo, aviso ao aluno e uso único', async ({
    client,
    assert,
  }) => {
    const { tads, diogo } = await demo()
    const diogoToken = await loginAs(client, diogo.email)

    const code = await newCode(client, diogoToken)
    assert.match(code.code, /^[0-9A-HJKMNP-TV-Z]{8}$/)
    assert.equal(code.codeFormatted, `${code.code.slice(0, 4)}-${code.code.slice(4)}`)
    assert.equal(code.kind, 'student')
    assert.isFalse(code.linkWillBePending)
    const days = DateTime.fromISO(code.expiresAt).diffNow('days').days
    assert.isAbove(days, 6.9)
    assert.isBelow(days, 7.1)

    // Só o HMAC fica no banco; o código em claro não.
    const stored = await GuardianLinkCode.findOrFail(code.id)
    assert.lengthOf(stored.codeHash, 64)
    assert.equal(stored.codeHash, GuardianLinkService.hash(code.code))
    assert.notInclude(JSON.stringify(stored.serialize()), code.code)

    const mine = await client.get(`${API}/me/guardians`).bearerToken(diogoToken)
    mine.assertStatus(200)
    const listed = (
      mine.body() as unknown as Envelope<{
        isMinor: boolean
        guardians: { fullName: string; canRemove: boolean; canShareGrades: boolean }[]
        codes: Record<string, unknown>[]
      }>
    ).data
    assert.isFalse(listed.isMinor)
    assert.deepEqual(
      listed.guardians.map((item) => item.fullName),
      ['Maria Queiroz']
    )
    assert.isTrue(listed.guardians[0].canRemove)
    assert.isTrue(listed.guardians[0].canShareGrades)
    assert.lengthOf(listed.codes, 1)
    // Nunca o código nem o hash: só o prazo e se o aluno pode cancelar.
    assert.sameMembers(Object.keys(listed.codes[0]), [
      'id',
      'kind',
      'expiresAt',
      'createdAt',
      'canCancel',
    ])

    const guardian = await signup(client, 'pai.diogo@agenda.test', 'guardian', 'José Silva')
    // Minúsculas e o hífen valem igual.
    const claimed = await claim(client, guardian.token, code.codeFormatted.toLowerCase(), 'pai')
    claimed.assertStatus(201)
    const body = (claimed.body() as unknown as Envelope<ClaimResponse>).data
    assert.equal(body.link.status, 'active')
    assert.equal(body.link.origin, 'student_code')
    assert.equal(body.link.relationship, 'pai')
    assert.equal(body.student.id, diogo.id)
    assert.equal(body.message, 'Agora você acompanha Diogo.')

    await stored.refresh()
    assert.isNotNull(stored.usedAt)
    assert.equal(stored.usedById, guardian.user.id)

    const notices = await notificationsOf(diogo.id, 'guardian_linked')
    assert.include(
      notices.map((item) => item.title),
      'José Silva agora acompanha sua agenda'
    )
    // O responsável fez a ação: não recebe aviso dela.
    assert.lengthOf(await notificationsOf(guardian.user.id), 0)

    const audit = await AuditLog.query().where('subjectUserId', diogo.id).orderBy('id')
    assert.includeMembers(
      audit.map((entry) => entry.action),
      ['guardian_code.create', 'guardian_link.create']
    )
    for (const entry of audit) {
      assert.notInclude(entry.meta ?? '', code.code)
    }

    // Com um vínculo só, o studentId é opcional.
    const events = await client.get(`${API}/events`).bearerToken(guardian.token)
    events.assertStatus(200)
    assert.include(classIdsOf(events.body()), tads.id)

    // Código de uso único: outro responsável recebe a mensagem genérica.
    const other = await signup(client, 'outro.resp@agenda.test')
    const reused = await claim(client, other.token, code.code)
    reused.assertStatus(422)
    assert.equal((reused.body() as unknown as { message: string }).message, INVALID_CODE)

    // Aluno e docente não usam código de responsável.
    const studentClaim = await claim(client, diogoToken, code.code)
    studentClaim.assertStatus(403)
    const teacherClaim = await claim(
      client,
      await loginAs(client, 'maraisa@agenda.test'),
      code.code
    )
    teacherClaim.assertStatus(403)
  })

  test('aluna menor gera código: vínculo pendente, sem acesso até a secretaria aprovar', async ({
    client,
    assert,
  }) => {
    const { inf, logic, marina, ana, admin } = await demo()
    const exam = await infExam(inf, logic, marina)
    const anaToken = await loginAs(client, ana.email)

    const code = await newCode(client, anaToken)
    assert.isTrue(code.linkWillBePending)

    const guardian = await signup(client, 'mae.ana@agenda.test', 'guardian', 'Beatriz Ribeiro')
    const claimed = await claim(client, guardian.token, code.code)
    claimed.assertStatus(201)
    const body = (claimed.body() as unknown as Envelope<ClaimResponse>).data
    assert.equal(body.link.status, 'pending')
    assert.equal(body.message, 'Pedido enviado. A secretaria confirma e você recebe um aviso aqui.')

    assert.lengthOf(await notificationsOf(ana.id, 'guardian_pending'), 1)
    assert.lengthOf(await notificationsOf(admin.id, 'guardian_pending'), 1)

    // Pendente não dá acesso a nada.
    const context = await client.get(`${API}/context`).bearerToken(guardian.token)
    const linked = (
      context.body() as unknown as Envelope<{
        linkedStudents: { status: string; classes: unknown[] }[]
        catalog: { classes: unknown[] }
      }>
    ).data
    assert.equal(linked.linkedStudents[0].status, 'pending')
    assert.lengthOf(linked.linkedStudents[0].classes, 0)
    assert.lengthOf(linked.catalog.classes, 0)
    await expectStatus(
      client.get(`${API}/events?studentId=${ana.id}`).bearerToken(guardian.token),
      404
    )
    await expectStatus(client.get(`${API}/events/${exam.id}`).bearerToken(guardian.token), 404)

    // Usar de novo um código válido enquanto o pedido está pendente não cria outro vínculo.
    const second = await newCode(client, anaToken)
    const again = await claim(client, guardian.token, second.code)
    again.assertStatus(200)
    assert.isTrue((again.body() as unknown as Envelope<ClaimResponse>).data.alreadyLinked)

    const teacherApprove = await client
      .post(`${API}/guardian-links/${body.link.id}/approve`)
      .bearerToken(await loginAs(client, 'marina@agenda.test'))
    teacherApprove.assertStatus(403)
    const studentApprove = await client
      .post(`${API}/guardian-links/${body.link.id}/approve`)
      .bearerToken(anaToken)
    studentApprove.assertStatus(403)

    const pendingList = await client
      .get(`${API}/guardian-links?status=pending`)
      .bearerToken(await loginAs(client, admin.email))
    pendingList.assertStatus(200)
    assert.include(
      (pendingList.body() as unknown as Envelope<{ id: number }[]>).data.map((item) => item.id),
      body.link.id
    )

    const approved = await client
      .post(`${API}/guardian-links/${body.link.id}/approve`)
      .bearerToken(await loginAs(client, admin.email))
    approved.assertStatus(200)
    assert.equal((approved.body() as unknown as Envelope<Summary>).data.status, 'active')
    const link = await GuardianLink.findOrFail(body.link.id)
    assert.equal(link.approvedById, admin.id)
    assert.lengthOf(await notificationsOf(guardian.user.id, 'guardian_linked'), 1)
    assert.isAtLeast(await countNotifications(ana.id, 'guardian_linked'), 1)

    const events = await client.get(`${API}/events?studentId=${ana.id}`).bearerToken(guardian.token)
    events.assertStatus(200)
    assert.include(
      (events.body() as unknown as Envelope<EventItem[]>).data.map((event) => event.id),
      exam.id
    )
    await expectStatus(client.get(`${API}/events/${exam.id}`).bearerToken(guardian.token), 200)

    const audit = await AuditLog.query().where('entity', 'guardian_link').where('entityId', link.id)
    assert.includeMembers(
      audit.map((entry) => entry.action),
      ['guardian_link.request', 'guardian_link.approve']
    )
  })

  test('código errado, usado, expirado, cancelado e de vínculo bloqueado dão a mesma resposta; 5 erros travam', async ({
    client,
    assert,
  }) => {
    const { diogo, maria, mariaLink } = await demo()
    const diogoToken = await loginAs(client, diogo.email)

    const used = await newCode(client, diogoToken)
    const first = await signup(client, 'primeiro@agenda.test')
    await expectStatus(claim(client, first.token, used.code), 201)

    const expired = await newCode(client, diogoToken)
    const expiredRecord = await GuardianLinkCode.findOrFail(expired.id)
    expiredRecord.expiresAt = DateTime.now().minus({ minutes: 1 })
    await expiredRecord.save()

    const cancelled = await newCode(client, diogoToken)
    const cancel = await client
      .delete(`${API}/me/guardian-codes/${cancelled.id}`)
      .bearerToken(diogoToken)
    cancel.assertStatus(200)

    const guardian = await signup(client, 'chute.resp@agenda.test')
    const bodies: unknown[] = []
    for (const code of ['ZZZZ-ZZZZ', used.code, expired.code, cancelled.code, 'abc']) {
      const response = await claim(client, guardian.token, code)
      response.assertStatus(422)
      bodies.push(response.body())
    }
    for (const body of bodies) {
      assert.deepEqual(body, bodies[0])
    }
    assert.equal((bodies[0] as { message: string }).message, INVALID_CODE)
    assert.deepEqual(fieldOf(bodies[0]), ['code'])

    // Sexta tentativa, mesmo com um código certo: 429.
    const valid = await newCode(client, diogoToken)
    const blocked = await claim(client, guardian.token, valid.code)
    blocked.assertStatus(429)
    assert.equal((blocked.body() as unknown as { code: string }).code, 'TOO_MANY_ATTEMPTS')
    assert.isNull(await codeUsedAt(valid.id))

    // Vínculo bloqueado: nenhum código passa por cima, e a resposta é a mesma.
    AttemptLimiterService.clear()
    const block = await client
      .post(`${API}/guardian-links/${mariaLink.id}/block`)
      .bearerToken(await loginAs(client, 'admin@agenda.test'))
      .json({ reason: 'Ordem judicial' })
    block.assertStatus(200)
    const overBlock = await claim(client, await loginAs(client, maria.email), valid.code)
    overBlock.assertStatus(422)
    assert.deepEqual(overBlock.body(), bodies[0])
    await mariaLink.refresh()
    assert.equal(mariaLink.status, 'blocked')
    assert.isNull(await codeUsedAt(valid.id))
  })

  test('limites: no máximo 3 códigos válidos e 4 vínculos por aluno', async ({
    client,
    assert,
  }) => {
    const { diogo, ana } = await demo()
    const diogoToken = await loginAs(client, diogo.email)
    const adminToken = await loginAs(client, 'admin@agenda.test')

    const c1 = await newCode(client, diogoToken)
    const c2 = await newCode(client, diogoToken)
    const c3 = await newCode(client, diogoToken)
    const limit = await client.post(`${API}/me/guardian-codes`).bearerToken(diogoToken)
    limit.assertStatus(409)
    assert.equal((limit.body() as unknown as { code: string }).code, 'CODE_LIMIT')

    // Outro aluno não cancela o código do Diogo.
    const foreign = await client
      .delete(`${API}/me/guardian-codes/${c3.id}`)
      .bearerToken(await loginAs(client, ana.email))
    foreign.assertStatus(404)
    await expectStatus(
      client.delete(`${API}/me/guardian-codes/${c3.id}`).bearerToken(diogoToken),
      200
    )
    const c4 = await newCode(client, diogoToken)

    const g1 = await signup(client, 'g1@agenda.test')
    const g2 = await signup(client, 'g2@agenda.test')
    const g3 = await signup(client, 'g3@agenda.test')
    const g4 = await signup(client, 'g4@agenda.test')
    await expectStatus(claim(client, g1.token, c1.code), 201)
    await expectStatus(claim(client, g2.token, c2.code), 201)

    const usedCancel = await client
      .delete(`${API}/me/guardian-codes/${c1.id}`)
      .bearerToken(diogoToken)
    usedCancel.assertStatus(409)
    assert.equal((usedCancel.body() as unknown as { code: string }).code, 'CODE_USED')

    // Código da secretaria gerado antes de chegar ao limite.
    const adminCode = await client
      .post(`${API}/students/${diogo.id}/guardian-codes`)
      .bearerToken(adminToken)
    adminCode.assertStatus(201)
    const adminCodeValue = (adminCode.body() as unknown as Envelope<CodeResponse>).data.code

    await expectStatus(claim(client, g3.token, c4.code), 201)
    // Maria, g1, g2 e g3: 4 vínculos.
    assert.equal(await GuardianLinkService.openLinkCount(diogo.id, null), 4)

    const overLimit = await claim(client, g4.token, adminCodeValue)
    overLimit.assertStatus(409)
    assert.equal((overLimit.body() as unknown as { code: string }).code, 'LINK_LIMIT')
    assert.isNull(
      await GuardianLink.query()
        .where('guardianId', g4.user.id)
        .where('studentId', diogo.id)
        .first()
    )

    const noMoreCodes = await client.post(`${API}/me/guardian-codes`).bearerToken(diogoToken)
    noMoreCodes.assertStatus(409)
    assert.equal((noMoreCodes.body() as unknown as { code: string }).code, 'LINK_LIMIT')

    const byEmail = await client
      .post(`${API}/students/${diogo.id}/guardians`)
      .bearerToken(adminToken)
      .json({ email: 'g4@agenda.test', relationship: 'outro' })
    byEmail.assertStatus(409)
    assert.equal((byEmail.body() as unknown as { code: string }).code, 'LINK_LIMIT')
  })

  test('responsável com dois alunos escolhe o studentId; sem vínculo ativo com o aluno, 404', async ({
    client,
    assert,
  }) => {
    const { tads, inf, logic, marina, diogo, ana, maria, carlos, maraisa } = await demo()
    const exam = await infExam(inf, logic, marina)
    const tadsEvent = await tadsExam(tads)
    const adminToken = await loginAs(client, 'admin@agenda.test')

    const linked = await client
      .post(`${API}/students/${ana.id}/guardians`)
      .bearerToken(adminToken)
      .json({ email: 'MARIA@agenda.test', relationship: 'responsavel_legal' })
    linked.assertStatus(201)
    const linkData = (
      linked.body() as unknown as Envelope<{ status: string; origin: string; email: string }>
    ).data
    assert.equal(linkData.status, 'active')
    assert.equal(linkData.origin, 'admin')
    assert.equal(linkData.email, 'maria@agenda.test')
    // A secretaria vinculou: o aluno e o responsável recebem aviso.
    assert.isAtLeast(await countNotifications(maria.id, 'guardian_linked'), 1)
    assert.isAtLeast(await countNotifications(ana.id, 'guardian_linked'), 1)

    const mariaToken = await loginAs(client, maria.email)
    const required = await client.get(`${API}/events`).bearerToken(mariaToken)
    required.assertStatus(422)
    assert.deepEqual(fieldOf(required.body()), ['studentId'])
    await expectStatus(client.get(`${API}/dashboard`).bearerToken(mariaToken), 422)

    const diogoEvents = await client
      .get(`${API}/events?studentId=${diogo.id}`)
      .bearerToken(mariaToken)
    diogoEvents.assertStatus(200)
    assert.include(classIdsOf(diogoEvents.body()), tads.id)
    assert.notInclude(classIdsOf(diogoEvents.body()), inf.id)

    const anaEvents = await client.get(`${API}/events?studentId=${ana.id}`).bearerToken(mariaToken)
    assert.include(classIdsOf(anaEvents.body()), inf.id)
    assert.notInclude(classIdsOf(anaEvents.body()), tads.id)

    const dashboard = await client
      .get(`${API}/dashboard?studentId=${ana.id}`)
      .bearerToken(mariaToken)
    dashboard.assertStatus(200)
    const upcoming = (dashboard.body() as unknown as Envelope<{ upcoming: EventItem[] }>).data
      .upcoming
    assert.include(
      upcoming.map((event) => event.id),
      exam.id
    )
    assert.notInclude(
      upcoming.map((event) => event.academicClassId),
      tads.id
    )
    await expectStatus(
      client.get(`${API}/events/${exam.id}?studentId=${diogo.id}`).bearerToken(mariaToken),
      404
    )
    await expectStatus(client.get(`${API}/events/${exam.id}`).bearerToken(mariaToken), 200)
    await expectStatus(
      client.get(`${API}/events/${exam.id}?studentId=${ana.id}`).bearerToken(mariaToken),
      200
    )

    for (const studentId of [999999, maraisa.id, 'abc']) {
      await expectStatus(
        client.get(`${API}/events?studentId=${studentId}`).bearerToken(mariaToken),
        404
      )
    }

    // Carlos acompanha só a Ana: o Diogo e os eventos da TADS são 404 para ele.
    const carlosToken = await loginAs(client, carlos.email)
    await expectStatus(
      client.get(`${API}/events?studentId=${diogo.id}`).bearerToken(carlosToken),
      404
    )
    await expectStatus(
      client.get(`${API}/dashboard?studentId=${diogo.id}`).bearerToken(carlosToken),
      404
    )
    await expectStatus(client.get(`${API}/events/${tadsEvent.id}`).bearerToken(carlosToken), 404)

    // Responsável só lê: não edita nem exclui evento.
    const update = await client
      .put(`${API}/events/${tadsEvent.id}`)
      .bearerToken(mariaToken)
      .json({ title: 'Mudado pelo responsável' })
    update.assertStatus(403)
    await expectStatus(client.delete(`${API}/events/${tadsEvent.id}`).bearerToken(mariaToken), 403)
  })

  test('lembretes do responsável: só sobre eventos do aluno vinculado, e param quando o vínculo acaba', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, maria, carlos, mariaLink } = await demo()
    const exam = await tadsExam(tads)
    const mariaToken = await loginAs(client, maria.email)

    const outOfReach = await client
      .post(`${API}/reminders`)
      .bearerToken(await loginAs(client, carlos.email))
      .json({ academicEventId: exam.id })
    outOfReach.assertStatus(404)

    const created = await client
      .post(`${API}/reminders`)
      .bearerToken(mariaToken)
      .json({ academicEventId: exam.id, offsetMinutes: 60 })
    created.assertStatus(201)
    const reminderId = (created.body() as unknown as Envelope<{ id: number; userId: number }>).data
      .id
    const reminder = await Reminder.findOrFail(reminderId)
    assert.equal(reminder.userId, maria.id)

    // O aluno não vê os lembretes do responsável, e o responsável não vê os do aluno.
    const diogoReminders = await client
      .get(`${API}/reminders`)
      .bearerToken(await loginAs(client, diogo.email))
    assert.notInclude(
      (diogoReminders.body() as unknown as Envelope<{ id: number }[]>).data.map((item) => item.id),
      reminderId
    )
    const mariaReminders = async () => {
      const response = await client.get(`${API}/reminders`).bearerToken(mariaToken)
      return (response.body() as unknown as Envelope<{ id: number }[]>).data.map((item) => item.id)
    }
    assert.include(await mariaReminders(), reminderId)

    reminder.sendAt = DateTime.now().minus({ minutes: 1 })
    await reminder.save()
    const due = async () => {
      const result = await ReminderDeliveryService.sendDue({ dryRun: true })
      return result.deliveries.map((delivery) => delivery.reminderId)
    }
    assert.include(await due(), reminderId)

    const revoked = await client
      .delete(`${API}/guardian-links/${mariaLink.id}`)
      .bearerToken(mariaToken)
    revoked.assertStatus(200)
    assert.notInclude(await mariaReminders(), reminderId)
    assert.notInclude(await due(), reminderId)
    const dashboard = await client.get(`${API}/dashboard`).bearerToken(mariaToken)
    dashboard.assertStatus(200)
    assert.notInclude(
      (dashboard.body() as unknown as Envelope<{ reminders: { id: number }[] }>).data.reminders.map(
        (item) => item.id
      ),
      reminderId
    )

    const restored = await client
      .post(`${API}/guardian-links/${mariaLink.id}/restore`)
      .bearerToken(mariaToken)
    restored.assertStatus(200)
    assert.include(await mariaReminders(), reminderId)
    assert.include(await due(), reminderId)
  })

  test('desfazer vínculo: quem pode, aviso aos dois e Desfazer só para quem desfez, em 10 minutos', async ({
    client,
    assert,
  }) => {
    const { diogo, ana, maria, carlos, mariaLink, carlosLink } = await demo()
    const mariaToken = await loginAs(client, maria.email)
    const diogoToken = await loginAs(client, diogo.email)
    const anaToken = await loginAs(client, ana.email)
    const carlosToken = await loginAs(client, carlos.email)

    await expectStatus(
      client
        .delete(`${API}/guardian-links/${mariaLink.id}`)
        .bearerToken(await loginAs(client, 'maraisa@agenda.test')),
      403
    )
    await expectStatus(
      client.delete(`${API}/guardian-links/${mariaLink.id}`).bearerToken(carlosToken),
      404
    )
    await expectStatus(
      client.delete(`${API}/guardian-links/${mariaLink.id}`).bearerToken(anaToken),
      404
    )
    await expectStatus(client.delete(`${API}/guardian-links/999999`).bearerToken(mariaToken), 404)

    // Aluna menor não remove o vínculo criado pela secretaria.
    const minorRemove = await client
      .delete(`${API}/guardian-links/${carlosLink.id}`)
      .bearerToken(anaToken)
    minorRemove.assertStatus(403)
    await carlosLink.refresh()
    assert.equal(carlosLink.status, 'active')

    // O próprio responsável desfaz; o aluno recebe aviso.
    const revoked = await client
      .delete(`${API}/guardian-links/${mariaLink.id}`)
      .bearerToken(mariaToken)
    revoked.assertStatus(200)
    const summary = (revoked.body() as unknown as Envelope<Summary>).data
    assert.equal(summary.status, 'revoked')
    assert.isNotNull(summary.undoUntil)
    await mariaLink.refresh()
    assert.equal(mariaLink.revokedById, maria.id)
    const unlinked = await notificationsOf(diogo.id, 'guardian_unlinked')
    assert.lengthOf(unlinked, 1)
    assert.equal(unlinked[0].title, 'Maria Queiroz deixou de acompanhar sua agenda')
    assert.lengthOf(await notificationsOf(maria.id, 'guardian_unlinked'), 0)

    // A linha não é apagada; desfazer de novo não muda nada.
    await expectStatus(
      client.delete(`${API}/guardian-links/${mariaLink.id}`).bearerToken(mariaToken),
      200
    )
    assert.lengthOf(await notificationsOf(diogo.id, 'guardian_unlinked'), 1)

    // Só quem desfez restaura.
    const notTheRevoker = await client
      .post(`${API}/guardian-links/${mariaLink.id}/restore`)
      .bearerToken(diogoToken)
    notTheRevoker.assertStatus(403)
    const restored = await client
      .post(`${API}/guardian-links/${mariaLink.id}/restore`)
      .bearerToken(mariaToken)
    restored.assertStatus(200)
    assert.equal((restored.body() as unknown as Envelope<Summary>).data.status, 'active')
    await mariaLink.refresh()
    assert.isNull(mariaLink.revokedAt)
    assert.include(
      await notificationTitles(diogo.id, 'guardian_linked'),
      'Maria Queiroz voltou a acompanhar sua agenda'
    )

    // O aluno adulto desfaz; o responsável recebe aviso.
    await expectStatus(
      client.delete(`${API}/guardian-links/${mariaLink.id}`).bearerToken(diogoToken),
      200
    )
    const mariaNotices = await notificationsOf(maria.id, 'guardian_unlinked')
    assert.lengthOf(mariaNotices, 1)
    assert.equal(mariaNotices[0].body, 'O aluno desfez o vínculo.')

    // Passados 10 minutos, o Desfazer não vale mais.
    await mariaLink.refresh()
    mariaLink.revokedAt = DateTime.now().minus({ minutes: 11 })
    await mariaLink.save()
    const expired = await client
      .post(`${API}/guardian-links/${mariaLink.id}/restore`)
      .bearerToken(diogoToken)
    expired.assertStatus(409)
    assert.equal((expired.body() as unknown as { code: string }).code, 'UNDO_EXPIRED')

    // A administração desfaz o vínculo da aluna menor; os dois recebem aviso.
    const adminRevoke = await client
      .delete(`${API}/guardian-links/${carlosLink.id}`)
      .bearerToken(await loginAs(client, 'admin@agenda.test'))
    adminRevoke.assertStatus(200)
    assert.lengthOf(await notificationsOf(ana.id, 'guardian_unlinked'), 1)
    assert.lengthOf(await notificationsOf(carlos.id, 'guardian_unlinked'), 1)

    // A aluna menor desfaz o vínculo que nasceu de um código dela.
    const code = await newCode(client, anaToken)
    const guardian = await signup(client, 'tia.ana@agenda.test', 'guardian', 'Tia da Ana')
    const pendingClaim = await claim(client, guardian.token, code.code, 'outro')
    const pending = (pendingClaim.body() as unknown as Envelope<ClaimResponse>).data
    const minorOwn = await client
      .delete(`${API}/guardian-links/${pending.link.id}`)
      .bearerToken(anaToken)
    minorOwn.assertStatus(200)
    assert.equal((minorOwn.body() as unknown as Envelope<Summary>).data.status, 'revoked')
    // Pedido pendente nunca deu acesso: o aviso fala do pedido encerrado.
    assert.include(
      await notificationTitles(ana.id, 'guardian_unlinked'),
      'O pedido de Tia da Ana para acompanhar sua agenda foi encerrado'
    )
    assert.include(
      await notificationTitles(guardian.user.id, 'guardian_unlinked'),
      'Seu pedido para acompanhar Ana foi encerrado'
    )

    // Restaurar um pedido desfeito volta para pendente, não para ativo.
    const back = await client
      .post(`${API}/guardian-links/${pending.link.id}/restore`)
      .bearerToken(anaToken)
    back.assertStatus(200)
    assert.equal((back.body() as unknown as Envelope<Summary>).data.status, 'pending')

    const entries = await AuditLog.query()
      .where('entity', 'guardian_link')
      .where('entityId', mariaLink.id)
    const actions = entries.map((entry) => entry.action)
    assert.includeMembers(actions, ['guardian_link.revoke', 'guardian_link.restore'])
  })

  test('compartilhar notas: só o aluno adulto, no próprio vínculo', async ({ client, assert }) => {
    const { diogo, ana, maria, mariaLink, carlosLink } = await demo()
    const diogoToken = await loginAs(client, diogo.email)

    const off = await client
      .patch(`${API}/me/guardians/${mariaLink.id}`)
      .bearerToken(diogoToken)
      .json({ shareGrades: false })
    off.assertStatus(200)
    assert.isFalse((off.body() as unknown as Envelope<{ shareGrades: boolean }>).data.shareGrades)
    await mariaLink.refresh()
    assert.isFalse(mariaLink.shareGrades)
    const audit = await AuditLog.query()
      .where('action', 'guardian_link.share_grades')
      .where('entityId', mariaLink.id)
      .firstOrFail()
    assert.deepEqual(JSON.parse(audit.meta!), { guardianId: maria.id, from: true, to: false })

    const empty = await client
      .patch(`${API}/me/guardians/${mariaLink.id}`)
      .bearerToken(diogoToken)
      .json({})
    empty.assertStatus(422)

    const minor = await client
      .patch(`${API}/me/guardians/${carlosLink.id}`)
      .bearerToken(await loginAs(client, ana.email))
      .json({ shareGrades: false })
    minor.assertStatus(403)

    const foreign = await client
      .patch(`${API}/me/guardians/${carlosLink.id}`)
      .bearerToken(diogoToken)
      .json({ shareGrades: true })
    foreign.assertStatus(404)

    const guardian = await client
      .patch(`${API}/me/guardians/${mariaLink.id}`)
      .bearerToken(await loginAs(client, maria.email))
      .json({ shareGrades: true })
    guardian.assertStatus(403)
  })

  test('administração: lista, vincula por e-mail, código de 30 dias, bloqueia e marca o aluno menor', async ({
    client,
    assert,
  }) => {
    const { diogo, ana, maraisa, carlos, carlosLink } = await demo()
    const adminToken = await loginAs(client, 'admin@agenda.test')
    const teacherToken = await loginAs(client, maraisa.email)

    await expectStatus(
      client.get(`${API}/students/${diogo.id}/guardians`).bearerToken(teacherToken),
      403
    )
    await expectStatus(
      client
        .get(`${API}/students/${diogo.id}/guardians`)
        .bearerToken(await loginAs(client, diogo.email)),
      403
    )
    await expectStatus(
      client.get(`${API}/students/${maraisa.id}/guardians`).bearerToken(adminToken),
      404
    )
    await expectStatus(
      client.post(`${API}/students/${diogo.id}/guardian-codes`).bearerToken(teacherToken),
      403
    )

    const list = await client.get(`${API}/students/${diogo.id}/guardians`).bearerToken(adminToken)
    list.assertStatus(200)
    const listed = (
      list.body() as unknown as Envelope<{
        student: { id: number; isMinor: boolean }
        guardians: { email: string; origin: string; status: string }[]
      }>
    ).data
    assert.equal(listed.student.id, diogo.id)
    assert.deepEqual(
      listed.guardians.map((item) => item.email),
      ['maria@agenda.test']
    )

    const notGuardian = await client
      .post(`${API}/students/${diogo.id}/guardians`)
      .bearerToken(adminToken)
      .json({ email: maraisa.email, relationship: 'mae' })
    notGuardian.assertStatus(422)
    assert.deepEqual(fieldOf(notGuardian.body()), ['email'])
    const already = await client
      .post(`${API}/students/${diogo.id}/guardians`)
      .bearerToken(adminToken)
      .json({ email: 'maria@agenda.test', relationship: 'mae' })
    already.assertStatus(422)
    const badRelationship = await client
      .post(`${API}/students/${diogo.id}/guardians`)
      .bearerToken(adminToken)
      .json({ email: 'carlos@agenda.test', relationship: 'vizinho' })
    badRelationship.assertStatus(422)
    assert.include(fieldOf(badRelationship.body()), 'relationship')

    // Código da secretaria: 30 dias e vínculo já ativo, mesmo para aluna menor.
    const adminCode = await client
      .post(`${API}/students/${ana.id}/guardian-codes`)
      .bearerToken(adminToken)
    adminCode.assertStatus(201)
    const codeData = (adminCode.body() as unknown as Envelope<CodeResponse>).data
    assert.equal(codeData.kind, 'admin')
    const days = DateTime.fromISO(codeData.expiresAt).diffNow('days').days
    assert.isAbove(days, 29.9)
    const avo = await signup(client, 'avo.ana@agenda.test', 'guardian', 'Avó da Ana')
    const claimed = await claim(client, avo.token, codeData.code, 'outro')
    claimed.assertStatus(201)
    const claimedLink = (claimed.body() as unknown as Envelope<ClaimResponse>).data.link
    assert.equal(claimedLink.status, 'active')
    assert.equal(claimedLink.origin, 'admin_code')

    // Bloquear pede motivo.
    const noReason = await client
      .post(`${API}/guardian-links/${carlosLink.id}/block`)
      .bearerToken(adminToken)
      .json({})
    noReason.assertStatus(422)
    assert.deepEqual(fieldOf(noReason.body()), ['reason'])
    await expectStatus(
      client
        .post(`${API}/guardian-links/${carlosLink.id}/block`)
        .bearerToken(teacherToken)
        .json({ reason: 'Teste' }),
      403
    )

    const blocked = await client
      .post(`${API}/guardian-links/${carlosLink.id}/block`)
      .bearerToken(adminToken)
      .json({ reason: 'Pedido da família com documento' })
    blocked.assertStatus(200)
    await carlosLink.refresh()
    assert.equal(carlosLink.status, 'blocked')
    assert.equal(carlosLink.revokeReason, 'Pedido da família com documento')
    assert.lengthOf(await notificationsOf(ana.id, 'guardian_unlinked'), 1)
    const carlosNotice = await notificationsOf(carlos.id, 'guardian_unlinked')
    assert.lengthOf(carlosNotice, 1)
    // O motivo não vai para o responsável nem para o registro de ações.
    assert.notInclude(carlosNotice[0].body ?? '', 'documento')
    const blockAudit = await AuditLog.query()
      .where('action', 'guardian_link.block')
      .where('entityId', carlosLink.id)
      .firstOrFail()
    assert.notInclude(blockAudit.meta ?? '', 'documento')

    // Bloqueado some para o responsável e não volta pelo Desfazer.
    const carlosToken = await loginAs(client, carlos.email)
    await expectStatus(
      client.delete(`${API}/guardian-links/${carlosLink.id}`).bearerToken(carlosToken),
      404
    )
    await expectStatus(
      client.post(`${API}/guardian-links/${carlosLink.id}/restore`).bearerToken(carlosToken),
      404
    )
    const adminRestore = await client
      .post(`${API}/guardian-links/${carlosLink.id}/restore`)
      .bearerToken(adminToken)
    adminRestore.assertStatus(409)
    assert.equal((adminRestore.body() as unknown as { code: string }).code, 'BLOCKED')
    const carlosContext = await client.get(`${API}/context`).bearerToken(carlosToken)
    assert.lengthOf(
      (carlosContext.body() as unknown as Envelope<{ linkedStudents: unknown[] }>).data
        .linkedStudents,
      0
    )
    const blockedList = await client
      .get(`${API}/guardian-links?status=blocked`)
      .bearerToken(adminToken)
    assert.include(
      (blockedList.body() as unknown as Envelope<{ id: number }[]>).data.map((item) => item.id),
      carlosLink.id
    )
    const notPending = await client
      .post(`${API}/guardian-links/${carlosLink.id}/approve`)
      .bearerToken(adminToken)
    notPending.assertStatus(409)
    assert.equal((notPending.body() as unknown as { code: string }).code, 'NOT_PENDING')

    // Marcar menor: só a administração, só em conta de aluno.
    await expectStatus(
      client.patch(`${API}/users/${ana.id}`).bearerToken(teacherToken).json({ isMinor: false }),
      403
    )
    const teacherTarget = await client
      .patch(`${API}/users/${maraisa.id}`)
      .bearerToken(adminToken)
      .json({ isMinor: true })
    teacherTarget.assertStatus(422)
    assert.deepEqual(fieldOf(teacherTarget.body()), ['isMinor'])
    await expectStatus(
      client.patch(`${API}/users/999999`).bearerToken(adminToken).json({ isMinor: true }),
      404
    )

    // Ana deixa de ser menor: o vínculo aberto fica para revisão e ela recebe aviso.
    const adult = await client
      .patch(`${API}/users/${ana.id}`)
      .bearerToken(adminToken)
      .json({ isMinor: false })
    adult.assertStatus(200)
    assert.equal(
      (adult.body() as unknown as Envelope<{ linksToReview: number }>).data.linksToReview,
      1
    )
    const reviewLink = await GuardianLink.findOrFail(claimedLink.id)
    assert.isTrue(reviewLink.needsReview)
    assert.isFalse(reviewLink.shareGrades)
    assert.lengthOf(await notificationsOf(ana.id, 'guardian_review'), 1)
    assert.isNotNull(
      await AuditLog.query().where('action', 'user.minor').where('entityId', ana.id).first()
    )

    const anaToken = await loginAs(client, ana.email)
    const confirmed = await client
      .patch(`${API}/me/guardians/${claimedLink.id}`)
      .bearerToken(anaToken)
      .json({ confirm: true, shareGrades: true })
    confirmed.assertStatus(200)
    const confirmedData = (
      confirmed.body() as unknown as Envelope<{ needsReview: boolean; shareGrades: boolean }>
    ).data
    assert.isFalse(confirmedData.needsReview)
    assert.isTrue(confirmedData.shareGrades)
  })

  test('avisos: cada pessoa vê e marca como lidos só os próprios', async ({ client, assert }) => {
    const { diogo, maria } = await demo()
    const diogoToken = await loginAs(client, diogo.email)

    const list = await client.get(`${API}/notifications`).bearerToken(diogoToken)
    list.assertStatus(200)
    const data = (
      list.body() as unknown as Envelope<{
        notifications: { id: number; kind: string; title: string; readAt: string | null }[]
        unreadCount: number
      }>
    ).data
    assert.isAtLeast(data.notifications.length, 1)
    assert.equal(data.notifications[0].title, 'Maria Queiroz agora acompanha sua agenda')
    assert.equal(data.unreadCount, data.notifications.length)
    const [first] = data.notifications

    const otherPerson = await client
      .post(`${API}/notifications/${first.id}/read`)
      .bearerToken(await loginAs(client, maria.email))
    otherPerson.assertStatus(404)
    const mariaList = await client
      .get(`${API}/notifications`)
      .bearerToken(await loginAs(client, maria.email))
    assert.notInclude(
      (
        mariaList.body() as unknown as Envelope<{ notifications: { id: number }[] }>
      ).data.notifications.map((item) => item.id),
      first.id
    )

    const read = await client.post(`${API}/notifications/${first.id}/read`).bearerToken(diogoToken)
    read.assertStatus(200)
    assert.isNotNull((read.body() as unknown as Envelope<{ readAt: string | null }>).data.readAt)

    await Notification.create({ userId: diogo.id, kind: 'guardian_unlinked', title: 'Outro aviso' })
    const readAll = await client.post(`${API}/notifications/read-all`).bearerToken(diogoToken)
    readAll.assertStatus(200)
    assert.equal((readAll.body() as unknown as Envelope<{ updated: number }>).data.updated, 1)

    const unread = await client.get(`${API}/notifications?unread=1`).bearerToken(diogoToken)
    const unreadData = (
      unread.body() as unknown as Envelope<{ notifications: unknown[]; unreadCount: number }>
    ).data
    assert.lengthOf(unreadData.notifications, 0)
    assert.equal(unreadData.unreadCount, 0)
  })
})

/** Linhas das tabelas da fase 2, para provar que uma tentativa barrada não muda nada. */
async function phase2Snapshot() {
  const [links, codes] = await Promise.all([
    GuardianLink.query().orderBy('id'),
    GuardianLinkCode.query().orderBy('id'),
  ])
  return {
    links: links.map((link) => [link.id, link.status, link.shareGrades, link.revokedAt?.toISO()]),
    codes: codes.map((code) => [code.id, code.usedAt?.toISO(), code.revokedAt?.toISO()]),
  }
}

type Attempt = [method: 'get' | 'post' | 'patch' | 'delete', url: string, body?: object]

test.group('Fase 2: revisão (BOLA e regras)', (group) => {
  group.each.setup(() => {
    AttemptLimiterService.clear()
    return testUtils.db().withGlobalTransaction()
  })

  test('matriz de papéis: ninguém alcança vínculo, código, aviso ou agenda de outra pessoa', async ({
    client,
    assert,
  }) => {
    const { tads, inf, logic, admin, maraisa, marina, diogo, ana, maria, carlos, mariaLink } =
      await demo()
    const infEvent = await infExam(inf, logic, marina)
    const tadsEvent = await tadsExam(tads)

    const diogoToken = await loginAs(client, diogo.email)
    const diogoCode = await newCode(client, diogoToken)
    const [diogoNotice] = await notificationsOf(diogo.id)
    assert.exists(diogoNotice)

    const loose = await signup(client, 'docente.solto@agenda.test', 'teacher', 'Docente Sem Turma')
    const lonely = await signup(client, 'resp.sozinho@agenda.test', 'guardian', 'Resp Sem Aluno')
    const tokens = {
      ana: await loginAs(client, ana.email),
      maraisa: await loginAs(client, maraisa.email),
      looseTeacher: loose.token,
      carlos: await loginAs(client, carlos.email),
      lonelyGuardian: lonely.token,
      admin: await loginAs(client, admin.email),
    }
    const before = await phase2Snapshot()

    const onLink: Attempt[] = [
      ['delete', `${API}/guardian-links/${mariaLink.id}`, {}],
      ['post', `${API}/guardian-links/${mariaLink.id}/restore`],
      ['patch', `${API}/me/guardians/${mariaLink.id}`, { shareGrades: false }],
      ['delete', `${API}/me/guardian-codes/${diogoCode.id}`],
    ]
    const adminOnly: Attempt[] = [
      ['post', `${API}/guardian-links/${mariaLink.id}/approve`],
      ['post', `${API}/guardian-links/${mariaLink.id}/block`, { reason: 'Tentativa indevida' }],
      ['get', `${API}/guardian-links?status=active`],
      ['get', `${API}/students/${diogo.id}/guardians`],
      [
        'post',
        `${API}/students/${diogo.id}/guardians`,
        { email: carlos.email, relationship: 'pai' },
      ],
      ['post', `${API}/students/${diogo.id}/guardian-codes`],
      ['delete', `${API}/students/${diogo.id}/guardian-codes/${diogoCode.id}`],
      ['patch', `${API}/users/${diogo.id}`, { isMinor: true }],
    ]
    const agenda: Attempt[] = [
      ['get', `${API}/events?studentId=${diogo.id}`],
      ['get', `${API}/dashboard?studentId=${diogo.id}`],
      ['get', `${API}/events/${tadsEvent.id}`],
      ['get', `${API}/events/${tadsEvent.id}?studentId=${diogo.id}`],
      ['post', `${API}/reminders`, { academicEventId: tadsEvent.id }],
    ]

    // [quem, tentativas, status esperado]
    const matrix: [keyof typeof tokens, Attempt[], number][] = [
      // Aluna: o vínculo e o código do Diogo não existem para ela.
      ['ana', onLink, 404],
      ['ana', adminOnly, 403],
      // Docente (com ou sem turma) não está na lista de quem pode.
      ['maraisa', onLink, 403],
      ['maraisa', adminOnly, 403],
      ['looseTeacher', onLink, 403],
      ['looseTeacher', adminOnly, 403],
      // Responsável: o vínculo da Maria não existe para ele; as rotas do aluno e da gestão, 403.
      ['carlos', onLink.slice(0, 2), 404],
      ['carlos', onLink.slice(2), 403],
      ['carlos', adminOnly, 403],
      ['carlos', agenda, 404],
      ['lonelyGuardian', onLink.slice(0, 2), 404],
      ['lonelyGuardian', onLink.slice(2), 403],
      ['lonelyGuardian', adminOnly, 403],
      ['lonelyGuardian', agenda, 404],
    ]
    for (const [who, attempts, status] of matrix) {
      for (const [method, url, body] of attempts) {
        const request: any = client[method](url).bearerToken(tokens[who])
        const response = await (body ? request.json(body) : request)
        assert.equal(response.status(), status, `${who} ${method.toUpperCase()} ${url}`)
      }
    }
    // Aviso de outra pessoa: 404 para todos, administração inclusive.
    for (const who of Object.keys(tokens) as (keyof typeof tokens)[]) {
      await expectStatus(
        client.post(`${API}/notifications/${diogoNotice.id}/read`).bearerToken(tokens[who]),
        404
      )
    }

    // Responsável com vínculo vê a agenda do próprio aluno, mas não a do outro.
    await expectStatus(
      client.get(`${API}/events/${infEvent.id}?studentId=${ana.id}`).bearerToken(tokens.carlos),
      200
    )
    await expectStatus(
      client.get(`${API}/events/${infEvent.id}`).bearerToken(await loginAs(client, maria.email)),
      404
    )

    // Administração: id de quem não é aluno, ou código de outro aluno, é 404.
    for (const [method, url] of [
      ['get', `${API}/students/${maria.id}/guardians`],
      ['post', `${API}/students/${maraisa.id}/guardian-codes`],
      ['delete', `${API}/students/${ana.id}/guardian-codes/${diogoCode.id}`],
      ['delete', `${API}/students/${diogo.id}/guardian-codes/999999`],
      ['post', `${API}/guardian-links/999999/approve`],
    ] as const) {
      await expectStatus(client[method](url).bearerToken(tokens.admin), 404)
    }
    // Rotas do aluno e do responsável não são da administração.
    await expectStatus(
      client
        .patch(`${API}/me/guardians/${mariaLink.id}`)
        .bearerToken(tokens.admin)
        .json({ shareGrades: false }),
      403
    )
    await expectStatus(
      client.delete(`${API}/me/guardian-codes/${diogoCode.id}`).bearerToken(tokens.admin),
      403
    )
    await expectStatus(claim(client, tokens.admin, diogoCode.code), 403)

    // Nada mudou: vínculos, códigos e o aviso continuam como estavam.
    assert.deepEqual(await phase2Snapshot(), before)
    await diogoNotice.refresh()
    assert.isNull(diogoNotice.readAt)
  })

  test('pedido pendente e código da secretaria: o vínculo vira ativo e o código é gasto', async ({
    client,
    assert,
  }) => {
    const { ana } = await demo()
    const anaToken = await loginAs(client, ana.email)
    const adminToken = await loginAs(client, 'admin@agenda.test')

    const own = await newCode(client, anaToken)
    const guardian = await signup(client, 'madrinha.ana@agenda.test', 'guardian', 'Madrinha')
    const first = await expectStatus(claim(client, guardian.token, own.code), 201)
    const pending = (first.body() as unknown as Envelope<ClaimResponse>).data
    assert.equal(pending.link.status, 'pending')

    const adminCodeResponse = await expectStatus(
      client.post(`${API}/students/${ana.id}/guardian-codes`).bearerToken(adminToken),
      201
    )
    const adminCode = (adminCodeResponse.body() as unknown as Envelope<CodeResponse>).data
    const upgraded = await claim(client, guardian.token, adminCode.code, 'outro')
    upgraded.assertStatus(201)
    const body = (upgraded.body() as unknown as Envelope<ClaimResponse>).data
    assert.isFalse(body.alreadyLinked)
    assert.equal(body.link.id, pending.link.id)
    assert.equal(body.link.status, 'active')
    assert.equal(body.link.origin, 'admin_code')
    assert.equal(body.message, 'Agora você acompanha Ana.')
    assert.isNotNull(await codeUsedAt(adminCode.id))

    // Já ativo: outro código da aluna não muda nada e não é gasto.
    const another = await newCode(client, anaToken)
    const again = await expectStatus(claim(client, guardian.token, another.code), 200)
    assert.isTrue((again.body() as unknown as Envelope<ClaimResponse>).data.alreadyLinked)
    assert.isNull(await codeUsedAt(another.id))
  })

  test('vincular por e-mail não passa por cima do bloqueio sem a confirmação explícita', async ({
    client,
    assert,
  }) => {
    const { ana, carlos, carlosLink } = await demo()
    const adminToken = await loginAs(client, 'admin@agenda.test')
    await expectStatus(
      client
        .post(`${API}/guardian-links/${carlosLink.id}/block`)
        .bearerToken(adminToken)
        .json({ reason: 'Ordem judicial' }),
      200
    )

    const silent = await client
      .post(`${API}/students/${ana.id}/guardians`)
      .bearerToken(adminToken)
      .json({ email: carlos.email, relationship: 'pai' })
    silent.assertStatus(409)
    const conflictBody = silent.body() as unknown as { code: string; linkId: number }
    assert.equal(conflictBody.code, 'BLOCKED')
    assert.equal(conflictBody.linkId, carlosLink.id)
    await carlosLink.refresh()
    assert.equal(carlosLink.status, 'blocked')
    assert.equal(carlosLink.revokeReason, 'Ordem judicial')

    const confirmed = await client
      .post(`${API}/students/${ana.id}/guardians`)
      .bearerToken(adminToken)
      .json({ email: carlos.email, relationship: 'pai', unblock: true })
    confirmed.assertStatus(201)
    await carlosLink.refresh()
    assert.equal(carlosLink.status, 'active')
    const entry = await AuditLog.query()
      .where('entity', 'guardian_link')
      .where('entityId', carlosLink.id)
      .where('action', 'guardian_link.create')
      .orderBy('id', 'desc')
      .firstOrFail()
    const meta = JSON.parse(entry.meta!)
    assert.equal(meta.from, 'blocked')
    assert.isTrue(meta.unblocked)
  })

  test('códigos: aluno menor não cancela o da secretaria; a secretaria cancela e destrava o limite', async ({
    client,
    assert,
  }) => {
    const { diogo, ana, maraisa } = await demo()
    const anaToken = await loginAs(client, ana.email)
    const diogoToken = await loginAs(client, diogo.email)
    const adminToken = await loginAs(client, 'admin@agenda.test')

    const adminCodeFor = async (studentId: number, status = 201) => {
      const response = await client
        .post(`${API}/students/${studentId}/guardian-codes`)
        .bearerToken(adminToken)
      response.assertStatus(status)
      return (response.body() as unknown as Envelope<CodeResponse>).data
    }

    // Aluna menor: o código da secretaria aparece na lista, mas sem cancelar.
    const forAna = await adminCodeFor(ana.id)
    const anaOwn = await newCode(client, anaToken)
    const mine = await client.get(`${API}/me/guardians`).bearerToken(anaToken)
    const listed = (
      mine.body() as unknown as Envelope<{ codes: { id: number; canCancel: boolean }[] }>
    ).data.codes
    assert.isFalse(listed.find((item) => item.id === forAna.id)!.canCancel)
    assert.isTrue(listed.find((item) => item.id === anaOwn.id)!.canCancel)
    const minorCancel = await client
      .delete(`${API}/me/guardian-codes/${forAna.id}`)
      .bearerToken(anaToken)
    minorCancel.assertStatus(403)
    const stillValid = await GuardianLinkCode.findOrFail(forAna.id)
    assert.isNull(stillValid.revokedAt)
    await expectStatus(
      client.delete(`${API}/me/guardian-codes/${anaOwn.id}`).bearerToken(anaToken),
      200
    )

    // Aluno adulto cancela até o código da secretaria.
    const forDiogo = await adminCodeFor(diogo.id)
    await expectStatus(
      client.delete(`${API}/me/guardian-codes/${forDiogo.id}`).bearerToken(diogoToken),
      200
    )

    // Três códigos do aluno: a secretaria recebe CODE_LIMIT, cancela um e gera o dela.
    const own = [
      await newCode(client, diogoToken),
      await newCode(client, diogoToken),
      await newCode(client, diogoToken),
    ]
    const limited = await client
      .post(`${API}/students/${diogo.id}/guardian-codes`)
      .bearerToken(adminToken)
    limited.assertStatus(409)
    assert.equal((limited.body() as unknown as { code: string }).code, 'CODE_LIMIT')

    for (const token of [await loginAs(client, maraisa.email), diogoToken]) {
      await expectStatus(
        client.delete(`${API}/students/${diogo.id}/guardian-codes/${own[0].id}`).bearerToken(token),
        403
      )
    }
    const cancelled = await client
      .delete(`${API}/students/${diogo.id}/guardian-codes/${own[0].id}`)
      .bearerToken(adminToken)
    cancelled.assertStatus(200)
    const audit = await AuditLog.query()
      .where('action', 'guardian_code.revoke')
      .where('entityId', own[0].id)
      .firstOrFail()
    assert.equal(audit.subjectUserId, diogo.id)
    await adminCodeFor(diogo.id)

    // Código já usado: 409 CODE_USED também para a secretaria.
    const guardian = await signup(client, 'resp.usado@agenda.test')
    await expectStatus(claim(client, guardian.token, own[1].code), 201)
    const used = await client
      .delete(`${API}/students/${diogo.id}/guardian-codes/${own[1].id}`)
      .bearerToken(adminToken)
    used.assertStatus(409)
    assert.equal((used.body() as unknown as { code: string }).code, 'CODE_USED')
  })

  test('aluno que passa a ser menor: o vínculo do código dele sem aprovação volta a pendente', async ({
    client,
    assert,
  }) => {
    const { tads, inf, admin } = await demo()
    const adminToken = await loginAs(client, admin.email)
    const exam = await tadsExam(tads)

    const linkedStudent = async (email: string, name: string, guardianEmail: string) => {
      const student = await signup(client, email, 'student', name)
      const code = await newCode(client, student.token)
      const guardian = await signup(client, guardianEmail, 'guardian', `Resp de ${name}`)
      const claimed = await expectStatus(claim(client, guardian.token, code.code, 'pai'), 201)
      const link = (claimed.body() as unknown as Envelope<ClaimResponse>).data.link
      return { student, guardian, link }
    }

    // Aluno ainda não marcado como menor gera o código: o vínculo nasce ativo.
    const pedro = await linkedStudent('calouro@agenda.test', 'Pedro', 'pai.pedro@agenda.test')
    assert.equal(pedro.link.status, 'active')
    await expectStatus(
      client
        .post(`${API}/classes/${tads.id}/students`)
        .bearerToken(adminToken)
        .json({ emails: ['calouro@agenda.test'] }),
      200
    )
    await expectStatus(
      client.get(`${API}/events/${exam.id}`).bearerToken(pedro.guardian.token),
      200
    )

    // A secretaria marca menor: o vínculo volta a pendente e o acesso some.
    const marked = await client
      .patch(`${API}/users/${pedro.student.user.id}`)
      .bearerToken(adminToken)
      .json({ isMinor: true })
    marked.assertStatus(200)
    const markedData = (
      marked.body() as unknown as Envelope<{ linksToApprove: number; linksToReview: number }>
    ).data
    assert.equal(markedData.linksToApprove, 1)
    assert.equal(markedData.linksToReview, 0)
    const link = await GuardianLink.findOrFail(pedro.link.id)
    assert.equal(link.status, 'pending')
    await expectStatus(
      client.get(`${API}/events/${exam.id}`).bearerToken(pedro.guardian.token),
      404
    )
    assert.lengthOf(await notificationsOf(pedro.guardian.user.id, 'guardian_pending'), 1)
    assert.lengthOf(await notificationsOf(pedro.student.user.id, 'guardian_pending'), 1)
    assert.include(
      await notificationTitles(admin.id, 'guardian_pending'),
      'Vínculo de responsável aguardando aprovação'
    )
    const suspend = await AuditLog.query()
      .where('action', 'guardian_link.suspend')
      .where('entityId', link.id)
      .first()
    assert.isNotNull(suspend)

    // A secretaria aprova: volta o acesso. Já aprovado, marcar de novo não suspende.
    await expectStatus(
      client.post(`${API}/guardian-links/${link.id}/approve`).bearerToken(adminToken),
      200
    )
    await expectStatus(
      client.get(`${API}/events/${exam.id}`).bearerToken(pedro.guardian.token),
      200
    )
    for (const isMinor of [false, true]) {
      await expectStatus(
        client
          .patch(`${API}/users/${pedro.student.user.id}`)
          .bearerToken(adminToken)
          .json({ isMinor }),
        200
      )
    }
    await link.refresh()
    assert.equal(link.status, 'active')

    // Matrícula em curso integrado também marca menor e suspende o vínculo sem aprovação.
    const lia = await linkedStudent('lia@agenda.test', 'Lia', 'mae.lia@agenda.test')
    await expectStatus(
      client
        .post(`${API}/classes/${inf.id}/students`)
        .bearerToken(adminToken)
        .json({ emails: ['lia@agenda.test'] }),
      200
    )
    const liaAccount = await User.findOrFail(lia.student.user.id)
    assert.isTrue(liaAccount.isMinor)
    const liaLink = await GuardianLink.findOrFail(lia.link.id)
    assert.equal(liaLink.status, 'pending')

    // Desfeito antes de virar menor: o Desfazer devolve pendente, não ativo.
    const rui = await linkedStudent('rui@agenda.test', 'Rui', 'resp.rui@agenda.test')
    await expectStatus(
      client.delete(`${API}/guardian-links/${rui.link.id}`).bearerToken(rui.student.token),
      200
    )
    await expectStatus(
      client
        .patch(`${API}/users/${rui.student.user.id}`)
        .bearerToken(adminToken)
        .json({ isMinor: true }),
      200
    )
    const back = await client
      .post(`${API}/guardian-links/${rui.link.id}/restore`)
      .bearerToken(rui.student.token)
    back.assertStatus(200)
    assert.equal((back.body() as unknown as Envelope<Summary>).data.status, 'pending')
  })

  test('perfil do responsável não fica sem nome; o do aluno continua como antes', async ({
    client,
    assert,
  }) => {
    const { maria, diogo } = await demo()
    const mariaToken = await loginAs(client, maria.email)
    for (const fullName of [null, '   ']) {
      const response = await client
        .put(`${API}/account/profile`)
        .bearerToken(mariaToken)
        .json({ fullName })
      response.assertStatus(422)
      assert.deepEqual(fieldOf(response.body()), ['fullName'])
    }
    await maria.refresh()
    assert.equal(maria.fullName, 'Maria Queiroz')
    await expectStatus(
      client.put(`${API}/account/profile`).bearerToken(mariaToken).json({ fullName: 'Maria Q.' }),
      200
    )
    await expectStatus(
      client
        .put(`${API}/account/profile`)
        .bearerToken(await loginAs(client, diogo.email))
        .json({ fullName: null }),
      200
    )
  })

  test('seed duas vezes seguidas: vínculos e avisos da fase 2 não duplicam nem voltam atrás', async ({
    client,
    assert,
  }) => {
    const { mariaLink } = await demo()
    // Um vínculo mudado na demonstração continua mudado depois do seed.
    await expectStatus(
      client
        .delete(`${API}/guardian-links/${mariaLink.id}`)
        .bearerToken(await loginAs(client, 'maria@agenda.test')),
      200
    )
    const count = async () => {
      const [links, notifications, guardians] = await Promise.all([
        GuardianLink.query(),
        Notification.query(),
        User.query().where('role', 'guardian'),
      ])
      return {
        links: links.length,
        notifications: notifications.length,
        guardians: guardians.length,
      }
    }
    const before = await count()

    await new DemoSeeder(db.connection()).run()
    await new DemoSeeder(db.connection()).run()

    assert.deepEqual(await count(), before)
    await mariaLink.refresh()
    assert.equal(mariaLink.status, 'revoked')
  })
})
