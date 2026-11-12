import { RESET_REQUEST_MESSAGE, RESET_TOKEN_INVALID } from '#controllers/password_resets_controller'
import User from '#models/user'
import MailService, { type MailMessage } from '#services/mail_service'
import PasswordResetService from '#services/password_reset_service'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/**
 * Esqueci minha senha, sem rede: o e-mail vai para uma lista (MailService.fake) e o link sai de lá.
 */

type Envelope<T> = { data: T }
type SessionBody = Envelope<{ token: string; user: { email: string } }>
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }

const API = '/api/v1'
const EMAIL = 'pessoa.teste@estudante.ifms.edu.br'
const NEW_PASSWORD = 'senhaNova123'

/** A conta de teste com um e-mail que recebe e-mail (as @agenda.test nunca recebem). */
async function realAccount() {
  const user = await User.findByOrFail('email', 'diogo@agenda.test')
  user.email = EMAIL
  await user.save()
  return user
}

function tokenFrom(message: MailMessage | undefined) {
  const match = message?.text.match(/\?redefinir=([A-Za-z0-9_-]+)/)
  return match ? match[1] : ''
}

async function askLink(client: any, email = EMAIL) {
  return client.post(`${API}/auth/forgot-password`).json({ email })
}

async function resetWith(client: any, token: string, password = NEW_PASSWORD) {
  return client
    .post(`${API}/auth/reset-password`)
    .json({ token, password, passwordConfirmation: password })
}

test.group('Esqueci minha senha', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    PasswordResetService.clearThrottle()
    return () => MailService.restore()
  })

  test('pedir o link manda o e-mail e guarda só o hash do token', async ({ client, assert }) => {
    const outbox = MailService.fake()
    const user = await realAccount()

    const response = await askLink(client, '  Pessoa.Teste@estudante.ifms.edu.br ')
    response.assertStatus(200)
    assert.equal((response.body() as { message: string }).message, RESET_REQUEST_MESSAGE)

    assert.lengthOf(outbox, 1)
    const [message] = outbox
    assert.equal(message.to, EMAIL)
    assert.equal(message.subject, 'Criar senha nova na Agenda Acadêmica')
    assert.include(message.text, 'O link vale por 1 hora')
    const token = tokenFrom(message)
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.include(message.html, `?redefinir=${token}`)
    for (const char of ['—', '·', '…']) {
      assert.notInclude(message.text, char)
    }

    const rows = await db.from('password_reset_tokens').where('user_id', user.id)
    assert.lengthOf(rows, 1)
    assert.notEqual(rows[0].token_hash, token)
    assert.lengthOf(rows[0].token_hash, 64)
  })

  test('e-mail sem conta recebe a mesma resposta e nenhum e-mail', async ({ client, assert }) => {
    const outbox = MailService.fake()
    const response = await askLink(client, 'ninguem@estudante.ifms.edu.br')

    response.assertStatus(200)
    assert.equal((response.body() as { message: string }).message, RESET_REQUEST_MESSAGE)
    assert.lengthOf(outbox, 0)
  })

  test('a senha nova entra, a antiga não, e o link não serve duas vezes', async ({
    client,
    assert,
  }) => {
    const outbox = MailService.fake()
    await realAccount()

    // uma sessão aberta antes (outro aparelho) deixa de valer depois da troca
    const before = await client
      .post(`${API}/auth/login`)
      .json({ email: EMAIL, password: 'password123' })
    before.assertStatus(200)
    const oldToken = (before.body() as unknown as SessionBody).data.token

    await askLink(client)
    const token = tokenFrom(outbox[0])

    const reset = await resetWith(client, token)
    reset.assertStatus(200)
    const session = (reset.body() as unknown as SessionBody).data
    assert.equal(session.user.email, EMAIL)
    assert.isString(session.token)

    const profile = await client.get(`${API}/account/profile`).bearerToken(session.token)
    profile.assertStatus(200)
    const stale = await client.get(`${API}/account/profile`).bearerToken(oldToken)
    stale.assertStatus(401)

    const withNew = await client
      .post(`${API}/auth/login`)
      .json({ email: EMAIL, password: NEW_PASSWORD })
    withNew.assertStatus(200)
    const withOld = await client
      .post(`${API}/auth/login`)
      .json({ email: EMAIL, password: 'password123' })
    withOld.assertStatus(400)

    const again = await resetWith(client, token, 'outraSenha123')
    again.assertStatus(422)
    assert.deepEqual((again.body() as unknown as FieldErrors).errors, [
      { field: 'token', rule: 'invalid', message: RESET_TOKEN_INVALID },
    ])
  })

  test('link vencido ou trocado por um novo não vale', async ({ client, assert }) => {
    const outbox = MailService.fake()
    const user = await realAccount()

    await askLink(client)
    const first = tokenFrom(outbox[0])
    await askLink(client)
    const second = tokenFrom(outbox[1])
    assert.notEqual(first, second)

    // o pedido novo invalida o anterior
    const old = await resetWith(client, first)
    old.assertStatus(422)

    // passou de 1 hora
    await db
      .from('password_reset_tokens')
      .where('user_id', user.id)
      .update({ expires_at: DateTime.utc().minus({ minutes: 1 }).toSQL({ includeOffset: false }) })
    const expired = await resetWith(client, second)
    expired.assertStatus(422)
  })

  test('muitos pedidos para o mesmo e-mail esperam alguns minutos', async ({ client, assert }) => {
    MailService.fake()
    await realAccount()

    for (let i = 0; i < 3; i++) {
      const response = await askLink(client)
      response.assertStatus(200)
    }
    const blocked = await askLink(client)
    blocked.assertStatus(429)
    assert.equal((blocked.body() as { code: string }).code, 'TOO_MANY_ATTEMPTS')
  })

  test('senha curta ou confirmação diferente voltam por campo', async ({ client, assert }) => {
    const short = await client
      .post(`${API}/auth/reset-password`)
      .json({ token: 'x'.repeat(43), password: '123', passwordConfirmation: '123' })
    short.assertStatus(422)
    assert.include(
      (short.body() as unknown as FieldErrors).errors.map((error) => error.field),
      'password'
    )

    const different = await client
      .post(`${API}/auth/reset-password`)
      .json({ token: 'x'.repeat(43), password: NEW_PASSWORD, passwordConfirmation: 'outra12345' })
    different.assertStatus(422)
    assert.include(
      (different.body() as unknown as FieldErrors).errors.map((error) => error.field),
      'passwordConfirmation'
    )
  })
})
