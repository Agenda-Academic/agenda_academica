import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'auth.google_auth.redirect': { paramsTuple?: []; params?: {} }
    'auth.google_auth.callback': { paramsTuple?: []; params?: {} }
    'auth.google_auth.exchange': { paramsTuple?: []; params?: {} }
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
    'courses.index': { paramsTuple?: []; params?: {} }
    'courses.store': { paramsTuple?: []; params?: {} }
    'courses.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courses.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courses.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courses.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.index': { paramsTuple?: []; params?: {} }
    'classes.store': { paramsTuple?: []; params?: {} }
    'classes.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.create_join_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.disable_join_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_subjects.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_subjects.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'subjectId': ParamValue} }
    'class_subjects.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'subjectId': ParamValue} }
    'class_subjects.assign_teacher': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'subjectId': ParamValue} }
    'class_subjects.update_assignment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_subjects.end_assignment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.decide': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.join': { paramsTuple?: []; params?: {} }
    'class_members.invites': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.cancel_invite': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.index': { paramsTuple?: []; params?: {} }
    'subjects.store': { paramsTuple?: []; params?: {} }
    'subjects.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.index': { paramsTuple?: []; params?: {} }
    'guardian_links.claim': { paramsTuple?: []; params?: {} }
    'guardian_links.index': { paramsTuple?: []; params?: {} }
    'guardian_links.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.approve': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.block': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.my_guardians': { paramsTuple?: []; params?: {} }
    'guardian_links.update_mine': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.create_my_code': { paramsTuple?: []; params?: {} }
    'guardian_links.revoke_my_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.student_guardians': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.link_by_email': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.create_student_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.revoke_student_code': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'codeId': ParamValue} }
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'notifications.read_all': { paramsTuple?: []; params?: {} }
    'notifications.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grade_imports.store': { paramsTuple?: []; params?: {} }
    'grade_imports.index': { paramsTuple?: []; params?: {} }
    'grade_imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grade_imports.apply': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grade_imports.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.publish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.unpublish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.update': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'studentId': ParamValue} }
    'grades.mine': { paramsTuple?: []; params?: {} }
    'grades.student': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'auth.google_auth.redirect': { paramsTuple?: []; params?: {} }
    'auth.google_auth.callback': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'academic_context.show': { paramsTuple?: []; params?: {} }
    'dashboard.show': { paramsTuple?: []; params?: {} }
    'academic_events.index': { paramsTuple?: []; params?: {} }
    'academic_events.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reminders.index': { paramsTuple?: []; params?: {} }
    'calendar_imports.index': { paramsTuple?: []; params?: {} }
    'courses.index': { paramsTuple?: []; params?: {} }
    'classes.index': { paramsTuple?: []; params?: {} }
    'classes.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.invites': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.index': { paramsTuple?: []; params?: {} }
    'users.index': { paramsTuple?: []; params?: {} }
    'guardian_links.index': { paramsTuple?: []; params?: {} }
    'guardian_links.my_guardians': { paramsTuple?: []; params?: {} }
    'guardian_links.student_guardians': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'grade_imports.index': { paramsTuple?: []; params?: {} }
    'grade_imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.mine': { paramsTuple?: []; params?: {} }
    'grades.student': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'auth.google_auth.redirect': { paramsTuple?: []; params?: {} }
    'auth.google_auth.callback': { paramsTuple?: []; params?: {} }
    'profile.profile.show': { paramsTuple?: []; params?: {} }
    'academic_context.show': { paramsTuple?: []; params?: {} }
    'dashboard.show': { paramsTuple?: []; params?: {} }
    'academic_events.index': { paramsTuple?: []; params?: {} }
    'academic_events.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reminders.index': { paramsTuple?: []; params?: {} }
    'calendar_imports.index': { paramsTuple?: []; params?: {} }
    'courses.index': { paramsTuple?: []; params?: {} }
    'classes.index': { paramsTuple?: []; params?: {} }
    'classes.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.invites': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.index': { paramsTuple?: []; params?: {} }
    'users.index': { paramsTuple?: []; params?: {} }
    'guardian_links.index': { paramsTuple?: []; params?: {} }
    'guardian_links.my_guardians': { paramsTuple?: []; params?: {} }
    'guardian_links.student_guardians': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'grade_imports.index': { paramsTuple?: []; params?: {} }
    'grade_imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.index': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.mine': { paramsTuple?: []; params?: {} }
    'grades.student': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  POST: {
    'auth.new_account.store': { paramsTuple?: []; params?: {} }
    'auth.access_tokens.store': { paramsTuple?: []; params?: {} }
    'auth.google_auth.exchange': { paramsTuple?: []; params?: {} }
    'profile.access_tokens.destroy': { paramsTuple?: []; params?: {} }
    'academic_events.store': { paramsTuple?: []; params?: {} }
    'reminders.store': { paramsTuple?: []; params?: {} }
    'calendar_imports.store': { paramsTuple?: []; params?: {} }
    'courses.store': { paramsTuple?: []; params?: {} }
    'courses.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courses.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.store': { paramsTuple?: []; params?: {} }
    'classes.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.create_join_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_subjects.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_subjects.archive': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'subjectId': ParamValue} }
    'class_subjects.assign_teacher': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'subjectId': ParamValue} }
    'class_members.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.decide': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.join': { paramsTuple?: []; params?: {} }
    'subjects.store': { paramsTuple?: []; params?: {} }
    'subjects.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.claim': { paramsTuple?: []; params?: {} }
    'guardian_links.restore': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.approve': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.block': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.create_my_code': { paramsTuple?: []; params?: {} }
    'guardian_links.link_by_email': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.create_student_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.read_all': { paramsTuple?: []; params?: {} }
    'notifications.read': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grade_imports.store': { paramsTuple?: []; params?: {} }
    'grade_imports.apply': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.publish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'profile.profile.update': { paramsTuple?: []; params?: {} }
    'academic_events.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courses.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_subjects.update_assignment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.update': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'studentId': ParamValue} }
  }
  DELETE: {
    'academic_events.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'reminders.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'courses.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'classes.disable_join_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_subjects.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'subjectId': ParamValue} }
    'class_subjects.end_assignment': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'class_members.cancel_invite': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'subjects.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.revoke_my_code': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.revoke_student_code': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'codeId': ParamValue} }
    'grade_imports.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'grades.unpublish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PATCH: {
    'class_members.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'guardian_links.update_mine': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'users.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}