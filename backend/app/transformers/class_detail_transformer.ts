import type AcademicClass from '#models/academic_class'
import type ClassSubject from '#models/class_subject'
import type TeachingAssignment from '#models/teaching_assignment'
import type { ClassStats } from '#services/class_stats_service'
import JoinCodeService from '#services/join_code_service'
import { BaseTransformer } from '@adonisjs/core/transformers'

export type ClassDetail = {
  academicClass: AcademicClass
  offers: ClassSubject[]
  assignments: TeachingAssignment[]
  stats: ClassStats
  futureEvents: number
}

/**
 * Painel da turma: dados, ofertas com docentes, contagens e o código da turma. A rota só
 * chega aqui para a administração e para a docente da turma, que podem ver o código.
 */
export default class ClassDetailTransformer extends BaseTransformer<ClassDetail> {
  toObject() {
    const { academicClass, offers, assignments, stats, futureEvents } = this.resource
    const course = academicClass.course
    return {
      ...this.pick(academicClass, [
        'id',
        'courseId',
        'name',
        'period',
        'year',
        'semester',
        'shift',
        'archivedAt',
      ]),
      active: Boolean(academicClass.active),
      course: course
        ? { id: course.id, code: course.code, name: course.name, modality: course.modality }
        : null,
      counts: stats,
      futureEvents,
      joinCode: academicClass.joinCode,
      joinCodeFormatted: JoinCodeService.format(academicClass.joinCode),
      joinCodeActive: Boolean(academicClass.joinCodeActive),
      offers: offers.map((offer) => {
        const teachers = assignments
          .filter((assignment) => assignment.subjectId === offer.subjectId)
          .map((assignment) => ({
            assignmentId: assignment.id,
            teacherId: assignment.teacherId,
            fullName: assignment.teacher?.fullName ?? null,
            role: assignment.role,
          }))
        return {
          id: offer.id,
          subjectId: offer.subjectId,
          archivedAt: offer.archivedAt,
          subject: offer.subject
            ? { id: offer.subject.id, code: offer.subject.code, name: offer.subject.name }
            : null,
          teachers,
          withoutTeacher: offer.archivedAt === null && teachers.length === 0,
        }
      }),
    }
  }
}
