import { isTimeoutError } from "./api";
import {
  enrollmentSourceLabels,
  enrollmentStatusLabels,
  gradeImportSourceLabels,
  gradeStatusLabels,
  linkOriginLabels,
  linkStatusLabels,
  relationshipLabels,
} from "./meta";
import type {
  AcademicClass,
  AcademicEvent,
  Category,
  Course,
  EnrollmentSource,
  EnrollmentStatus,
  Grade,
  GradeSourceInfo,
  GuardianLinkOrigin,
  GuardianLinkStatus,
  GuardianRelationship,
} from "./types";

export function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateLong(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDayMonth(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatFullDate(value: Date) {
  return value.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "hoje", "amanhã", "em 5 dias", "ontem", "há 3 dias". Não repete a data, que já aparece ao lado. */
export function relativeDue(value: string) {
  const diff = startOfDay(new Date(value)).getTime() - startOfDay(new Date()).getTime();
  const days = Math.round(diff / (24 * 60 * 60 * 1000));

  if (days < 0) {
    return days === -1 ? "ontem" : `há ${Math.abs(days)} dias`;
  }
  if (days === 0) {
    return "hoje";
  }
  if (days === 1) {
    return "amanhã";
  }
  return `em ${days} dias`;
}

export function toDateTimeLocal(value: Date) {
  const offset = value.getTimezoneOffset();
  const local = new Date(value.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function addDays(value: Date, days: number) {
  // Aritmética de calendário (não epoch): dias com horário de verão não têm
  // 24h e somar milissegundos desalinharia a grade do mês.
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, value.getHours(), value.getMinutes());
}

export function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(value: Date) {
  return isSameDay(value, new Date());
}

/**
 * Um evento ocorre num dia se o dia estiver entre startsAt e endsAt (inclusive).
 * Término às 00:00 não conta o dia: "até 16/11 00:00" acaba no dia 15.
 */
export function eventOccursOn(event: AcademicEvent, day: Date) {
  const dayStart = startOfDay(day).getTime();
  const startDate = new Date(event.startsAt);
  const eventStart = startOfDay(startDate).getTime();
  let eventEnd = eventStart;
  if (event.endsAt) {
    const endDate = new Date(event.endsAt);
    eventEnd = startOfDay(endDate).getTime();
    if (endDate.getHours() === 0 && endDate.getMinutes() === 0 && endDate.getTime() > startDate.getTime()) {
      eventEnd = Math.max(eventStart, startOfDay(addDays(endDate, -1)).getTime());
    }
  }
  return dayStart >= eventStart && dayStart <= eventEnd;
}

export type CalendarCell = {
  date: Date;
  inMonth: boolean;
  today: boolean;
  events: AcademicEvent[];
};

/**
 * Matriz do mês para a grade de calendário: semanas completas (dom-sáb)
 * cobrindo o mês inteiro, com os eventos de cada dia.
 */
export function buildMonthMatrix(year: number, month: number, events: AcademicEvent[]): CalendarCell[][] {
  const firstOfMonth = new Date(year, month, 1);
  const start = addDays(firstOfMonth, -firstOfMonth.getDay());
  const weeks: CalendarCell[][] = [];
  let cursor = start;

  do {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const date = cursor;
      week.push({
        date,
        inMonth: date.getMonth() === month,
        today: isToday(date),
        events: events
          .filter((event) => eventOccursOn(event, date))
          .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month);

  return weeks;
}

export const weekdayLabels = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function monthTitle(year: number, month: number) {
  const label = new Date(year, month, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const honorifics = new Set(["prof.", "prof", "profa.", "profa", "dr.", "dra.", "sr.", "sra."]);

export function firstName(value: string) {
  const parts = value.trim().split(/\s+/);
  // Pula títulos ("Profa. Maraísa" → "Maraísa") para a saudação soar natural.
  return parts.find((part) => !honorifics.has(part.toLowerCase())) ?? parts[0] ?? value;
}

/* ------------------------------------------------------------------ */
/* Mensagens de erro em português                                      */
/* ------------------------------------------------------------------ */

// Mensagens da API (em inglês ou sem acento) trocadas pelo texto que a pessoa lê.
const apiMessages: Record<string, string> = {
  "Invalid user credentials": "E-mail ou senha incorretos.",
  "Unauthorized access": "Sua sessão expirou. Entre de novo.",
  "Evento nao encontrado.": "Esse evento não existe mais. Ele pode ter sido removido.",
  "Voce nao tem acesso a este evento.": "Você não tem acesso a esse evento.",
  "Alunos nao podem criar eventos academicos.": "Alunos não podem publicar eventos.",
  "Categorias institucionais sao restritas a administracao.":
    "Institucional, feriado e recesso são publicados só pela administração.",
  "Professor so pode criar eventos das turmas que ministra.": "Você só pode publicar para as turmas em que dá aula.",
  "Professor so pode mover eventos para turmas que ministra.":
    "Você só pode mover o evento para turmas em que dá aula.",
  "Data do evento em formato invalido.": "A data do evento não está num formato válido.",
  "Voce nao pode editar este evento.": "Você não pode editar esse evento.",
  "Voce nao pode excluir este evento.": "Você não pode excluir esse evento.",
  "Periodo informado em formato invalido.": "O período informado não está num formato válido.",
  "Voce nao pode criar lembrete para este evento.": "Você não pode criar lembrete para esse evento.",
  "Lembrete nao encontrado.": "Esse lembrete não existe mais.",
  "Apenas administradores visualizam importacoes.": "Só a administração vê as importações.",
  "Apenas administradores importam calendario oficial.": "Só a administração importa o calendário oficial.",
  "Uma ou mais datas da importacao estao invalidas.": "Uma ou mais datas da importação não estão num formato válido.",
};

// Reserva por situação HTTP, quando a mensagem da API não é conhecida.
const statusMessages: Record<number, string> = {
  0: "Não foi possível conectar ao servidor. Confira sua conexão e tente de novo.",
  400: "Não deu para concluir. Confira os dados e tente de novo.",
  401: "Sua sessão expirou. Entre de novo.",
  403: "Você não tem permissão para fazer isso.",
  404: "Não encontramos o que você procurava. Pode ter sido removido.",
  409: "Isso já foi registrado antes.",
  422: "Confira os campos e tente de novo.",
  429: "Muitas tentativas seguidas. Espere um pouco e tente de novo.",
  500: "O servidor teve um problema. Tente de novo em instantes.",
};

// Nome de cada campo da API como aparece na frase ("o título", "a senha").
const fieldNames: Record<string, string> = {
  title: "o título",
  description: "a descrição",
  category: "a categoria",
  startsAt: "o início",
  endsAt: "o término",
  points: "a pontuação",
  location: "o local",
  academicClassId: "a turma",
  subjectId: "a disciplina",
  status: "a situação",
  color: "a cor",
  source: "a origem",
  email: "o e-mail",
  password: "a senha",
  passwordConfirmation: "a confirmação da senha",
  fullName: "o nome",
  registration: "a matrícula",
  role: "o perfil",
  academicEventId: "o evento",
  channel: "o canal do aviso",
  notificationChannel: "o canal do aviso",
  offsetMinutes: "a antecedência",
  defaultReminderMinutes: "o lembrete padrão",
  enabled: "a opção de ativar",
  sourceName: "o nome da fonte",
  sourceUrl: "o endereço da fonte",
  checksum: "a identificação do arquivo",
  sourceExternalId: "o código na fonte",
  events: "a lista de datas",
  // fase 1: cursos, turmas, disciplinas, ofertas e alunos da turma
  name: "o nome",
  code: "o código",
  campus: "o campus",
  modality: "a modalidade",
  courseId: "o curso",
  year: "o ano",
  semester: "o semestre",
  shift: "o turno",
  period: "o período",
  workloadHours: "a carga horária",
  teacherId: "a docente",
  userId: "o aluno",
  emails: "a lista de e-mails",
  enrollmentIds: "os pedidos",
  q: "a busca",
  // fase 2: responsável
  relationship: "o parentesco",
  reason: "o motivo",
  shareGrades: "o compartilhamento das notas",
  confirm: "a confirmação",
  isMinor: "a marcação de menor de idade",
  studentId: "o aluno",
  unblock: "o desbloqueio",
  // fase 3: notas
  score: "a nota",
  eventId: "a avaliação",
  fileName: "o nome do arquivo",
  fileModifiedAt: "a data do arquivo",
  mapping: "as colunas",
  identifierType: "o tipo de identificação do aluno",
  identifierColumn: "a coluna do aluno",
  scoreColumn: "a coluna da nota",
  nameColumn: "a coluna do nome",
  rows: "as linhas",
  rowNumber: "o número da linha",
  identifier: "o e-mail ou a matrícula",
  keepAgendaWhenNewer: "a opção de manter as notas da Agenda",
};

/** Nome do campo da API como aparece numa frase ("o curso", "a nota"). Campo desconhecido: "este campo". */
export function fieldLabel(field: string) {
  return fieldNames[field] ?? "este campo";
}

const minuteFields = new Set(["offsetMinutes", "defaultReminderMinutes"]);

type FieldErrorLike = { field?: string; rule?: string; message?: string; meta?: Record<string, unknown> };
type ErrorLike = { message?: string; status?: number; errors?: FieldErrorLike[] };

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function minutesText(value: unknown) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return String(value);
  if (minutes % 1440 === 0) return `${minutes / 1440} dia${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hora${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutos`;
}

/**
 * A frase já veio em português da API (validadores novos: "Código inválido ou expirado. Confira com quem passou o
 * código.", "A nota precisa estar entre 0 e 10.")? Os validadores antigos mandam o padrão do VineJS, em inglês.
 */
export function isPortugueseMessage(value: string | null | undefined) {
  const text = (value ?? "").trim();
  if (!text) return false;
  return (
    /[áàâãéêíóôõúç]/i.test(text) ||
    /\b(campo|preencha|informe|escolha|precisa|envie|confira|deixe|nenhum|nenhuma|linha|turma|aluno|nota)\b/i.test(text)
  );
}

/** Frase de um erro de validação: a da API, se já veio em português; senão, montada a partir do campo e da regra. */
function validationMessage(item: FieldErrorLike) {
  if (isPortugueseMessage(item.message)) {
    return item.message!.trim();
  }
  const path = item.field ?? "";
  // itens de lista chegam como "events.0.title"
  const nested = /^events\.(\d+)\.(\w+)$/.exec(path);
  const key = nested ? nested[2] : path;
  const name = fieldNames[key] ?? "este campo";
  const Name = capitalize(name);
  const meta = item.meta ?? {};
  let text: string;
  switch (item.rule) {
    case "required":
      text = `Preencha ${name}.`;
      break;
    case "minLength":
      text = `${Name} precisa ter pelo menos ${meta.min} caracteres.`;
      break;
    case "maxLength":
      text = `${Name} pode ter no máximo ${meta.max} caracteres.`;
      break;
    case "enum":
      text = key === "category" ? "Escolha uma categoria da lista." : `${Name} tem um valor que não é aceito.`;
      break;
    case "number":
      text = `${Name} precisa ser um número.`;
      break;
    case "min":
      text = minuteFields.has(key)
        ? `${Name} precisa ser de pelo menos ${minutesText(meta.min)}.`
        : `${Name} precisa ser no mínimo ${meta.min}.`;
      break;
    case "max":
      text = minuteFields.has(key)
        ? `${Name} pode ser de no máximo ${minutesText(meta.max)}.`
        : `${Name} pode ser no máximo ${meta.max}.`;
      break;
    case "email":
      text = "Digite um e-mail válido.";
      break;
    case "sameAs":
      text = "As senhas não são iguais.";
      break;
    case "database.unique":
      text = key === "email" ? "Este e-mail já tem conta. Entre ou use outro e-mail." : `${Name} já está em uso.`;
      break;
    case "string":
      text = `${Name} precisa ser um texto.`;
      break;
    case "array":
      text = `${Name} precisa ser uma lista.`;
      break;
    default:
      text = `Confira ${name}.`;
  }
  // "events.N" só vem da importação, que chama os itens de "datas"
  return nested ? `Data ${Number(nested[1]) + 1}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** Texto do erro para a pessoa: validação, mensagem conhecida da API ou reserva pela situação. */
export function errorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "Algo deu errado. Tente de novo.";
  // o prazo estourado também tem situação 0, mas não é falta de conexão: fica com a frase dele
  if (isTimeoutError(error)) return error.message;
  const err = error as ErrorLike & { code?: unknown };
  const validation = err.errors?.find((item) => item.rule);
  if (validation) return validationMessage(validation);
  const raw = err.message ?? "";
  if (apiMessages[raw]) return apiMessages[raw];
  // 409 e 429 com código (ARCHIVED_DUPLICATE, HAS_DEPENDENTS, LINK_LIMIT, TOO_MANY_ATTEMPTS...): a frase da API diz
  // o que aconteceu e como sair; nunca o genérico "Isso já foi registrado antes."
  if ((err.status === 409 || err.status === 429) && typeof err.code === "string" && raw) return raw;
  // as rotas novas respondem 403, 404, 409 e 429 com frases em português ("Turma não encontrada.", "Este vínculo foi
  // feito pela secretaria..."): elas valem mais que a reserva genérica
  if (typeof err.status === "number" && err.status >= 403 && err.status < 500 && err.status !== 422 && isPortugueseMessage(raw)) {
    return raw;
  }
  if (typeof err.status === "number") {
    // erro que veio da API sem tradução conhecida
    return statusMessages[err.status] ?? (err.status >= 500 ? statusMessages[500] : "Algo deu errado. Tente de novo.");
  }
  return raw || "Algo deu errado. Tente de novo.";
}

/** Erros de validação por campo da API ({ title: "O título precisa ter..." }). */
export function fieldErrors(error: unknown) {
  const items = (error as ErrorLike | null)?.errors ?? [];
  const result: Record<string, string> = {};
  for (const item of items) {
    if (item.field && item.rule && !result[item.field]) {
      result[item.field] = validationMessage(item);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Busca                                                               */
/* ------------------------------------------------------------------ */

/** Texto sem acento e em minúsculas, para comparar "matematica" com "Matemática". */
export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

// Nome da categoria como a pessoa digita na busca.
const categorySearchNames: Record<Category, string> = {
  exam: "prova provas",
  assignment: "trabalho trabalhos",
  activity: "atividade atividades",
  extracurricular: "extracurricular extracurriculares",
  institutional: "institucional institucionais",
  holiday: "feriado feriados",
  recess: "recesso recessos",
};

/** O evento tem todas as palavras do termo (título, descrição, disciplina, professor, turma, local ou categoria). */
export function matchesSearch(event: AcademicEvent, term: string) {
  const words = normalizeText(term).split(/\s+/).filter(Boolean);
  if (!words.length) {
    return true;
  }
  const haystack = normalizeText(
    [
      event.title,
      event.description,
      event.subject?.name,
      event.teacher?.fullName,
      event.academicClass?.name,
      event.location,
      categorySearchNames[event.category],
      event.officialPriority || event.source !== "teacher" ? "oficial" : null,
    ]
      .filter(Boolean)
      .join(" ")
  );
  return words.every((word) => haystack.includes(word));
}

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Peças de data do visual do Figma                                    */
/* ------------------------------------------------------------------ */

const shortWeekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const shortMonths = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "Sex", "26", "Jun": blocos de data das listas e do destaque. */
export function dateParts(value: string) {
  const date = new Date(value);
  return {
    weekday: shortWeekdays[date.getDay()],
    day: String(date.getDate()).padStart(2, "0"),
    month: shortMonths[date.getMonth()],
  };
}

/** "qua, 04/11, às 19:00". Mantido por compatibilidade: em frase, use formatOnDayAt. */
export function formatDayTime(value: string | Date) {
  const date = new Date(value);
  return `${formatShortDate(date)}, às ${clock(date)}`;
}

const two = (value: number) => String(value).padStart(2, "0");
const clock = (date: Date) => `${two(date.getHours())}:${two(date.getMinutes())}`;
const weekdayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/* Datas do glossário: em rótulo curto, o formato das listas ("qua, 04/11, 19:00");
   em frase, o dia da semana por extenso com o artigo certo ("na quarta, 04/11, às 19:00"). */

/** "qua, 04/11" */
export function formatShortDate(value: string | Date) {
  const date = new Date(value);
  return `${shortWeekdays[date.getDay()].toLowerCase()}, ${two(date.getDate())}/${two(date.getMonth() + 1)}`;
}

/** "qua, 04/11, 19:00" */
export function formatShortDateTime(value: string | Date) {
  const date = new Date(value);
  return `${formatShortDate(date)}, ${clock(date)}`;
}

/** Dia da semana por extenso com o artigo: "a quarta, 04/11" ou "o domingo, 08/11" (para "até a ..."). */
export function formatWeekday(value: string | Date) {
  const date = new Date(value);
  // sábado e domingo são masculinos; os outros dias, femininos
  const article = date.getDay() === 0 || date.getDay() === 6 ? "o" : "a";
  return `${article} ${weekdayNames[date.getDay()]}, ${two(date.getDate())}/${two(date.getMonth() + 1)}`;
}

/** "na quarta, 04/11" ou "no domingo, 08/11" */
export function formatOnDay(value: string | Date) {
  // "n" + "a quarta" = "na quarta"; "n" + "o domingo" = "no domingo"
  return `n${formatWeekday(value)}`;
}

/** "na quarta, 04/11, às 19:00" ou "no domingo, 08/11, às 19:00" (ex.: quando um aviso sai). */
export function formatOnDayAt(value: string | Date) {
  return `${formatOnDay(value)}, às ${clock(new Date(value))}`;
}

/** "2026-11-01" no fuso local (para chaves por dia). */
export function localDateKey(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Dias corridos entre hoje e a data (negativo = passado). */
export function daysUntil(value: string) {
  const diff = startOfDay(new Date(value)).getTime() - startOfDay(new Date()).getTime();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

/** Começa à meia-noite (feriados e semanas acadêmicas). Para "Dia todo", use isWholeDay, que olha o término. */
export function isAllDay(value: string) {
  const date = new Date(value);
  return date.getHours() === 0 && date.getMinutes() === 0;
}

/**
 * "Dia todo": começa à meia-noite e não tem horário de término (sem término, ou término às
 * 00:00 ou às 23:59, que é como o dia inteiro é marcado). "00:00 até 10:00" mostra os horários.
 */
export function isWholeDay(startsAt: string, endsAt?: string | null) {
  if (!isAllDay(startsAt)) {
    return false;
  }
  if (!endsAt) {
    return true;
  }
  const end = new Date(endsAt);
  const minutes = end.getHours() * 60 + end.getMinutes();
  return minutes === 0 || minutes === 23 * 60 + 59;
}

/** "1d 11h 18m" até o início. */
export function countdown(value: string, now = new Date()) {
  const ms = new Date(value).getTime() - now.getTime();
  if (ms <= 0) {
    return "agora";
  }
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return `${days ? `${days}d ` : ""}${hours}h ${String(rest).padStart(2, "0")}m`;
}

/** Turno com a inicial maiúscula, como no Figma: "noturno" vira "Noturno". */
export function shiftLabel(value?: string | null) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : null;
}

/** "2 nov a 6 nov": intervalo de dias nos títulos de semana (Figma). */
export function dayMonthRange(start: Date, end: Date) {
  const label = (date: Date) => `${date.getDate()} ${shortMonths[date.getMonth()].toLowerCase()}`;
  return `${label(start)} a ${label(end)}`;
}

/** Agrupa eventos futuros em "Esta semana", "Próxima semana, 29 jun a 5 jul" e "Mais adiante". */
export function groupByWeek<T extends { startsAt: string }>(items: T[], now = new Date()) {
  const today = startOfDay(now);
  const nextWeekStart = addDays(today, 7 - today.getDay());
  const nextWeekEnd = addDays(nextWeekStart, 6);
  const range = dayMonthRange(nextWeekStart, nextWeekEnd);
  const groups: Array<{ label: string; items: T[] }> = [
    { label: "Esta semana", items: [] },
    { label: `Próxima semana, ${range}`, items: [] },
    { label: "Mais adiante", items: [] },
  ];
  for (const item of items) {
    const day = startOfDay(new Date(item.startsAt));
    const index = day < nextWeekStart ? 0 : day <= nextWeekEnd ? 1 : 2;
    groups[index].items.push(item);
  }
  return groups.filter((group) => group.items.length);
}

/* ------------------------------------------------------------------ */
/* Contagens e códigos                                                 */
/* ------------------------------------------------------------------ */

/** "1 turma", "3 turmas", "0 pedidos". */
export function countText(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "04/11/2026". */
export function formatDateBR(value: string | Date) {
  const date = new Date(value);
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Código como a pessoa digitou ("tads 5k7q", "TADS-5K7Q") no formato que a API compara: maiúsculo, sem espaço nem hífen. */
export function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

/** "K7QM3XPD" vira "K7QM-3XPD" (prefira o codeFormatted ou joinCodeFormatted que a API manda). */
export function formatCode(value: string) {
  const clean = normalizeCode(value);
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/** Espera do 429 numa frase: "Tente de novo em 15 minutos." (retryAfter vem em segundos). */
export function retryAfterText(seconds?: number | null) {
  if (!seconds || seconds <= 0) {
    return "Espere alguns minutos e tente de novo.";
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "Tente de novo em 1 minuto." : `Tente de novo em ${minutes} minutos.`;
}

/* ------------------------------------------------------------------ */
/* Turmas: período letivo (turma anual sem "/0")                       */
/* ------------------------------------------------------------------ */

/** Turma anual do curso integrado: o semestre é 0. */
export function isAnnualClass(value: Pick<AcademicClass, "semester">) {
  return !value.semester;
}

/** Curso integrado: a turma é anual e o campo semestre some do formulário. */
export function isIntegratedCourse(course?: Pick<Course, "modality"> | null) {
  return course?.modality === "integrado";
}

/**
 * Período letivo da turma: "2026/2". Turma anual: "2026" (ou "2026, anual" com long). Nunca "2026/0".
 * Serve também para chaves e filtros ("Todos os períodos").
 */
export function classTermLabel(value: Pick<AcademicClass, "year" | "semester">, options: { long?: boolean } = {}) {
  if (isAnnualClass(value)) {
    return options.long ? `${value.year}, anual` : String(value.year);
  }
  return `${value.year}/${value.semester}`;
}

/**
 * O semestre mais recente entre as turmas ("2026/2"), sem contar as anuais (o 0 não é semestre). Sem turma
 * semestral, o semestre do dia (1 até junho, 2 depois). Serve para "semestre atual" no Painel e nos filtros.
 */
export function latestTermLabel(classes: Array<Pick<AcademicClass, "year" | "semester">>, now = Date.now()) {
  let latest: Pick<AcademicClass, "year" | "semester"> | null = null;
  for (const item of classes) {
    if (!item.semester) {
      continue;
    }
    if (!latest || item.year > latest.year || (item.year === latest.year && item.semester > latest.semester)) {
      latest = item;
    }
  }
  if (latest) {
    return `${latest.year}/${latest.semester}`;
  }
  const today = new Date(now);
  return `${today.getFullYear()}/${today.getMonth() < 6 ? 1 : 2}`;
}

/** "TADS 5, 2026/2" ou "INF 3A, 2026". */
export function classLabel(value: Pick<AcademicClass, "name" | "year" | "semester">) {
  return `${value.name}, ${classTermLabel(value)}`;
}

/** "5º período, noturno" (período e turno da turma, como na lista de turmas). */
export function classPeriodLine(value: Pick<AcademicClass, "period" | "shift">) {
  return [value.period, value.shift ? value.shift.toLocaleLowerCase("pt-BR") : null].filter(Boolean).join(", ");
}

/* ------------------------------------------------------------------ */
/* Responsável e matrícula                                             */
/* ------------------------------------------------------------------ */

/** "Mãe", "Pai", "Responsável legal", "Outro". */
export function relationshipText(value: GuardianRelationship | string | null | undefined) {
  return relationshipLabels[value as GuardianRelationship] ?? relationshipLabels.outro;
}

/** "Ativo", "Aguardando a secretaria", "Desfeito", "Bloqueado". */
export function linkStatusText(value: GuardianLinkStatus | string) {
  return linkStatusLabels[value as GuardianLinkStatus] ?? value;
}

/** "Código do aluno", "Código da secretaria", "Vinculado pela secretaria". */
export function linkOriginText(value: GuardianLinkOrigin | string) {
  return linkOriginLabels[value as GuardianLinkOrigin] ?? value;
}

/** "Ativa", "Pedido pendente", "Inativa", "Concluída". */
export function enrollmentStatusText(value: EnrollmentStatus | string) {
  return enrollmentStatusLabels[value as EnrollmentStatus] ?? value;
}

/** "Código da turma", "Convite da turma", "Lista de e-mails", "Incluído pela secretaria". */
export function enrollmentSourceText(value: EnrollmentSource | string) {
  return enrollmentSourceLabels[value as EnrollmentSource] ?? value;
}

/** "Mãe, desde 02/11/2026". */
export function linkSinceText(relationship: GuardianRelationship | string, since?: string | null) {
  return since ? `${relationshipText(relationship)}, desde ${formatDateBR(since)}` : relationshipText(relationship);
}

/* ------------------------------------------------------------------ */
/* Notas (centésimos e vírgula decimal)                                */
/* ------------------------------------------------------------------ */

/** Centésimos para texto com vírgula: 750 vira "7,5", 1000 vira "10", 725 vira "7,25". Sem valor: "". */
export function formatScore(hundredths: number | null | undefined) {
  if (hundredths === null || hundredths === undefined || !Number.isFinite(hundredths)) {
    return "";
  }
  return (hundredths / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false });
}

/**
 * Nota digitada para centésimos: "7,5" e "7.5" viram 750, "10" vira 1000. Vazio: null (nunca vira zero).
 * Texto que não é número, negativo ou com mais de duas casas: NaN (mostre o erro abaixo do campo).
 */
export function parseScore(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : Number.NaN;
  }
  const text = value.trim().replace(/\s+/g, "");
  if (!text) {
    return null;
  }
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) {
    return Number.NaN;
  }
  return Math.round(Number(text.replace(",", ".")) * 100);
}

/** Centésimos, ou o texto da API ("9", "7,5"), para centésimos. Sem valor ou texto que não é nota: null. */
function scoreHundredths(value: number | string | null | undefined) {
  const hundredths = typeof value === "number" ? value : parseScore(value);
  return hundredths === null || !Number.isFinite(hundredths) ? null : hundredths;
}

/**
 * Nota que o aluno e o responsável veem (tela Notas e cards de notas): sempre com uma casa e vírgula, 900 vira
 * "9,0" e 750 vira "7,5"; com centésimos, as duas casas (725 vira "7,25"). Aceita centésimos ou o texto da API.
 */
export function formatGradeScore(value: number | string | null | undefined) {
  const hundredths = scoreHundredths(value);
  if (hundredths === null) {
    return "";
  }
  return (hundredths / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2, useGrouping: false });
}

/** Máximo da nota ao lado dela: sem casa quando é inteiro (1000 vira "10", 500 vira "5"), com vírgula quando não ("7,5"). */
export function formatGradeMax(value: number | string | null | undefined) {
  const hundredths = scoreHundredths(value);
  return hundredths === null ? "" : formatScore(hundredths);
}

/** "7,5 de 10". Aceita os textos da API (scoreText, maxScoreText) ou centésimos. Sem máximo, só a nota. */
export function gradeText(score: number | string | null | undefined, max?: number | string | null) {
  const scoreLabel = typeof score === "number" ? formatScore(score) : (score ?? "");
  if (!scoreLabel) {
    return "";
  }
  const maxLabel = typeof max === "number" ? formatScore(max) : (max ?? "");
  return maxLabel ? `${scoreLabel} de ${maxLabel}` : scoreLabel;
}

/** O que mostrar no lugar da nota: "7,5 de 10", "Falta", "Dispensa" ou "Sem nota". */
export function gradeDisplay(grade: Pick<Grade, "status" | "score" | "scoreText"> | null | undefined, maxScoreText?: string | null) {
  if (!grade) {
    return "Sem nota";
  }
  if (grade.status !== "graded") {
    return gradeStatusLabels[grade.status];
  }
  return gradeText(grade.scoreText ?? grade.score, maxScoreText) || "Sem nota";
}

/** "Fonte: SUAP, importada em 04/11/2026" ou "Fonte: lançada na Agenda em 06/11/2026". */
export function gradeSourceText(source: GradeSourceInfo | null | undefined, updatedAt?: string | null) {
  if (!source) {
    return "";
  }
  if (source.type === "import") {
    // no meio da frase, "modelo da Agenda" vai em minúscula ("Fonte: modelo da Agenda, importada em ...")
    const origin =
      source.source === "modelo" ? "modelo da Agenda" : (gradeImportSourceLabels[source.source] ?? source.source);
    return `Fonte: ${origin}, importada em ${formatDateBR(source.importedAt)}`;
  }
  return updatedAt ? `Fonte: lançada na Agenda em ${formatDateBR(updatedAt)}` : "Fonte: lançada na Agenda";
}
