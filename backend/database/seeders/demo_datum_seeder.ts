import { BaseSeeder } from '@adonisjs/lucid/seeders'
import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import CalendarImport from '#models/calendar_import'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import Reminder from '#models/reminder'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import { reminderSendAt } from '#services/date_time_service'
import { DateTime } from 'luxon'

export default class extends BaseSeeder {
  async run() {
    const [admin, teacher, secondTeacher, student] = await User.createMany([
      {
        fullName: 'Coordenacao Academica',
        email: 'admin@agenda.test',
        password: 'password123',
        role: 'admin',
        registration: 'ADM-001',
        defaultReminderMinutes: 1440,
        notificationChannel: 'email',
      },
      {
        fullName: 'Prof. Apio Carniello',
        email: 'apio@agenda.test',
        password: 'password123',
        role: 'teacher',
        registration: 'DOC-001',
        defaultReminderMinutes: 2880,
        notificationChannel: 'email',
      },
      {
        fullName: 'Profa. Marina Souza',
        email: 'marina@agenda.test',
        password: 'password123',
        role: 'teacher',
        registration: 'DOC-002',
        defaultReminderMinutes: 2880,
        notificationChannel: 'email',
      },
      {
        fullName: 'Jonathan Patrocinio',
        email: 'jonathan@agenda.test',
        password: 'password123',
        role: 'student',
        registration: 'ALU-001',
        defaultReminderMinutes: 1440,
        notificationChannel: 'email',
      },
    ])

    const course = await Course.create({
      code: 'TADS',
      name: 'Tecnologia em Analise e Desenvolvimento de Sistemas',
      campus: 'Tres Lagoas',
    })

    const academicClass = await AcademicClass.create({
      courseId: course.id,
      name: 'TADS 3',
      period: '3o periodo',
      year: DateTime.now().year,
      semester: 1,
      shift: 'noturno',
    })

    const [math, dataStructures, softwareEngineering] = await Subject.createMany([
      { code: 'MAT-301', name: 'Matematica', workloadHours: 80 },
      { code: 'ED-301', name: 'Estrutura de Dados', workloadHours: 80 },
      { code: 'ES-301', name: 'Engenharia de Software', workloadHours: 80 },
    ])

    await Enrollment.create({
      userId: student.id,
      academicClassId: academicClass.id,
      status: 'active',
    })

    await TeachingAssignment.createMany([
      { teacherId: teacher.id, academicClassId: academicClass.id, subjectId: math.id },
      {
        teacherId: teacher.id,
        academicClassId: academicClass.id,
        subjectId: softwareEngineering.id,
      },
      {
        teacherId: secondTeacher.id,
        academicClassId: academicClass.id,
        subjectId: dataStructures.id,
      },
    ])

    const officialImport = await CalendarImport.create({
      sourceName: 'Calendario oficial IFMS',
      sourceUrl: 'https://www.ifms.edu.br/',
      importedById: admin.id,
      importedAt: DateTime.now(),
      status: 'completed',
      totalEvents: 2,
      checksum: 'demo-2026-01',
      rawPayload: null,
    })

    const now = DateTime.now().startOf('day')
    const events = await AcademicEvent.createMany([
      {
        title: 'Prova bimestral de Matematica',
        description:
          'Conteudo: funcoes, matrizes e revisao da lista 2. Pontuacao apenas informativa.',
        category: 'exam',
        source: 'teacher',
        startsAt: now.plus({ days: 5, hours: 19 }),
        points: 10,
        color: '#dc2626',
        academicClassId: academicClass.id,
        subjectId: math.id,
        teacherId: teacher.id,
        createdById: teacher.id,
      },
      {
        title: 'Entrega do trabalho de Engenharia de Software',
        description: 'Documento de requisitos e prototipo navegavel no Figma.',
        category: 'assignment',
        source: 'teacher',
        startsAt: now.plus({ days: 8, hours: 23, minutes: 59 }),
        points: 5,
        color: '#7c3aed',
        academicClassId: academicClass.id,
        subjectId: softwareEngineering.id,
        teacherId: teacher.id,
        createdById: teacher.id,
      },
      {
        title: 'Lista pratica de Estrutura de Dados',
        description: 'Exercicios sobre pilhas, filas e listas encadeadas.',
        category: 'activity',
        source: 'teacher',
        startsAt: now.plus({ days: 3, hours: 20 }),
        points: 2,
        color: '#0891b2',
        academicClassId: academicClass.id,
        subjectId: dataStructures.id,
        teacherId: secondTeacher.id,
        createdById: secondTeacher.id,
      },
      {
        title: 'Feriado municipal',
        description: 'Data oficial importada do calendario institucional.',
        category: 'holiday',
        source: 'imported',
        startsAt: now.plus({ days: 12 }),
        color: '#16a34a',
        calendarImportId: officialImport.id,
        createdById: admin.id,
        officialPriority: true,
      },
      {
        title: 'Recesso academico',
        description: 'Periodo sem aulas conforme calendario da reitoria.',
        category: 'recess',
        source: 'imported',
        startsAt: now.plus({ days: 20 }),
        endsAt: now.plus({ days: 22 }),
        color: '#2563eb',
        calendarImportId: officialImport.id,
        createdById: admin.id,
        officialPriority: true,
      },
    ])

    await Reminder.createMany(
      events.slice(0, 3).map((event) => ({
        userId: student.id,
        academicEventId: event.id,
        channel: 'email',
        offsetMinutes: student.defaultReminderMinutes,
        sendAt: reminderSendAt(event.startsAt, student.defaultReminderMinutes),
        enabled: true,
      }))
    )
  }
}
