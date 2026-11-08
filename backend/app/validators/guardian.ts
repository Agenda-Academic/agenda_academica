import { GUARDIAN_RELATIONSHIPS } from '#models/guardian_link'
import { withMessages } from '#validators/management'
import vine from '@vinejs/vine'

/** Validadores da fase 2 (responsável), com as mensagens em português da gestão. */

const relationship = () => vine.enum(GUARDIAN_RELATIONSHIPS)

/** POST /guardian-links/claim: o responsável digita o código e escolhe o parentesco. */
export const claimGuardianCodeValidator = withMessages(
  vine.create({
    code: vine.string().trim().minLength(1).maxLength(20),
    relationship: relationship(),
  })
)

/** PATCH /me/guardians/:id: o aluno compartilha as notas ou confirma o vínculo. */
export const updateMyGuardianValidator = withMessages(
  vine.create({
    shareGrades: vine.boolean().optional(),
    confirm: vine.boolean().optional(),
  })
)

/** DELETE /guardian-links/:id: motivo opcional. */
export const revokeGuardianLinkValidator = withMessages(
  vine.create({
    reason: vine.string().trim().maxLength(200).optional(),
  })
)

/** POST /guardian-links/:id/block: motivo obrigatório. */
export const blockGuardianLinkValidator = withMessages(
  vine.create({
    reason: vine.string().trim().minLength(3).maxLength(200),
  })
)

/**
 * POST /students/:id/guardians: e-mail de uma conta de responsável que já existe. `unblock`
 * confirma que a secretaria quer liberar um vínculo bloqueado.
 */
export const linkGuardianByEmailValidator = withMessages(
  vine.create({
    email: vine.string().trim().toLowerCase().email().maxLength(254),
    relationship: relationship(),
    unblock: vine.boolean().optional(),
  })
)

/** PATCH /users/:id: a secretaria marca ou desmarca o aluno menor de idade. */
export const updateUserValidator = withMessages(
  vine.create({
    isMinor: vine.boolean(),
  })
)
