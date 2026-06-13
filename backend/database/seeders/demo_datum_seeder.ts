import { BaseSeeder } from '@adonisjs/lucid/seeders'
import AcademicClass from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import { DateTime } from 'luxon'

/** Dia letivo às `hour` horas (America/Sao_Paulo), normalizado para UTC. */
function classDay(days: number, hour: number, minute = 0) {
  return DateTime.now()
    .setZone('America/Sao_Paulo')
    .startOf('day')
    .plus({ days, hours: hour, minutes: minute })
    .toUTC()
}

export default class extends BaseSeeder {
  async run() {
    const [, teacher, secondTeacher, student] = await User.createMany([
      {
        fullName: 'Coordenação Acadêmica',
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
        fullName: 'Diogo Queiroz da Silva',
        email: 'diogo@agenda.test',
        password: 'password123',
        role: 'student',
        registration: 'ALU-001',
        defaultReminderMinutes: 1440,
        notificationChannel: 'email',
      },
    ])

    const course = await Course.create({
      code: 'TADS',
      name: 'Tecnologia em Análise e Desenvolvimento de Sistemas',
      campus: 'Três Lagoas',
    })

    const academicClass = await AcademicClass.create({
      courseId: course.id,
      name: 'TADS 4',
      period: '4º período',
      year: DateTime.now().year,
      semester: 1,
      shift: 'noturno',
    })

    const [math, dataStructures, softwareEngineering] = await Subject.createMany([
      { code: 'MAT-401', name: 'Matemática', workloadHours: 80 },
      { code: 'ED-401', name: 'Estrutura de Dados', workloadHours: 80 },
      { code: 'ES-401', name: 'Engenharia de Software', workloadHours: 80 },
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

    await AcademicEvent.createMany([
      {
        title: 'Prova de Matemática',
        description:
          'Conteúdo: funções, matrizes e revisão da lista 2. Pontuação apenas informativa.',
        category: 'exam',
        source: 'teacher',
        startsAt: classDay(4, 19),
        points: 10,
        location: 'Sala 12 · Bloco B',
        color: '#dc2626',
        academicClassId: academicClass.id,
        subjectId: math.id,
        teacherId: teacher.id,
        createdById: teacher.id,
      },
      {
        title: 'Prova de Estrutura de Dados',
        description: 'Conteúdo: pilhas, filas, listas encadeadas e árvores binárias.',
        category: 'exam',
        source: 'teacher',
        startsAt: classDay(9, 19),
        points: 10,
        location: 'Laboratório 3',
        color: '#0891b2',
        academicClassId: academicClass.id,
        subjectId: dataStructures.id,
        teacherId: secondTeacher.id,
        createdById: secondTeacher.id,
      },
      {
        title: 'Prova de Engenharia de Software',
        description: 'Conteúdo: requisitos, UML e processos ágeis. Consulta liberada ao material.',
        category: 'exam',
        source: 'teacher',
        startsAt: classDay(15, 19),
        points: 10,
        location: 'Sala 7 · Bloco A',
        color: '#7c3aed',
        academicClassId: academicClass.id,
        subjectId: softwareEngineering.id,
        teacherId: teacher.id,
        createdById: teacher.id,
      },
    ])
  }
}
