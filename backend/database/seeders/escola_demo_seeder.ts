import { BaseSeeder } from '@adonisjs/lucid/seeders'
import AcademicClass, { ANNUAL_SEMESTER } from '#models/academic_class'
import AcademicEvent from '#models/academic_event'
import ClassInvite from '#models/class_invite'
import ClassSubject from '#models/class_subject'
import Course from '#models/course'
import Enrollment from '#models/enrollment'
import Grade from '#models/grade'
import GradeChange from '#models/grade_change'
import GradeImport from '#models/grade_import'
import GuardianLink from '#models/guardian_link'
import Notification from '#models/notification'
import Reminder from '#models/reminder'
import Subject from '#models/subject'
import TeachingAssignment from '#models/teaching_assignment'
import User from '#models/user'
import CalendarImport from '#models/calendar_import'
import CalendarPdfService from '#services/calendar_pdf_service'
import CalendarSyncService, { AlreadyImported } from '#services/calendar_sync_service'
import { appTimezone } from '#services/date_time_service'
import { DEMO_GUARDIAN_EMAIL, DEMO_STUDENT_EMAIL } from '#database/seeders/demo_datum_seeder'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import { readFile } from 'node:fs/promises'

/** Conta que só existe depois deste seed: o `db:seed-if-empty` usa para saber se ele já rodou. */
export const ESCOLA_DEMO_MARKER = 'sofia.ferreira@agenda.test'

/**
 * Dia no fuso da instituição (MS), `days` dias a partir de hoje, às `hour`:`minute`, em UTC.
 * Sábado e domingo vão para a segunda no futuro e para a sexta no passado: uma data passada
 * nunca vira hoje nem amanhã.
 */
function zonedDay(days: number, hour = 0, minute = 0) {
  const step = days < 0 ? -1 : 1
  let day = DateTime.now().setZone(appTimezone()).startOf('day').plus({ days })
  while (day.weekday > 5) day = day.plus({ days: step })
  return day.plus({ hours: hour, minutes: minute }).toUTC()
}

/** Calendário Acadêmico 2026 do campus (o de 2027 a administração importa pela tela). */
export const CALENDAR_2026_PDF = 'database/seeders/data/calendario-ifms-2026-tres-lagoas.pdf'

/**
 * Importa o calendário de 2026 como a tela faz: as datas só de servidores (PIT, RAD, diários)
 * ficam de fora, e o que já está no calendário oficial (mesmo título no mesmo dia) não repete.
 * Sem o arquivo, o seed segue sem ele: um PDF faltando não pode derrubar o início da API.
 */
async function importCalendar2026(importedById: number) {
  let data: Uint8Array
  try {
    data = new Uint8Array(await readFile(app.makePath(CALENDAR_2026_PDF)))
  } catch {
    logger.warn(`calendário de 2026 não encontrado (${CALENDAR_2026_PDF}): seed segue sem ele`)
    return
  }
  const calendar = await CalendarPdfService.parse(data)
  if (await CalendarImport.findBy('checksum', calendar.checksum)) return
  try {
    await CalendarSyncService.importEvents({
      sourceName: calendar.sourceName,
      checksum: calendar.checksum,
      importedById,
      events: calendar.events
        .filter((event) => event.audience === 'all')
        .map(({ title, description, category, startsAt, endsAt, sourceExternalId }) => ({
          title,
          description,
          category,
          startsAt,
          // como na tela (sync-view.tsx): término só com o dia vale até 23:59 dele
          endsAt: endsAt ? `${endsAt}T23:59` : null,
          sourceExternalId,
        })),
    })
  } catch (error) {
    if (!(error instanceof AlreadyImported)) throw error
  }
}

/** Nota sempre igual para o mesmo aluno e evento: de 55% a 100% da pontuação, em meio ponto. */
function demoScore(points: number, seed: number) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  const ratio = 0.55 + (x - Math.floor(x)) * 0.45
  return Math.round((Math.round(ratio * points * 2) / 2) * 100)
}

/** Tira acento e espaço do nome para montar o e-mail de demonstração. */
function demoEmail(fullName: string) {
  const [first, ...rest] = fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)
  return `${first}.${rest[rest.length - 1]}@agenda.test`
}

type StudentSeed = { name: string; registration: string; source?: string; status?: string }

