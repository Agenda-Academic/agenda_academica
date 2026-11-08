import DemoSeeder from '#database/seeders/demo_datum_seeder'
import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import AuditLog from '#models/audit_log'
import Enrollment from '#models/enrollment'
import Grade from '#models/grade'
import GradeChange from '#models/grade_change'
import GradeImport from '#models/grade_import'
import GradeImportRow from '#models/grade_import_row'
import GuardianLink from '#models/guardian_link'
import Notification from '#models/notification'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import GradeService from '#services/grade_service'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

type Envelope<T> = { data: T }
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }
type PublicGrade = {
  score: number | null
  scoreText: string | null
  status: string
  source: { type: string; source?: string; importedAt?: string }
}
type Evaluation = {
  eventId: number
  title: string
  maxScore: number | null
  maxScoreText: string | null
  published: boolean
  grade: PublicGrade | null
}
type StudentReport = {
  student: { id: number; fullName: string }
  shareGrades: boolean
  counts: { published: number; awaiting: number } | null
  subjects: { subject: { id: number } | null; evaluations: Evaluation[] }[]
}
type ImportRowItem = {
  rowNumber: number
  kind: string
  message: string | null
  student: { id: number; fullName: string } | null
  score: number | null
  previousScore: number | null
}
type ImportDetail = {
  id: number
  status: string
  totals: { new: number; changed: number; same: number; newerInAgenda: number; rejected: number }
  breakdown?: Record<string, number>
  rows?: ImportRowItem[]
  canApply: boolean
  canDiscard: boolean
  canUndo: boolean
}
type StudentRow = {
  studentId: number
  enrollmentStatus: string | null
  registration?: string | null
  grade: { id: number; score: number | null; scoreText: string | null; status: string } | null
}
type EventGrades = {
  event: { id: number; maxScore: number | null; gradesPublishedAt: string | null }
  counts: { students: number; graded: number; absent: number; excused: number; missing: number }
  students: StudentRow[]
}

const API = '/api/v1'

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

function fieldOf(body: unknown) {
  return ((body as FieldErrors).errors ?? []).map((error) => error.field)
}

