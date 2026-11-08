"use client";

import { GraduationCap, WifiOff } from "lucide-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  AppActionsProvider,
  type AppActions,
  type BackLayers,
  type ClassesTarget,
  type NavigateParams,
  type ToastOptions as AreaToastOptions,
} from "@/components/app-actions";
import { AppShell, type SearchScope, type View } from "@/components/app-shell";
import { CalendarView, type CalendarMode } from "@/components/calendar-view";
import { ClassesView } from "@/components/classes-view";
import { AdminDashboard } from "@/components/dashboard-admin";
import { AvisosCard } from "@/components/dashboard-bits";
import { GuardianDashboard } from "@/components/dashboard-guardian";
import { StudentDashboard } from "@/components/dashboard-student";
import { TeacherDashboard } from "@/components/dashboard-teacher";
import { EventGradesDrawer } from "@/components/event-grades-drawer";
import {
  EventEditor,
  createInitialEventForm,
  eventToForm,
  type EventFieldErrors,
  type EventFormState,
  type EventStatusChange,
  type StatusNotice,
} from "@/components/event-editor";
import { GradesView } from "@/components/grades-view";
import { GuardianLinkCard } from "@/components/guardian-link-card";
import { LoginScreen } from "@/components/login-screen";
import { ManageView } from "@/components/manage-view";
import { ProfileModal, type ProfileFormState } from "@/components/profile-modal";
import { RemindersView } from "@/components/reminders-view";
import { SyncView } from "@/components/sync-view";
import {
  ConfirmDialog,
  ErrorState,
  PageSkeleton,
  RetryButton,
  Spinner,
  ToastStack,
  type ConfirmState,
  type ToastItem,
  type ToastTone,
} from "@/components/ui";
import {
  ApiError,
  createEvent,
  deleteEvent,
  deleteReminder,
  getCalendarImports,
  getContext,
  getEvents,
  getNotifications,
  getReminders,
  importCalendar,
  isNetworkError,
  isTimeoutError,
  logout,
  readAllNotifications,
  readNotification,
  saveReminder,
  setReachableHandler,
  setUnauthorizedHandler,
  updateEvent,
  updateProfile,
  type CalendarImportInput,
  type CalendarImportOutcome,
  type EventInput,
} from "@/lib/api";
import {
  addDays,
  errorMessage,
  fieldErrors,
  firstName,
  formatTime,
  localDateKey,
  matchesSearch,
  startOfDay,
} from "@/lib/format";
import { allCategories, isGradable, knownRoles } from "@/lib/meta";
import type {
  AcademicContext,
  AcademicEvent,
  AppNotification,
  CalendarImport,
  Category,
  LinkedStudent,
  NotificationList,
  Reminder,
  Session,
  User,
  UserRole,
} from "@/lib/types";

const SESSION_KEY = "agenda-academica-session";
// tela e rascunho de cada pessoa, guardados quando a sessão vence ou a página recarrega no meio da edição
const resumeKey = (userId: number) => `agenda:retomar:${userId}`;
// quem estava na sessão que venceu: a tela de entrada já vem com o e-mail dessa conta
const EXPIRED_KEY = "agenda:sessao-vencida";
// busca, categorias e modo do Cronograma: voltam como estavam depois de um F5
const FILTERS_KEY = "agenda:filtros";
const dismissedKey = (userId: number) => `agenda:avisos-dispensados:${userId}`;
const EXPIRED_NOTICE = "Sua sessão expirou. Entre de novo para continuar de onde parou.";
const EVENT_GONE = "Esse evento não existe mais. Ele pode ter sido removido.";

// endereço de cada tela (?tela=...)
const viewSlugs: Record<View, string> = {
  dashboard: "painel",
  calendar: "cronograma",
  grades: "notas",
  manage: "gestao",
  classes: "turmas",
  reminders: "lembretes",
  sync: "importar",
};

// quem vê cada tela (desenho, tabela 5.2); o responsável vê Painel, Cronograma (só leitura), Notas e Lembretes
const viewRoles: Record<View, UserRole[]> = {
  dashboard: ["student", "teacher", "admin", "guardian"],
  calendar: ["student", "teacher", "admin", "guardian"],
  grades: ["student", "teacher", "admin", "guardian"],
  manage: ["teacher", "admin"],
  classes: ["admin"],
  reminders: ["student", "teacher", "admin", "guardian"],
  sync: ["admin"],
};

/** Quem cria, edita e conclui evento: só a docente e a administração (o aluno e o responsável só leem). */
function writesEvents(role: UserRole | undefined) {
  return role === "teacher" || role === "admin";
}

// a busca do menu na tela Turmas e disciplinas procura turmas, disciplinas e alunos (nas outras, eventos)
const classesSearch: SearchScope = {
  placeholder: "Buscar turma ou aluno",
  label: "Buscar turma, disciplina ou aluno",
  noun: ["resultado", "resultados"],
};

// antecedências aceitas pela API (15 minutos a 7 dias)
const reminderSteps = [15, 30, 60, 180, 360, 720, 1440, 2880, 4320, 10080];

const statusNames: Record<AcademicEvent["status"], string> = {
  scheduled: "Agendado",
  changed: "Alterado",
  cancelled: "Cancelado",
  completed: "Concluído",
};

const eventFormKeys: Array<keyof EventFormState> = [
  "title",
  "description",
  "category",
  "startsAt",
  "endsAt",
  "points",
  "location",
  "academicClassId",
  "subjectId",
];

/** Como o detalhe do Cronograma foi aberto: diz o que fechar faz. */
type DetailOrigin = "outside" | "here" | "switched";

/**
 * Camada leve por cima da tela, com entrada própria no histórico: o Voltar fecha só ela. "painel" é o painel
 * lateral de uma área (useBackLayer) ou a gaveta de notas.
 */
type HistoryLayer = "menu" | "perfil" | "confirmar" | "painel";

/**
 * Onde estava o botão ou a linha que abriu o detalhe: o card (pelo nome dele) e a ordem entre os que abrem o
 * mesmo evento nesse card. Um evento pode aparecer em vários lugares da tela (destaque, avisos, lista, semana).
 */
type OpenerSpot = { region: string; nth: number };

/** O que cada entrada do histórico guarda. */
type HistoryEntry = {
  key: string;
  view: View;
  eventId: number | null;
  detail?: DetailOrigin;
  editar?: number | "novo";
  scrollY?: number;
  /** Camada aberta nesta entrada (o endereço é o mesmo da tela de baixo). */
  layer?: HistoryLayer;
  /** Quem estava na sessão (0 sem sessão): entradas de outra conta não servem de Voltar. */
  uid?: number;
  /** Posição no histórico da aba: diz se a entrada veio pelo Voltar ou pelo Avançar. */
  pos?: number;
  /** Evento cujo detalhe foi aberto desta tela: na volta, o foco vai para quem abriu (data-opens-event). */
  opener?: number;
  /** Qual dos botões ou linhas desse evento abriu o detalhe. */
  openerSpot?: OpenerSpot;
  /** Responsável: o aluno acompanhado (&aluno=). Vale para todas as telas dele. */
  aluno?: number;
  /** Turmas e disciplinas: a turma a abrir (&turma=). Sai do endereço depois que a tela abre o painel. */
  turma?: number;
  /** Turmas e disciplinas: o aluno da turma a abrir (&membro=, id da conta). */
  membro?: number;
  /** Notas: a avaliação a destacar (&evento=). */
  gradeEventId?: number;
};

type ResumeEditor = {
  editingEventId: number | null;
  editingEvent: AcademicEvent | null;
  form: EventFormState;
  snapshot: EventFormState;
};

type ResumeState = {
  userId: number;
  email: string;
  view: View;
  eventId: number | null;
  editor: ResumeEditor | null;
};

/** O que falta fazer quando a primeira carga depois de entrar (ou do F5) der certo. */
type PendingBoot = {
  token: string;
  entryKey: string;
  eventId: number | null;
  scrollY?: number;
  editar?: number | "novo";
  resume: ResumeState | null;
};

/** Volta no histórico pedida por nós: `run` roda no popstate; com `process`, a entrada que vier é mostrada. */
type PendingPop = { run: () => void; process?: boolean };

/** Publicação nova que ficou sem resposta no prazo: pode ter entrado. A próxima carga (ou o próximo Publicar) confere. */
type UnsureCreate = {
  token: string;
  body: EventInput;
  form: EventFormState;
  /** Eventos que já estavam na tela antes do envio: o criado é um que não estava. */
  known: Set<number>;
  /** Entrada de edição do painel de onde saiu o envio. */
  editorKey: string | null;
  /** Só valem as cargas pedidas depois do prazo estourado. */
  afterSeq: number;
};

type ToastOptions = {
  action?: { label: string; onClick: () => void };
  duration?: number;
  /** Assuntos do aviso ("evento-5", "lembrete-5"): um aviso novo do mesmo assunto tira o antigo, com o Desfazer dele. */
  keys?: string[];
  /** Falha de conexão: some quando o servidor volta a responder. */
  offline?: boolean;
};
type PageToast = ToastItem & { keys?: string[]; offline?: boolean };
type CalendarFilter = { categories?: Category[] };
type LoadFailure = { message: string; offline: boolean };
type LoadedData = { events: AcademicEvent[]; context: AcademicContext };
type LoadResult = ({ ok: true } & LoadedData) | { ok: false; error: unknown };
type StoredFilters = { userId: number; search: string; categories: Category[]; mode: CalendarMode };

/* ------------------------------------------------------------------ */
/* Histórico e endereço                                                */
/* ------------------------------------------------------------------ */

let entrySeq = 0;
// última entrada mostrada: vale quando o Next troca o estado da entrada atual (ex.: Voltar depois de um F5)
let shownEntry: HistoryEntry | null = null;
// quem está na sessão (0 sem sessão): cada entrada gravada leva o dono
let entryOwner = 0;
// responsável: o aluno escolhido (0 sem aluno, e sempre 0 nos outros papéis): cada entrada nova leva &aluno=
let entryStudent = 0;

/** Estado da entrada com a parte do Next (__NA e a árvore do roteador dele, que ele copia a cada pushState). */
type RouterHistoryState = { __NA?: boolean; __PRIVATE_NEXTJS_INTERNALS_TREE?: unknown; [key: string]: unknown };

// árvore do roteador do Next neste documento, a que ele tem em cache (entradas de antes de um F5 trazem a do outro)
let routerTree: unknown = null;
// mudanças de endereço feitas por nós: cada uma já chega ao Next pelo pushState/replaceState dele
let urlWrites = 0;
// posição da última entrada empilhada neste documento: depois dela não há entrada (desconhecida depois de um F5)
let lastPushedPos: number | null = null;
// último clique (ou Enter e espaço num botão) na página: diz quem abriu o detalhe quando o botão não ganha o foco
// no clique (Safari)
let lastPress: { target: Element; at: number } | null = null;

function historyState() {
  return (window.history.state as RouterHistoryState | null) ?? null;
}

/** Guarda a árvore do Next da entrada atual: fora de um Voltar, é a que o roteador tem. */
function rememberRouterTree() {
  const tree = historyState()?.__PRIVATE_NEXTJS_INTERNALS_TREE;
  if (tree) {
    routerTree = tree;
  }
}

