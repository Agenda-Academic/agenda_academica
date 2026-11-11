import { GOOGLE_CODE_INVALID } from '#controllers/google_auth_controller'
import AcademicClass from '#models/academic_class'
import AuditLog from '#models/audit_log'
import ClassInvite from '#models/class_invite'
import Enrollment from '#models/enrollment'
import User from '#models/user'
import GoogleOAuthService, {
  GOOGLE_COOKIE_PATH,
  GOOGLE_STATE_COOKIE,
  LOGIN_CODE_TTL_MS,
} from '#services/google_oauth_service'
import env from '#start/env'
import { Secret } from '@adonisjs/core/helpers'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { createHash } from 'node:crypto'

/**
 * Entrar com o Google, sem rede: a troca do code pelo id_token é substituída por uma função
 * que devolve um id_token montado aqui. Client ID e segredo são falsos.
 */

type Envelope<T> = { data: T }
type SessionBody = Envelope<{ token: string; user: Record<string, unknown> }>
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }

const API = '/api/v1'
const FAKE_CLIENT_ID = 'cliente-falso-de-teste.apps.googleusercontent.com'
const FAKE_CLIENT_SECRET = 'segredo-falso-de-teste'
const FRONTEND = 'http://localhost:3000'

const originalExchange = GoogleOAuthService.exchangeCode
let exchangeCalls: { code: string; codeVerifier: string; redirectUri: string }[] = []

function encodePart(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** id_token no formato JWT; a assinatura não importa (ver o comentário no service). */
function fakeIdToken(claims: Record<string, unknown>) {
  return `${encodePart({ alg: 'RS256', kid: 'teste', typ: 'JWT' })}.${encodePart(claims)}.assinatura`
}

function googleClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: 'https://accounts.google.com',
    aud: FAKE_CLIENT_ID,
    sub: '109876543210',
    iat: now,
    exp: now + 3600,
    email_verified: true,
    ...overrides,
  }
}

/** A troca do code devolve estes claims (sem rede). */
function stubExchange(claims: Record<string, unknown>) {
  GoogleOAuthService.exchangeCode = async (code, codeVerifier, settings) => {
    exchangeCalls.push({ code, codeVerifier, redirectUri: settings.redirectUri })
    return fakeIdToken(claims)
  }
}

/** Endereço do 302 (cabeçalho Location). */
function locationOf(response: { header(key: string): string | undefined }) {
  return new URL(response.header('location') ?? '')
}

/** Ida ao Google: o 302 e o cookie com state e code_verifier. */
async function startGoogle(client: any) {
  const response = await client.get(`${API}/auth/google/redirect`).redirects(0)
  response.assertStatus(302)
  const location = locationOf(response)
  const cookie = response.cookie(GOOGLE_STATE_COOKIE)
  return { response, location, cookie, state: location.searchParams.get('state') ?? '' }
}

/** Ida e volta do Google com os claims dados; devolve o endereço do front da resposta. */
async function backFromGoogle(
  client: any,
  claims: Record<string, unknown>,
  options: { state?: string; withCookie?: boolean } = {}
) {
  const start = await startGoogle(client)
  stubExchange(claims)
  let request = client
    .get(`${API}/auth/google/callback`)
    .qs({ code: 'codigo-do-google', state: options.state ?? start.state })
    .redirects(0)
  if (options.withCookie !== false) {
    request = request.withEncryptedCookie(GOOGLE_STATE_COOKIE, start.cookie?.value)
  }
  const response = await request
  response.assertStatus(302)
  return { response, start, location: locationOf(response) }
}

function assertFrontError(assert: any, location: URL, reason: string) {
  assert.equal(location.origin, FRONTEND)
  assert.equal(location.pathname, '/')
  assert.deepEqual([...location.searchParams.entries()], [['google_erro', reason]])
}

/** Volta com sucesso: só `?google=<código>`, nada de code, state ou token no endereço. */
function loginCodeFrom(assert: any, location: URL) {
  assert.equal(location.origin, FRONTEND)
  assert.deepEqual([...location.searchParams.keys()], ['google'])
  const code = location.searchParams.get('google') ?? ''
  assert.match(code, /^[A-Za-z0-9_-]{43}$/)
  return code
}

async function countUsers() {
  const [row] = await User.query().count('* as total')
  return Number(row.$extras.total)
}