async function demo() {
  const [tads, inf, admin, maraisa, marina, diogo, ana, maria, carlos, math, dataStructures] =
    await Promise.all([
      AcademicClass.findByOrFail('name', 'TADS 5'),
      AcademicClass.findByOrFail('name', 'INF 3A'),
      User.findByOrFail('email', 'admin@agenda.test'),
      User.findByOrFail('email', 'maraisa@agenda.test'),
      User.findByOrFail('email', 'marina@agenda.test'),
      User.findByOrFail('email', 'diogo@agenda.test'),
      User.findByOrFail('email', 'ana@agenda.test'),
      User.findByOrFail('email', 'maria@agenda.test'),
      User.findByOrFail('email', 'carlos@agenda.test'),
      Subject.findByOrFail('code', 'MAT-401'),
      Subject.findByOrFail('code', 'ED-401'),
    ])
  const event = (title: string) =>
    AcademicEvent.query().where('title', title).where('academicClassId', tads.id).firstOrFail()
  const [mathExam, edExam, pastExam, pastAssignment, mariaLink] = await Promise.all([
    event('Prova de Matemática'),
    event('Prova de Estrutura de Dados'),
    event('Prova 1 de Matemática'),
    event('Trabalho de requisitos'),
    GuardianLink.query().where('guardianId', maria.id).where('studentId', diogo.id).firstOrFail(),
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
    math,
    dataStructures,
    mathExam,
    edExam,
    pastExam,
    pastAssignment,
    mariaLink,
  }
}

/** Conta de aluno com matrícula na turma (ativa por padrão). */
async function addStudent(
  academicClass: AcademicClass,
  email: string,
  fullName: string,
  status = 'active',
  registration: string | null = null
) {
  const user = await User.create({ fullName, email, password: 'password123', role: 'student' })
  await Enrollment.create({
    userId: user.id,
    academicClassId: academicClass.id,
    status,
    source: 'admin',
    registration,
  })
  return user
}

type Row = {
  rowNumber?: number
  identifier?: string | number | null
  name?: string
  score?: unknown
}

function importBody(eventId: number, rows: Row[], extra: Record<string, unknown> = {}) {
  return {
    academicEventId: eventId,
    source: 'modelo',
    fileName: 'notas.csv',
    checksum: 'c0ffee',
    mapping: {
      identifierType: 'email',
      identifierColumn: 'e-mail',
      scoreColumn: 'nota',
      nameColumn: 'nome',
    },
    rows,
    ...extra,
  }
}

async function createImport(client: any, token: string, body: object, status = 201) {
  const response = await client.post(`${API}/grade-imports`).bearerToken(token).json(body)
  response.assertStatus(status)
  return (response.body() as Envelope<ImportDetail>).data
}

async function scoreOf(eventId: number, studentId: number) {
  const grade = await Grade.query()
    .where('academicEventId', eventId)
    .where('studentId', studentId)
    .first()
  return grade ? grade.score : undefined
}

async function putGrade(
  client: any,
  token: string,
  eventId: number,
  studentId: number,
  body: object
) {
  return client.put(`${API}/events/${eventId}/grades/${studentId}`).bearerToken(token).json(body)
}

function evaluationsOf(body: unknown) {
  return (body as Envelope<StudentReport>).data.subjects.flatMap((group) => group.evaluations)
}

async function importStatus(id: number) {
  const gradeImport = await GradeImport.findOrFail(id)
  return gradeImport.status
}

async function gradeSnapshot() {
  const [grades, imports, changes] = await Promise.all([
    Grade.query().orderBy('id'),
    GradeImport.query().orderBy('id'),
    GradeChange.query().orderBy('id'),
  ])
  return {
    grades: grades.map((grade) => [grade.id, grade.score, grade.status]),
    imports: imports.map((item) => [item.id, item.status]),
    changes: changes.length,
  }
}

test.group('Fase 3: notas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('seed: prova e trabalho do Diogo com nota publicada; o aluno e a Maria veem só as publicadas', async ({
    client,
    assert,
  }) => {
    const { diogo, maria, mathExam, pastExam, pastAssignment } = await demo()
    assert.isNotNull(pastExam.gradesPublishedAt)
    assert.isNotNull(pastAssignment.gradesPublishedAt)
    assert.equal(pastAssignment.category, 'assignment')

    const mine = await client
      .get(`${API}/me/grades`)
      .bearerToken(await loginAs(client, diogo.email))
    mine.assertStatus(200)
    const evaluations = evaluationsOf(mine.body())
    const exam = evaluations.find((item) => item.eventId === pastExam.id)!
    assert.equal(exam.grade?.score, 750)
    assert.equal(exam.grade?.scoreText, '7,5')
    assert.equal(exam.maxScoreText, '10')
    assert.equal(exam.grade?.source.type, 'import')
    assert.equal(exam.grade?.source.source, 'modelo')
    const work = evaluations.find((item) => item.eventId === pastAssignment.id)!
    assert.equal(work.grade?.scoreText, '9')
    assert.equal(work.grade?.source.type, 'manual')
    // Prova ainda sem publicação: aparece como aguardando, sem nota.
    const future = evaluations.find((item) => item.eventId === mathExam.id)!
    assert.isFalse(future.published)
    assert.isNull(future.grade)
    const body = JSON.stringify(mine.body())
    assert.notInclude(body, 'average')
    assert.notInclude(body, 'registration')

    const mariaView = await client
      .get(`${API}/students/${diogo.id}/grades`)
      .bearerToken(await loginAs(client, maria.email))
    mariaView.assertStatus(200)
    assert.isTrue((mariaView.body() as Envelope<StudentReport>).data.shareGrades)
    const mariaExam = evaluationsOf(mariaView.body()).find((item) => item.eventId === pastExam.id)
    assert.equal(mariaExam?.grade?.score, 750)

    // O evento serializado ganha só a data de publicação.
    const event = await client
      .get(`${API}/events/${pastExam.id}`)
      .bearerToken(await loginAs(client, diogo.email))
    const eventData = (event.body() as Envelope<Record<string, unknown>>).data
    assert.isNotNull(eventData.gradesPublishedAt)
    assert.notProperty(eventData, 'gradesPublishedById')
  })

  test('importação: prévia classifica cada linha, aplicar grava em transação e publicar avisa', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, maria, maraisa, mathExam } = await demo()
    const caio = await addStudent(tads, 'caio@agenda.test', 'Caio Lima')
    await addStudent(tads, 'bia@agenda.test', 'Bia Souza')
    const edu = await addStudent(tads, 'edu@agenda.test', 'Edu Rocha')
    await addStudent(tads, 'duda@agenda.test', 'Duda Alves', 'pending')
    const token = await loginAs(client, maraisa.email)

    const draft = await createImport(
      client,
      token,
      importBody(mathExam.id, [
        { rowNumber: 2, identifier: ' Diogo@Agenda.test ', name: 'Diogo', score: '8,5' },
        { rowNumber: 3, identifier: 'bia@agenda.test', score: '11' },
        { rowNumber: 4, identifier: 'ninguem@agenda.test', score: '7' },
        { rowNumber: 5, identifier: 'duda@agenda.test', score: '6' },
        { rowNumber: 6, identifier: 'caio@agenda.test', score: 9 },
        { rowNumber: 7, identifier: 'caio@agenda.test', score: '9,0' },
        { rowNumber: 8, identifier: 'edu@agenda.test', score: null },
        { rowNumber: 9, identifier: '', name: '', score: '' },
      ])
    )
    assert.equal(draft.status, 'draft')
    assert.deepEqual(draft.totals, { new: 2, changed: 0, same: 0, newerInAgenda: 0, rejected: 5 })
    assert.equal(draft.breakdown?.invalid, 2)
    assert.equal(draft.breakdown?.no_match, 1)
    assert.equal(draft.breakdown?.not_enrolled, 1)
    assert.equal(draft.breakdown?.duplicate, 1)
    assert.isTrue(draft.canApply)
    // A linha em branco do fim da planilha não conta; as com problema vêm primeiro.
    const rows = draft.rows!
    assert.lengthOf(rows, 7)
    assert.equal(rows[0].kind, 'invalid')
    const byRow = new Map(rows.map((row) => [row.rowNumber, row]))
    assert.equal(byRow.get(2)?.kind, 'new')
    assert.equal(byRow.get(2)?.score, 850)
    assert.equal(byRow.get(2)?.student?.id, diogo.id)
    assert.equal(byRow.get(3)?.message, 'A nota precisa estar entre 0 e 10.')
    assert.equal(byRow.get(4)?.kind, 'no_match')
    assert.equal(byRow.get(5)?.kind, 'not_enrolled')
    assert.equal(byRow.get(6)?.kind, 'new')
    assert.equal(byRow.get(7)?.kind, 'duplicate')
    assert.equal(byRow.get(8)?.kind, 'invalid')
    assert.include(byRow.get(8)?.message ?? '', 'Nota em branco')
    // Rascunho não grava nota.
    assert.isUndefined(await scoreOf(mathExam.id, diogo.id))

    const shown = await expectStatus(
      client.get(`${API}/grade-imports/${draft.id}`).bearerToken(token),
      200
    )
    assert.lengthOf((shown.body() as Envelope<ImportDetail>).data.rows!, 7)

    const applied = await expectStatus(
      client.post(`${API}/grade-imports/${draft.id}/apply`).bearerToken(token).json({}),
      200
    )
    const appliedBody = applied.body() as Envelope<
      ImportDetail & { applied: { created: number; updated: number } }
    > & { message: string }
    assert.equal(appliedBody.data.status, 'applied')
    assert.equal(appliedBody.data.applied.created, 2)
    assert.equal(appliedBody.message, '2 notas importadas. Ficam ocultas até você publicar.')
    assert.isUndefined(appliedBody.data.rows)
    assert.equal(await scoreOf(mathExam.id, diogo.id), 850)
    assert.equal(await scoreOf(mathExam.id, caio.id), 900)
    // Célula vazia nunca vira zero.
    assert.isUndefined(await scoreOf(mathExam.id, edu.id))
    assert.lengthOf(await GradeImportRow.query().where('gradeImportId', draft.id), 0)
    const changes = await GradeChange.query().where('gradeImportId', draft.id)
    assert.lengthOf(changes, 2)
    assert.isTrue(changes.every((change) => change.source === 'import'))
    assert.isNotNull(
      await AuditLog.query()
        .where('action', 'grade_import.apply')
        .where('entityId', draft.id)
        .first()
    )
    // Aplicar de novo: 409.
    await expectStatus(
      client.post(`${API}/grade-imports/${draft.id}/apply`).bearerToken(token).json({}),
      409
    )

    // Importar não é publicar: o aluno ainda não vê.
    const diogoToken = await loginAs(client, diogo.email)
    const hidden = await client.get(`${API}/me/grades`).bearerToken(diogoToken)
    const hiddenExam = evaluationsOf(hidden.body()).find((item) => item.eventId === mathExam.id)!
    assert.isFalse(hiddenExam.published)
    assert.isNull(hiddenExam.grade)

    // A docente vê todos os alunos ativos, com e sem nota, sem a matrícula escolar.
    const list = await expectStatus(
      client.get(`${API}/events/${mathExam.id}/grades`).bearerToken(token),
      200
    )
    const listData = (list.body() as Envelope<EventGrades>).data
    assert.deepInclude(listData.counts, { students: 4, graded: 2, missing: 2 })
    assert.notInclude(
      listData.students.map((item) => item.enrollmentStatus),
      'pending'
    )
    assert.notProperty(listData.students[0], 'registration')
    const adminList = await client
      .get(`${API}/events/${mathExam.id}/grades`)
      .bearerToken(await loginAs(client, 'admin@agenda.test'))
    assert.property((adminList.body() as Envelope<EventGrades>).data.students[0], 'registration')

    const published = await expectStatus(
      client.post(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(token),
      200
    )
    const publishedBody = published.body() as Envelope<{
      notified: { students: number; guardians: number }
    }> & { message: string }
    assert.deepEqual(publishedBody.data.notified, { students: 2, guardians: 1 })
    assert.equal(publishedBody.message, 'Notas publicadas. Avisamos 2 alunos e 1 responsável.')
    const diogoNotice = await Notification.query()
      .where('userId', diogo.id)
      .where('kind', 'grades_published')
      .firstOrFail()
    assert.equal(diogoNotice.title, 'Nota publicada: Prova de Matemática')
    assert.equal(diogoNotice.link, `?tela=notas&evento=${mathExam.id}`)
    const mariaNotice = await Notification.query()
      .where('userId', maria.id)
      .where('kind', 'grades_published')
      .firstOrFail()
    assert.equal(mariaNotice.title, 'Nota de Diogo publicada: Prova de Matemática')
    assert.notInclude(`${diogoNotice.title} ${diogoNotice.body}`, '8,5')

    const visible = await client.get(`${API}/me/grades`).bearerToken(diogoToken)
    const visibleExam = evaluationsOf(visible.body()).find((item) => item.eventId === mathExam.id)!
    assert.isTrue(visibleExam.published)
    assert.equal(visibleExam.grade?.score, 850)
    // Só a própria nota: nada do Caio aparece para o Diogo.
    assert.notInclude(JSON.stringify(visible.body()), 'Caio')

    // Publicar de novo não avisa de novo.
    const again = await expectStatus(
      client.post(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(token),
      200
    )
    assert.isTrue((again.body() as Envelope<{ alreadyPublished: boolean }>).data.alreadyPublished)
    assert.lengthOf(
      await Notification.query().where('kind', 'grades_published').where('userId', diogo.id),
      1
    )

    // Despublicar oculta de novo e retira os avisos ainda não lidos.
    const unpublished = await expectStatus(
      client.delete(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(token),
      200
    )
    assert.equal(
      (unpublished.body() as Envelope<{ removedNotices: number }>).data.removedNotices,
      3
    )
    const after = await client.get(`${API}/me/grades`).bearerToken(diogoToken)
    assert.isNull(evaluationsOf(after.body()).find((item) => item.eventId === mathExam.id)!.grade)
    assert.lengthOf(
      await Notification.query().where('kind', 'grades_published').where('userId', diogo.id),
      0
    )
  })

  test('desfazer restaura o valor anterior, apaga o que a importação criou e recusa com 409 se a nota mudou depois', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, maraisa, mathExam } = await demo()
    const bia = await addStudent(tads, 'bia@agenda.test', 'Bia Souza', 'active', '000123')
    const token = await loginAs(client, maraisa.email)
    const adminToken = await loginAs(client, 'admin@agenda.test')

    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { score: 850 }), 201)
    // A matrícula escolar do Diogo, gravada pela administração, serve para casar a linha.
    const enrollment = await Enrollment.query()
      .where('userId', diogo.id)
      .where('academicClassId', tads.id)
      .firstOrFail()
    await expectStatus(
      client
        .patch(`${API}/enrollments/${enrollment.id}`)
        .bearerToken(adminToken)
        .json({ registration: '0042' }),
      200
    )

    const byRegistration = await createImport(
      client,
      token,
      importBody(
        mathExam.id,
        [
          { identifier: '42', score: '9,5' },
          { identifier: ' 000123 ', score: '7' },
          { identifier: 'ALU-001', score: '5' },
        ],
        {
          source: 'suap',
          mapping: {
            identifierType: 'registration',
            identifierColumn: 'Matrícula',
            scoreColumn: 'Nota',
          },
        }
      )
    )
    assert.deepEqual(byRegistration.totals, {
      new: 1,
      changed: 1,
      same: 0,
      newerInAgenda: 0,
      rejected: 1,
    })
    // A matrícula digitada no cadastro (ALU-001) não casa: só a gravada pela administração.
    const unmatched = byRegistration.rows!.find((row) => row.kind === 'no_match')
    assert.exists(unmatched)
    const changed = byRegistration.rows!.find((row) => row.kind === 'changed')!
    assert.equal(changed.previousScore, 850)
    assert.equal(changed.score, 950)

    await expectStatus(
      client.post(`${API}/grade-imports/${byRegistration.id}/apply`).bearerToken(token).json({}),
      200
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 950)
    assert.equal(await scoreOf(mathExam.id, bia.id), 700)

    const undone = await expectStatus(
      client.delete(`${API}/grade-imports/${byRegistration.id}`).bearerToken(token),
      200
    )
    const undoneBody = undone.body() as Envelope<
      ImportDetail & { undone: { restored: number; removed: number } }
    >
    assert.equal(undoneBody.data.status, 'undone')
    assert.deepEqual(undoneBody.data.undone, { restored: 1, removed: 1 })
    assert.equal(await scoreOf(mathExam.id, diogo.id), 850)
    assert.isUndefined(await scoreOf(mathExam.id, bia.id))
    const diogoGrade = await Grade.query()
      .where('academicEventId', mathExam.id)
      .where('studentId', diogo.id)
      .firstOrFail()
    assert.isNull(diogoGrade.gradeImportId)
    const history = await GradeChange.query().where('gradeId', diogoGrade.id).orderBy('id')
    assert.deepEqual(
      history.map((change) => [change.source, change.oldScore, change.newScore]),
      [
        ['manual', null, 850],
        ['import', 850, 950],
        ['undo', 950, 850],
      ]
    )
    // Desfazer de novo não muda nada.
    const twice = await expectStatus(
      client.delete(`${API}/grade-imports/${byRegistration.id}`).bearerToken(token),
      200
    )
    assert.equal((twice.body() as { message: string }).message, 'Esta importação já foi desfeita.')

    // Nota editada depois da importação: 409 com a lista e nada é desfeito.
    const later = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '6' }])
    )
    await expectStatus(
      client.post(`${API}/grade-imports/${later.id}/apply`).bearerToken(token).json({}),
      200
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 600)
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { score: 650 }), 200)

    const list = await client.get(`${API}/grade-imports?eventId=${mathExam.id}`).bearerToken(token)
    const laterItem = (list.body() as Envelope<ImportDetail[]>).data.find(
      (item) => item.id === later.id
    )!
    assert.isFalse(laterItem.canUndo)

    const blocked = await client.delete(`${API}/grade-imports/${later.id}`).bearerToken(token)
    blocked.assertStatus(409)
    const blockedBody = blocked.body() as {
      code: string
      message: string
      grades: { studentId: number }[]
    }
    assert.equal(blockedBody.code, 'EDITED_AFTER_IMPORT')
    assert.deepEqual(
      blockedBody.grades.map((item) => item.studentId),
      [diogo.id]
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 650)
    const laterImport = await GradeImport.findOrFail(later.id)
    assert.equal(laterImport.status, 'applied')

    // Nota apagada na Agenda depois da importação também conta como editada.
    const created = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'bia@agenda.test', score: '8' }])
    )
    await expectStatus(
      client.post(`${API}/grade-imports/${created.id}/apply`).bearerToken(token).json({}),
      200
    )
    await expectStatus(putGrade(client, token, mathExam.id, bia.id, { score: null }), 200)
    const clearedBlocked = await client
      .delete(`${API}/grade-imports/${created.id}`)
      .bearerToken(token)
    clearedBlocked.assertStatus(409)
    assert.deepEqual(
      (clearedBlocked.body() as { grades: { studentId: number }[] }).grades.map(
        (item) => item.studentId
      ),
      [bia.id]
    )
    assert.isUndefined(await scoreOf(mathExam.id, bia.id))
  })

  test('nota mudada na Agenda depois do arquivo: a prévia avisa e aplicar mantém a da Agenda, salvo se a docente pedir', async ({
    client,
    assert,
  }) => {
    const { diogo, maraisa, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { score: 700 }), 201)
    const fileModifiedAt = DateTime.now().minus({ days: 1 }).toISO()

    const first = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '8' }], { fileModifiedAt })
    )
    assert.equal(first.totals.newerInAgenda, 1)
    assert.equal(first.rows![0].kind, 'newer_in_agenda')
    assert.include(first.rows![0].message ?? '', 'depois do arquivo')
    const kept = await expectStatus(
      client.post(`${API}/grade-imports/${first.id}/apply`).bearerToken(token).json({}),
      200
    )
    assert.equal(
      (kept.body() as Envelope<{ applied: { keptAgenda: number } }>).data.applied.keptAgenda,
      1
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 700)

    const second = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '8' }], { fileModifiedAt })
    )
    await expectStatus(
      client
        .post(`${API}/grade-imports/${second.id}/apply`)
        .bearerToken(token)
        .json({ keepAgendaWhenNewer: false }),
      200
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 800)

    // Mudou depois da prévia: aplicar também mantém a nota da Agenda.
    const third = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '9' }])
    )
    assert.equal(third.totals.changed, 1)
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { score: 750 }), 200)
    await expectStatus(
      client.post(`${API}/grade-imports/${third.id}/apply`).bearerToken(token).json({}),
      200
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 750)
  })

  test('docente sem vínculo com a oferta: 403 se vê o evento, 404 se nem vê; aluno e responsável 403; nada muda', async ({
    client,
    assert,
  }) => {
    const { tads, math, maraisa, marina, diogo, maria, mathExam, edExam } = await demo()
    const maraisaToken = await loginAs(client, maraisa.email)
    const draft = await createImport(
      client,
      maraisaToken,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '8' }])
    )
    await User.create({
      fullName: 'Docente Sem Turma',
      email: 'docente.solto@agenda.test',
      password: 'password123',
      role: 'teacher',
    })
    const tokens = {
      marina: await loginAs(client, marina.email),
      loose: await loginAs(client, 'docente.solto@agenda.test'),
      diogo: await loginAs(client, diogo.email),
      maria: await loginAs(client, maria.email),
    }
    const before = await gradeSnapshot()

    type Attempt = [method: 'get' | 'post' | 'put' | 'delete', url: string, body?: object]
    const onEvent: Attempt[] = [
      ['get', `${API}/events/${mathExam.id}/grades`],
      ['put', `${API}/events/${mathExam.id}/grades/${diogo.id}`, { score: 100 }],
      ['post', `${API}/events/${mathExam.id}/grades/publish`],
      ['delete', `${API}/events/${mathExam.id}/grades/publish`],
      ['get', `${API}/grade-imports?eventId=${mathExam.id}`],
      [
        'post',
        `${API}/grade-imports`,
        importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '1' }]),
      ],
    ]
    const onImport: Attempt[] = [
      ['get', `${API}/grade-imports/${draft.id}`],
      ['post', `${API}/grade-imports/${draft.id}/apply`, {}],
      ['delete', `${API}/grade-imports/${draft.id}`],
    ]
    const matrix: [keyof typeof tokens, Attempt[], number][] = [
      // Marina dá aula na TADS 5 (Estrutura de Dados): vê o evento, mas não é da oferta.
      ['marina', onEvent, 403],
      ['marina', onImport, 404],
      // Docente sem nenhum vínculo nem vê o evento da turma.
      ['loose', onEvent, 404],
      ['loose', onImport, 404],
      ['diogo', onEvent, 403],
      ['diogo', onImport, 403],
      ['maria', onEvent, 403],
      ['maria', onImport, 403],
    ]
    for (const [who, attempts, status] of matrix) {
      for (const [method, url, body] of attempts) {
        const request: any = client[method](url).bearerToken(tokens[who])
        const response = await (body ? request.json(body) : request)
        assert.equal(response.status(), status, `${who} ${method.toUpperCase()} ${url}`)
      }
    }
    // A Maraísa também não mexe nas notas da prova da Marina.
    await expectStatus(
      client.get(`${API}/events/${edExam.id}/grades`).bearerToken(maraisaToken),
      403
    )
    assert.deepEqual(await gradeSnapshot(), before)

    // Segunda docente na mesma oferta: vê a importação, mas só quem criou aplica.
    await TeachingAssignment.create({
      teacherId: marina.id,
      academicClassId: tads.id,
      subjectId: math.id,
      role: 'substituto',
    })
    const seen = await expectStatus(
      client.get(`${API}/grade-imports/${draft.id}`).bearerToken(tokens.marina),
      200
    )
    assert.isFalse((seen.body() as Envelope<ImportDetail>).data.canApply)
    await expectStatus(
      client.post(`${API}/grade-imports/${draft.id}/apply`).bearerToken(tokens.marina).json({}),
      403
    )
    await expectStatus(
      client.delete(`${API}/grade-imports/${draft.id}`).bearerToken(tokens.marina),
      403
    )

    // Com o vínculo encerrado, a autora da prova perde as notas dela.
    const ended = await TeachingAssignment.query()
      .where('teacherId', maraisa.id)
      .where('academicClassId', tads.id)
      .where('subjectId', math.id)
      .firstOrFail()
    ended.endedAt = DateTime.now()
    await ended.save()
    await expectStatus(
      client.get(`${API}/events/${mathExam.id}/grades`).bearerToken(maraisaToken),
      403
    )
    await expectStatus(
      client.post(`${API}/grade-imports/${draft.id}/apply`).bearerToken(maraisaToken).json({}),
      403
    )
    assert.deepEqual(await gradeSnapshot(), before)

    // A administração aplica qualquer rascunho.
    await expectStatus(
      client
        .post(`${API}/grade-imports/${draft.id}/apply`)
        .bearerToken(await loginAs(client, 'admin@agenda.test'))
        .json({}),
      200
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 800)
  })

  test('responsável: vê só as publicadas; de aluno adulto só com shareGrades; sem vínculo ativo, 404', async ({
    client,
    assert,
  }) => {
    const { inf, diogo, ana, maria, carlos, maraisa, marina, mathExam, mariaLink } = await demo()
    const maraisaToken = await loginAs(client, maraisa.email)
    const mariaToken = await loginAs(client, maria.email)
    const carlosToken = await loginAs(client, carlos.email)
    await expectStatus(putGrade(client, maraisaToken, mathExam.id, diogo.id, { score: 800 }), 201)

    const view = async () => {
      const response = await client
        .get(`${API}/students/${diogo.id}/grades`)
        .bearerToken(mariaToken)
      response.assertStatus(200)
      return response
    }
    // Antes de publicar: aguardando, sem número.
    const before = await view()
    const hidden = evaluationsOf(before.body()).find((item) => item.eventId === mathExam.id)!
    assert.isNull(hidden.grade)

    await expectStatus(
      client.post(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(maraisaToken),
      200
    )
    const afterPublish = await view()
    const shown = evaluationsOf(afterPublish.body()).find((item) => item.eventId === mathExam.id)!
    assert.equal(shown.grade?.score, 800)

    // Diogo (adulto) desliga o compartilhamento: a Maria não vê nenhum número.
    await expectStatus(
      client
        .patch(`${API}/me/guardians/${mariaLink.id}`)
        .bearerToken(await loginAs(client, diogo.email))
        .json({ shareGrades: false }),
      200
    )
    const notShared = await view()
    const notSharedData = (notShared.body() as Envelope<StudentReport>).data
    assert.isFalse(notSharedData.shareGrades)
    assert.lengthOf(notSharedData.subjects, 0)
    assert.isNull(notSharedData.counts)
    assert.notInclude(JSON.stringify(notShared.body()), '800')
    assert.notInclude(JSON.stringify(notShared.body()), '750')

    // Publicar de novo: a Maria não recebe aviso, porque o Diogo não compartilha.
    await expectStatus(
      client.delete(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(maraisaToken),
      200
    )
    const republished = await expectStatus(
      client.post(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(maraisaToken),
      200
    )
    assert.deepEqual((republished.body() as Envelope<{ notified: object }>).data.notified, {
      students: 1,
      guardians: 0,
    })

    // Sem vínculo ativo: 404, como se o aluno não existisse.
    await expectStatus(
      client.get(`${API}/students/${diogo.id}/grades`).bearerToken(carlosToken),
      404
    )
    await expectStatus(client.get(`${API}/students/${ana.id}/grades`).bearerToken(mariaToken), 404)
    await expectStatus(client.get(`${API}/students/999999/grades`).bearerToken(mariaToken), 404)
    await expectStatus(client.get(`${API}/me/grades`).bearerToken(mariaToken), 403)
    await expectStatus(
      client
        .get(`${API}/students/${ana.id}/grades`)
        .bearerToken(await loginAs(client, diogo.email)),
      403
    )
    await expectStatus(
      client
        .get(`${API}/students/${maraisa.id}/grades`)
        .bearerToken(await loginAs(client, 'admin@agenda.test')),
      404
    )

    // Aluna menor: o responsável sempre vê as publicadas, mesmo com shareGrades desligado.
    const logic = await Subject.findByOrFail('code', 'LP-101')
    const logicExam = await AcademicEvent.create({
      title: 'Prova de Lógica',
      category: 'exam',
      source: 'teacher',
      status: 'scheduled',
      startsAt: DateTime.now().minus({ days: 1 }),
      points: 10,
      academicClassId: inf.id,
      subjectId: logic.id,
      teacherId: marina.id,
      createdById: marina.id,
      officialPriority: false,
    })
    const marinaToken = await loginAs(client, marina.email)
    await expectStatus(putGrade(client, marinaToken, logicExam.id, ana.id, { score: 600 }), 201)
    const anaPublished = await expectStatus(
      client.post(`${API}/events/${logicExam.id}/grades/publish`).bearerToken(marinaToken),
      200
    )
    assert.deepEqual((anaPublished.body() as Envelope<{ notified: object }>).data.notified, {
      students: 1,
      guardians: 1,
    })
    const carlosView = await expectStatus(
      client.get(`${API}/students/${ana.id}/grades`).bearerToken(carlosToken),
      200
    )
    assert.equal(
      evaluationsOf(carlosView.body()).find((item) => item.eventId === logicExam.id)?.grade?.score,
      600
    )

    // Vínculo desfeito: 404.
    await expectStatus(
      client.delete(`${API}/guardian-links/${mariaLink.id}`).bearerToken(mariaToken),
      200
    )
    await expectStatus(
      client.get(`${API}/students/${diogo.id}/grades`).bearerToken(mariaToken),
      404
    )
  })

  test('lançar nota: centésimos de 0 até o valor, falta sem nota, apagar sem virar zero; só prova e trabalho', async ({
    client,
    assert,
  }) => {
    const { tads, ana, diogo, maraisa, math, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)

    const tooHigh = await putGrade(client, token, mathExam.id, diogo.id, { score: 1001 })
    tooHigh.assertStatus(422)
    assert.include(fieldOf(tooHigh.body()), 'score')
    const absentWithScore = await putGrade(client, token, mathExam.id, diogo.id, {
      score: 500,
      status: 'absent',
    })
    absentWithScore.assertStatus(422)
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, {}), 422)
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { status: 'graded' }), 422)
    const decimals = await putGrade(client, token, mathExam.id, diogo.id, { score: 7.5 })
    decimals.assertStatus(422)

    const absent = await expectStatus(
      putGrade(client, token, mathExam.id, diogo.id, { status: 'absent' }),
      201
    )
    const absentRow = (absent.body() as Envelope<StudentRow>).data
    assert.equal(absentRow.grade?.status, 'absent')
    assert.isNull(absentRow.grade?.score)

    const graded = await expectStatus(
      putGrade(client, token, mathExam.id, diogo.id, { score: 1000 }),
      200
    )
    assert.equal((graded.body() as Envelope<StudentRow>).data.grade?.scoreText, '10')

    const cleared = await expectStatus(
      putGrade(client, token, mathExam.id, diogo.id, { score: null }),
      200
    )
    assert.isNull((cleared.body() as Envelope<StudentRow>).data.grade)
    assert.isUndefined(await scoreOf(mathExam.id, diogo.id))

    // Aluna de outra turma: 404.
    await expectStatus(putGrade(client, token, mathExam.id, ana.id, { score: 500 }), 404)

    // Atividade não recebe nota.
    const activity = await AcademicEvent.create({
      title: 'Lista de exercícios',
      category: 'activity',
      source: 'teacher',
      status: 'scheduled',
      startsAt: DateTime.now().plus({ days: 2 }),
      points: 1,
      academicClassId: tads.id,
      subjectId: math.id,
      teacherId: maraisa.id,
      createdById: maraisa.id,
      officialPriority: false,
    })
    const notGradable = await client.get(`${API}/events/${activity.id}/grades`).bearerToken(token)
    notGradable.assertStatus(409)
    assert.equal((notGradable.body() as { code: string }).code, 'NOT_GRADABLE')
    await expectStatus(
      client
        .post(`${API}/grade-imports`)
        .bearerToken(token)
        .json(importBody(activity.id, [{ identifier: 'diogo@agenda.test', score: '1' }])),
      409
    )

    // Prova sem valor: lançar pede o valor; a importação grava o que a docente informar.
    const created = await expectStatus(
      client.post(`${API}/events`).bearerToken(token).json({
        title: 'Prova surpresa',
        category: 'exam',
        startsAt: '2026-12-01T19:00',
        academicClassId: tads.id,
        subjectId: math.id,
      }),
      201
    )
    const surpriseId = (created.body() as Envelope<{ id: number }>).data.id
    const noPoints = await putGrade(client, token, surpriseId, diogo.id, { score: 500 })
    noPoints.assertStatus(422)
    assert.include(fieldOf(noPoints.body()), 'score')
    const askPoints = await client
      .post(`${API}/grade-imports`)
      .bearerToken(token)
      .json(importBody(surpriseId, [{ identifier: 'diogo@agenda.test', score: '15' }]))
    askPoints.assertStatus(422)
    assert.include(fieldOf(askPoints.body()), 'points')
    const withPoints = await createImport(
      client,
      token,
      importBody(surpriseId, [{ identifier: 'diogo@agenda.test', score: '15' }], { points: 20 })
    )
    assert.equal(withPoints.totals.new, 1)
    const surprise = await AcademicEvent.findOrFail(surpriseId)
    assert.equal(Number(surprise.points), 20)
    const otherPoints = await client
      .post(`${API}/grade-imports`)
      .bearerToken(token)
      .json(
        importBody(surpriseId, [{ identifier: 'diogo@agenda.test', score: '1' }], { points: 10 })
      )
    otherPoints.assertStatus(422)
    assert.include(fieldOf(otherPoints.body()), 'points')

    // Até 2.000 linhas por importação.
    const tooMany = await client
      .post(`${API}/grade-imports`)
      .bearerToken(token)
      .json(
        importBody(
          mathExam.id,
          Array.from({ length: 2001 }, (_, index) => ({
            identifier: `a${index}@x.test`,
            score: '1',
          }))
        )
      )
    tooMany.assertStatus(422)
    assert.include(fieldOf(tooMany.body()), 'rows')
  })

  test('evento com nota: excluir devolve 409 e nada é apagado; sem nota, sai junto com os rascunhos', async ({
    client,
    assert,
  }) => {
    const { diogo, maraisa, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { score: 800 }), 201)

    const blocked = await client.delete(`${API}/events/${mathExam.id}`).bearerToken(token)
    blocked.assertStatus(409)
    const body = blocked.body() as { code: string; counts: { grades: number } }
    assert.equal(body.code, 'HAS_DEPENDENTS')
    assert.equal(body.counts.grades, 1)
    assert.isNotNull(await AcademicEvent.find(mathExam.id))
    assert.equal(await scoreOf(mathExam.id, diogo.id), 800)

    // Com nota, o evento não deixa de ser prova, não muda de disciplina nem vale menos.
    const category = await client
      .put(`${API}/events/${mathExam.id}`)
      .bearerToken(token)
      .json({ category: 'activity' })
    category.assertStatus(409)
    assert.equal((category.body() as { code: string }).code, 'HAS_GRADES')
    const lower = await client
      .put(`${API}/events/${mathExam.id}`)
      .bearerToken(token)
      .json({ points: 5 })
    lower.assertStatus(422)
    assert.include(fieldOf(lower.body()), 'points')
    await expectStatus(
      client.put(`${API}/events/${mathExam.id}`).bearerToken(token).json({ points: 8 }),
      200
    )

    // Sem nota (só um rascunho): o evento e as importações dele saem.
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { score: null }), 200)
    const draft = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '7' }])
    )
    await expectStatus(client.delete(`${API}/events/${mathExam.id}`).bearerToken(token), 200)
    assert.isNull(await AcademicEvent.find(mathExam.id))
    assert.isNull(await GradeImport.find(draft.id))
  })

  test('descartar rascunho não muda nota; turma arquivada fica somente leitura nas notas', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, maraisa, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)
    const draft = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '7' }])
    )
    const discarded = await expectStatus(
      client.delete(`${API}/grade-imports/${draft.id}`).bearerToken(token),
      200
    )
    assert.equal((discarded.body() as Envelope<ImportDetail>).data.status, 'discarded')
    assert.lengthOf(await GradeImportRow.query().where('gradeImportId', draft.id), 0)
    assert.isUndefined(await scoreOf(mathExam.id, diogo.id))
    const late = await client
      .post(`${API}/grade-imports/${draft.id}/apply`)
      .bearerToken(token)
      .json({})
    late.assertStatus(409)
    assert.equal((late.body() as { code: string }).code, 'NOT_DRAFT')

    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { score: 900 }), 201)
    await expectStatus(
      client.post(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(token),
      200
    )
    await expectStatus(
      client
        .post(`${API}/classes/${tads.id}/archive`)
        .bearerToken(await loginAs(client, 'admin@agenda.test')),
      200
    )
    for (const response of [
      await putGrade(client, token, mathExam.id, diogo.id, { score: 100 }),
      await client
        .post(`${API}/grade-imports`)
        .bearerToken(token)
        .json(importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '1' }])),
    ]) {
      response.assertStatus(409)
      assert.equal((response.body() as { code: string }).code, 'ARCHIVED')
    }
    await expectStatus(client.get(`${API}/events/${mathExam.id}/grades`).bearerToken(token), 200)
    // Despublicar só tira acesso: vale na turma arquivada.
    await expectStatus(
      client.delete(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(token),
      200
    )
    await expectStatus(
      client.post(`${API}/events/${mathExam.id}/grades/publish`).bearerToken(token),
      409
    )
    assert.equal(await scoreOf(mathExam.id, diogo.id), 900)
  })

  test('seed duas vezes: notas, importações e publicação da demonstração não duplicam nem voltam atrás', async ({
    client,
    assert,
  }) => {
    const { maraisa, pastAssignment } = await demo()
    await expectStatus(
      client
        .delete(`${API}/events/${pastAssignment.id}/grades/publish`)
        .bearerToken(await loginAs(client, maraisa.email)),
      200
    )
    const before = await gradeSnapshot()

    await new DemoSeeder(db.connection()).run()
    await new DemoSeeder(db.connection()).run()

    assert.deepEqual(await gradeSnapshot(), before)
    await pastAssignment.refresh()
    assert.isNull(pastAssignment.gradesPublishedAt)
  })

  // Revisão da fase 3: os testes abaixo provam as correções feitas depois da revisão.

  test('revisão: cada papel pede ids que não são dele nas rotas de notas; nada vaza e nada muda', async ({
    client,
    assert,
  }) => {
    const { inf, diogo, ana, maria, carlos, maraisa, marina, mathExam } = await demo()
    const logic = await Subject.findByOrFail('code', 'LP-101')
    // Prova da INF 3A (Marina), com a nota da Ana publicada e um rascunho de importação.
    const logicExam = await AcademicEvent.create({
      title: 'Prova de Lógica',
      category: 'exam',
      source: 'teacher',
      status: 'scheduled',
      startsAt: DateTime.now().minus({ days: 1 }),
      points: 10,
      academicClassId: inf.id,
      subjectId: logic.id,
      teacherId: marina.id,
      createdById: marina.id,
      officialPriority: false,
    })
    const marinaToken = await loginAs(client, marina.email)
    await expectStatus(putGrade(client, marinaToken, logicExam.id, ana.id, { score: 600 }), 201)
    await expectStatus(
      client.post(`${API}/events/${logicExam.id}/grades/publish`).bearerToken(marinaToken),
      200
    )
    const infDraft = await createImport(
      client,
      marinaToken,
      importBody(logicExam.id, [{ identifier: 'ana@agenda.test', score: '7' }])
    )
    const maraisaToken = await loginAs(client, maraisa.email)
    const tadsDraft = await createImport(
      client,
      maraisaToken,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '8' }])
    )
    // A Maria acompanha o Diogo, não a Ana: o aviso da prova da Ana foi só para o Carlos.
    assert.isNull(
      await Notification.query()
        .where('userId', maria.id)
        .where('kind', 'grades_published')
        .where('link', 'like', `%evento=${logicExam.id}`)
        .first()
    )

    const loose = await User.create({
      fullName: 'Responsável Sem Vínculo',
      email: 'responsavel.solto@agenda.test',
      password: 'password123',
      role: 'guardian',
    })
    await User.create({
      fullName: 'Visitante',
      email: 'visitante@agenda.test',
      password: 'password123',
      role: 'visitor',
    })
    // Vínculos com o Diogo que não valem: pendente e bloqueado.
    const pendingGuardian = await User.create({
      fullName: 'Tio Pendente',
      email: 'tio.pendente@agenda.test',
      password: 'password123',
      role: 'guardian',
    })
    const blockedGuardian = await User.create({
      fullName: 'Pai Bloqueado',
      email: 'pai.bloqueado@agenda.test',
      password: 'password123',
      role: 'guardian',
    })
    await GuardianLink.create({
      guardianId: pendingGuardian.id,
      studentId: diogo.id,
      relationship: 'outro',
      status: 'pending',
      origin: 'student_code',
      shareGrades: true,
    })
    await GuardianLink.create({
      guardianId: blockedGuardian.id,
      studentId: diogo.id,
      relationship: 'pai',
      status: 'blocked',
      origin: 'admin',
      shareGrades: true,
    })

    const tokens = {
      diogo: await loginAs(client, diogo.email),
      maraisa: maraisaToken,
      maria: await loginAs(client, maria.email),
      carlos: await loginAs(client, carlos.email),
      loose: await loginAs(client, loose.email),
      pending: await loginAs(client, pendingGuardian.email),
      blocked: await loginAs(client, blockedGuardian.email),
      visitor: await loginAs(client, 'visitante@agenda.test'),
      admin: await loginAs(client, 'admin@agenda.test'),
    }
    const before = await gradeSnapshot()

    type Attempt = [
      who: keyof typeof tokens,
      method: 'get' | 'post' | 'put' | 'delete',
      url: string,
      status: number,
      body?: object,
    ]
    const attempts: Attempt[] = [
      // A Maraísa não dá aula na INF 3A: nem vê o evento nem a importação de lá.
      ['maraisa', 'get', `${API}/events/${logicExam.id}/grades`, 404],
      ['maraisa', 'put', `${API}/events/${logicExam.id}/grades/${ana.id}`, 404, { score: 100 }],
      ['maraisa', 'post', `${API}/events/${logicExam.id}/grades/publish`, 404],
      ['maraisa', 'delete', `${API}/events/${logicExam.id}/grades/publish`, 404],
      ['maraisa', 'get', `${API}/grade-imports?eventId=${logicExam.id}`, 404],
      ['maraisa', 'get', `${API}/grade-imports/${infDraft.id}`, 404],
      ['maraisa', 'post', `${API}/grade-imports/${infDraft.id}/apply`, 404, {}],
      ['maraisa', 'delete', `${API}/grade-imports/${infDraft.id}`, 404],
      [
        'maraisa',
        'post',
        `${API}/grade-imports`,
        404,
        importBody(logicExam.id, [{ identifier: 'ana@agenda.test', score: '1' }]),
      ],
      // Na própria prova, só alunos da turma: responsável, docente e id que não existe são 404.
      ['maraisa', 'put', `${API}/events/${mathExam.id}/grades/${maria.id}`, 404, { score: 100 }],
      ['maraisa', 'put', `${API}/events/${mathExam.id}/grades/${marina.id}`, 404, { score: 100 }],
      ['maraisa', 'put', `${API}/events/${mathExam.id}/grades/999999`, 404, { score: 100 }],
      ['maraisa', 'put', `${API}/events/${mathExam.id}/grades/abc`, 404, { score: 100 }],
      // Aluno não vê a nota de outro aluno nem a própria por esta rota.
      ['diogo', 'get', `${API}/students/${ana.id}/grades`, 403],
      ['diogo', 'get', `${API}/students/${diogo.id}/grades`, 403],
      // Responsável: só com vínculo ativo. Pendente, bloqueado, de outro aluno ou sem vínculo: 404.
      ['maria', 'get', `${API}/students/${ana.id}/grades`, 404],
      ['carlos', 'get', `${API}/students/${diogo.id}/grades`, 404],
      ['loose', 'get', `${API}/students/${diogo.id}/grades`, 404],
      ['pending', 'get', `${API}/students/${diogo.id}/grades`, 404],
      ['blocked', 'get', `${API}/students/${diogo.id}/grades`, 404],
      ['maria', 'get', `${API}/grade-imports/${tadsDraft.id}`, 403],
      ['maria', 'get', `${API}/events/${mathExam.id}/grades`, 403],
      // Papel que o sistema não conhece: negado em tudo.
      ['visitor', 'get', `${API}/me/grades`, 403],
      ['visitor', 'get', `${API}/students/${diogo.id}/grades`, 403],
      ['visitor', 'get', `${API}/events/${mathExam.id}/grades`, 403],
      ['visitor', 'put', `${API}/events/${mathExam.id}/grades/${diogo.id}`, 403, { score: 100 }],
      ['visitor', 'post', `${API}/events/${mathExam.id}/grades/publish`, 403],
      ['visitor', 'get', `${API}/grade-imports?eventId=${mathExam.id}`, 403],
      ['visitor', 'get', `${API}/grade-imports/${tadsDraft.id}`, 403],
      ['visitor', 'post', `${API}/grade-imports/${tadsDraft.id}/apply`, 403, {}],
      ['visitor', 'delete', `${API}/grade-imports/${tadsDraft.id}`, 403],
      [
        'visitor',
        'post',
        `${API}/grade-imports`,
        403,
        importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '1' }]),
      ],
      // Ids que não existem, mesmo para a administração.
      ['admin', 'get', `${API}/events/999999/grades`, 404],
      ['admin', 'get', `${API}/grade-imports/999999`, 404],
      ['admin', 'get', `${API}/grade-imports/abc`, 404],
      ['admin', 'get', `${API}/grade-imports?eventId=999999`, 404],
      ['admin', 'get', `${API}/students/${marina.id}/grades`, 404],
    ]
    for (const [who, method, url, status, body] of attempts) {
      const request: any = client[method](url).bearerToken(tokens[who])
      const response = await (body ? request.json(body) : request)
      assert.equal(response.status(), status, `${who} ${method.toUpperCase()} ${url}`)
      // Nenhuma resposta negada traz nota, nome ou e-mail de aluno.
      if (status >= 400) {
        const text = JSON.stringify(response.body())
        for (const leak of ['ana@agenda.test', 'diogo@agenda.test', 'Ana Clara', '600']) {
          assert.notInclude(text, leak, `${who} ${method.toUpperCase()} ${url}`)
        }
      }
    }
    assert.deepEqual(await gradeSnapshot(), before)

    // Cada um vê só as próprias notas: nada da INF 3A para o Diogo, nada da TADS 5 para a Ana.
    const diogoGrades = await expectStatus(
      client.get(`${API}/me/grades`).bearerToken(tokens.diogo),
      200
    )
    assert.notInclude(
      evaluationsOf(diogoGrades.body()).map((item) => item.eventId),
      logicExam.id
    )
    const anaGrades = await expectStatus(
      client.get(`${API}/me/grades`).bearerToken(await loginAs(client, ana.email)),
      200
    )
    const anaEvaluations = evaluationsOf(anaGrades.body())
    assert.deepEqual(
      anaEvaluations.map((item) => item.eventId),
      [logicExam.id]
    )
    assert.equal(anaEvaluations[0].grade?.score, 600)
    assert.notInclude(JSON.stringify(anaGrades.body()), 'Diogo')
  })

  test('revisão: prova sem disciplina não tem oferta, então só a autora e a administração mexem nas notas', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, maraisa, marina } = await demo()
    const marinaToken = await loginAs(client, marina.email)
    const maraisaToken = await loginAs(client, maraisa.email)
    const adminToken = await loginAs(client, 'admin@agenda.test')

    // A Marina (Estrutura de Dados na TADS 5) cria uma prova da turma sem disciplina.
    const created = await expectStatus(
      client.post(`${API}/events`).bearerToken(marinaToken).json({
        title: 'Prova integradora',
        category: 'exam',
        startsAt: '2026-12-02T19:00',
        points: 10,
        academicClassId: tads.id,
      }),
      201
    )
    const ownExam = (created.body() as Envelope<{ id: number }>).data.id
    await expectStatus(putGrade(client, marinaToken, ownExam, diogo.id, { score: 700 }), 201)
    const ownDraft = await createImport(
      client,
      marinaToken,
      importBody(ownExam, [{ identifier: 'diogo@agenda.test', score: '8' }])
    )

    // A Maraísa dá aula na mesma turma, mas não é a autora: 403 em tudo, e a importação some.
    const before = await gradeSnapshot()
    for (const response of [
      await client.get(`${API}/events/${ownExam}/grades`).bearerToken(maraisaToken),
      await putGrade(client, maraisaToken, ownExam, diogo.id, { score: 100 }),
      await client.post(`${API}/events/${ownExam}/grades/publish`).bearerToken(maraisaToken),
      await client.get(`${API}/grade-imports?eventId=${ownExam}`).bearerToken(maraisaToken),
      await client
        .post(`${API}/grade-imports`)
        .bearerToken(maraisaToken)
        .json(importBody(ownExam, [{ identifier: 'diogo@agenda.test', score: '1' }])),
    ]) {
      response.assertStatus(403)
    }
    await expectStatus(
      client.get(`${API}/grade-imports/${ownDraft.id}`).bearerToken(maraisaToken),
      404
    )
    assert.deepEqual(await gradeSnapshot(), before)

    // Prova sem disciplina criada pela administração: nenhuma docente, só a administração.
    const adminCreated = await expectStatus(
      client.post(`${API}/events`).bearerToken(adminToken).json({
        title: 'Simulado da turma',
        category: 'exam',
        startsAt: '2026-12-03T19:00',
        points: 10,
        academicClassId: tads.id,
        source: 'teacher',
      }),
      201
    )
    const adminExam = (adminCreated.body() as Envelope<{ id: number }>).data.id
    await expectStatus(putGrade(client, maraisaToken, adminExam, diogo.id, { score: 100 }), 403)
    await expectStatus(putGrade(client, marinaToken, adminExam, diogo.id, { score: 100 }), 403)
    await expectStatus(putGrade(client, adminToken, adminExam, diogo.id, { score: 900 }), 201)
    assert.equal(await scoreOf(adminExam, diogo.id), 900)
  })

  test('revisão: matrícula ou e-mail repetido na turma depois de normalizar não casa com ninguém', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, maraisa, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)
    const adminToken = await loginAs(client, 'admin@agenda.test')
    const bia = await addStudent(tads, 'bia@agenda.test', 'Bia Souza', 'active', '42')
    // A API aceita "0042" para o Diogo porque compara a matrícula como foi digitada.
    const enrollment = await Enrollment.query()
      .where('userId', diogo.id)
      .where('academicClassId', tads.id)
      .firstOrFail()
    await expectStatus(
      client
        .patch(`${API}/enrollments/${enrollment.id}`)
        .bearerToken(adminToken)
        .json({ registration: '0042' }),
      200
    )

    const byRegistration = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: '42', score: '9' }], {
        mapping: {
          identifierType: 'registration',
          identifierColumn: 'Matrícula',
          scoreColumn: 'Nota',
        },
      })
    )
    assert.deepEqual(byRegistration.totals, {
      new: 0,
      changed: 0,
      same: 0,
      newerInAgenda: 0,
      rejected: 1,
    })
    assert.equal(byRegistration.rows![0].kind, 'no_match')
    assert.include(byRegistration.rows![0].message ?? '', 'Mais de um aluno da turma')
    assert.isNull(byRegistration.rows![0].student)
    await expectStatus(
      client.post(`${API}/grade-imports/${byRegistration.id}/apply`).bearerToken(token).json({}),
      200
    )
    assert.isUndefined(await scoreOf(mathExam.id, diogo.id))
    assert.isUndefined(await scoreOf(mathExam.id, bia.id))

    // Conta com o mesmo e-mail em maiúsculas na turma: a nota do Diogo não vai para ela.
    const lookalike = await addStudent(tads, 'DIOGO@agenda.test', 'Diogo Parecido')
    const byEmail = await createImport(
      client,
      token,
      importBody(mathExam.id, [
        { identifier: 'diogo@agenda.test', score: '10' },
        { identifier: 'bia@agenda.test', score: '6' },
      ])
    )
    assert.equal(byEmail.totals.new, 1)
    const emailRow = byEmail.rows!.find((row) => row.kind === 'no_match')!
    assert.include(emailRow.message ?? '', 'Mais de um aluno da turma')
    await expectStatus(
      client.post(`${API}/grade-imports/${byEmail.id}/apply`).bearerToken(token).json({}),
      200
    )
    assert.isUndefined(await scoreOf(mathExam.id, diogo.id))
    assert.isUndefined(await scoreOf(mathExam.id, lookalike.id))
    assert.equal(await scoreOf(mathExam.id, bia.id), 600)
  })

  test('revisão: evento que muda de turma ou disciplina descarta os rascunhos de importação', async ({
    client,
    assert,
  }) => {
    const { inf, maraisa, marina, mathExam } = await demo()
    const logic = await Subject.findByOrFail('code', 'LP-101')
    const maraisaToken = await loginAs(client, maraisa.email)
    const marinaToken = await loginAs(client, marina.email)
    const draft = await createImport(
      client,
      maraisaToken,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', name: 'Diogo', score: '8' }])
    )

    // A administração leva a prova para a INF 3A (Lógica, da Marina).
    await expectStatus(
      client
        .put(`${API}/events/${mathExam.id}`)
        .bearerToken(await loginAs(client, 'admin@agenda.test'))
        .json({ academicClassId: inf.id, subjectId: logic.id }),
      200
    )
    const discarded = await GradeImport.findOrFail(draft.id)
    assert.equal(discarded.status, 'discarded')
    assert.lengthOf(await GradeImportRow.query().where('gradeImportId', draft.id), 0)
    assert.isNotNull(
      await AuditLog.query()
        .where('action', 'grade_import.discard')
        .where('entityId', draft.id)
        .first()
    )
    // A Marina, docente da nova oferta, não vê os alunos da TADS 5 na prévia.
    const seen = await expectStatus(
      client.get(`${API}/grade-imports/${draft.id}`).bearerToken(marinaToken),
      200
    )
    assert.notProperty((seen.body() as Envelope<ImportDetail>).data, 'rows')
    assert.notInclude(JSON.stringify(seen.body()), 'diogo@agenda.test')

    // Editar sem mudar turma nem disciplina não mexe no rascunho.
    const kept = await createImport(
      client,
      marinaToken,
      importBody(mathExam.id, [{ identifier: 'ana@agenda.test', score: '7' }])
    )
    await expectStatus(
      client
        .put(`${API}/events/${mathExam.id}`)
        .bearerToken(marinaToken)
        .json({ title: 'Prova de Lógica' }),
      200
    )
    assert.equal(await importStatus(kept.id), 'draft')
  })

  test('revisão: com nota lançada o evento não vale 0; turma arquivada tira Aplicar e Desfazer', async ({
    client,
    assert,
  }) => {
    const { tads, diogo, maraisa, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)
    const adminToken = await loginAs(client, 'admin@agenda.test')
    // Só falta lançada (sem número): mesmo assim o evento não passa a valer 0.
    await expectStatus(putGrade(client, token, mathExam.id, diogo.id, { status: 'absent' }), 201)
    for (const points of [0, -5]) {
      const response = await client
        .put(`${API}/events/${mathExam.id}`)
        .bearerToken(token)
        .json({ points })
      response.assertStatus(422)
      assert.include(fieldOf(response.body()), 'points')
    }
    const stored = await AcademicEvent.findOrFail(mathExam.id)
    assert.equal(Number(stored.points), 10)

    const bia = await addStudent(tads, 'bia@agenda.test', 'Bia Souza')
    const applied = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'bia@agenda.test', score: '7' }])
    )
    await expectStatus(
      client.post(`${API}/grade-imports/${applied.id}/apply`).bearerToken(token).json({}),
      200
    )
    const draft = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'bia@agenda.test', score: '8' }])
    )
    await expectStatus(
      client.post(`${API}/classes/${tads.id}/archive`).bearerToken(adminToken),
      200
    )

    const list = await expectStatus(
      client.get(`${API}/grade-imports?eventId=${mathExam.id}`).bearerToken(token),
      200
    )
    const items = (list.body() as Envelope<ImportDetail[]>).data
    const draftItem = items.find((item) => item.id === draft.id)!
    const appliedItem = items.find((item) => item.id === applied.id)!
    assert.isFalse(draftItem.canApply)
    assert.isTrue(draftItem.canDiscard)
    assert.isFalse(appliedItem.canUndo)
    for (const response of [
      await client.post(`${API}/grade-imports/${draft.id}/apply`).bearerToken(token).json({}),
      await client.delete(`${API}/grade-imports/${applied.id}`).bearerToken(token),
    ]) {
      response.assertStatus(409)
      assert.equal((response.body() as { code: string }).code, 'ARCHIVED')
    }
    assert.equal(await scoreOf(mathExam.id, bia.id), 700)
    await expectStatus(client.delete(`${API}/grade-imports/${draft.id}`).bearerToken(token), 200)
  })

  test('revisão: descartar não marca como descartada a importação que já foi aplicada', async ({
    client,
    assert,
  }) => {
    const { diogo, maraisa, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)
    const draft = await createImport(
      client,
      token,
      importBody(mathExam.id, [{ identifier: 'diogo@agenda.test', score: '8' }])
    )
    // O Descartar leu o rascunho; antes de ele gravar, o Aplicar chega e grava as notas.
    const stale = await GradeImport.findOrFail(draft.id)
    assert.equal(stale.status, 'draft')
    await expectStatus(
      client.post(`${API}/grade-imports/${draft.id}/apply`).bearerToken(token).json({}),
      200
    )
    const discarded = await db.transaction((trx) =>
      GradeService.discard({ trx, gradeImportId: stale.id, actorId: maraisa.id })
    )
    assert.isFalse(discarded)
    assert.equal(await importStatus(draft.id), 'applied')
    assert.equal(await scoreOf(mathExam.id, diogo.id), 800)
    assert.isNull(
      await AuditLog.query()
        .where('action', 'grade_import.discard')
        .where('entityId', draft.id)
        .first()
    )
    // O Desfazer continua valendo.
    await expectStatus(client.delete(`${API}/grade-imports/${draft.id}`).bearerToken(token), 200)
    assert.isUndefined(await scoreOf(mathExam.id, diogo.id))
  })

  test('revisão: corpo da importação acima de 1 MB é recusado com 413 e nada é gravado', async ({
    client,
    assert,
  }) => {
    const { maraisa, mathExam } = await demo()
    const before = await gradeSnapshot()
    const request = client
      .post(`${API}/grade-imports`)
      .bearerToken(await loginAs(client, maraisa.email))
      .json(
        importBody(
          mathExam.id,
          Array.from({ length: 2000 }, (_, index) => ({
            identifier: `aluno${index}@agenda.test`,
            name: 'n'.repeat(600),
            score: '1',
          }))
        )
      )
    // O bodyparser responde 413 sem ler o resto do corpo; conforme o momento, o cliente lê o
    // 413 ou vê a conexão fechada no meio do envio. Nos dois casos nada chega ao controller.
    try {
      const response = await request
      response.assertStatus(413)
    } catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ECONNRESET')
    }
    // A foto inclui as importações: nenhum rascunho foi criado.
    assert.deepEqual(await gradeSnapshot(), before)
  })

  test('revisão: seed de novo não recria a nota desfeita nem a apagada na demonstração', async ({
    client,
    assert,
  }) => {
    const { diogo, maraisa, pastExam, pastAssignment } = await demo()
    const token = await loginAs(client, maraisa.email)
    const demoImport = await GradeImport.query().where('academicEventId', pastExam.id).firstOrFail()
    const undone = await expectStatus(
      client.delete(`${API}/grade-imports/${demoImport.id}`).bearerToken(token),
      200
    )
    assert.deepEqual(
      (undone.body() as Envelope<{ undone: { restored: number; removed: number } }>).data.undone,
      { restored: 0, removed: 1 }
    )
    await expectStatus(putGrade(client, token, pastAssignment.id, diogo.id, { score: null }), 200)

    await new DemoSeeder(db.connection()).run()
    await new DemoSeeder(db.connection()).run()

    assert.isUndefined(await scoreOf(pastExam.id, diogo.id))
    assert.isUndefined(await scoreOf(pastAssignment.id, diogo.id))
    assert.equal(await importStatus(demoImport.id), 'undone')
    assert.lengthOf(await GradeImport.query().where('academicEventId', pastExam.id), 1)
  })
})
