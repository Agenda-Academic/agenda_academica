/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { middleware } from '#start/kernel'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

const AcademicContextController = () => import('#controllers/academic_context_controller')
const AcademicEventsController = () => import('#controllers/academic_events_controller')
const CalendarImportsController = () => import('#controllers/calendar_imports_controller')
const DashboardController = () => import('#controllers/dashboard_controller')
const RemindersController = () => import('#controllers/reminders_controller')

router.get('/', () => {
  return {
    name: 'Agenda Academica API',
    status: 'ok',
  }
})

router
  .group(() => {
    router
      .group(() => {
        router.post('signup', [controllers.NewAccount, 'store'])
        router.post('login', [controllers.AccessTokens, 'store'])
      })
      .prefix('auth')
      .as('auth')

    router
      .group(() => {
        router.get('profile', [controllers.Profile, 'show'])
        router.put('profile', [controllers.Profile, 'update'])
        router.post('logout', [controllers.AccessTokens, 'destroy'])
      })
      .prefix('account')
      .as('profile')
      .use(middleware.auth())

    router
      .group(() => {
        router.get('context', [AcademicContextController, 'show'])
        router.get('dashboard', [DashboardController, 'show'])

        router.get('events', [AcademicEventsController, 'index'])
        router.post('events', [AcademicEventsController, 'store'])
        router.get('events/:id', [AcademicEventsController, 'show'])
        router.put('events/:id', [AcademicEventsController, 'update'])
        router.delete('events/:id', [AcademicEventsController, 'destroy'])

        router.get('reminders', [RemindersController, 'index'])
        router.post('reminders', [RemindersController, 'store'])
        router.delete('reminders/:id', [RemindersController, 'destroy'])

        router.get('calendar-imports', [CalendarImportsController, 'index'])
        router.post('calendar-imports', [CalendarImportsController, 'store'])
      })
      .use(middleware.auth())
  })
  .prefix('/api/v1')
