import { appTimezone, parseIsoDateTime } from '#services/date_time_service'
import { eventWhen } from '#services/reminder_email'
import env from '#start/env'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'

/**
 * O campus de Três Lagoas fica em Mato Grosso do Sul (UTC-4, sem horário de verão). Sem a
 * variável APP_TIMEZONE o servidor tem que falar a hora do campus, e não a de São Paulo.
 */
test.group('Fuso da instituição (MS)', () => {
  test('o padrão é America/Campo_Grande', ({ assert }) => {
    if (env.get('APP_TIMEZONE')) {
      return
    }
    assert.equal(appTimezone(), 'America/Campo_Grande')
  })

  test('o padrão é UTC-4 fixo, sem horário de verão', ({ assert }) => {
    if (env.get('APP_TIMEZONE')) {
      return
    }
    assert.equal(DateTime.local().setZone(appTimezone()).offset, -240)
  })

  test('o e-mail escreve a hora do campus: 23:00 UTC é 19:00 em MS', ({ assert }) => {
    if (env.get('APP_TIMEZONE')) {
      return
    }
    const prova = DateTime.fromISO('2026-11-26T23:00:00Z')
    assert.equal(eventWhen(prova), 'quinta-feira, 26 de novembro, às 19:00')
  })

  test('data do PDF sem horário vira meia-noite de MS (04:00 UTC), no mesmo dia', ({ assert }) => {
    if (env.get('APP_TIMEZONE')) {
      return
    }
    const feriado = parseIsoDateTime('2027-01-01T00:00:00')
    assert.isNotNull(feriado)
    assert.equal(feriado!.toISO(), '2027-01-01T04:00:00.000Z')
    // visto de volta no fuso do campus, continua sendo 01/01 às 00:00
    assert.equal(feriado!.setZone(appTimezone()).toFormat('dd/MM/yyyy HH:mm'), '01/01/2027 00:00')
  })

  test('datas com offset explícito (o front sempre manda ISO com offset) não mudam', ({
    assert,
  }) => {
    const instante = parseIsoDateTime('2026-11-26T19:00:00-04:00')
    assert.equal(instante!.toISO(), '2026-11-26T23:00:00.000Z')
  })
})
