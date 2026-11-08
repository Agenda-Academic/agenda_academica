import AcademicEvent from '#models/academic_event'
import ClassInvite from '#models/class_invite'
import ClassSubject from '#models/class_subject'
import Enrollment from '#models/enrollment'
import TeachingAssignment from '#models/teaching_assignment'
import { countOf } from '#services/query_helpers'
import { DateTime } from 'luxon'

export type ClassStats = {
  activeStudents: number
  pendingStudents: number
  /** Ofertas não arquivadas. */
  subjects: number
  /** Ofertas não arquivadas sem docente em vigor: a pendência do painel. */
  subjectsWithoutTeacher: number
  pendingInvites: number
}

const emptyStats = (): ClassStats => ({
  activeStudents: 0,
  pendingStudents: 0,
  subjects: 0,
  subjectsWithoutTeacher: 0,
  pendingInvites: 0,
})

/** Contagens das turmas para listas e painéis, em poucas consultas. */
export default class ClassStatsService {
  static async forClasses(classIds: number[]) {
    const stats = new Map<number, ClassStats>(classIds.map((id) => [id, emptyStats()]))
    if (!classIds.length) {
      return stats
    }

    const [enrollments, offers, assignments, invites] = await Promise.all([
      Enrollment.query()
        .whereIn('academicClassId', classIds)
        .whereIn('status', ['active', 'pending'])
        .select('academicClassId', 'status'),
      ClassSubject.query()
        .whereIn('academicClassId', classIds)
        .whereNull('archivedAt')
        .select('academicClassId', 'subjectId'),
      TeachingAssignment.query()
        .whereIn('academicClassId', classIds)
        .whereNull('endedAt')
        .select('academicClassId', 'subjectId'),
      ClassInvite.query()
        .whereIn('academicClassId', classIds)
        .whereNull('acceptedAt')
        .select('academicClassId'),
    ])

    for (const enrollment of enrollments) {
      const entry = stats.get(enrollment.academicClassId)!
      if (enrollment.status === 'active') {
        entry.activeStudents++
      } else {
        entry.pendingStudents++
      }
    }

    const taught = new Set(assignments.map((item) => `${item.academicClassId}:${item.subjectId}`))
    for (const offer of offers) {
      const entry = stats.get(offer.academicClassId)!
      entry.subjects++
      if (!taught.has(`${offer.academicClassId}:${offer.subjectId}`)) {
        entry.subjectsWithoutTeacher++
      }
    }

    for (const invite of invites) {
      stats.get(invite.academicClassId)!.pendingInvites++
    }

    return stats
  }

  static async forClass(classId: number) {
    const stats = await this.forClasses([classId])
    return stats.get(classId)!
  }

  /** Eventos que ainda vão acontecer: o aviso antes de arquivar. */
  static async futureEvents(classId: number) {
    return countOf(
      AcademicEvent.query()
        .where('academicClassId', classId)
        .where('startsAt', '>=', DateTime.now().toSQL({ includeOffset: false })!)
        .whereNot('status', 'cancelled')
    )
  }
}
