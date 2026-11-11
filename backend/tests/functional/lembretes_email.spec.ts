import AcademicEvent from '#models/academic_event'
import Reminder from '#models/reminder'
import User from '#models/user'
import MailService, { BREVO_SEND_URL, isReservedAddress } from '#services/mail_service'
import ReminderDeliveryService from '#services/reminder_delivery_service'
import { timeUntil } from '#services/reminder_email'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/**
 * Lembretes por e-mail, sem rede: o envio vai para uma lista (MailService.fake) e o formato
 * do pedido ao Brevo é conferido com um fetch falso.
 */

const REAL_LOOKING = 'pessoa.teste@estudante.ifms.edu.br'

async function dueReminder(options: {
  email?: string
  startsIn?: { minutes?: number; days?: number }
}) {
  const user = await User.findByOrFail('email', 'diogo@agenda.test')
  if (options.email) {
    user.email = options.email
    await user.save()
  }
  // qualquer evento fora de turma arquivada (turma arquivada não manda lembrete)
  const event = await AcademicEvent.query()
    .where((scope) => {
      scope.whereNull('academicClassId').orWhereHas('academicClass', (classQuery) => {
        classQuery.whereNull('archivedAt')
      })
    })
    .firstOrFail()
  event.title = 'Prova <b>final</b> & revisão'
  event.location = 'Sala 12'
  event.startsAt = DateTime.now()
    .plus(options.startsIn ?? { days: 1 })
    .startOf('minute')
  await event.save()
  const reminder = await Reminder.create({
    userId: user.id,
    academicEventId: event.id,
    channel: 'email',
    offsetMinutes: 1440,
    sendAt: DateTime.now().minus({ minutes: 1 }),
    enabled: true,
  })
  return { user, event, reminder }
}

function outcomeOf(
  result: Awaited<ReturnType<typeof ReminderDeliveryService.sendDue>>,
  id: number
) {
  return result.deliveries.find((delivery) => delivery.reminderId === id)?.outcome
}