test.group('Entrar com o Google', (group) => {
  const original = {
    clientId: env.get('GOOGLE_CLIENT_ID'),
    clientSecret: env.get('GOOGLE_CLIENT_SECRET'),
    frontendUrl: env.get('FRONTEND_URL'),
  }

  group.setup(() => {
    env.set('GOOGLE_CLIENT_ID', FAKE_CLIENT_ID)
    env.set('GOOGLE_CLIENT_SECRET', new Secret(FAKE_CLIENT_SECRET))
    env.set('FRONTEND_URL', FRONTEND)
    return () => {
      env.set('GOOGLE_CLIENT_ID', original.clientId ?? '')
      if (original.clientSecret) {
        env.set('GOOGLE_CLIENT_SECRET', original.clientSecret)
      } else {
        env.set('GOOGLE_CLIENT_SECRET', '')
      }
      env.set('FRONTEND_URL', original.frontendUrl ?? '')
    }
  })

  group.each.setup(() => {
    exchangeCalls = []
    // nenhum teste vai à rede: sem um stub, a troca falha
    GoogleOAuthService.exchangeCode = async () => {
      throw new Error('a troca do code não pode ir à rede nos testes')
    }
    return () => {
      GoogleOAuthService.exchangeCode = originalExchange
      env.set('GOOGLE_CLIENT_ID', FAKE_CLIENT_ID)
    }
  })
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('redirect sem configuração volta ao front com nao_configurado', async ({
    client,
    assert,
  }) => {
    env.set('GOOGLE_CLIENT_ID', '')

    const response = await client.get(`${API}/auth/google/redirect`).redirects(0)
    response.assertStatus(302)
    assertFrontError(assert, locationOf(response), 'nao_configurado')
    assert.isUndefined(response.cookie(GOOGLE_STATE_COOKIE))
  })

  test('redirect com configuração vai ao Google com PKCE, state e prompt', async ({
    client,
    assert,
  }) => {
    const { location, cookie, state } = await startGoogle(client)

    assert.equal(location.origin, 'https://accounts.google.com')
    assert.equal(location.pathname, '/o/oauth2/v2/auth')
    const params = location.searchParams
    assert.equal(params.get('client_id'), FAKE_CLIENT_ID)
    assert.equal(
      params.get('redirect_uri'),
      `${env.get('APP_URL').replace(/\/+$/, '')}/api/v1/auth/google/callback`
    )
    assert.equal(params.get('response_type'), 'code')
    assert.equal(params.get('scope'), 'openid email profile')
    assert.equal(params.get('code_challenge_method'), 'S256')
    assert.equal(params.get('prompt'), 'select_account')
    assert.match(state, /^[A-Za-z0-9_-]{43}$/)
    assert.isNull(params.get('client_secret'))

    // o cookie criptografado guarda o mesmo state e o verifier do code_challenge
    assert.exists(cookie)
    assert.equal(cookie.value.state, state)
    const challenge = createHash('sha256').update(cookie.value.codeVerifier).digest('base64url')
    assert.equal(params.get('code_challenge'), challenge)
    assert.equal(cookie.path, GOOGLE_COOKIE_PATH)
    assert.isTrue(cookie.httpOnly)
    assert.equal(String(cookie.sameSite).toLowerCase(), 'lax')
    assert.equal(cookie.maxAge, 600)
  })

  test('callback com state errado ou sem cookie volta com erro estado', async ({
    client,
    assert,
  }) => {
    const claims = googleClaims({ email: 'diogo@agenda.test' })

    const wrong = await backFromGoogle(client, claims, { state: 'outro-state' })
    assertFrontError(assert, wrong.location, 'estado')
    // o cookie é apagado mesmo com o erro
    const cleared = wrong.response.cookie(GOOGLE_STATE_COOKIE)
    assert.exists(cleared)
    assert.equal(cleared.path, GOOGLE_COOKIE_PATH)
    assert.isBelow(cleared.expires.getTime(), Date.now())

    const withoutCookie = await backFromGoogle(client, claims, { withCookie: false })
    assertFrontError(assert, withoutCookie.location, 'estado')

    assert.lengthOf(exchangeCalls, 0)
  })

  test('callback cancelado volta com erro cancelado', async ({ client, assert }) => {
    const start = await startGoogle(client)

    const response = await client
      .get(`${API}/auth/google/callback`)
      .qs({ error: 'access_denied', state: start.state })
      .withEncryptedCookie(GOOGLE_STATE_COOKIE, start.cookie?.value)
      .redirects(0)
    response.assertStatus(302)
    assertFrontError(assert, locationOf(response), 'cancelado')
    assert.lengthOf(exchangeCalls, 0)
  })

  test('aluno @estudante.ifms.edu.br com hd do IFMS cria aluno e aplica convite', async ({
    client,
    assert,
  }) => {
    const tads = await AcademicClass.findByOrFail('name', 'TADS 5')
    const invite = await ClassInvite.create({
      academicClassId: tads.id,
      email: 'nova.aluna@estudante.ifms.edu.br',
    })

    const { location, start } = await backFromGoogle(
      client,
      googleClaims({
        email: 'Nova.Aluna@estudante.ifms.edu.br',
        name: 'Nova Aluna do IFMS',
        hd: 'estudante.ifms.edu.br',
      })
    )
    const code = loginCodeFrom(assert, location)

    // PKCE: a troca recebeu o code do Google, o verifier do cookie e o redirect_uri cadastrado
    assert.deepEqual(exchangeCalls, [
      {
        code: 'codigo-do-google',
        codeVerifier: start.cookie.value.codeVerifier,
        redirectUri: GoogleOAuthService.redirectUri(),
      },
    ])

    const user = await User.findByOrFail('email', 'nova.aluna@estudante.ifms.edu.br')
    assert.equal(user.role, 'student')
    assert.equal(user.fullName, 'Nova Aluna do IFMS')
    assert.isNull(user.registration)
    assert.notEqual(user.password, '')

    const enrollment = await Enrollment.query()
      .where('userId', user.id)
      .where('academicClassId', tads.id)
      .firstOrFail()
    assert.equal(enrollment.status, 'active')
    assert.equal(enrollment.source, 'invite')
    await invite.refresh()
    assert.isNotNull(invite.acceptedAt)

    const log = await AuditLog.query()
      .where('action', 'auth.google_signup')
      .where('subjectUserId', user.id)
      .firstOrFail()
    assert.equal(log.actorId, user.id)
    assert.equal(log.entity, 'user')
    assert.equal(log.entityId, user.id)
    assert.notInclude(log.meta ?? '', '@')

    const exchange = await client.post(`${API}/auth/google/exchange`).json({ code })
    exchange.assertStatus(200)
    assert.equal((exchange.body() as unknown as SessionBody).data.user.id, user.id)
  })

  test('@ifms.edu.br com hd do IFMS cria docente', async ({ client, assert }) => {
    const { location } = await backFromGoogle(
      client,
      googleClaims({
        email: 'professora.nova@ifms.edu.br',
        name: 'Professora Nova',
        hd: 'ifms.edu.br',
      })
    )
    loginCodeFrom(assert, location)

    const user = await User.findByOrFail('email', 'professora.nova@ifms.edu.br')
    assert.equal(user.role, 'teacher')
    assert.equal(user.fullName, 'Professora Nova')
    assert.isNull(user.registration)
    const log = await AuditLog.query()
      .where('action', 'auth.google_signup')
      .where('subjectUserId', user.id)
      .firstOrFail()
    assert.include(log.meta ?? '', 'teacher')
  })

  test('e-mail de outro domínio sem conta volta com dominio e não cria conta', async ({
    client,
    assert,
  }) => {
    const before = await countUsers()

    const personal = await backFromGoogle(
      client,
      googleClaims({ email: 'alguem.de.fora@gmail.com', name: 'Alguém de Fora' })
    )
    assertFrontError(assert, personal.location, 'dominio')

    // e-mail do IFMS, mas sem o hd: não é conta gerenciada pelo Google do IFMS
    const withoutHd = await backFromGoogle(
      client,
      googleClaims({ email: 'sem.hd@estudante.ifms.edu.br', name: 'Sem Hd' })
    )
    assertFrontError(assert, withoutHd.location, 'dominio')

    assert.equal(await countUsers(), before)
    assert.isNull(await AuditLog.findBy('action', 'auth.google_signup'))
  })

  test('conta que já existe, de outro domínio, entra pelo Google', async ({ client, assert }) => {
    const diogo = await User.findByOrFail('email', 'diogo@agenda.test')
    const before = await countUsers()

    const { location } = await backFromGoogle(
      client,
      googleClaims({ email: 'Diogo@Agenda.test', name: 'Outro Nome' })
    )
    const code = loginCodeFrom(assert, location)

    const exchange = await client.post(`${API}/auth/google/exchange`).json({ code })
    exchange.assertStatus(200)
    const data = (exchange.body() as unknown as SessionBody).data
    assert.equal(data.user.id, diogo.id)
    assert.equal(data.user.fullName, diogo.fullName)
    assert.equal(await countUsers(), before)
  })

  test('email_verified false falha', async ({ client, assert }) => {
    const before = await countUsers()

    const { location } = await backFromGoogle(
      client,
      googleClaims({
        email: 'nao.verificado@estudante.ifms.edu.br',
        hd: 'estudante.ifms.edu.br',
        email_verified: false,
      })
    )
    assertFrontError(assert, location, 'falhou')
    assert.equal(await countUsers(), before)
  })

  test('aud errado falha', async ({ client, assert }) => {
    const before = await countUsers()

    const { location } = await backFromGoogle(
      client,
      googleClaims({
        email: 'outro.app@estudante.ifms.edu.br',
        hd: 'estudante.ifms.edu.br',
        aud: 'outro-cliente.apps.googleusercontent.com',
      })
    )
    assertFrontError(assert, location, 'falhou')
    assert.equal(await countUsers(), before)
  })

  test('iss de fora do Google ou id_token vencido falha', async ({ client, assert }) => {
    const base = { email: 'diogo@agenda.test' }
    const cases = [
      googleClaims({ ...base, iss: 'https://accounts.example.com' }),
      googleClaims({ ...base, exp: Math.floor(Date.now() / 1000) - 10 }),
    ]
    for (const claims of cases) {
      const { location } = await backFromGoogle(client, claims)
      assertFrontError(assert, location, 'falhou')
    }
  })

  test('exchange devolve o mesmo formato do login por e-mail e senha', async ({
    client,
    assert,
  }) => {
    const login = await client
      .post(`${API}/auth/login`)
      .json({ email: 'diogo@agenda.test', password: 'password123' })
    login.assertStatus(200)

    const { location } = await backFromGoogle(client, googleClaims({ email: 'diogo@agenda.test' }))
    const exchange = await client
      .post(`${API}/auth/google/exchange`)
      .json({ code: loginCodeFrom(assert, location) })
    exchange.assertStatus(200)

    const byPassword = login.body() as unknown as SessionBody
    const byGoogle = exchange.body() as unknown as SessionBody
    assert.deepEqual(Object.keys(byGoogle).sort(), Object.keys(byPassword).sort())
    assert.deepEqual(Object.keys(byGoogle.data).sort(), Object.keys(byPassword.data).sort())
    assert.deepEqual(byGoogle.data.user, byPassword.data.user)
    assert.isString(byGoogle.data.token)
    assert.equal(byGoogle.data.token.split('_')[0], byPassword.data.token.split('_')[0])
    assert.notEqual(byGoogle.data.token, byPassword.data.token)

    // o token do Google vale como o do login
    const profile = await client.get(`${API}/account/profile`).bearerToken(byGoogle.data.token)
    profile.assertStatus(200)
    assert.equal(
      (profile.body() as unknown as Envelope<{ email: string }>).data.email,
      'diogo@agenda.test'
    )
  })

  test('exchange com código repetido, vencido ou desconhecido responde 422', async ({
    client,
    assert,
  }) => {
    const diogo = await User.findByOrFail('email', 'diogo@agenda.test')
    const { location } = await backFromGoogle(client, googleClaims({ email: 'diogo@agenda.test' }))
    const code = loginCodeFrom(assert, location)

    const first = await client.post(`${API}/auth/google/exchange`).json({ code })
    first.assertStatus(200)

    const expired = GoogleOAuthService.issueLoginCode(
      diogo.id,
      LOGIN_CODE_TTL_MS,
      Date.now() - LOGIN_CODE_TTL_MS - 1000
    )
    for (const attempt of [code, expired, 'codigo-que-nunca-existiu']) {
      const response = await client.post(`${API}/auth/google/exchange`).json({ code: attempt })
      response.assertStatus(422)
      const body = response.body() as unknown as FieldErrors
      assert.deepEqual(body.errors, [
        { field: 'code', rule: 'invalid', message: GOOGLE_CODE_INVALID },
      ])
    }

    const missing = await client.post(`${API}/auth/google/exchange`).json({} as { code: string })
    missing.assertStatus(422)
    assert.equal((missing.body() as unknown as FieldErrors).errors[0].field, 'code')
  })
})
