import type {
  AcademicContext,
  AcademicEvent,
  CalendarImport,
  Dashboard,
  Reminder,
  Session,
  User,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333/api/v1";

type ApiEnvelope<T> = {
  data: T;
};

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, token?: string, options: RequestOptions = {}) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
  }

  if (!response.ok) {
    const fallback = { message: `Erro ${response.status}` };
    const payload = await response.json().catch(() => fallback);
    const message = payload?.message ?? payload?.errors?.[0]?.message ?? fallback.message;
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Autenticação e conta                                                */
/* ------------------------------------------------------------------ */

export async function login(email: string, password: string) {
  const payload = await apiFetch<ApiEnvelope<Session>>("/auth/login", undefined, {
    method: "POST",
    body: { email, password },
  });
  return payload.data;
}

export type SignupInput = {
  fullName: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  role?: "student" | "teacher";
  registration?: string | null;
};

export async function signup(input: SignupInput) {
  const payload = await apiFetch<ApiEnvelope<Session>>("/auth/signup", undefined, {
    method: "POST",
    body: input,
  });
  return payload.data;
}

export async function logout(token: string) {
  await apiFetch<{ message?: string }>("/account/logout", token, { method: "POST" });
}

export async function getProfile(token: string) {
  const payload = await apiFetch<ApiEnvelope<User>>("/account/profile", token);
  return payload.data;
}

export type ProfileInput = {
  fullName?: string | null;
  defaultReminderMinutes?: number;
  notificationChannel?: "email" | "push";
};

export async function updateProfile(token: string, input: ProfileInput) {
  const payload = await apiFetch<ApiEnvelope<User>>("/account/profile", token, {
    method: "PUT",
    body: input,
  });
  return payload.data;
}

/* ------------------------------------------------------------------ */
/* Dados acadêmicos                                                    */
/* ------------------------------------------------------------------ */

export async function getDashboard(token: string) {
  const payload = await apiFetch<ApiEnvelope<Dashboard>>("/dashboard", token);
  return payload.data;
}

export async function getContext(token: string) {
  const payload = await apiFetch<AcademicContext | ApiEnvelope<AcademicContext>>("/context", token);
  return "data" in payload ? payload.data : payload;
}

export async function getEvents(token: string) {
  const payload = await apiFetch<ApiEnvelope<AcademicEvent[]>>("/events", token);
  return payload.data;
}

export async function getEvent(token: string, id: number) {
  const payload = await apiFetch<ApiEnvelope<AcademicEvent>>(`/events/${id}`, token);
  return payload.data;
}

export type EventInput = {
  title: string;
  description: string | null;
  category: string;
  startsAt: string;
  endsAt: string | null;
  points: number | null;
  location: string | null;
  academicClassId: number | null;
  subjectId: number | null;
};

export async function createEvent(token: string, input: EventInput) {
  const payload = await apiFetch<ApiEnvelope<AcademicEvent>>("/events", token, {
    method: "POST",
    body: input,
  });
  return payload.data;
}

export async function updateEvent(
  token: string,
  id: number,
  input: Partial<EventInput> & { status?: string }
) {
  const payload = await apiFetch<ApiEnvelope<AcademicEvent>>(`/events/${id}`, token, {
    method: "PUT",
    body: input,
  });
  return payload.data;
}

export async function deleteEvent(token: string, id: number) {
  await apiFetch<{ message?: string }>(`/events/${id}`, token, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* Lembretes                                                           */
/* ------------------------------------------------------------------ */

export async function getReminders(token: string) {
  const payload = await apiFetch<ApiEnvelope<Reminder[]>>("/reminders", token);
  return payload.data;
}

export type ReminderInput = {
  academicEventId: number;
  channel?: "email" | "push";
  offsetMinutes?: number;
  enabled?: boolean;
};

export async function saveReminder(token: string, input: ReminderInput) {
  const payload = await apiFetch<ApiEnvelope<Reminder>>("/reminders", token, {
    method: "POST",
    body: input,
  });
  return payload.data;
}

export async function deleteReminder(token: string, id: number) {
  await apiFetch<{ message?: string }>(`/reminders/${id}`, token, { method: "DELETE" });
}

/* ------------------------------------------------------------------ */
/* Calendário oficial                                                  */
/* ------------------------------------------------------------------ */

export async function getCalendarImports(token: string) {
  const payload = await apiFetch<ApiEnvelope<CalendarImport[]>>("/calendar-imports", token);
  return payload.data;
}

export type CalendarImportEventInput = {
  title: string;
  description?: string | null;
  category: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  sourceExternalId?: string | null;
  color?: string | null;
};

export type CalendarImportInput = {
  sourceName: string;
  sourceUrl?: string | null;
  checksum?: string | null;
  events: CalendarImportEventInput[];
};

export async function importCalendar(token: string, input: CalendarImportInput) {
  const payload = await apiFetch<
    ApiEnvelope<{ import: CalendarImport; events: AcademicEvent[] }>
  >("/calendar-imports", token, {
    method: "POST",
    body: input,
  });
  return payload.data;
}
