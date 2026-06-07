import vine from '@vinejs/vine'

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

export const createAcademicEventValidator = vine.create({
  title: vine.string().minLength(3).maxLength(140),
  description: vine.string().nullable().optional(),
  category: academicEventCategory,
  source: academicEventSource.optional(),
  startsAt: vine.string(),
  endsAt: vine.string().nullable().optional(),
  points: vine.number().nullable().optional(),
  location: vine.string().nullable().optional(),
  color: vine.string().nullable().optional(),
  academicClassId: vine.number().nullable().optional(),
  subjectId: vine.number().nullable().optional(),
})

export const updateAcademicEventValidator = vine.create({
  title: vine.string().minLength(3).maxLength(140).optional(),
  description: vine.string().nullable().optional(),
  category: academicEventCategory.optional(),
  startsAt: vine.string().optional(),
  endsAt: vine.string().nullable().optional(),
  points: vine.number().nullable().optional(),
  location: vine.string().nullable().optional(),
  color: vine.string().nullable().optional(),
  academicClassId: vine.number().nullable().optional(),
  subjectId: vine.number().nullable().optional(),
  status: vine.enum(['scheduled', 'changed', 'cancelled', 'completed']).optional(),
})

export const reminderValidator = vine.create({
  academicEventId: vine.number(),
  channel: vine.enum(['email', 'push']).optional(),
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
