/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  auth: {
    newAccount: {
      store: typeof routes['auth.new_account.store']
    }
    accessTokens: {
      store: typeof routes['auth.access_tokens.store']
    }
  }
  profile: {
    profile: {
      show: typeof routes['profile.profile.show']
      update: typeof routes['profile.profile.update']
    }
    accessTokens: {
      destroy: typeof routes['profile.access_tokens.destroy']
    }
  }
  academicContext: {
    show: typeof routes['academic_context.show']
  }
  dashboard: {
    show: typeof routes['dashboard.show']
  }
  academicEvents: {
    index: typeof routes['academic_events.index']
    store: typeof routes['academic_events.store']
    show: typeof routes['academic_events.show']
    update: typeof routes['academic_events.update']
    destroy: typeof routes['academic_events.destroy']
  }
  reminders: {
    index: typeof routes['reminders.index']
    store: typeof routes['reminders.store']
    destroy: typeof routes['reminders.destroy']
  }
  calendarImports: {
    index: typeof routes['calendar_imports.index']
    store: typeof routes['calendar_imports.store']
  }
}
