import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'profile.profile.update': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'academic_context.show': { paramsTuple?: []; params?: {} }
    'dashboard.show': { paramsTuple?: []; params?: {} }
    'academic_events.index': { paramsTuple?: []; params?: {} }
    'academic_events.store': { paramsTuple?: []; params?: {} }
    'academic_events.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'academic_events.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'academic_events.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reminders.index': { paramsTuple?: []; params?: {} }
    'reminders.store': { paramsTuple?: []; params?: {} }
    'reminders.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'calendar_imports.index': { paramsTuple?: []; params?: {} }
    'calendar_imports.store': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'academic_context.show': { paramsTuple?: []; params?: {} }
    'dashboard.show': { paramsTuple?: []; params?: {} }
    'academic_events.index': { paramsTuple?: []; params?: {} }
    'academic_events.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reminders.index': { paramsTuple?: []; params?: {} }
    'calendar_imports.index': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'academic_context.show': { paramsTuple?: []; params?: {} }
    'dashboard.show': { paramsTuple?: []; params?: {} }
    'academic_events.index': { paramsTuple?: []; params?: {} }
    'academic_events.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reminders.index': { paramsTuple?: []; params?: {} }
    'calendar_imports.index': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'academic_events.store': { paramsTuple?: []; params?: {} }
    'reminders.store': { paramsTuple?: []; params?: {} }
    'calendar_imports.store': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'profile.profile.update': { paramsTuple?: []; params?: {} }
    'academic_events.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'academic_events.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reminders.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}