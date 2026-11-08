import AcademicEvent from '#models/academic_event'
import Reminder from '#models/reminder'
import AcademicAccessService, { type VisibilityOptions } from '#services/academic_access_service'
import { guardianChoiceError } from '#services/api_errors'
import { publicTeacher } from '#services/query_helpers'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class DashboardController {
  async show({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!AcademicAccessService.isKnownRole(user)) {
      return response.forbidden({ message: 'Seu perfil não tem acesso à agenda.' })
    }

    // O responsável vê o painel de um aluno vinculado por vez (`studentId`).
    let options: VisibilityOptions = {}
    if (AcademicAccessService.isGuardian(user)) {
      const choice = await AcademicAccessService.guardianStudentChoice(
        user,
        request.input('studentId')
      )
      if (!choice.ok) {
        return guardianChoiceError(response, choice.reason)
      }
      options = { studentId: choice.studentId }
    }
    const now = DateTime.now()
    const horizon = now.plus({ days: 30 })

    const upcomingQuery = AcademicEvent.query()
      .where('startsAt', '>=', now.toSQL({ includeOffset: false })!)
      .where('startsAt', '<=', horizon.toSQL({ includeOffset: false })!)
      // Eventos "changed" continuam ativos; so cancelados/concluidos saem.
      .whereNotIn('status', ['cancelled', 'completed'])
      .preload('subject')
      .preload('teacher', publicTeacher)
      .preload('academicClass', (classQuery) => classQuery.preload('course'))
      .orderBy('startsAt', 'asc')

    const visibleClassIds = await AcademicAccessService.visibleClassIdsFor(user, options)
    if (visibleClassIds !== null) {
      AcademicAccessService.scopeVisibleEvents(upcomingQuery, visibleClassIds)
    }

    const upcoming = await upcomingQuery.limit(12)
    const remindersQuery = Reminder.query()
      .where('userId', user.id)
      .where('enabled', true)
      .whereNull('sentAt')
      .orderBy('sendAt', 'asc')
      .limit(5)
    // Lembretes do responsável: só os de eventos que ele ainda vê, do aluno escolhido.
    if (AcademicAccessService.isGuardian(user)) {
      remindersQuery.whereHas('academicEvent', (eventQuery) => {
        AcademicAccessService.scopeVisibleEvents(eventQuery, visibleClassIds ?? [])
      })
    }
    const reminders = await remindersQuery

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
