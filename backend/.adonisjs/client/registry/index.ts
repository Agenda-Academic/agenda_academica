/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'auth.new_account.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/signup',
    tokens: [{"old":"/api/v1/auth/signup","type":0,"val":"api","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['auth.new_account.store']['types'],
  },
  'auth.access_tokens.store': {
    methods: ["POST"],
    pattern: '/api/v1/auth/login',
    tokens: [{"old":"/api/v1/auth/login","type":0,"val":"api","end":""},{"old":"/api/v1/auth/login","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/login","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['auth.access_tokens.store']['types'],
  },
  'auth.google_auth.redirect': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/auth/google/redirect',
    tokens: [{"old":"/api/v1/auth/google/redirect","type":0,"val":"api","end":""},{"old":"/api/v1/auth/google/redirect","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/google/redirect","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/google/redirect","type":0,"val":"google","end":""},{"old":"/api/v1/auth/google/redirect","type":0,"val":"redirect","end":""}],
    types: placeholder as Registry['auth.google_auth.redirect']['types'],
  },
  'auth.google_auth.callback': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/auth/google/callback',
    tokens: [{"old":"/api/v1/auth/google/callback","type":0,"val":"api","end":""},{"old":"/api/v1/auth/google/callback","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/google/callback","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/google/callback","type":0,"val":"google","end":""},{"old":"/api/v1/auth/google/callback","type":0,"val":"callback","end":""}],
    types: placeholder as Registry['auth.google_auth.callback']['types'],
  },
  'auth.google_auth.exchange': {
    methods: ["POST"],
    pattern: '/api/v1/auth/google/exchange',
    tokens: [{"old":"/api/v1/auth/google/exchange","type":0,"val":"api","end":""},{"old":"/api/v1/auth/google/exchange","type":0,"val":"v1","end":""},{"old":"/api/v1/auth/google/exchange","type":0,"val":"auth","end":""},{"old":"/api/v1/auth/google/exchange","type":0,"val":"google","end":""},{"old":"/api/v1/auth/google/exchange","type":0,"val":"exchange","end":""}],
    types: placeholder as Registry['auth.google_auth.exchange']['types'],
  },
  'profile.profile.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/account/profile',
    tokens: [{"old":"/api/v1/account/profile","type":0,"val":"api","end":""},{"old":"/api/v1/account/profile","type":0,"val":"v1","end":""},{"old":"/api/v1/account/profile","type":0,"val":"account","end":""},{"old":"/api/v1/account/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['profile.profile.show']['types'],
  },
  'profile.profile.update': {
    methods: ["PUT"],
    pattern: '/api/v1/account/profile',
    tokens: [{"old":"/api/v1/account/profile","type":0,"val":"api","end":""},{"old":"/api/v1/account/profile","type":0,"val":"v1","end":""},{"old":"/api/v1/account/profile","type":0,"val":"account","end":""},{"old":"/api/v1/account/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['profile.profile.update']['types'],
  },
  'profile.access_tokens.destroy': {
    methods: ["POST"],
    pattern: '/api/v1/account/logout',
    tokens: [{"old":"/api/v1/account/logout","type":0,"val":"api","end":""},{"old":"/api/v1/account/logout","type":0,"val":"v1","end":""},{"old":"/api/v1/account/logout","type":0,"val":"account","end":""},{"old":"/api/v1/account/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['profile.access_tokens.destroy']['types'],
  },
  'academic_context.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/context',
    tokens: [{"old":"/api/v1/context","type":0,"val":"api","end":""},{"old":"/api/v1/context","type":0,"val":"v1","end":""},{"old":"/api/v1/context","type":0,"val":"context","end":""}],
    types: placeholder as Registry['academic_context.show']['types'],
  },
  'dashboard.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/dashboard',
    tokens: [{"old":"/api/v1/dashboard","type":0,"val":"api","end":""},{"old":"/api/v1/dashboard","type":0,"val":"v1","end":""},{"old":"/api/v1/dashboard","type":0,"val":"dashboard","end":""}],
    types: placeholder as Registry['dashboard.show']['types'],
  },
  'academic_events.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/events',
    tokens: [{"old":"/api/v1/events","type":0,"val":"api","end":""},{"old":"/api/v1/events","type":0,"val":"v1","end":""},{"old":"/api/v1/events","type":0,"val":"events","end":""}],
    types: placeholder as Registry['academic_events.index']['types'],
  },
  'academic_events.store': {
    methods: ["POST"],
    pattern: '/api/v1/events',
    tokens: [{"old":"/api/v1/events","type":0,"val":"api","end":""},{"old":"/api/v1/events","type":0,"val":"v1","end":""},{"old":"/api/v1/events","type":0,"val":"events","end":""}],
    types: placeholder as Registry['academic_events.store']['types'],
  },
  'academic_events.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/events/:id',
    tokens: [{"old":"/api/v1/events/:id","type":0,"val":"api","end":""},{"old":"/api/v1/events/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/events/:id","type":0,"val":"events","end":""},{"old":"/api/v1/events/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['academic_events.show']['types'],
  },
  'academic_events.update': {
    methods: ["PUT"],
    pattern: '/api/v1/events/:id',
    tokens: [{"old":"/api/v1/events/:id","type":0,"val":"api","end":""},{"old":"/api/v1/events/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/events/:id","type":0,"val":"events","end":""},{"old":"/api/v1/events/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['academic_events.update']['types'],
  },
  'academic_events.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/events/:id',
    tokens: [{"old":"/api/v1/events/:id","type":0,"val":"api","end":""},{"old":"/api/v1/events/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/events/:id","type":0,"val":"events","end":""},{"old":"/api/v1/events/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['academic_events.destroy']['types'],
  },
  'reminders.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/reminders',
    tokens: [{"old":"/api/v1/reminders","type":0,"val":"api","end":""},{"old":"/api/v1/reminders","type":0,"val":"v1","end":""},{"old":"/api/v1/reminders","type":0,"val":"reminders","end":""}],
    types: placeholder as Registry['reminders.index']['types'],
  },
  'reminders.store': {
    methods: ["POST"],
    pattern: '/api/v1/reminders',
    tokens: [{"old":"/api/v1/reminders","type":0,"val":"api","end":""},{"old":"/api/v1/reminders","type":0,"val":"v1","end":""},{"old":"/api/v1/reminders","type":0,"val":"reminders","end":""}],
    types: placeholder as Registry['reminders.store']['types'],
  },
  'reminders.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/reminders/:id',
    tokens: [{"old":"/api/v1/reminders/:id","type":0,"val":"api","end":""},{"old":"/api/v1/reminders/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/reminders/:id","type":0,"val":"reminders","end":""},{"old":"/api/v1/reminders/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['reminders.destroy']['types'],
  },
  'calendar_imports.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/calendar-imports',
    tokens: [{"old":"/api/v1/calendar-imports","type":0,"val":"api","end":""},{"old":"/api/v1/calendar-imports","type":0,"val":"v1","end":""},{"old":"/api/v1/calendar-imports","type":0,"val":"calendar-imports","end":""}],
    types: placeholder as Registry['calendar_imports.index']['types'],
  },
  'calendar_imports.store': {
    methods: ["POST"],
    pattern: '/api/v1/calendar-imports',
    tokens: [{"old":"/api/v1/calendar-imports","type":0,"val":"api","end":""},{"old":"/api/v1/calendar-imports","type":0,"val":"v1","end":""},{"old":"/api/v1/calendar-imports","type":0,"val":"calendar-imports","end":""}],
    types: placeholder as Registry['calendar_imports.store']['types'],
  },
  'calendar_imports.read_pdf': {
    methods: ["POST"],
    pattern: '/api/v1/calendar-imports/pdf',
    tokens: [{"old":"/api/v1/calendar-imports/pdf","type":0,"val":"api","end":""},{"old":"/api/v1/calendar-imports/pdf","type":0,"val":"v1","end":""},{"old":"/api/v1/calendar-imports/pdf","type":0,"val":"calendar-imports","end":""},{"old":"/api/v1/calendar-imports/pdf","type":0,"val":"pdf","end":""}],
    types: placeholder as Registry['calendar_imports.read_pdf']['types'],
  },
  'courses.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/courses',
    tokens: [{"old":"/api/v1/courses","type":0,"val":"api","end":""},{"old":"/api/v1/courses","type":0,"val":"v1","end":""},{"old":"/api/v1/courses","type":0,"val":"courses","end":""}],
    types: placeholder as Registry['courses.index']['types'],
  },
  'courses.store': {
    methods: ["POST"],
    pattern: '/api/v1/courses',
    tokens: [{"old":"/api/v1/courses","type":0,"val":"api","end":""},{"old":"/api/v1/courses","type":0,"val":"v1","end":""},{"old":"/api/v1/courses","type":0,"val":"courses","end":""}],
    types: placeholder as Registry['courses.store']['types'],
  },
  'courses.update': {
    methods: ["PUT"],
    pattern: '/api/v1/courses/:id',
    tokens: [{"old":"/api/v1/courses/:id","type":0,"val":"api","end":""},{"old":"/api/v1/courses/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/courses/:id","type":0,"val":"courses","end":""},{"old":"/api/v1/courses/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['courses.update']['types'],
  },
  'courses.archive': {
    methods: ["POST"],
    pattern: '/api/v1/courses/:id/archive',
    tokens: [{"old":"/api/v1/courses/:id/archive","type":0,"val":"api","end":""},{"old":"/api/v1/courses/:id/archive","type":0,"val":"v1","end":""},{"old":"/api/v1/courses/:id/archive","type":0,"val":"courses","end":""},{"old":"/api/v1/courses/:id/archive","type":1,"val":"id","end":""},{"old":"/api/v1/courses/:id/archive","type":0,"val":"archive","end":""}],
    types: placeholder as Registry['courses.archive']['types'],
  },
  'courses.restore': {
    methods: ["POST"],
    pattern: '/api/v1/courses/:id/restore',
    tokens: [{"old":"/api/v1/courses/:id/restore","type":0,"val":"api","end":""},{"old":"/api/v1/courses/:id/restore","type":0,"val":"v1","end":""},{"old":"/api/v1/courses/:id/restore","type":0,"val":"courses","end":""},{"old":"/api/v1/courses/:id/restore","type":1,"val":"id","end":""},{"old":"/api/v1/courses/:id/restore","type":0,"val":"restore","end":""}],
    types: placeholder as Registry['courses.restore']['types'],
  },
  'courses.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/courses/:id',
    tokens: [{"old":"/api/v1/courses/:id","type":0,"val":"api","end":""},{"old":"/api/v1/courses/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/courses/:id","type":0,"val":"courses","end":""},{"old":"/api/v1/courses/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['courses.destroy']['types'],
  },
  'classes.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/classes',
    tokens: [{"old":"/api/v1/classes","type":0,"val":"api","end":""},{"old":"/api/v1/classes","type":0,"val":"v1","end":""},{"old":"/api/v1/classes","type":0,"val":"classes","end":""}],
    types: placeholder as Registry['classes.index']['types'],
  },
  'classes.store': {
    methods: ["POST"],
    pattern: '/api/v1/classes',
    tokens: [{"old":"/api/v1/classes","type":0,"val":"api","end":""},{"old":"/api/v1/classes","type":0,"val":"v1","end":""},{"old":"/api/v1/classes","type":0,"val":"classes","end":""}],
    types: placeholder as Registry['classes.store']['types'],
  },
  'classes.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/classes/:id',
    tokens: [{"old":"/api/v1/classes/:id","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['classes.show']['types'],
  },
  'classes.update': {
    methods: ["PUT"],
    pattern: '/api/v1/classes/:id',
    tokens: [{"old":"/api/v1/classes/:id","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['classes.update']['types'],
  },
  'classes.archive': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/archive',
    tokens: [{"old":"/api/v1/classes/:id/archive","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/archive","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/archive","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/archive","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/archive","type":0,"val":"archive","end":""}],
    types: placeholder as Registry['classes.archive']['types'],
  },
  'classes.restore': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/restore',
    tokens: [{"old":"/api/v1/classes/:id/restore","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/restore","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/restore","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/restore","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/restore","type":0,"val":"restore","end":""}],
    types: placeholder as Registry['classes.restore']['types'],
  },
  'classes.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/classes/:id',
    tokens: [{"old":"/api/v1/classes/:id","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['classes.destroy']['types'],
  },
  'classes.create_join_code': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/join-code',
    tokens: [{"old":"/api/v1/classes/:id/join-code","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/join-code","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/join-code","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/join-code","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/join-code","type":0,"val":"join-code","end":""}],
    types: placeholder as Registry['classes.create_join_code']['types'],
  },
  'classes.disable_join_code': {
    methods: ["DELETE"],
    pattern: '/api/v1/classes/:id/join-code',
    tokens: [{"old":"/api/v1/classes/:id/join-code","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/join-code","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/join-code","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/join-code","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/join-code","type":0,"val":"join-code","end":""}],
    types: placeholder as Registry['classes.disable_join_code']['types'],
  },
  'class_subjects.store': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/subjects',
    tokens: [{"old":"/api/v1/classes/:id/subjects","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/subjects","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/subjects","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/subjects","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/subjects","type":0,"val":"subjects","end":""}],
    types: placeholder as Registry['class_subjects.store']['types'],
  },
  'class_subjects.archive': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/subjects/:subjectId/archive',
    tokens: [{"old":"/api/v1/classes/:id/subjects/:subjectId/archive","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/archive","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/archive","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/archive","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/archive","type":0,"val":"subjects","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/archive","type":1,"val":"subjectId","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/archive","type":0,"val":"archive","end":""}],
    types: placeholder as Registry['class_subjects.archive']['types'],
  },
  'class_subjects.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/classes/:id/subjects/:subjectId',
    tokens: [{"old":"/api/v1/classes/:id/subjects/:subjectId","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId","type":0,"val":"subjects","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId","type":1,"val":"subjectId","end":""}],
    types: placeholder as Registry['class_subjects.destroy']['types'],
  },
  'class_subjects.assign_teacher': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/subjects/:subjectId/teachers',
    tokens: [{"old":"/api/v1/classes/:id/subjects/:subjectId/teachers","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/teachers","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/teachers","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/teachers","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/teachers","type":0,"val":"subjects","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/teachers","type":1,"val":"subjectId","end":""},{"old":"/api/v1/classes/:id/subjects/:subjectId/teachers","type":0,"val":"teachers","end":""}],
    types: placeholder as Registry['class_subjects.assign_teacher']['types'],
  },
  'class_subjects.update_assignment': {
    methods: ["PUT"],
    pattern: '/api/v1/teaching-assignments/:id',
    tokens: [{"old":"/api/v1/teaching-assignments/:id","type":0,"val":"api","end":""},{"old":"/api/v1/teaching-assignments/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/teaching-assignments/:id","type":0,"val":"teaching-assignments","end":""},{"old":"/api/v1/teaching-assignments/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['class_subjects.update_assignment']['types'],
  },
  'class_subjects.end_assignment': {
    methods: ["DELETE"],
    pattern: '/api/v1/teaching-assignments/:id',
    tokens: [{"old":"/api/v1/teaching-assignments/:id","type":0,"val":"api","end":""},{"old":"/api/v1/teaching-assignments/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/teaching-assignments/:id","type":0,"val":"teaching-assignments","end":""},{"old":"/api/v1/teaching-assignments/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['class_subjects.end_assignment']['types'],
  },
  'class_members.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/classes/:id/students',
    tokens: [{"old":"/api/v1/classes/:id/students","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/students","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/students","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/students","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/students","type":0,"val":"students","end":""}],
    types: placeholder as Registry['class_members.index']['types'],
  },
  'class_members.store': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/students',
    tokens: [{"old":"/api/v1/classes/:id/students","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/students","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/students","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/students","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/students","type":0,"val":"students","end":""}],
    types: placeholder as Registry['class_members.store']['types'],
  },
  'class_members.decide': {
    methods: ["POST"],
    pattern: '/api/v1/classes/:id/students/decide',
    tokens: [{"old":"/api/v1/classes/:id/students/decide","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/students/decide","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/students/decide","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/students/decide","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/students/decide","type":0,"val":"students","end":""},{"old":"/api/v1/classes/:id/students/decide","type":0,"val":"decide","end":""}],
    types: placeholder as Registry['class_members.decide']['types'],
  },
  'class_members.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/enrollments/:id',
    tokens: [{"old":"/api/v1/enrollments/:id","type":0,"val":"api","end":""},{"old":"/api/v1/enrollments/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/enrollments/:id","type":0,"val":"enrollments","end":""},{"old":"/api/v1/enrollments/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['class_members.update']['types'],
  },
  'class_members.join': {
    methods: ["POST"],
    pattern: '/api/v1/enrollments/join',
    tokens: [{"old":"/api/v1/enrollments/join","type":0,"val":"api","end":""},{"old":"/api/v1/enrollments/join","type":0,"val":"v1","end":""},{"old":"/api/v1/enrollments/join","type":0,"val":"enrollments","end":""},{"old":"/api/v1/enrollments/join","type":0,"val":"join","end":""}],
    types: placeholder as Registry['class_members.join']['types'],
  },
  'class_members.invites': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/classes/:id/invites',
    tokens: [{"old":"/api/v1/classes/:id/invites","type":0,"val":"api","end":""},{"old":"/api/v1/classes/:id/invites","type":0,"val":"v1","end":""},{"old":"/api/v1/classes/:id/invites","type":0,"val":"classes","end":""},{"old":"/api/v1/classes/:id/invites","type":1,"val":"id","end":""},{"old":"/api/v1/classes/:id/invites","type":0,"val":"invites","end":""}],
    types: placeholder as Registry['class_members.invites']['types'],
  },
  'class_members.cancel_invite': {
    methods: ["DELETE"],
    pattern: '/api/v1/class-invites/:id',
    tokens: [{"old":"/api/v1/class-invites/:id","type":0,"val":"api","end":""},{"old":"/api/v1/class-invites/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/class-invites/:id","type":0,"val":"class-invites","end":""},{"old":"/api/v1/class-invites/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['class_members.cancel_invite']['types'],
  },
  'subjects.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/subjects',
    tokens: [{"old":"/api/v1/subjects","type":0,"val":"api","end":""},{"old":"/api/v1/subjects","type":0,"val":"v1","end":""},{"old":"/api/v1/subjects","type":0,"val":"subjects","end":""}],
    types: placeholder as Registry['subjects.index']['types'],
  },
  'subjects.store': {
    methods: ["POST"],
    pattern: '/api/v1/subjects',
    tokens: [{"old":"/api/v1/subjects","type":0,"val":"api","end":""},{"old":"/api/v1/subjects","type":0,"val":"v1","end":""},{"old":"/api/v1/subjects","type":0,"val":"subjects","end":""}],
    types: placeholder as Registry['subjects.store']['types'],
  },
  'subjects.update': {
    methods: ["PUT"],
    pattern: '/api/v1/subjects/:id',
    tokens: [{"old":"/api/v1/subjects/:id","type":0,"val":"api","end":""},{"old":"/api/v1/subjects/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/subjects/:id","type":0,"val":"subjects","end":""},{"old":"/api/v1/subjects/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['subjects.update']['types'],
  },
  'subjects.archive': {
    methods: ["POST"],
    pattern: '/api/v1/subjects/:id/archive',
    tokens: [{"old":"/api/v1/subjects/:id/archive","type":0,"val":"api","end":""},{"old":"/api/v1/subjects/:id/archive","type":0,"val":"v1","end":""},{"old":"/api/v1/subjects/:id/archive","type":0,"val":"subjects","end":""},{"old":"/api/v1/subjects/:id/archive","type":1,"val":"id","end":""},{"old":"/api/v1/subjects/:id/archive","type":0,"val":"archive","end":""}],
    types: placeholder as Registry['subjects.archive']['types'],
  },
  'subjects.restore': {
    methods: ["POST"],
    pattern: '/api/v1/subjects/:id/restore',
    tokens: [{"old":"/api/v1/subjects/:id/restore","type":0,"val":"api","end":""},{"old":"/api/v1/subjects/:id/restore","type":0,"val":"v1","end":""},{"old":"/api/v1/subjects/:id/restore","type":0,"val":"subjects","end":""},{"old":"/api/v1/subjects/:id/restore","type":1,"val":"id","end":""},{"old":"/api/v1/subjects/:id/restore","type":0,"val":"restore","end":""}],
    types: placeholder as Registry['subjects.restore']['types'],
  },
  'subjects.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/subjects/:id',
    tokens: [{"old":"/api/v1/subjects/:id","type":0,"val":"api","end":""},{"old":"/api/v1/subjects/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/subjects/:id","type":0,"val":"subjects","end":""},{"old":"/api/v1/subjects/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['subjects.destroy']['types'],
  },
  'users.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/users',
    tokens: [{"old":"/api/v1/users","type":0,"val":"api","end":""},{"old":"/api/v1/users","type":0,"val":"v1","end":""},{"old":"/api/v1/users","type":0,"val":"users","end":""}],
    types: placeholder as Registry['users.index']['types'],
  },
  'guardian_links.claim': {
    methods: ["POST"],
    pattern: '/api/v1/guardian-links/claim',
    tokens: [{"old":"/api/v1/guardian-links/claim","type":0,"val":"api","end":""},{"old":"/api/v1/guardian-links/claim","type":0,"val":"v1","end":""},{"old":"/api/v1/guardian-links/claim","type":0,"val":"guardian-links","end":""},{"old":"/api/v1/guardian-links/claim","type":0,"val":"claim","end":""}],
    types: placeholder as Registry['guardian_links.claim']['types'],
  },
  'guardian_links.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/guardian-links',
    tokens: [{"old":"/api/v1/guardian-links","type":0,"val":"api","end":""},{"old":"/api/v1/guardian-links","type":0,"val":"v1","end":""},{"old":"/api/v1/guardian-links","type":0,"val":"guardian-links","end":""}],
    types: placeholder as Registry['guardian_links.index']['types'],
  },
  'guardian_links.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/guardian-links/:id',
    tokens: [{"old":"/api/v1/guardian-links/:id","type":0,"val":"api","end":""},{"old":"/api/v1/guardian-links/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/guardian-links/:id","type":0,"val":"guardian-links","end":""},{"old":"/api/v1/guardian-links/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['guardian_links.destroy']['types'],
  },
  'guardian_links.restore': {
    methods: ["POST"],
    pattern: '/api/v1/guardian-links/:id/restore',
    tokens: [{"old":"/api/v1/guardian-links/:id/restore","type":0,"val":"api","end":""},{"old":"/api/v1/guardian-links/:id/restore","type":0,"val":"v1","end":""},{"old":"/api/v1/guardian-links/:id/restore","type":0,"val":"guardian-links","end":""},{"old":"/api/v1/guardian-links/:id/restore","type":1,"val":"id","end":""},{"old":"/api/v1/guardian-links/:id/restore","type":0,"val":"restore","end":""}],
    types: placeholder as Registry['guardian_links.restore']['types'],
  },
  'guardian_links.approve': {
    methods: ["POST"],
    pattern: '/api/v1/guardian-links/:id/approve',
    tokens: [{"old":"/api/v1/guardian-links/:id/approve","type":0,"val":"api","end":""},{"old":"/api/v1/guardian-links/:id/approve","type":0,"val":"v1","end":""},{"old":"/api/v1/guardian-links/:id/approve","type":0,"val":"guardian-links","end":""},{"old":"/api/v1/guardian-links/:id/approve","type":1,"val":"id","end":""},{"old":"/api/v1/guardian-links/:id/approve","type":0,"val":"approve","end":""}],
    types: placeholder as Registry['guardian_links.approve']['types'],
  },
  'guardian_links.block': {
    methods: ["POST"],
    pattern: '/api/v1/guardian-links/:id/block',
    tokens: [{"old":"/api/v1/guardian-links/:id/block","type":0,"val":"api","end":""},{"old":"/api/v1/guardian-links/:id/block","type":0,"val":"v1","end":""},{"old":"/api/v1/guardian-links/:id/block","type":0,"val":"guardian-links","end":""},{"old":"/api/v1/guardian-links/:id/block","type":1,"val":"id","end":""},{"old":"/api/v1/guardian-links/:id/block","type":0,"val":"block","end":""}],
    types: placeholder as Registry['guardian_links.block']['types'],
  },
  'guardian_links.my_guardians': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/me/guardians',
    tokens: [{"old":"/api/v1/me/guardians","type":0,"val":"api","end":""},{"old":"/api/v1/me/guardians","type":0,"val":"v1","end":""},{"old":"/api/v1/me/guardians","type":0,"val":"me","end":""},{"old":"/api/v1/me/guardians","type":0,"val":"guardians","end":""}],
    types: placeholder as Registry['guardian_links.my_guardians']['types'],
  },
  'guardian_links.update_mine': {
    methods: ["PATCH"],
    pattern: '/api/v1/me/guardians/:id',
    tokens: [{"old":"/api/v1/me/guardians/:id","type":0,"val":"api","end":""},{"old":"/api/v1/me/guardians/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/me/guardians/:id","type":0,"val":"me","end":""},{"old":"/api/v1/me/guardians/:id","type":0,"val":"guardians","end":""},{"old":"/api/v1/me/guardians/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['guardian_links.update_mine']['types'],
  },
  'guardian_links.create_my_code': {
    methods: ["POST"],
    pattern: '/api/v1/me/guardian-codes',
    tokens: [{"old":"/api/v1/me/guardian-codes","type":0,"val":"api","end":""},{"old":"/api/v1/me/guardian-codes","type":0,"val":"v1","end":""},{"old":"/api/v1/me/guardian-codes","type":0,"val":"me","end":""},{"old":"/api/v1/me/guardian-codes","type":0,"val":"guardian-codes","end":""}],
    types: placeholder as Registry['guardian_links.create_my_code']['types'],
  },
  'guardian_links.revoke_my_code': {
    methods: ["DELETE"],
    pattern: '/api/v1/me/guardian-codes/:id',
    tokens: [{"old":"/api/v1/me/guardian-codes/:id","type":0,"val":"api","end":""},{"old":"/api/v1/me/guardian-codes/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/me/guardian-codes/:id","type":0,"val":"me","end":""},{"old":"/api/v1/me/guardian-codes/:id","type":0,"val":"guardian-codes","end":""},{"old":"/api/v1/me/guardian-codes/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['guardian_links.revoke_my_code']['types'],
  },
  'guardian_links.student_guardians': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/students/:id/guardians',
    tokens: [{"old":"/api/v1/students/:id/guardians","type":0,"val":"api","end":""},{"old":"/api/v1/students/:id/guardians","type":0,"val":"v1","end":""},{"old":"/api/v1/students/:id/guardians","type":0,"val":"students","end":""},{"old":"/api/v1/students/:id/guardians","type":1,"val":"id","end":""},{"old":"/api/v1/students/:id/guardians","type":0,"val":"guardians","end":""}],
    types: placeholder as Registry['guardian_links.student_guardians']['types'],
  },
  'guardian_links.link_by_email': {
    methods: ["POST"],
    pattern: '/api/v1/students/:id/guardians',
    tokens: [{"old":"/api/v1/students/:id/guardians","type":0,"val":"api","end":""},{"old":"/api/v1/students/:id/guardians","type":0,"val":"v1","end":""},{"old":"/api/v1/students/:id/guardians","type":0,"val":"students","end":""},{"old":"/api/v1/students/:id/guardians","type":1,"val":"id","end":""},{"old":"/api/v1/students/:id/guardians","type":0,"val":"guardians","end":""}],
    types: placeholder as Registry['guardian_links.link_by_email']['types'],
  },
  'guardian_links.create_student_code': {
    methods: ["POST"],
    pattern: '/api/v1/students/:id/guardian-codes',
    tokens: [{"old":"/api/v1/students/:id/guardian-codes","type":0,"val":"api","end":""},{"old":"/api/v1/students/:id/guardian-codes","type":0,"val":"v1","end":""},{"old":"/api/v1/students/:id/guardian-codes","type":0,"val":"students","end":""},{"old":"/api/v1/students/:id/guardian-codes","type":1,"val":"id","end":""},{"old":"/api/v1/students/:id/guardian-codes","type":0,"val":"guardian-codes","end":""}],
    types: placeholder as Registry['guardian_links.create_student_code']['types'],
  },
  'guardian_links.revoke_student_code': {
    methods: ["DELETE"],
    pattern: '/api/v1/students/:id/guardian-codes/:codeId',
    tokens: [{"old":"/api/v1/students/:id/guardian-codes/:codeId","type":0,"val":"api","end":""},{"old":"/api/v1/students/:id/guardian-codes/:codeId","type":0,"val":"v1","end":""},{"old":"/api/v1/students/:id/guardian-codes/:codeId","type":0,"val":"students","end":""},{"old":"/api/v1/students/:id/guardian-codes/:codeId","type":1,"val":"id","end":""},{"old":"/api/v1/students/:id/guardian-codes/:codeId","type":0,"val":"guardian-codes","end":""},{"old":"/api/v1/students/:id/guardian-codes/:codeId","type":1,"val":"codeId","end":""}],
    types: placeholder as Registry['guardian_links.revoke_student_code']['types'],
  },
  'users.update': {
    methods: ["PATCH"],
    pattern: '/api/v1/users/:id',
    tokens: [{"old":"/api/v1/users/:id","type":0,"val":"api","end":""},{"old":"/api/v1/users/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/users/:id","type":0,"val":"users","end":""},{"old":"/api/v1/users/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['users.update']['types'],
  },
  'notifications.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/notifications',
    tokens: [{"old":"/api/v1/notifications","type":0,"val":"api","end":""},{"old":"/api/v1/notifications","type":0,"val":"v1","end":""},{"old":"/api/v1/notifications","type":0,"val":"notifications","end":""}],
    types: placeholder as Registry['notifications.index']['types'],
  },
  'notifications.read_all': {
    methods: ["POST"],
    pattern: '/api/v1/notifications/read-all',
    tokens: [{"old":"/api/v1/notifications/read-all","type":0,"val":"api","end":""},{"old":"/api/v1/notifications/read-all","type":0,"val":"v1","end":""},{"old":"/api/v1/notifications/read-all","type":0,"val":"notifications","end":""},{"old":"/api/v1/notifications/read-all","type":0,"val":"read-all","end":""}],
    types: placeholder as Registry['notifications.read_all']['types'],
  },
  'notifications.read': {
    methods: ["POST"],
    pattern: '/api/v1/notifications/:id/read',
    tokens: [{"old":"/api/v1/notifications/:id/read","type":0,"val":"api","end":""},{"old":"/api/v1/notifications/:id/read","type":0,"val":"v1","end":""},{"old":"/api/v1/notifications/:id/read","type":0,"val":"notifications","end":""},{"old":"/api/v1/notifications/:id/read","type":1,"val":"id","end":""},{"old":"/api/v1/notifications/:id/read","type":0,"val":"read","end":""}],
    types: placeholder as Registry['notifications.read']['types'],
  },
  'grade_imports.store': {
    methods: ["POST"],
    pattern: '/api/v1/grade-imports',
    tokens: [{"old":"/api/v1/grade-imports","type":0,"val":"api","end":""},{"old":"/api/v1/grade-imports","type":0,"val":"v1","end":""},{"old":"/api/v1/grade-imports","type":0,"val":"grade-imports","end":""}],
    types: placeholder as Registry['grade_imports.store']['types'],
  },
  'grade_imports.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/grade-imports',
    tokens: [{"old":"/api/v1/grade-imports","type":0,"val":"api","end":""},{"old":"/api/v1/grade-imports","type":0,"val":"v1","end":""},{"old":"/api/v1/grade-imports","type":0,"val":"grade-imports","end":""}],
    types: placeholder as Registry['grade_imports.index']['types'],
  },
  'grade_imports.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/grade-imports/:id',
    tokens: [{"old":"/api/v1/grade-imports/:id","type":0,"val":"api","end":""},{"old":"/api/v1/grade-imports/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/grade-imports/:id","type":0,"val":"grade-imports","end":""},{"old":"/api/v1/grade-imports/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['grade_imports.show']['types'],
  },
  'grade_imports.apply': {
    methods: ["POST"],
    pattern: '/api/v1/grade-imports/:id/apply',
    tokens: [{"old":"/api/v1/grade-imports/:id/apply","type":0,"val":"api","end":""},{"old":"/api/v1/grade-imports/:id/apply","type":0,"val":"v1","end":""},{"old":"/api/v1/grade-imports/:id/apply","type":0,"val":"grade-imports","end":""},{"old":"/api/v1/grade-imports/:id/apply","type":1,"val":"id","end":""},{"old":"/api/v1/grade-imports/:id/apply","type":0,"val":"apply","end":""}],
    types: placeholder as Registry['grade_imports.apply']['types'],
  },
  'grade_imports.destroy': {
    methods: ["DELETE"],
    pattern: '/api/v1/grade-imports/:id',
    tokens: [{"old":"/api/v1/grade-imports/:id","type":0,"val":"api","end":""},{"old":"/api/v1/grade-imports/:id","type":0,"val":"v1","end":""},{"old":"/api/v1/grade-imports/:id","type":0,"val":"grade-imports","end":""},{"old":"/api/v1/grade-imports/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['grade_imports.destroy']['types'],
  },
  'grades.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/events/:id/grades',
    tokens: [{"old":"/api/v1/events/:id/grades","type":0,"val":"api","end":""},{"old":"/api/v1/events/:id/grades","type":0,"val":"v1","end":""},{"old":"/api/v1/events/:id/grades","type":0,"val":"events","end":""},{"old":"/api/v1/events/:id/grades","type":1,"val":"id","end":""},{"old":"/api/v1/events/:id/grades","type":0,"val":"grades","end":""}],
    types: placeholder as Registry['grades.index']['types'],
  },
  'grades.publish': {
    methods: ["POST"],
    pattern: '/api/v1/events/:id/grades/publish',
    tokens: [{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"api","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"v1","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"events","end":""},{"old":"/api/v1/events/:id/grades/publish","type":1,"val":"id","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"grades","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"publish","end":""}],
    types: placeholder as Registry['grades.publish']['types'],
  },
  'grades.unpublish': {
    methods: ["DELETE"],
    pattern: '/api/v1/events/:id/grades/publish',
    tokens: [{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"api","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"v1","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"events","end":""},{"old":"/api/v1/events/:id/grades/publish","type":1,"val":"id","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"grades","end":""},{"old":"/api/v1/events/:id/grades/publish","type":0,"val":"publish","end":""}],
    types: placeholder as Registry['grades.unpublish']['types'],
  },
  'grades.update': {
    methods: ["PUT"],
    pattern: '/api/v1/events/:id/grades/:studentId',
    tokens: [{"old":"/api/v1/events/:id/grades/:studentId","type":0,"val":"api","end":""},{"old":"/api/v1/events/:id/grades/:studentId","type":0,"val":"v1","end":""},{"old":"/api/v1/events/:id/grades/:studentId","type":0,"val":"events","end":""},{"old":"/api/v1/events/:id/grades/:studentId","type":1,"val":"id","end":""},{"old":"/api/v1/events/:id/grades/:studentId","type":0,"val":"grades","end":""},{"old":"/api/v1/events/:id/grades/:studentId","type":1,"val":"studentId","end":""}],
    types: placeholder as Registry['grades.update']['types'],
  },
  'grades.mine': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/me/grades',
    tokens: [{"old":"/api/v1/me/grades","type":0,"val":"api","end":""},{"old":"/api/v1/me/grades","type":0,"val":"v1","end":""},{"old":"/api/v1/me/grades","type":0,"val":"me","end":""},{"old":"/api/v1/me/grades","type":0,"val":"grades","end":""}],
    types: placeholder as Registry['grades.mine']['types'],
  },
  'grades.student': {
    methods: ["GET","HEAD"],
    pattern: '/api/v1/students/:id/grades',
    tokens: [{"old":"/api/v1/students/:id/grades","type":0,"val":"api","end":""},{"old":"/api/v1/students/:id/grades","type":0,"val":"v1","end":""},{"old":"/api/v1/students/:id/grades","type":0,"val":"students","end":""},{"old":"/api/v1/students/:id/grades","type":1,"val":"id","end":""},{"old":"/api/v1/students/:id/grades","type":0,"val":"grades","end":""}],
    types: placeholder as Registry['grades.student']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
