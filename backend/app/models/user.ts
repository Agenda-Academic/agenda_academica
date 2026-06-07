import { UserSchema } from '#database/schema'
import AcademicEvent from '#models/academic_event'
import Enrollment from '#models/enrollment'
import Reminder from '#models/reminder'
import TeachingAssignment from '#models/teaching_assignment'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { type AccessToken, DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  static accessTokens = DbAccessTokensProvider.forModel(User)
  declare currentAccessToken?: AccessToken

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
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    }
    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
