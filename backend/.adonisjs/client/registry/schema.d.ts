/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'auth.new_account.store': {
    methods: ["POST"]
    pattern: '/api/v1/auth/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.access_tokens.store': {
    methods: ["POST"]
    pattern: '/api/v1/auth/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.password_resets.request': {
    methods: ["POST"]
    pattern: '/api/v1/auth/forgot-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').forgotPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').forgotPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['request']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['request']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.password_resets.reset': {
    methods: ["POST"]
    pattern: '/api/v1/auth/reset-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').resetPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').resetPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['reset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_resets_controller').default['reset']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'auth.google_auth.redirect': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/auth/google/redirect'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['redirect']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['redirect']>>>
    }
  }
  'auth.google_auth.callback': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/auth/google/callback'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['callback']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['callback']>>>
    }
  }
  'auth.google_auth.exchange': {
    methods: ["POST"]
    pattern: '/api/v1/auth/google/exchange'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').googleExchangeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').googleExchangeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['exchange']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['exchange']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'profile.profile.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/account/profile'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['show']>>>
    }
  }
  'profile.profile.update': {
    methods: ["PUT"]
    pattern: '/api/v1/account/profile'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').updateProfileValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').updateProfileValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/profile_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'profile.access_tokens.destroy': {
    methods: ["POST"]
    pattern: '/api/v1/account/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_tokens_controller').default['destroy']>>>
    }
  }
  'academic_context.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/context'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/academic_context_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/academic_context_controller').default['show']>>>
    }
  }
  'dashboard.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/dashboard'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['show']>>>
    }
  }
  'academic_events.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/events'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['index']>>>
    }
  }
  'academic_events.store': {
    methods: ["POST"]
    pattern: '/api/v1/events'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/academic').createAcademicEventValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/academic').createAcademicEventValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'academic_events.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/events/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['show']>>>
    }
  }
  'academic_events.update': {
    methods: ["PUT"]
    pattern: '/api/v1/events/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/academic').updateAcademicEventValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/academic').updateAcademicEventValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'academic_events.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/events/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/academic_events_controller').default['destroy']>>>
    }
  }
  'reminders.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/reminders'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reminders_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reminders_controller').default['index']>>>
    }
  }
  'reminders.store': {
    methods: ["POST"]
    pattern: '/api/v1/reminders'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/academic').reminderValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/academic').reminderValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reminders_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reminders_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'reminders.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/reminders/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/reminders_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/reminders_controller').default['destroy']>>>
    }
  }
  'calendar_imports.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/calendar-imports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/calendar_imports_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/calendar_imports_controller').default['index']>>>
    }
  }
  'calendar_imports.store': {
    methods: ["POST"]
    pattern: '/api/v1/calendar-imports'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/academic').calendarImportValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/academic').calendarImportValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/calendar_imports_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/calendar_imports_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'calendar_imports.read_pdf': {
    methods: ["POST"]
    pattern: '/api/v1/calendar-imports/pdf'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/calendar_imports_controller').default['readPdf']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/calendar_imports_controller').default['readPdf']>>>
    }
  }
  'courses.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/courses'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['index']>>>
    }
  }
  'courses.store': {
    methods: ["POST"]
    pattern: '/api/v1/courses'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').createCourseValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/management').createCourseValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'courses.update': {
    methods: ["PUT"]
    pattern: '/api/v1/courses/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').updateCourseValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').updateCourseValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'courses.archive': {
    methods: ["POST"]
    pattern: '/api/v1/courses/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['archive']>>>
    }
  }
  'courses.restore': {
    methods: ["POST"]
    pattern: '/api/v1/courses/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['restore']>>>
    }
  }
  'courses.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/courses/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/courses_controller').default['destroy']>>>
    }
  }
  'classes.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/classes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['index']>>>
    }
  }
  'classes.store': {
    methods: ["POST"]
    pattern: '/api/v1/classes'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').createClassValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/management').createClassValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'classes.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/classes/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['show']>>>
    }
  }
  'classes.update': {
    methods: ["PUT"]
    pattern: '/api/v1/classes/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').updateClassValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').updateClassValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'classes.archive': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['archive']>>>
    }
  }
  'classes.restore': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['restore']>>>
    }
  }
  'classes.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/classes/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['destroy']>>>
    }
  }
  'classes.create_join_code': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/join-code'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['createJoinCode']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['createJoinCode']>>>
    }
  }
  'classes.disable_join_code': {
    methods: ["DELETE"]
    pattern: '/api/v1/classes/:id/join-code'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['disableJoinCode']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/classes_controller').default['disableJoinCode']>>>
    }
  }
  'class_subjects.store': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/subjects'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').offerSubjectValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').offerSubjectValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'class_subjects.archive': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/subjects/:subjectId/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; subjectId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['archive']>>>
    }
  }
  'class_subjects.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/classes/:id/subjects/:subjectId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; subjectId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['destroy']>>>
    }
  }
  'class_subjects.assign_teacher': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/subjects/:subjectId/teachers'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').assignTeacherValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; subjectId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').assignTeacherValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['assignTeacher']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['assignTeacher']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'class_subjects.update_assignment': {
    methods: ["PUT"]
    pattern: '/api/v1/teaching-assignments/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').updateTeachingAssignmentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').updateTeachingAssignmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['updateAssignment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['updateAssignment']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'class_subjects.end_assignment': {
    methods: ["DELETE"]
    pattern: '/api/v1/teaching-assignments/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['endAssignment']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_subjects_controller').default['endAssignment']>>>
    }
  }
  'class_members.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/classes/:id/students'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['index']>>>
    }
  }
  'class_members.store': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/students'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').addStudentsValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').addStudentsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'class_members.decide': {
    methods: ["POST"]
    pattern: '/api/v1/classes/:id/students/decide'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').decideEnrollmentsValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').decideEnrollmentsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['decide']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['decide']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'class_members.update': {
    methods: ["PATCH"]
    pattern: '/api/v1/enrollments/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').updateEnrollmentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').updateEnrollmentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'class_members.join': {
    methods: ["POST"]
    pattern: '/api/v1/enrollments/join'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').joinClassValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/management').joinClassValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['join']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['join']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'class_members.invites': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/classes/:id/invites'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['invites']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['invites']>>>
    }
  }
  'class_members.cancel_invite': {
    methods: ["DELETE"]
    pattern: '/api/v1/class-invites/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['cancelInvite']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/class_members_controller').default['cancelInvite']>>>
    }
  }
  'subjects.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/subjects'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['index']>>>
    }
  }
  'subjects.store': {
    methods: ["POST"]
    pattern: '/api/v1/subjects'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').createSubjectValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/management').createSubjectValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'subjects.update': {
    methods: ["PUT"]
    pattern: '/api/v1/subjects/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/management').updateSubjectValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/management').updateSubjectValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'subjects.archive': {
    methods: ["POST"]
    pattern: '/api/v1/subjects/:id/archive'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['archive']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['archive']>>>
    }
  }
  'subjects.restore': {
    methods: ["POST"]
    pattern: '/api/v1/subjects/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['restore']>>>
    }
  }
  'subjects.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/subjects/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/subjects_controller').default['destroy']>>>
    }
  }
  'users.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/users'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['index']>>>
    }
  }
  'guardian_links.claim': {
    methods: ["POST"]
    pattern: '/api/v1/guardian-links/claim'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/guardian').claimGuardianCodeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/guardian').claimGuardianCodeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['claim']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['claim']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'guardian_links.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/guardian-links'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['index']>>>
    }
  }
  'guardian_links.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/guardian-links/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/guardian').revokeGuardianLinkValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/guardian').revokeGuardianLinkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['destroy']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'guardian_links.restore': {
    methods: ["POST"]
    pattern: '/api/v1/guardian-links/:id/restore'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['restore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['restore']>>>
    }
  }
  'guardian_links.approve': {
    methods: ["POST"]
    pattern: '/api/v1/guardian-links/:id/approve'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['approve']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['approve']>>>
    }
  }
  'guardian_links.block': {
    methods: ["POST"]
    pattern: '/api/v1/guardian-links/:id/block'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/guardian').blockGuardianLinkValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/guardian').blockGuardianLinkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['block']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['block']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'guardian_links.my_guardians': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/me/guardians'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['myGuardians']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['myGuardians']>>>
    }
  }
  'guardian_links.update_mine': {
    methods: ["PATCH"]
    pattern: '/api/v1/me/guardians/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/guardian').updateMyGuardianValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/guardian').updateMyGuardianValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['updateMine']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['updateMine']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'guardian_links.create_my_code': {
    methods: ["POST"]
    pattern: '/api/v1/me/guardian-codes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['createMyCode']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['createMyCode']>>>
    }
  }
  'guardian_links.revoke_my_code': {
    methods: ["DELETE"]
    pattern: '/api/v1/me/guardian-codes/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['revokeMyCode']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['revokeMyCode']>>>
    }
  }
  'guardian_links.student_guardians': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/students/:id/guardians'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['studentGuardians']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['studentGuardians']>>>
    }
  }
  'guardian_links.link_by_email': {
    methods: ["POST"]
    pattern: '/api/v1/students/:id/guardians'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/guardian').linkGuardianByEmailValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/guardian').linkGuardianByEmailValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['linkByEmail']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['linkByEmail']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'guardian_links.create_student_code': {
    methods: ["POST"]
    pattern: '/api/v1/students/:id/guardian-codes'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['createStudentCode']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['createStudentCode']>>>
    }
  }
  'guardian_links.revoke_student_code': {
    methods: ["DELETE"]
    pattern: '/api/v1/students/:id/guardian-codes/:codeId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; codeId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['revokeStudentCode']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/guardian_links_controller').default['revokeStudentCode']>>>
    }
  }
  'users.update': {
    methods: ["PATCH"]
    pattern: '/api/v1/users/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/guardian').updateUserValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/guardian').updateUserValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/users_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/users_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'notifications.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/notifications'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['index']>>>
    }
  }
  'notifications.read_all': {
    methods: ["POST"]
    pattern: '/api/v1/notifications/read-all'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['readAll']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['readAll']>>>
    }
  }
  'notifications.read': {
    methods: ["POST"]
    pattern: '/api/v1/notifications/:id/read'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['read']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/notifications_controller').default['read']>>>
    }
  }
  'grade_imports.store': {
    methods: ["POST"]
    pattern: '/api/v1/grade-imports'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/grades').createGradeImportValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/grades').createGradeImportValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'grade_imports.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/grade-imports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['index']>>>
    }
  }
  'grade_imports.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/grade-imports/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['show']>>>
    }
  }
  'grade_imports.apply': {
    methods: ["POST"]
    pattern: '/api/v1/grade-imports/:id/apply'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/grades').applyGradeImportValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/grades').applyGradeImportValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['apply']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['apply']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'grade_imports.destroy': {
    methods: ["DELETE"]
    pattern: '/api/v1/grade-imports/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grade_imports_controller').default['destroy']>>>
    }
  }
  'grades.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/events/:id/grades'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['index']>>>
    }
  }
  'grades.publish': {
    methods: ["POST"]
    pattern: '/api/v1/events/:id/grades/publish'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['publish']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['publish']>>>
    }
  }
  'grades.unpublish': {
    methods: ["DELETE"]
    pattern: '/api/v1/events/:id/grades/publish'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['unpublish']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['unpublish']>>>
    }
  }
  'grades.update': {
    methods: ["PUT"]
    pattern: '/api/v1/events/:id/grades/:studentId'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/grades').updateGradeValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; studentId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/grades').updateGradeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'grades.mine': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/me/grades'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['mine']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['mine']>>>
    }
  }
  'grades.student': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/students/:id/grades'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['student']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/grades_controller').default['student']>>>
    }
  }
}
