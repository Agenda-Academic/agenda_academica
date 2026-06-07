import type {
  AcademicContext,
  AcademicEvent,
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

export async function apiFetch<T>(path: string, token?: string, options: RequestOptions = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const fallback = { message: `Erro ${response.status}` };
    const payload = await response.json().catch(() => fallback);
    const message = payload?.message ?? payload?.errors?.[0]?.message ?? fallback.message;
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export async function login(email: string, password: string) {
  const payload = await apiFetch<ApiEnvelope<Session>>("/auth/login", undefined, {
    method: "POST",
    body: { email, password },
  });
  return payload.data;
}

export async function getProfile(token: string) {
  const payload = await apiFetch<ApiEnvelope<User>>("/account/profile", token);
  return payload.data;
}

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

export async function getReminders(token: string) {
  const payload = await apiFetch<ApiEnvelope<Reminder[]>>("/reminders", token);
  return payload.data;
}
