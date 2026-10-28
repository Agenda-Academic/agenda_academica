import type { AcademicEvent } from "./types";

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
  if (days <= 30) {
    return `em ${days} dias`;
  }
  return formatDayMonth(value);
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

/** Um evento ocorre num dia se o dia estiver entre startsAt e endsAt (inclusive). */
export function eventOccursOn(event: AcademicEvent, day: Date) {
  const dayStart = startOfDay(day).getTime();
  const eventStart = startOfDay(new Date(event.startsAt)).getTime();
  const eventEnd = event.endsAt ? startOfDay(new Date(event.endsAt)).getTime() : eventStart;
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
  // Pula títulos ("Prof. Apio" → "Apio") para a saudação soar natural.
  return parts.find((part) => !honorifics.has(part.toLowerCase())) ?? parts[0] ?? value;
}

// Mensagens padrão da API em inglês que chegam direto para a pessoa.
const apiMessages: Record<string, string> = {
  "Invalid user credentials": "E-mail ou senha incorretos.",
  "Unauthorized access": "Sua sessão expirou. Entre novamente.",
};

export function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Algo deu errado. Tente novamente.";
  return apiMessages[error.message] ?? error.message;
}

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Peças de data do visual do Figma                                    */
/* ------------------------------------------------------------------ */

const shortWeekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const shortMonths = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** "Sex", "26", "Jun" — blocos de data das listas e do destaque. */
export function dateParts(value: string) {
  const date = new Date(value);
  return {
    weekday: shortWeekdays[date.getDay()],
    day: String(date.getDate()).padStart(2, "0"),
    month: shortMonths[date.getMonth()],
  };
}

/** Dias corridos entre hoje e a data (negativo = passado). */
export function daysUntil(value: string) {
  const diff = startOfDay(new Date(value)).getTime() - startOfDay(new Date()).getTime();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

/** Evento sem horário (começa à meia-noite), como feriados e semanas acadêmicas. */
export function isAllDay(value: string) {
  const date = new Date(value);
  return date.getHours() === 0 && date.getMinutes() === 0;
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

/** Agrupa eventos futuros em "Esta semana", "Próxima semana · 29 jun – 5 jul" e "Mais adiante". */
export function groupByWeek<T extends { startsAt: string }>(items: T[], now = new Date()) {
  const today = startOfDay(now);
  const nextWeekStart = addDays(today, 7 - today.getDay());
  const nextWeekEnd = addDays(nextWeekStart, 6);
  const range = `${nextWeekStart.getDate()} ${shortMonths[nextWeekStart.getMonth()].toLowerCase()} – ${nextWeekEnd.getDate()} ${shortMonths[nextWeekEnd.getMonth()].toLowerCase()}`;
  const groups: Array<{ label: string; items: T[] }> = [
    { label: "Esta semana", items: [] },
    { label: `Próxima semana · ${range}`, items: [] },
    { label: "Mais adiante", items: [] },
  ];
  for (const item of items) {
    const day = startOfDay(new Date(item.startsAt));
    const index = day < nextWeekStart ? 0 : day <= nextWeekEnd ? 1 : 2;
    groups[index].items.push(item);
  }
  return groups.filter((group) => group.items.length);
}
