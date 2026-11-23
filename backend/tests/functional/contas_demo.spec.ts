import { DEMO_ACCOUNTS_OFF } from '#services/account_policy_service'
import env from '#start/env'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type Envelope<T> = { data: T }

const API = '/api/v1'

async function login(client: any, email: string, password = 'password123') {
  return client.post(`${API}/auth/login`).json({ email, password })
}

function tokenOf(response: any) {
  return (response.body() as Envelope<{ token: string }>).data.token
}

test.group('Interruptor das contas de demonstração (DEMO_ACCOUNTS)', (group) => {
  const original = env.get('DEMO_ACCOUNTS')

  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => () => {
    env.set('DEMO_ACCOUNTS', original ?? true)
  })

  test('a tela de entrar sabe se os atalhos aparecem', async ({ client, assert }) => {
    const on = await client.get(`${API}/auth/options`)
    on.assertStatus(200)
    assert.deepEqual((on.body() as Envelope<{ demoAccounts: boolean }>).data, {
      demoAccounts: true,
    })

    env.set('DEMO_ACCOUNTS', false)
    const off = await client.get(`${API}/auth/options`)
    assert.deepEqual((off.body() as Envelope<{ demoAccounts: boolean }>).data, {
      demoAccounts: false,
    })
  })

  test('desligadas, as contas @agenda.test não entram e a sessão aberta cai', async ({
    client,
    assert,
  }) => {
    const before = await login(client, 'aluno@agenda.test')
    before.assertStatus(200)
    const token = tokenOf(before)

    env.set('DEMO_ACCOUNTS', false)

    for (const email of ['aluno@agenda.test', 'Admin@Agenda.test']) {
      const denied = await login(client, email)
      denied.assertStatus(403)
      assert.equal((denied.body() as { message: string }).message, DEMO_ACCOUNTS_OFF)
    }

    const profile = await client.get(`${API}/account/profile`).bearerToken(token)
    profile.assertStatus(401)
    assert.equal((profile.body() as unknown as { message: string }).message, DEMO_ACCOUNTS_OFF)
  })

  test('desligadas, as contas de verdade continuam entrando', async ({ client }) => {
    env.set('DEMO_ACCOUNTS', false)

    const signup = await client.post(`${API}/auth/signup`).json({
      fullName: 'Responsável de Verdade',
      email: 'responsavel.real@exemplo.com.br',
      password: 'senha-forte-123',
      passwordConfirmation: 'senha-forte-123',
      role: 'guardian',
    })
    signup.assertStatus(200)

    const again = await login(client, 'responsavel.real@exemplo.com.br', 'senha-forte-123')
    again.assertStatus(200)
    const profile = await client.get(`${API}/account/profile`).bearerToken(tokenOf(again))
    profile.assertStatus(200)
  })
})
