import AcademicEvent from '#models/academic_event'
import Reminder from '#models/reminder'
import AcademicAccessService from '#services/academic_access_service'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class DashboardController {
  async show({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const now = DateTime.now()
    const horizon = now.plus({ days: 30 })

    const upcomingQuery = AcademicEvent.query()
      .where('startsAt', '>=', now.toSQL({ includeOffset: false })!)
      .where('startsAt', '<=', horizon.toSQL({ includeOffset: false })!)
      // Eventos "changed" continuam ativos; so cancelados/concluidos saem.
      .whereNotIn('status', ['cancelled', 'completed'])
      .preload('subject')
      .preload('teacher')
      .preload('academicClass', (classQuery) => classQuery.preload('course'))
      .orderBy('startsAt', 'asc')

    const visibleClassIds = await AcademicAccessService.visibleClassIdsFor(user)
    if (visibleClassIds !== null) {
      upcomingQuery.where((scope) => {
        scope.whereIn('source', ['official', 'imported']).orWhere('officialPriority', true)
        if (visibleClassIds.length) {
          scope.orWhereIn('academicClassId', visibleClassIds)
        }
      })
    }

    const upcoming = await upcomingQuery.limit(12)
    const reminders = await Reminder.query()
      .where('userId', user.id)
      .where('enabled', true)
      .whereNull('sentAt')
      .orderBy('sendAt', 'asc')
      .limit(5)

    const categories = upcoming.reduce<Record<string, number>>((acc, event) => {
      acc[event.category] = (acc[event.category] ?? 0) + 1
      return acc
    }, {})

    return {
      data: {
        important: upcoming.slice(0, 3).map((event) => event.serialize()),
        upcoming: upcoming.map((event) => event.serialize()),
        reminders: reminders.map((reminder) => reminder.serialize()),
        metrics: {
          upcomingCount: upcoming.length,
          remindersCount: reminders.length,
          categories,
        },
      },
    }
  }
}