test.group('Lembretes por e-mail', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => MailService.restore())

  test('lembrete vencido vai por e-mail uma vez, com o título escapado no HTML', async ({
    assert,
  }) => {
    const outbox = MailService.fake()
    const { reminder } = await dueReminder({ email: REAL_LOOKING })

    const result = await ReminderDeliveryService.sendDue()
    await reminder.refresh()

    assert.equal(outcomeOf(result, reminder.id), 'email')
    assert.isNotNull(reminder.sentAt)
    assert.lengthOf(outbox, 1)
    const [message] = outbox
    assert.equal(message.to, REAL_LOOKING)
    assert.include(message.subject, 'Lembrete: Prova <b>final</b> & revisão')
    assert.include(message.text, 'Faltam 1 dia para este evento')
    assert.include(message.text, 'Local: Sala 12')
    assert.include(message.html, 'Prova &lt;b&gt;final&lt;/b&gt; &amp; revisão')
    assert.notInclude(message.html, '<b>final</b>')
    for (const char of ['—', '·', '…']) {
      assert.notInclude(message.text, char)
    }

    const second = await ReminderDeliveryService.sendDue()
    assert.isUndefined(outcomeOf(second, reminder.id))
    assert.lengthOf(outbox, 1)
  })

  test('conta de demonstração (@agenda.test) só recebe o aviso no sistema', async ({ assert }) => {
    const outbox = MailService.fake()
    const { reminder } = await dueReminder({})

    const result = await ReminderDeliveryService.sendDue()
    await reminder.refresh()

    assert.equal(outcomeOf(result, reminder.id), 'system')
    assert.isNotNull(reminder.sentAt)
    assert.lengthOf(outbox, 0)
  })

  test('evento que já começou não recebe e-mail atrasado', async ({ assert }) => {
    const outbox = MailService.fake()
    const { reminder } = await dueReminder({ email: REAL_LOOKING, startsIn: { minutes: -10 } })

    const result = await ReminderDeliveryService.sendDue()
    await reminder.refresh()

    assert.equal(outcomeOf(result, reminder.id), 'late')
    assert.isNotNull(reminder.sentAt)
    assert.lengthOf(outbox, 0)
  })

  test('falha passageira fica para a próxima rodada; falha de vez encerra', async ({ assert }) => {
    MailService.fake(() => ({ status: 'failed', retry: true, reason: 'http_503' }))
    const { reminder } = await dueReminder({ email: REAL_LOOKING })

    const first = await ReminderDeliveryService.sendDue()
    await reminder.refresh()
    assert.equal(outcomeOf(first, reminder.id), 'retry')
    assert.isNull(reminder.sentAt)
    assert.equal(first.sentCount, first.deliveries.filter((d) => d.outcome !== 'retry').length)

    MailService.fake(() => ({ status: 'failed', retry: false, reason: 'http_400' }))
    const second = await ReminderDeliveryService.sendDue()
    await reminder.refresh()
    assert.equal(outcomeOf(second, reminder.id), 'failed')
    assert.isNotNull(reminder.sentAt)
  })

  test('sem configuração (e sempre nos testes) o envio fica desligado', async ({ assert }) => {
    const { reminder } = await dueReminder({ email: REAL_LOOKING })

    const result = await ReminderDeliveryService.sendDue()
    await reminder.refresh()

    assert.equal(outcomeOf(result, reminder.id), 'system')
    assert.isNotNull(reminder.sentAt)
  })

  test('pedido ao Brevo: endereço, chave no cabeçalho e remetente', async ({ assert }) => {
    const originalFetch = globalThis.fetch
    const calls: { url: string; init: RequestInit }[] = []
    const settings = {
      apiKey: 'chave-falsa',
      fromEmail: 'agenda@exemplo.com.br',
      fromName: 'Agenda',
    }
    const message = {
      to: REAL_LOOKING,
      toName: 'Pessoa',
      subject: 'Assunto',
      text: 't',
      html: '<p>h</p>',
    }

    try {
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response(JSON.stringify({ messageId: '<abc@brevo>' }), { status: 201 })
      }) as typeof fetch
      const sent = await MailService.sendWithBrevo(message, settings)
      assert.deepEqual(sent, { status: 'sent', messageId: '<abc@brevo>' })
      assert.equal(calls[0].url, BREVO_SEND_URL)
      const headers = calls[0].init.headers as Record<string, string>
      assert.equal(headers['api-key'], 'chave-falsa')
      const body = JSON.parse(String(calls[0].init.body))
      assert.deepEqual(body.sender, { email: 'agenda@exemplo.com.br', name: 'Agenda' })
      assert.deepEqual(body.to, [{ email: REAL_LOOKING, name: 'Pessoa' }])
      assert.equal(body.subject, 'Assunto')

      globalThis.fetch = (async () => new Response('{}', { status: 400 })) as typeof fetch
      assert.deepEqual(await MailService.sendWithBrevo(message, settings), {
        status: 'failed',
        retry: false,
        reason: 'http_400',
      })

      globalThis.fetch = (async () => new Response('{}', { status: 429 })) as typeof fetch
      assert.include(await MailService.sendWithBrevo(message, settings), { retry: true })

      globalThis.fetch = (async () => {
        throw new Error('sem rede')
      }) as typeof fetch
      assert.deepEqual(await MailService.sendWithBrevo(message, settings), {
        status: 'failed',
        retry: true,
        reason: 'sem_resposta',
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('endereços de teste e quanto falta', ({ assert }) => {
    assert.isTrue(isReservedAddress('ana@agenda.test'))
    assert.isTrue(isReservedAddress('x@example.com'))
    assert.isTrue(isReservedAddress('x@algo.localhost'))
    assert.isFalse(isReservedAddress('aluno@estudante.ifms.edu.br'))
    assert.isFalse(isReservedAddress('pessoa@gmail.com'))

    const now = DateTime.fromISO('2026-11-12T10:00:00Z')
    assert.equal(timeUntil(now.plus({ minutes: 15 }), now), '15 minutos')
    assert.equal(timeUntil(now.plus({ minutes: 61 }), now), '1 hora')
    assert.equal(timeUntil(now.plus({ hours: 5 }), now), '5 horas')
    assert.equal(timeUntil(now.plus({ days: 2 }), now), '2 dias')
  })
})
