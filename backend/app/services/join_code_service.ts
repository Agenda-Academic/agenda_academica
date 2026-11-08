import AcademicClass from '#models/academic_class'
import { randomInt } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/** Alfabeto Crockford: 0 a 9 e A a Z, sem I, L, O e U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const JOIN_CODE_LENGTH = 8

/** Código da turma: 8 caracteres gerados com crypto.randomInt, mostrados como K7QM-3XPD. */
export default class JoinCodeService {
  static generate() {
    let code = ''
    for (let index = 0; index < JOIN_CODE_LENGTH; index++) {
      code += ALPHABET[randomInt(ALPHABET.length)]
    }
    return code
  }

  /** Gera um código que nenhuma turma usa. */
  static async generateUnique(trx?: TransactionClientContract) {
    for (;;) {
      const code = this.generate()
      const taken = await AcademicClass.query({ client: trx }).where('joinCode', code).first()
      if (!taken) {
        return code
      }
    }
  }

  /**
   * Maiúsculas e minúsculas valem igual; espaços e hífens são ignorados; O vira 0 e I ou L
   * viram 1, como manda o Crockford. Devolve null se sobrar algo fora do alfabeto.
   */
  static normalize(input: string) {
    const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
    if (code.length !== JOIN_CODE_LENGTH || [...code].some((char) => !ALPHABET.includes(char))) {
      return null
    }
    return code
  }

  static format(code: string | null) {
    return code ? `${code.slice(0, 4)}-${code.slice(4)}` : null
  }
}
