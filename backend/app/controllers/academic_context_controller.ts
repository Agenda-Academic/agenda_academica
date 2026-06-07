import AcademicClass from '#models/academic_class'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import UserTransformer from '#transformers/user_transformer'
import type { HttpContext } from '@adonisjs/core/http'

export default class AcademicContextController {
  async show({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const enrollments = await Enrollment.query()
      .where('userId', user.id)
      .preload('academicClass', (classQuery) => classQuery.preload('course'))

    const teachingAssignments = await TeachingAssignment.query()
      .where('teacherId', user.id)
      .preload('subject')
      .preload('academicClass', (classQuery) => classQuery.preload('course'))

    const [courses, classes, subjects] = await Promise.all([
      Course.query().where('active', true).orderBy('name'),
      AcademicClass.query().where('active', true).preload('course').orderBy('year', 'desc'),
      Subject.query().where('active', true).orderBy('name'),
    ])

    return serialize({
      user: UserTransformer.transform(user),
      enrollments: enrollments.map((enrollment) => enrollment.serialize()),
      teachingAssignments: teachingAssignments.map((assignment) => assignment.serialize()),
      catalog: {
        courses: courses.map((course) => course.serialize()),
        classes: classes.map((academicClass) => academicClass.serialize()),
        subjects: subjects.map((subject) => subject.serialize()),
      },
    })
  }
}
