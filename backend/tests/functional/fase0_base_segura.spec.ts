import DemoSeeder from '#database/seeders/demo_datum_seeder'
import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

type Envelope<T> = { data: T }

async function loginAs(client: any, email: string) {
  const response = await client.post('/api/v1/auth/login').json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as unknown as Envelope<{ token: string }>).data.token
}

async function createAccount(client: any, email: string, role: string) {
  await User.create({ fullName: 'Conta de Teste', email, password: 'password123', role })
  return loginAs(client, email)
}

const SEEDED_TABLES = [
  'users',
  'courses',
  'academic_classes',
  'subjects',
  'enrollments',
  'teaching_assignments',
  'academic_events',
  'class_subjects',
]

async function countRows() {
  const counts: Record<string, number> = {}
  for (const table of SEEDED_TABLES) {
    const [row] = await db.from(table).count('* as total')
    counts[table] = Number(row.total)
  }
  return counts
}

test.group('Fase 0: base segura', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('docente aparece só com id e nome em eventos, painel e lembretes', async ({
    client,
    assert,
  }) => {
    const token = await loginAs(client, 'diogo@agenda.test')

    const events = await client.get('/api/v1/events').bearerToken(token)
    events.assertStatus(200)
    const withTeacher = (
      events.body() as unknown as Envelope<{ id: number; teacher: object | null }[]>
    ).data.filter((event) => event.teacher)
    assert.isAtLeast(withTeacher.length, 1)
    for (const event of withTeacher) {
      assert.sameMembers(Object.keys(event.teacher!), ['id', 'fullName'])
    }

    const show = await client.get(`/api/v1/events/${withTeacher[0].id}`).bearerToken(token)
    show.assertStatus(200)
    assert.sameMembers(
      Object.keys((show.body() as unknown as Envelope<{ teacher: object }>).data.teacher),
      ['id', 'fullName']
    )

    const dashboard = await client.get('/api/v1/dashboard').bearerToken(token)
    dashboard.assertStatus(200)
    for (const event of (
      dashboard.body() as unknown as Envelope<{ upcoming: { teacher: object | null }[] }>
    ).data.upcoming) {
      if (event.teacher) {
        assert.sameMembers(Object.keys(event.teacher), ['id', 'fullName'])
      }
    }

    await client
      .post('/api/v1/reminders')
      .bearerToken(token)
      .json({ academicEventId: withTeacher[0].id, offsetMinutes: 60 })
      .then((response: any) => response.assertStatus(201))
    const reminders = await client.get('/api/v1/reminders').bearerToken(token)
    reminders.assertStatus(200)
    const teacher = (
      reminders.body() as unknown as Envelope<{ academicEvent: { teacher: object | null } }[]>
    ).data.find((reminder) => reminder.academicEvent.teacher)?.academicEvent.teacher
    assert.sameMembers(Object.keys(teacher!), ['id', 'fullName'])
  })

  test('papel desconhecido é negado na agenda', async ({ client }) => {
    const token = await createAccount(client, 'visitante@agenda.test', 'visitor')

    const events = await client.get('/api/v1/events').bearerToken(token)
    events.assertStatus(403)
    const dashboard = await client.get('/api/v1/dashboard').bearerToken(token)
    dashboard.assertStatus(403)

    const event = await AcademicEvent.query().orderBy('id').firstOrFail()
    const show = await client.get(`/api/v1/events/${event.id}`).bearerToken(token)
    show.assertStatus(403)

    const create = await client.post('/api/v1/events').bearerToken(token).json({
      title: 'Evento indevido',
      category: 'activity',
      startsAt: '2026-12-01T19:00',
    })
    create.assertStatus(403)
  })

  test('só docente e administração criam evento: responsável recebe 403', async ({ client }) => {
    const token = await createAccount(client, 'responsavel@agenda.test', 'guardian')
    const tads = await AcademicClass.findByOrFail('name', 'TADS 5')

    const response = await client.post('/api/v1/events').bearerToken(token).json({
      title: 'Evento indevido',
      category: 'activity',
      startsAt: '2026-12-01T19:00',
      academicClassId: tads.id,
    })
    response.assertStatus(403)
  })

  test('docente com a oferta encerrada não edita o próprio evento', async ({ client, assert }) => {
    const maraisa = await User.findByOrFail('email', 'maraisa@agenda.test')
    const math = await Subject.findByOrFail('code', 'MAT-401')
    const event = await AcademicEvent.query()
      .where('teacherId', maraisa.id)
      .where('subjectId', math.id)
      .firstOrFail()

    const assignment = await TeachingAssignment.query()
      .where('teacherId', maraisa.id)
      .where('subjectId', math.id)
      .firstOrFail()
    assignment.endedAt = DateTime.now()
    await assignment.save()

    const token = await loginAs(client, 'maraisa@agenda.test')
    const update = await client
      .put(`/api/v1/events/${event.id}`)
      .bearerToken(token)
      .json({ title: 'Prova de Matemática remarcada' })
    update.assertStatus(403)

    const destroy = await client.delete(`/api/v1/events/${event.id}`).bearerToken(token)
    destroy.assertStatus(403)
    assert.isNotNull(await AcademicEvent.find(event.id))

    // O vínculo encerrado sai do contexto, que alimenta o seletor de turma do evento.
    const context = await client.get('/api/v1/context').bearerToken(token)
    context.assertStatus(200)
    const assignments = (
      context.body() as unknown as Envelope<{ teachingAssignments: { subjectId: number }[] }>
    ).data.teachingAssignments
    assert.notInclude(
      assignments.map((item) => item.subjectId),
      math.id
    )
  })

  test('seeder idempotente: rodar de novo não duplica nem muda ids', async ({ assert }) => {
    const before = await countRows()
    const tadsBefore = await AcademicClass.findByOrFail('name', 'TADS 5')

    await new DemoSeeder(db.connection()).run()
    await new DemoSeeder(db.connection()).run()

    assert.deepEqual(await countRows(), before)
    const tadsAfter = await AcademicClass.findByOrFail('name', 'TADS 5')
    assert.equal(tadsAfter.id, tadsBefore.id)
    // Ids usados pelo academic_api.spec.ts.
    assert.equal(tadsAfter.id, 1)
    const math = await Subject.findByOrFail('code', 'MAT-401')
    const softwareEngineering = await Subject.findByOrFail('code', 'ES-401')
    assert.equal(math.id, 1)
    assert.equal(softwareEngineering.id, 3)
  })
})
