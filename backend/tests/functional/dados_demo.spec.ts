import DemoSeeder from '#database/seeders/demo_datum_seeder'
import SchoolSeeder, { ESCOLA_DEMO_MARKER } from '#database/seeders/escola_demo_seeder'
import AcademicEvent from '#models/academic_event'
import CalendarImport from '#models/calendar_import'
import Grade from '#models/grade'
import Notification from '#models/notification'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/**
 * Dados de demonstração de 23/11/2026: as contas dos atalhos sem nome de gente do grupo
 * (aluno@ e responsavel@), a escola completa de `escola_demo_seeder.ts` (que os outros testes
 * não carregam) e a troca das contas antigas num banco que já tinha a demonstração.
 */

type Envelope<T> = { data: T }

const API = '/api/v1'
const TABLES = [
  'users',
  'academic_classes',
  'subjects',
  'class_subjects',
  'teaching_assignments',
  'enrollments',
  'class_invites',
  'guardian_links',
  'academic_events',
  'grades',
  'grade_changes',
  'grade_imports',
  'notifications',
  'reminders',
  'calendar_imports',
]

async function countRows() {
  const counts: Record<string, number> = {}
  for (const table of TABLES) {
    const [row] = await db.from(table).count('* as total')
    counts[table] = Number(row.total)
  }
  return counts
}

async function loginAs(client: any, email: string) {
  const response = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as Envelope<{ token: string }>).data.token
}

test.group('Dados de demonstração', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('escola completa: a mãe acompanha os três filhos e rodar de novo não duplica', async ({
    client,
    assert,
  }) => {
    await new SchoolSeeder(db.connection()).run()
    const before = await countRows()
    assert.isAbove(before.users, 50)
    assert.isAbove(before.academic_events, 30)

    await new DemoSeeder(db.connection()).run()
    await new SchoolSeeder(db.connection()).run()
    assert.deepEqual(await countRows(), before)

    const token = await loginAs(client, 'responsavel@agenda.test')
    const context = await client.get(`${API}/context`).bearerToken(token)
    context.assertStatus(200)
    const kids = (
      context.body() as unknown as Envelope<{
        linkedStudents: { fullName: string; status: string; classes: { name: string }[] }[]
      }>
    ).data.linkedStudents
    assert.sameDeepMembers(
      kids.map((kid) => ({
        name: kid.fullName,
        status: kid.status,
        classes: kid.classes.map((c) => c.name),
      })),
      [
        { name: 'Lucas Ferreira', status: 'active', classes: ['TADS 5'] },
        { name: 'Sofia Ferreira', status: 'active', classes: ['INF 3A'] },
        { name: 'Pedro Ferreira', status: 'active', classes: ['INF 1A'] },
      ]
    )

    // A filha menor de idade: a mãe vê as notas publicadas dela
    const sofia = await User.findByOrFail('email', ESCOLA_DEMO_MARKER)
    assert.isTrue(sofia.isMinor)
    const grades = await client.get(`${API}/students/${sofia.id}/grades`).bearerToken(token)
    grades.assertStatus(200)
    assert.include(JSON.stringify(grades.body()), 'Prova 1 de Lógica de Programação')

    // Uma prova que já passou sem nota lançada, para a docente lançar na demonstração
    const uml = await AcademicEvent.findByOrFail('title', 'Avaliação de UML')
    assert.isBelow(uml.startsAt.toMillis(), DateTime.now().toMillis())
    assert.isNull(uml.gradesPublishedAt)
    assert.lengthOf(await Grade.query().where('academicEventId', uml.id), 0)

    // Pedidos de entrada esperando e um vínculo esperando a secretaria
    const [pending] = await db.from('enrollments').where('status', 'pending').count('* as total')
    assert.isAtLeast(Number(pending.total), 3)
    const [waiting] = await db.from('guardian_links').where('status', 'pending').count('* as total')
    assert.equal(Number(waiting.total), 1)

    // O Calendário Acadêmico 2026 de verdade, uma importação só, sem as datas só de servidores
    const imports = await CalendarImport.query().where(
      'sourceName',
      'Calendário Acadêmico 2026, Campus Três Lagoas'
    )
    assert.lengthOf(imports, 1)
    const dates = await AcademicEvent.query().where('calendarImportId', imports[0].id)
    assert.equal(dates.length, imports[0].totalEvents)
    const titles = dates.map((event) => event.title)
    assert.include(titles, 'Término das aulas do 2º semestre letivo de 2026')
    assert.notInclude(titles, 'Fechamento de diários, notas e relatórios')
    const christmas = dates.find((event) => event.title === 'Natal')!
    assert.equal(christmas.category, 'holiday')
    assert.equal(christmas.startsAt.setZone('America/Campo_Grande').toISODate(), '2026-12-25')
    // intervalo de 07 a 11/12: o último dia vale inteiro, como na importação pela tela
    const shift = dates.find(
      (event) =>
        event.title.startsWith('Período para solicitação de mudança') &&
        event.startsAt.setZone('America/Campo_Grande').toISODate() === '2026-12-07'
    )
    assert.equal(
      shift?.endsAt?.setZone('America/Campo_Grande').toFormat('yyyy-MM-dd HH:mm'),
      '2026-12-11 23:59'
    )
    assert.isTrue(dates.every((event) => event.source === 'imported' && !event.academicClassId))
  })

  test('banco antigo: diogo@ e maria@ viram aluno@ e responsavel@ sem perder id nem avisos', async ({
    assert,
  }) => {
    const lucas = await User.findByOrFail('email', 'aluno@agenda.test')
    const juliana = await User.findByOrFail('email', 'responsavel@agenda.test')
    // Como a demonstração estava até 23/11/2026
    lucas.merge({ email: 'diogo@agenda.test', fullName: 'Diogo Queiroz da Silva' })
    await lucas.save()
    juliana.merge({ email: 'maria@agenda.test', fullName: 'Maria Queiroz' })
    await juliana.save()
    const linked = await Notification.query()
      .where({ userId: lucas.id, kind: 'guardian_linked' })
      .firstOrFail()
    linked.title = 'Maria Queiroz agora acompanha sua agenda'
    await linked.save()
    const gradeNotice = await Notification.create({
      userId: juliana.id,
      kind: 'grades_published',
      title: 'Nota de Diogo publicada: Prova 1 de Matemática',
      body: 'Matemática. Veja na tela Notas.',
      link: '?tela=notas',
    })
    const before = await countRows()

    await new DemoSeeder(db.connection()).run()

    assert.deepEqual(await countRows(), before)
    await lucas.refresh()
    await juliana.refresh()
    assert.equal(lucas.email, 'aluno@agenda.test')
    assert.equal(lucas.fullName, 'Lucas Ferreira')
    assert.equal(juliana.email, 'responsavel@agenda.test')
    assert.equal(juliana.fullName, 'Juliana Ferreira')
    await linked.refresh()
    assert.equal(linked.title, 'Juliana Ferreira agora acompanha sua agenda')
    await gradeNotice.refresh()
    assert.equal(gradeNotice.title, 'Nota de Lucas publicada: Prova 1 de Matemática')
    assert.isNull(await User.findBy('email', 'diogo@agenda.test'))
  })
})
