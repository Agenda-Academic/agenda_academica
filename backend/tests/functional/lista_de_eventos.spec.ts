import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

/**
 * A lista de eventos (`GET /events`) vai inteira para a tela e todas as telas leem dela, então ela
 * não pode carregar o que ninguém lê. O teste de capacidade de 22/11/2026 (1.369 eventos) mostrou
 * a administração baixando 1,6 MB por carga, com a turma e o curso aninhados em cada evento.
 */

type Listed = {
  id: number
  academicClassId: number | null
  academicClass?: Record<string, unknown> | null
  subject?: Record<string, unknown> | null
  teacher?: Record<string, unknown> | null
}

async function loginAs(client: any, email: string) {
  const response = await client.post('/api/v1/auth/login').json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as { data: { token: string } }).data.token
}

test.group('Lista de eventos enxuta', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('a turma e a disciplina de cada evento trazem só o que a tela lê', async ({
    client,
    assert,
  }) => {
    for (const email of ['diogo@agenda.test', 'maraisa@agenda.test', 'admin@agenda.test']) {
      const token = await loginAs(client, email)
      const response = await client.get('/api/v1/events').bearerToken(token)
      response.assertStatus(200)
      const events = (response.body() as { data: Listed[] }).data

      const withClass = events.filter((event) => event.academicClass)
      assert.isAbove(withClass.length, 0, `${email} deveria ver eventos de turma`)
      for (const event of withClass) {
        assert.sameMembers(
          Object.keys(event.academicClass!),
          ['id', 'courseId', 'name', 'period', 'year', 'semester', 'shift', 'active', 'archivedAt'],
          `turma do evento ${event.id} de ${email}`
        )
      }

      const withSubject = events.filter((event) => event.subject)
      assert.isAbove(withSubject.length, 0)
      for (const event of withSubject) {
        assert.sameMembers(
          Object.keys(event.subject!),
          ['id', 'code', 'name', 'active', 'archivedAt'],
          `disciplina do evento ${event.id} de ${email}`
        )
      }

      for (const event of events.filter((item) => item.teacher)) {
        assert.sameMembers(Object.keys(event.teacher!), ['id', 'fullName'])
      }
    }
  })

  test('o código de entrada da turma nunca aparece na lista', async ({ client, assert }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const response = await client.get('/api/v1/events').bearerToken(token)
    assert.notInclude(response.text(), 'joinCode')
  })

  test('o detalhe do evento continua com a turma completa, com o curso', async ({
    client,
    assert,
  }) => {
    const token = await loginAs(client, 'admin@agenda.test')
    const list = await client.get('/api/v1/events').bearerToken(token)
    const first = (list.body() as { data: Listed[] }).data.find((event) => event.academicClassId)
    assert.isDefined(first)

    const detail = await client.get(`/api/v1/events/${first!.id}`).bearerToken(token)
    detail.assertStatus(200)
    const turma = (detail.body() as { data: Listed }).data.academicClass as Record<string, unknown>
    assert.property(turma, 'course')
    assert.property(turma, 'createdAt')
  })

  test('o tamanho de cada evento na lista fica abaixo de 1 KB com a turma e a disciplina', async ({
    client,
    assert,
  }) => {
    const token = await loginAs(client, 'diogo@agenda.test')
    const response = await client.get('/api/v1/events').bearerToken(token)
    const events = (response.body() as { data: Listed[] }).data
    const withClass = events.filter((event) => event.academicClass && event.subject)
    assert.isAbove(withClass.length, 0)
    // a medida de antes era 1.376 bytes por evento; o limite é folgado, para um título longo não derrubar o teste
    const average =
      withClass.reduce((total, event) => total + JSON.stringify(event).length, 0) / withClass.length
    assert.isBelow(average, 1000)
  })
})
