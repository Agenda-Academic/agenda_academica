import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import Subject from '#models/subject'
import User from '#models/user'
import AttemptLimiterService from '#services/attempt_limiter_service'
import { parseScore } from '#services/grade_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/**
 * Correções da rodada de testes de 16/11/2026: e-mail sem diferenciar maiúsculas, limite de
 * tentativas no login, quem vê e quem mexe nos eventos, pontuação e datas do evento e a
 * importação do calendário (sem repetir e com desfazer de uma vez).
 */

type Envelope<T> = { data: T }
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }

const API = '/api/v1'

async function loginAs(client: any, email: string, password = 'password123') {
  const response = await client.post(`${API}/auth/login`).json({ email, password })
  response.assertStatus(200)
  return (response.body() as Envelope<{ token: string }>).data.token
}

function fieldsOf(response: any) {
  return ((response.body() as FieldErrors).errors ?? []).map((error) => error.field)
}

async function demo() {
  const [tads, inf, math, logic] = await Promise.all([
    AcademicClass.findByOrFail('name', 'TADS 5'),
    AcademicClass.findByOrFail('name', 'INF 3A'),
    Subject.findByOrFail('code', 'MAT-401'),
    Subject.findByOrFail('code', 'LP-101'),
  ])
  return { tads, inf, math, logic }
}