function sameTree(a: unknown, b: unknown) {
  if (a === b) {
    return true;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Voltar ou Avançar até uma entrada nossa de antes de um F5: ela traz a árvore do Next do documento antigo, que este
 * não tem em cache. O Next buscaria a tela no servidor e, com qualquer outra mudança de endereço no meio (a entrada
 * que o Voltar devolve, a confirmação de descartar), recarregaria a página inteira, levando o rascunho e o envio.
 * A entrada passa a ter a árvore deste documento e o popstate não chega ao Next; o endereço chega pelo replaceState.
 */
function claimOldEntry(event: PopStateEvent) {
  const state = event.state as RouterHistoryState | null;
  const tree = state?.__PRIVATE_NEXTJS_INTERNALS_TREE;
  if (!state?.__NA || !tree || !routerTree || !readEntry(state) || sameTree(tree, routerTree)) {
    return false;
  }
  event.stopImmediatePropagation();
  // com o __NA no estado, o replaceState do Next só repassa: não vira navegação
  window.history.replaceState({ ...state, __PRIVATE_NEXTJS_INTERNALS_TREE: routerTree }, "");
  return true;
}

/** O Next não viu o Voltar: o endereço de agora chega a ele como as nossas mudanças, com a árvore que ele já tem. */
function tellRouter() {
  const before = historyState();
  const data: RouterHistoryState = { ...before };
  delete data.__NA;
  delete data.__PRIVATE_NEXTJS_INTERNALS_TREE;
  const url = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.history.replaceState(data, "", url);
  if (before?.__NA && !historyState()?.__NA) {
    // sem o Next por perto: a parte dele volta como estava
    window.history.replaceState(before, "", url);
  }
}

function newEntryKey() {
  entrySeq += 1;
  return `${Date.now().toString(36)}-${entrySeq}`;
}

function setEntryOwner(userId: number) {
  entryOwner = userId;
}

/** Responsável: o aluno que as entradas novas do histórico levam (&aluno=); 0 sem aluno. */
function setEntryStudent(studentId: number) {
  entryStudent = studentId;
}

function isView(value: unknown): value is View {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(viewSlugs, value);
}

function canSee(view: View, role: UserRole) {
  return viewRoles[view].includes(role);
}

/** Número inteiro positivo de um parâmetro do endereço (ou undefined). */
function idParam(params: URLSearchParams, name: string) {
  const value = Number(params.get(name));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Lê ?tela=, &evento=, &turma=, &membro= e &aluno= do endereço, aceitando só telas do perfil. O &aluno= só vale
 * para o responsável; &turma= e &membro=, só em Turmas e disciplinas; &evento=, no Cronograma e em Notas.
 */
function entryFromSearch(search: string, role: UserRole): Omit<HistoryEntry, "key"> {
  const params = new URLSearchParams(search);
  const slug = params.get("tela");
  const found = (Object.keys(viewSlugs) as View[]).find((view) => viewSlugs[view] === slug);
  const view = found && canSee(found, role) ? found : "dashboard";
  const eventParam = idParam(params, "evento");
  return {
    view,
    eventId: view === "calendar" ? (eventParam ?? null) : null,
    gradeEventId: view === "grades" ? eventParam : undefined,
    turma: view === "classes" ? idParam(params, "turma") : undefined,
    membro: view === "classes" ? idParam(params, "membro") : undefined,
    aluno: role === "guardian" ? idParam(params, "aluno") : undefined,
  };
}

function entryUrl(entry: HistoryEntry) {
  const params = new URLSearchParams({ tela: viewSlugs[entry.view] });
  if (entry.view === "calendar" && entry.eventId) {
    params.set("evento", String(entry.eventId));
  }
  if (entry.view === "grades" && entry.gradeEventId) {
    params.set("evento", String(entry.gradeEventId));
  }
  if (entry.view === "classes" && entry.turma) {
    params.set("turma", String(entry.turma));
  }
  if (entry.view === "classes" && entry.membro) {
    params.set("membro", String(entry.membro));
  }
  if (entry.aluno) {
    params.set("aluno", String(entry.aluno));
  }
  if (entry.editar !== undefined) {
    params.set("editar", String(entry.editar));
  }
  return `${window.location.pathname}?${params.toString()}`;
}

function readEntry(state: unknown): HistoryEntry | null {
  const entry = (state as { agenda?: HistoryEntry } | null)?.agenda;
  return entry && typeof entry.key === "string" && isView(entry.view) ? entry : null;
}

/** A entrada atual: a do history.state ou, se o Next trocou o estado dela, a última mostrada (mesmo endereço). */
function currentEntry(): HistoryEntry | null {
  const stored = readEntry(window.history.state);
  if (stored) {
    return stored;
  }
  const here = `${window.location.pathname}${window.location.search}`;
  return shownEntry && entryUrl(shownEntry) === here ? shownEntry : null;
}

/** Grava a entrada, com dono e posição; o Next copia as chaves internas dele (e, antes de montar, copiamos nós). */
function writeHistory(mode: "push" | "replace", entry: HistoryEntry): HistoryEntry {
  rememberRouterTree();
  urlWrites += 1;
  const base = currentEntry();
  const full: HistoryEntry = {
    ...entry,
    // responsável: a entrada nova leva o aluno escolhido (a que já tem um aluno fica com ele)
    aluno: entry.aluno ?? (entryStudent || undefined),
    // dono desconhecido (ex.: módulo recarregado no desenvolvimento): fica o da própria entrada, sem marcar outra conta
    uid: entryOwner || entry.uid,
    pos: mode === "push" ? (base?.pos ?? 0) + 1 : (entry.pos ?? base?.pos ?? 0),
  };
  const before = window.history.state;
  const data = { agenda: full };
  const url = entryUrl(full);
  if (mode === "push") {
    window.history.pushState(data, "", url);
    // empilhar descarta as entradas que estavam à frente
    lastPushedPos = full.pos ?? null;
  } else {
    window.history.replaceState(data, "", url);
  }
  if (before?.__NA && !window.history.state?.__NA) {
    window.history.replaceState({ ...before, ...data }, "", url);
  }
  shownEntry = full;
  return full;
}

/** Muda a entrada atual sem trocar o endereço (ex.: guardar a rolagem); refaz a nossa parte se o Next a apagou. */
function patchCurrentEntry(changes: Partial<HistoryEntry>) {
  rememberRouterTree();
  const current = currentEntry();
  if (current) {
    const next = { ...current, ...changes };
    window.history.replaceState({ ...window.history.state, agenda: next }, "");
    shownEntry = next;
  }
}

/** Passa a mostrar a entrada que o Voltar ou o Avançar trouxe; grava de volta a nossa parte se ela veio sem. */
function adoptEntry(entry: HistoryEntry, rewrite: boolean) {
  shownEntry = entry;
  if (rewrite) {
    window.history.replaceState({ ...window.history.state, agenda: entry }, "");
  }
}

/** Sem sessão: a entrada vira a tela de entrada ("/"), sem dono, e não serve de Voltar para quem entrar depois. */
function markSignedOut() {
  entryOwner = 0;
  entryStudent = 0;
  const entry: HistoryEntry = { key: newEntryKey(), view: "dashboard", eventId: null, uid: 0, pos: currentEntry()?.pos };
  urlWrites += 1;
  window.history.replaceState({ agenda: entry }, "", "/");
  shownEntry = null;
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

/** Valor guardado, ainda sem tipo: quem lê confere a forma (um valor estranho não derruba a página). */
function readStorage(kind: "local" | "session", key: string): unknown {
  try {
    const raw = (kind === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// papéis que o front conhece: sem o "guardian" aqui, a sessão do responsável era descartada no F5
const userRoles: UserRole[] = knownRoles;

function readSession(): Session | null {
  const value = readStorage("local", SESSION_KEY);
  if (!isRecord(value) || typeof value.token !== "string" || !value.token || !isRecord(value.user)) {
    return null;
  }
  const { id, email, role, defaultReminderMinutes } = value.user;
  const valid =
    typeof id === "number" &&
    typeof email === "string" &&
    userRoles.includes(role as UserRole) &&
    typeof defaultReminderMinutes === "number";
  return valid ? (value as unknown as Session) : null;
}

function isEventForm(value: unknown): value is EventFormState {
  return (
    isRecord(value) &&
    eventFormKeys.every((key) => typeof value[key] === "string") &&
    allCategories.includes(value.category as Category)
  );
}

function positiveId(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Rascunho e tela guardados da pessoa; fora do formato, é descartado. */
function readResume(userId: number): ResumeState | null {
  const value = readStorage("session", resumeKey(userId));
  if (!isRecord(value) || value.userId !== userId || !isView(value.view)) {
    return null;
  }
  let editor: ResumeEditor | null = null;
  const raw = value.editor;
  if (isRecord(raw) && isEventForm(raw.form) && isEventForm(raw.snapshot)) {
    const event = raw.editingEvent;
    editor = {
      editingEventId: positiveId(raw.editingEventId),
      editingEvent:
        isRecord(event) && positiveId(event.id) !== null && typeof event.title === "string" && typeof event.startsAt === "string"
          ? (event as unknown as AcademicEvent)
          : null,
      form: raw.form,
      snapshot: raw.snapshot,
    };
  }
  return {
    userId,
    email: typeof value.email === "string" ? value.email : "",
    view: value.view,
    eventId: positiveId(value.eventId),
    editor,
  };
}

function readExpired(): { userId: number; email: string } | null {
  const value = readStorage("session", EXPIRED_KEY);
  return isRecord(value) && typeof value.userId === "number" && typeof value.email === "string"
    ? { userId: value.userId, email: value.email }
    : null;
}

function readDismissed(userId: number) {
  const value = readStorage("local", dismissedKey(userId));
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readFilters(userId: number): Omit<StoredFilters, "userId"> | null {
  const value = readStorage("session", FILTERS_KEY);
  if (!isRecord(value) || value.userId !== userId) {
    return null;
  }
  const picked = Array.isArray(value.categories)
    ? allCategories.filter((category) => (value.categories as unknown[]).includes(category))
    : [];
  return {
    search: typeof value.search === "string" ? value.search.slice(0, 120) : "",
    categories: picked.length ? picked : allCategories,
    mode: value.mode === "month" ? "month" : "list",
  };
}

function writeStorage(kind: "local" | "session", key: string, value: unknown) {
  try {
    const target = kind === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) {
      target.removeItem(key);
    } else {
      target.setItem(key, JSON.stringify(value));
    }
  } catch {
    // navegador sem armazenamento: segue sem guardar
  }
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function byStart(a: AcademicEvent, b: AcademicEvent) {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

/** Troca o evento pelo id (ou acrescenta): a resposta do PUT ou do POST entra na tela antes da recarga. */
function upsertEvent(list: AcademicEvent[], event: AcademicEvent) {
  return [...list.filter((item) => item.id !== event.id), event].sort(byStart);
}

/** Um lembrete por evento: troca o do mesmo evento (ou acrescenta), na ordem do aviso. */
function upsertReminder(list: Reminder[], reminder: Reminder) {
  return [
    ...list.filter((item) => item.id !== reminder.id && item.academicEventId !== reminder.academicEventId),
    reminder,
  ].sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime());
}

const weekdayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Quando o aviso aparece, numa frase: "no domingo, 08/11, às 19:00", "na quarta, 04/11, às 19:00". */
function avisoWhen(value: string) {
  const date = new Date(value);
  const weekday = date.getDay();
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${weekday === 0 || weekday === 6 ? "no" : "na"} ${weekdayNames[weekday]}, ${day}/${month}, às ${time}`;
}

/**
 * Fim dos textos de lembrete: ": aviso na quarta, 04/11, às 19:00". Evento cancelado ou concluído não tem aviso (o
 * lembrete fica guardado, mas não avisa), e o texto não promete um.
 */
function avisoTail(event: Pick<AcademicEvent, "status"> | null | undefined, sendAt: string) {
  return event?.status === "cancelled" || event?.status === "completed" ? "" : `: aviso ${avisoWhen(sendAt)}`;
}

/** Resultado curto de uma mudança de situação, mostrado no próprio painel lateral. */
function statusShort(status: AcademicEvent["status"]) {
  if (status === "completed") return "Evento concluído.";
  if (status === "cancelled") return "Evento cancelado.";
  return "Evento reativado.";
}

/** Quem pode editar o evento: a administração, ou o docente dono ou com vínculo na turma e disciplina. */
function canManage(event: AcademicEvent, user: User | null, context: AcademicContext | null) {
  if (!user) {
    return false;
  }
  if (user.role === "admin") {
    return true;
  }
  if (user.role !== "teacher" || event.source !== "teacher") {
    return false;
  }
  if (event.teacherId === user.id) {
    return true;
  }
  if (!event.academicClassId) {
    return false;
  }
  return (context?.teachingAssignments ?? []).some(
    (assignment) =>
      assignment.academicClassId === event.academicClassId &&
      (!event.subjectId || assignment.subjectId === event.subjectId)
  );
}

/** Responsável: o aluno com vínculo ativo pedido (endereço ou seletor) ou, sem ele, o primeiro ativo. */
function pickStudent(context: AcademicContext | null, wanted: number | null): LinkedStudent | null {
  const active = (context?.linkedStudents ?? []).filter((item) => item.status === "active");
  return active.find((item) => item.id === wanted) ?? active[0] ?? null;
}

/** Endereço de um aviso do sistema ("?tela=notas&aluno=4&evento=1") em tela e parâmetros. "perfil" não é tela. */
function noticeTarget(link: string): { view: View | "perfil"; params: NavigateParams } | null {
  const search = link.includes("?") ? link.slice(link.indexOf("?")) : link;
  const params = new URLSearchParams(search);
  const slug = params.get("tela");
  if (!slug) {
    return null;
  }
  const view = slug === "perfil" ? "perfil" : (Object.keys(viewSlugs) as View[]).find((item) => viewSlugs[item] === slug);
  if (!view) {
    return null;
  }
  return {
    view,
    params: {
      eventId: idParam(params, "evento") ?? null,
      classId: idParam(params, "turma") ?? null,
      memberId: idParam(params, "membro") ?? null,
      studentId: idParam(params, "aluno") ?? null,
    },
  };
}

function sameForm(a: EventFormState, b: EventFormState) {
  return eventFormKeys.every((key) => String(a[key]).trim() === String(b[key]).trim());
}

function sameMinute(a: string | null, b: string | null) {
  const minute = (value: string | null) => (value ? Math.floor(new Date(value).getTime() / 60000) : null);
  return minute(a) === minute(b);
}

/** Texto de uma falha: o prazo estourado tem a frase dele (o errorMessage também já cuida disso). */
function failText(err: unknown) {
  return isTimeoutError(err) ? err.message : errorMessage(err);
}

/** Sem conexão de verdade: o aviso sai quando o servidor volta a responder. O prazo estourado não conta (o envio pode não ter entrado). */
function offlineError(err: unknown) {
  return isNetworkError(err) && !isTimeoutError(err);
}

/** Quem publicou o evento é quem está na sessão (sem o createdById, vale o dono para o docente e o oficial para a administração). */
function publishedBy(event: AcademicEvent, user: User) {
  if (typeof event.createdById === "number") {
    return event.createdById === user.id;
  }
  return user.role === "teacher" ? event.teacherId === user.id : event.source !== "teacher";
}

/** O evento que a publicação sem resposta criou: novo na lista, com o mesmo título e início, publicado por quem está na sessão. */
function findCreated(list: AcademicEvent[], unsure: UnsureCreate, user: User) {
  return (
    list.find(
      (event) =>
        !unsure.known.has(event.id) &&
        event.title.trim() === unsure.body.title &&
        sameMinute(event.startsAt, unsure.body.startsAt) &&
        publishedBy(event, user)
    ) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Foco                                                                */
/* ------------------------------------------------------------------ */

/** O foco caiu no body: o elemento que o tinha saiu da tela. */
function focusLost() {
  const active = document.activeElement;
  return !active || active === document.body;
}

function focusScreenHeading() {
  document.querySelector<HTMLElement>("#conteudo h1[tabindex]")?.focus({ preventScroll: true });
}

/**
 * Um evento saiu da tela (apagado por outra pessoa ou excluído) e o que tinha o foco pode ter saído junto (o
 * detalhe, o destaque, o botão de lembrete): se o foco cair no body, vai para o conteúdo da tela. Quem leva o
 * foco a um lugar certo (a linha vizinha, o título do detalhe) pode fazer isso antes ou depois; aqui só se recolhe
 * o que caiu. Por 1,5 s, a conferência roda a cada mudança na página, logo depois dela e antes da pintura (o foco
 * não chega a ficar no body), e também a cada 150 ms (o que some sem sair da página, escondido ou desativado).
 */
function keepFocusInContent() {
  const rescue = () => {
    if (focusLost()) {
      document.getElementById("conteudo")?.focus({ preventScroll: true });
    }
  };
  const watcher = typeof MutationObserver === "undefined" ? null : new MutationObserver(rescue);
  watcher?.observe(document.body, { childList: true, subtree: true });
  let tries = 0;
  const check = () => {
    rescue();
    tries += 1;
    if (tries < 10) {
      window.setTimeout(check, 150);
    } else {
      watcher?.disconnect();
    }
  };
  window.setTimeout(check, 150);
}

/** Cards onde ficam os botões e as linhas que abrem o detalhe (destaque, avisos, listas, semana, indicadores). */
const OPENER_REGIONS = "section, aside, .card";
const OPENER_REGIONS_IN_MAIN = "main section, main aside, main .card";

/**
 * Nome do card do elemento: o aria-label, o título ligado por aria-labelledby ou o primeiro título, sem as contagens
 * ("Avisos (2)" e "Avisos (1)" são o mesmo card). Card sem nome fica com a posição dele na tela.
 */
function regionKey(element: HTMLElement) {
  const region = element.parentElement?.closest<HTMLElement>(OPENER_REGIONS) ?? null;
  if (!region) {
    return "";
  }
  const labelledBy = region.getAttribute("aria-labelledby");
  const name =
    region.getAttribute("aria-label") ||
    (labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      : "") ||
    region.querySelector("h2, h3, .kpi-label")?.textContent ||
    "";
  const plain = name.replace(/\(\d+\)/g, "").replace(/\s+/g, " ").trim();
  return plain || `#${Array.from(document.querySelectorAll(OPENER_REGIONS_IN_MAIN)).indexOf(region)}`;
}

/** Botões e linhas que abrem o detalhe do evento (data-opens-event), na ordem da tela, sem os escondidos e os inertes. */
function openerCandidates(eventId: number) {
  return Array.from(document.querySelectorAll<HTMLElement>(`main [data-opens-event="${eventId}"]`)).filter(
    (element) => !element.closest("[inert], [hidden], [aria-hidden='true']") && element.getClientRects().length > 0
  );
}

function inView(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
}

/** O mesmo botão ou linha de antes: no mesmo card e na mesma ordem (ou o último do card, se ele mostra menos agora). */
function spotTarget(candidates: HTMLElement[], spot: OpenerSpot) {
  const same = candidates.filter((element) => regionKey(element) === spot.region);
  return same.length ? same[Math.min(spot.nth, same.length - 1)] : null;
}

/** Quem acabou de abrir o detalhe do evento: o do clique que está acontecendo ou, sem ele, o que tem o foco. */
function usedOpener(eventId: number) {
  const selector = `[data-opens-event="${eventId}"]`;
  const pressed = lastPress && performance.now() - lastPress.at < 1000 ? lastPress.target : null;
  for (const node of [pressed, document.activeElement]) {
    const element = node instanceof Element ? node.closest<HTMLElement>(selector) : null;
    if (element?.closest("main")) {
      return element;
    }
  }
  return null;
}

/** Onde está quem abriu o detalhe do evento agora, para a entrada da tela guardar. */
function openerSpotFor(eventId: number): OpenerSpot | undefined {
  const element = usedOpener(eventId);
  if (!element) {
    return undefined;
  }
  const region = regionKey(element);
  const nth = openerCandidates(eventId)
    .filter((item) => regionKey(item) === region)
    .indexOf(element);
  return nth >= 0 ? { region, nth } : undefined;
}

/** A posição guardada numa entrada (que pode vir de antes de um F5): só vale no formato certo. */
function readSpot(value: unknown): OpenerSpot | undefined {
  if (!isRecord(value) || typeof value.region !== "string") {
    return undefined;
  }
  const nth = value.nth;
  return typeof nth === "number" && Number.isInteger(nth) && nth >= 0 ? { region: value.region, nth } : undefined;
}

/**
 * Foca quem abriu o detalhe: o mesmo botão ou linha de antes (spot), trazido para a vista se a tela mudou; sem ele, o
 * primeiro à vista que abre o mesmo evento (com `sameOnly`, só o mesmo). Devolve o focado e se ele é o de antes.
 */
function focusOpener(eventId: number, spot?: OpenerSpot, sameOnly = false) {
  const candidates = openerCandidates(eventId);
  const same = spot ? spotTarget(candidates, spot) : null;
  if (same) {
    if (!inView(same)) {
      same.scrollIntoView({ block: "nearest" });
    }
    same.focus({ preventScroll: true });
    if (document.activeElement === same) {
      return { element: same, exact: true };
    }
  }
  if (sameOnly) {
    return null;
  }
  for (const element of candidates) {
    if (element !== same && inView(element)) {
      element.focus({ preventScroll: true });
      if (document.activeElement === element) {
        return { element, exact: false };
      }
    }
  }
  return null;
}

/**
 * De volta à tela que abriu o detalhe: quando ela se acomoda (as listas que se ajustam ao espaço mudam de tamanho logo
 * depois de montar), a rolagem guardada volta (se a tela ainda estava curta para ela) e o foco vai para quem abriu;
 * sem ele, para o título da tela. Se a linha for refeita logo em seguida, o foco passa para a nova; se quem abriu só
 * aparecer um pouco depois (lista que ganha itens para caber) e ninguém mexeu no foco, ele vai para lá.
 */
function focusOpenerSoon(eventId: number, y: number, spot?: OpenerSpot) {
  let placed: Element | null = null;
  let exact = false;
  const place = (sameOnly: boolean) => {
    const found = focusOpener(eventId, spot, sameOnly);
    if (found) {
      placed = found.element;
      exact = found.exact;
    }
    return found !== null;
  };
  const toHeading = () => {
    focusScreenHeading();
    placed = document.activeElement;
  };
  const settle = () => {
    if (window.scrollY + 1 < y) {
      window.scrollTo({ top: y, behavior: "instant" });
    }
    if (!place(false)) {
      toHeading();
    }
    let checks = 0;
    const hold = () => {
      if (focusLost()) {
        if (!place(false)) {
          toHeading();
        }
      } else if (spot && !exact && document.activeElement === placed) {
        place(true);
      }
      checks += 1;
      if (checks < 5) {
        window.setTimeout(hold, 120);
      }
    };
    window.setTimeout(hold, 120);
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(settle));
}

/** Aviso de lembrete identificado pelo horário: mudar a antecedência faz o aviso voltar. */
function avisoKey(reminder: Reminder) {
  return `${reminder.id}@${reminder.sendAt}`;
}

/** Maior antecedência válida até a preferida (o aviso precisa cair no futuro). */
function bestReminderOffset(startsAt: string, preferred: number, now: number) {
  const start = new Date(startsAt).getTime();
  const valid = [...new Set([...reminderSteps, preferred])]
    .filter((minutes) => minutes >= 15 && minutes <= preferred && start - minutes * 60000 > now)
    .sort((a, b) => a - b);
  return valid.length ? valid[valid.length - 1] : null;
}

/** Conferência mínima antes de enviar (o painel de edição já valida campo a campo). */
function checkEventForm(form: EventFormState, role: UserRole): EventFieldErrors | null {
  const errors: EventFieldErrors = {};
  const title = form.title.trim();
  if (title.length < 3) {
    errors.title = "Escreva um título com pelo menos 3 letras.";
  } else if (title.length > 140) {
    errors.title = "O título pode ter no máximo 140 caracteres.";
  }
  const start = new Date(form.startsAt);
  if (!form.startsAt || Number.isNaN(start.getTime())) {
    errors.startsAt = "Escolha a data e o horário de início.";
  }
  if (form.endsAt) {
    const end = new Date(form.endsAt);
    if (Number.isNaN(end.getTime())) {
      errors.endsAt = "Escolha uma data de término válida.";
    } else if (!errors.startsAt && end.getTime() < start.getTime()) {
      errors.endsAt = "O término precisa ser depois do início.";
    }
  }
  if (form.points.trim() && !(Number(form.points) >= 0)) {
    errors.points = "A pontuação precisa ser um número a partir de 0.";
  }
  if (role === "teacher" && (!form.academicClassId || !form.subjectId)) {
    errors.academicClassId = "Escolha a disciplina e a turma.";
  }
  return Object.keys(errors).length ? errors : null;
}

function buildEventBody(form: EventFormState): EventInput {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    category: form.category,
    // datetime-local não tem fuso; vai em ISO UTC para o backend gravar o instante certo
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    points: form.points.trim() ? Number(form.points) : null,
    location: form.location.trim() || null,
    academicClassId: form.academicClassId ? Number(form.academicClassId) : null,
    subjectId: form.subjectId ? Number(form.subjectId) : null,
  };
}

function pickEventErrors(errors: Record<string, string>) {
  const picked: EventFieldErrors = {};
  for (const key of eventFormKeys) {
    if (errors[key]) {
      picked[key] = errors[key];
    }
  }
  return picked;
}

/** Para quem o evento aparece: "a TADS 5" ou "toda a instituição". */
function eventReach(event: AcademicEvent) {
  return event.academicClass?.name ? `a ${event.academicClass.name}` : "toda a instituição";
}

function savedText(event: AcademicEvent, editing: boolean, markedChanged: boolean) {
  if (editing) {
    const base = `Alterações salvas em "${event.title}".`;
    return markedChanged ? `${base} ${capitalize(eventReach(event))} vai ver o evento como Alterado.` : base;
  }
  if (event.source === "teacher") {
    return event.academicClass?.name
      ? `A ${event.academicClass.name} já vê "${event.title}" na agenda.`
      : `"${event.title}" já está na agenda.`;
  }
  return `Evento oficial publicado para ${eventReach(event)}: "${event.title}".`;
}

function statusText(title: string, status: AcademicEvent["status"]) {
  if (status === "completed") return `Evento concluído: "${title}".`;
  if (status === "cancelled") return `Evento cancelado: "${title}".`;
  return `Evento reativado: "${title}".`;
}

/**
 * Calendário de exemplo do dia: o checksum muda por dia, para a tela avisar se já foi importado. As datas vão no
 * formato do modelo e do Figma ("2026-11-17"), sem fuso: a importação lê no horário do navegador, o mesmo da prévia,
 * e manda o instante certo para a API.
 */
function buildDemoPayload(dayKey: string): CalendarImportInput {
  const [year, month, day] = dayKey.split("-").map(Number);
  const today = new Date(year, (month || 1) - 1, day || 1);
  const at = (offset: number) => localDateKey(addDays(startOfDay(today), offset));
  return {
    sourceName: "Calendário de demonstração",
    sourceUrl: "https://www.ifms.edu.br/",
    checksum: `demo-${dayKey}`,
    events: [
      {
        title: "Semana acadêmica",
        description: "Palestras, oficinas e apresentações para todas as turmas.",
        category: "institutional",
        startsAt: at(14),
        // término só com o dia: vale até 23:59 dele, sem ocupar o dia seguinte no calendário
        endsAt: at(16),
        sourceExternalId: "demo-semana-academica",
        color: "#2563eb",
      },
      {
        title: "Prazo final de ajuste de matrícula",
        description: "Data oficial da secretaria acadêmica.",
        category: "institutional",
        startsAt: at(18),
        sourceExternalId: "demo-ajuste-matricula",
        color: "#0f766e",
      },
    ],
  };
}

export default function Home() {
  /* ---------------------------------------------------------------- */
  /* Estado                                                            */
  /* ---------------------------------------------------------------- */
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  // e-mail de quem estava na sessão que venceu: a tela de entrada já vem com ele
  const [loginEmail, setLoginEmail] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<View>("dashboard");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("list");
  const [navToken, setNavToken] = useState(0);
  const [focusHeadingToken, setFocusHeadingToken] = useState(0);

  const [context, setContext] = useState<AcademicContext | null>(null);
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [imports, setImports] = useState<CalendarImport[]>([]);

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Category[]>(allCategories);
  const [search, setSearch] = useState("");
  // antecedência escolhida no detalhe e ainda não salva (vale só para o evento e o lembrete de quando foi escolhida)
  const [reminderDraft, setReminderDraft] = useState<{ eventId: number; base: number | null; value: string } | null>(
    null
  );
  const [dismissedAvisos, setDismissedAvisos] = useState<string[]>([]);

  // painel de edição
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [editingFallback, setEditingFallback] = useState<AcademicEvent | null>(null);
  const [eventForm, setEventForm] = useState<EventFormState>(() => createInitialEventForm());
  const [formSnapshot, setFormSnapshot] = useState<EventFormState | null>(null);
  const [serverErrorState, setServerErrorState] = useState<{ errors: EventFieldErrors; form: EventFormState } | null>(
    null
  );
  const [lastSavedId, setLastSavedId] = useState<number | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  // resultado de Concluir, Cancelar evento ou Reativar feito pelo próprio painel (com o Desfazer)
  const [editorStatusNotice, setEditorStatusNotice] = useState<StatusNotice | null>(null);

  // carregamento e envios (um estado por ação)
  const [loading, setLoading] = useState(false);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [referenceNow, setReferenceNow] = useState(0);
  const [savingEvent, setSavingEvent] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);
  const [statusBusy, setStatusBusy] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [toasts, setToasts] = useState<PageToast[]>([]);
  // camadas leves (cada uma com entrada no histórico): confirmação, Preferências e menu do celular
  const [confirm, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // painel lateral de uma área (useBackLayer) ou a gaveta de notas aberto, com entrada no histórico
  const [panelLayerOpen, setPanelLayerOpen] = useState(false);

  // avisos do sistema (GET /notifications): os não lidos e o número do menu
  const [notices, setNotices] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // responsável: o aluno pedido (endereço ou seletor); o escolhido de fato sai dos vínculos ativos
  const [studentChoice, setStudentChoice] = useState<number | null>(null);
  // Turmas e disciplinas: a turma (e o aluno) a abrir; Notas: a avaliação a destacar
  const [classesTarget, setClassesTarget] = useState<ClassesTarget | null>(null);
  const [gradeFocus, setGradeFocus] = useState<number | null>(null);
  // quantos resultados a busca do menu acha na tela Turmas e disciplinas (a tela conta)
  const [localSearchCount, setLocalSearchCount] = useState<number | undefined>(undefined);
  // gaveta de notas de uma avaliação (EventGradesDrawer), aberta pela Gestão e pela tela Notas da docente
  const [gradesEventId, setGradesEventId] = useState<number | null>(null);

  const user = session?.user ?? null;
  const canWrite = writesEvents(user?.role);
  const isAdmin = user?.role === "admin";
  const isGuardian = user?.role === "guardian";

  // valores lidos fora do render: respostas em voo, histórico e rolagem
  const sessionRef = useRef<Session | null>(null);
  // estado de agora, para respostas que chegam depois (o closure da ação é de quando ela começou)
  const liveRef = useRef({ editorOpen: false, editingEventId: null as number | null, selectedEventId: null as number | null });
  const scrollByKeyRef = useRef(new Map<string, number>());
  const pendingScrollRef = useRef<{ y: number; reassert: boolean } | null>(null);
  const scrollGuardRef = useRef<{ y: number; until: number } | null>(null);
  const editorEntryRef = useRef<HistoryEntry | null>(null);
  // o detalhe vai fechar porque o evento saiu: o foco que estava nele não pode ficar perdido no body
  const focusContentRef = useRef(false);
  const closePopRef = useRef<PendingPop | null>(null);
  const pendingBootRef = useRef<PendingBoot | null>(null);
  // cada carga que deu certo (com o número dela): o que ficou esperando dados novos
  const afterLoadRef = useRef<((loaded: LoadedData, seq: number) => void) | null>(null);
  // publicação nova sem resposta no prazo, ainda sem saber se entrou
  const unsureCreateRef = useRef<UnsureCreate | null>(null);
  // de volta à tela que abriu o detalhe: o evento cujo botão ou linha recebe o foco depois que ela montar, a rolagem
  // dela e qual dos botões ou linhas do evento abriu
  const openerFocusRef = useRef<{ eventId: number; y: number; spot?: OpenerSpot } | null>(null);
  // Voltar do navegador com o detalhe ao lado do Cronograma: a linha que recebe o foco quando o detalhe sair
  const detailFocusRef = useRef<{ eventId: number; spot?: OpenerSpot; at: number } | null>(null);
  // eventos que saíram da tela nesta sessão (excluídos aqui ou apagados por outra pessoa): cada um é tratado uma vez só
  const goneIdsRef = useRef(new Set<number>());
  // ações dos avisos rodam com as funções do render de agora (o aviso pode ter sido criado bem antes)
  const toastActionsRef = useRef<{ openFromToast: (eventId: number) => void } | null>(null);
  const loadSeqRef = useRef(0);
  const loadCountRef = useRef(0);
  const lastCreateRef = useRef<Pick<EventFormState, "academicClassId" | "subjectId" | "category"> | null>(null);
  // responsável: o aluno pedido, lido pela carga em voo (o estado de agora, não o de quando ela começou)
  const studentRef = useRef<number | null>(null);
  // painel lateral registrado por useBackLayer: o Voltar chama o requestClose dele
  const backLayerRef = useRef<{ id: string; requestClose: () => void } | null>(null);
  // funções do render de agora para o registro dos painéis (o objeto backLayers não muda)
  const panelFnsRef = useRef<{ open: BackLayers["open"]; close: BackLayers["close"] } | null>(null);
  const classesTargetSeq = useRef(0);

  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useLayoutEffect(() => {
    liveRef.current = { editorOpen, editingEventId, selectedEventId };
  });

  /* ---------------------------------------------------------------- */
  /* Avisos (toasts)                                                   */
  /* ---------------------------------------------------------------- */
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  // o tempo de cada aviso fica com o ToastStack
  const pushToast = useCallback((tone: ToastTone, text: string, options: ToastOptions = {}) => {
    const id = Date.now() + Math.random();
    const { action, duration, keys, offline } = options;
    setToasts((current) => [
      // um aviso novo do mesmo assunto tira o antigo (o Desfazer dele já não vale); aviso igual sem botão não se
      // repete (dois "Lembrete removido." de lembretes diferentes ficam, cada um com o seu Desfazer)
      ...current
        .filter(
          (toast) =>
            !(keys?.length && toast.keys?.some((key) => keys.includes(key))) &&
            !(toast.tone === tone && toast.text === text && !toast.action)
        )
        .slice(-3),
      {
        id,
        tone,
        text,
        duration,
        keys,
        offline,
        action: action
          ? {
              label: action.label,
              onClick: () => {
                setToasts((list) => list.filter((toast) => toast.id !== id));
                action.onClick();
              },
            }
          : undefined,
      },
    ]);
  }, []);

  /** Tira da tela os avisos de um assunto (ex.: o Desfazer de uma situação que o painel já mostra). */
  const dropToasts = useCallback((key: string) => {
    setToasts((current) =>
      current.some((toast) => toast.keys?.includes(key)) ? current.filter((toast) => !toast.keys?.includes(key)) : current
    );
  }, []);

  /** A tela Turmas abriu o painel pedido: turma e membro saem do endereço (o F5 não reabre o painel). */
  const handleClassesTarget = useCallback(() => {
    setClassesTarget(null);
    const current = currentEntry();
    if (current?.view === "classes" && (current.turma || current.membro)) {
      writeHistory("replace", { ...current, turma: undefined, membro: undefined });
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Carregamento de dados                                             */
  /* ---------------------------------------------------------------- */
  const loadAll = useCallback(async (activeSession: Session): Promise<LoadResult> => {
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    loadCountRef.current += 1;
    setLoading(true);
    try {
      const { token } = activeSession;
      const role = activeSession.user.role;
      // avisos do sistema: uma falha aqui não derruba a carga (o número do menu fica como estava)
      const noticesLoad = getNotifications(token).catch(() => null);
      let contextData: AcademicContext;
      let eventsData: AcademicEvent[];
      let remindersData: Reminder[];
      let importsData: CalendarImport[] = [];
      let noticesData: NotificationList | null;
      let guardianStudent: number | null = null;
      if (role === "guardian") {
        // o responsável escolhe o aluno pelos vínculos ativos do contexto: os eventos vêm depois, com o studentId
        [contextData, remindersData, noticesData] = await Promise.all([getContext(token), getReminders(token), noticesLoad]);
        guardianStudent = pickStudent(contextData, studentRef.current)?.id ?? null;
        // sem vínculo ativo, só os eventos oficiais
        eventsData = await getEvents(token, guardianStudent);
      } else {
        [contextData, eventsData, remindersData, importsData, noticesData] = await Promise.all([
          getContext(token),
          getEvents(token),
          getReminders(token),
          role === "admin" ? getCalendarImports(token) : Promise.resolve<CalendarImport[]>([]),
          noticesLoad,
        ]);
      }
      if (sessionRef.current?.token !== activeSession.token || seq !== loadSeqRef.current) {
        // resposta antiga: logout, troca de usuário ou outra carga mais nova
        return { ok: false, error: null };
      }
      if (role === "guardian" && guardianStudent !== studentRef.current) {
        // o aluno do endereço não tem (mais) vínculo ativo, ou nenhum foi pedido: vale o primeiro ativo, e o
        // endereço passa a dizer qual
        studentRef.current = guardianStudent;
        setEntryStudent(guardianStudent ?? 0);
        setStudentChoice(guardianStudent);
        const current = currentEntry();
        if (current) {
          writeHistory("replace", { ...current, aluno: guardianStudent ?? undefined });
        }
      }
      setContext(contextData);
      setEvents(eventsData);
      setReminders(remindersData);
      setImports(importsData);
      if (noticesData) {
        setNotices(noticesData.notifications.filter((notice) => !notice.readAt));
        setUnreadCount(noticesData.unreadCount);
      }
      setLoadFailure(null);
      setLastLoadedAt(new Date());
      setReferenceNow(Date.now());
      const loaded: LoadedData = { events: eventsData, context: contextData };
      // primeira carga que deu certo depois de entrar ou do F5 (mesmo pelo Tentar de novo): rolagem, detalhe e
      // rascunho; e a publicação que ficou sem resposta no prazo, se ela já aparece
      afterLoadRef.current?.(loaded, seq);
      return { ok: true, ...loaded };
    } catch (err) {
      if (sessionRef.current?.token !== activeSession.token || seq !== loadSeqRef.current) {
        return { ok: false, error: null };
      }
      if (!(err instanceof ApiError && err.status === 401)) {
        // 401 fica com o aviso de sessão vencida
        setLoadFailure({ message: failText(err), offline: offlineError(err) });
      }
      return { ok: false, error: err };
    } finally {
      loadCountRef.current -= 1;
      if (loadCountRef.current === 0) {
        setLoading(false);
      }
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Derivações                                                        */
  /* ---------------------------------------------------------------- */
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);

  const reminderByEvent = useMemo(
    () => new Map(reminders.map((reminder) => [reminder.academicEventId, reminder])),
    [reminders]
  );

  // eventos com o lembrete da pessoa (listas, destaque e Cronograma)
  const joinedEvents = useMemo(
    () => events.map((event) => ({ ...event, reminder: reminderByEvent.get(event.id) ?? null })),
    [events, reminderByEvent]
  );

  const remindersWithEvents = useMemo(
    () =>
      reminders.map((reminder) => ({
        ...reminder,
        academicEvent: eventsById.get(reminder.academicEventId) ?? reminder.academicEvent,
      })),
    [reminders, eventsById]
  );

  // a busca vale para todo o sistema; o filtro de categoria, só para a lista do Cronograma
  const searchedEvents = useMemo(
    () => joinedEvents.filter((event) => matchesSearch(event, search)).sort(byStart),
    [joinedEvents, search]
  );

  const filteredEvents = useMemo(
    () => searchedEvents.filter((event) => selectedCategories.includes(event.category)),
    [searchedEvents, selectedCategories]
  );

  const upcomingEvents = useMemo(
    () =>
      joinedEvents
        .filter(
          (event) =>
            new Date(event.startsAt).getTime() >= referenceNow &&
            event.status !== "cancelled" &&
            event.status !== "completed"
        )
        .sort(byStart),
    [joinedEvents, referenceNow]
  );

  const officialUpcoming = useMemo(
    () =>
      upcomingEvents.filter(
        (event) => event.officialPriority || event.source === "official" || event.source === "imported"
      ),
    [upcomingEvents]
  );

  // lembretes cuja hora chegou e cujo evento ainda está por vir: viram aviso no sistema
  const avisos = useMemo(() => {
    if (!referenceNow) {
      return [];
    }
    const dismissed = new Set(dismissedAvisos);
    return remindersWithEvents
      .filter((reminder) => {
        const event = reminder.academicEvent;
        return (
          reminder.enabled &&
          Boolean(event) &&
          new Date(reminder.sendAt).getTime() <= referenceNow &&
          new Date(event!.startsAt).getTime() > referenceNow &&
          event!.status !== "cancelled" &&
          event!.status !== "completed" &&
          !dismissed.has(avisoKey(reminder))
        );
      })
      .sort((a, b) => byStart(a.academicEvent!, b.academicEvent!));
  }, [remindersWithEvents, dismissedAvisos, referenceNow]);

  const canManageEvent = useCallback((event: AcademicEvent) => canManage(event, user, context), [context, user]);

  // responsável: vínculos ativos (o seletor do menu), pendentes (o card de vincular) e o aluno escolhido
  const linkedStudents = useMemo(() => context?.linkedStudents ?? [], [context]);
  const activeStudents = useMemo(() => linkedStudents.filter((item) => item.status === "active"), [linkedStudents]);
  const pendingStudents = useMemo(() => linkedStudents.filter((item) => item.status === "pending"), [linkedStudents]);
  const guardianStudent = isGuardian ? pickStudent(context, studentChoice) : null;

  const manageableEvents = useMemo(
    () => joinedEvents.filter(canManageEvent).sort(byStart),
    [joinedEvents, canManageEvent]
  );

  // tela Notas da docente e da administração: as provas e os trabalhos de turma que a pessoa gerencia
  const gradableEvents = useMemo(() => manageableEvents.filter(isGradable), [manageableEvents]);

  const selectedEvent = useMemo(
    () => (selectedEventId === null ? null : (joinedEvents.find((event) => event.id === selectedEventId) ?? null)),
    [joinedEvents, selectedEventId]
  );

  const editingEvent = useMemo(
    () =>
      editingEventId === null
        ? null
        : (joinedEvents.find((event) => event.id === editingEventId) ?? editingFallback),
    [joinedEvents, editingEventId, editingFallback]
  );

  const dirty = editorOpen && formSnapshot !== null && !sameForm(eventForm, formSnapshot);

  // erros do servidor somem do campo assim que a pessoa muda o valor dele
  const visibleServerErrors = useMemo(() => {
    if (!serverErrorState) {
      return undefined;
    }
    const visible: EventFieldErrors = {};
    for (const key of Object.keys(serverErrorState.errors) as Array<keyof EventFormState>) {
      if (eventForm[key] === serverErrorState.form[key]) {
        visible[key] = serverErrorState.errors[key];
      }
    }
    return visible;
  }, [serverErrorState, eventForm]);

  // antecedência do detalhe: a salva, ou a escolhida e ainda não salva
  const savedOffset = selectedEvent?.reminder?.offsetMinutes ?? null;
  const reminderOffset =
    reminderDraft && reminderDraft.eventId === selectedEventId && reminderDraft.base === savedOffset
      ? reminderDraft.value
      : String(savedOffset ?? user?.defaultReminderMinutes ?? 1440);

  function setReminderOffset(value: string) {
    if (selectedEventId !== null) {
      setReminderDraft({ eventId: selectedEventId, base: savedOffset, value });
    }
  }

  const todayKey = localDateKey(new Date(referenceNow));
  const demoPayload = useMemo(() => buildDemoPayload(todayKey), [todayKey]);

  /* ---------------------------------------------------------------- */
  /* Navegação: tela, endereço e rolagem                               */
  /* ---------------------------------------------------------------- */
  function requestScroll(y: number, reassert = false) {
    pendingScrollRef.current = { y, reassert };
    setNavToken((token) => token + 1);
  }

  // toda troca de tela começa no topo; alvos específicos (linha, formulário) ficam com
  // os componentes, em useEffect, que roda depois e prevalece
  useLayoutEffect(() => {
    const target = pendingScrollRef.current;
    if (!target) {
      return;
    }
    window.scrollTo({ top: target.y, behavior: "instant" });
    if (!target.reassert) {
      pendingScrollRef.current = null;
    }
  }, [navToken]);

  // Voltar e Avançar: a rolagem guardada prevalece sobre o foco no título da tela
  useEffect(() => {
    const target = pendingScrollRef.current;
    if (!target) {
      return;
    }
    pendingScrollRef.current = null;
    window.scrollTo({ top: target.y, behavior: "instant" });
  }, [navToken]);

  // de volta à tela que abriu o detalhe (X, Esc ou Voltar): depois que ela monta e a rolagem volta, o foco vai
  // para o mesmo botão ou linha que abriu (sem ele, o primeiro à vista do mesmo evento); sem nenhum, para o título
  // da tela, como nas outras trocas
  useEffect(() => {
    const pending = openerFocusRef.current;
    if (!pending) {
      return;
    }
    openerFocusRef.current = null;
    focusOpenerSoon(pending.eventId, pending.y, pending.spot);
  }, [navToken]);

  // o detalhe fechou porque o evento saiu (excluído ou apagado por outra pessoa): o botão que tinha o foco sumiu com
  // ele, e o foco vai para o conteúdo da tela, como faz a confirmação quando não tem para onde devolver. Fechou pelo
  // Voltar do navegador, com o detalhe ao lado do Cronograma: o foco vai para a linha que o abriu, como no X e no Esc
  // (no Modal, quem devolve o foco é o próprio Modal; aqui só se recolhe o que caiu no body)
  useEffect(() => {
    if (selectedEventId !== null) {
      return;
    }
    const back = detailFocusRef.current;
    detailFocusRef.current = null;
    if (focusContentRef.current) {
      focusContentRef.current = false;
      if (focusLost()) {
        document.getElementById("conteudo")?.focus({ preventScroll: true });
      }
      return;
    }
    if (!back || Date.now() - back.at > 1500) {
      return;
    }
    const toOpener = () => {
      if (focusLost() && !focusOpener(back.eventId, back.spot)) {
        focusScreenHeading();
      }
    };
    toOpener();
    window.requestAnimationFrame(toOpener);
  }, [selectedEventId]);

  /** Guarda a rolagem da entrada atual (e o que mais ela precisar levar, como quem abriu o detalhe). */
  function rememberScroll(extra: Partial<HistoryEntry> = {}) {
    const y = window.scrollY;
    const current = currentEntry();
    if (current) {
      scrollByKeyRef.current.set(current.key, y);
    }
    patchCurrentEntry({ scrollY: y, ...extra });
  }

  /** Parâmetros próprios da tela (turma e aluno em Turmas, avaliação em Notas) passam a valer para ela. */
  function applyViewParams(view: View, entry: Pick<HistoryEntry, "turma" | "membro" | "gradeEventId">) {
    if (view === "classes" && (entry.turma || entry.membro)) {
      classesTargetSeq.current += 1;
      setClassesTarget({ classId: entry.turma ?? null, memberId: entry.membro ?? null, key: classesTargetSeq.current });
    } else {
      setClassesTarget(null);
    }
    setGradeFocus(view === "grades" ? (entry.gradeEventId ?? null) : null);
    if (view !== "classes") {
      setLocalSearchCount(undefined);
    }
  }

  /** Troca de tela com endereço próprio, começando no topo. */
  function goTo(
    view: View,
    options: {
      eventId?: number | null;
      replace?: boolean;
      classId?: number | null;
      memberId?: number | null;
      gradeEventId?: number | null;
    } = {}
  ) {
    const eventId = view === "calendar" ? (options.eventId ?? null) : null;
    const params: Pick<HistoryEntry, "turma" | "membro" | "gradeEventId"> = {
      turma: view === "classes" ? (options.classId ?? undefined) : undefined,
      membro: view === "classes" ? (options.memberId ?? undefined) : undefined,
      gradeEventId: view === "grades" ? (options.gradeEventId ?? undefined) : undefined,
    };
    const withParams = Boolean(params.turma || params.membro || params.gradeEventId);
    // navegação nova: a trava de rolagem de um Voltar recente não vale para ela
    scrollGuardRef.current = null;
    // a gaveta de notas não fica aberta por cima de outra tela
    setGradesEventId(null);
    if (view === activeView && eventId === selectedEventId && !options.replace && !withParams) {
      changeMenu(false);
      requestScroll(0);
      setFocusHeadingToken((token) => token + 1);
      return;
    }
    // a tela de agora guarda o evento cujo detalhe ela abre (ou nenhum) e qual dos botões ou linhas dele abriu: no
    // Voltar, o foco volta para esse mesmo
    rememberScroll({ opener: eventId ?? undefined, openerSpot: eventId ? openerSpotFor(eventId) : undefined });
    const current = currentEntry();
    if (current?.layer) {
      // pelo menu do celular (ou por um aviso): a tela nova ocupa a entrada da camada, e o Voltar não reabre a camada
      setMenuOpen(false);
      setProfileOpen(false);
      setConfirmState(null);
      // o painel lateral da tela de antes sai junto com ela
      backLayerRef.current = null;
      setPanelLayerOpen(false);
    }
    writeHistory(options.replace || current?.layer ? "replace" : "push", {
      key: newEntryKey(),
      view,
      eventId,
      detail: eventId ? "outside" : undefined,
      ...params,
    });
    setActiveView(view);
    setSelectedEventId(eventId);
    setReminderDraft(null);
    applyViewParams(view, params);
    requestScroll(0);
    setFocusHeadingToken((token) => token + 1);
  }

  /** "Ver eventos" (ou Enter) na busca do menu: fora do Cronograma, leva ao resultado em todas as categorias. */
  function showSearchResults() {
    if (activeView === "calendar" || activeView === "classes") {
      // o resultado já está na tela (e o detalhe aberto continua): no celular, só fecha o menu
      changeMenu(false);
      return;
    }
    setSelectedCategories(allCategories);
    goTo("calendar");
  }

  function openCalendar(filter?: CalendarFilter) {
    setSelectedCategories(filter?.categories?.length ? filter.categories : allCategories);
    goTo("calendar");
  }

  /** Com todas ativas, clicar mostra só a clicada; depois soma e tira; sem nenhuma, volta a todas. */
  function toggleCategory(category: Category) {
    setSelectedCategories((current) => {
      if (current.length === allCategories.length) {
        return [category];
      }
      const next = current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category];
      return next.length ? next : allCategories;
    });
  }

  /** Abre (ou troca) o evento do detalhe. Vindo de outra tela, empilha: Voltar e o X voltam para lá. */
  function selectEvent(id: number | null) {
    if (id === null) {
      closeDetail();
      return;
    }
    if (activeView !== "calendar") {
      goTo("calendar", { eventId: id });
      return;
    }
    if (id === selectedEventId) {
      return;
    }
    setReminderDraft(null);
    const current = currentEntry();
    if (selectedEventId === null || !current) {
      // a lista guarda a linha que abriu o detalhe: no Voltar do navegador, o foco volta para ela
      rememberScroll({ opener: id, openerSpot: openerSpotFor(id) });
      writeHistory("push", { key: newEntryKey(), view: "calendar", eventId: id, detail: "here" });
    } else {
      // trocar de evento dentro do Cronograma não cria entrada nova
      writeHistory("replace", { ...current, eventId: id, detail: current.detail === "here" ? "here" : "switched" });
    }
    setSelectedEventId(id);
  }

  function closeDetail() {
    if (selectedEventId === null) {
      return;
    }
    const current = currentEntry();
    if (
      current?.view === "calendar" &&
      current.eventId === selectedEventId &&
      (current.detail === "outside" || current.detail === "here")
    ) {
      // o popstate volta para a tela (e a rolagem) de onde o detalhe foi aberto
      backAndShow(deselectInPlace);
      return;
    }
    deselectInPlace();
  }

  /** Anda `steps` entradas (negativo para trás) e mostra a que vier, como num Voltar ou Avançar; sem popstate, `fallback`. */
  function goAndShow(steps: number, fallback: () => void) {
    const pending: PendingPop = { run: () => undefined, process: true };
    closePopRef.current = pending;
    window.history.go(steps);
    window.setTimeout(() => {
      if (closePopRef.current === pending) {
        closePopRef.current = null;
        fallback();
      }
    }, 700);
  }

  /** Volta uma entrada nossa (a do detalhe) e mostra a de baixo como num Voltar; sem popstate, `fallback`. */
  function backAndShow(fallback: () => void) {
    goAndShow(-1, fallback);
  }

  function deselectInPlace() {
    const current = currentEntry();
    if (current?.view === "calendar") {
      writeHistory("replace", { ...current, eventId: null, detail: undefined });
    }
    setSelectedEventId(null);
    setReminderDraft(null);
  }

  /** O evento do detalhe saiu (excluído ou apagado por outra pessoa): fecha o detalhe sem deixar entrada repetida. */
  function leaveDetail(eventId: number) {
    if (liveRef.current.selectedEventId !== eventId) {
      return;
    }
    focusContentRef.current = true;
    if (closePopRef.current?.process) {
      // já há uma volta nossa a caminho que mostra a entrada de baixo (o X, por exemplo): ela fecha o detalhe, e uma
      // segunda voltaria duas entradas
      return;
    }
    const current = currentEntry();
    if (
      current?.view === "calendar" &&
      current.eventId === eventId &&
      current.detail === "here" &&
      !current.layer &&
      current.editar === undefined
    ) {
      // o detalhe tem entrada própria em cima da lista: volta para ela (o Voltar seguinte já sai do Cronograma)
      backAndShow(deselectInPlace);
      return;
    }
    deselectInPlace();
  }

  /** Depois de salvar no Cronograma, o evento salvo fica escolhido. */
  function showInCalendar(eventId: number) {
    const current = currentEntry();
    if (!current || current.view !== "calendar") {
      return;
    }
    if (current.eventId === null) {
      // a folha abre com entrada própria, como ao tocar num evento: o Voltar só fecha a folha
      rememberScroll();
      writeHistory("push", { key: newEntryKey(), view: "calendar", eventId, detail: "here" });
    } else if (current.eventId !== eventId) {
      writeHistory("replace", { ...current, eventId, detail: current.detail === "here" ? "here" : "switched" });
    }
    setSelectedEventId(eventId);
    setReminderDraft(null);
  }

  /* ---------------------------------------------------------------- */
  /* Camadas com entrada no histórico: o Voltar fecha só a de cima     */
  /* ---------------------------------------------------------------- */

  /** Volta uma entrada que nós pusemos (painel ou camada leve); `then` roda quando ela já saiu. */
  function popOwnEntry(fallback: HistoryEntry, then?: () => void) {
    const pending: PendingPop = { run: () => then?.() };
    closePopRef.current = pending;
    window.history.back();
    // reserva, se o popstate não vier
    window.setTimeout(() => {
      if (closePopRef.current === pending) {
        closePopRef.current = null;
        writeHistory("replace", fallback);
        pending.run();
      }
    }, 700);
  }

  /** Desfaz um Voltar: a entrada de onde a pessoa saiu volta para o topo e a tela não muda. */
  function keepEntry(entry: HistoryEntry | null) {
    if (!entry) {
      return;
    }
    const kept = writeHistory("push", entry);
    if (editorEntryRef.current?.key === entry.key) {
      editorEntryRef.current = kept;
    }
  }

  /**
   * Pula uma entrada que não mostraria nada, no sentido em que a pessoa andava (a posição diz qual). Pelo Avançar,
   * segue para a seguinte; sem nenhuma depois dela, volta para onde a pessoa estava. Pelo Voltar, volta mais uma.
   * Sem popstate, `fallback`. A entrada pulada nunca é mostrada: `left` continua sendo a última mostrada, então
   * pulos seguidos (um detalhe que saiu e, depois dele, uma camada que fechou) andam sempre no mesmo sentido.
   */
  function skipPast(entry: HistoryEntry, left: HistoryEntry | null, fallback: () => void) {
    const from = left?.pos;
    const at = entry.pos;
    if (from !== undefined && at !== undefined && at > from) {
      const stay = () => goAndShow(from - at, fallback);
      if (lastPushedPos !== null && at >= lastPushedPos) {
        // é a última entrada: não há tela seguinte
        stay();
      } else {
        goAndShow(1, stay);
      }
      return;
    }
    backAndShow(fallback);
  }

  /** Entrada que só repete a de baixo (camada ou edição que já fechou): pula e mostra a que vier. */
  function skipEntry(entry: HistoryEntry, left: HistoryEntry | null) {
    skipPast(entry, left, () => writeHistory("replace", { ...entry, layer: undefined, editar: undefined }));
  }

  /**
   * Detalhe de um evento que já saiu (excluído aqui ou por outra pessoa): a entrada não mostraria nada, então é pulada
   * no sentido em que a pessoa andava: pelo Avançar, chega à tela seguinte (ou fica onde estava, se não houver);
   * pelo Voltar, à de antes. Sem entrada antes dela, vira o Cronograma sem o detalhe.
   */
  function skipGoneEntry(entry: HistoryEntry, left: HistoryEntry | null) {
    const showList = () => {
      goTo("calendar", { replace: true });
      pushToast("info", EVENT_GONE);
    };
    const forward = left?.pos !== undefined && entry.pos !== undefined && entry.pos > left.pos;
    if (forward || (entry.pos ?? 0) > 0) {
      skipPast(entry, left, showList);
      return;
    }
    showList();
  }

  /** Volta para a entrada de onde a pessoa saiu (`steps` para a frente ou para trás). */
  function bounceTo(steps: number, back: HistoryEntry | null) {
    const pending: PendingPop = { run: () => undefined };
    closePopRef.current = pending;
    window.history.go(steps);
    window.setTimeout(() => {
      if (closePopRef.current === pending) {
        closePopRef.current = null;
        if (back) {
          writeHistory("replace", back);
        }
      }
    }, 700);
  }

  /** Abre uma camada leve com entrada própria (mesmo endereço); outra camada leve aberta troca de lugar com ela. */
  function openLayerEntry(layer: HistoryLayer) {
    const current = currentEntry();
    if (!current || current.layer === layer) {
      return;
    }
    // a confirmação aberta de dentro de um painel lateral ou das Preferências fica por cima deles (o Voltar fecha
    // só ela); as outras camadas leves trocam de lugar
    const stack = layer === "confirmar" && (current.layer === "painel" || current.layer === "perfil");
    if (current.layer && !stack) {
      writeHistory("replace", { ...current, layer });
      return;
    }
    rememberScroll();
    writeHistory("push", { ...current, key: newEntryKey(), layer });
  }

  /* Painel lateral das áreas (useBackLayer) e gaveta de notas: entrada própria no histórico */

  /** Um painel abriu: o Voltar passa a fechá-lo (pelo requestClose dele). Trocar de painel não mexe no histórico. */
  function openPanelLayer(id: string, requestClose: () => void) {
    backLayerRef.current = { id, requestClose };
    setPanelLayerOpen(true);
    openLayerEntry("painel");
  }

  /** O painel fechou pelo X, Esc, Salvar ou Fechar: a entrada dele sai do histórico (se outro não abriu no lugar). */
  function closePanelLayer(id: string) {
    if (backLayerRef.current?.id !== id) {
      return;
    }
    backLayerRef.current = null;
    // outro painel pode abrir logo em seguida (troca de conteúdo): ele fica com a mesma entrada
    window.setTimeout(() => {
      if (backLayerRef.current) {
        return;
      }
      setPanelLayerOpen(false);
      closeLayerEntry("painel");
    }, 0);
  }

  /** Fecha uma camada leve pelo X, Esc, clique fora ou botão: a entrada dela sai do histórico. */
  function closeLayerEntry(layer: HistoryLayer, then?: () => void) {
    const current = currentEntry();
    if (current?.layer === layer) {
      popOwnEntry({ ...current, layer: undefined }, then);
      return;
    }
    then?.();
  }

  /** Menu do celular: abrir ou fechar (o Voltar também fecha). */
  function changeMenu(open: boolean) {
    setMenuOpen(open);
    if (open) {
      openLayerEntry("menu");
    } else {
      closeLayerEntry("menu");
    }
  }

  function openProfile() {
    // aberta pelo menu do celular: as Preferências ocupam a entrada dele
    setMenuOpen(false);
    setProfileOpen(true);
    openLayerEntry("perfil");
  }

  function closeProfile() {
    setProfileOpen(false);
    closeLayerEntry("perfil");
  }

  /** Abre a confirmação, com entrada própria no histórico: o Voltar fecha só ela. */
  function setConfirm(next: ConfirmState) {
    setConfirmState(next);
    setConfirmBusy(false);
    openLayerEntry("confirmar");
  }

  function closeConfirm() {
    if (confirmBusy) {
      return;
    }
    setConfirmState(null);
    closeLayerEntry("confirmar");
  }

  /** Confirmou: a entrada da confirmação sai antes da ação, que pode fechar o painel ou trocar de tela. */
  function runConfirm(current: ConfirmState) {
    if (confirmBusy) {
      return;
    }
    setConfirmBusy(true);
    closeLayerEntry("confirmar", () => {
      void Promise.resolve()
        .then(() => current.action())
        .finally(() => {
          setConfirmBusy(false);
          setConfirmState((value) => (value === current ? null : value));
        });
    });
  }

  /** "Ver no cronograma" de um aviso: nunca troca a tela por trás do painel ou de um diálogo aberto. */
  function openFromToast(eventId: number) {
    whenClear(() => goTo("calendar", { eventId }));
  }

  /**
   * Roda `go` (uma troca de tela) depois de fechar o que está por cima: o painel de edição (perguntando antes de
   * descartar), a confirmação e as Preferências. Nunca troca a tela por trás de um painel ou diálogo aberto.
   */
  function whenClear(go: () => void) {
    if (editorOpen) {
      // com rascunho, pergunta antes; o painel fecha e só então a tela troca
      if (!savingEvent) {
        guardDraft(() => closeEditor(go));
      }
      return;
    }
    if (confirm) {
      if (!confirmBusy) {
        setConfirmState(null);
        closeLayerEntry("confirmar", go);
      }
      return;
    }
    if (profileOpen) {
      if (!savingProfile) {
        setProfileOpen(false);
        closeLayerEntry("perfil", go);
      }
      return;
    }
    go();
  }

  /* ---------------------------------------------------------------- */
  /* Responsável: aluno escolhido                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Passa a mostrar outro aluno: os dados do anterior saem da tela na hora (esqueleto até a carga nova) e a carga
   * pede os eventos com o studentId novo. O endereço é de quem chama.
   */
  function switchStudent(studentId: number) {
    const active = sessionRef.current;
    if (!active || active.user.role !== "guardian") {
      return;
    }
    studentRef.current = studentId;
    setEntryStudent(studentId);
    setStudentChoice(studentId);
    setEvents([]);
    setLastLoadedAt(null);
    setLoadFailure(null);
    setReminderDraft(null);
    void loadAll(active);
  }

  /** Seletor do menu (ou um aviso de outro aluno): troca o aluno, com entrada nova no histórico (&aluno=). */
  function chooseStudent(studentId: number, view: View = activeView, gradeEventId?: number | null) {
    if (!isGuardian || (studentId === guardianStudent?.id && view === activeView && !gradeEventId)) {
      return;
    }
    whenClear(() => {
      const current = currentEntry();
      if (current?.layer) {
        // pelo menu do celular: a tela do outro aluno ocupa a entrada do menu
        setMenuOpen(false);
      }
      rememberScroll();
      setEntryStudent(studentId);
      // avisos de nota de outro aluno trazem a avaliação a destacar (?tela=notas&aluno=4&evento=1)
      const params = { gradeEventId: view === "grades" ? (gradeEventId ?? undefined) : undefined };
      writeHistory(current?.layer ? "replace" : "push", { key: newEntryKey(), view, eventId: null, aluno: studentId, ...params });
      setActiveView(view);
      setSelectedEventId(null);
      applyViewParams(view, params);
      requestScroll(0);
      setFocusHeadingToken((token) => token + 1);
      if (studentId !== studentRef.current) {
        switchStudent(studentId);
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Ações para as áreas (useAppActions)                               */
  /* ---------------------------------------------------------------- */

  /** Troca de tela pedida por uma área ou por um aviso, com os parâmetros dela, sem passar por cima de um painel aberto. */
  function navigate(target: View, params: NavigateParams = {}) {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    const view = canSee(target, active.user.role) ? target : "dashboard";
    if (active.user.role === "guardian" && params.studentId && params.studentId !== studentRef.current) {
      // aviso de nota de outro aluno: troca o aluno e abre a tela
      chooseStudent(params.studentId, view, params.eventId);
      return;
    }
    whenClear(() =>
      goTo(view, {
        eventId: params.eventId,
        classId: params.classId,
        memberId: params.memberId,
        gradeEventId: view === "grades" ? params.eventId : undefined,
      })
    );
  }

  /** Abre a gaveta de notas da avaliação (nunca por cima do painel de edição). */
  function openGrades(eventId: number) {
    if (!writesEvents(sessionRef.current?.user.role)) {
      return;
    }
    if (editorOpen) {
      if (!savingEvent) {
        guardDraft(() => closeEditor(() => setGradesEventId(eventId)));
      }
      return;
    }
    setGradesEventId(eventId);
  }

  /** Marca o aviso do sistema como lido: sai da lista e do número do menu na hora. */
  async function readNotice(id: number) {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    if (notices.some((notice) => notice.id === id)) {
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    setNotices((list) => list.filter((notice) => notice.id !== id));
    try {
      await readNotification(active.token, id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        actionFailed(err, active, `aviso-${id}`);
        void refreshNotices(active);
      }
    }
  }

  async function readAllNotices() {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    setNotices([]);
    setUnreadCount(0);
    try {
      await readAllNotifications(active.token);
    } catch (err) {
      actionFailed(err, active, "avisos");
      void refreshNotices(active);
    }
  }

  /** Só os avisos do sistema (o número do menu), sem recarregar a agenda. */
  async function refreshNotices(active: Session) {
    try {
      const data = await getNotifications(active.token);
      if (sessionRef.current?.token === active.token) {
        setNotices(data.notifications.filter((notice) => !notice.readAt));
        setUnreadCount(data.unreadCount);
      }
    } catch {
      // sem conexão: o número fica como estava, e a próxima carga tenta de novo
    }
  }

  /** "Abrir" de um aviso do sistema: marca como lido e leva à tela do link (o perfil abre as Preferências). */
  function openNotice(notice: AppNotification) {
    void readNotice(notice.id);
    const target = notice.link ? noticeTarget(notice.link) : null;
    if (!target) {
      return;
    }
    if (target.view === "perfil") {
      whenClear(() => openProfile());
      return;
    }
    navigate(target.view, target.params);
  }

  const onPopState = useEffectEvent((event: PopStateEvent) => {
    const stored = readEntry(event.state);
    const active = sessionRef.current;

    // volta pedida por nós (fechar o painel ou uma camada leve, ou voltar para onde a pessoa estava): só acompanha
    const pending = closePopRef.current;
    closePopRef.current = null;
    if (pending && !pending.process) {
      if (stored) {
        adoptEntry(stored, false);
      } else if (active) {
        adoptEntry({ key: newEntryKey(), ...entryFromSearch(window.location.search, active.user.role) }, true);
      }
      pending.run();
      return;
    }

    if (!active) {
      // tela de entrada: o endereço não leva para telas da conta que saiu
      markSignedOut();
      return;
    }
    // volta nossa que mostra a entrada que vier (fechar o detalhe, pular uma entrada repetida)
    const ours = Boolean(pending?.process);
    const left = shownEntry;
    const entry: HistoryEntry = stored ?? {
      key: newEntryKey(),
      ...entryFromSearch(window.location.search, active.user.role),
    };

    // entrada de outra conta (de antes de sair e entrar de novo): não serve de Voltar nem de Avançar
    if (stored && stored.uid !== undefined && stored.uid !== active.user.id) {
      const steps =
        left?.pos !== undefined && stored.pos !== undefined && left.pos !== stored.pos ? left.pos - stored.pos : 1;
      bounceTo(steps, left);
      return;
    }

    // camadas leves: o Voltar fecha só a de cima, e a tela de baixo continua a mesma
    if (!ours && confirm && entry.layer !== "confirmar") {
      if (confirmBusy) {
        // a ação confirmada está em andamento: o Voltar não fecha nem troca a tela
        keepEntry(left);
        return;
      }
      setConfirmState(null);
    }
    if (!ours && profileOpen && entry.layer !== "perfil") {
      if (savingProfile) {
        keepEntry(left);
        return;
      }
      setProfileOpen(false);
    }
    if (menuOpen && entry.layer !== "menu") {
      setMenuOpen(false);
    }
    if (!ours && panelLayerOpen && entry.layer !== "painel") {
      const panel = backLayerRef.current;
      if (panel) {
        // painel lateral de uma área ou gaveta de notas: o Voltar pede para fechar (o requestClose pode perguntar
        // antes de descartar). A entrada volta para o topo; quando o painel fechar, ela sai de novo
        keepEntry(left);
        panel.requestClose();
        return;
      }
      setPanelLayerOpen(false);
    }

    const layerOpen =
      entry.layer === "confirmar"
        ? confirm
        : entry.layer === "perfil"
          ? profileOpen
          : entry.layer === "painel"
            ? panelLayerOpen
            : menuOpen;
    if ((entry.layer && !layerOpen) || (entry.editar !== undefined && !editorOpen)) {
      // camada ou edição que já fechou (ex.: Avançar até ela): pula, para o Voltar nunca ficar parado
      skipEntry(entry, left);
      return;
    }

    if (editorOpen && entry.editar === undefined) {
      if (savingEvent) {
        // salvando: o Voltar não fecha o painel nem oferece descartar o que já está indo para a API
        keepEntry(editorEntryRef.current ?? left);
        return;
      }
      if (dirty) {
        // o Voltar não joga o rascunho fora: devolve a entrada e pergunta
        keepEntry(editorEntryRef.current ?? left);
        askDiscard(() => closeEditor());
        return;
      }
      resetEditorState();
      forgetDraft();
    }

    // a entrada de antes já saiu do history.state: a rolagem dela fica só no mapa
    if (left) {
      scrollByKeyRef.current.set(left.key, window.scrollY);
    }
    // responsável: Voltar ou Avançar até outro aluno; os eventos dele ainda não estão na tela
    const otherStudent =
      active.user.role === "guardian" && entry.aluno !== undefined && entry.aluno !== studentRef.current ? entry.aluno : null;
    if (
      otherStudent === null &&
      entry.view === "calendar" &&
      entry.eventId &&
      lastLoadedAt &&
      !eventsById.has(entry.eventId)
    ) {
      skipGoneEntry(entry, left);
      return;
    }
    adoptEntry(entry, !stored);
    const view = canSee(entry.view, active.user.role) ? entry.view : "dashboard";
    const eventId = view === "calendar" ? (entry.eventId ?? null) : null;
    const viewChanged = view !== activeView;
    setActiveView(view);
    setSelectedEventId(eventId);
    if (viewChanged || eventId !== selectedEventId) {
      setReminderDraft(null);
    }
    if (viewChanged || view === "grades" || (view === "classes" && (entry.turma || entry.membro))) {
      applyViewParams(view, entry);
    }
    if (otherStudent !== null) {
      switchStudent(otherStudent);
    }
    if (viewChanged) {
      const known = scrollByKeyRef.current.get(entry.key);
      const y = known ?? entry.scrollY ?? 0;
      requestScroll(y, true);
      // só entrada de antes de um F5 (rolagem fora do mapa): se o Next ainda subir ao topo logo depois, a trava devolve
      scrollGuardRef.current = known === undefined && y > 0 ? { y, until: Date.now() + 800 } : null;
      // de volta do detalhe aberto nesta tela (X, Esc ou Voltar): o foco vai para quem abriu, depois que a tela
      // montar e a rolagem voltar; nas outras trocas, para o título da tela
      const opener =
        typeof entry.opener === "number" &&
        left?.view === "calendar" &&
        left.eventId !== null &&
        (left.pos === undefined || entry.pos === undefined || left.pos > entry.pos)
          ? entry.opener
          : null;
      if (opener !== null) {
        openerFocusRef.current = { eventId: opener, y, spot: readSpot(entry.openerSpot) };
      } else {
        setFocusHeadingToken((token) => token + 1);
      }
    } else if (
      view === "calendar" &&
      eventId === null &&
      selectedEventId !== null &&
      left?.view === "calendar" &&
      left.eventId !== null
    ) {
      // o detalhe do Cronograma fecha pelo Voltar: o foco que estava nele vai para a linha que o abriu
      detailFocusRef.current = {
        eventId: left.eventId,
        spot: entry.opener === left.eventId ? readSpot(entry.openerSpot) : undefined,
        at: Date.now(),
      };
    }
  });

  /* ---------------------------------------------------------------- */
  /* Painel de edição                                                  */
  /* ---------------------------------------------------------------- */
  function resetEditorState() {
    setEditorOpen(false);
    setFormSnapshot(null);
    setServerErrorState(null);
    setEditingEventId(null);
    setEditingFallback(null);
    setEditorStatusNotice(null);
    editorEntryRef.current = null;
  }

  /** O formulário mudou no painel: o resultado de uma mudança de situação mostrado ali deixa de valer. */
  const changeEventForm = useCallback((updater: (form: EventFormState) => EventFormState) => {
    setEventForm(updater);
    setEditorStatusNotice(null);
  }, []);

  /** Rascunho guardado da pessoa (F5 ou sessão vencida) sai quando o painel fecha. */
  function forgetDraft() {
    const active = sessionRef.current;
    // um rascunho que ainda espera a primeira carga (sessão vencida) fica
    if (active && !pendingBootRef.current?.resume?.editor) {
      writeStorage("session", resumeKey(active.user.id), null);
    }
  }

  /**
   * Abre o painel por cima da tela atual (que não muda nem rola). `rememberHere` falso: a entrada já tem a
   * rolagem certa (reabertura depois do F5, com a rolagem ainda a caminho).
   */
  function openEditor(
    event: AcademicEvent | null,
    form: EventFormState,
    snapshot: EventFormState = form,
    rememberHere = true
  ) {
    setEditingEventId(event?.id ?? null);
    setEditingFallback(event);
    setEventForm(form);
    setFormSnapshot(snapshot);
    setServerErrorState(null);
    setEditorStatusNotice(null);
    setEditorOpen(true);
    if (rememberHere) {
      rememberScroll();
    }
    const base = currentEntry() ?? {
      key: newEntryKey(),
      view: activeView,
      eventId: selectedEventId,
    };
    if (base.layer) {
      // "Novo evento" pelo menu do celular: o painel ocupa a entrada do menu
      setMenuOpen(false);
    }
    // já é uma entrada de edição (ou da camada que fechou): troca no lugar
    editorEntryRef.current = writeHistory(base.editar !== undefined || base.layer ? "replace" : "push", {
      ...base,
      key: newEntryKey(),
      editar: event?.id ?? "novo",
      layer: undefined,
    });
  }

  /** Fecha o painel e tira a entrada de edição do histórico; `then` roda depois disso. */
  function closeEditor(then?: () => void) {
    resetEditorState();
    forgetDraft();
    const current = currentEntry();
    if (current?.editar === undefined) {
      then?.();
      return;
    }
    if (current.layer) {
      // uma camada leve ainda em cima do painel sai junto (duas entradas)
      setConfirmState(null);
      setProfileOpen(false);
      setMenuOpen(false);
      const pending: PendingPop = { run: () => then?.() };
      closePopRef.current = pending;
      window.history.go(-2);
      window.setTimeout(() => {
        if (closePopRef.current === pending) {
          closePopRef.current = null;
          writeHistory("replace", { ...current, editar: undefined, layer: undefined });
          pending.run();
        }
      }, 700);
      return;
    }
    popOwnEntry({ ...current, editar: undefined }, then);
  }

  function askDiscard(onDiscard: () => void) {
    const title = (editingEvent?.title ?? eventForm.title).trim();
    setConfirm({
      title: editingEventId
        ? `Descartar as alterações em "${title}"?`
        : title
          ? `Descartar o novo evento "${title}"?`
          : "Descartar o novo evento?",
      message: editingEventId ? "O que você mudou ainda não foi salvo." : "O que você preencheu ainda não foi publicado.",
      confirmLabel: "Descartar",
      cancelLabel: "Continuar editando",
      tone: "danger",
      action: onDiscard,
    });
  }

  function requestCloseEditor() {
    if (savingEvent) {
      return;
    }
    if (dirty) {
      askDiscard(() => closeEditor());
      return;
    }
    closeEditor();
  }

  /** Com rascunho alterado, pergunta antes de trocar o que está no painel. */
  function guardDraft(next: () => void) {
    if (editorOpen && dirty) {
      askDiscard(next);
      return;
    }
    next();
  }

  function beginEdit(event: AcademicEvent) {
    if (editorOpen && editingEventId === event.id) {
      return;
    }
    guardDraft(() => openEditor(event, eventToForm(event)));
  }

  function openNewEvent() {
    // o aluno e o responsável só leem: nunca abrem o painel de novo evento
    if (!user || !writesEvents(user.role)) {
      return;
    }
    const role = user.role;
    guardDraft(() => {
      // com um vínculo só, a disciplina e a turma já vêm escolhidas
      const base = createInitialEventForm(role, context);
      // depois de publicar, a próxima publicação já vem com a mesma turma, disciplina e categoria
      const last = role === "teacher" ? lastCreateRef.current : null;
      openEditor(null, last ? { ...base, ...last } : base);
    });
  }

  function openNewEventFor(academicClassId: number, subjectId: number) {
    if (!user || !writesEvents(user.role)) {
      return;
    }
    const role = user.role;
    guardDraft(() =>
      openEditor(null, {
        ...createInitialEventForm(role),
        academicClassId: String(academicClassId),
        subjectId: String(subjectId),
      })
    );
  }

  async function saveEvent() {
    const active = sessionRef.current;
    if (!active || savingEvent) {
      return;
    }
    const form = eventForm;
    const localErrors = checkEventForm(form, active.user.role);
    if (localErrors) {
      setServerErrorState({ errors: localErrors, form });
      return;
    }
    const original = editingEvent;
    const body = buildEventBody(form);
    // mudar data, término ou local de um evento agendado marca como Alterado para a turma
    const markChanged = Boolean(
      original &&
        original.status === "scheduled" &&
        (!sameMinute(original.startsAt, body.startsAt) ||
          !sameMinute(original.endsAt, body.endsAt) ||
          (original.location ?? null) !== body.location)
    );
    const view = activeView;
    const subject = original ? `evento-${original.id}` : "evento-novo";
    // eventos de antes do envio: se a publicação ficar sem resposta, o criado é um que não estava aqui
    const known = new Set(events.map((event) => event.id));
    setSavingEvent(true);
    setServerErrorState(null);
    const unsure = original ? null : takeUnsureCreate(active);
    if (unsure) {
      // a publicação anterior ficou sem resposta no prazo: antes de publicar de novo, confere se ela já entrou
      let created: AcademicEvent | null;
      try {
        created = findCreated(await getEvents(active.token), unsure, active.user);
      } catch (err) {
        if (sessionRef.current?.token === unsure.token) {
          unsureCreateRef.current ??= unsure;
        }
        setSavingEvent(false);
        actionFailed(err, active, subject);
        return;
      }
      if (sessionRef.current?.token !== active.token) {
        setSavingEvent(false);
        return;
      }
      if (created && resolveCreated(created, unsure, active) !== "told") {
        return;
      }
    }
    let saved: AcademicEvent;
    try {
      saved = original
        ? await updateEvent(active.token, original.id, markChanged ? { ...body, status: "changed" } : body)
        : await createEvent(active.token, body);
    } catch (err) {
      setSavingEvent(false);
      if (err instanceof ApiError && err.status === 422) {
        // o painel continua aberto, com o erro no campo certo
        const errors = pickEventErrors(fieldErrors(err));
        setServerErrorState({ errors, form });
        if (!Object.keys(errors).length) {
          pushToast("danger", errorMessage(err), { keys: [subject] });
        }
        return;
      }
      if (!original && isTimeoutError(err)) {
        // a publicação pode ter entrado: a recarga que o aviso dispara (ou o próximo Publicar) confere e, se ela
        // entrou, o painel fecha como salvo, sem publicar duas vezes
        unsureCreateRef.current = {
          token: active.token,
          body,
          form,
          known,
          editorKey: editorEntryRef.current?.key ?? null,
          afterSeq: loadSeqRef.current + 1,
        };
      }
      // sem conexão ou sem resposta no prazo: o painel continua aberto com o rascunho (o rodapé dele avisa), Esc, X
      // e Fechar voltam a valer e, no prazo estourado, a recarga corre em segundo plano
      actionFailed(err, active, subject, original?.id);
      return;
    }
    finishSaved(saved, { active, view, form, editing: Boolean(original), markChanged });
  }

  /** Salvou: o painel fecha, o evento salvo é destacado (no Painel e na Gestão) ou aberto (no Cronograma) e o aviso sai. */
  function finishSaved(
    saved: AcademicEvent,
    { active, editing, form, markChanged, view }: { active: Session; view: View; form: EventFormState; editing: boolean; markChanged: boolean }
  ) {
    const subject = editing ? `evento-${saved.id}` : "evento-novo";
    // o Painel e a Gestão guardam a lista de agora e destacam o evento com a próxima, a da resposta logo abaixo: o
    // destaque sai assim que o painel fecha, sem esperar a recarga (quando ela chega, a pessoa já pode estar em
    // outro painel ou detalhe, e o destaque não pode tirar o foco nem a rolagem de lá)
    flushSync(() => {
      setLastSavedId(saved.id);
      setSavedTick((tick) => tick + 1);
    });
    // a lista, o destaque e o painel reaberto já mostram a versão salva: o "Salvando" sai agora e a
    // recarga corre em segundo plano (se ela falhar, a versão salva continua na tela)
    setEvents((list) => upsertEvent(list, saved));
    setSavingEvent(false);
    if (!editing) {
      rememberCreate(form, active);
    }
    closeEditor(() => {
      if (view === "calendar") {
        showInCalendar(saved.id);
      } else if (view === "dashboard" && focusLost()) {
        // o destaque leva o foco à linha salva; até lá, ele não fica no body
        document.getElementById("conteudo")?.focus({ preventScroll: true });
      }
      void loadAll(active);
    });
    pushToast("success", savedText(saved, editing, markChanged), {
      keys: [subject, `evento-${saved.id}`],
      action:
        view === "calendar"
          ? undefined
          : { label: "Ver no cronograma", onClick: () => toastActionsRef.current?.openFromToast(saved.id) },
    });
  }

  /** Depois de publicar, a próxima publicação da docente já vem com a mesma turma, disciplina e categoria. */
  function rememberCreate(form: EventFormState, active: Session) {
    if (active.user.role === "teacher") {
      lastCreateRef.current = {
        academicClassId: form.academicClassId,
        subjectId: form.subjectId,
        category: form.category,
      };
    }
  }

  /** A publicação sem resposta desta sessão, se houver: quem a pega passa a cuidar dela. */
  function takeUnsureCreate(active: Session) {
    const unsure = unsureCreateRef.current;
    if (!unsure || unsure.token !== active.token) {
      return null;
    }
    unsureCreateRef.current = null;
    return unsure;
  }

  /** Carga que deu certo depois do prazo estourado numa publicação: se o evento já aparece, ela entrou. */
  function settleUnsureCreate(list: AcademicEvent[], seq: number) {
    const unsure = unsureCreateRef.current;
    const active = sessionRef.current;
    if (!unsure || seq < unsure.afterSeq) {
      return;
    }
    if (!active || active.token !== unsure.token) {
      unsureCreateRef.current = null;
      return;
    }
    const created = findCreated(list, unsure, active.user);
    if (!created) {
      // ainda não aparece: a próxima carga, ou o Publicar de novo, confere outra vez
      return;
    }
    unsureCreateRef.current = null;
    resolveCreated(created, unsure, active);
  }

  /**
   * A publicação que ficou sem resposta no prazo entrou. Com o mesmo rascunho aberto (o mesmo painel, ou um novo com
   * o mesmo título e início), o painel fecha como salvo e o evento é destacado; se a pessoa mudou o rascunho depois,
   * o painel passa a editar o evento criado, com as mudanças. Fora disso, só o aviso de que ele foi publicado.
   */
  function resolveCreated(created: AcademicEvent, unsure: UnsureCreate, active: Session): "closed" | "adopted" | "told" {
    const draftOpen =
      editorOpen &&
      editingEventId === null &&
      (editorEntryRef.current?.key === unsure.editorKey ||
        (eventForm.title.trim() === unsure.body.title && sameMinute(eventForm.startsAt, unsure.body.startsAt)));
    if (draftOpen && sameForm(eventForm, unsure.form)) {
      finishSaved(created, { active, view: activeView, form: unsure.form, editing: false, markChanged: false });
      return "closed";
    }
    rememberCreate(unsure.form, active);
    if (draftOpen) {
      adoptCreated(created);
      setSavingEvent(false);
      pushToast("info", `${savedText(created, false, false)} O que você mudou depois continua no painel para salvar.`, {
        keys: ["evento-novo", `evento-${created.id}`],
      });
      return "adopted";
    }
    setEvents((list) => upsertEvent(list, created));
    // o aviso de prazo estourado daquela publicação já não vale; o novo não sai com a próxima publicação
    dropToasts("evento-novo");
    pushToast("success", savedText(created, false, false), {
      keys: [`evento-${created.id}`],
      action:
        activeView === "calendar"
          ? undefined
          : { label: "Ver no cronograma", onClick: () => toastActionsRef.current?.openFromToast(created.id) },
    });
    return "told";
  }

  /** O painel do rascunho passa a editar o evento que a publicação criou: o que a pessoa mudou depois fica como alteração. */
  function adoptCreated(created: AcademicEvent) {
    setEvents((list) => upsertEvent(list, created));
    setEditingEventId(created.id);
    setEditingFallback(created);
    setFormSnapshot(eventToForm(created));
    setServerErrorState(null);
    setEditorStatusNotice(null);
    const entry = editorEntryRef.current;
    const current = currentEntry();
    if (entry && current?.key === entry.key && current.editar === "novo") {
      editorEntryRef.current = writeHistory("replace", { ...current, editar: created.id });
    }
  }

  function requestDeleteEvent(event: AcademicEvent) {
    const audience = event.academicClass?.name ? `os alunos da ${event.academicClass.name}` : "toda a instituição";
    setConfirm({
      title: "Excluir evento?",
      message: `"${event.title}" será removido para ${audience}. Não dá para desfazer.`,
      confirmLabel: "Excluir evento",
      cancelLabel: "Manter evento",
      tone: "danger",
      action: () => deleteEventNow(event),
    });
  }

  async function deleteEventNow(event: AcademicEvent) {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    const subject = `evento-${event.id}`;
    try {
      await deleteEvent(active.token, event.id);
    } catch (err) {
      // 404: já tinha sido removido, segue como removido
      if (!(err instanceof ApiError && err.status === 404)) {
        actionFailed(err, active, subject);
        return;
      }
    }
    removeEventLocally(event.id);
    keepFocusInContent();
    // o detalhe fecha como no X: sem entrada repetida, o Voltar seguinte já sai do Cronograma
    const live = liveRef.current;
    if (live.editorOpen && live.editingEventId === event.id) {
      closeEditor(() => leaveDetail(event.id));
    } else {
      leaveDetail(event.id);
    }
    pushToast("success", `Evento excluído: "${event.title}".`, { keys: [subject, `lembrete-${event.id}`] });
    void loadAll(active);
  }

  /** Tira o evento (e o lembrete dele) da tela na hora, antes da recarga. */
  function removeEventLocally(eventId: number) {
    goneIdsRef.current.add(eventId);
    setEvents((list) => list.filter((item) => item.id !== eventId));
    setReminders((list) => list.filter((item) => item.academicEventId !== eventId));
  }

  /**
   * O evento sumiu (outra pessoa apagou): sai da lista, do detalhe e do painel, com um aviso só. Um evento que já
   * saiu (excluído aqui, ou já avisado por outra ação ou recarga) não fecha nada de novo nem repete o aviso.
   */
  function eventGone(eventId: number, active: Session, message: string, reload = true) {
    const first = !goneIdsRef.current.has(eventId);
    removeEventLocally(eventId);
    if (first) {
      // o detalhe, o destaque ou o botão de lembrete que tinha o foco sai junto: o foco vai para o conteúdo da tela
      keepFocusInContent();
      const live = liveRef.current;
      if (live.editorOpen && live.editingEventId === eventId) {
        closeEditor(() => leaveDetail(eventId));
      } else {
        leaveDetail(eventId);
      }
      pushToast("danger", message, { keys: [`evento-${eventId}`, `lembrete-${eventId}`] });
    }
    if (reload) {
      void loadAll(active);
    }
  }

  /**
   * A recarga veio sem o evento do detalhe aberto (outra pessoa apagou): o detalhe fecha como no 404, sem deixar o
   * evento no endereço, com o aviso e o foco no conteúdo. Com o painel de edição aberto, quem avisa é o salvar dele.
   */
  function dropVanishedDetail(list: AcademicEvent[]) {
    const active = sessionRef.current;
    const { editorOpen: editing, selectedEventId: shown } = liveRef.current;
    if (!active || shown === null || editing || closePopRef.current || list.some((event) => event.id === shown)) {
      return;
    }
    eventGone(shown, active, EVENT_GONE, false);
  }

  /**
   * Falha de uma ação: 401 fica com o aviso de sessão vencida, 404 do evento tira ele da tela, o resto vira aviso.
   * Sem resposta no prazo, o pedido pode ter chegado: a recarga em segundo plano mostra como ficou.
   */
  function actionFailed(err: unknown, active: Session, subject: string, eventId?: number) {
    if (err instanceof ApiError && err.status === 401) {
      return;
    }
    if (err instanceof ApiError && err.status === 404 && eventId !== undefined) {
      eventGone(eventId, active, errorMessage(err));
      return;
    }
    pushToast("danger", failText(err), { keys: [subject], offline: offlineError(err) });
    if (isTimeoutError(err)) {
      void loadAll(active);
    }
  }

  function requestStatusChange(event: AcademicEvent, status: EventStatusChange) {
    if (status === "cancelled") {
      setConfirm({
        title: "Cancelar evento?",
        message: event.academicClass?.name
          ? `Os alunos da ${event.academicClass.name} vão ver "${event.title}" como cancelado.`
          : `Toda a instituição vai ver "${event.title}" como cancelado.`,
        confirmLabel: "Cancelar evento",
        cancelLabel: "Voltar",
        tone: "danger",
        action: () => applyStatus(event, status),
      });
      return;
    }
    void applyStatus(event, status);
  }

  async function applyStatus(
    event: AcademicEvent,
    status: AcademicEvent["status"],
    options: { undo?: boolean; inEditor?: boolean } = {}
  ) {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    const undo = Boolean(options.undo);
    // pedida pelo painel lateral aberto: o resultado (e o Desfazer) aparece no próprio painel
    const inEditor = options.inEditor ?? (editorOpen && editingEventId === event.id);
    const previous = event.status;
    const subject = `evento-${event.id}`;
    setStatusBusy(event.id);
    let updated: AcademicEvent;
    try {
      updated = await updateEvent(active.token, event.id, { status });
    } catch (err) {
      setStatusBusy(null);
      actionFailed(err, active, subject, event.id);
      return;
    }
    // a situação nova já vale na tela (e no painel aberto); a recarga corre em segundo plano
    setEvents((list) => upsertEvent(list, updated));
    setStatusBusy(null);
    const live = liveRef.current;
    if (inEditor && live.editorOpen && live.editingEventId === event.id) {
      // avisos antigos sobre o evento (com outro Desfazer) saem: o painel mostra o resultado de agora
      dropToasts(subject);
      setEditorStatusNotice({
        text: statusShort(status),
        onUndo: undo ? undefined : () => void applyStatus(updated, previous, { undo: true, inEditor: true }),
      });
    } else {
      pushToast(
        "success",
        undo ? `"${event.title}" voltou para ${statusNames[status]}.` : statusText(event.title, status),
        {
          keys: [subject],
          action: undo
            ? undefined
            : { label: "Desfazer", onClick: () => void applyStatus(updated, previous, { undo: true, inEditor: false }) },
        }
      );
    }
    void loadAll(active);
  }

  /* ---------------------------------------------------------------- */
  /* Lembretes e avisos                                                */
  /* ---------------------------------------------------------------- */
  async function handleSaveReminder() {
    const active = sessionRef.current;
    const event = selectedEvent;
    if (!active || !event || savingReminder) {
      return;
    }
    const existed = Boolean(event.reminder);
    const subject = `lembrete-${event.id}`;
    setSavingReminder(true);
    try {
      const saved = await saveReminder(active.token, {
        academicEventId: event.id,
        offsetMinutes: Number(reminderOffset),
        enabled: true,
      });
      setReminders((list) => upsertReminder(list, saved));
      pushToast("success", `Lembrete de "${event.title}" ${existed ? "atualizado" : "criado"}${avisoTail(event, saved.sendAt)}.`, {
        keys: [subject],
      });
      setReminderDraft(null);
      void loadAll(active);
    } catch (err) {
      actionFailed(err, active, subject, event.id);
    } finally {
      setSavingReminder(false);
    }
  }

  /** Um clique: lembrete com a maior antecedência válida até a padrão da pessoa. */
  async function quickReminder(event: AcademicEvent) {
    const active = sessionRef.current;
    if (!active || savingReminder) {
      return;
    }
    const subject = `lembrete-${event.id}`;
    const existing = reminderByEvent.get(event.id);
    if (existing) {
      pushToast("info", `"${event.title}" já tem lembrete${avisoTail(event, existing.sendAt)}.`);
      return;
    }
    const offsetMinutes = bestReminderOffset(event.startsAt, active.user.defaultReminderMinutes, Date.now());
    if (offsetMinutes === null) {
      pushToast("danger", "Esse evento começa em menos de 15 minutos. Não dá mais para criar lembrete.");
      return;
    }
    setSavingReminder(true);
    try {
      const saved = await saveReminder(active.token, { academicEventId: event.id, offsetMinutes, enabled: true });
      setReminders((list) => upsertReminder(list, saved));
      pushToast("success", `Lembrete de "${event.title}" criado${avisoTail(event, saved.sendAt)}.`, {
        keys: [subject],
        action: { label: "Desfazer", onClick: () => void undoReminder(saved) },
      });
      void loadAll(active);
    } catch (err) {
      actionFailed(err, active, subject, event.id);
    } finally {
      setSavingReminder(false);
    }
  }

  async function undoReminder(reminder: Reminder) {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    const subject = `lembrete-${reminder.academicEventId}`;
    try {
      await deleteReminder(active.token, reminder.id);
      setReminders((list) => list.filter((item) => item.id !== reminder.id));
      pushToast("info", "Lembrete desfeito.", { keys: [subject] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setReminders((list) => list.filter((item) => item.id !== reminder.id));
      } else {
        actionFailed(err, active, subject);
      }
    }
    void loadAll(active);
  }

  async function removeReminderRecord(reminder: Reminder) {
    const active = sessionRef.current;
    if (!active || savingReminder) {
      return;
    }
    const subject = `lembrete-${reminder.academicEventId}`;
    setSavingReminder(true);
    try {
      await deleteReminder(active.token, reminder.id);
      setReminders((list) => list.filter((item) => item.id !== reminder.id));
      pushToast("success", `Lembrete de "${eventsById.get(reminder.academicEventId)?.title ?? reminder.academicEvent?.title ?? "evento"}" removido.`, {
        keys: [subject],
        action: { label: "Desfazer", onClick: () => void restoreReminder(reminder) },
      });
      setReminderDraft(null);
      void loadAll(active);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // já não existia: sai da tela do mesmo jeito, e a recarga diz se o evento saiu junto
        setReminders((list) => list.filter((item) => item.id !== reminder.id));
        void reminderGone(reminder, active, errorMessage(err));
        return;
      }
      actionFailed(err, active, subject);
    } finally {
      setSavingReminder(false);
    }
  }

  /**
   * O lembrete já não existia (404). Se o evento também saiu (outra pessoa apagou, e o lembrete foi junto), vale o
   * caminho do evento apagado: o detalhe fecha sem deixar o evento no endereço, o aviso diz que o evento não existe
   * mais e o foco fica no conteúdo. Se o evento continua, o aviso é o do lembrete.
   */
  async function reminderGone(reminder: Reminder, active: Session, message: string) {
    const eventId = reminder.academicEventId;
    const loaded = await loadAll(active);
    if (sessionRef.current?.token !== active.token || goneIdsRef.current.has(eventId)) {
      // a recarga (esta ou uma mais nova) já tratou o evento que saiu
      return;
    }
    if (loaded.ok && !loaded.events.some((event) => event.id === eventId)) {
      eventGone(eventId, active, EVENT_GONE, false);
      return;
    }
    pushToast("danger", message, { keys: [`lembrete-${eventId}`] });
  }

  /** Desfazer a remoção: recria com a mesma antecedência. */
  async function restoreReminder(reminder: Reminder) {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    const subject = `lembrete-${reminder.academicEventId}`;
    try {
      const saved = await saveReminder(active.token, {
        academicEventId: reminder.academicEventId,
        offsetMinutes: reminder.offsetMinutes,
        enabled: true,
      });
      setReminders((list) => upsertReminder(list, saved));
      // evento cancelado ou concluído: o lembrete volta, mas sem aviso para prometer (o evento da resposta é o de agora;
      // o Desfazer pode chegar bem depois do aviso que o criou)
      const event = saved.academicEvent ?? eventsById.get(reminder.academicEventId) ?? reminder.academicEvent;
      pushToast("success", `Lembrete de "${event?.title ?? "evento"}" de volta${avisoTail(event, saved.sendAt)}.`, {
        keys: [subject],
      });
      void loadAll(active);
    } catch (err) {
      actionFailed(err, active, subject, reminder.academicEventId);
    }
  }

  function removeReminderFromEvent(event: AcademicEvent) {
    const reminder = reminderByEvent.get(event.id) ?? event.reminder;
    if (reminder) {
      void removeReminderRecord(reminder);
    }
  }

  async function changeReminderOffset(reminder: Reminder, minutes: number) {
    const active = sessionRef.current;
    if (!active || savingReminder || minutes === reminder.offsetMinutes) {
      return;
    }
    const event = eventsById.get(reminder.academicEventId) ?? reminder.academicEvent;
    if (event && new Date(event.startsAt).getTime() - minutes * 60000 <= Date.now()) {
      pushToast("danger", "Esse horário de aviso já passou. Escolha uma antecedência menor.");
      return;
    }
    const subject = `lembrete-${reminder.academicEventId}`;
    setSavingReminder(true);
    try {
      const saved = await saveReminder(active.token, {
        academicEventId: reminder.academicEventId,
        offsetMinutes: minutes,
        enabled: reminder.enabled,
      });
      setReminders((list) => upsertReminder(list, saved));
      // tira o "Lembrete criado" de antes, com o horário velho e o Desfazer que apagaria o lembrete ajustado
      pushToast("success", `Lembrete de "${event?.title ?? "evento"}" atualizado${avisoTail(event, saved.sendAt)}.`, {
        keys: [subject],
      });
      void loadAll(active);
    } catch (err) {
      actionFailed(err, active, subject, reminder.academicEventId);
    } finally {
      setSavingReminder(false);
    }
  }

  function dismissAviso(reminderId: number) {
    const reminder = reminders.find((item) => item.id === reminderId);
    if (!reminder || !user) {
      return;
    }
    const next = [...new Set([...dismissedAvisos, avisoKey(reminder)])];
    setDismissedAvisos(next);
    writeStorage("local", dismissedKey(user.id), next);
  }

  /* ---------------------------------------------------------------- */
  /* Importação do calendário oficial                                  */
  /* ---------------------------------------------------------------- */
  async function runImport(payload: CalendarImportInput): Promise<CalendarImportOutcome> {
    const active = sessionRef.current;
    if (!active) {
      return { ok: false, error: new ApiError("Unauthorized access", 401) };
    }
    setImporting(true);
    try {
      const result = await importCalendar(active.token, payload);
      const ids = result.events.map((event) => event.id);
      pushToast(
        "success",
        `${ids.length} ${ids.length === 1 ? "data importada" : "datas importadas"} de "${result.import.sourceName}".`,
        { action: { label: "Desfazer", onClick: () => void undoImport(ids) } }
      );
      await loadAll(active);
      return { ok: true, result };
    } catch (err) {
      if (isTimeoutError(err)) {
        // sem resposta no prazo, a importação pode ter entrado: a recarga mostra as datas como ficaram
        void loadAll(active);
      }
      // o erro aparece no próprio bloco da importação, sem aviso solto
      return { ok: false, error: err instanceof ApiError ? err : new ApiError(errorMessage(err), 500) };
    } finally {
      setImporting(false);
    }
  }

  /** Desfaz uma importação apagando os eventos que ela criou. */
  async function undoImport(ids: number[]) {
    const active = sessionRef.current;
    if (!active || !ids.length) {
      return false;
    }
    setImporting(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteEvent(active.token, id)));
      const failed = results.filter(
        (item) => item.status === "rejected" && !(item.reason instanceof ApiError && item.reason.status === 404)
      ).length;
      await loadAll(active);
      if (failed) {
        pushToast("danger", `Não deu para remover ${failed} de ${ids.length} datas. Tente de novo.`);
        return false;
      }
      pushToast(
        "success",
        `Importação desfeita: ${ids.length} ${ids.length === 1 ? "data removida" : "datas removidas"}.`
      );
      return true;
    } finally {
      setImporting(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Sessão                                                            */
  /* ---------------------------------------------------------------- */
  function resetApp() {
    setContext(null);
    setEvents([]);
    setReminders([]);
    setImports([]);
    setSelectedEventId(null);
    setReminderDraft(null);
    resetEditorState();
    closePopRef.current = null;
    unsureCreateRef.current = null;
    openerFocusRef.current = null;
    detailFocusRef.current = null;
    goneIdsRef.current = new Set();
    setLastSavedId(null);
    setSavedTick(0);
    setSearch("");
    setSelectedCategories(allCategories);
    setCalendarMode("list");
    setActiveView("dashboard");
    setLastLoadedAt(null);
    setLoadFailure(null);
    setReferenceNow(0);
    setProfileOpen(false);
    setMenuOpen(false);
    setConfirmState(null);
    setConfirmBusy(false);
    setDismissedAvisos([]);
    lastCreateRef.current = null;
    pendingBootRef.current = null;
    setEntryOwner(0);
    // fases novas: avisos do sistema, aluno do responsável, alvos das telas, gaveta de notas e painel das áreas
    setNotices([]);
    setUnreadCount(0);
    studentRef.current = null;
    setEntryStudent(0);
    setStudentChoice(null);
    setClassesTarget(null);
    setGradeFocus(null);
    setLocalSearchCount(undefined);
    setGradesEventId(null);
    backLayerRef.current = null;
    setPanelLayerOpen(false);
  }

  async function startSession(next: Session, mode: "boot" | "login") {
    sessionRef.current = next;
    setEntryOwner(next.user.id);
    setSession(next);
    setLoginNotice(null);
    setLoginEmail(null);
    writeStorage("session", EXPIRED_KEY, null);
    if (mode === "login") {
      // avisos da sessão anterior (ex.: "Você saiu da conta.") não seguem para a nova
      setToasts([]);
    }
    setLoadFailure(null);
    setDismissedAvisos(readDismissed(next.user.id));
    // busca, categorias e modo do Cronograma voltam como estavam (F5, ou a mesma pessoa depois da sessão vencida)
    const filters = readFilters(next.user.id);
    setSearch(filters?.search ?? "");
    setSelectedCategories(filters?.categories ?? allCategories);
    setCalendarMode(filters?.mode ?? "list");

    // tela e rascunho guardados (sessão vencida ou F5 no meio da edição): só valem para a mesma pessoa, e só saem
    // depois de aplicados (se outra conta entrar, continuam guardados para a dona)
    const resume = readResume(next.user.id);
    const role = next.user.role;
    let view: View;
    let eventId: number | null;
    let kept: HistoryEntry | null = null;
    // parâmetros da tela no endereço (só no F5): turma e aluno em Turmas, avaliação em Notas, aluno do responsável
    let params: Pick<HistoryEntry, "turma" | "membro" | "gradeEventId" | "aluno"> = {};
    if (mode === "login") {
      // quem entra começa no Painel: o endereço e as entradas de quem saiu não valem, a não ser na volta da mesma pessoa
      view = resume && canSee(resume.view, role) ? resume.view : "dashboard";
      eventId = view === "calendar" && resume ? resume.eventId : null;
      // a mesma pessoa voltando da sessão vencida: a entrada de antes (com o painel aberto) continua sendo dela
      const previous = resume ? currentEntry() : null;
      kept =
        previous && previous.uid === next.user.id && previous.view === view && (previous.eventId ?? null) === eventId
          ? previous
          : null;
    } else {
      const fromUrl = entryFromSearch(window.location.search, role);
      view = fromUrl.view;
      eventId = fromUrl.eventId;
      params = { turma: fromUrl.turma, membro: fromUrl.membro, gradeEventId: fromUrl.gradeEventId, aluno: fromUrl.aluno };
      // F5 (ou Voltar até uma entrada de antes do F5): mantém a entrada, a rolagem e o painel que estava aberto
      const previous = currentEntry();
      const own = previous && (previous.uid === undefined || previous.uid === next.user.id) ? previous : null;
      kept = own && own.view === view && (own.eventId ?? null) === eventId ? own : null;
    }
    // responsável: o aluno do endereço (F5) vale até a carga conferir que o vínculo dele está ativo
    studentRef.current = role === "guardian" ? (params.aluno ?? null) : null;
    setEntryStudent(studentRef.current ?? 0);
    setStudentChoice(studentRef.current);
    const entry = writeHistory("replace", {
      key: kept?.key ?? newEntryKey(),
      view,
      eventId,
      detail: kept?.detail,
      editar: kept?.editar,
      scrollY: kept?.scrollY,
      pos: kept?.pos,
      opener: kept?.opener,
      openerSpot: kept?.openerSpot,
      ...params,
    });
    setActiveView(view);
    setSelectedEventId(eventId);
    setReminderDraft(null);
    applyViewParams(view, params);
    scrollGuardRef.current = null;
    requestScroll(0);
    if (mode === "login") {
      setFocusHeadingToken((token) => token + 1);
    }
    pendingBootRef.current = {
      token: next.token,
      entryKey: entry.key,
      eventId,
      scrollY: kept?.scrollY,
      editar: kept?.editar,
      resume,
    };

    const loaded = await loadAll(next);
    if (!loaded.ok || sessionRef.current?.token !== next.token) {
      // a carga falhou: o Tentar de novo (ou o Atualizar dados) termina o que ficou pendente
      return;
    }
    if (mode === "login" && !resume?.editor) {
      const name = next.user.fullName ?? next.user.email;
      pushToast("success", `Boas-vindas, ${next.user.role === "admin" ? name : firstName(name)}!`);
    }
  }

  /** Primeira carga que deu certo depois de entrar ou do F5: rolagem, detalhe e o painel com o rascunho. */
  function finishBoot(loaded: LoadedData) {
    const pending = pendingBootRef.current;
    const active = sessionRef.current;
    if (!pending || !active || pending.token !== active.token) {
      return;
    }
    pendingBootRef.current = null;
    const { events: list, context: loadedContext } = loaded;
    const user = active.user;
    // a rolagem e o detalhe só valem se a pessoa ainda está na mesma entrada (ela pode ter trocado de tela na espera)
    const here = currentEntry()?.key === pending.entryKey;
    if (here) {
      if (pending.eventId !== null && !list.some((event) => event.id === pending.eventId)) {
        deselectInPlace();
        pushToast("info", EVENT_GONE);
      } else if (pending.scrollY) {
        requestScroll(pending.scrollY, true);
      }
    }
    if (liveRef.current.editorOpen) {
      // o painel já foi aberto durante a espera: o rascunho guardado fica para a próxima carga, sem se perder
      if (pending.resume?.editor) {
        pendingBootRef.current = { ...pending, eventId: null, scrollY: undefined, editar: undefined };
      }
      return;
    }
    const draft = pending.resume?.editor ?? null;
    if (draft) {
      writeStorage("session", resumeKey(user.id), null);
      if (draft.editingEventId !== null && !list.some((event) => event.id === draft.editingEventId)) {
        if (here && pending.editar !== undefined) {
          dropEditorEntry();
        }
        pushToast("danger", "O evento que você editava não existe mais. O rascunho não pôde ser mantido.");
        return;
      }
      const event =
        draft.editingEventId === null
          ? null
          : (list.find((item) => item.id === draft.editingEventId) ?? draft.editingEvent);
      openEditor(event, draft.form, draft.snapshot, !here);
      pushToast("info", "Seu rascunho foi mantido. Confira e salve.");
      return;
    }
    if (here && pending.editar !== undefined) {
      // F5 com o painel aberto e sem mudanças: o painel volta, com os dados de agora
      const target = pending.editar === "novo" ? null : (list.find((item) => item.id === pending.editar) ?? null);
      if (pending.editar === "novo" ? writesEvents(user.role) : target !== null && canManage(target, user, loadedContext)) {
        const form = target ? eventToForm(target) : createInitialEventForm(user.role, loadedContext);
        openEditor(target, form, form, false);
        return;
      }
      dropEditorEntry();
      if (pending.editar !== "novo" && target === null) {
        pushToast("info", EVENT_GONE);
      }
    }
  }

  /** A entrada de edição do F5 não vale mais (o evento sumiu ou saiu do alcance): volta para a de baixo. */
  function dropEditorEntry() {
    const current = currentEntry();
    if (current?.editar !== undefined) {
      popOwnEntry({ ...current, editar: undefined });
    }
  }

  function handleSession(next: Session) {
    writeStorage("local", SESSION_KEY, next);
    // a sessão venceu com uma camada leve aberta (ela não volta): a entrada dela sai antes, sem ficar repetida
    const entry = currentEntry();
    if (entry?.layer && entry.uid === next.user.id) {
      setEntryOwner(next.user.id);
      popOwnEntry({ ...entry, layer: undefined }, () => void startSession(next, "login"));
      return;
    }
    void startSession(next, "login");
  }

  function requestLogout() {
    if (editorOpen && dirty) {
      askDiscard(doLogout);
      return;
    }
    doLogout();
  }

  function doLogout() {
    const current = sessionRef.current;
    sessionRef.current = null;
    if (current) {
      void logout(current.token).catch(() => undefined);
      // quem sai de propósito leva o rascunho junto (o painel com mudanças já perguntou antes)
      writeStorage("session", resumeKey(current.user.id), null);
    }
    writeStorage("local", SESSION_KEY, null);
    writeStorage("session", EXPIRED_KEY, null);
    writeStorage("session", FILTERS_KEY, null);
    resetApp();
    setSession(null);
    markSignedOut();
    // os avisos da sessão que terminou (ex.: "Boas-vindas") não ficam na tela de entrada
    setToasts([]);
    pushToast("info", "Você saiu da conta.");
  }

  const onUnauthorized = useEffectEvent((token: string) => {
    const current = sessionRef.current;
    if (!current || current.token !== token) {
      return;
    }
    sessionRef.current = null;
    const pending = readResume(current.user.id);
    const resume: ResumeState =
      !editorOpen && pending?.editor
        ? pending // um 401 sem painel aberto (ex.: token velho ao carregar) não apaga o rascunho guardado
        : {
            userId: current.user.id,
            email: current.user.email,
            view: activeView,
            eventId: activeView === "calendar" ? selectedEventId : null,
            editor:
              editorOpen && formSnapshot
                ? {
                    editingEventId,
                    editingEvent: editingEvent ? { ...editingEvent, reminder: null } : null,
                    form: eventForm,
                    snapshot: formSnapshot,
                  }
                : null,
          };
    writeStorage("session", resumeKey(current.user.id), resume);
    // a tela de entrada vem com a conta de quem estava, também depois de um F5
    writeStorage("session", EXPIRED_KEY, { userId: current.user.id, email: current.user.email });
    writeStorage("local", SESSION_KEY, null);
    resetApp();
    setSession(null);
    // a tela de entrada explica a sessão vencida; os avisos dela (com Desfazer de outra sessão) saem
    setToasts([]);
    setLoginNotice(EXPIRED_NOTICE);
    setLoginEmail(current.user.email);
  });

  // rascunho do painel: guardado ao recarregar ou esconder a aba (no celular a aba pode ser descartada sem aviso)
  const saveDraft = useEffectEvent(() => {
    const active = sessionRef.current;
    if (!active || !editorOpen || !formSnapshot || pendingBootRef.current?.resume?.editor) {
      return;
    }
    if (!dirty) {
      // painel sem mudanças: um rascunho antigo não deve voltar no lugar dele
      writeStorage("session", resumeKey(active.user.id), null);
      return;
    }
    const draft: ResumeState = {
      userId: active.user.id,
      email: active.user.email,
      view: activeView,
      eventId: activeView === "calendar" ? selectedEventId : null,
      editor: {
        editingEventId,
        editingEvent: editingEvent ? { ...editingEvent, reminder: null } : null,
        form: eventForm,
        snapshot: formSnapshot,
      },
    };
    writeStorage("session", resumeKey(active.user.id), draft);
  });

  const boot = useEffectEvent(async () => {
    const stored = readSession();
    if (!stored) {
      writeStorage("local", SESSION_KEY, null);
      const expired = readExpired();
      if (expired) {
        setLoginNotice(EXPIRED_NOTICE);
        setLoginEmail(expired.email);
      }
      setBooting(false);
      return;
    }
    // F5 com uma camada leve aberta (menu, Preferências ou confirmação): ela não volta, e a entrada dela só
    // repetiria a de baixo; volta para a de baixo antes de começar
    const entry = currentEntry();
    if (entry?.layer && (entry.uid === undefined || entry.uid === stored.user.id)) {
      setEntryOwner(stored.user.id);
      popOwnEntry({ ...entry, layer: undefined }, () => {
        setBooting(false);
        void startSession(stored, "boot");
      });
      return;
    }
    // com a sessão salva já mostra a casca e o esqueleto enquanto os dados chegam
    setBooting(false);
    await startSession(stored, "boot");
  });

  useEffect(() => {
    window.history.scrollRestoration = "manual";
    // a árvore que o Next acabou de montar, antes de qualquer Voltar (o do boot inclusive)
    rememberRouterTree();
    let active = true;
    void Promise.resolve()
      .then(() => (active ? boot() : undefined))
      .catch(() => {
        writeStorage("local", SESSION_KEY, null);
        setBooting(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler((token) => onUnauthorized(token));
    // o servidor respondeu: o aviso de "sem conexão" de uma ação anterior já não vale
    setReachableHandler(() =>
      setToasts((list) => (list.some((toast) => toast.offline) ? list.filter((toast) => !toast.offline) : list))
    );
    // na captura: roda antes do Next, que só vê o Voltar se a entrada for deste documento
    const handlePop = (event: PopStateEvent) => {
      const claimed = claimOldEntry(event);
      const writes = urlWrites;
      try {
        onPopState(event);
      } finally {
        if (claimed && urlWrites === writes) {
          tellRouter();
        }
      }
    };
    // guarda a rolagem de cada entrada do histórico
    let saveTimer = 0;
    const handleScroll = () => {
      const guard = scrollGuardRef.current;
      if (guard && Date.now() <= guard.until && window.scrollY === 0) {
        scrollGuardRef.current = null;
        window.scrollTo({ top: guard.y, behavior: "instant" });
        return;
      }
      const key = currentEntry()?.key;
      if (!key) {
        return;
      }
      scrollByKeyRef.current.set(key, window.scrollY);
      // também na própria entrada, para valer depois de um F5
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        if (currentEntry()?.key === key) {
          patchCurrentEntry({ scrollY: window.scrollY });
        }
      }, 250);
    };
    // ao recarregar ou sair, a entrada atual leva a rolagem junto e o rascunho do painel fica guardado
    const handleHide = () => {
      patchCurrentEntry({ scrollY: window.scrollY });
      saveDraft();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        saveDraft();
      }
    };
    // na captura, antes de qualquer onClick: o clique que abre o detalhe já diz qual botão ou linha foi
    const handlePress = (event: MouseEvent) => {
      lastPress = event.target instanceof Element ? { target: event.target, at: performance.now() } : null;
    };
    window.addEventListener("click", handlePress, { capture: true });
    window.addEventListener("popstate", handlePop, { capture: true });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handleHide);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(saveTimer);
      setUnauthorizedHandler(null);
      setReachableHandler(null);
      lastPress = null;
      window.removeEventListener("click", handlePress, { capture: true });
      window.removeEventListener("popstate", handlePop, { capture: true });
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handleHide);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // busca, categorias e modo do Cronograma ficam na aba: depois de um F5 a tela volta como estava
  useEffect(() => {
    if (user) {
      const filters: StoredFilters = { userId: user.id, search, categories: selectedCategories, mode: calendarMode };
      writeStorage("session", FILTERS_KEY, filters);
    }
  }, [user, search, selectedCategories, calendarMode]);

  // funções do render de agora para quem chama depois: a carga em voo e as ações dos avisos
  useLayoutEffect(() => {
    afterLoadRef.current = (loaded, seq) => {
      // a primeira carga (entrada ou F5) já avisa do evento do endereço que não existe mais
      const booting = pendingBootRef.current !== null && pendingBootRef.current.token === sessionRef.current?.token;
      finishBoot(loaded);
      settleUnsureCreate(loaded.events, seq);
      if (!booting) {
        dropVanishedDetail(loaded.events);
      }
    };
    toastActionsRef.current = { openFromToast };
    panelFnsRef.current = { open: openPanelLayer, close: closePanelLayer };
  });

  // registro dos painéis das áreas (useBackLayer): o objeto não muda, e as funções são sempre as de agora
  const backLayers = useMemo<BackLayers>(
    () => ({
      open: (id, requestClose) => panelFnsRef.current?.open(id, requestClose),
      close: (id) => panelFnsRef.current?.close(id),
    }),
    []
  );

  // avisos do sistema chegam sem recarregar a agenda: confere a cada minuto, com a aba à vista
  useEffect(() => {
    if (!session) {
      return;
    }
    const timer = window.setInterval(() => {
      const active = sessionRef.current;
      if (!active || document.visibilityState !== "visible") {
        return;
      }
      getNotifications(active.token)
        .then((data) => {
          if (sessionRef.current?.token === active.token) {
            setNotices(data.notifications.filter((notice) => !notice.readAt));
            setUnreadCount(data.unreadCount);
          }
        })
        .catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [session]);

  // relógio dos avisos: um lembrete vira aviso quando a hora dele chega
  useEffect(() => {
    if (!session) {
      return;
    }
    const timer = window.setInterval(() => setReferenceNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [session]);

  // rascunho alterado: o navegador pergunta antes de fechar ou recarregar
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function refresh() {
    const active = sessionRef.current;
    if (!active) {
      return;
    }
    // falha não vira aviso solto: a faixa "Sem conexão" (ou a tela de erro) já explica
    const result = await loadAll(active);
    if (result.ok) {
      pushToast("info", "Dados atualizados.");
    }
  }

  function retryLoad() {
    const active = sessionRef.current;
    if (active) {
      void loadAll(active);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Perfil                                                            */
  /* ---------------------------------------------------------------- */
  async function saveProfile(form: ProfileFormState) {
    const active = sessionRef.current;
    if (!active || savingProfile) {
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await updateProfile(active.token, {
        fullName: form.fullName.trim() || null,
        defaultReminderMinutes: Number(form.defaultReminderMinutes),
      });
      const nextSession = { ...active, user: updated };
      sessionRef.current = nextSession;
      setSession(nextSession);
      writeStorage("local", SESSION_KEY, nextSession);
      closeProfile();
      pushToast("success", "Preferências salvas.", { keys: ["perfil"] });
    } catch (err) {
      actionFailed(err, active, "perfil");
    } finally {
      setSavingProfile(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */
  // um só ToastStack, no mesmo lugar da árvore na entrada e no app: as regiões de aviso não são recriadas
  const withToasts = (content: ReactNode) => (
    <>
      {content}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );

  if (booting) {
    return withToasts(
      <main className="grid min-h-screen place-items-center bg-app text-ink">
        <div className="pop flex flex-col items-center gap-4" role="status">
          <span className="mark">
            <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
          </span>
          <Spinner label="Carregando agenda..." />
        </div>
      </main>
    );
  }

  if (!session || !user) {
    return withToasts(<LoginScreen email={loginEmail} notice={loginNotice} onSession={handleSession} />);
  }

  // a contagem da busca do menu não depende de filtro escondido: fora do Cronograma vale para todas as categorias;
  // no Cronograma, segue os filtros que estão à vista; em Turmas e disciplinas, a tela conta o que achou
  const searchResultCount = search.trim()
    ? activeView === "calendar"
      ? filteredEvents.length
      : activeView === "classes"
        ? localSearchCount
        : searchedEvents.length
    : undefined;

  // avisos do sistema: no Painel, o card de avisos dos painéis só aparece com lembrete avisando; com só avisos do
  // sistema, a página mostra o mesmo card no lugar dele (o responsável sem vínculo vê só o card de vincular)
  const noticesOnlyCard =
    activeView === "dashboard" && !avisos.length && notices.length > 0 && !(isGuardian && !guardianStudent);

  const actions: AppActions = {
    token: session.token,
    user,
    role: user.role,
    context,
    events: joinedEvents,
    loading,
    toast: (text: string, options: AreaToastOptions = {}) =>
      pushToast(options.tone ?? "success", text, {
        action: options.undo
          ? { label: "Desfazer", onClick: () => void Promise.resolve(options.undo?.()) }
          : options.action,
        keys: options.key ? [options.key] : undefined,
        duration: options.duration,
      }),
    showError: (error: unknown, key?: string) => {
      const active = sessionRef.current;
      if (active) {
        actionFailed(error, active, key ?? "area");
      }
    },
    confirm: (options) =>
      setConfirm({
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        tone: options.tone,
        action: async () => {
          await options.action();
        },
      }),
    reload: async () => {
      const active = sessionRef.current;
      return active ? (await loadAll(active)).ok : false;
    },
    navigate,
    openEvent: (eventId: number) => navigate("calendar", { eventId }),
    openClasses: (target = {}) => navigate("classes", { classId: target.classId, memberId: target.memberId }),
    openGrades,
    openProfile: () => whenClear(openProfile),
    linkedStudents,
    student: guardianStudent,
    chooseStudent: (studentId: number) => chooseStudent(studentId),
    notices,
    unreadCount,
    readNotice,
    readAllNotices,
    openNotice,
    backLayers,
  };

  return withToasts(
    <AppActionsProvider value={actions}>
      <AppShell
        activeView={activeView}
        badges={{ reminders: avisos.length + unreadCount }}
        canWrite={canWrite}
        context={context}
        focusHeadingToken={focusHeadingToken}
        loadError={loadFailure?.message ?? null}
        menuOpen={menuOpen}
        refreshing={loading}
        search={search}
        searchInPlace={activeView === "calendar" || activeView === "classes"}
        searchResultCount={searchResultCount}
        searchScope={activeView === "classes" ? classesSearch : undefined}
        student={guardianStudent}
        students={activeStudents}
        updatedAt={lastLoadedAt}
        user={user}
        onChooseStudent={(studentId) => chooseStudent(studentId)}
        onLogout={requestLogout}
        onMenuChange={changeMenu}
        onNavigate={(view) => goTo(view)}
        onNewEvent={openNewEvent}
        onOpenProfile={openProfile}
        onRefresh={() => void refresh()}
        onSearchChange={setSearch}
        onSearchSubmit={showSearchResults}
      >
        {loadFailure && lastLoadedAt ? (
          <div className="callout amber" role="status">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {loadFailure.offline ? "Sem conexão." : "Não foi possível atualizar."} Mostrando dados de{" "}
              {formatTime(lastLoadedAt.toISOString())}.
            </span>
            {/* enquanto tenta, o foco fica no botão; se a carga der certo, a faixa sai e o foco vai ao título da tela */}
            <RetryButton className="link shrink-0" onRetry={() => void refresh()} retrying={loading} />
          </div>
        ) : null}

        {/* a chave reinicia a animação a cada troca de tela */}
        <div key={activeView} className="pop">
          {!lastLoadedAt ? (
            loadFailure ? (
              <section className="card pad" aria-label="Falha ao carregar">
                <ErrorState
                  title="Não foi possível carregar a agenda"
                  text={
                    loadFailure.offline
                      ? "O servidor não respondeu. Confira sua conexão. Se ele estava em repouso, pode levar até um minuto para voltar."
                      : loadFailure.message
                  }
                  onRetry={retryLoad}
                  retrying={loading}
                />
              </section>
            ) : (
              <PageSkeleton />
            )
          ) : (
            <>
              {noticesOnlyCard ? (
                <div className="mb-5">
                  <AvisosCard avisos={[]} events={upcomingEvents} onDismiss={dismissAviso} onOpen={selectEvent} />
                </div>
              ) : null}

              {activeView === "dashboard" && user.role === "guardian" ? (
                guardianStudent ? (
                  <GuardianDashboard
                    avisos={avisos}
                    context={context}
                    defaultReminderMinutes={user.defaultReminderMinutes}
                    events={joinedEvents}
                    reminders={remindersWithEvents}
                    savingReminder={savingReminder}
                    student={guardianStudent}
                    upcomingEvents={upcomingEvents}
                    onDismissAviso={dismissAviso}
                    onOpenCalendar={openCalendar}
                    onOpenGrades={(eventId) => goTo("grades", { gradeEventId: eventId ?? null })}
                    onOpenReminders={() => goTo("reminders")}
                    onQuickReminder={quickReminder}
                    onSelect={selectEvent}
                  />
                ) : (
                  // sem vínculo ativo, o Painel do responsável é só o card de vincular
                  <GuardianLinkCard pendingStudents={pendingStudents} onLinked={() => void actions.reload()} />
                )
              ) : null}

              {activeView === "dashboard" && user.role === "student" ? (
                <StudentDashboard
                  avisos={avisos}
                  context={context}
                  defaultReminderMinutes={user.defaultReminderMinutes}
                  events={joinedEvents}
                  reminders={remindersWithEvents}
                  savingReminder={savingReminder}
                  upcomingEvents={upcomingEvents}
                  onDismissAviso={dismissAviso}
                  onOpenCalendar={openCalendar}
                  onOpenReminders={() => goTo("reminders")}
                  onQuickReminder={quickReminder}
                  onSelect={selectEvent}
                />
              ) : null}

              {activeView === "dashboard" && user.role === "teacher" ? (
                <TeacherDashboard
                  avisos={avisos}
                  context={context}
                  events={joinedEvents}
                  lastSavedId={lastSavedId}
                  manageableEvents={manageableEvents}
                  officialUpcoming={officialUpcoming}
                  referenceNow={referenceNow}
                  savedTick={savedTick}
                  upcomingEvents={upcomingEvents}
                  onDismissAviso={dismissAviso}
                  onEdit={beginEdit}
                  onNewEvent={openNewEvent}
                  onNewEventFor={openNewEventFor}
                  onOpenCalendar={openCalendar}
                  onOpenManage={() => goTo("manage")}
                  onSelect={selectEvent}
                />
              ) : null}

              {activeView === "dashboard" && user.role === "admin" ? (
                <AdminDashboard
                  avisos={avisos}
                  context={context}
                  events={joinedEvents}
                  imports={imports}
                  lastSavedId={lastSavedId}
                  officialUpcoming={officialUpcoming}
                  savedTick={savedTick}
                  upcomingEvents={upcomingEvents}
                  onDismissAviso={dismissAviso}
                  onNewEvent={openNewEvent}
                  onOpenCalendar={openCalendar}
                  onOpenSync={() => goTo("sync")}
                  onSelect={selectEvent}
                />
              ) : null}

              {activeView === "calendar" ? (
                <CalendarView
                  allEvents={searchedEvents}
                  calendarMode={calendarMode}
                  canManageEvent={canManageEvent}
                  classes={context?.catalog.classes ?? []}
                  events={filteredEvents}
                  reminderOffset={reminderOffset}
                  role={user.role}
                  saving={savingReminder || statusBusy !== null}
                  search={search}
                  selectedCategories={selectedCategories}
                  selectedEvent={selectedEvent}
                  selectedEventId={selectedEventId}
                  setCalendarMode={setCalendarMode}
                  setCategories={setSelectedCategories}
                  setReminderOffset={setReminderOffset}
                  setSearch={setSearch}
                  studentName={guardianStudent ? firstName(guardianStudent.fullName ?? "Aluno") : null}
                  toggleCategory={toggleCategory}
                  onDelete={requestDeleteEvent}
                  onEdit={beginEdit}
                  onRemoveReminder={removeReminderFromEvent}
                  onSaveReminder={() => void handleSaveReminder()}
                  onSelect={selectEvent}
                  onSetStatus={requestStatusChange}
                />
              ) : null}

              {activeView === "manage" ? (
                <ManageView
                  allEvents={joinedEvents}
                  canWrite={canWrite}
                  context={context}
                  editingEventId={editorOpen ? editingEventId : null}
                  isAdmin={isAdmin}
                  lastSavedId={lastSavedId}
                  manageableEvents={manageableEvents}
                  role={user.role}
                  savedTick={savedTick}
                  saving={savingEvent || statusBusy !== null}
                  search={search}
                  onDelete={requestDeleteEvent}
                  onEdit={beginEdit}
                  onNewEvent={openNewEvent}
                  onNewEventFor={openNewEventFor}
                  onOpenGrades={openGrades}
                  onSetStatus={requestStatusChange}
                />
              ) : null}

              {activeView === "grades" ? (
                <GradesView
                  context={context}
                  events={gradableEvents}
                  focusEventId={gradeFocus}
                  role={user.role}
                  search={search}
                  student={guardianStudent}
                  onOpenEvent={(eventId) => goTo("calendar", { eventId })}
                  onOpenGrades={openGrades}
                />
              ) : null}

              {activeView === "classes" ? (
                <ClassesView
                  context={context}
                  search={search}
                  target={classesTarget}
                  onSearchCount={setLocalSearchCount}
                  onTargetHandled={handleClassesTarget}
                />
              ) : null}

              {activeView === "reminders" ? (
                <RemindersView
                  avisos={avisos}
                  defaultReminderMinutes={user.defaultReminderMinutes}
                  reminders={remindersWithEvents}
                  saving={savingReminder}
                  upcomingEvents={upcomingEvents}
                  onChangeOffset={changeReminderOffset}
                  onDelete={(reminder) => void removeReminderRecord(reminder)}
                  onDismissAviso={dismissAviso}
                  onOpenCalendar={openCalendar}
                  onOpenEvent={selectEvent}
                  onOpenProfile={openProfile}
                  onQuickReminder={quickReminder}
                />
              ) : null}

              {activeView === "sync" ? (
                <SyncView
                  demoPayload={demoPayload}
                  events={joinedEvents}
                  imports={imports}
                  isAdmin={isAdmin}
                  saving={importing}
                  onImport={runImport}
                  onOpenCalendar={openCalendar}
                  onUndoImport={undoImport}
                />
              ) : null}
            </>
          )}
        </div>
      </AppShell>

      <EventEditor
        allEvents={joinedEvents}
        context={context}
        dirty={dirty}
        editingEvent={editingEvent}
        form={eventForm}
        open={editorOpen}
        role={user.role}
        saving={savingEvent}
        serverErrors={visibleServerErrors}
        setForm={changeEventForm}
        statusBusy={statusBusy !== null}
        statusNotice={editorStatusNotice}
        onClose={requestCloseEditor}
        onDelete={requestDeleteEvent}
        onSetStatus={requestStatusChange}
        onSubmit={() => void saveEvent()}
      />

      {writesEvents(user.role) ? (
        <EventGradesDrawer
          event={gradesEventId === null ? null : (eventsById.get(gradesEventId) ?? null)}
          eventId={gradesEventId}
          onChanged={() => void actions.reload()}
          onClose={() => setGradesEventId(null)}
        />
      ) : null}

      {profileOpen ? (
        <ProfileModal
          saving={savingProfile}
          user={user}
          onClose={closeProfile}
          onSave={(form) => void saveProfile(form)}
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          confirm={confirm}
          busy={confirmBusy}
          onCancel={closeConfirm}
          onConfirm={() => runConfirm(confirm)}
        />
      ) : null}
    </AppActionsProvider>
  );
}
