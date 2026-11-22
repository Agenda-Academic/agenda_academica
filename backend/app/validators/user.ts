import vine, { SimpleMessagesProvider } from '@vinejs/vine'

/**
 * Shared rules for email and password.
 */
// O e-mail é guardado e comparado sempre em minúsculas e sem espaços: no celular o teclado
// costuma pôr a primeira letra em maiúscula.
const email = () => vine.string().trim().toLowerCase().email().maxLength(254)
const password = () => vine.string().minLength(8).maxLength(32)
const notificationChannel = () => vine.enum(['email'])

/** O nome aparece em avisos, listas e e-mails: sem teto, um nome gigante quebra as telas. */
export const MAX_NAME_LENGTH = 120

/**
 * Validator to use when performing self-signup
 */
export const signupValidator = vine.create({
  fullName: vine.string().maxLength(MAX_NAME_LENGTH).nullable(),
  email: email().unique({ table: 'users', column: 'email', caseInsensitive: true }),
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

/** "Esqueci minha senha": o e-mail da conta. */
export const forgotPasswordValidator = vine.create({
  email: email(),
})

/** Senha nova pelo link do e-mail (token de 32 bytes em base64url). */
export const resetPasswordValidator = vine.create({
  token: vine.string().trim().minLength(20).maxLength(128),
  password: password(),
  passwordConfirmation: password().sameAs('password'),
})

/**
 * PATCH /users/:id/role: a coordenação nomeia uma docente para a coordenação (`admin`) ou devolve
 * alguém da coordenação à docência (`teacher`). Aluno e responsável nunca entram por aqui.
 */
export const updateUserRoleValidator = vine.create({
  role: vine.enum(['admin', 'teacher'] as const),
})
updateUserRoleValidator.messagesProvider = new SimpleMessagesProvider({
  'role.required': 'Escolha o papel da pessoa: coordenação ou docente.',
  'role.enum': 'O papel precisa ser coordenação (admin) ou docente (teacher).',
})

export const updateProfileValidator = vine.create({
  fullName: vine.string().maxLength(MAX_NAME_LENGTH).nullable().optional(),
  defaultReminderMinutes: vine.number().min(15).max(10080).optional(),
  notificationChannel: notificationChannel().optional(),
})
