/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  auth: {
    newAccount: {
      store: typeof routes['auth.new_account.store']
    }
    accessTokens: {
      store: typeof routes['auth.access_tokens.store']
    }
    googleAuth: {
      redirect: typeof routes['auth.google_auth.redirect']
      callback: typeof routes['auth.google_auth.callback']
      exchange: typeof routes['auth.google_auth.exchange']
    }
  }
  profile: {
    profile: {
      show: typeof routes['profile.profile.show']
      update: typeof routes['profile.profile.update']
    }
    accessTokens: {
      destroy: typeof routes['profile.access_tokens.destroy']
    }
  }
  academicContext: {
    show: typeof routes['academic_context.show']
  }
  dashboard: {
    show: typeof routes['dashboard.show']
  }
  academicEvents: {
    index: typeof routes['academic_events.index']
    store: typeof routes['academic_events.store']
    show: typeof routes['academic_events.show']
    update: typeof routes['academic_events.update']
    destroy: typeof routes['academic_events.destroy']
  }
  reminders: {
    index: typeof routes['reminders.index']
    store: typeof routes['reminders.store']
    destroy: typeof routes['reminders.destroy']
  }
  calendarImports: {
    index: typeof routes['calendar_imports.index']
    store: typeof routes['calendar_imports.store']
  }
  courses: {
    index: typeof routes['courses.index']
    store: typeof routes['courses.store']
    update: typeof routes['courses.update']
    archive: typeof routes['courses.archive']
    restore: typeof routes['courses.restore']
    destroy: typeof routes['courses.destroy']
  }
  classes: {
    index: typeof routes['classes.index']
    store: typeof routes['classes.store']
    show: typeof routes['classes.show']
    update: typeof routes['classes.update']
    archive: typeof routes['classes.archive']
    restore: typeof routes['classes.restore']
    destroy: typeof routes['classes.destroy']
    createJoinCode: typeof routes['classes.create_join_code']
    disableJoinCode: typeof routes['classes.disable_join_code']
  }
  classSubjects: {
    store: typeof routes['class_subjects.store']
    archive: typeof routes['class_subjects.archive']
    destroy: typeof routes['class_subjects.destroy']
    assignTeacher: typeof routes['class_subjects.assign_teacher']
    updateAssignment: typeof routes['class_subjects.update_assignment']
    endAssignment: typeof routes['class_subjects.end_assignment']
  }
  classMembers: {
    index: typeof routes['class_members.index']
    store: typeof routes['class_members.store']
    decide: typeof routes['class_members.decide']
    update: typeof routes['class_members.update']
    join: typeof routes['class_members.join']
    invites: typeof routes['class_members.invites']
    cancelInvite: typeof routes['class_members.cancel_invite']
  }
  subjects: {
    index: typeof routes['subjects.index']
    store: typeof routes['subjects.store']
    update: typeof routes['subjects.update']
    archive: typeof routes['subjects.archive']
    restore: typeof routes['subjects.restore']
    destroy: typeof routes['subjects.destroy']
  }
  users: {
    index: typeof routes['users.index']
    update: typeof routes['users.update']
  }
  guardianLinks: {
    claim: typeof routes['guardian_links.claim']
    index: typeof routes['guardian_links.index']
    destroy: typeof routes['guardian_links.destroy']
    restore: typeof routes['guardian_links.restore']
    approve: typeof routes['guardian_links.approve']
    block: typeof routes['guardian_links.block']
    myGuardians: typeof routes['guardian_links.my_guardians']
    updateMine: typeof routes['guardian_links.update_mine']
    createMyCode: typeof routes['guardian_links.create_my_code']
    revokeMyCode: typeof routes['guardian_links.revoke_my_code']
    studentGuardians: typeof routes['guardian_links.student_guardians']
    linkByEmail: typeof routes['guardian_links.link_by_email']
    createStudentCode: typeof routes['guardian_links.create_student_code']
    revokeStudentCode: typeof routes['guardian_links.revoke_student_code']
  }
  notifications: {
    index: typeof routes['notifications.index']
    readAll: typeof routes['notifications.read_all']
    read: typeof routes['notifications.read']
  }
  gradeImports: {
    store: typeof routes['grade_imports.store']
    index: typeof routes['grade_imports.index']
    show: typeof routes['grade_imports.show']
    apply: typeof routes['grade_imports.apply']
    destroy: typeof routes['grade_imports.destroy']
  }
  grades: {
    index: typeof routes['grades.index']
    publish: typeof routes['grades.publish']
    unpublish: typeof routes['grades.unpublish']
    update: typeof routes['grades.update']
    mine: typeof routes['grades.mine']
    student: typeof routes['grades.student']
  }
}
