import AnnualSemesterMigration from '#database/migrations/1794159879444_set_annual_semester_for_integrado_classes'
import DemoSeeder from '#database/seeders/demo_datum_seeder'
import AcademicClass, { ANNUAL_SEMESTER } from '#models/academic_class'
import AuditLog from '#models/audit_log'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import User from '#models/user'
import AttemptLimiterService from '#services/attempt_limiter_service'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'

type Envelope<T> = { data: T }
type FieldError = { field: string; rule: string; message: string }
type ClassBody = {
  id: number
  courseId: number
  name: string
  year: number
  semester: number
  course: { id: number; modality: string }
}

const API = '/api/v1'
const ANNUAL_ONLY_INTEGRADO = 'Turma de curso integrado é anual e não tem semestre.'
const SEMESTER_NOT_ANNUAL = 'Só a turma de curso integrado é anual. Escolha o 1º ou o 2º semestre.'
const SEMESTER_REQUIRED = 'Escolha o semestre da turma: 1º ou 2º.'
const SEMESTER_LEAVING_INTEGRADO =
  'A turma deixa de ser anual fora do curso integrado. Escolha o 1º ou o 2º semestre.'
/** "2026/0" em qualquer texto ou campo da resposta. */
const TERM_ZERO = /\b\d{4}\/0\b/

async function loginAs(client: any, email: string) {
  const response = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as unknown as Envelope<{ token: string }>).data.token
}

async function signup(client: any, email: string) {
  const response = await client.post(`${API}/auth/signup`).json({
    fullName: 'Conta Nova',
    email,
    password: 'password123',
    passwordConfirmation: 'password123',
    role: 'student',
  })
  response.assertStatus(200)
  return (response.body() as unknown as Envelope<{ token: string; user: { id: number } }>).data
}

function errorsOf(body: unknown) {
  return (body as { errors?: FieldError[] }).errors ?? []
}

async function countOf(query: any) {
  const [row] = await query.count('* as total')
  return Number(row.$extras.total)
}

/** O que está gravado no banco, sem passar pela API. */
async function storedClass(id: number) {
  const academicClass = await AcademicClass.findOrFail(id)
  return { courseId: academicClass.courseId, semester: academicClass.semester }
}

async function isMinor(userId: number) {
  const user = await User.findOrFail(userId)
  return user.isMinor
}

function metaOf<T>(entry: AuditLog) {
  return JSON.parse(entry.meta ?? '{}') as T
}

function semesterError(body: unknown) {
  return errorsOf(body).find((error) => error.field === 'semester')
}

async function demo() {
  const [tads, inf] = await Promise.all([
    AcademicClass.findByOrFail('name', 'TADS 5'),
    AcademicClass.findByOrFail('name', 'INF 3A'),
  ])
  return { tads, inf, superiorCourseId: tads.courseId, integradoCourseId: inf.courseId }
}

