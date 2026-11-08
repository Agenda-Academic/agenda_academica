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
const ClassMembersController = () => import('#controllers/class_members_controller')
const ClassesController = () => import('#controllers/classes_controller')
const ClassSubjectsController = () => import('#controllers/class_subjects_controller')
const CoursesController = () => import('#controllers/courses_controller')
const DashboardController = () => import('#controllers/dashboard_controller')
const GradeImportsController = () => import('#controllers/grade_imports_controller')
const GradesController = () => import('#controllers/grades_controller')
const GuardianLinksController = () => import('#controllers/guardian_links_controller')
const NotificationsController = () => import('#controllers/notifications_controller')
const RemindersController = () => import('#controllers/reminders_controller')
const SubjectsController = () => import('#controllers/subjects_controller')
const UsersController = () => import('#controllers/users_controller')

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

        // Fase 1: cursos, turmas, disciplinas, ofertas, docentes e alunos da turma.
        router.get('courses', [CoursesController, 'index'])
        router.post('courses', [CoursesController, 'store'])
        router.put('courses/:id', [CoursesController, 'update'])
        router.post('courses/:id/archive', [CoursesController, 'archive'])
        router.post('courses/:id/restore', [CoursesController, 'restore'])
        router.delete('courses/:id', [CoursesController, 'destroy'])

        router.get('classes', [ClassesController, 'index'])
        router.post('classes', [ClassesController, 'store'])
        router.get('classes/:id', [ClassesController, 'show'])
        router.put('classes/:id', [ClassesController, 'update'])
        router.post('classes/:id/archive', [ClassesController, 'archive'])
        router.post('classes/:id/restore', [ClassesController, 'restore'])
        router.delete('classes/:id', [ClassesController, 'destroy'])
        router.post('classes/:id/join-code', [ClassesController, 'createJoinCode'])
        router.delete('classes/:id/join-code', [ClassesController, 'disableJoinCode'])

        router.post('classes/:id/subjects', [ClassSubjectsController, 'store'])
        router.post('classes/:id/subjects/:subjectId/archive', [ClassSubjectsController, 'archive'])
        router.delete('classes/:id/subjects/:subjectId', [ClassSubjectsController, 'destroy'])
        router.post('classes/:id/subjects/:subjectId/teachers', [
          ClassSubjectsController,
          'assignTeacher',
        ])
        router.put('teaching-assignments/:id', [ClassSubjectsController, 'updateAssignment'])
        router.delete('teaching-assignments/:id', [ClassSubjectsController, 'endAssignment'])

        router.get('classes/:id/students', [ClassMembersController, 'index'])
        router.post('classes/:id/students', [ClassMembersController, 'store'])
        router.post('classes/:id/students/decide', [ClassMembersController, 'decide'])
        router.patch('enrollments/:id', [ClassMembersController, 'update'])
        router.post('enrollments/join', [ClassMembersController, 'join'])
        router.get('classes/:id/invites', [ClassMembersController, 'invites'])
        router.delete('class-invites/:id', [ClassMembersController, 'cancelInvite'])

        router.get('subjects', [SubjectsController, 'index'])
        router.post('subjects', [SubjectsController, 'store'])
        router.put('subjects/:id', [SubjectsController, 'update'])
        router.post('subjects/:id/archive', [SubjectsController, 'archive'])
        router.post('subjects/:id/restore', [SubjectsController, 'restore'])
        router.delete('subjects/:id', [SubjectsController, 'destroy'])

        router.get('users', [UsersController, 'index'])

        // Fase 2: responsável, vínculos, códigos e avisos.
        router.post('guardian-links/claim', [GuardianLinksController, 'claim'])
        router.get('guardian-links', [GuardianLinksController, 'index'])
        router.delete('guardian-links/:id', [GuardianLinksController, 'destroy'])
        router.post('guardian-links/:id/restore', [GuardianLinksController, 'restore'])
        router.post('guardian-links/:id/approve', [GuardianLinksController, 'approve'])
        router.post('guardian-links/:id/block', [GuardianLinksController, 'block'])

        router.get('me/guardians', [GuardianLinksController, 'myGuardians'])
        router.patch('me/guardians/:id', [GuardianLinksController, 'updateMine'])
        router.post('me/guardian-codes', [GuardianLinksController, 'createMyCode'])
        router.delete('me/guardian-codes/:id', [GuardianLinksController, 'revokeMyCode'])

        router.get('students/:id/guardians', [GuardianLinksController, 'studentGuardians'])
        router.post('students/:id/guardians', [GuardianLinksController, 'linkByEmail'])
        router.post('students/:id/guardian-codes', [GuardianLinksController, 'createStudentCode'])
        router.delete('students/:id/guardian-codes/:codeId', [
          GuardianLinksController,
          'revokeStudentCode',
        ])

        router.patch('users/:id', [UsersController, 'update'])

        router.get('notifications', [NotificationsController, 'index'])
        router.post('notifications/read-all', [NotificationsController, 'readAll'])
        router.post('notifications/:id/read', [NotificationsController, 'read'])

        // Fase 3: notas (importação, lançamento, publicação e leitura).
        router.post('grade-imports', [GradeImportsController, 'store'])
        router.get('grade-imports', [GradeImportsController, 'index'])
        router.get('grade-imports/:id', [GradeImportsController, 'show'])
        router.post('grade-imports/:id/apply', [GradeImportsController, 'apply'])
        router.delete('grade-imports/:id', [GradeImportsController, 'destroy'])

        router.get('events/:id/grades', [GradesController, 'index'])
        router.post('events/:id/grades/publish', [GradesController, 'publish'])
        router.delete('events/:id/grades/publish', [GradesController, 'unpublish'])
        router.put('events/:id/grades/:studentId', [GradesController, 'update'])

        router.get('me/grades', [GradesController, 'mine'])
        router.get('students/:id/grades', [GradesController, 'student'])
      })
      .use(middleware.auth())
  })
  .prefix('/api/v1')
