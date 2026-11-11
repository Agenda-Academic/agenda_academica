/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Entrar com o Google (opcional: sem o client ID e o segredo, o botão avisa que não está disponível)
  GOOGLE_CLIENT_ID: Env.schema.string.optional(),
  GOOGLE_CLIENT_SECRET: Env.schema.secret.optional(),
  // Endereço do front, para onde a volta do Google leva a pessoa (padrão: http://localhost:3000)
  FRONTEND_URL: Env.schema.string.optional({ format: 'url', tld: false }),

  // Lembretes por e-mail pelo Brevo (opcional: sem a chave, o lembrete só aparece no sistema)
  BREVO_API_KEY: Env.schema.secret.optional(),
  // Remetente verificado no Brevo
  MAIL_FROM: Env.schema.string.optional({ format: 'email' }),
  MAIL_FROM_NAME: Env.schema.string.optional(),
})
