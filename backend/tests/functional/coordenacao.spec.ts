import { ROLE_MESSAGES } from '#controllers/users_controller'
import AuditLog from '#models/audit_log'
import User from '#models/user'
import env from '#start/env'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

/**
 * Coordenação pela tela: PATCH /users/:id/role nomeia uma docente (`admin`) ou devolve alguém da
 * coordenação à docência (`teacher`). Só a administração principal (conta de administração com o
 * e-mail em ADMIN_EMAILS) pede; as outras administrações recebem 403. GET /users?role=admin lista a
 * coordenação com `isRoot` e `isSelf`, e a conta logada traz `canManageCoordination`. O login com o
 * Google não desfaz a troca (ver login_google.spec.ts).
 */

type Envelope<T> = { data: T }
type DirectoryUser = {
  id: number
  fullName: string | null
  email: string
  role: string
  isRoot: boolean
  isSelf: boolean
}
type FieldErrors = { errors: { field: string; rule: string; message: string }[] }

const API = '/api/v1'

/** Administração principal dos testes: o e-mail fica em ADMIN_EMAILS (a admin@agenda.test, não). */
const ROOT_EMAIL = 'principal.coordenacao@agenda.test'

function createRoot(email = ROOT_EMAIL, fullName = 'Coordenação Principal') {
  return User.create({ fullName, email, password: 'password123', role: 'admin' })
}

async function loginAs(client: any, email: string) {
  const response = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
  response.assertStatus(200)
  return (response.body() as unknown as Envelope<{ token: string }>).data.token
}

function setRole(client: any, token: string, userId: number, role: string) {
  return client.patch(`${API}/users/${userId}/role`).bearerToken(token).json({ role })
}

async function coordination(client: any, token: string) {
  const response = await client.get(`${API}/users`).bearerToken(token).qs({ role: 'admin' })
  response.assertStatus(200)
  return (response.body() as unknown as Envelope<DirectoryUser[]>).data
}

async function roleLogs(userId: number) {
  return AuditLog.query()
    .whereIn('action', ['user.admin_grant', 'user.admin_revoke'])
    .where('subjectUserId', userId)
    .orderBy('id', 'asc')
}