/**
 * Escola de demonstração completa, por cima do núcleo de `demo_datum_seeder.ts`: quatro turmas
 * (duas do superior e duas do integrado), cinco docentes, quase 50 alunos, a mãe que acompanha
 * três filhos, pedidos de entrada, vínculo esperando a secretaria, notas publicadas, uma prova
 * que já passou sem nota lançada, evento cancelado e datas da instituição.
 *
 * Não roda nos testes (eles contam o que o núcleo cria). Pode rodar de novo: cada registro é
 * procurado pela chave natural antes de ser criado, e o que mudou na demonstração fica.
 */
export default class extends BaseSeeder {
  static environment = ['development', 'production']

  async run() {
    const year = DateTime.now().year
    const now = DateTime.now()

    // Núcleo (já criado pelo seed principal)
    const admin = await User.findByOrFail('email', 'admin@agenda.test')
    const maraisa = await User.findByOrFail('email', 'maraisa@agenda.test')
    const marina = await User.findByOrFail('email', 'marina@agenda.test')
    const lucas = await User.findByOrFail('email', DEMO_STUDENT_EMAIL)
    const juliana = await User.findByOrFail('email', DEMO_GUARDIAN_EMAIL)
    const ana = await User.findByOrFail('email', 'ana@agenda.test')
    const tadsCourse = await Course.findByOrFail('code', 'TADS')
    const integrated = await Course.findByOrFail('code', 'INFO-INT')
    const tads5 = await AcademicClass.query()
      .where({ courseId: tadsCourse.id, name: 'TADS 5', year })
      .firstOrFail()
    const inf3a = await AcademicClass.query()
      .where({ courseId: integrated.id, name: 'INF 3A', year })
      .firstOrFail()
    const math = await Subject.findByOrFail('code', 'MAT-401')
    const dataStructures = await Subject.findByOrFail('code', 'ED-401')
    const softwareEngineering = await Subject.findByOrFail('code', 'ES-401')
    const logic = await Subject.findByOrFail('code', 'LP-101')

    // Docentes novos
    const teacher = (email: string, fullName: string, registration: string) =>
      User.updateOrCreate(
        { email },
        {
          fullName,
          password: 'password123',
          role: 'teacher',
          registration,
          defaultReminderMinutes: 2880,
          notificationChannel: 'email',
        }
      )
    const ricardo = await teacher('ricardo@agenda.test', 'Prof. Ricardo Almeida', 'DOC-003')
    const helena = await teacher('helena@agenda.test', 'Profa. Helena Costa', 'DOC-004')
    const andre = await teacher('andre@agenda.test', 'Prof. André Nogueira', 'DOC-005')

    // Turmas novas: TADS 3 (superior, semestral) e INF 1A (integrado, anual)
    const tads3 = await AcademicClass.updateOrCreate(
      { courseId: tadsCourse.id, name: 'TADS 3', year, semester: 2 },
      { period: '3º período', shift: 'noturno' }
    )
    const inf1a = await AcademicClass.updateOrCreate(
      { courseId: integrated.id, name: 'INF 1A', year },
      { period: '1º ano', shift: 'matutino', semester: ANNUAL_SEMESTER }
    )
    for (const [target, code] of [
      [tads3, 'TADS3P8W'],
      [inf1a, 'INF1AH4R'],
    ] as const) {
      if (!target.joinCode) {
        target.joinCode = code
        target.joinCodeActive = true
        await target.save()
      }
    }

    // Disciplinas e quem dá aula de quê
    const subject = (code: string, name: string, workloadHours = 80) =>
      Subject.updateOrCreate({ code }, { name, workloadHours })
    const web = await subject('PW-301', 'Programação Web')
    const os = await subject('SO-301', 'Sistemas Operacionais')
    const discrete = await subject('MD-301', 'Matemática Discreta')
    const networks = await subject('RED-301', 'Redes de Computadores')
    const portuguese = await subject('POR-INT', 'Língua Portuguesa', 120)
    const physics = await subject('FIS-INT', 'Física', 120)
    const intro = await subject('INF-101', 'Introdução à Informática')

    const teach = async (teacherId: number, academicClassId: number, subjectId: number) => {
      await ClassSubject.updateOrCreate({ academicClassId, subjectId }, {})
      await TeachingAssignment.updateOrCreate({ teacherId, academicClassId, subjectId }, {})
    }
    await teach(ricardo.id, tads3.id, web.id)
    await teach(andre.id, tads3.id, os.id)
    await teach(maraisa.id, tads3.id, discrete.id)
    await teach(andre.id, inf3a.id, networks.id)
    await teach(helena.id, inf3a.id, portuguese.id)
    await teach(ricardo.id, inf3a.id, physics.id)
    await teach(andre.id, inf1a.id, intro.id)
    await teach(helena.id, inf1a.id, portuguese.id)
    await teach(ricardo.id, inf1a.id, physics.id)

    // Alunos. Os do integrado são menores de idade.
    const studentUser = async (
      data: StudentSeed,
      isMinor: boolean,
      email = demoEmail(data.name)
    ) => {
      const user = await User.updateOrCreate(
        { email },
        {
          fullName: data.name,
          password: 'password123',
          role: 'student',
          registration: data.registration,
          defaultReminderMinutes: 1440,
          notificationChannel: 'email',
        }
      )
      if (user.isMinor !== isMinor) {
        user.isMinor = isMinor
        await user.save()
      }
      return user
    }
    // firstOrCreate: quem a demonstração tirou da turma não volta sozinho
    const enroll = (user: User, academicClass: AcademicClass, source: string, status = 'active') =>
      Enrollment.firstOrCreate(
        { userId: user.id, academicClassId: academicClass.id },
        {
          status,
          source,
          decidedAt: status === 'active' && source === 'code' ? now.minus({ days: 60 }) : null,
          decidedById: status === 'active' && source === 'code' ? maraisa.id : null,
        }
      )

    const roster = async (
      academicClass: AcademicClass,
      people: StudentSeed[],
      isMinor: boolean,
      defaultSource: string
    ) => {
      const users: User[] = []
      for (const person of people) {
        const user = await studentUser(person, isMinor)
        await enroll(user, academicClass, person.source ?? defaultSource, person.status)
        if ((person.status ?? 'active') === 'active') users.push(user)
      }
      return users
    }

    const tads5Students = [
      lucas,
      ...(await roster(
        tads5,
        [
          { name: 'Beatriz Santos', registration: 'ALU-101' },
          { name: 'Caio Moreira', registration: 'ALU-102' },
          { name: 'Camila Rodrigues', registration: 'ALU-103' },
          { name: 'Eduardo Pires', registration: 'ALU-104', source: 'list' },
          { name: 'Fernanda Lopes', registration: 'ALU-105' },
          { name: 'Henrique Duarte', registration: 'ALU-106', source: 'list' },
          { name: 'Isabela Martins', registration: 'ALU-107' },
          { name: 'Leonardo Castro', registration: 'ALU-108' },
          { name: 'Mariana Teixeira', registration: 'ALU-109', source: 'list' },
          { name: 'Otávio Ramos', registration: 'ALU-110' },
          { name: 'Patrícia Vieira', registration: 'ALU-111' },
          { name: 'Renato Batista', registration: 'ALU-112', source: 'list' },
          { name: 'Tainá Correia', registration: 'ALU-113' },
          // Pedidos de entrada pelo código da turma, esperando a docente ou a secretaria
          { name: 'Vitor Prado', registration: 'ALU-114', status: 'pending' },
          { name: 'Yasmin Freitas', registration: 'ALU-115', status: 'pending' },
        ],
        false,
        'code'
      )),
    ]
    const tads3Students = await roster(
      tads3,
      [
        { name: 'Alice Monteiro', registration: 'ALU-201' },
        { name: 'Bruno Cardoso', registration: 'ALU-202' },
        { name: 'Daniela Fonseca', registration: 'ALU-203' },
        { name: 'Igor Tavares', registration: 'ALU-204' },
        { name: 'Jéssica Moura', registration: 'ALU-205' },
        { name: 'Kevin Rezende', registration: 'ALU-206' },
        { name: 'Luana Bezerra', registration: 'ALU-207' },
        { name: 'Murilo Antunes', registration: 'ALU-208' },
        { name: 'Rafaela Nunes', registration: 'ALU-209', status: 'pending' },
      ],
      false,
      'code'
    )

    // A mãe da demonstração tem três filhos: Lucas (TADS 5), Sofia (INF 3A) e Pedro (INF 1A)
    const sofia = await studentUser({ name: 'Sofia Ferreira', registration: 'ALU-301' }, true)
    await enroll(sofia, inf3a, 'admin')
    const pedro = await studentUser({ name: 'Pedro Ferreira', registration: 'ALU-401' }, true)
    await enroll(pedro, inf1a, 'admin')

    const inf3aStudents = [
      ana,
      sofia,
      ...(await roster(
        inf3a,
        [
          { name: 'Arthur Gomes', registration: 'ALU-302' },
          { name: 'Bianca Cunha', registration: 'ALU-303' },
          { name: 'Davi Machado', registration: 'ALU-304' },
          { name: 'Elisa Farias', registration: 'ALU-305' },
          { name: 'Gustavo Peixoto', registration: 'ALU-306' },
          { name: 'Heloísa Pacheco', registration: 'ALU-307' },
          { name: 'Manuela Siqueira', registration: 'ALU-308' },
          { name: 'Nicolas Barros', registration: 'ALU-309' },
        ],
        true,
        'admin'
      )),
    ]
    const inf1aStudents = [
      pedro,
      ...(await roster(
        inf1a,
        [
          { name: 'Clara Vasconcelos', registration: 'ALU-402' },
          { name: 'Enzo Rocha', registration: 'ALU-403' },
          { name: 'Giovana Lacerda', registration: 'ALU-404' },
          { name: 'Joaquim Brito', registration: 'ALU-405' },
          { name: 'Laura Mendonça', registration: 'ALU-406' },
          { name: 'Miguel Sampaio', registration: 'ALU-407' },
          { name: 'Valentina Coelho', registration: 'ALU-408' },
        ],
        true,
        'admin'
      )),
    ]

    // Convites para quem ainda não criou a conta
    for (const [academicClass, email] of [
      [tads5, 'rodrigo.alencar@agenda.test'],
      [tads3, 'thalita.reis@agenda.test'],
    ] as const) {
      await ClassInvite.firstOrCreate(
        { academicClassId: academicClass.id, email },
        { createdById: admin.id }
      )
    }

    // Responsáveis
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
    const marcos = await guardian('marcos.gomes@agenda.test', 'Marcos Gomes')
    const sandra = await guardian('sandra.martins@agenda.test', 'Sandra Martins')
    const roberto = await guardian('roberto.castro@agenda.test', 'Roberto Castro')
    const byEmail = (email: string) => User.findByOrFail('email', email)
    const arthur = await byEmail('arthur.gomes@agenda.test')
    const isabela = await byEmail('isabela.martins@agenda.test')
    const leonardo = await byEmail('leonardo.castro@agenda.test')

    const notify = (
      userId: number,
      kind: string,
      title: string,
      body: string,
      link: string,
      createdAt: DateTime,
      read = true
    ) =>
      Notification.firstOrCreate(
        { userId, kind, title },
        { body, link, createdAt, readAt: read ? createdAt.plus({ hours: 2 }) : null }
      )

    const link = async (
      guardianUser: User,
      student: User,
      data: {
        relationship: 'mae' | 'pai'
        origin: 'student_code' | 'admin_code' | 'admin'
        status?: 'active' | 'pending'
        shareGrades?: boolean
        daysAgo: number
      }
    ) => {
      const status = data.status ?? 'active'
      const approved = status === 'active' && data.origin !== 'student_code'
      const createdAt = now.minus({ days: data.daysAgo })
      const existing = await GuardianLink.findBy({
        guardianId: guardianUser.id,
        studentId: student.id,
      })
      if (existing) return existing
      const created = await GuardianLink.create({
        guardianId: guardianUser.id,
        studentId: student.id,
        relationship: data.relationship,
        status,
        origin: data.origin,
        shareGrades: data.shareGrades ?? false,
        createdById: data.origin === 'student_code' ? guardianUser.id : admin.id,
        approvedById: approved ? admin.id : null,
        approvedAt: approved ? createdAt : null,
        createdAt,
      })
      const relationship = data.relationship === 'mae' ? 'mãe' : 'pai'
      const first = student.fullName!.split(' ')[0]
      if (status === 'active') {
        await notify(
          student.id,
          'guardian_linked',
          `${guardianUser.fullName} agora acompanha sua agenda`,
          `Parentesco: ${relationship}. Você vê quem acompanha sua agenda no seu perfil.`,
          '?tela=perfil',
          createdAt
        )
        if (data.origin !== 'student_code') {
          await notify(
            guardianUser.id,
            'guardian_linked',
            `Agora você acompanha ${first}`,
            'A secretaria vinculou sua conta.',
            '?tela=painel',
            createdAt
          )
        }
      } else {
        await notify(
          student.id,
          'guardian_pending',
          `${guardianUser.fullName} pediu para acompanhar sua agenda`,
          `Parentesco: ${relationship}. A secretaria confirma antes de liberar.`,
          '?tela=perfil',
          createdAt,
          false
        )
        // Só a administração de demonstração: as contas reais de coordenação não recebem
        await notify(
          admin.id,
          'guardian_pending',
          'Vínculo de responsável aguardando aprovação',
          `${guardianUser.fullName} pediu para acompanhar a agenda de ${student.fullName}.`,
          '?tela=turmas',
          createdAt,
          false
        )
      }
      return created
    }
    await link(juliana, sofia, { relationship: 'mae', origin: 'admin_code', daysAgo: 70 })
    await link(juliana, pedro, { relationship: 'mae', origin: 'admin', daysAgo: 40 })
    await link(marcos, arthur, {
      relationship: 'pai',
      origin: 'student_code',
      status: 'pending',
      daysAgo: 1,
    })
    await link(sandra, isabela, { relationship: 'mae', origin: 'student_code', daysAgo: 30 })
    await link(roberto, leonardo, {
      relationship: 'pai',
      origin: 'student_code',
      shareGrades: true,
      daysAgo: 25,
    })

    // Eventos. Superior à noite (19:00), integrado de manhã (08:00 e 10:00).
    const colors: Record<number, string> = {
      [math.id]: '#dc2626',
      [dataStructures.id]: '#0891b2',
      [softwareEngineering.id]: '#7c3aed',
      [logic.id]: '#2563eb',
      [web.id]: '#ea580c',
      [os.id]: '#4d7c0f',
      [discrete.id]: '#be185d',
      [networks.id]: '#0f766e',
      [portuguese.id]: '#9333ea',
      [physics.id]: '#ca8a04',
      [intro.id]: '#0284c7',
    }
    type EventSeed = {
      title: string
      category: string
      academicClass: AcademicClass
      subject: Subject
      teacher: User
      startsAt: DateTime
      endsAt?: DateTime
      points?: number
      location?: string
      description: string
      status?: string
    }
    const classEvent = (data: EventSeed) =>
      AcademicEvent.firstOrCreate(
        { title: data.title, academicClassId: data.academicClass.id },
        {
          title: data.title,
          description: data.description,
          category: data.category,
          source: 'teacher',
          status: data.status ?? 'scheduled',
          startsAt: data.startsAt,
          endsAt: data.endsAt ?? null,
          points: data.points ?? null,
          location: data.location ?? null,
          color: colors[data.subject.id] ?? null,
          academicClassId: data.academicClass.id,
          subjectId: data.subject.id,
          teacherId: data.teacher.id,
          createdById: data.teacher.id,
          officialPriority: false,
        }
      )

    // TADS 5
    const listaMat = await classEvent({
      title: 'Lista 3 de exercícios de Matemática',
      category: 'assignment',
      academicClass: tads5,
      subject: math,
      teacher: maraisa,
      startsAt: zonedDay(2, 23, 59),
      points: 2,
      description: 'Exercícios 1 a 15 da lista 3, sobre matrizes e determinantes. Entregar em PDF.',
    })
    await classEvent({
      title: 'Exercícios de árvores binárias',
      category: 'assignment',
      academicClass: tads5,
      subject: dataStructures,
      teacher: marina,
      startsAt: zonedDay(3, 23, 59),
      points: 3,
      description: 'Implementar inserção, busca e remoção numa árvore binária de busca.',
    })
    await classEvent({
      title: 'Aula de reposição de Estrutura de Dados',
      category: 'activity',
      academicClass: tads5,
      subject: dataStructures,
      teacher: marina,
      startsAt: zonedDay(5, 19),
      location: 'Laboratório 3',
      status: 'cancelled',
      description: 'Cancelada: a reposição fica para depois da semana de recuperação.',
    })
    await classEvent({
      title: 'Seminário: métodos ágeis',
      category: 'activity',
      academicClass: tads5,
      subject: softwareEngineering,
      teacher: maraisa,
      startsAt: zonedDay(7, 19),
      points: 5,
      location: 'Auditório',
      description:
        'Grupos de quatro. Cada grupo apresenta um método (Scrum, Kanban, XP ou Lean) em 15 minutos.',
    })
    const prototipo = await classEvent({
      title: 'Entrega do protótipo do projeto',
      category: 'assignment',
      academicClass: tads5,
      subject: softwareEngineering,
      teacher: maraisa,
      startsAt: zonedDay(12, 23, 59),
      points: 15,
      description: 'Protótipo navegável das telas principais e o documento de requisitos revisado.',
    })
    await classEvent({
      title: 'Visita técnica a uma empresa de software',
      category: 'extracurricular',
      academicClass: tads5,
      subject: softwareEngineering,
      teacher: maraisa,
      startsAt: zonedDay(16, 14),
      endsAt: zonedDay(16, 18),
      location: 'Saída em frente ao Bloco A',
      description: 'Ônibus do campus. Levar documento com foto.',
    })
    // Já passou e a docente ainda não lançou as notas: é onde a demonstração lança uma nota
    await classEvent({
      title: 'Avaliação de UML',
      category: 'exam',
      academicClass: tads5,
      subject: softwareEngineering,
      teacher: maraisa,
      startsAt: zonedDay(-2, 19),
      points: 10,
      location: 'Sala 7, Bloco A',
      description: 'Diagramas de casos de uso, de classes e de sequência.',
    })
    const edPast = await classEvent({
      title: 'Prova 1 de Estrutura de Dados',
      category: 'exam',
      academicClass: tads5,
      subject: dataStructures,
      teacher: marina,
      startsAt: zonedDay(-19, 19),
      points: 10,
      location: 'Laboratório 3',
      status: 'completed',
      description: 'Conteúdo: recursão, vetores e listas.',
    })

    // TADS 3
    await classEvent({
      title: 'Prova de Programação Web',
      category: 'exam',
      academicClass: tads3,
      subject: web,
      teacher: ricardo,
      startsAt: zonedDay(6, 19),
      points: 10,
      location: 'Laboratório 2',
      description: 'HTML semântico, CSS com flexbox e grid, e formulários.',
    })
    await classEvent({
      title: 'Prova de Matemática Discreta',
      category: 'exam',
      academicClass: tads3,
      subject: discrete,
      teacher: maraisa,
      startsAt: zonedDay(8, 19),
      points: 10,
      location: 'Sala 5, Bloco B',
      description: 'Conjuntos, relações e indução matemática.',
    })
    await classEvent({
      title: 'Trabalho de Sistemas Operacionais',
      category: 'assignment',
      academicClass: tads3,
      subject: os,
      teacher: andre,
      startsAt: zonedDay(10, 23, 59),
      points: 10,
      description: 'Relatório sobre escalonamento de processos, com exemplos de cada algoritmo.',
    })
    const webPast = await classEvent({
      title: 'Prova 1 de Programação Web',
      category: 'exam',
      academicClass: tads3,
      subject: web,
      teacher: ricardo,
      startsAt: zonedDay(-9, 19),
      points: 10,
      location: 'Laboratório 2',
      status: 'completed',
      description: 'Estrutura de uma página e seletores CSS.',
    })
    const discretePast = await classEvent({
      title: 'Lista de lógica proposicional',
      category: 'assignment',
      academicClass: tads3,
      subject: discrete,
      teacher: maraisa,
      startsAt: zonedDay(-5, 23, 59),
      points: 5,
      status: 'completed',
      description: 'Tabelas-verdade e equivalências. Entregue em PDF.',
    })

    // INF 3A
    const logicExam = await classEvent({
      title: 'Prova de Lógica de Programação',
      category: 'exam',
      academicClass: inf3a,
      subject: logic,
      teacher: marina,
      startsAt: zonedDay(5, 8),
      points: 10,
      location: 'Laboratório 1',
      description: 'Estruturas de repetição e vetores.',
    })
    await classEvent({
      title: 'Redação dissertativa',
      category: 'assignment',
      academicClass: inf3a,
      subject: portuguese,
      teacher: helena,
      startsAt: zonedDay(8, 23, 59),
      points: 10,
      description: 'Tema: o uso do celular na escola. De 25 a 30 linhas.',
    })
    await classEvent({
      title: 'Prova de Física',
      category: 'exam',
      academicClass: inf3a,
      subject: physics,
      teacher: ricardo,
      startsAt: zonedDay(13, 10),
      points: 10,
      location: 'Sala 4',
      description: 'Eletrostática e circuitos simples.',
    })
    await classEvent({
      title: 'Feira de Ciências e Tecnologia',
      category: 'extracurricular',
      academicClass: inf3a,
      subject: physics,
      teacher: ricardo,
      startsAt: zonedDay(18, 8),
      endsAt: zonedDay(18, 12),
      location: 'Quadra do campus',
      description:
        'Os projetos dos grupos ficam expostos durante a manhã. Responsáveis são bem-vindos.',
    })
    const logicPast = await classEvent({
      title: 'Prova 1 de Lógica de Programação',
      category: 'exam',
      academicClass: inf3a,
      subject: logic,
      teacher: marina,
      startsAt: zonedDay(-10, 8),
      points: 10,
      location: 'Laboratório 1',
      status: 'completed',
      description: 'Variáveis, condicionais e fluxogramas.',
    })
    const networksPast = await classEvent({
      title: 'Trabalho de Redes: cabeamento estruturado',
      category: 'assignment',
      academicClass: inf3a,
      subject: networks,
      teacher: andre,
      startsAt: zonedDay(-4, 23, 59),
      points: 10,
      status: 'completed',
      description: 'Montagem e teste de um cabo de rede, com relatório em grupo.',
    })

    // INF 1A
    const introExam = await classEvent({
      title: 'Prova de Introdução à Informática',
      category: 'exam',
      academicClass: inf1a,
      subject: intro,
      teacher: andre,
      startsAt: zonedDay(6, 10),
      points: 10,
      location: 'Laboratório 1',
      description: 'Partes do computador, sistema operacional e arquivos.',
    })
    await classEvent({
      title: 'Apresentação: história da computação',
      category: 'activity',
      academicClass: inf1a,
      subject: intro,
      teacher: andre,
      startsAt: zonedDay(11, 8),
      points: 5,
      location: 'Sala 2',
      description: 'Cada dupla apresenta um personagem ou uma máquina importante.',
    })
    await classEvent({
      title: 'Leitura de Dom Casmurro',
      category: 'assignment',
      academicClass: inf1a,
      subject: portuguese,
      teacher: helena,
      startsAt: zonedDay(16, 23, 59),
      points: 10,
      description: 'Resumo de uma página sobre os capítulos 1 a 20.',
    })
    const portuguesePast = await classEvent({
      title: 'Avaliação de Língua Portuguesa',
      category: 'exam',
      academicClass: inf1a,
      subject: portuguese,
      teacher: helena,
      startsAt: zonedDay(-8, 10),
      points: 10,
      location: 'Sala 2',
      status: 'completed',
      description: 'Interpretação de texto e classes de palavras.',
    })

    // Datas da instituição: para todas as turmas, publicadas pela administração
    const official = (data: {
      title: string
      category: string
      startsAt: DateTime
      endsAt?: DateTime
      location?: string
      description: string
    }) =>
      AcademicEvent.firstOrCreate(
        { title: data.title, academicClassId: null },
        {
          title: data.title,
          description: data.description,
          category: data.category,
          source: 'official',
          status: 'scheduled',
          startsAt: data.startsAt,
          endsAt: data.endsAt ?? null,
          location: data.location ?? null,
          officialPriority: true,
          academicClassId: null,
          subjectId: null,
          teacherId: null,
          createdById: admin.id,
        }
      )
    const meeting = await official({
      title: 'Reunião de pais e responsáveis',
      category: 'institutional',
      startsAt: zonedDay(9, 19),
      endsAt: zonedDay(9, 21),
      location: 'Auditório',
      description: 'Conversa com a coordenação e com os docentes sobre o andamento do ano.',
    })
    // As outras datas da instituição são as de verdade: o Calendário Acadêmico 2026 do campus
    // (feriados, recessos, fim do semestre em dezembro e o histórico do ano)
    await importCalendar2026(admin.id)

    // Notas publicadas: todos os alunos da turma, com algumas faltas
    const mathPast = await AcademicEvent.findBy({
      title: 'Prova 1 de Matemática',
      academicClassId: tads5.id,
    })
    const examImport = mathPast
      ? await GradeImport.findBy({
          academicEventId: mathPast.id,
          checksum: 'demo-prova-1-matematica',
        })
      : null
    const requirementsPast = await AcademicEvent.findBy({
      title: 'Trabalho de requisitos',
      academicClassId: tads5.id,
    })

    const publishGrades = async (
      event: AcademicEvent | null,
      students: User[],
      teacherUser: User,
      subjectName: string,
      daysAgo: number,
      gradeImport: GradeImport | null = null
    ) => {
      if (!event) return
      const publishedAt = event.gradesPublishedAt ?? now.minus({ days: daysAgo })
      const changedAt = publishedAt.minus({ hours: 1 })
      let created = 0
      for (const [index, student] of students.entries()) {
        const existing = await Grade.findBy({ academicEventId: event.id, studentId: student.id })
        if (existing) continue
        const seed = student.id * 31 + event.id * 7 + index
        const absent = seed % 11 === 3
        const score = absent ? null : demoScore(Number(event.points ?? 10), seed)
        const grade = await Grade.create({
          academicEventId: event.id,
          studentId: student.id,
          score,
          status: absent ? 'absent' : 'graded',
          gradeImportId: gradeImport?.id ?? null,
          updatedById: teacherUser.id,
          createdAt: changedAt,
          updatedAt: changedAt,
        })
        await GradeChange.create({
          gradeId: grade.id,
          oldScore: null,
          newScore: score,
          oldStatus: null,
          newStatus: grade.status,
          source: gradeImport ? 'import' : 'manual',
          gradeImportId: gradeImport?.id ?? null,
          changedById: teacherUser.id,
          createdAt: changedAt,
        })
        created++
      }
      if (gradeImport && created) {
        gradeImport.newCount += created
        await gradeImport.save()
      }
      if (!event.gradesPublishedAt) {
        event.gradesPublishedAt = publishedAt
        event.gradesPublishedById = teacherUser.id
        await event.save()
      }

      // Avisos de nota publicada: o aluno e quem o acompanha com direito de ver as notas
      const read = daysAgo > 2
      for (const student of students) {
        await notify(
          student.id,
          'grades_published',
          `Nota publicada: ${event.title}`,
          `${subjectName}. Veja na tela Notas.`,
          `?tela=notas&evento=${event.id}`,
          publishedAt,
          read
        )
        const links = await GuardianLink.query().where({ studentId: student.id, status: 'active' })
        for (const guardianLink of links) {
          if (!student.isMinor && !guardianLink.shareGrades) continue
          await notify(
            guardianLink.guardianId,
            'grades_published',
            `Nota de ${student.fullName!.split(' ')[0]} publicada: ${event.title}`,
            `${subjectName}. Veja na tela Notas.`,
            `?tela=notas&aluno=${student.id}&evento=${event.id}`,
            publishedAt,
            read
          )
        }
      }
    }
    await publishGrades(mathPast, tads5Students, maraisa, math.name, 9, examImport)
    await publishGrades(requirementsPast, tads5Students, maraisa, softwareEngineering.name, 2)
    await publishGrades(edPast, tads5Students, marina, dataStructures.name, 14)
    await publishGrades(webPast, tads3Students, ricardo, web.name, 5)
    await publishGrades(discretePast, tads3Students, maraisa, discrete.name, 1)
    await publishGrades(logicPast, inf3aStudents, marina, logic.name, 6)
    await publishGrades(networksPast, inf3aStudents, andre, networks.name, 1)
    await publishGrades(portuguesePast, inf1aStudents, helena, portuguese.name, 3)

    // Lembretes já ligados nas contas do aluno e da mãe
    const mathExam = await AcademicEvent.findBy({
      title: 'Prova de Matemática',
      academicClassId: tads5.id,
    })
    const edExam = await AcademicEvent.findBy({
      title: 'Prova de Estrutura de Dados',
      academicClassId: tads5.id,
    })
    const remind = async (user: User, event: AcademicEvent | null, offsetMinutes: number) => {
      if (!event) return
      await Reminder.firstOrCreate(
        { userId: user.id, academicEventId: event.id, channel: 'email' },
        { offsetMinutes, sendAt: event.startsAt.minus({ minutes: offsetMinutes }), enabled: true }
      )
    }
    await remind(lucas, mathExam, 1440)
    await remind(lucas, edExam, 2880)
    await remind(lucas, listaMat, 720)
    await remind(lucas, prototipo, 1440)
    await remind(juliana, logicExam, 1440)
    await remind(juliana, introExam, 1440)
    await remind(juliana, meeting, 1440)
    await remind(sofia, logicExam, 1440)
  }
}
