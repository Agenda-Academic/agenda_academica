import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import CalendarImport from '#models/calendar_import'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import BundledCalendarsService from '#services/bundled_calendars_service'
import GoogleOAuthService from '#services/google_oauth_service'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

/**
 * Preparação da produção (2026-11-23): a coordenação vincula a docente pelo e-mail antes do
 * primeiro acesso dela, e o banco novo nasce com os Calendários Acadêmicos do campus.
 */

type Envelope<T> = { data: T }
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }

const API = '/api/v1'

async function loginAs(client: any, email: string) {
  const response = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as Envelope<{ token: string }>).data.token
}

test.group('Preparação da produção', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a coordenação vincula a docente pelo e-mail antes do 1º acesso; o Google entra na conta', async ({
    client,
    assert,
  }) => {
    const tads = await AcademicClass.findByOrFail('name', 'TADS 5')
    const databases = await Subject.findByOrFail('code', 'BD-401')
    const admin = await loginAs(client, 'admin@agenda.test')
    const route = `${API}/classes/${tads.id}/subjects/${databases.id}/teachers`

    const linked = await client
      .post(route)
      .bearerToken(admin)
      .json({ email: '  Professora.Real@IFMS.edu.br ' })
    linked.assertStatus(201)
    const teacher = await User.findByOrFail('email', 'professora.real@ifms.edu.br')
    assert.equal(teacher.role, 'teacher')
    assert.equal(teacher.fullName, 'Professora Real')
    assert.isNull(teacher.emailVerifiedAt)
    const assignment = await TeachingAssignment.query()
      .where({ teacherId: teacher.id, academicClassId: tads.id, subjectId: databases.id })
      .firstOrFail()
    assert.isNull(assignment.endedAt)

    // O primeiro login com o Google entra nesta conta (não cria outra), confere o e-mail e traz o
    // nome de verdade; ela já encontra a turma
    const signedIn = await GoogleOAuthService.findOrCreateUser({
      email: 'professora.real@ifms.edu.br',
      name: 'Maria Real da Silva',
      hd: 'ifms.edu.br',
    })
    assert.equal(signedIn?.id, teacher.id)
    await teacher.refresh()
    assert.isNotNull(teacher.emailVerifiedAt)
    assert.equal(teacher.fullName, 'Maria Real da Silva')
    assert.equal(teacher.role, 'teacher')

    // Vincular de novo a mesma pessoa pelo e-mail: já está vinculada
    const again = await client
      .post(route)
      .bearerToken(admin)
      .json({ email: 'professora.real@ifms.edu.br' })
    again.assertStatus(422)
  })

  test('pelo e-mail: só servidor da instituição; conta de outro papel não vira docente', async ({
    client,
    assert,
  }) => {
    const tads = await AcademicClass.findByOrFail('name', 'TADS 5')
    const databases = await Subject.findByOrFail('code', 'BD-401')
    const admin = await loginAs(client, 'admin@agenda.test')
    const route = `${API}/classes/${tads.id}/subjects/${databases.id}/teachers`
    const users = await User.query().count('* as total')

    for (const [email, rule] of [
      ['docente@gmail.com', 'institution'],
      ['aluno.novo@estudante.ifms.edu.br', 'institution'],
      ['aluno@agenda.test', 'email'],
    ] as const) {
      const response = await client.post(route).bearerToken(admin).json({ email })
      response.assertStatus(422)
      const [error] = (response.body() as unknown as FieldErrors).errors
      assert.equal(error.field, 'email', email)
      if (rule === 'institution') assert.equal(error.rule, 'institution', email)
    }
    const missing = await client.post(route).bearerToken(admin).json({})
    missing.assertStatus(422)
    const after = await User.query().count('* as total')
    assert.equal(after[0].$extras.total, users[0].$extras.total, 'nenhuma conta nova')

    // A docente não vincula ninguém (nem pelo e-mail)
    const teacher = await client
      .post(route)
      .bearerToken(await loginAs(client, 'maraisa@agenda.test'))
      .json({ email: 'outra.docente@ifms.edu.br' })
    teacher.assertStatus(403)
    assert.isNull(await User.findBy('email', 'outra.docente@ifms.edu.br'))
  })

  test('banco novo: os Calendários Acadêmicos 2026 e 2027 entram uma vez só', async ({
    assert,
  }) => {
    const imported = await BundledCalendarsService.importMissing()
    assert.sameMembers(imported, [
      'Calendário Acadêmico 2026, Campus Três Lagoas',
      'Calendário Acadêmico 2027, Campus Três Lagoas',
    ])
    const events = await AcademicEvent.query().whereNotNull('calendarImportId').count('* as total')
    assert.isAbove(Number(events[0].$extras.total), 200)

    // De novo (cada início da API): nada novo, nem duplicado
    assert.deepEqual(await BundledCalendarsService.importMissing(), [])
    assert.lengthOf(await CalendarImport.all(), 2)

    // Uma importação desfeita pela tela não volta sozinha
    const first = await CalendarImport.query().orderBy('id').firstOrFail()
    await AcademicEvent.query().where('calendarImportId', first.id).delete()
    assert.deepEqual(await BundledCalendarsService.importMissing(), [])
  })
})