test.group('Turma anual (curso integrado)', (group) => {
  group.each.setup(() => {
    AttemptLimiterService.clear()
    return testUtils.db().withGlobalTransaction()
  })

  test('seed: INF 3A é anual (semestre 0) e rodar de novo não muda id nem semestre', async ({
    assert,
  }) => {
    const { tads, inf } = await demo()
    assert.equal(inf.semester, ANNUAL_SEMESTER)
    assert.isTrue(inf.isAnnual)
    assert.equal(tads.semester, 2)
    assert.isFalse(tads.isAnnual)
    await inf.load('course')
    assert.equal(inf.course.modality, 'integrado')

    // A INF 3A gravada no 2º semestre por um seed antigo é a mesma linha: só vira anual.
    await AcademicClass.query().where('id', inf.id).update({ semester: 2 })
    await new DemoSeeder(db.connection()).run()
    await new DemoSeeder(db.connection()).run()

    const rows = await AcademicClass.query().where('name', 'INF 3A')
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].id, inf.id)
    assert.equal(rows[0].semester, ANNUAL_SEMESTER)
    assert.deepInclude(await storedClass(tads.id), { semester: 2 })
    assert.equal(tads.id, 1)
  })

  test('criar no curso integrado: sem semestre grava 0, 0 explícito vale, 1 ou 2 dá 422', async ({
    client,
    assert,
  }) => {
    const { integradoCourseId } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const base = {
      courseId: integradoCourseId,
      year: 2026,
      shift: 'integral',
      period: '1º ano',
    }

    for (const [name, extra] of [
      ['INF 1A', {}],
      ['INF 1B', { semester: 0 }],
      ['INF 1C', { semester: null }],
    ] as const) {
      const created = await client
        .post(`${API}/classes`)
        .bearerToken(token)
        .json({ ...base, name, ...extra })
      created.assertStatus(201)
      const data = (created.body() as unknown as Envelope<ClassBody>).data
      assert.equal(data.semester, ANNUAL_SEMESTER)
      assert.equal(data.course.modality, 'integrado')
      assert.deepInclude(await storedClass(data.id), { semester: ANNUAL_SEMESTER })
    }

    for (const semester of [1, 2]) {
      const refused = await client
        .post(`${API}/classes`)
        .bearerToken(token)
        .json({ ...base, name: 'INF 1D', semester })
      refused.assertStatus(422)
      assert.deepEqual(semesterError(refused.body()), {
        field: 'semester',
        rule: 'annual',
        message: ANNUAL_ONLY_INTEGRADO,
      })
    }
    assert.isNull(await AcademicClass.findBy('name', 'INF 1D'))

    const audit = await AuditLog.query()
      .where('action', 'class.create')
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.equal(metaOf<{ semester: number }>(audit).semester, ANNUAL_SEMESTER)
  })

  test('criar em curso de outra modalidade: semestre 1 ou 2 obrigatório; 0 dá 422', async ({
    client,
    assert,
  }) => {
    const { superiorCourseId } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const base = {
      courseId: superiorCourseId,
      name: 'TADS 1',
      year: 2026,
      shift: 'noturno',
      period: '1º período',
    }

    const missing = await client.post(`${API}/classes`).bearerToken(token).json(base)
    missing.assertStatus(422)
    assert.deepEqual(semesterError(missing.body()), {
      field: 'semester',
      rule: 'required',
      message: SEMESTER_REQUIRED,
    })

    const empty = await client
      .post(`${API}/classes`)
      .bearerToken(token)
      .json({ ...base, semester: null })
    empty.assertStatus(422)
    assert.equal(semesterError(empty.body())?.rule, 'required')

    const annual = await client
      .post(`${API}/classes`)
      .bearerToken(token)
      .json({ ...base, semester: 0 })
    annual.assertStatus(422)
    assert.deepEqual(semesterError(annual.body()), {
      field: 'semester',
      rule: 'annual',
      message: SEMESTER_NOT_ANNUAL,
    })

    const outOfRange = await client
      .post(`${API}/classes`)
      .bearerToken(token)
      .json({ ...base, semester: 3 })
    outOfRange.assertStatus(422)
    assert.isDefined(semesterError(outOfRange.body()))
    assert.isNull(await AcademicClass.findBy('name', 'TADS 1'))

    const created = await client
      .post(`${API}/classes`)
      .bearerToken(token)
      .json({ ...base, semester: 1 })
    created.assertStatus(201)
    assert.equal((created.body() as unknown as Envelope<ClassBody>).data.semester, 1)
  })

  test('editar trocando o curso: indo para o integrado vira anual; saindo, exige 1 ou 2', async ({
    client,
    assert,
  }) => {
    const { inf, superiorCourseId, integradoCourseId } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')

    const created = await client.post(`${API}/classes`).bearerToken(token).json({
      courseId: superiorCourseId,
      name: 'Turma Móvel',
      year: 2026,
      semester: 2,
      shift: 'noturno',
      period: '2º período',
    })
    created.assertStatus(201)
    const id = (created.body() as unknown as Envelope<ClassBody>).data.id
    const put = (body: Record<string, unknown>, classId = id) =>
      client.put(`${API}/classes/${classId}`).bearerToken(token).json(body)

    // Indo para o integrado: o semestre vira 0, sem precisar mandar.
    const toIntegrado = await put({ courseId: integradoCourseId })
    toIntegrado.assertStatus(200)
    const annual = (toIntegrado.body() as unknown as Envelope<ClassBody>).data
    assert.equal(annual.semester, ANNUAL_SEMESTER)
    assert.equal(annual.courseId, integradoCourseId)
    assert.equal(annual.course.modality, 'integrado')
    const audit = await AuditLog.query()
      .where('action', 'class.update')
      .where('entityId', id)
      .orderBy('id', 'desc')
      .firstOrFail()
    const meta = metaOf<{ before: { semester: number }; after: { semester: number } }>(audit)
    assert.equal(meta.before.semester, 2)
    assert.equal(meta.after.semester, ANNUAL_SEMESTER)

    // Saindo do integrado sem semestre: 422, e nada muda.
    const leavingWithout = await put({ courseId: superiorCourseId })
    leavingWithout.assertStatus(422)
    assert.deepEqual(semesterError(leavingWithout.body()), {
      field: 'semester',
      rule: 'required',
      message: SEMESTER_LEAVING_INTEGRADO,
    })
    const leavingAnnual = await put({ courseId: superiorCourseId, semester: 0 })
    leavingAnnual.assertStatus(422)
    assert.equal(semesterError(leavingAnnual.body())?.rule, 'annual')
    let stored = await AcademicClass.findOrFail(id)
    assert.equal(stored.courseId, integradoCourseId)
    assert.equal(stored.semester, ANNUAL_SEMESTER)

    const leaving = await put({ courseId: superiorCourseId, semester: 1 })
    leaving.assertStatus(200)
    assert.equal((leaving.body() as unknown as Envelope<ClassBody>).data.semester, 1)

    // Voltar ao integrado mandando semestre: 422, e nada muda.
    const backWithSemester = await put({ courseId: integradoCourseId, semester: 2 })
    backWithSemester.assertStatus(422)
    assert.equal(semesterError(backWithSemester.body())?.message, ANNUAL_ONLY_INTEGRADO)
    stored = await AcademicClass.findOrFail(id)
    assert.equal(stored.courseId, superiorCourseId)
    assert.equal(stored.semester, 1)

    // Turma de outro curso: editar sem semestre mantém o que ela tem; 0 dá 422.
    const periodOnly = await put({ period: '2º período, noturno' })
    periodOnly.assertStatus(200)
    assert.equal((periodOnly.body() as unknown as Envelope<ClassBody>).data.semester, 1)
    const zero = await put({ semester: 0 })
    zero.assertStatus(422)
    assert.equal(semesterError(zero.body())?.message, SEMESTER_NOT_ANNUAL)

    // Turma anual: continua anual ao editar; 0 explícito vale; 1 ou 2 dá 422.
    const infPeriod = await put({ period: '3º ano, integral' }, inf.id)
    infPeriod.assertStatus(200)
    assert.equal(
      (infPeriod.body() as unknown as Envelope<ClassBody>).data.semester,
      ANNUAL_SEMESTER
    )
    await put({ semester: 0 }, inf.id).then((response: any) => response.assertStatus(200))
    const infSemester = await put({ semester: 2 }, inf.id)
    infSemester.assertStatus(422)
    assert.equal(semesterError(infSemester.body())?.message, ANNUAL_ONLY_INTEGRADO)
    assert.deepInclude(await storedClass(inf.id), { semester: ANNUAL_SEMESTER })
  })

  test('turma anual repetida: 422 no nome e 409 ARCHIVED_DUPLICATE, sem "/0" na mensagem', async ({
    client,
    assert,
  }) => {
    const { inf, superiorCourseId, integradoCourseId } = await demo()
    const token = await loginAs(client, 'admin@agenda.test')
    const payload = {
      courseId: integradoCourseId,
      name: 'inf 3a',
      year: inf.year,
      shift: 'integral',
      period: '3º ano',
    }

    for (const extra of [{}, { semester: 0 }]) {
      const repeated = await client
        .post(`${API}/classes`)
        .bearerToken(token)
        .json({ ...payload, ...extra })
      repeated.assertStatus(422)
      assert.deepEqual(errorsOf(repeated.body()), [
        {
          field: 'name',
          rule: 'unique',
          message: `Já existe a turma INF 3A em ${inf.year} neste curso. Escolha outro nome.`,
        },
      ])
    }

    // O mesmo nome em curso superior é outra turma; levada ao integrado, repete a INF 3A.
    const other = await client.post(`${API}/classes`).bearerToken(token).json({
      courseId: superiorCourseId,
      name: 'INF 3A',
      year: inf.year,
      semester: 2,
      shift: 'noturno',
      period: '3º período',
    })
    other.assertStatus(201)
    const otherId = (other.body() as unknown as Envelope<ClassBody>).data.id
    const moved = await client
      .put(`${API}/classes/${otherId}`)
      .bearerToken(token)
      .json({ courseId: integradoCourseId })
    moved.assertStatus(422)
    assert.equal(errorsOf(moved.body())[0].field, 'name')
    assert.notMatch(errorsOf(moved.body())[0].message, TERM_ZERO)
    assert.deepInclude(await storedClass(otherId), { courseId: superiorCourseId })

    await client
      .post(`${API}/classes/${inf.id}/archive`)
      .bearerToken(token)
      .then((response: any) => response.assertStatus(200))
    const archived = await client.post(`${API}/classes`).bearerToken(token).json(payload)
    archived.assertStatus(409)
    assert.deepEqual(archived.body(), {
      code: 'ARCHIVED_DUPLICATE',
      message: `Já existe a turma INF 3A em ${inf.year}, arquivada. Restaure a turma para usar de novo.`,
      archivedId: inf.id,
    })

    // A turma superior também bate na arquivada ao ir para o integrado.
    const movedToArchived = await client
      .put(`${API}/classes/${otherId}`)
      .bearerToken(token)
      .json({ courseId: integradoCourseId })
    movedToArchived.assertStatus(409)
    assert.equal((movedToArchived.body() as unknown as { archivedId: number }).archivedId, inf.id)
  })

  test('GET /classes: o filtro de semestre traz também as turmas anuais do mesmo ano', async ({
    client,
    assert,
  }) => {
    const { tads, inf, integradoCourseId } = await demo()
    const adminToken = await loginAs(client, 'admin@agenda.test')
    const year = inf.year

    const older = await client
      .post(`${API}/classes`)
      .bearerToken(adminToken)
      .json({
        courseId: integradoCourseId,
        name: 'INF 3A',
        year: year - 1,
        shift: 'integral',
        period: '3º ano',
      })
    older.assertStatus(201)
    const olderId = (older.body() as unknown as Envelope<ClassBody>).data.id

    const idsOf = async (query: string, token = adminToken) => {
      const response = await client.get(`${API}/classes?${query}`).bearerToken(token)
      response.assertStatus(200)
      return (response.body() as unknown as Envelope<ClassBody[]>).data.map((item) => item.id)
    }

    let ids = await idsOf(`year=${year}&semester=2`)
    assert.includeMembers(ids, [tads.id, inf.id])
    assert.notInclude(ids, olderId)

    ids = await idsOf(`year=${year}&semester=1`)
    assert.include(ids, inf.id)
    assert.notInclude(ids, tads.id)
    assert.notInclude(ids, olderId)

    ids = await idsOf(`year=${year - 1}&semester=1`)
    assert.deepEqual(ids, [olderId])

    ids = await idsOf('semester=2')
    assert.includeMembers(ids, [tads.id, inf.id, olderId])

    ids = await idsOf('semester=0')
    assert.sameMembers(ids, [inf.id, olderId])

    ids = await idsOf(`year=${year}&semester=2&courseId=${integradoCourseId}`)
    assert.deepEqual(ids, [inf.id])

    // A docente continua vendo só as turmas dela, com o mesmo filtro.
    const marinaToken = await loginAs(client, 'marina@agenda.test')
    assert.includeMembers(await idsOf(`year=${year}&semester=1`, marinaToken), [inf.id])
    const maraisaToken = await loginAs(client, 'maraisa@agenda.test')
    assert.deepEqual(await idsOf(`year=${year}&semester=1`, maraisaToken), [])
  })

  test('turma anual nas outras rotas: semestre 0, matrícula do integrado e nenhum "/0"', async ({
    client,
    assert,
  }) => {
    const { inf } = await demo()
    const anaToken = await loginAs(client, 'ana@agenda.test')
    const carlosToken = await loginAs(client, 'carlos@agenda.test')
    const marinaToken = await loginAs(client, 'marina@agenda.test')
    const adminToken = await loginAs(client, 'admin@agenda.test')

    const get = async (path: string, token: string) => {
      const response = await client.get(`${API}${path}`).bearerToken(token)
      response.assertStatus(200)
      assert.notMatch(JSON.stringify(response.body()), TERM_ZERO, path)
      return (response.body() as unknown as Envelope<any>).data
    }

    // Aluna da turma anual: contexto e catálogo trazem semestre 0.
    const anaContext = await get('/context', anaToken)
    assert.equal(anaContext.enrollments[0].academicClass.id, inf.id)
    assert.equal(anaContext.enrollments[0].academicClass.semester, ANNUAL_SEMESTER)
    const catalogInf = anaContext.catalog.classes.find((item: { id: number }) => item.id === inf.id)
    assert.equal(catalogInf.semester, ANNUAL_SEMESTER)
    await get('/dashboard', anaToken)
    await get('/events', anaToken)
    await get('/reminders', anaToken)
    await get('/me/grades', anaToken)

    // Responsável da aluna menor: linkedStudents com a turma anual.
    const carlosContext = await get('/context', carlosToken)
    assert.equal(carlosContext.linkedStudents[0].classes[0].id, inf.id)
    assert.equal(carlosContext.linkedStudents[0].classes[0].semester, ANNUAL_SEMESTER)
    await get('/dashboard', carlosToken)
    await get(`/students/${carlosContext.linkedStudents[0].id}/grades`, carlosToken)

    // Docente e administração: contexto, lista e painel da turma.
    const marinaContext = await get('/context', marinaToken)
    const assignment = marinaContext.teachingAssignments.find(
      (item: { academicClassId: number }) => item.academicClassId === inf.id
    )
    assert.equal(assignment.academicClass.semester, ANNUAL_SEMESTER)
    await get('/dashboard', marinaToken)
    await get('/classes', adminToken)
    const detail = await get(`/classes/${inf.id}`, adminToken)
    assert.equal(detail.semester, ANNUAL_SEMESTER)
    await get(`/classes/${inf.id}/students`, adminToken)

    // Entrar com o código: a resposta traz a turma anual.
    const newcomer = await signup(client, 'calouro.integrado@agenda.test')
    const join = await client
      .post(`${API}/enrollments/join`)
      .bearerToken(newcomer.token)
      .json({ code: 'TEC3-AM2X' })
    join.assertStatus(201)
    const joined = (join.body() as unknown as Envelope<any>).data
    assert.equal(joined.academicClass.semester, ANNUAL_SEMESTER)
    assert.equal(joined.message, 'Pedido enviado para INF 3A. A docente ou a secretaria confirma.')
    assert.notMatch(JSON.stringify(join.body()), TERM_ZERO)

    // A regra do curso integrado continua: matrícula ativa marca o aluno como menor.
    const approved = await client
      .patch(`${API}/enrollments/${joined.enrollment.id}`)
      .bearerToken(marinaToken)
      .json({ status: 'active' })
    approved.assertStatus(200)
    assert.isTrue(await isMinor(newcomer.user.id))

    const added = await signup(client, 'outro.integrado@agenda.test')
    const include = await client
      .post(`${API}/classes/${inf.id}/students`)
      .bearerToken(adminToken)
      .json({ userId: added.user.id })
    include.assertStatus(200)
    assert.isTrue(await isMinor(added.user.id))
  })

  test('migration: só UPDATE; turma de curso integrado vira anual e o down volta para 1', async ({
    assert,
  }) => {
    const { inf, superiorCourseId, integradoCourseId } = await demo()
    const make = (courseId: number, name: string, semester: number) =>
      AcademicClass.create({
        courseId,
        name,
        year: 2025,
        semester,
        period: '1º ano',
        shift: 'integral',
        active: true,
      })

    // Estado de antes da migration: a INF 3A no 2º semestre, uma turma legada e um par
    // 2025/1 e 2025/2 com o mesmo nome no curso integrado, e uma turma de curso superior.
    await AcademicClass.query().where('id', inf.id).update({ semester: 2 })
    const legacy = await make(integradoCourseId, 'INF 2B', 1)
    const pairFirst = await make(integradoCourseId, 'INF 2C', 2)
    const pairSecond = await make(integradoCourseId, 'INF 2C', 1)
    const superior = await make(superiorCourseId, 'TADS 2', 2)
    const enrollmentsBefore = await countOf(Enrollment.query())

    await new AnnualSemesterMigration(db.connection(), 'turma_anual', false).execUp()

    const semesterOf = async (id: number) => {
      const stored = await storedClass(id)
      return stored.semester
    }
    assert.equal(await semesterOf(inf.id), ANNUAL_SEMESTER)
    assert.equal(await semesterOf(legacy.id), ANNUAL_SEMESTER)
    // Do par, só a de menor id vira anual; a outra fica como estava (a unique não quebra).
    assert.equal(await semesterOf(pairFirst.id), ANNUAL_SEMESTER)
    assert.equal(await semesterOf(pairSecond.id), 1)
    assert.equal(await semesterOf(superior.id), 2)
    // Nada foi recriado: matrículas, curso e turmas continuam lá.
    assert.equal(await countOf(Enrollment.query()), enrollmentsBefore)
    assert.isNotNull(await Course.find(integradoCourseId))
    assert.isAbove(await countOf(Enrollment.query().where('academicClassId', inf.id)), 0)

    // Rodar de novo não muda nada.
    await new AnnualSemesterMigration(db.connection(), 'turma_anual', false).execUp()
    assert.equal(await semesterOf(pairSecond.id), 1)

    await new AnnualSemesterMigration(db.connection(), 'turma_anual', false).execDown()
    assert.equal(await semesterOf(inf.id), 1)
    assert.equal(await semesterOf(legacy.id), 1)
    // O par já tem a turma no 1º semestre: a anual volta para o 2º.
    assert.equal(await semesterOf(pairFirst.id), 2)
    assert.equal(await semesterOf(pairSecond.id), 1)
    assert.equal(await semesterOf(superior.id), 2)
    assert.equal(await countOf(AcademicClass.query().where('semester', ANNUAL_SEMESTER)), 0)
  })
})
