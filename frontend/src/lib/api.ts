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

/** Erro de validação da API (VineJS): campo, regra e dados da regra (ex.: { min: 3 }). */
export type ApiFieldError = {
  field?: string;
  rule?: string;
  message: string;
  meta?: Record<string, unknown>;
};

export class ApiError extends Error {
  /** Situação HTTP; 0 quando o servidor não respondeu. */
  status: number;
  errors: ApiFieldError[];

  constructor(message: string, status: number, errors: ApiFieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

/** Falha de rede: o servidor não respondeu. */
export function isNetworkError(error: unknown) {
  return error instanceof ApiError && error.status === 0;
}

// Quem cuida da sessão vencida (o page.tsx registra ao montar).
let unauthorizedHandler: ((token: string) => void) | null = null;

/** Registra quem é avisado quando uma chamada autenticada volta 401. */
export function setUnauthorizedHandler(handler: ((token: string) => void) | null) {
  unauthorizedHandler = handler;
}

// Quem é avisado quando o servidor responde (a conexão voltou).
let reachableHandler: (() => void) | null = null;

/** Registra quem é avisado a cada resposta do servidor, de sucesso ou de erro (ex.: tirar o aviso "sem conexão"). */
export function setReachableHandler(handler: (() => void) | null) {
  reachableHandler = handler;
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
    throw new ApiError("Não foi possível conectar ao servidor. Confira sua conexão e tente de novo.", 0);
  }
  reachableHandler?.();

  if (!response.ok) {
    const fallback = { message: `Erro ${response.status}` };
    const payload = await response.json().catch(() => fallback);
    const errors: ApiFieldError[] = Array.isArray(payload?.errors) ? payload.errors : [];
    const message = payload?.message ?? errors[0]?.message ?? fallback.message;
    if (response.status === 401 && token) {
      unauthorizedHandler?.(token);
    }
    throw new ApiError(message, response.status, errors);
  }

  return (await response.json()) as T;
}

/**
 * Chama a raiz da API só para acordá-la: no plano grátis do Render o servidor
 * dorme sem acesso e leva até um minuto para voltar. A resposta não importa.
 */
export function wakeApi() {
  try {
    void fetch(new URL("/", API_URL), { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
  } catch {
    // API_URL relativa: a API está no mesmo servidor e não precisa ser acordada.
  }
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
  notificationChannel?: "email";
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
  channel?: "email";
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

export type CalendarImportResult = { import: CalendarImport; events: AcademicEvent[] };

/** Resultado de uma importação: a tela mostra o erro no próprio bloco, sem aviso solto. */
export type CalendarImportOutcome =
  | { ok: true; result: CalendarImportResult }
  | { ok: false; error: ApiError };

export async function importCalendar(token: string, input: CalendarImportInput) {
  const payload = await apiFetch<ApiEnvelope<CalendarImportResult>>("/calendar-imports", token, {
    method: "POST",
    body: input,
  });
  return payload.data;
}
