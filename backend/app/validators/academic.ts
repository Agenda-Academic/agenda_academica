import vine from '@vinejs/vine'
import { withMessages } from '#validators/management'

export const academicEventCategory = vine.enum([
  'exam',
  'assignment',
  'activity',
  'extracurricular',
  'institutional',
  'holiday',
  'recess',
])

export const academicEventSource = vine.enum(['teacher', 'official', 'imported'])

/** Teto da pontuação de um evento: cabe na coluna decimal(5,2) do Postgres com folga. */
export const MAX_EVENT_POINTS = 100

/** Só pontos inteiros ou meio ponto, como no formulário (10 ou 2,5). */
const halfPoint = vine.createRule((value, _options, field) => {
  if (typeof value === 'number' && !Number.isInteger(value * 2)) {
    field.report('Use pontos inteiros ou meio ponto, como 10 ou 2,5.', 'halfPoint', field)
  }
})

const eventPoints = () =>
  vine.number().min(0).max(MAX_EVENT_POINTS).use(halfPoint()).nullable().optional()

export const createAcademicEventValidator = withMessages(
  vine.create({
    title: vine.string().minLength(3).maxLength(140),
    description: vine.string().maxLength(5000).nullable().optional(),
    category: academicEventCategory,
    source: academicEventSource.optional(),
    startsAt: vine.string(),
    endsAt: vine.string().nullable().optional(),
    points: eventPoints(),
    location: vine.string().maxLength(160).nullable().optional(),
    color: vine.string().maxLength(32).nullable().optional(),
    academicClassId: vine.number().nullable().optional(),
    subjectId: vine.number().nullable().optional(),
  })
)

export const updateAcademicEventValidator = withMessages(
  vine.create({
    title: vine.string().minLength(3).maxLength(140).optional(),
    description: vine.string().maxLength(5000).nullable().optional(),
    category: academicEventCategory.optional(),
    startsAt: vine.string().optional(),
    endsAt: vine.string().nullable().optional(),
    points: eventPoints(),
    location: vine.string().maxLength(160).nullable().optional(),
    color: vine.string().maxLength(32).nullable().optional(),
    academicClassId: vine.number().nullable().optional(),
    subjectId: vine.number().nullable().optional(),
    status: vine.enum(['scheduled', 'changed', 'cancelled', 'completed']).optional(),
  })
)

export const reminderValidator = vine.create({
  academicEventId: vine.number(),
  channel: vine.enum(['email']).optional(),
  offsetMinutes: vine.number().min(15).max(10080).optional(),
  enabled: vine.boolean().optional(),
})

export const calendarImportValidator = vine.create({
  sourceName: vine.string().minLength(3).maxLength(120),
  sourceUrl: vine.string().nullable().optional(),
  checksum: vine.string().nullable().optional(),
  events: vine.array(
    vine.object({
      title: vine.string().minLength(3).maxLength(140),
      description: vine.string().nullable().optional(),
      category: academicEventCategory,
      startsAt: vine.string(),
      endsAt: vine.string().nullable().optional(),
      location: vine.string().nullable().optional(),
      sourceExternalId: vine.string().nullable().optional(),
      color: vine.string().nullable().optional(),
    })
  ),
})
