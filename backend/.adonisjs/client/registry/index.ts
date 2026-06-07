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