test.group('Correções da rodada de testes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    AttemptLimiterService.clear()
    return () => AttemptLimiterService.clear()
  })

  test('e-mail sem diferenciar maiúsculas no login e no cadastro', async ({ client, assert }) => {
    await loginAs(client, ' Diogo@Agenda.TEST ')

    const repeated = await client.post(`${API}/auth/signup`).json({
      fullName: 'Outra pessoa',
      email: 'DIOGO@agenda.test',
      password: 'password123',
      passwordConfirmation: 'password123',
    })
    repeated.assertStatus(422)
    assert.deepEqual(fieldsOf(repeated), ['email'])

    const created = await client.post(`${API}/auth/signup`).json({
      fullName: 'Pai Novo',
      email: 'Pai.Novo@Gmail.com',
      password: 'password123',
      passwordConfirmation: 'password123',
    })
    created.assertStatus(200)
    const account = await User.findByOrFail('email', 'pai.novo@gmail.com')
    assert.equal(account.role, 'guardian')
    assert.isNull(account.emailVerifiedAt)
    await loginAs(client, 'PAI.NOVO@gmail.com')
  })

  test('login trava o e-mail depois de 10 senhas erradas', async ({ client, assert }) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const wrong = await client
        .post(`${API}/auth/login`)
        .json({ email: 'diogo@agenda.test', password: 'senha-errada' })
      wrong.assertStatus(400)
    }

    const blocked = await client
      .post(`${API}/auth/login`)
      .json({ email: 'diogo@agenda.test', password: 'password123' })
    blocked.assertStatus(429)
    assert.equal((blocked.body() as unknown as { code: string }).code, 'TOO_MANY_ATTEMPTS')
    assert.isAbove(Number(blocked.header('retry-after')), 0)

    // outra conta, do mesmo IP, continua entrando
    await loginAs(client, 'maraisa@agenda.test')
  })

  test('evento de turma criado pela administração fica só na turma; a docente da disciplina edita', async ({
    client,
    assert,
  }) => {
    const { inf, logic } = await demo()
    const admin = await loginAs(client, 'admin@agenda.test')
    const created = await client.post(`${API}/events`).bearerToken(admin).json({
      title: 'Prova de Lógica',
      category: 'exam',
      startsAt: '2026-12-10T19:00:00-03:00',
      points: 10,
      academicClassId: inf.id,
      subjectId: logic.id,
    })
    created.assertStatus(201)
    const event = (created.body() as Envelope<{ id: number; source: string }>).data
    assert.equal(event.source, 'teacher')

    // aluno de outra turma não vê
    const diogo = await loginAs(client, 'diogo@agenda.test')
    const list = await client.get(`${API}/events`).bearerToken(diogo)
    list.assertStatus(200)
    const ids = (list.body() as Envelope<{ id: number }[]>).data.map((item) => item.id)
    assert.notInclude(ids, event.id)
    const direct = await client.get(`${API}/events/${event.id}`).bearerToken(diogo)
    direct.assertStatus(403)

    // a docente de Lógica na INF 3A edita
    const marina = await loginAs(client, 'marina@agenda.test')
    const edited = await client
      .put(`${API}/events/${event.id}`)
      .bearerToken(marina)
      .json({ title: 'Prova de Lógica, parte 1' })
    edited.assertStatus(200)
  })

  test('docente não cria evento sem disciplina e não mexe no evento sem disciplina de outra', async ({
    client,
    assert,
  }) => {
    const { tads, math } = await demo()
    const maraisa = await loginAs(client, 'maraisa@agenda.test')
    const marina = await loginAs(client, 'marina@agenda.test')

    const withoutSubject = await client.post(`${API}/events`).bearerToken(maraisa).json({
      title: 'Prova sem disciplina',
      category: 'exam',
      startsAt: '2026-12-10T19:00:00-03:00',
      academicClassId: tads.id,
    })
    withoutSubject.assertStatus(422)
    assert.deepEqual(fieldsOf(withoutSubject), ['subjectId'])

    const own = await client.post(`${API}/events`).bearerToken(maraisa).json({
      title: 'Prova de Matemática 2',
      category: 'exam',
      startsAt: '2026-12-10T19:00:00-03:00',
      academicClassId: tads.id,
      subjectId: math.id,
    })
    own.assertStatus(201)
    const ownId = (own.body() as Envelope<{ id: number }>).data.id
    const dropSubject = await client
      .put(`${API}/events/${ownId}`)
      .bearerToken(maraisa)
      .json({ subjectId: null })
    dropSubject.assertStatus(422)

    // evento antigo da Maraísa, da turma e sem disciplina: só ela mexe
    const maraisaUser = await User.findByOrFail('email', 'maraisa@agenda.test')
    const legacy = await AcademicEvent.create({
      title: 'Trabalho antigo',
      category: 'assignment',
      source: 'teacher',
      status: 'scheduled',
      startsAt: DateTime.fromISO('2026-12-11T22:00:00Z'),
      academicClassId: tads.id,
      subjectId: null,
      teacherId: maraisaUser.id,
      createdById: maraisaUser.id,
      officialPriority: false,
    })
    const takeOver = await client
      .put(`${API}/events/${legacy.id}`)
      .bearerToken(marina)
      .json({ title: 'Agora é meu' })
    takeOver.assertStatus(403)
    const remove = await client.delete(`${API}/events/${legacy.id}`).bearerToken(marina)
    remove.assertStatus(403)
    const byAuthor = await client
      .put(`${API}/events/${legacy.id}`)
      .bearerToken(maraisa)
      .json({ title: 'Trabalho antigo revisado' })
    byAuthor.assertStatus(200)
  })

  test('pontuação de 0 a 100 em meio ponto, e datas coerentes', async ({ client, assert }) => {
    const { tads, math } = await demo()
    const maraisa = await loginAs(client, 'maraisa@agenda.test')
    const base = {
      title: 'Prova de pontos',
      category: 'exam',
      startsAt: '2026-12-10T19:00:00-03:00',
      academicClassId: tads.id,
      subjectId: math.id,
    }

    for (const points of [1000, 100.5, 7.555, -5]) {
      const response = await client
        .post(`${API}/events`)
        .bearerToken(maraisa)
        .json({ ...base, points })
      response.assertStatus(422)
      assert.deepEqual(fieldsOf(response), ['points'])
    }
    for (const points of [100, 2.5, 0]) {
      const response = await client
        .post(`${API}/events`)
        .bearerToken(maraisa)
        .json({ ...base, points })
      response.assertStatus(201)
    }

    const backwards = await client
      .post(`${API}/events`)
      .bearerToken(maraisa)
      .json({ ...base, endsAt: '2026-12-10T18:00:00-03:00' })
    backwards.assertStatus(422)
    assert.deepEqual(fieldsOf(backwards), ['endsAt'])

    const ancient = await client
      .post(`${API}/events`)
      .bearerToken(maraisa)
      .json({ ...base, startsAt: '1900-01-01T10:00:00-03:00' })
    ancient.assertStatus(422)
    assert.deepEqual(fieldsOf(ancient), ['startsAt'])
  })

  test('calendário: importar de novo não repete, e desfazer tira as datas de uma vez', async ({
    client,
    assert,
  }) => {
    const admin = await loginAs(client, 'admin@agenda.test')
    const events = [
      { title: 'Feriado de teste', category: 'holiday', startsAt: '2027-05-03' },
      { title: 'Semana de teste', category: 'institutional', startsAt: '2027-05-10' },
    ]

    const first = await client
      .post(`${API}/calendar-imports`)
      .bearerToken(admin)
      .json({ sourceName: 'Calendário de teste', events })
    first.assertStatus(201)
    const firstData = (first.body() as Envelope<{ import: { id: number }; events: unknown[] }>).data
    assert.lengthOf(firstData.events, 2)

    const again = await client
      .post(`${API}/calendar-imports`)
      .bearerToken(admin)
      .json({ sourceName: 'Calendário de teste', events })
    again.assertStatus(409)
    assert.equal((again.body() as unknown as { code: string }).code, 'ALREADY_IMPORTED')

    const partly = await client
      .post(`${API}/calendar-imports`)
      .bearerToken(admin)
      .json({
        sourceName: 'Calendário de teste',
        events: [
          { title: '  FERIADO de teste ', category: 'holiday', startsAt: '2027-05-03' },
          { title: 'Data nova', category: 'institutional', startsAt: '2027-05-20' },
        ],
      })
    partly.assertStatus(201)
    assert.lengthOf((partly.body() as Envelope<{ events: unknown[] }>).data.events, 1)

    const teacher = await loginAs(client, 'maraisa@agenda.test')
    const denied = await client
      .delete(`${API}/calendar-imports/${firstData.import.id}/events`)
      .bearerToken(teacher)
    denied.assertStatus(403)

    const undo = await client
      .delete(`${API}/calendar-imports/${firstData.import.id}/events`)
      .bearerToken(admin)
    undo.assertStatus(200)
    assert.deepEqual((undo.body() as Envelope<{ removed: number }>).data, { removed: 2 })
    const left = await AcademicEvent.query().where('calendarImportId', firstData.import.id)
    assert.lengthOf(left, 0)
  })

  test('"-" do Moodle conta como nota em branco, nunca como zero', async ({ assert }) => {
    const dash = parseScore('-', 1000)
    assert.isFalse(dash.ok)
    if (!dash.ok) {
      assert.include(dash.message, 'em branco')
    }
    assert.deepEqual(parseScore('0', 1000), { ok: true, score: 0 })
  })
})
