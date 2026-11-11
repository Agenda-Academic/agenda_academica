import vine from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)
const notificationChannel = () => vine.enum(['email'])

/**
 * Validator to use when performing self-signup
 */
export const signupValidator = vine.create({
  fullName: vine.string().nullable(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
  // Auto-cadastro nunca cria administradores; contas admin sao
  // provisionadas por seed/operacao. O responsável (`guardian`) se cadastra sem matrícula.
  role: vine.enum(['student', 'teacher', 'guardian']).optional(),
  // Matrícula repetida volta como erro do campo (422), não como falha do banco (500).
  registration: vine
    .string()
    .trim()
    .unique({ table: 'users', column: 'registration' })
    .nullable()
    .optional(),
})

/**
 * Validator to use before validating user credentials
 * during login
 */
export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})

/**
 * Código de uso único da volta do Google (32 bytes em base64url), trocado pelo token de acesso.
 */
export const googleExchangeValidator = vine.create({
  code: vine.string().trim().minLength(1).maxLength(128),
})

export const updateProfileValidator = vine.create({
  fullName: vine.string().nullable().optional(),
  defaultReminderMinutes: vine.number().min(15).max(10080).optional(),
  notificationChannel: notificationChannel().optional(),
})
