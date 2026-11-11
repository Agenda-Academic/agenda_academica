import type {
  AcademicContext,
  AcademicEvent,
  AddStudentsResult,
  AdminGuardianLink,
  ApiConflictCode,
  AppNotification,
  CalendarImport,
  ClaimLinkResult,
  ClassDetail,
  ClassInvite,
  ClassOffer,
  ClassShift,
  ClassStudent,
  ClassSummary,
  Course,
  CourseModality,
  Dashboard,
  DecideStudentsResult,
  EnrollmentStatus,
  EventGradeRow,
  EventGrades,
  GradeImport,
  GradeImportApplied,
  GradeImportInput,
  GradeImportUndone,
  GradeInput,
  GuardianCodeCreated,
  GuardianLink,
  GuardianLinkStatus,
  GuardianLinkSummary,
  GuardianRelationship,
  JoinClassResult,
  JoinCodeResult,
  MinorUpdateResult,
  MyGuardians,
  NotificationList,
  OfferArchiveResult,
  PublishGradesResult,
  Reminder,
  Session,
  StudentGrades,
  StudentGuardians,
  Subject,
  SubjectSaveResult,
  TeachingAssignment,
  TeachingRole,
  UnpublishGradesResult,
  User,
  UserRole,
  UserSummary,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333/api/v1";

type ApiEnvelope<T> = {
  data: T;
};

/**
 * Prazo de cada chamada. Passa com folga do minuto que o servidor em repouso leva para voltar (plano
 * grátis do Render); depois dele, a chamada é cancelada e vira ApiTimeoutError.
 */
export const REQUEST_TIMEOUT_MS = 90_000;

/** Opções de um pedido: método, corpo (vai em JSON), cancelamento (signal) e prazo. */
export type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Prazo desta chamada, em ms (padrão: REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
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
  /** Código do 409 ou do 429 ("HAS_DEPENDENTS", "LINK_LIMIT", "TOO_MANY_ATTEMPTS"...), quando a API manda. */
  code?: ApiConflictCode | string;
  /** Corpo inteiro da resposta de erro: os dados extras do caso (archivedId, counts, linkId, courseId, grades...). */
  data: Record<string, unknown>;
  /** 429: segundos até poder tentar de novo (o CORS não expõe o cabeçalho Retry-After; vale o do corpo). */
  retryAfter?: number;

  constructor(message: string, status: number, errors: ApiFieldError[] = [], data: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.data = data;
    this.code = typeof data.code === "string" ? data.code : undefined;
    this.retryAfter = typeof data.retryAfter === "number" ? data.retryAfter : undefined;
  }
}

/**
 * Detalhes de um 409 (conflito) ou 429 (muitas tentativas) com código: a mensagem da API (que é a que a
 * tela mostra, nunca o genérico "Isso já foi registrado antes.") e os dados extras de cada caso.
 */
export type ConflictDetails = {
  status: 409 | 429;
  code: ApiConflictCode | string;
  message: string;
  /** ARCHIVED_DUPLICATE: o id do arquivado, para o botão "Restaurar". */
  archivedId?: number;
  /** HAS_DEPENDENTS: o que impede (ex.: { enrollments: 1, events: 3 } ou { grades: 2 }). */
  counts?: Record<string, number>;
  /** COURSE_ARCHIVED: o curso arquivado da turma. */
  courseId?: number;
  /** BLOCKED (vincular por e-mail): o vínculo bloqueado. Para liberar, mande unblock: true depois de confirmar. */
  linkId?: number;
  /** EDITED_AFTER_IMPORT: as notas editadas depois da importação. */
  grades?: Array<{ studentId: number; fullName: string | null; gradeId: number }>;
  /** TOO_MANY_ATTEMPTS: segundos até poder tentar de novo. */
  retryAfter?: number;
  /** O corpo inteiro, para algum dado que não está acima. */
  data: Record<string, unknown>;
};

/** O erro é um 409 ou 429 com código? Devolve a mensagem e os dados; sem código (ou outro erro), null. */
export function conflictOf(error: unknown, code?: ApiConflictCode | string): ConflictDetails | null {
  if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 429) || !error.code) {
    return null;
  }
  if (code && error.code !== code) {
    return null;
  }
  const { data } = error;
  const num = (value: unknown) => (typeof value === "number" ? value : undefined);
  return {
    status: error.status,
    code: error.code,
    message: error.message,
    archivedId: num(data.archivedId),
    counts: data.counts && typeof data.counts === "object" ? (data.counts as Record<string, number>) : undefined,
    courseId: num(data.courseId),
    linkId: num(data.linkId),
    grades: Array.isArray(data.grades) ? (data.grades as ConflictDetails["grades"]) : undefined,
    retryAfter: error.retryAfter,
    data,
  };
}