test.group('Coordenação pela tela', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    const original = env.get('ADMIN_EMAILS')
    env.set('ADMIN_EMAILS', ROOT_EMAIL)
    return () => env.set('ADMIN_EMAILS', original ?? '')
  })

  test('a administração principal nomeia uma docente, que aparece na lista e passa a ter acesso de coordenação', async ({
    client,
    assert,
  }) => {
    const root = await createRoot()
    const admin = await User.findByOrFail('email', 'admin@agenda.test')
    const marina = await User.findByOrFail('email', 'marina@agenda.test')
    assert.equal(marina.role, 'teacher')
    const token = await loginAs(client, root.email)

    // antes: a docente não busca pessoas (só a coordenação)
    const marinaToken = await loginAs(client, marina.email)
    ;(await client.get(`${API}/users`).bearerToken(marinaToken)).assertStatus(403)

    const response = await setRole(client, token, marina.id, 'admin')
    response.assertStatus(200)
    const data = (response.body() as unknown as Envelope<DirectoryUser>).data
    assert.deepEqual(data, {
      id: marina.id,
      fullName: marina.fullName,
      email: marina.email,
      role: 'admin',
      isRoot: false,
      isSelf: false,
    })
    await marina.refresh()
    assert.equal(marina.role, 'admin')

    // a lista da coordenação traz as três, com "Você" para quem pediu e "Principal" só para a raiz
    const list = await coordination(client, token)
    assert.sameMembers(
      list.map((item) => item.email),
      [root.email, admin.email, marina.email]
    )
    assert.deepEqual(
      list.filter((item) => item.isSelf).map((item) => item.id),
      [root.id]
    )
    assert.deepEqual(
      list.filter((item) => item.isRoot).map((item) => item.id),
      [root.id]
    )

    // o token que ela já tinha vale com o papel novo, sem entrar de novo
    ;(await client.get(`${API}/users`).bearerToken(marinaToken)).assertStatus(200)

    // o registro de ações guarda quem nomeou, quem foi nomeada e o antes e depois
    const logs = await roleLogs(marina.id)
    assert.lengthOf(logs, 1)
    assert.equal(logs[0].action, 'user.admin_grant')
    assert.equal(logs[0].actorId, root.id)
    assert.equal(logs[0].entity, 'user')
    assert.equal(logs[0].entityId, marina.id)
    assert.deepEqual(JSON.parse(logs[0].meta ?? '{}'), { from: 'teacher', to: 'admin' })

    // pedir de novo o mesmo papel não muda nada nem grava outro registro
    ;(await setRole(client, token, marina.id, 'admin')).assertStatus(200)
    assert.lengthOf(await roleLogs(marina.id), 1)
  })

  test('a administração principal remove alguém, que volta a ser docente e perde o acesso', async ({
    client,
    assert,
  }) => {
    const root = await createRoot()
    const marina = await User.findByOrFail('email', 'marina@agenda.test')
    const token = await loginAs(client, root.email)
    ;(await setRole(client, token, marina.id, 'admin')).assertStatus(200)
    const marinaToken = await loginAs(client, marina.email)

    const response = await setRole(client, token, marina.id, 'teacher')
    response.assertStatus(200)
    const data = (response.body() as unknown as Envelope<DirectoryUser>).data
    assert.equal(data.role, 'teacher')
    await marina.refresh()
    assert.equal(marina.role, 'teacher')

    assert.notInclude(
      (await coordination(client, token)).map((item) => item.email),
      marina.email
    )
    ;(await client.get(`${API}/users`).bearerToken(marinaToken)).assertStatus(403)

    const logs = await roleLogs(marina.id)
    assert.deepEqual(
      logs.map((log) => log.action),
      ['user.admin_grant', 'user.admin_revoke']
    )
    assert.equal(logs[1].actorId, root.id)
    assert.deepEqual(JSON.parse(logs[1].meta ?? '{}'), { from: 'admin', to: 'teacher' })
  })

  test('administração comum (demonstração ou coordenação nomeada) recebe 403 ao nomear e ao remover, sem mudar nada', async ({
    client,
    assert,
  }) => {
    const root = await createRoot()
    const admin = await User.findByOrFail('email', 'admin@agenda.test')
    const marina = await User.findByOrFail('email', 'marina@agenda.test')
    const maraisa = await User.findByOrFail('email', 'maraisa@agenda.test')
    const rootToken = await loginAs(client, root.email)
    const adminToken = await loginAs(client, admin.email)

    // a conta de demonstração é administração, mas não é a principal: não nomeia
    const promote = await setRole(client, adminToken, marina.id, 'admin')
    promote.assertStatus(403)
    assert.equal((promote.body() as { message: string }).message, ROLE_MESSAGES.forbidden)

    // a principal nomeia a Marina: ela vira coordenação, mas também não nomeia nem remove ninguém
    ;(await setRole(client, rootToken, marina.id, 'admin')).assertStatus(200)
    const marinaToken = await loginAs(client, marina.email)
    const attempts: [string, number, string][] = [
      [marinaToken, maraisa.id, 'admin'],
      [marinaToken, admin.id, 'teacher'],
      [marinaToken, marina.id, 'teacher'],
      [adminToken, marina.id, 'teacher'],
      [adminToken, root.id, 'teacher'],
      [adminToken, admin.id, 'teacher'],
    ]
    for (const [token, userId, role] of attempts) {
      const response = await setRole(client, token, userId, role)
      response.assertStatus(403)
      assert.equal((response.body() as { message: string }).message, ROLE_MESSAGES.forbidden)
    }

    // as duas continuam cuidando do resto: buscam docentes e alunos e veem a lista da coordenação
    for (const token of [adminToken, marinaToken]) {
      ;(await client.get(`${API}/users`).bearerToken(token).qs({ role: 'teacher' })).assertStatus(
        200
      )
      assert.lengthOf(await coordination(client, token), 3)
    }

    for (const person of [root, admin, marina, maraisa]) {
      await person.refresh()
    }
    assert.equal(root.role, 'admin')
    assert.equal(admin.role, 'admin')
    assert.equal(marina.role, 'admin')
    assert.equal(maraisa.role, 'teacher')
    // só a nomeação feita pela principal ficou registrada
    assert.lengthOf(await roleLogs(marina.id), 1)
    assert.lengthOf(await roleLogs(maraisa.id), 0)
    assert.lengthOf(await roleLogs(admin.id), 0)

    // sem ADMIN_EMAILS (como no ambiente local), ninguém define a coordenação pela tela
    env.set('ADMIN_EMAILS', '')
    const nobody = await setRole(client, rootToken, marina.id, 'teacher')
    nobody.assertStatus(403)
    assert.equal((nobody.body() as { message: string }).message, ROLE_MESSAGES.forbidden)
    await marina.refresh()
    assert.equal(marina.role, 'admin')
  })

  test('403 para docente, aluno e responsável, sem mudar nada', async ({ client, assert }) => {
    const marina = await User.findByOrFail('email', 'marina@agenda.test')
    const admin = await User.findByOrFail('email', 'admin@agenda.test')

    for (const email of ['maraisa@agenda.test', 'aluno@agenda.test', 'responsavel@agenda.test']) {
      const token = await loginAs(client, email)
      const promote = await setRole(client, token, marina.id, 'admin')
      promote.assertStatus(403)
      assert.equal((promote.body() as { message: string }).message, ROLE_MESSAGES.forbidden)
      ;(await setRole(client, token, admin.id, 'teacher')).assertStatus(403)
    }
    // uma docente também não se nomeia
    const maraisa = await User.findByOrFail('email', 'maraisa@agenda.test')
    ;(
      await setRole(client, await loginAs(client, maraisa.email), maraisa.id, 'admin')
    ).assertStatus(403)

    await marina.refresh()
    await admin.refresh()
    await maraisa.refresh()
    assert.equal(marina.role, 'teacher')
    assert.equal(maraisa.role, 'teacher')
    assert.equal(admin.role, 'admin')
    assert.lengthOf(await roleLogs(marina.id), 0)

    // sem login: 401
    ;(await client.patch(`${API}/users/${marina.id}/role`).json({ role: 'admin' })).assertStatus(
      401
    )
  })

  test('422 ao nomear aluno ou responsável, ao devolver à docência quem não é da coordenação e com papel inválido', async ({
    client,
    assert,
  }) => {
    const token = await loginAs(client, (await createRoot()).email)
    const diogo = await User.findByOrFail('email', 'aluno@agenda.test')
    const maria = await User.findByOrFail('email', 'responsavel@agenda.test')
    const maraisa = await User.findByOrFail('email', 'maraisa@agenda.test')

    for (const person of [diogo, maria]) {
      const response = await setRole(client, token, person.id, 'admin')
      response.assertStatus(422)
      const [error] = (response.body() as unknown as FieldErrors).errors
      assert.equal(error.field, 'role')
      assert.equal(error.message, ROLE_MESSAGES.notTeacher)

      // nem "voltar a docente" transforma aluno ou responsável em docente
      const back = await setRole(client, token, person.id, 'teacher')
      back.assertStatus(422)
      assert.equal(
        (back.body() as unknown as FieldErrors).errors[0].message,
        ROLE_MESSAGES.notAdmin
      )
    }

    for (const role of ['student', 'guardian', 'chefe', '']) {
      const response = await setRole(client, token, maraisa.id, role)
      response.assertStatus(422)
      assert.equal((response.body() as unknown as FieldErrors).errors[0].field, 'role')
    }
    ;(
      await client.patch(`${API}/users/${maraisa.id}/role`).bearerToken(token).json({})
    ).assertStatus(422)
    ;(await setRole(client, token, 999999, 'admin')).assertStatus(404)

    await diogo.refresh()
    await maria.refresh()
    await maraisa.refresh()
    assert.equal(diogo.role, 'student')
    assert.equal(maria.role, 'guardian')
    assert.equal(maraisa.role, 'teacher')
  })

  test('409 ao remover a si mesma e ao remover outra administração principal (ADMIN_EMAILS)', async ({
    client,
    assert,
  }) => {
    const root = await createRoot()
    const admin = await User.findByOrFail('email', 'admin@agenda.test')
    const token = await loginAs(client, root.email)

    const self = await setRole(client, token, root.id, 'teacher')
    self.assertStatus(409)
    assert.deepEqual(self.body(), { code: 'OWN_ACCESS', message: ROLE_MESSAGES.ownAccess })
    await root.refresh()
    assert.equal(root.role, 'admin')

    // outra principal: o e-mail dela também está na lista do servidor (sem diferença de maiúsculas)
    const other = await createRoot('segunda.principal@agenda.test', 'Segunda Principal')
    env.set('ADMIN_EMAILS', `${ROOT_EMAIL}, Segunda.Principal@agenda.test`)

    const list = await coordination(client, token)
    assert.isTrue(list.find((item) => item.id === root.id)!.isRoot)
    assert.isTrue(list.find((item) => item.id === other.id)!.isRoot)
    assert.isFalse(list.find((item) => item.id === admin.id)!.isRoot)

    const response = await setRole(client, token, other.id, 'teacher')
    response.assertStatus(409)
    assert.deepEqual(response.body(), { code: 'ROOT_ADMIN', message: ROLE_MESSAGES.rootAdmin })
    await other.refresh()
    assert.equal(other.role, 'admin')

    // a segunda também não tira o próprio acesso, e nomeia e remove outra pessoa normalmente
    const otherToken = await loginAs(client, other.email)
    ;(await setRole(client, otherToken, other.id, 'teacher')).assertStatus(409)
    const marina = await User.findByOrFail('email', 'marina@agenda.test')
    ;(await setRole(client, otherToken, marina.id, 'admin')).assertStatus(200)
    ;(await setRole(client, otherToken, marina.id, 'teacher')).assertStatus(200)
    assert.lengthOf(await roleLogs(root.id), 0)
    assert.lengthOf(await roleLogs(other.id), 0)
  })

  test('canManageCoordination vem true só para a administração principal, no login, no perfil e no /context', async ({
    client,
    assert,
  }) => {
    const root = await createRoot()
    // e-mail da lista numa conta de docente: não é administração, então não é a principal
    await User.create({
      fullName: 'Docente Listada',
      email: 'docente.listada@agenda.test',
      password: 'password123',
      role: 'teacher',
    })
    const listed = [ROOT_EMAIL, 'docente.listada@agenda.test']
    env.set('ADMIN_EMAILS', listed.join(','))

    const expected: Record<string, boolean> = {
      [root.email]: true,
      'admin@agenda.test': false,
      'marina@agenda.test': false,
      'docente.listada@agenda.test': false,
      'aluno@agenda.test': false,
      'responsavel@agenda.test': false,
    }
    type Account = { canManageCoordination: boolean }
    for (const [email, can] of Object.entries(expected)) {
      const login = await client.post(`${API}/auth/login`).json({ email, password: 'password123' })
      login.assertStatus(200)
      const session = (login.body() as unknown as Envelope<{ token: string; user: Account }>).data
      assert.strictEqual(session.user.canManageCoordination, can, `login de ${email}`)

      const profile = await client.get(`${API}/account/profile`).bearerToken(session.token)
      profile.assertStatus(200)
      const account = (profile.body() as unknown as Envelope<Account>).data
      assert.strictEqual(account.canManageCoordination, can, `perfil de ${email}`)

      const context = await client.get(`${API}/context`).bearerToken(session.token)
      context.assertStatus(200)
      const body = context.body() as { data?: { user: Account }; user?: Account }
      assert.strictEqual(
        (body.data ?? body).user!.canManageCoordination,
        can,
        `/context de ${email}`
      )

      // a lista ADMIN_EMAILS não sai nas respostas: cada conta só vê o próprio e-mail
      for (const other of listed.filter((item) => item !== email)) {
        for (const response of [login, profile, context]) {
          assert.notInclude(JSON.stringify(response.body()), other)
        }
      }
    }

    // a coordenação nomeada pela principal continua sem o card Coordenação
    const marina = await User.findByOrFail('email', 'marina@agenda.test')
    ;(await setRole(client, await loginAs(client, root.email), marina.id, 'admin')).assertStatus(
      200
    )
    const marinaLogin = await client
      .post(`${API}/auth/login`)
      .json({ email: marina.email, password: 'password123' })
    marinaLogin.assertStatus(200)
    const marinaSession = (
      marinaLogin.body() as unknown as Envelope<{ user: Account & { role: string } }>
    ).data
    assert.equal(marinaSession.user.role, 'admin')
    assert.isFalse(marinaSession.user.canManageCoordination)
  })
})
