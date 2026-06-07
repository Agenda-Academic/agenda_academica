import { test } from '@japa/runner'

type ApiEnvelope<T> = {
  data: T
}

async function loginAs(client: any, email: string) {
  const response = await client.post('/api/v1/auth/login').json({
    email,
    password: 'password123',
  })

  response.assertStatus(200)
  return (response.body() as ApiEnvelope<{ token: string }>).data.token
}

test.group('Academic API', () => {
  test('student can see own academic timeline and dashboard', async ({ client, assert }) => {
    const token = await loginAs(client, 'jonathan@agenda.test')

    const events = await client
      .get('/api/v1/events')
      .bearerToken(token)
      .qs({ category: 'exam,assignment' })

    events.assertStatus(200)
    assert.isAtLeast((events.body() as ApiEnvelope<unknown[]>).data.length, 2)

    const dashboard = await client.get('/api/v1/dashboard').bearerToken(token)
    dashboard.assertStatus(200)
    assert.isAtLeast(
      (dashboard.body() as ApiEnvelope<{ upcoming: unknown[] }>).data.upcoming.length,
      1
    )
  })

  test('student cannot create academic events', async ({ client }) => {
    const token = await loginAs(client, 'jonathan@agenda.test')

    const response = await client.post('/api/v1/events').bearerToken(token).json({
      title: 'Prova indevida',
      category: 'exam',
      startsAt: '2026-06-20T19:00',
      academicClassId: 1,
      subjectId: 1,
    })

    response.assertStatus(403)
  })

  test('teacher can create event for assigned class and student can create reminder', async ({
    client,
    assert,
  }) => {
    const teacherToken = await loginAs(client, 'apio@agenda.test')

    const created = await client.post('/api/v1/events').bearerToken(teacherToken).json({
      title: 'Seminario de requisitos',
      description: 'Apresentacao curta em grupos.',
      category: 'activity',
      startsAt: '2026-06-25T19:00',
      academicClassId: 1,
      subjectId: 3,
      points: 2,
    })

    created.assertStatus(201)
    const createdBody = created.body() as ApiEnvelope<{ id: number; title: string }>
    assert.equal(createdBody.data.title, 'Seminario de requisitos')

    const studentToken = await loginAs(client, 'jonathan@agenda.test')
    const reminder = await client.post('/api/v1/reminders').bearerToken(studentToken).json({
      academicEventId: createdBody.data.id,
      channel: 'email',
      offsetMinutes: 1440,
    })

    reminder.assertStatus(201)
    assert.equal(
      (reminder.body() as ApiEnvelope<{ academicEventId: number }>).data.academicEventId,
      createdBody.data.id
    )
  })

  test('admin can import official calendar events', async ({ client, assert }) => {
    const token = await loginAs(client, 'admin@agenda.test')

    const response = await client
      .post('/api/v1/calendar-imports')
      .bearerToken(token)
      .json({
        sourceName: 'Calendario oficial teste',
        events: [
          {
            title: 'Data magna institucional',
            category: 'institutional',
            startsAt: '2026-07-01T08:00',
          },
        ],
      })

    response.assertStatus(201)
    assert.equal(
      (response.body() as unknown as ApiEnvelope<{ events: { officialPriority: boolean }[] }>).data
        .events[0]?.officialPriority,
      true
    )
  })
})
