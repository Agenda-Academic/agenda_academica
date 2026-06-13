import vine from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)
const notificationChannel = () => vine.enum(['email', 'push'])

/**
 * Validator to use when performing self-signup
 */
export const signupValidator = vine.create({
  fullName: vine.string().nullable(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
  // Auto-cadastro nunca cria administradores; contas admin sao
  // provisionadas por seed/operacao.
  role: vine.enum(['student', 'teacher']).optional(),
  registration: vine.string().nullable().optional(),
})

/**
 * Validator to use before validating user credentials
 * during login
 */
export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
})

export const updateProfileValidator = vine.create({
  fullName: vine.string().nullable().optional(),
  defaultReminderMinutes: vine.number().min(15).max(10080).optional(),
  notificationChannel: notificationChannel().optional(),
})
