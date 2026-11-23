import JoinWithoutApproval from '#database/migrations/1794159884444_join_by_code_without_approval'
import AcademicClass from '#models/academic_class'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/**
 * Migration de 2026-11-23: entrar pelo código deixou de ser pedido. Os pedidos que esperavam
 * viram matrícula ativa e as turmas sem código ganham um, já ligado.
 */

async function student(email: string) {
  return User.create({
    email,
    fullName: email.split('@')[0],
    password: 'password123',
    role: 'student',
  })
}

test.group('Entrada pelo código sem aprovação (migration)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('pedidos antigos viram matrícula ativa e turma sem código ganha um ligado', async ({
    assert,
  }) => {
    const tads = await AcademicClass.findByOrFail('name', 'TADS 5')
    const inf = await AcademicClass.findByOrFail('name', 'INF 3A')
    const tadsCourse = await Course.findByOrFail('code', 'TADS')

    // um pedido na TADS 5 e um adulto pedindo para entrar no integrado
    const adult = await student('pedido.antigo@agenda.test')
    const teen = await student('pedido.integrado@agenda.test')
    await Enrollment.create({
      userId: adult.id,
      academicClassId: tads.id,
      status: 'pending',
      source: 'code',
    })
    await Enrollment.create({
      userId: teen.id,
      academicClassId: inf.id,
      status: 'pending',
      source: 'code',
    })

    // turma sem código, turma arquivada sem código e turma com o código desligado
    const year = DateTime.now().year
    const plain = {
      courseId: tadsCourse.id,
      year,
      semester: 2,
      period: '1º período',
      shift: 'noturno',
    }
    const withoutCode = await AcademicClass.create({ ...plain, name: 'TADS 1', active: true })
    const archived = await AcademicClass.create({
      ...plain,
      name: 'TADS 2',
      active: true,
      archivedAt: DateTime.now(),
    })
    const disabled = await AcademicClass.create({
      ...plain,
      name: 'TADS 4',
      active: true,
      joinCode: 'ZZZZ2222',
      joinCodeActive: false,
    })

    await new JoinWithoutApproval(db.connection(), 'entrada', false).execUp()

    const [pending] = await db.from('enrollments').where('status', 'pending').count('* as total')
    assert.equal(Number(pending.total), 0)
    await teen.refresh()
    await adult.refresh()
    assert.isTrue(teen.isMinor, 'quem entra no integrado fica marcado como menor')
    assert.isFalse(adult.isMinor)

    await withoutCode.refresh()
    assert.match(withoutCode.joinCode ?? '', /^[0-9A-HJKMNP-TV-Z]{8}$/)
    assert.isTrue(withoutCode.joinCodeActive)
    await archived.refresh()
    assert.isNull(archived.joinCode)
    await disabled.refresh()
    assert.equal(disabled.joinCode, 'ZZZZ2222')
    assert.isFalse(disabled.joinCodeActive)
    // as turmas que já tinham código continuam com o mesmo
    await tads.refresh()
    assert.equal(tads.joinCode, 'TADS5K7Q')
  })
})

test.group('Código de turma antigo com letra fora do alfabeto', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('o aluno entra digitando o código como está gravado (a demonstração tinha INF1AH4R)', async ({
    assert,
    client,
  }) => {
    // o alfabeto de hoje não tem I, L nem O (viram 1 e 0 na digitação), mas a demonstração foi semeada
    // com INF1AH4R: sem a busca pelo código digitado, nenhum aluno entraria com ele
    const tads = await AcademicClass.findByOrFail('name', 'TADS 5')
    tads.joinCode = 'INF1AH4R'
    tads.joinCodeActive = true
    await tads.save()
    const aluno = await student('codigo.antigo@agenda.test')

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: aluno.email, password: 'password123' })
    login.assertStatus(200)
    const token = (login.body() as unknown as { data: { token: string } }).data.token

    for (const digitado of ['inf1-ah4r', 'INF1AH4R']) {
      await Enrollment.query().where('userId', aluno.id).delete()
      const join = await client.post('/api/v1/enrollments/join').bearerToken(token).json({ code: digitado })
      join.assertStatus(201)
      const matricula = await Enrollment.query()
        .where('userId', aluno.id)
        .where('academicClassId', tads.id)
        .firstOrFail()
      assert.equal(matricula.status, 'active')
    }
  })
})
