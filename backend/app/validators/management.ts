import { ENROLLMENT_STATUSES } from '#models/enrollment'
import { TEACHING_ROLES } from '#models/teaching_assignment'
import vine, { SimpleMessagesProvider } from '@vinejs/vine'
import type { MessagesProviderContact } from '@vinejs/vine/types'

/**
 * Mensagens em português para os validadores da gestão de turmas. O 422 continua no
 * formato do VineJS, com `errors[].field`, para o front mostrar o erro abaixo do campo.
 */
const messages = new SimpleMessagesProvider(
  {
    'required': 'Preencha o campo {{ field }}.',
    'string': 'O campo {{ field }} precisa ser um texto.',
    'email': 'Informe um e-mail válido.',
    'regex': 'O campo {{ field }} está em um formato inválido.',
    'minLength': 'O campo {{ field }} precisa ter pelo menos {{ min }} caracteres.',
    'maxLength': 'O campo {{ field }} pode ter no máximo {{ max }} caracteres.',
    'number': 'O campo {{ field }} precisa ser um número.',
    'number.in': 'Escolha um valor válido para {{ field }}.',
    'withoutDecimals': 'O campo {{ field }} precisa ser um número inteiro.',
    'min': 'O campo {{ field }} precisa ser pelo menos {{ min }}.',
    'max': 'O campo {{ field }} pode ser no máximo {{ max }}.',
    'range': 'O campo {{ field }} precisa estar entre {{ min }} e {{ max }}.',
    'enum': 'Escolha uma opção válida para {{ field }}.',
    'boolean': 'O campo {{ field }} precisa ser verdadeiro ou falso.',
    'array': 'O campo {{ field }} precisa ser uma lista.',
    'array.minLength': 'Informe pelo menos {{ min }} item em {{ field }}.',
    'array.maxLength': 'Informe no máximo {{ max }} itens em {{ field }}.',
    'object': 'O campo {{ field }} está em um formato inválido.',
    'unionOfTypes': 'O campo {{ field }} está em um formato inválido.',
    'rows.array.maxLength':
      'Envie no máximo {{ max }} linhas por importação. Divida o arquivo em partes menores.',
    'rows.array.minLength': 'O arquivo não tem nenhuma linha de nota.',
  },
  {
    name: 'nome',
    code: 'código',
    campus: 'campus',
    modality: 'modalidade',
    courseId: 'curso',
    year: 'ano',
    semester: 'semestre',
    shift: 'turno',
    period: 'período',
    workloadHours: 'carga horária',
    subjectId: 'disciplina',
    teacherId: 'docente',
    role: 'tipo de vínculo',
    userId: 'aluno',
    emails: 'e-mails',
    registration: 'matrícula',
    status: 'situação',
    enrollmentIds: 'matrículas',
    relationship: 'parentesco',
    email: 'e-mail',
    shareGrades: 'compartilhar notas',
    confirm: 'confirmar',
    reason: 'motivo',
    isMinor: 'menor de idade',
    academicEventId: 'avaliação',
    source: 'origem',
    fileName: 'nome do arquivo',
    checksum: 'identificação do arquivo',
    fileModifiedAt: 'data do arquivo',
    points: 'valor da avaliação',
    mapping: 'colunas',
    identifierType: 'tipo de identificação do aluno',
    identifierColumn: 'coluna do aluno',
    scoreColumn: 'coluna da nota',
    nameColumn: 'coluna do nome',
    rows: 'linhas',
    rowNumber: 'número da linha',
    identifier: 'e-mail ou matrícula',
    score: 'nota',
    keepAgendaWhenNewer: 'manter as notas da Agenda',
  }
)

export function withMessages<Validator extends { messagesProvider: MessagesProviderContact }>(
  validator: Validator
) {
  validator.messagesProvider = messages
  return validator
}

export const COURSE_MODALITIES = ['superior', 'integrado'] as const
export const CLASS_SHIFTS = ['matutino', 'vespertino', 'noturno', 'integral'] as const

