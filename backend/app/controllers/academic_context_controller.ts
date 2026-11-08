import AcademicClass from '#models/academic_class'
import ClassSubject from '#models/class_subject'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import GuardianLink, { OPEN_LINK_STATUSES } from '#models/guardian_link'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import type User from '#models/user'
import AcademicAccessService from '#services/academic_access_service'
import LinkedStudentTransformer from '#transformers/linked_student_transformer'
import UserTransformer from '#transformers/user_transformer'
import type { HttpContext } from '@adonisjs/core/http'

export default class AcademicContextController {
  async show({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (AcademicAccessService.isGuardian(user)) {
      return serialize(await this.guardianContext(user))
    }

    // Só matrículas ativas em turma não arquivada: o painel do aluno lê `enrollments[0]`
    // como a turma dele. Os pedidos ainda sem decisão vão à parte, em `pendingEnrollments`.
    const enrollments = await Enrollment.query()
      .where('userId', user.id)
      .whereIn('status', ['active', 'pending'])
      .whereHas('academicClass', (classQuery) => {
        classQuery.whereNull('archivedAt')
      })
      .preload('academicClass', (classQuery) => classQuery.preload('course'))
      .orderBy('createdAt', 'asc')

    // Vínculos em vigor em turma não arquivada: é o que alimenta o seletor de turma e
    // disciplina do evento da docente.
    const teachingAssignments = await TeachingAssignment.query()
      .where('teacherId', user.id)
      .whereNull('endedAt')
      .whereHas('academicClass', (classQuery) => {
        classQuery.whereNull('archivedAt')
      })
      .preload('subject')
      .preload('academicClass', (classQuery) => classQuery.preload('course'))

    const [courses, classes, subjects] = await Promise.all([
      Course.query()
        .where('active', true)
        .withScopes((scopes) => scopes.withoutArchived())
        .orderBy('name'),
      AcademicClass.query()
        .where('active', true)
        .withScopes((scopes) => scopes.withoutArchived())
        .preload('course')
        .orderBy('year', 'desc'),
      Subject.query()
        .where('active', true)
        .withScopes((scopes) => scopes.withoutArchived())
        .orderBy('name'),
    ])

    return serialize({
      user: UserTransformer.transform(user),
      enrollments: enrollments
        .filter((enrollment) => enrollment.status === 'active')
        .map((enrollment) => enrollment.serialize()),
      pendingEnrollments: enrollments
        .filter((enrollment) => enrollment.status === 'pending')
        .map((enrollment) => enrollment.serialize()),
      teachingAssignments: teachingAssignments.map((assignment) => assignment.serialize()),
      catalog: {
        courses: courses.map((course) => course.serialize()),
        classes: classes.map((academicClass) => academicClass.serialize()),
        subjects: subjects.map((subject) => subject.serialize()),
      },
    })
  }

  /**
   * Contexto do responsável: `linkedStudents` (vínculos ativos e pendentes) e o catalog só com
   * as turmas dos alunos com vínculo ativo. Ele não tem matrícula nem vínculo de docente.
   */
  private async guardianContext(user: User) {
    const links = await GuardianLink.query()
      .where('guardianId', user.id)
      .whereIn('status', [...OPEN_LINK_STATUSES])
      .preload('student')
    links.sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') ||
        (a.student?.fullName ?? '').localeCompare(b.student?.fullName ?? '', 'pt-BR')
    )

    const activeStudentIds = links
      .filter((link) => link.status === 'active')
      .map((link) => link.studentId)
    const enrollments = activeStudentIds.length
      ? await Enrollment.query()
          .whereIn('userId', activeStudentIds)
          .where('status', 'active')
          .whereHas('academicClass', (classQuery) => {
            classQuery.whereNull('archivedAt')
          })
          .preload('academicClass', (classQuery) => classQuery.preload('course'))
          .orderBy('createdAt', 'asc')
      : []

    const classesByStudent = new Map<number, AcademicClass[]>()
    const classes = new Map<number, AcademicClass>()
    for (const enrollment of enrollments) {
      const list = classesByStudent.get(enrollment.userId) ?? []
      list.push(enrollment.academicClass)
      classesByStudent.set(enrollment.userId, list)
      if (enrollment.academicClass.active) {
        classes.set(enrollment.academicClass.id, enrollment.academicClass)
      }
    }

    const courses = new Map<number, Course>()
    for (const academicClass of classes.values()) {
      if (academicClass.course && !academicClass.course.isArchived) {
        courses.set(academicClass.course.id, academicClass.course)
      }
    }

    const offers = classes.size
      ? await ClassSubject.query()
          .whereIn('academicClassId', [...classes.keys()])
          .whereNull('archivedAt')
          .whereHas('subject', (subjectQuery) => {
            subjectQuery.where('active', true).whereNull('archivedAt')
          })
          .preload('subject')
      : []
    const subjects = new Map<number, Subject>()
    for (const offer of offers) {
      subjects.set(offer.subject.id, offer.subject)
    }

    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'pt-BR')
    return {
      user: UserTransformer.transform(user),
      enrollments: [],
      pendingEnrollments: [],
      teachingAssignments: [],
      catalog: {
        courses: [...courses.values()].sort(byName).map((course) => course.serialize()),
        classes: [...classes.values()]
          .sort((a, b) => b.year - a.year || byName(a, b))
          .map((academicClass) => academicClass.serialize()),
        subjects: [...subjects.values()].sort(byName).map((subject) => subject.serialize()),
      },
      linkedStudents: LinkedStudentTransformer.transform(links, classesByStudent),
    }
  }
}
