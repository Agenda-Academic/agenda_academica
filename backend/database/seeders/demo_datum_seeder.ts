import { BaseSeeder } from '@adonisjs/lucid/seeders'
import AcademicClass, { ANNUAL_SEMESTER } from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import ClassSubject from '#models/class_subject'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import Grade from '#models/grade'
import GradeChange from '#models/grade_change'
import GradeImport from '#models/grade_import'
import GuardianLink from '#models/guardian_link'
import Notification from '#models/notification'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import { DateTime } from 'luxon'

/** Dia letivo às `hour` horas (America/Sao_Paulo), normalizado para UTC; sábado e domingo vão para a segunda. */
function classDay(days: number, hour: number, minute = 0) {
  let day = DateTime.now().setZone('America/Sao_Paulo').startOf('day').plus({ days })
  while (day.weekday > 5) day = day.plus({ days: 1 })
  return day.plus({ hours: hour, minutes: minute }).toUTC()
}

/**
 * Dados de demonstração. Pode rodar quantas vezes quiser: tudo é `updateOrCreate` pela chave
 * natural (e-mail, código, nome da turma no período), então não duplica nada. Os registros
 * novos ficam no fim, para não mudar os ids que os testes usam (turma 1, disciplinas 1 e 3).
 */
export default class extends BaseSeeder {
  async run() {
    const year = DateTime.now().year
    const demoUser = (
      email: string,
      data: { fullName: string; role: string; registration: string; minutes: number }
    ) =>
      User.updateOrCreate(
        { email },
        {
          fullName: data.fullName,
          password: 'password123',
          role: data.role,
          registration: data.registration,
          defaultReminderMinutes: data.minutes,
          notificationChannel: 'email',
        }
      )

    const admin = await demoUser('admin@agenda.test', {
      fullName: 'Coordenação Acadêmica',
      role: 'admin',
      registration: 'ADM-001',
      minutes: 1440,
    })
    const teacher = await demoUser('maraisa@agenda.test', {
      fullName: 'Profa. Maraísa',
      role: 'teacher',
      registration: 'DOC-001',
      minutes: 2880,
    })
    const secondTeacher = await demoUser('marina@agenda.test', {
      fullName: 'Profa. Marina Souza',
      role: 'teacher',
      registration: 'DOC-002',
      minutes: 2880,
    })
    const student = await demoUser('diogo@agenda.test', {
      fullName: 'Diogo Queiroz da Silva',
      role: 'student',
      registration: 'ALU-001',
      minutes: 1440,
    })

    const course = await Course.updateOrCreate(
      { code: 'TADS' },
      {
        name: 'Tecnologia em Análise e Desenvolvimento de Sistemas',
        campus: 'Três Lagoas',
        modality: 'superior',
      }
    )

    const academicClass = await AcademicClass.updateOrCreate(
      { courseId: course.id, name: 'TADS 5', year, semester: 2 },
      { period: '5º período', shift: 'noturno' }
    )

    const subject = (code: string, name: string) =>
      Subject.updateOrCreate({ code }, { name, workloadHours: 80 })
    const math = await subject('MAT-401', 'Matemática')
    const dataStructures = await subject('ED-401', 'Estrutura de Dados')
    const softwareEngineering = await subject('ES-401', 'Engenharia de Software')

    await Enrollment.updateOrCreate(
      { userId: student.id, academicClassId: academicClass.id },
      { status: 'active' }
    )

    const assign = (teacherId: number, academicClassId: number, subjectId: number) =>
      TeachingAssignment.updateOrCreate({ teacherId, academicClassId, subjectId }, {})
    await assign(teacher.id, academicClass.id, math.id)
    await assign(teacher.id, academicClass.id, softwareEngineering.id)
    await assign(secondTeacher.id, academicClass.id, dataStructures.id)

    // Eventos com datas relativas a hoje: só entram se ainda não existem, para não
    // empurrar datas (e lembretes) a cada vez que o seed roda.
    const event = (data: Partial<AcademicEvent> & { title: string }) =>
      AcademicEvent.firstOrCreate({ title: data.title, academicClassId: academicClass.id }, data)
    await event({
      title: 'Prova de Matemática',
      description:
        'Conteúdo: funções, matrizes e revisão da lista 2. Pontuação apenas informativa.',
      category: 'exam',
      source: 'teacher',
      startsAt: classDay(4, 19),
      points: 10,
      location: 'Sala 12, Bloco B',
      color: '#dc2626',
      academicClassId: academicClass.id,
      subjectId: math.id,
      teacherId: teacher.id,
      createdById: teacher.id,
    })
    await event({
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
    })
    await event({
      title: 'Prova de Engenharia de Software',
      description: 'Conteúdo: requisitos, UML e processos ágeis. Consulta liberada ao material.',
      category: 'exam',
      source: 'teacher',
      startsAt: classDay(15, 19),
      points: 10,
      location: 'Sala 7, Bloco A',
      color: '#7c3aed',
      academicClassId: academicClass.id,
      subjectId: softwareEngineering.id,
      teacherId: teacher.id,
      createdById: teacher.id,
    })

    // Fase 1: ofertas da TADS 5, uma delas sem docente para mostrar a pendência.
    const databases = await subject('BD-401', 'Banco de Dados')
    const offer = (academicClassId: number, subjectId: number) =>
      ClassSubject.updateOrCreate({ academicClassId, subjectId }, {})
    await offer(academicClass.id, math.id)
    await offer(academicClass.id, dataStructures.id)
    await offer(academicClass.id, softwareEngineering.id)
    await offer(academicClass.id, databases.id)

    // Curso integrado de demonstração, com a turma INF 3A e uma aluna menor de idade.
    const integrated = await Course.updateOrCreate(
      { code: 'INFO-INT' },
      {
        name: 'Técnico em Informática Integrado ao Ensino Médio',
        campus: 'Três Lagoas',
        modality: 'integrado',
      }
    )
    // Turma anual (semestre 0). A busca não usa o semestre: a INF 3A gravada antes, no
    // 2º semestre, é a mesma linha e só passa a anual, sem mudar o id.
    const integratedClass = await AcademicClass.updateOrCreate(
      { courseId: integrated.id, name: 'INF 3A', year },
      { period: '3º ano', shift: 'matutino', semester: ANNUAL_SEMESTER }
    )
    const logic = await subject('LP-101', 'Lógica de Programação')
    await offer(integratedClass.id, logic.id)
    await assign(secondTeacher.id, integratedClass.id, logic.id)

    const minorStudent = await demoUser('ana@agenda.test', {
      fullName: 'Ana Clara Ribeiro',
      role: 'student',
      registration: 'ALU-002',
      minutes: 1440,
    })
    minorStudent.isMinor = true
    await minorStudent.save()
    await Enrollment.updateOrCreate(
      { userId: minorStudent.id, academicClassId: integratedClass.id },
      { status: 'active', source: 'admin' }
    )

    // Códigos de turma ligados. Só gravados quando a turma ainda não tem código, para não
    // desfazer um código novo gerado pela secretaria ou pela docente.
    for (const [target, code] of [
      [academicClass, 'TADS5K7Q'],
      [integratedClass, 'TEC3AM2X'],
    ] as const) {
      if (!target.joinCode) {
        target.joinCode = code
        target.joinCodeActive = true
        await target.save()
      }
    }

    // Fase 2: dois responsáveis, com a mesma senha das contas demo e sem matrícula.
    const guardian = (email: string, fullName: string) =>
      User.updateOrCreate(
        { email },
        {
          fullName,
          password: 'password123',
          role: 'guardian',
          registration: null,
          defaultReminderMinutes: 1440,
          notificationChannel: 'email',
        }
      )
    const maria = await guardian('maria@agenda.test', 'Maria Queiroz')
    const carlos = await guardian('carlos@agenda.test', 'Carlos Ribeiro')

    // Vínculos com firstOrCreate: o seed não desfaz o que foi mudado na demonstração (um
    // vínculo desfeito ou bloqueado continua assim).
    const now = DateTime.now()
    await GuardianLink.firstOrCreate(
      { guardianId: maria.id, studentId: student.id },
      {
        relationship: 'mae',
        status: 'active',
        origin: 'student_code',
        shareGrades: true,
        createdById: maria.id,
      }
    )
    await GuardianLink.firstOrCreate(
      { guardianId: carlos.id, studentId: minorStudent.id },
      {
        relationship: 'pai',
        status: 'active',
        origin: 'admin',
        shareGrades: false,
        createdById: admin.id,
        approvedById: admin.id,
        approvedAt: now,
      }
    )

    // O aviso que cada aluno recebeu quando o vínculo foi criado.
    await Notification.firstOrCreate(
      {
        userId: student.id,
        kind: 'guardian_linked',
        title: 'Maria Queiroz agora acompanha sua agenda',
      },
      {
        body: 'Parentesco: mãe. Você vê quem acompanha sua agenda no seu perfil.',
        link: '?tela=perfil',
      }
    )
    await Notification.firstOrCreate(
      {
        userId: minorStudent.id,
        kind: 'guardian_linked',
        title: 'Carlos Ribeiro agora acompanha sua agenda',
      },
      {
        body: 'Parentesco: pai. Você vê quem acompanha sua agenda no seu perfil.',
        link: '?tela=perfil',
      }
    )

    // Fase 3: uma prova e um trabalho da TADS 5 que já aconteceram, com as notas do Diogo
    // publicadas. A da prova veio de uma importação (modelo da Agenda); a do trabalho foi
    // digitada na Agenda. Tudo com firstOrCreate: o seed não desfaz o que mudou na
    // demonstração (nota editada, importação desfeita, notas despublicadas).
    const pastExam = await event({
      title: 'Prova 1 de Matemática',
      description: 'Conteúdo: funções do 1º e do 2º grau. Nota já publicada.',
      category: 'exam',
      source: 'teacher',
      status: 'completed',
      startsAt: classDay(-12, 19),
      points: 10,
      location: 'Sala 12, Bloco B',
      color: '#dc2626',
      academicClassId: academicClass.id,
      subjectId: math.id,
      teacherId: teacher.id,
      createdById: teacher.id,
    })
    const pastAssignment = await event({
      title: 'Trabalho de requisitos',
      description: 'Documento de requisitos em grupo. Nota já publicada.',
      category: 'assignment',
      source: 'teacher',
      status: 'completed',
      startsAt: classDay(-6, 23, 59),
      points: 10,
      color: '#7c3aed',
      academicClassId: academicClass.id,
      subjectId: softwareEngineering.id,
      teacherId: teacher.id,
      createdById: teacher.id,
    })

    const examPublishedAt = now.minus({ days: 9 })
    const assignmentPublishedAt = now.minus({ days: 2 })
    const examImport = await GradeImport.firstOrCreate(
      { academicEventId: pastExam.id, fileName: 'notas-prova-1-matematica.csv' },
      {
        createdById: teacher.id,
        source: 'modelo',
        checksum: 'demo-prova-1-matematica',
        mapping: JSON.stringify({
          identifierType: 'email',
          identifierColumn: 'e-mail',
          scoreColumn: 'nota',
          nameColumn: 'nome',
        }),
        status: 'applied',
        newCount: 1,
        appliedAt: examPublishedAt.minus({ hours: 1 }),
        createdAt: examPublishedAt.minus({ hours: 1 }),
      }
    )

    const demoGrades = [
      {
        target: pastExam,
        score: 750,
        gradeImportId: examImport.id,
        publishedAt: examPublishedAt,
      },
      {
        target: pastAssignment,
        score: 900,
        gradeImportId: null,
        publishedAt: assignmentPublishedAt,
      },
    ]
    for (const item of demoGrades) {
      // Só quando o evento acabou de ser criado: rodar o seed de novo não recria a nota que
      // foi apagada ou desfeita na demonstração (a da prova voltaria presa a uma importação
      // desfeita) e não publica de novo o que foi despublicado.
      if (!item.target.$isLocal) {
        continue
      }
      const existing = await Grade.query()
        .where('academicEventId', item.target.id)
        .where('studentId', student.id)
        .first()
      if (existing) {
        continue
      }
      const changedAt = item.publishedAt.minus({ hours: 1 })
      const grade = await Grade.create({
        academicEventId: item.target.id,
        studentId: student.id,
        score: item.score,
        status: 'graded',
        gradeImportId: item.gradeImportId,
        updatedById: teacher.id,
        createdAt: changedAt,
        updatedAt: changedAt,
      })
      await GradeChange.create({
        gradeId: grade.id,
        oldScore: null,
        newScore: item.score,
        oldStatus: null,
        newStatus: 'graded',
        source: item.gradeImportId ? 'import' : 'manual',
        gradeImportId: item.gradeImportId,
        changedById: teacher.id,
        createdAt: changedAt,
      })
      if (item.target.gradesPublishedAt) {
        continue
      }
      item.target.gradesPublishedAt = item.publishedAt
      item.target.gradesPublishedById = teacher.id
      await item.target.save()
    }
  }
}
