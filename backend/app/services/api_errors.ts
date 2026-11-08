import type { HttpContext } from '@adonisjs/core/http'

type Response = HttpContext['response']

/** 422 no mesmo formato do VineJS, para o front mostrar o erro abaixo do campo. */
export function fieldError(response: Response, field: string, message: string, rule = 'invalid') {
  return response.unprocessableEntity({ errors: [{ field, rule, message }] })
}

/** 409 com `{ code, message }` e os dados do caso (archivedId, counts...). */
export function conflict(
  response: Response,
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
) {
  return response.conflict({ code, message, ...extra })
}

export function notFound(response: Response, message: string) {
  return response.notFound({ message })
}

export function forbidden(response: Response, message: string) {
  return response.forbidden({ message })
}

/** Lê um id de rota; um valor que não é inteiro positivo vira 0, que nunca existe. */
export function routeId(value: unknown) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : 0
}

export const STUDENT_NOT_FOUND = 'Aluno não encontrado.'

/**
 * Resposta quando o `studentId` do responsável não serve: sem vínculo ativo com aquele aluno,
 * 404 (igual a um aluno que não existe); acompanha mais de um aluno e não escolheu, 422.
 */
export function guardianChoiceError(response: Response, reason: 'required' | 'not_found') {
  if (reason === 'required') {
    return fieldError(
      response,
      'studentId',
      'Você acompanha mais de um aluno. Escolha qual aluno quer ver.',
      'required'
    )
  }
  return notFound(response, STUDENT_NOT_FOUND)
}
