import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import AuditLog from '#models/audit_log'
import Enrollment from '#models/enrollment'
import Grade from '#models/grade'
import GradeChange from '#models/grade_change'
import GuardianLink from '#models/guardian_link'
import Notification from '#models/notification'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/**
 * PUT /events/:id/grades: lançamento em lote da planilha de notas. Tudo ou nada, as mesmas
 * regras do PUT por aluno, o relatório do evento de volta e aviso quando a nota publicada muda.
 */

const API = '/api/v1'

type Envelope<T> = { data: T }
type BulkError = { field: string; rule: string; message: string; index: number; studentId: number }
type StudentRow = {
  studentId: number
  enrollmentStatus: string | null
  grade: { id: number; score: number | null; scoreText: string | null; status: string } | null
}
type BulkReply = {
  data: {
    event: { id: number; maxScore: number | null; gradesPublishedAt: string | null }
    counts: { students: number; graded: number; absent: number; excused: number; missing: number }
    students: StudentRow[]
  }
  summary: { created: number; updated: number; cleared: number; unchanged: number }
  notified: { students: number; guardians: number } | null
  message: string
}

async function loginAs(client: any, email: string) {
  const response = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as unknown as Envelope<{ token: string }>).data.token
}

async function expectStatus(request: any, status: number) {
  const response = await request
  response.assertStatus(status)
  return response
}

function putBulk(client: any, token: string, eventId: number, grades: object[]) {
  return client.put(`${API}/events/${eventId}/grades`).bearerToken(token).json({ grades })
}

async function addStudent(academicClass: AcademicClass, email: string, fullName: string) {
  const user = await User.create({ fullName, email, password: 'password123', role: 'student' })
  await Enrollment.create({
    userId: user.id,
    academicClassId: academicClass.id,
    status: 'active',
    source: 'admin',
    registration: null,
  })
  return user
}

async function demo() {
  const [tads, maraisa, marina, admin, diogo, ana, maria] = await Promise.all([
    AcademicClass.findByOrFail('name', 'TADS 5'),
    User.findByOrFail('email', 'maraisa@agenda.test'),
    User.findByOrFail('email', 'marina@agenda.test'),
    User.findByOrFail('email', 'admin@agenda.test'),
    User.findByOrFail('email', 'diogo@agenda.test'),
    User.findByOrFail('email', 'ana@agenda.test'),
    User.findByOrFail('email', 'maria@agenda.test'),
  ])
  const event = (title: string) =>
    AcademicEvent.query().where('title', title).where('academicClassId', tads.id).firstOrFail()
  const [mathExam, pastExam] = await Promise.all([
    event('Prova de Matemática'),
    event('Prova 1 de Matemática'),
  ])
  return { tads, maraisa, marina, admin, diogo, ana, maria, mathExam, pastExam }
}

async function gradesOf(eventId: number) {
  const grades = await Grade.query().where('academicEventId', eventId).orderBy('studentId')
  return grades.map((grade) => [grade.studentId, grade.score, grade.status])
}

