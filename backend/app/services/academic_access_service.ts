import type AcademicEvent from '#models/academic_event'
import Enrollment from '#models/enrollment'
import TeachingAssignment from '#models/teaching_assignment'
import type User from '#models/user'

export default class AcademicAccessService {
  static isAdmin(user: User) {
    return user.role === 'admin'
  }

  static isTeacher(user: User) {
    return user.role === 'teacher'
  }

  static isStudent(user: User) {
    return user.role === 'student'
  }

  static async visibleClassIdsFor(user: User) {
    if (this.isAdmin(user)) {
      return null
    }

    if (this.isTeacher(user)) {
      const assignments = await TeachingAssignment.query()
        .where('teacherId', user.id)
        .select('academicClassId')
      return [...new Set(assignments.map((assignment) => assignment.academicClassId))]
    }

    const enrollments = await Enrollment.query()
      .where('userId', user.id)
      .where('status', 'active')
      .select('academicClassId')
    return enrollments.map((enrollment) => enrollment.academicClassId)
  }

  static async teacherCanManage(
    user: User,
    academicClassId?: number | null,
    subjectId?: number | null
  ) {
    if (this.isAdmin(user)) {
      return true
    }

    if (!this.isTeacher(user) || !academicClassId) {
      return false
    }

    const query = TeachingAssignment.query()
      .where('teacherId', user.id)
      .where('academicClassId', academicClassId)

    if (subjectId) {
      query.where('subjectId', subjectId)
    }

    return !!(await query.first())
  }

  static async canViewEvent(user: User, event: AcademicEvent) {
    if (
      this.isAdmin(user) ||
      event.officialPriority ||
      ['official', 'imported'].includes(event.source)
    ) {
      return true
    }

    if (this.isTeacher(user)) {
      return (
        event.teacherId === user.id ||
        this.teacherCanManage(user, event.academicClassId, event.subjectId)
      )
    }

    if (!event.academicClassId) {
      return false
    }

    return !!(await Enrollment.query()
      .where('userId', user.id)
      .where('academicClassId', event.academicClassId)
      .where('status', 'active')
      .first())
  }

  static async canManageEvent(user: User, event: AcademicEvent) {
    if (this.isAdmin(user)) {
      return true
    }

    if (!this.isTeacher(user) || ['official', 'imported'].includes(event.source)) {
      return false
    }

    return (
      event.teacherId === user.id ||
      this.teacherCanManage(user, event.academicClassId, event.subjectId)
    )
  }
}
