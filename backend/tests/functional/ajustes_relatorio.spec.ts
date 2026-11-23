import User from '#models/user'
import { MAX_NAME_LENGTH } from '#validators/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

/**
 * Ajustes do relatório de testes de 22/11/2026: as iniciais do avatar e o teto do tamanho do nome.
 */

const API = '/api/v1'

test.group('Iniciais do avatar', () => {
  const initials = (fullName: string | null) => {
    const user = new User()
    user.fullName = fullName
    user.email = 'alguem@teste.dev'
    return user.initials
  }

  test('primeira letra do primeiro e do segundo nome', ({ assert }) => {
    assert.equal(initials('Diogo Queiroz da Silva'), 'DQ')
    assert.equal(initials('Ana Clara Ribeiro'), 'AC')
    assert.equal(initials('Coordenação Acadêmica'), 'CA')
  })

  test('"da", "de", "do", "das", "dos" e "e" não valem como segundo nome', ({ assert }) => {
    assert.equal(initials('Maria da Silva'), 'MS')
    assert.equal(initials('João de Souza'), 'JS')
    assert.equal(initials('Ana dos Santos Lima'), 'AS')
    assert.equal(initials('Pedro e Paulo Alves'), 'PP')
  })

  test('"Prof." e "Profa." não entram, e nome só vira as duas primeiras letras', ({ assert }) => {
    assert.equal(initials('Profa. Marina Souza'), 'MS')
    assert.equal(initials('Profa. Maraísa'), 'MA')
    assert.equal(initials('Maria da'), 'MA')
  })

  test('espaços sobrando e nome em branco não quebram', ({ assert }) => {
    assert.equal(initials('  Diogo   Queiroz  '), 'DQ')
    assert.equal(initials('   '), '')
  })
})

test.group('Limite do tamanho do nome', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const signupBody = (fullName: string, email: string) => ({
    fullName,
    email,
    password: 'password123',
    passwordConfirmation: 'password123',
  })

  test('cadastro de responsável aceita o teto e recusa 1 a mais, com o campo certo', async ({
    client,
    assert,
  }) => {
    const ok = await client
      .post(`${API}/auth/signup`)
      .json(signupBody('A'.repeat(MAX_NAME_LENGTH), 'nome.limite@agenda.test'))
    ok.assertStatus(200)

    const tooLong = await client
      .post(`${API}/auth/signup`)
      .json(signupBody('A'.repeat(MAX_NAME_LENGTH + 1), 'nome.longo@agenda.test'))
    tooLong.assertStatus(422)
    const errors = (tooLong.body() as unknown as { errors: { field: string; rule: string }[] })
      .errors
    assert.deepEqual(
      errors.map((error) => [error.field, error.rule]),
      [['fullName', 'maxLength']]
    )
    assert.isNull(await User.findBy('email', 'nome.longo@agenda.test'))
  })

  test('o perfil também tem teto, e o nome de 10 mil caracteres não passa', async ({
    client,
    assert,
  }) => {
    const login = await client
      .post(`${API}/auth/login`)
      .json({ email: 'aluno@agenda.test', password: 'password123' })
    login.assertStatus(200)
    const token = (login.body() as { data: { token: string } }).data.token

    const huge = await client
      .put(`${API}/account/profile`)
      .bearerToken(token)
      .json({ fullName: 'B'.repeat(10_000) })
    huge.assertStatus(422)

    const edge = await client
      .put(`${API}/account/profile`)
      .bearerToken(token)
      .json({ fullName: 'Diogo '.repeat(20).trim() })
    edge.assertStatus(200)
    const user = await User.findByOrFail('email', 'aluno@agenda.test')
    assert.isAtMost(user.fullName!.length, MAX_NAME_LENGTH)
  })
})