test.group('Notas em lote (planilha)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('sucesso: grava nota, falta, dispensa e apaga numa vez; devolve o relatório do evento', async ({
    client,
    assert,
  }) => {
    const { tads, maraisa, diogo, mathExam } = await demo()
    const bia = await addStudent(tads, 'bia.lote@agenda.test', 'Bia Lote')
    const caio = await addStudent(tads, 'caio.lote@agenda.test', 'Caio Lote')
    const token = await loginAs(client, maraisa.email)

    const first = await putBulk(client, token, mathExam.id, [
      { studentId: diogo.id, score: 850, status: 'graded' },
      { studentId: bia.id, status: 'absent' },
      { studentId: caio.id, score: null, status: 'excused' },
    ])
    first.assertStatus(200)
    const reply = first.body() as unknown as BulkReply
    assert.deepEqual(reply.summary, { created: 3, updated: 0, cleared: 0, unchanged: 0 })
    assert.isNull(reply.notified)
    assert.equal(reply.message, '3 notas salvas.')
    assert.equal(reply.data.event.id, mathExam.id)
    const row = (id: number) => reply.data.students.find((item) => item.studentId === id)
    assert.equal(row(diogo.id)?.grade?.scoreText, '8,5')
    assert.equal(row(bia.id)?.grade?.status, 'absent')
    assert.equal(row(caio.id)?.grade?.status, 'excused')
    assert.isNull(row(caio.id)?.grade?.score)
    assert.equal(reply.data.counts.graded, 1)
    assert.equal(reply.data.counts.absent, 1)
    assert.equal(reply.data.counts.excused, 1)

    // Segunda rodada: muda uma, apaga outra, repete a terceira sem mudança.
    const second = await putBulk(client, token, mathExam.id, [
      { studentId: diogo.id, score: 900, status: 'graded' },
      { studentId: bia.id, status: 'cleared' },
      { studentId: caio.id, status: 'excused' },
    ])
    second.assertStatus(200)
    const again = second.body() as unknown as BulkReply
    assert.deepEqual(again.summary, { created: 0, updated: 1, cleared: 1, unchanged: 1 })
    assert.equal(again.message, '2 notas salvas.')
    assert.isNull(again.data.students.find((item) => item.studentId === bia.id)?.grade)

    const grade = await Grade.query()
      .where('academicEventId', mathExam.id)
      .where('studentId', diogo.id)
      .firstOrFail()
    assert.equal(grade.score, 900)
    const changes = await GradeChange.query().where('gradeId', grade.id).orderBy('id')
    assert.deepEqual(
      changes.map((change) => [change.oldScore, change.newScore, change.source]),
      [
        [null, 850, 'manual'],
        [850, 900, 'manual'],
      ]
    )
    const audit = await AuditLog.query()
      .where('entity', 'grade')
      .where('entityId', grade.id)
      .orderBy('id')
    assert.deepEqual(
      audit.map((item) => item.action),
      ['grade.create', 'grade.update']
    )
    // O registro não guarda o valor da nota.
    assert.notInclude(JSON.stringify(audit.map((item) => item.meta)), '900')

    // Nada mudou: 200 com a frase certa.
    const same = await putBulk(client, token, mathExam.id, [
      { studentId: diogo.id, score: 900, status: 'graded' },
    ])
    same.assertStatus(200)
    assert.equal((same.body() as unknown as BulkReply).message, 'Nenhuma nota mudou.')
  })

  test('nota fora do intervalo, situação sem nota ou aluno repetido: 422 e nada é gravado', async ({
    client,
    assert,
  }) => {
    const { tads, maraisa, diogo, mathExam } = await demo()
    const bia = await addStudent(tads, 'bia.lote@agenda.test', 'Bia Lote')
    const token = await loginAs(client, maraisa.email)
    const before = await gradesOf(mathExam.id)

    const outOfRange = await putBulk(client, token, mathExam.id, [
      { studentId: diogo.id, score: 800, status: 'graded' },
      { studentId: bia.id, score: 1001, status: 'graded' },
    ])
    outOfRange.assertStatus(422)
    const errors = (outOfRange.body() as unknown as { errors: BulkError[] }).errors
    assert.lengthOf(errors, 1)
    assert.equal(errors[0].field, 'grades.1.score')
    assert.equal(errors[0].rule, 'range')
    assert.equal(errors[0].studentId, bia.id)
    assert.equal(errors[0].message, 'A nota precisa estar entre 0 e 10.')
    assert.deepEqual(await gradesOf(mathExam.id), before)

    const mixed = await putBulk(client, token, mathExam.id, [
      { studentId: diogo.id, status: 'graded' },
      { studentId: bia.id, score: 500, status: 'absent' },
      { studentId: diogo.id, score: 700, status: 'graded' },
    ])
    mixed.assertStatus(422)
    assert.deepEqual(
      (mixed.body() as unknown as { errors: BulkError[] }).errors.map((item) => [
        item.field,
        item.rule,
      ]),
      [
        ['grades.0.score', 'required'],
        ['grades.1.score', 'prohibited'],
        ['grades.2.studentId', 'distinct'],
      ]
    )

    // Casas decimais (score é em centésimos), situação desconhecida e lista vazia: VineJS.
    await expectStatus(
      putBulk(client, token, mathExam.id, [{ studentId: diogo.id, score: 7.5, status: 'graded' }]),
      422
    )
    await expectStatus(
      putBulk(client, token, mathExam.id, [{ studentId: diogo.id, status: 'late' }]),
      422
    )
    await expectStatus(putBulk(client, token, mathExam.id, []), 422)
    assert.deepEqual(await gradesOf(mathExam.id), before)
  })

  test('aluno de outra turma: 422 na linha dele e nenhuma das outras é gravada', async ({
    client,
    assert,
  }) => {
    const { maraisa, diogo, ana, mathExam } = await demo()
    const token = await loginAs(client, maraisa.email)
    const before = await gradesOf(mathExam.id)

    const response = await putBulk(client, token, mathExam.id, [
      { studentId: diogo.id, score: 800, status: 'graded' },
      { studentId: ana.id, score: 600, status: 'graded' },
    ])
    response.assertStatus(422)
    const errors = (response.body() as unknown as { errors: BulkError[] }).errors
    assert.deepEqual(
      errors.map((item) => [item.field, item.rule, item.studentId]),
      [['grades.1.studentId', 'not_in_class', ana.id]]
    )
    assert.equal(errors[0].message, 'Aluno não encontrado nesta turma.')
    assert.deepEqual(await gradesOf(mathExam.id), before)
  })

  test('permissão: aluno, responsável e docente de outra disciplina não lançam; administração lança', async ({
    client,
    assert,
  }) => {
    const { marina, admin, diogo, maria, mathExam } = await demo()
    const before = await gradesOf(mathExam.id)
    const body = [{ studentId: diogo.id, score: 800, status: 'graded' }]

    for (const email of [diogo.email, maria.email]) {
      await expectStatus(putBulk(client, await loginAs(client, email), mathExam.id, body), 403)
    }
    // Docente que vê a prova mas não é da disciplina: 403 com a frase da oferta.
    const other = await putBulk(client, await loginAs(client, marina.email), mathExam.id, body)
    other.assertStatus(403)
    assert.include(
      (other.body() as unknown as { message: string }).message,
      'docente da disciplina'
    )
    // Sem token: 401.
    const anonymous = await client.put(`${API}/events/${mathExam.id}/grades`).json({ grades: body })
    anonymous.assertStatus(401)
    assert.deepEqual(await gradesOf(mathExam.id), before)

    // Administração lança em qualquer turma.
    const adminToken = await loginAs(client, admin.email)
    const ok = await putBulk(client, adminToken, mathExam.id, body)
    ok.assertStatus(200)
    assert.equal((ok.body() as unknown as BulkReply).summary.created, 1)
  })

  test('notas já publicadas: avisa aluno e responsável só de quem mudou; ocultar retira os avisos', async ({
    client,
    assert,
  }) => {
    const { tads, maraisa, diogo, maria, pastExam } = await demo()
    assert.isNotNull(pastExam.gradesPublishedAt)
    const bia = await addStudent(tads, 'bia.lote@agenda.test', 'Bia Lote')
    const token = await loginAs(client, maraisa.email)
    const link = await GuardianLink.query()
      .where('guardianId', maria.id)
      .where('studentId', diogo.id)
      .firstOrFail()
    assert.equal(link.status, 'active')

    const noticeIds = async () => {
      const rows = await Notification.query().where('kind', 'grades_published').select('id')
      return rows.map((item) => item.id)
    }
    const existing = new Set(await noticeIds())
    const newNotices = async () => {
      const all = await noticeIds()
      const ids = all.filter((id) => !existing.has(id))
      return Notification.query().whereIn('id', ids).orderBy('id')
    }

    // Diogo tinha 7,5: muda para 8. Bia não tinha nota: ganha uma.
    const response = await putBulk(client, token, pastExam.id, [
      { studentId: diogo.id, score: 800, status: 'graded' },
      { studentId: bia.id, score: 600, status: 'graded' },
    ])
    response.assertStatus(200)
    const reply = response.body() as unknown as BulkReply
    assert.deepEqual(reply.summary, { created: 1, updated: 1, cleared: 0, unchanged: 0 })
    assert.deepEqual(reply.notified, { students: 2, guardians: 1 })
    assert.equal(reply.message, '2 notas salvas. Avisamos 2 alunos e 1 responsável da mudança.')

    const notices = await newNotices()
    const toDiogo = notices.find((item) => item.userId === diogo.id)
    const toBia = notices.find((item) => item.userId === bia.id)
    const toMaria = notices.find((item) => item.userId === maria.id)
    assert.equal(toDiogo?.title, `Sua nota de ${pastExam.title} foi atualizada`)
    assert.equal(toDiogo?.link, `?tela=notas&evento=${pastExam.id}`)
    assert.equal(toBia?.title, `Nota publicada: ${pastExam.title}`)
    assert.equal(toMaria?.title, `A nota de Diogo em ${pastExam.title} foi atualizada`)
    assert.equal(toMaria?.link, `?tela=notas&aluno=${diogo.id}&evento=${pastExam.id}`)
    assert.lengthOf(notices, 3)

    // Sem mudança de verdade: ninguém é avisado de novo.
    const same = await putBulk(client, token, pastExam.id, [
      { studentId: diogo.id, score: 800, status: 'graded' },
    ])
    same.assertStatus(200)
    assert.deepEqual((same.body() as unknown as BulkReply).notified, { students: 0, guardians: 0 })
    assert.lengthOf(await newNotices(), 3)

    // Ocultar as notas retira os avisos de mudança ainda não lidos.
    await expectStatus(
      client.delete(`${API}/events/${pastExam.id}/grades/publish`).bearerToken(token),
      200
    )
    assert.lengthOf(await newNotices(), 0)

    // Com as notas ocultas, mudar a nota não avisa ninguém.
    const hidden = await putBulk(client, token, pastExam.id, [
      { studentId: diogo.id, score: 700, status: 'graded' },
    ])
    hidden.assertStatus(200)
    assert.isNull((hidden.body() as unknown as BulkReply).notified)
    assert.lengthOf(await newNotices(), 0)
  })

  test('turma arquivada: 409 ARCHIVED e nada muda', async ({ client, assert }) => {
    const { tads, maraisa, diogo, mathExam } = await demo()
    tads.archivedAt = DateTime.now()
    await tads.save()
    const before = await gradesOf(mathExam.id)
    const response = await putBulk(client, await loginAs(client, maraisa.email), mathExam.id, [
      { studentId: diogo.id, score: 800, status: 'graded' },
    ])
    response.assertStatus(409)
    assert.equal((response.body() as unknown as { code: string }).code, 'ARCHIVED')
    assert.deepEqual(await gradesOf(mathExam.id), before)
  })
})
