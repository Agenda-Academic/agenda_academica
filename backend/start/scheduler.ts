/*
|--------------------------------------------------------------------------
| Rodada dos lembretes
|--------------------------------------------------------------------------
|
| Com o servidor no ar, confere a cada minuto os lembretes vencidos e manda o e-mail
| (ver ReminderDeliveryService). Só roda no servidor web (o adonisrc.ts carrega este
| arquivo apenas no ambiente "web"), então os testes e os comandos do ace ficam de fora.
|
*/

import ReminderDeliveryService from '#services/reminder_delivery_service'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'

const INTERVAL_MS = 60_000
let running = false

async function runRound() {
  // Uma rodada lenta (o Brevo demorando) não pode começar outra por cima.
  if (running) {
    return
  }
  running = true
  try {
    const result = await ReminderDeliveryService.sendDue()
    if (result.dueCount > 0) {
      logger.info(
        { due: result.dueCount, marked: result.sentCount, emailed: result.emailedCount },
        'lembretes: rodada concluída'
      )
    }
  } catch (error) {
    logger.error({ err: error }, 'lembretes: rodada falhou')
  } finally {
    running = false
  }
}

app.ready(() => {
  const timer = setInterval(runRound, INTERVAL_MS)
  timer.unref()
  app.terminating(() => clearInterval(timer))
  // Logo depois de acordar (o Render gratuito dorme), já confere o que venceu.
  setTimeout(runRound, 5_000).unref()
})