/** O servidor não respondeu no prazo (conexão presa): a chamada foi cancelada, mas o pedido pode ter chegado. */
export class ApiTimeoutError extends ApiError {
  constructor() {
    super("O servidor não respondeu a tempo. Tente de novo.", 0);
    this.name = "ApiTimeoutError";
  }
}

/** Falha de rede: o servidor não respondeu (sem conexão ou sem resposta no prazo). */
export function isNetworkError(error: unknown) {
  return error instanceof ApiError && error.status === 0;
}

/** Sem resposta no prazo: antes de repetir um envio, vale conferir se o primeiro entrou. */
export function isTimeoutError(error: unknown): error is ApiTimeoutError {
  return error instanceof ApiTimeoutError;
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
  const { body, headers, signal, timeoutMs = REQUEST_TIMEOUT_MS, ...init } = options;
  // uma conexão presa não deixa a tela esperando para sempre: no prazo, a chamada é cancelada
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // quem chamou também pode cancelar
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiTimeoutError();
      }
      if (signal?.aborted) {
        throw error;
      }
      throw new ApiError("Não foi possível conectar ao servidor. Confira sua conexão e tente de novo.", 0);
    }
    reachableHandler?.();

    if (!response.ok) {
      const fallback = { message: `Erro ${response.status}` };
      const raw: unknown = await response.json().catch(() => fallback);
      const payload: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : fallback;
      const errors: ApiFieldError[] = Array.isArray(payload.errors) ? (payload.errors as ApiFieldError[]) : [];
      const message = (typeof payload.message === "string" ? payload.message : null) ?? errors[0]?.message ?? fallback.message;
      if (response.status === 401 && token) {
        unauthorizedHandler?.(token);
      }
      throw new ApiError(message, response.status, errors, payload);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      // a resposta começou a chegar e parou: o prazo acabou no meio dela
      if (timedOut) {
        throw new ApiTimeoutError();
      }
      throw error;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
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
/* Pedido genérico                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pedido autenticado a qualquer rota da API, com o corpo inteiro da resposta. Serve para uma rota que ainda
 * não tem função aqui. Os erros saem como ApiError (422 com errors[], 409 e 429 com code e data).
 * Ex.: `await request<{ data: Course[] }>(token, "/courses?archived=1")`.
 */
export function request<T>(token: string, path: string, options: RequestOptions = {}) {
  return apiFetch<T>(path, token, options);
}

/** Como request, mas devolve só o `data` da resposta (o formato da maioria das rotas). */
export async function requestData<T>(token: string, path: string, options: RequestOptions = {}) {
  const payload = await apiFetch<ApiEnvelope<T>>(path, token, options);
  return payload.data;
}

/** Resposta com o dado e a frase pronta da API (ex.: "Notas publicadas. Avisamos 2 alunos e 1 responsável."). */
export type WithMessage<T> = { data: T; message: string };

/** Resposta só com a frase (exclusões). */
export type MessageOnly = { message: string };

/** "?a=1&b=x", sem os vazios. */
function query(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) {
      continue;
    }
    search.set(key, value === true ? "1" : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
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
  /** O responsável ("guardian") não manda matrícula (registration preenchida dá 422). */
  role?: Exclude<UserRole, "admin">;
  registration?: string | null;
};

export async function signup(input: SignupInput) {
  const payload = await apiFetch<ApiEnvelope<Session>>("/auth/signup", undefined, {
    method: "POST",
    body: input,
  });
  return payload.data;
}

/** Endereço que leva ao Google: a API guarda o state e redireciona para a escolha da conta. */
export function googleLoginUrl() {
  return `${API_URL}/auth/google/redirect`;
}

/** Troca o código de uso único da volta do Google (?google=) pela sessão, igual ao login. */
export async function exchangeGoogleCode(code: string) {
  const payload = await apiFetch<ApiEnvelope<Session>>("/auth/google/exchange", undefined, {
    method: "POST",
    body: { code },
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

/**
 * Painel. O responsável passa o aluno (obrigatório se acompanha mais de um: sem ele, 422 no campo studentId;
 * aluno sem vínculo ativo: 404 "Aluno não encontrado.").
 */
export async function getDashboard(token: string, studentId?: number | null) {
  const payload = await apiFetch<ApiEnvelope<Dashboard>>(`/dashboard${query({ studentId })}`, token);
  return payload.data;
}

/** Contexto da pessoa. Para o responsável, traz linkedStudents e o catálogo só das turmas dos alunos dele. */
export async function getContext(token: string) {
  const payload = await apiFetch<AcademicContext | ApiEnvelope<AcademicContext>>("/context", token);
  return "data" in payload ? payload.data : payload;
}

/** Eventos visíveis. O responsável passa o aluno (mesma regra do getDashboard). */
export async function getEvents(token: string, studentId?: number | null) {
  const payload = await apiFetch<ApiEnvelope<AcademicEvent[]>>(`/events${query({ studentId })}`, token);
  return payload.data;
}

/** Um evento. Responsável: studentId opcional; fora do alcance dele, 404. */
export async function getEvent(token: string, id: number, studentId?: number | null) {
  const payload = await apiFetch<ApiEnvelope<AcademicEvent>>(`/events/${id}${query({ studentId })}`, token);
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

/* ================================================================== */
/* Fase 1: cursos, turmas, disciplinas, ofertas e alunos da turma      */
/* ================================================================== */

/* Cursos (só administração) ---------------------------------------- */

export type CourseInput = {
  name: string;
  /** 2 a 12 caracteres (A-Z, 0-9 e hífen); minúsculas viram maiúsculas. */
  code: string;
  modality?: CourseModality;
  campus?: string;
};

/** Sem archived vêm só os não arquivados; com archived, só os arquivados. */
export function getCourses(token: string, filters: { archived?: boolean } = {}) {
  return requestData<Course[]>(token, `/courses${query(filters)}`);
}

/** 201 com o curso. Código repetido: 422 no campo code, ou 409 ARCHIVED_DUPLICATE (archivedId) se o outro está arquivado. */
export function createCourse(token: string, input: CourseInput) {
  return requestData<Course>(token, "/courses", { method: "POST", body: input });
}

/** Curso arquivado: 409 ARCHIVED. */
export function updateCourse(token: string, id: number, input: Partial<CourseInput>) {
  return requestData<Course>(token, `/courses/${id}`, { method: "PUT", body: input });
}

/** Com turma não arquivada: 409 HAS_DEPENDENTS (counts.activeClasses). Idempotente. */
export function archiveCourse(token: string, id: number) {
  return requestData<Course>(token, `/courses/${id}/archive`, { method: "POST" });
}

export function restoreCourse(token: string, id: number) {
  return requestData<Course>(token, `/courses/${id}/restore`, { method: "POST" });
}

/** Só curso sem turma; senão 409 HAS_DEPENDENTS (counts.classes). */
export function deleteCourse(token: string, id: number) {
  return request<MessageOnly>(token, `/courses/${id}`, { method: "DELETE" });
}

/* Turmas ------------------------------------------------------------ */

export type ClassFilters = {
  courseId?: number;
  year?: number;
  /** 1 ou 2 trazem também as turmas anuais (do mesmo ano, com year); 0 traz só as anuais. */
  semester?: number;
  archived?: boolean;
  /** Busca no nome. */
  q?: string;
};

export type ClassInput = {
  courseId: number;
  name: string;
  year: number;
  /**
   * 1 ou 2 no curso superior (obrigatório). No curso integrado a turma é anual: mande null (ou 0) e esconda
   * o campo; 1 ou 2 ali dá 422 no campo semester.
   */
  semester?: number | null;
  shift: ClassShift;
  period: string;
};

/** Administração: todas; docente: só as com vínculo em vigor. Lista resumida, com counts e sem o código. */
export function getClasses(token: string, filters: ClassFilters = {}) {
  return requestData<ClassSummary[]>(token, `/classes${query(filters)}`);
}

/** Painel completo (ofertas, docentes, contagens e o código). Docente sem vínculo na turma: 404. */
export function getClass(token: string, id: number) {
  return requestData<ClassDetail>(token, `/classes/${id}`);
}

/** 201 com o painel. Turma repetida: 422 no campo name, ou 409 ARCHIVED_DUPLICATE (archivedId). */
export function createClass(token: string, input: ClassInput) {
  return requestData<ClassDetail>(token, "/classes", { method: "POST", body: input });
}

/** Turma arquivada: 409 ARCHIVED. */
export function updateClass(token: string, id: number, input: Partial<ClassInput>) {
  return requestData<ClassDetail>(token, `/classes/${id}`, { method: "PUT", body: input });
}

/** Desliga o código; futureEvents diz quantos eventos ainda vão acontecer (sem lembretes). Idempotente. */
export function archiveClass(token: string, id: number) {
  return requestData<ClassDetail>(token, `/classes/${id}/archive`, { method: "POST" });
}

/** O código continua desligado. Curso arquivado: 409 COURSE_ARCHIVED (courseId). */
export function restoreClass(token: string, id: number) {
  return requestData<ClassDetail>(token, `/classes/${id}/restore`, { method: "POST" });
}

/** Só turma vazia; senão 409 HAS_DEPENDENTS (counts: enrollments, invites, events, offers, teachingAssignments). */
export function deleteClass(token: string, id: number) {
  return request<MessageOnly>(token, `/classes/${id}`, { method: "DELETE" });
}

/** Gera um código novo (o antigo para de valer) e liga. Administração e docente da turma. Arquivada: 409 ARCHIVED. */
export function createJoinCode(token: string, classId: number) {
  return requestData<JoinCodeResult>(token, `/classes/${classId}/join-code`, { method: "POST" });
}

/** Desliga o código da turma. */
export function disableJoinCode(token: string, classId: number) {
  return requestData<JoinCodeResult>(token, `/classes/${classId}/join-code`, { method: "DELETE" });
}

/* Disciplinas -------------------------------------------------------- */

export type SubjectInput = {
  /** Como o do curso, único. */
  code: string;
  name: string;
  /** 1 a 2000 (padrão 80). */
  workloadHours?: number;
};

/** Administração: todas, com usedIn; docente: só as dela, sem usedIn. */
export function getSubjects(token: string, filters: { archived?: boolean; q?: string } = {}) {
  return requestData<Subject[]>(token, `/subjects${query(filters)}`);
}

/** 201 { data, warnings[] }: nome repetido não bloqueia, volta em warnings. Código repetido: 422 ou 409 ARCHIVED_DUPLICATE. */
export function createSubject(token: string, input: SubjectInput) {
  return request<SubjectSaveResult>(token, "/subjects", { method: "POST", body: input });
}

/** { data (com usedIn), warnings[] }. Arquivada: 409 ARCHIVED. */
export function updateSubject(token: string, id: number, input: Partial<SubjectInput>) {
  return request<SubjectSaveResult>(token, `/subjects/${id}`, { method: "PUT", body: input });
}

/** 200 com usedIn. Idempotente. */
export function archiveSubject(token: string, id: number) {
  return requestData<Subject>(token, `/subjects/${id}/archive`, { method: "POST" });
}

export function restoreSubject(token: string, id: number) {
  return requestData<Subject>(token, `/subjects/${id}/restore`, { method: "POST" });
}

/** Com oferta, evento ou vínculo de docente: 409 HAS_DEPENDENTS. */
export function deleteSubject(token: string, id: number) {
  return request<MessageOnly>(token, `/subjects/${id}`, { method: "DELETE" });
}

/* Ofertas e docentes (só administração) ------------------------------ */

/** 201 com a oferta; se existia arquivada, volta (restored: true). Já ofertada ou disciplina arquivada: 422 em subjectId. */
export function addClassSubject(token: string, classId: number, subjectId: number) {
  return requestData<ClassOffer>(token, `/classes/${classId}/subjects`, { method: "POST", body: { subjectId } });
}

/** Encerra os vínculos de docente em vigor na oferta (endedAssignments). */
export function archiveClassSubject(token: string, classId: number, subjectId: number) {
  return requestData<OfferArchiveResult>(token, `/classes/${classId}/subjects/${subjectId}/archive`, { method: "POST" });
}

/** Com evento ou docente (mesmo encerrado): 409 HAS_DEPENDENTS. */
export function deleteClassSubject(token: string, classId: number, subjectId: number) {
  return request<MessageOnly>(token, `/classes/${classId}/subjects/${subjectId}`, { method: "DELETE" });
}

/**
 * Vincula a docente à oferta (201; um vínculo encerrado volta, 200). Sem oferta: 404. Oferta arquivada:
 * 409 OFFER_ARCHIVED. Conta que não é de docente ou já vinculada: 422 em teacherId.
 */
export function assignTeacher(
  token: string,
  classId: number,
  subjectId: number,
  input: { teacherId: number; role?: TeachingRole }
) {
  return requestData<TeachingAssignment>(token, `/classes/${classId}/subjects/${subjectId}/teachers`, {
    method: "POST",
    body: input,
  });
}

/** Troca titular ou substituto. Vínculo encerrado: 409 ENDED. */
export function updateTeachingAssignment(token: string, id: number, role: TeachingRole) {
  return requestData<TeachingAssignment>(token, `/teaching-assignments/${id}`, { method: "PUT", body: { role } });
}

/** Encerra o vínculo (endedAt preenchido; a linha e a autoria dos eventos ficam). */
export function endTeachingAssignment(token: string, id: number) {
  return requestData<TeachingAssignment>(token, `/teaching-assignments/${id}`, { method: "DELETE" });
}

/* Busca de pessoas (só administração) -------------------------------- */

/** Até 20 resultados, só com id, fullName, email e role. q busca no nome ou no e-mail. */
export function searchUsers(token: string, filters: { role?: UserRole; q?: string } = {}) {
  return requestData<UserSummary[]>(token, `/users${query(filters)}`);
}

/**
 * Marca ou desmarca o aluno como menor de idade. Devolve quantos vínculos o aluno precisa conferir
 * (linksToReview) e quantos voltaram a pendente (linksToApprove). Conta que não é de aluno: 422 em isMinor.
 */
export function updateUserMinor(token: string, userId: number, isMinor: boolean) {
  return requestData<MinorUpdateResult>(token, `/users/${userId}`, { method: "PATCH", body: { isMinor } });
}

/* Alunos na turma ----------------------------------------------------- */

/** Pendentes primeiro, depois por nome. Administração e docente da turma (registration e isMinor só para a administração). */
export function getClassStudents(token: string, classId: number, status?: EnrollmentStatus) {
  return requestData<ClassStudent[]>(token, `/classes/${classId}/students${query({ status })}`);
}

/** Inclui um aluno que já tem conta. Conta que não é de aluno ou já ativo: 422 em userId; matrícula repetida: 422 em registration. */
export function addClassStudent(token: string, classId: number, input: { userId: number; registration?: string | null }) {
  return requestData<AddStudentsResult>(token, `/classes/${classId}/students`, { method: "POST", body: input });
}

/**
 * Cola a lista de e-mails (1 a 200): quem tem conta de aluno entra ativo, quem não tem vira convite.
 * Resultado para a frase "12 incluídos, 3 convidados, 1 com e-mail inválido".
 */
export function addClassStudentsByEmail(token: string, classId: number, emails: string[]) {
  return requestData<AddStudentsResult>(token, `/classes/${classId}/students`, { method: "POST", body: { emails } });
}

/**
 * Muda a matrícula. Administração: qualquer status e a matrícula escolar. Docente da turma: só de pendente
 * para ativa ou inativa (o resto é 403). Remover o aluno é { status: "inactive" } (nada é apagado).
 */
export function updateEnrollment(
  token: string,
  enrollmentId: number,
  input: { status?: EnrollmentStatus; registration?: string | null }
) {
  return requestData<ClassStudent>(token, `/enrollments/${enrollmentId}`, { method: "PATCH", body: input });
}

/** Aprova ou recusa pedidos em lote. Os que não estavam pendentes voltam em skipped. */
export function decideEnrollments(token: string, classId: number, enrollmentIds: number[], status: "active" | "inactive") {
  return requestData<DecideStudentsResult>(token, `/classes/${classId}/students/decide`, {
    method: "POST",
    body: { enrollmentIds, status },
  });
}

/** Convites ainda não aceitos (só administração). */
export function getClassInvites(token: string, classId: number) {
  return requestData<ClassInvite[]>(token, `/classes/${classId}/invites`);
}

/** Cancela o convite. Já aceito: 409 ALREADY_ACCEPTED. */
export function cancelClassInvite(token: string, inviteId: number) {
  return request<MessageOnly>(token, `/class-invites/${inviteId}`, { method: "DELETE" });
}

/**
 * O aluno entra com o código da turma. Código ruim (qualquer motivo): 422 em code, sempre a mesma frase.
 * Muitas tentativas erradas: 429 TOO_MANY_ATTEMPTS com retryAfter (segundos).
 */
export function joinClass(token: string, code: string) {
  return requestData<JoinClassResult>(token, "/enrollments/join", { method: "POST", body: { code } });
}

/* ================================================================== */
/* Fase 2: responsável                                                 */
/* ================================================================== */

/**
 * O responsável usa o código do aluno ou da secretaria. Código ruim: 422 em code (sempre a mesma frase);
 * 4 vínculos: 409 LINK_LIMIT; muitas tentativas: 429 TOO_MANY_ATTEMPTS (retryAfter).
 */
export function claimGuardianLink(token: string, code: string, relationship: GuardianRelationship) {
  return requestData<ClaimLinkResult>(token, "/guardian-links/claim", { method: "POST", body: { code, relationship } });
}

/** Aluno: quem acompanha a agenda dele e os códigos válidos (só com o prazo). */
export function getMyGuardians(token: string) {
  return requestData<MyGuardians>(token, "/me/guardians");
}

/** Aluno gera um código (aparece uma vez só). 3 válidos: 409 CODE_LIMIT; 4 vínculos: 409 LINK_LIMIT. */
export function createMyGuardianCode(token: string) {
  return requestData<GuardianCodeCreated>(token, "/me/guardian-codes", { method: "POST" });
}

/** Aluno cancela um código. Já usado: 409 CODE_USED; menor e código da secretaria: 403 (com a frase da API). */
export function cancelMyGuardianCode(token: string, codeId: number) {
  return request<WithMessage<{ id: number; revokedAt: string | null }>>(token, `/me/guardian-codes/${codeId}`, {
    method: "DELETE",
  });
}

/** Aluno adulto liga ou desliga "Compartilhar minhas notas", ou confirma o vínculo depois de deixar de ser menor. */
export function updateMyGuardianLink(token: string, linkId: number, input: { shareGrades?: boolean; confirm?: boolean }) {
  return requestData<GuardianLink>(token, `/me/guardians/${linkId}`, { method: "PATCH", body: input });
}

/**
 * Desfaz o vínculo (fica "revoked"; o Desfazer do toast vale 10 minutos, até undoUntil). Responsável, aluno
 * adulto, aluno menor (só vínculo de código dele) e administração. A frase pronta vem em message.
 */
export function revokeGuardianLink(token: string, linkId: number, reason?: string) {
  return requestData<GuardianLinkSummary>(token, `/guardian-links/${linkId}`, {
    method: "DELETE",
    body: reason ? { reason } : undefined,
  });
}

/** O Desfazer do toast: só quem desfez, em até 10 minutos. Depois: 409 UNDO_EXPIRED; 4 vínculos: 409 LINK_LIMIT. */
export function restoreGuardianLink(token: string, linkId: number) {
  return requestData<GuardianLinkSummary>(token, `/guardian-links/${linkId}/restore`, { method: "POST" });
}

/** Administração: vínculos por status (padrão pending), cada um com o aluno. É a fonte do card "Pendências". */
export function getGuardianLinks(token: string, status: GuardianLinkStatus = "pending") {
  return requestData<AdminGuardianLink[]>(token, `/guardian-links${query({ status })}`);
}

/** Administração: todos os vínculos e códigos válidos do aluno. Conta que não é de aluno: 404. */
export function getStudentGuardians(token: string, studentId: number) {
  return requestData<StudentGuardians>(token, `/students/${studentId}/guardians`);
}

/**
 * Administração vincula por e-mail uma conta de responsável que já existe (vínculo ativo, origin "admin").
 * E-mail sem conta de responsável ou já ativo: 422 em email; 4 vínculos: 409 LINK_LIMIT. Responsável
 * bloqueado: 409 BLOCKED com linkId; só depois de confirmar na tela, mande de novo com unblock: true.
 */
export function linkGuardianByEmail(
  token: string,
  studentId: number,
  input: { email: string; relationship: GuardianRelationship; unblock?: boolean }
) {
  return requestData<AdminGuardianLink>(token, `/students/${studentId}/guardians`, { method: "POST", body: input });
}

/** Administração gera o código de 30 dias (para imprimir). 3 válidos: 409 CODE_LIMIT. */
export function createStudentGuardianCode(token: string, studentId: number) {
  return requestData<GuardianCodeCreated>(token, `/students/${studentId}/guardian-codes`, { method: "POST" });
}

/** Administração cancela qualquer código válido do aluno. Já usado: 409 CODE_USED. */
export function cancelStudentGuardianCode(token: string, studentId: number, codeId: number) {
  return request<WithMessage<{ id: number; revokedAt: string | null }>>(
    token,
    `/students/${studentId}/guardian-codes/${codeId}`,
    { method: "DELETE" }
  );
}

/** Administração aprova o pedido (de pendente para ativo). Desfeito ou bloqueado: 409 NOT_PENDING. */
export function approveGuardianLink(token: string, linkId: number) {
  return requestData<GuardianLinkSummary>(token, `/guardian-links/${linkId}/approve`, { method: "POST" });
}

/** Administração bloqueia o vínculo, com motivo (3 a 200 caracteres). Nenhum código passa por cima do bloqueio. */
export function blockGuardianLink(token: string, linkId: number, reason: string) {
  return requestData<GuardianLinkSummary>(token, `/guardian-links/${linkId}/block`, { method: "POST", body: { reason } });
}

/* Avisos do sistema (todos os papéis, só os próprios) ----------------- */

/** Os 50 avisos mais novos (com unread, só os não lidos) e unreadCount, o número do item do menu. */
export function getNotifications(token: string, filters: { unread?: boolean } = {}) {
  return requestData<NotificationList>(token, `/notifications${query(filters)}`);
}

/** Marca um aviso como lido (devolve o aviso com readAt). */
export function readNotification(token: string, id: number) {
  return requestData<AppNotification>(token, `/notifications/${id}/read`, { method: "POST" });
}

/** Marca todos como lidos. */
export function readAllNotifications(token: string) {
  return requestData<{ updated: number }>(token, "/notifications/read-all", { method: "POST" });
}

/* ================================================================== */
/* Fase 3: notas                                                       */
/* ================================================================== */

/**
 * Cria o rascunho da importação (o front lê o arquivo e manda só as linhas, até 2.000). 201 com totais,
 * breakdown e as linhas da prévia. Evento sem valor e sem points: 422 em points. Turma arquivada: 409 ARCHIVED.
 */
export function createGradeImport(token: string, input: GradeImportInput) {
  return requestData<GradeImport>(token, "/grade-imports", { method: "POST", body: input });
}

/** Importações da avaliação, das mais novas para as antigas, sem as linhas. */
export function getGradeImports(token: string, eventId: number) {
  return requestData<GradeImport[]>(token, `/grade-imports${query({ eventId })}`);
}

/** Uma importação; se for rascunho, com as linhas. */
export function getGradeImport(token: string, id: number) {
  return requestData<GradeImport>(token, `/grade-imports/${id}`);
}

/**
 * Aplica o rascunho. keepAgendaWhenNewer (padrão true) mantém a nota mudada na Agenda depois do arquivo.
 * message: "20 notas importadas. Ficam ocultas até você publicar." Já aplicada: 409 NOT_DRAFT.
 */
export function applyGradeImport(token: string, id: number, keepAgendaWhenNewer?: boolean) {
  return request<WithMessage<GradeImportApplied>>(token, `/grade-imports/${id}/apply`, {
    method: "POST",
    body: keepAgendaWhenNewer === undefined ? {} : { keepAgendaWhenNewer },
  });
}

/**
 * Rascunho: descarta (nenhuma nota muda). Aplicada: desfaz, voltando cada nota ao valor anterior. Nota editada
 * depois: 409 EDITED_AFTER_IMPORT com grades[] (nada muda). Aplicada no mesmo instante: 409 NOT_DRAFT.
 */
export function deleteGradeImport(token: string, id: number) {
  return request<WithMessage<GradeImportUndone>>(token, `/grade-imports/${id}`, { method: "DELETE" });
}

/** Notas da avaliação: todos os alunos ativos, com e sem nota. Docente de outra disciplina: 403 com a frase da API. */
export function getEventGrades(token: string, eventId: number) {
  return requestData<EventGrades>(token, `/events/${eventId}/grades`);
}

/**
 * Lança, muda ou apaga a nota de um aluno. score em centésimos (0 até maxScore; 750 é 7,5), null apaga;
 * status "absent" ou "excused" vai sem score. 422 em score com a frase da API ("A nota precisa estar entre 0 e 10.").
 */
export function saveGrade(token: string, eventId: number, studentId: number, input: GradeInput) {
  return request<{ data: EventGradeRow; message?: string }>(token, `/events/${eventId}/grades/${studentId}`, {
    method: "PUT",
    body: input,
  });
}

/** Publica (avisa alunos e responsáveis). message pronta. Sem nota: 409 NO_GRADES. */
export function publishGrades(token: string, eventId: number) {
  return request<WithMessage<PublishGradesResult>>(token, `/events/${eventId}/grades/publish`, { method: "POST" });
}

/** Oculta de novo (apaga os avisos ainda não lidos). É o Desfazer do publicar. */
export function unpublishGrades(token: string, eventId: number) {
  return request<WithMessage<UnpublishGradesResult>>(token, `/events/${eventId}/grades/publish`, { method: "DELETE" });
}

/** Aluno: as próprias notas publicadas, por turma e disciplina. */
export function getMyGrades(token: string) {
  return requestData<StudentGrades>(token, "/me/grades");
}

/**
 * Responsável com vínculo ativo (ou administração): notas publicadas do aluno. Adulto que não compartilha:
 * shareGrades false, counts null e subjects vazio. Sem vínculo ativo: 404 "Aluno não encontrado.".
 */
export function getStudentGrades(token: string, studentId: number) {
  return requestData<StudentGrades>(token, `/students/${studentId}/grades`);
}
