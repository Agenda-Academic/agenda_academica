import { UserSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import Enrollment from '#models/enrollment'
import Reminder from '#models/reminder'
import TeachingAssignment from '#models/teaching_assignment'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { type AccessToken, DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { beforeSave, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  static accessTokens = DbAccessTokensProvider.forModel(User)
  declare currentAccessToken?: AccessToken

  // O SQLite devolve 0 ou 1; a API responde true ou false.
  @column({ consume: (value) => Boolean(value) })
  declare isMinor: boolean

  /** O e-mail é guardado sempre em minúsculas e sem espaços, venha de onde vier. */
  @beforeSave()
  static normalizeEmail(user: User) {
    if (user.$dirty.email && typeof user.email === 'string') {
      user.email = user.email.trim().toLowerCase()
    }
  }

  /**
   * Conta do e-mail, sem diferenciar maiúsculas nem espaços. Se duas contas antigas só diferem
   * nas maiúsculas (antes de o e-mail ser guardado em minúsculas), vale a do e-mail exato.
   */
  static findByEmail(email: string, client?: TransactionClientContract) {
    const normalized = email.trim().toLowerCase()
    return this.query({ client })
      .whereRaw('lower(email) = ?', [normalized])
      .orderByRaw('CASE WHEN email = ? THEN 0 ELSE 1 END', [normalized])
      .orderBy('id', 'asc')
      .first()
  }

  @hasMany(() => Enrollment)
  declare enrollments: HasMany<typeof Enrollment>

  @hasMany(() => TeachingAssignment, { foreignKey: 'teacherId' })
  declare teachingAssignments: HasMany<typeof TeachingAssignment>

  @hasMany(() => AcademicEvent, { foreignKey: 'teacherId' })
  declare teacherEvents: HasMany<typeof AcademicEvent>

  @hasMany(() => AcademicEvent, { foreignKey: 'createdById' })
  declare createdEvents: HasMany<typeof AcademicEvent>

  @hasMany(() => Reminder)
  declare reminders: HasMany<typeof Reminder>

  get initials() {
    // "Prof." e "Profa." não entram nas iniciais, e "da", "de", "do"... não valem como segundo nome:
    // "Maria da Silva" vira "MS" (e não "MD"); "Diogo Queiroz da Silva" continua "DQ"
    const words = this.fullName
      ? this.fullName.split(' ').filter((w) => w && !/^profa?\.$/i.test(w))
      : this.email.split('@')
    const particles = ['da', 'de', 'do', 'das', 'dos', 'e']
    const [first = '', ...rest] = words
    const second = rest.find((w) => w && !particles.includes(w.toLowerCase()))
    if (first && second) {
      return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
    }
    return first.slice(0, 2).toUpperCase()
  }
}