/** Código de curso ou disciplina: 2 a 12 caracteres, A-Z, 0-9 e hífen. */
const code = () =>
  vine
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/)

const courseName = () => vine.string().trim().minLength(2).maxLength(80)
const className = () => vine.string().trim().minLength(2).maxLength(60)
const subjectName = () => vine.string().trim().minLength(2).maxLength(80)
const id = () => vine.number().withoutDecimals().min(1)
const registration = () => vine.string().trim().minLength(1).maxLength(30)
/** 0 (turma anual, só no curso integrado), 1 ou 2. Vazio ou null: o controller decide. */
const classSemester = () => vine.number().in([0, 1, 2]).nullable().optional()

export const createCourseValidator = withMessages(
  vine.create({
    name: courseName(),
    code: code(),
    modality: vine.enum(COURSE_MODALITIES).optional(),
    campus: vine.string().trim().minLength(2).maxLength(80).optional(),
  })
)

export const updateCourseValidator = withMessages(
  vine.create({
    name: courseName().optional(),
    code: code().optional(),
    modality: vine.enum(COURSE_MODALITIES).optional(),
    campus: vine.string().trim().minLength(2).maxLength(80).optional(),
  })
)

export const createClassValidator = withMessages(
  vine.create({
    courseId: id(),
    name: className(),
    year: vine.number().withoutDecimals().range([2000, 2100]),
    // A regra completa depende do curso e fica no controller: curso integrado grava 0 (turma
    // anual), os outros exigem 1 ou 2.
    semester: classSemester(),
    shift: vine.enum(CLASS_SHIFTS),
    period: vine.string().trim().minLength(1).maxLength(40),
  })
)

export const updateClassValidator = withMessages(
  vine.create({
    courseId: id().optional(),
    name: className().optional(),
    year: vine.number().withoutDecimals().range([2000, 2100]).optional(),
    semester: classSemester(),
    shift: vine.enum(CLASS_SHIFTS).optional(),
    period: vine.string().trim().minLength(1).maxLength(40).optional(),
  })
)

export const createSubjectValidator = withMessages(
  vine.create({
    code: code(),
    name: subjectName(),
    workloadHours: vine.number().withoutDecimals().range([1, 2000]).optional(),
  })
)

export const updateSubjectValidator = withMessages(
  vine.create({
    code: code().optional(),
    name: subjectName().optional(),
    workloadHours: vine.number().withoutDecimals().range([1, 2000]).optional(),
  })
)

export const offerSubjectValidator = withMessages(
  vine.create({
    subjectId: id(),
  })
)

export const assignTeacherValidator = withMessages(
  vine.create({
    teacherId: id(),
    role: vine.enum(TEACHING_ROLES).optional(),
  })
)

export const updateTeachingAssignmentValidator = withMessages(
  vine.create({
    role: vine.enum(TEACHING_ROLES),
  })
)

/** `{ userId }` para incluir uma conta, ou `{ emails[] }` com até 200 e-mails. */
export const addStudentsValidator = withMessages(
  vine.create({
    userId: id().optional().requiredIfMissing('emails'),
    registration: registration().optional(),
    // Cada e-mail é conferido um por um: o inválido volta em `rejected`, sem travar a lista.
    emails: vine
      .array(vine.string().trim().maxLength(254))
      .minLength(1)
      .maxLength(200)
      .optional()
      .requiredIfMissing('userId'),
  })
)

export const updateEnrollmentValidator = withMessages(
  vine.create({
    status: vine.enum(ENROLLMENT_STATUSES).optional(),
    registration: registration().nullable().optional(),
  })
)

export const decideEnrollmentsValidator = withMessages(
  vine.create({
    enrollmentIds: vine.array(id()).minLength(1).maxLength(200),
    status: vine.enum(['active', 'inactive'] as const),
  })
)

export const joinClassValidator = withMessages(
  vine.create({
    code: vine.string().trim().minLength(1).maxLength(20),
  })
)
