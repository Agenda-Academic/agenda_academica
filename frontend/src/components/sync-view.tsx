"use client";

import { zonedNow, zonedNowMs } from "@/lib/zone";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
  Clock,
  CloudDownload,
  ExternalLink,
  FileText,
  FileUp,
  History,
  Info,
  Landmark,
  Lightbulb,
  ListChecks,
  Loader2,
  Lock,
  Search,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ApiError, type CalendarImportEventInput, type CalendarImportInput, type CalendarPdfResult } from "@/lib/api";
import { cx, errorMessage, formatOnDayAt, formatShortDate, formatShortDateTime, formatTime, monthGroupLabel, startOfDay } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, CalendarImport, Category } from "@/lib/types";
import { delay, isOfficialDate, officialCategories } from "./dashboard-bits";
import { MonthNeighbors, MonthPicker, nearestMonthWith } from "./month-pager";
import { Pager, usePaged } from "./pager";
import { Select } from "./select";
import {
  ConfirmDialog,
  Drawer,
  EmptyState,
  dangerButton,
  iconButton,
  primaryButton,
  secondaryButton,
  type ConfirmState,
} from "./ui";

/** O que a importação devolve: os eventos criados e o registro da importação. */
export type ImportResult = { import?: CalendarImport | null; events: AcademicEvent[] };

/** Resposta de onImport: { ok: true, result } ou { ok: false, error }. */
export type ImportOutcome = { ok: boolean; result?: ImportResult | null; error?: unknown };

const DEFAULT_SOURCE = "Calendário oficial (colado)";
const categoryHelp = "prova, trabalho, atividade, extracurricular, institucional, feriado ou recesso";
const dateHelp = "2026-11-20, 2026-11-20T19:00 ou 20/11/2026 19:00";
const weekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// categorias aceitas no arquivo, em português ou no código da API
const categoryAliases: Record<string, Category> = {
  exam: "exam",
  prova: "exam",
  provas: "exam",
  assignment: "assignment",
  trabalho: "assignment",
  trabalhos: "assignment",
  activity: "activity",
  atividade: "activity",
  atividades: "activity",
  extracurricular: "extracurricular",
  extracurriculares: "extracurricular",
  extra: "extracurricular",
  institutional: "institutional",
  institucional: "institutional",
  institucionais: "institutional",
  holiday: "holiday",
  feriado: "holiday",
  feriados: "holiday",
  recess: "recess",
  recesso: "recess",
  recessos: "recess",
};

type PreviewRow = {
  key: string;
  /** Posição no arquivo (0 = primeiro evento). */
  index: number;
  title: string;
  rawCategory: string;
  category: Category;
  start: Date;
  end: Date | null;
  /** Início e término como vieram no arquivo (normalizados), para o checksum não mudar com o fuso. */
  startText: string;
  endText: string | null;
  past: boolean;
  /** "existing": já existe entre as datas oficiais; "file": repetida no próprio arquivo. */
  duplicate: "existing" | "file" | null;
  payload: CalendarImportEventInput;
};

type ImportCheck =
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      sourceName: string;
      namedSource: boolean;
      sourceUrl: string | null;
      checksum: string;
      rows: PreviewRow[];
    };

type LastResult = {
  importId: number | null;
  sourceName: string;
  importedAt: string;
  events: AcademicEvent[];
  /** Quantas datas foram enviadas (reserva se a resposta não trouxer os eventos). */
  sent: number;
  undone: boolean;
};

const pad = (value: number) => String(value).padStart(2, "0");

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isOfficial(event: AcademicEvent) {
  return Boolean(event.officialPriority) || event.source === "official" || event.source === "imported";
}

function sameDayKey(title: string, date: Date) {
  return `${normalize(title)}|${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function datesLabel(count: number) {
  return count === 1 ? "1 data" : `${count} datas`;
}

/** "Data 3 (Feriado municipal)": na importação, os itens do arquivo são datas do começo ao fim. */
function dateLabel(index: number, title: string) {
  if (!title) {
    return `Data ${index + 1}`;
  }
  const short = title.length > 40 ? `${title.slice(0, 40).trimEnd()}...` : title;
  return `Data ${index + 1} (${short})`;
}

function hash(text: string) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

function localDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute, second);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * send: o que vai para a API (instante exato, em UTC); text: a data como veio, normalizada,
 * que identifica o arquivo (checksum) igual em qualquer fuso; date: a data lida.
 */
type ParsedWhen = { send: string; text: string; date: Date };

/** Data sem fuso, lida no horário do navegador: a prévia, a checagem de repetidas e o que é gravado batem. */
function localWhen(text: string, date: Date | null): ParsedWhen | null {
  return date ? { send: date.toISOString(), text, date } : null;
}

/**
 * Datas aceitas: AAAA-MM-DD, AAAA-MM-DDTHH:MM (com segundos e fuso opcionais)
 * ou dd/mm/aaaa [hh:mm]. Sem fuso, vale o horário do navegador, o mesmo da prévia.
 * Término só com o dia vale até 23:59 daquele dia.
 */
function parseWhen(raw: unknown, endOfDay = false): ParsedWhen | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/);
  if (br) {
    const [, d, m, y, h, min] = br;
    const day = `${y}-${pad(Number(m))}-${pad(Number(d))}`;
    if (h) {
      return localWhen(`${day}T${pad(Number(h))}:${min}`, localDate(Number(y), Number(m), Number(d), Number(h), Number(min)));
    }
    return localWhen(
      endOfDay ? `${day}T23:59` : day,
      localDate(Number(y), Number(m), Number(d), endOfDay ? 23 : 0, endOfDay ? 59 : 0)
    );
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/);
  if (!iso) {
    return null;
  }
  const [, y, m, d, h, min, s, zone] = iso;
  if (!h) {
    return localWhen(
      endOfDay ? `${value}T23:59` : value,
      localDate(Number(y), Number(m), Number(d), endOfDay ? 23 : 0, endOfDay ? 59 : 0)
    );
  }
  const date = localDate(Number(y), Number(m), Number(d), Number(h), Number(min), s ? Number(s) : 0);
  if (!date) {
    return null;
  }
  if (zone) {
    // com fuso, o instante já é exato: vai como veio
    const zoned = new Date(value);
    return Number.isNaN(zoned.getTime()) ? null : { send: value, text: value, date: zoned };
  }
  return localWhen(value, date);
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function lineColumn(text: string, position: number) {
  const before = text.slice(0, position).split("\n");
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

/** Erro de sintaxe com linha, coluna e a causa mais provável. */
function describeSyntaxError(text: string, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  let where: { line: number; column: number } | null = null;
  let cause = "confira vírgulas, aspas e chaves";

  const lineMatch = message.match(/line (\d+) column (\d+)/i);
  const positionMatch = message.match(/position (\d+)/i);
  const trailing = /,\s*[}\]]/.exec(text);
  if (lineMatch) {
    where = { line: Number(lineMatch[1]), column: Number(lineMatch[2]) };
  } else if (positionMatch) {
    where = lineColumn(text, Number(positionMatch[1]));
  } else if (trailing) {
    where = lineColumn(text, trailing.index);
    cause = "sobrou uma vírgula antes de } ou ]";
  }

  if (/end of (json )?(input|data)/i.test(message)) {
    cause = "o texto acaba antes da hora. Falta fechar uma chave } ou um colchete ]";
  } else if (/property name|double-quoted/i.test(message)) {
    cause = "falta o nome de um campo entre aspas duplas. Pode ser uma vírgula sobrando antes de } ou ]";
  } else if (/after (property value|array element)|expected ','/i.test(message)) {
    cause = "falta uma vírgula entre dois itens";
  } else if (/control character/i.test(message)) {
    cause = "há uma quebra de linha dentro de um texto entre aspas";
  }

  return where
    ? `O texto não é um JSON válido. Erro na linha ${where.line}, coluna ${where.column}: ${cause}.`
    : `O texto não é um JSON válido: ${cause}.`;
}

/** Validação única do texto colado: a mesma regra vale para o aviso ao vivo, a prévia e o envio. */
function validateImport(text: string, existing: AcademicEvent[], now: number): ImportCheck {
  if (!text.trim()) {
    return { status: "empty" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { status: "error", message: describeSyntaxError(text, error) };
  }

  const root = Array.isArray(parsed) ? { events: parsed } : parsed;
  if (!root || typeof root !== "object") {
    return { status: "error", message: 'O conteúdo precisa ser uma lista de datas ou um objeto com a lista "events".' };
  }
  const data = root as Record<string, unknown>;
  const list = data.events;
  if (!Array.isArray(list) || !list.length) {
    return { status: "error", message: 'Falta a lista "events" com pelo menos uma data.' };
  }

  const rawName = data.sourceName;
  if (rawName !== undefined && rawName !== null && typeof rawName !== "string") {
    return { status: "error", message: 'O nome da fonte ("sourceName") precisa ser um texto.' };
  }
  const namedSource = typeof rawName === "string" && rawName.trim() !== "";
  const sourceName = namedSource ? (rawName as string).trim() : DEFAULT_SOURCE;
  if (sourceName.length < 3 || sourceName.length > 120) {
    return { status: "error", message: 'O nome da fonte ("sourceName") precisa ter de 3 a 120 caracteres.' };
  }

  const known = new Set(
    existing
      .filter((event) => isOfficial(event) && event.status !== "cancelled")
      .map((event) => sameDayKey(event.title, new Date(event.startsAt)))
  );
  const seen = new Set<string>();
  const problems: string[] = [];
  const rows: PreviewRow[] = [];

  list.forEach((item: unknown, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`Data ${index + 1}: precisa ter title, category e startsAt.`);
      return;
    }
    const event = item as Record<string, unknown>;
    const title = typeof event.title === "string" ? event.title.trim() : "";
    const label = dateLabel(index, title);
    if (event.title === undefined || event.title === null || (typeof event.title === "string" && !title)) {
      problems.push(`${label}: falta o título (title).`);
      return;
    }
    if (typeof event.title !== "string") {
      problems.push(`${label}: o título (title) precisa ser um texto entre aspas.`);
      return;
    }
    if (title.length < 3 || title.length > 140) {
      problems.push(`${label}: o título precisa ter de 3 a 140 caracteres.`);
      return;
    }

    const rawCategory = typeof event.category === "string" ? event.category.trim() : "";
    if (!rawCategory) {
      problems.push(`${label}: falta a categoria. Use ${categoryHelp}.`);
      return;
    }
    const category = categoryAliases[normalize(rawCategory)];
    if (!category) {
      problems.push(`${label}: a categoria "${rawCategory}" não existe. Use ${categoryHelp}.`);
      return;
    }

    if (event.startsAt === undefined || event.startsAt === null || event.startsAt === "") {
      problems.push(`${label}: falta a data de início (startsAt).`);
      return;
    }
    const start = parseWhen(event.startsAt);
    if (!start) {
      problems.push(`${label}: a data de início "${String(event.startsAt)}" não foi entendida. Use ${dateHelp}.`);
      return;
    }

    let end: ParsedWhen | null = null;
    if (event.endsAt !== undefined && event.endsAt !== null && event.endsAt !== "") {
      end = parseWhen(event.endsAt, true);
      if (!end) {
        problems.push(`${label}: a data de término "${String(event.endsAt)}" não foi entendida. Use ${dateHelp}.`);
        return;
      }
      if (end.date.getTime() < start.date.getTime()) {
        problems.push(`${label}: o término é antes do início.`);
        return;
      }
    }

    const payload: CalendarImportEventInput = {
      title,
      category,
      startsAt: start.send,
      endsAt: end ? end.send : null,
    };
    const description = optionalText(event.description);
    if (description !== undefined) payload.description = description;
    const location = optionalText(event.location);
    if (location !== undefined) payload.location = location;
    const externalId = optionalText(event.sourceExternalId);
    if (externalId !== undefined) payload.sourceExternalId = externalId;
    const color = optionalText(event.color);
    if (color !== undefined) payload.color = color;

    const key = sameDayKey(title, start.date);
    const duplicate = known.has(key) ? "existing" : seen.has(key) ? "file" : null;
    seen.add(key);
    rows.push({
      key: `${index}|${key}`,
      index,
      title,
      rawCategory,
      category,
      start: start.date,
      end: end ? end.date : null,
      startText: start.text,
      endText: end ? end.text : null,
      past: (end ? end.date : start.date).getTime() < now,
      duplicate,
      payload,
    });
  });

  if (problems.length) {
    const more = problems.length - 1;
    return {
      status: "error",
      message: more ? `${problems[0]} Há mais ${more} ${more === 1 ? "problema" : "problemas"} no arquivo.` : problems[0],
    };
  }

  const sourceUrl = typeof data.sourceUrl === "string" && data.sourceUrl.trim() ? data.sourceUrl.trim() : null;
  const checksum =
    typeof data.checksum === "string" && data.checksum.trim()
      ? data.checksum.trim()
      : `json-${hash(rows.map((row) => [normalize(row.title), row.category, row.startText, row.endText ?? ""].join("|")).join("\n"))}`;

  return { status: "ok", sourceName, namedSource, sourceUrl, checksum, rows };
}

type ApiFieldError = { field?: string; rule?: string; message?: string };

function looksEnglish(text: string) {
  return /\b(the|field|must|invalid|selected|failed|unexpected|not found|unauthorized|error)\b/i.test(text);
}

/** Erro devolvido pela API, em português e apontando o evento (a partir de errors[].field). */
function describeImportError(error: unknown, rows: PreviewRow[]) {
  if (typeof error === "string" && error.trim()) {
    return looksEnglish(error) ? "Não foi possível importar. Confira o arquivo e tente de novo." : error;
  }

  const list =
    error && typeof error === "object" && Array.isArray((error as { errors?: unknown }).errors)
      ? ((error as { errors: ApiFieldError[] }).errors ?? [])
      : [];
  const lines = list
    .map((item) => {
      const field = item.field ?? "";
      if (field === "sourceName") {
        return 'O nome da fonte ("sourceName") precisa ter de 3 a 120 caracteres.';
      }
      const match = field.match(/^events\.(\d+)\.(\w+)$/);
      if (!match) {
        return field ? `O campo "${field}" não foi aceito.` : "";
      }
      const row = rows[Number(match[1])];
      const label = row ? dateLabel(row.index, row.title) : `Data ${Number(match[1]) + 1}`;
      switch (match[2]) {
        case "title":
          return `${label}: o título precisa ter de 3 a 140 caracteres.`;
        case "category":
          return `${label}: a categoria "${row?.rawCategory ?? ""}" não existe. Use ${categoryHelp}.`;
        case "startsAt":
          return `${label}: a data de início não foi entendida. Use ${dateHelp}.`;
        case "endsAt":
          return `${label}: a data de término não foi entendida. Use ${dateHelp}.`;
        default:
          return `${label}: o campo "${match[2]}" não foi aceito.`;
      }
    })
    .filter(Boolean);
  if (lines.length) {
    const more = lines.length - 3;
    return lines.slice(0, 3).join(" ") + (more > 0 ? ` Há mais ${more} ${more === 1 ? "problema" : "problemas"}.` : "");
  }

  const raw = error instanceof Error ? error.message : "";
  const status = error && typeof error === "object" ? (error as { status?: number }).status : undefined;
  if (/datas da importa/i.test(raw)) {
    return `Uma ou mais datas não foram entendidas pelo servidor. Use ${dateHelp}.`;
  }
  if (status === 403) {
    return "Só a administração pode importar o calendário.";
  }
  if (status === 422 || status === 400) {
    return "O servidor não aceitou os dados. Confira o arquivo e tente de novo.";
  }
  const text = errorMessage(error);
  return looksEnglish(text) ? "Não foi possível importar agora. Tente de novo em instantes." : text;
}


/** Coluna Origem: o calendário de demonstração, o endereço da fonte ou o PDF. */
function originOf(item: CalendarImport) {
  if (item.checksum?.startsWith("demo-")) {
    return { text: "Demonstração", mono: false };
  }
  if (item.sourceUrl) {
    return { text: item.sourceUrl, mono: true };
  }
  return { text: "PDF", mono: false };
}

/** Situação da importação (etiqueta com fundo): desfeita quando trouxe datas e nenhuma está mais no calendário. */
function importState(item: CalendarImport, current: number) {
  if (item.status === "failed") {
    return { label: "Falhou", pill: "stat stat-canc" };
  }
  if (!current && item.totalEvents > 0) {
    return { label: "Desfeita", pill: "stat" };
  }
  return { label: "Concluída", pill: "stat stat-conc" };
}

/** "Novembro" no ano corrente, "Janeiro de 2027" fora dele (decisão 2, igual às outras telas). */
function monthLabel(date: Date) {
  return monthGroupLabel(date);
}

type Dated = { start: Date; end: Date | null };
type MonthGroup<T> = { key: string; label: string; items: T[] };

/** Agrupa por mês do início, em ordem de data (a ordem do arquivo vale no empate). */
function groupByMonth<T extends Dated>(items: T[]): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  for (const item of [...items].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const key = `${item.start.getFullYear()}-${pad(item.start.getMonth() + 1)}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: monthLabel(item.start), items: [item] });
    }
  }
  return groups;
}

const dayMonth = (date: Date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;

/** Horário que vale mostrar: meia-noite e 23:59 contam como dia todo. */
function clockOf(date: Date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes === 0 || minutes === 23 * 60 + 59 ? null : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Bloco de data das linhas: "01/01" em cima e "sex" embaixo; período no mesmo mês vira "11 a 15/01" e
 * "seg a sex"; com horário, "qui, 19:00". Término à meia-noite não conta o dia (como no cronograma).
 */
function dateBlock(start: Date, end: Date | null) {
  const weekday = weekdays[start.getDay()];
  const last = end && end.getTime() > start.getTime() && end.getHours() === 0 && end.getMinutes() === 0 ? new Date(end.getTime() - 1) : end;
  if (!last || startOfDay(last).getTime() === startOfDay(start).getTime()) {
    const from = clockOf(start);
    const to = last && last.getTime() !== start.getTime() ? clockOf(last) : null;
    const time = from ? (to ? `${from} a ${to}` : from) : null;
    return { main: dayMonth(start), sub: time ? `${weekday}, ${time}` : weekday };
  }
  const sameMonth = start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear();
  // período que cruza o mês: "31/05 a" e "05/06" em dois pedaços, para quebrar só entre eles na coluna estreita
  return sameMonth
    ? { main: `${pad(start.getDate())} a ${dayMonth(last)}`, sub: `${weekday} a ${weekdays[last.getDay()]}` }
    : { main: `${dayMonth(start)} a`, mainTo: dayMonth(last), sub: `${weekday} a ${weekdays[last.getDay()]}` };
}


/** Chave "2027-02" a partir do índice da faixa de meses (ano * 12 + mês). */
function monthKeyOf(index: number) {
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/**
 * Seletor de mês da lista (MonthPicker): a chave numérica (ano * 12 + mês) do mês aberto, quantas datas cada mês
 * tem e os limites (primeiro e último mês com datas). A lista só abre meses com datas: escolher um mês vazio (no
 * popover ou nas setas) leva ao mês com datas mais perto, na mesma direção.
 */
function monthPicker<T>(groups: MonthGroup<T>[], active: string | null, go: (key: string) => void) {
  const counts = new Map<number, number>();
  for (const group of groups) {
    const [year, month] = group.key.split("-").map(Number);
    counts.set(year * 12 + month - 1, group.items.length);
  }
  const keys = [...counts.keys()];
  const [ay, am] = (active ?? groups[0]?.key ?? "0-1").split("-").map(Number);
  const value = ay * 12 + am - 1;
  const min = Math.min(...keys);
  const max = Math.max(...keys);
  const onChange = (key: number) => {
    if (counts.has(key)) {
      go(monthKeyOf(key));
      return;
    }
    const direction = key > value ? 1 : -1;
    const near = nearestMonthWith(counts, key, direction, { min, max }) ?? nearestMonthWith(counts, key, direction === 1 ? -1 : 1, { min, max });
    if (near !== null && near !== value) {
      go(monthKeyOf(near));
    }
  };
  // "Hoje" só quando o mês atual tem datas no arquivo (um PDF de outro ano não tem para onde ir)
  const now = zonedNow();
  const showToday = counts.has(now.getFullYear() * 12 + now.getMonth());
  return { value, counts, min, max, onChange, showToday };
}

/** O primeiro dos dois que está à vista (a aba no computador, a lista de escolha no celular). */
function visibleOf(first: RefObject<HTMLElement | null>, second: RefObject<HTMLElement | null>): RefObject<HTMLElement | null> {
  return {
    get current() {
      const element = first.current;
      return element && element.getClientRects().length ? element : second.current;
    },
  };
}

/** Mês vizinho no pé da lista: "Próximo mês, Fevereiro de 2027, 10 datas". */
function pagerTarget<T>(group: MonthGroup<T>, go: (key: string) => void) {
  return { title: group.label, count: datesLabel(group.items.length), onGo: () => go(group.key) };
}

/** Área que rola acima do elemento (a lista no computador; o corpo do painel no celular). */
function scrollerOf(element: HTMLElement) {
  let node = element.parentElement;
  while (node) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Troca de mês: o começo do mês novo vai para o alto da área que rola quando ficou acima da vista (ou sempre,
 * com `force`, quando a troca veio do pé da lista) e, com `focus`, o título do mês recebe o foco.
 */
function useMonthReveal(
  key: string | null,
  sectionRef: RefObject<HTMLElement | null>,
  headRef: RefObject<HTMLElement | null>,
  /** O título do seletor de mês, quando ele existe: o nome do mês fica só nele, e o foco do pé da lista vai para lá. */
  pickerRef?: RefObject<HTMLElement | null>
) {
  const pending = useRef<{ force: boolean; focus: boolean } | null>(null);
  useLayoutEffect(() => {
    const ask = pending.current;
    const section = sectionRef.current;
    pending.current = null;
    if (!ask || !section) {
      return;
    }
    const scroller = scrollerOf(section);
    if (scroller) {
      const delta = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      if (ask.force ? Math.abs(delta) > 1 : delta < 0) {
        scroller.scrollTop += delta;
      }
    }
    if (ask.focus) {
      (pickerRef?.current ?? headRef.current)?.focus({ preventScroll: true });
    }
  }, [key, sectionRef, headRef, pickerRef]);
  return (ask: { force: boolean; focus: boolean }) => {
    pending.current = ask;
  };
}

/** "hoje, às 21:11", "ontem, às 21:11" ou "na terça, 17/11, às 17:00" (o mesmo texto do Painel). */
function atLabel(value: string, now: number) {
  return formatOnDayAt(value, now);
}

/** Quantas datas de cada categoria, da mais comum para a menos comum. */
function countByCategory(list: Array<{ category: Category }>) {
  const counts = new Map<Category, number>();
  for (const item of list) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** Indicador do alto: ícone num quadrado suave e rótulo, número (ou palavra curta) forte e dica. */
function ImportTile({
  hint,
  hintShort,
  icon: Icon,
  iconTone,
  label,
  order,
  text,
  tone,
  unit,
  value,
}: {
  hint: string;
  /** Dica curta do celular estreito (abaixo de 420px), onde a longa ocupava 3 a 5 linhas no indicador. */
  hintShort?: string;
  icon: LucideIcon;
  /** Cor do quadrado do ícone (as variantes .k-* do .kpi-ic): verde, ipê, azul da instituição ou verde de "deu certo". */
  iconTone: "brand" | "ipe" | "azul" | "ok";
  label: string;
  order: number;
  /** Valor em palavra ("Hoje", "Em dia"): no mesmo tamanho do número, mas pode quebrar a linha no celular. */
  text?: boolean;
  tone?: "ok" | "warn";
  unit?: string;
  value: string;
}) {
  return (
    <div className={cx("card kpi imp-kpi anim-in", tone && `imp-kpi-${tone}`)} style={delay(order)}>
      <div className="kpi-top">
        <span className={cx("kpi-ic", `k-${iconTone}`)} aria-hidden>
          <Icon />
        </span>
        <p className="kpi-label">{label}</p>
      </div>
      {/* a mesma escala nos quatro (Sora): o número e a palavra do mesmo tamanho */}
      <p className={cx("kpi-val is-date", text ? "imp-kpi-txt" : "imp-kpi-num")}>
        {value}
        {unit ? <small> {unit}</small> : null}
      </p>
      {hintShort ? (
        <p className="kpi-hint wrap-anywhere">
          <span className="imp-hint-long">{hint}</span>
          <span className="imp-hint-short">{hintShort}</span>
        </p>
      ) : (
        <p className="kpi-hint wrap-anywhere">{hint}</p>
      )}
    </div>
  );
}

/** Caixa do mês: marca ou desmarca o mês inteiro; com parte marcada, mostra o traço de "algumas". */
function MonthCheck({
  disabled,
  label,
  onChange,
  state,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
  state: "all" | "some" | "none";
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === "some";
    }
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="imp-check"
      aria-label={label}
      checked={state === "all"}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

function DateCell({ start, end }: Dated) {
  const block = dateBlock(start, end);
  return (
    <span className="imp-date">
      <b>
        <span>{block.main}</span>
        {block.mainTo ? (
          <>
            {" "}
            <span>{block.mainTo}</span>
          </>
        ) : null}
      </b>
      <small>{block.sub}</small>
    </span>
  );
}

/** Busca dos painéis: filtra pelo título; Esc com texto limpa a busca (e não fecha o painel). */
function DateSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="imp-search">
      <Search className="imp-search-ico" aria-hidden />
      <input
        className="input"
        aria-label="Buscar data pelo nome"
        autoComplete="off"
        placeholder="Buscar"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
      />
    </label>
  );
}

const byStart = (a: AcademicEvent, b: AcademicEvent) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

/** Importações por página no histórico. */
const IMPORTS_PAGE = 8;

/** Quanto tempo o "Leitura descartada" com Desfazer fica no card (o mesmo de um toast com botão). */
const DISCARD_UNDO_MS = 10000;

/** PDF de exemplo (Calendário Acadêmico 2027, Campus Três Lagoas), para ver a importação na demonstração. */
const SAMPLE_PDF_URL = "/exemplos/calendario-academico-2027.pdf";

/**
 * Filtros do painel Conferir datas. Nenhum depende do que está marcado: a faixa não muda de tamanho enquanto a
 * pessoa marca, e a linha não some da lista ao ser desmarcada.
 */
type ReviewFilter = "new" | "all" | "staff" | "existing" | "file" | "past";

const reviewFilters: Array<{ id: ReviewFilter; label: string }> = [
  { id: "new", label: "Novas" },
  { id: "existing", label: "Já existem" },
  { id: "staff", label: "Só de servidores" },
  { id: "file", label: "Repetidas no arquivo" },
  { id: "past", label: "Passadas" },
  { id: "all", label: "Todas" },
];

/**
 * Filtro com que a conferência abre: sem repetidas, todas; com repetidas, as novas; se só sobraram as de
 * servidores, essas (são as únicas que ainda dá para marcar); se tudo já existe, todas (a aba "Já existem" seria a
 * mesma lista).
 */
function firstFilter(rows: PreviewRow[], staff: ReadonlySet<number>): ReviewFilter {
  if (!rows.some((row) => row.duplicate === "existing")) {
    return "all";
  }
  if (rows.some((row) => row.duplicate === null && !staff.has(row.index))) {
    return "new";
  }
  if (rows.some((row) => staff.has(row.index) && row.duplicate !== "existing")) {
    return "staff";
  }
  return rows.every((row) => row.duplicate === "existing") ? "all" : "existing";
}

/** Filtro do painel só de leitura: todas, uma categoria ou as que já passaram. */
type ViewFilter = "all" | "past" | Category;

/** Importação aberta no painel só de leitura (do histórico ou do card de sucesso). */
type ViewTarget = {
  importId: number | null;
  sourceName: string;
  importedAt: string;
  /** Datas de reserva, quando a importação não tem id (resposta antiga da API). */
  fallback: AcademicEvent[];
};

export function SyncView({
  events,
  imports,
  isAdmin,
  saving,
  onImport,
  onImportJson,
  onOpenCalendar,
  onUndoImport,
  onReadPdf,
  incomingPdf,
}: {
  events: AcademicEvent[];
  imports: CalendarImport[];
  isAdmin: boolean;
  saving: boolean;
  /** Lê o PDF do Calendário Acadêmico na API e devolve as datas (sem gravar). */
  onReadPdf?: (file: File) => Promise<CalendarPdfResult>;
  /** PDF solto em qualquer lugar do app: a tela lê assim que recebe (o id muda a cada arquivo). */
  incomingPdf?: { file: File; id: number } | null;
  /** Não é mais usado: a demonstração agora lê o PDF de exemplo. Fica para a página não precisar mudar. */
  demoPayload?: CalendarImportInput;
  /** Importa e devolve o resultado; a leitura só é descartada quando der certo. */
  onImport?: (payload: CalendarImportInput) => Promise<ImportOutcome>;
  /** Desfaz a importação `importId` (as `ids` servem de reserva quando a importação não tem id). */
  onUndoImport?: (importId: number | null, ids: number[]) => Promise<boolean | void>;
  onOpenCalendar?: (filter?: { categories?: Category[] }) => void;
  /** Reserva antiga, sem onImport: importa sem esperar a resposta. */
  onImportJson?: (payload: CalendarImportInput) => void;
}) {
  const baseId = useId();
  const cardTitleId = `${baseId}-importar`;
  const dropTitleId = `${baseId}-soltar`;
  const dropHintId = `${baseId}-soltar-dica`;
  const sampleTitleId = `${baseId}-exemplo`;
  const stepsTitleId = `${baseId}-passos`;
  const resultTitleId = `${baseId}-resultado`;
  const histId = `${baseId}-historico`;
  const restrictedId = `${baseId}-restrito`;

  // leitura do PDF: o JSON fica só por dentro e passa pela mesma validação de sempre
  const [text, setText] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  // aviso "Este calendário já está no sistema" aberto no celular (no computador o texto fica sempre à vista)
  const [upToDateOpen, setUpToDateOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  // posições (no arquivo) dos assuntos só de servidores (PIT, RAD, diários): vêm desmarcados
  const [staffRows, setStaffRows] = useState<ReadonlySet<number>>(() => new Set());
  const [readFile, setReadFile] = useState<string | null>(null);
  // filtro, busca e mês à vista no painel Conferir datas (null: o primeiro mês da lista)
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewMonth, setReviewMonth] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [viewing, setViewing] = useState<ViewTarget | null>(null);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [viewQuery, setViewQuery] = useState("");
  // mês à vista no painel só de leitura (null: o primeiro mês com data à frente)
  const [viewMonth, setViewMonth] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [resultFocus, setResultFocus] = useState(0);
  // horário de referência fixado na montagem (render precisa ser puro)
  const [now] = useState(() => zonedNowMs());
  // "Descartar" com Desfazer: o aviso fica no card, no lugar da leitura, por 10 s (no celular, o toast cobria a lista
  // de datas do painel que abrisse em seguida)
  const [discarded, setDiscarded] = useState<{ undo: () => void } | null>(null);
  const pendingConferRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!discarded) {
      return;
    }
    // o Desfazer some com o aviso: se o foco estava nele, volta para o card (senão cairia no body)
    const timer = window.setTimeout(() => {
      if (cardRef.current?.contains(document.activeElement)) {
        cardRef.current.focus();
      }
      setDiscarded(null);
    }, DISCARD_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [discarded]);

  const [pdfReading, setPdfReading] = useState(false);
  // baixando o PDF de exemplo (depois a leitura segue como a de qualquer PDF)
  const [sampleLoading, setSampleLoading] = useState(false);
  const [pdfDragging, setPdfDragging] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const handledPdf = useRef<number | null>(null);

  const cardRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const filterChipRef = useRef<HTMLButtonElement>(null);
  const viewChipRef = useRef<HTMLButtonElement>(null);
  const filterSelectRef = useRef<HTMLButtonElement>(null);
  const viewSelectRef = useRef<HTMLButtonElement>(null);
  // foco de quando o painel abre: a aba escolhida; no celular as abas viram a lista de escolha
  const [reviewEntryRef] = useState(() => visibleOf(filterChipRef, filterSelectRef));
  const [viewEntryRef] = useState(() => visibleOf(viewChipRef, viewSelectRef));
  const rowButtons = useRef(new Map<number, HTMLButtonElement>());
  const focusAfterConfirm = useRef<HTMLElement | null>(null);
  const histHeadRef = useRef<HTMLHeadingElement>(null);
  const reviewSectionRef = useRef<HTMLElement>(null);
  const reviewHeadRef = useRef<HTMLHeadingElement>(null);
  const viewSectionRef = useRef<HTMLElement>(null);
  const viewHeadRef = useRef<HTMLHeadingElement>(null);
  // título do seletor de mês (MonthPicker) de cada lista; null quando a lista tem um mês só e o seletor não aparece
  const reviewPickRef = useRef<HTMLElement | null>(null);
  const viewPickRef = useRef<HTMLElement | null>(null);
  const markAllRef = useRef<HTMLButtonElement>(null);
  const unmarkAllRef = useRef<HTMLButtonElement>(null);
  // "Marcar todas" ou "Desmarcar todas" que acabou de sumir: o foco vai para o outro botão (ou para o filtro)
  const bulkFocus = useRef<boolean | null>(null);

  const busy = importing || saving;
  const check = useMemo(() => validateImport(text, events, now), [text, events, now]);
  const rows = check.status === "ok" ? check.rows : [];
  // a data que já está no calendário não entra de novo (a API descarta): a caixa dela fica travada
  const pickable = (row: PreviewRow) => row.duplicate !== "existing";
  const isPicked = (row: PreviewRow) =>
    pickable(row) && (picked[row.key] ?? (row.duplicate === null && !staffRows.has(row.index)));
  const chosen = rows.filter(isPicked);
  const pickableCount = rows.filter(pickable).length;
  const pastChosen = chosen.filter((row) => row.past).length;
  const canImport = check.status === "ok" && chosen.length > 0;

  const matches = (id: ReviewFilter, row: PreviewRow) => {
    switch (id) {
      // novas de verdade: as que vêm marcadas (as de servidores ficam na aba delas)
      case "new":
        return row.duplicate === null && !staffRows.has(row.index);
      case "staff":
        return staffRows.has(row.index);
      case "existing":
        return row.duplicate === "existing";
      case "file":
        return row.duplicate === "file";
      case "past":
        return row.past;
      default:
        return true;
    }
  };
  // Conferir datas: o filtro e a busca valem para o ano todo; a lista mostra um mês por vez (na busca, os meses com resultado)
  const reviewQ = normalize(reviewQuery);
  const filteredRows = rows.filter((row) => matches(filter, row));
  const visibleRows = reviewQ ? filteredRows.filter((row) => normalize(row.title).includes(reviewQ)) : filteredRows;
  // busca sem nada neste filtro: quantas ela acha nas outras datas (o vazio oferece "Ver em Todas")
  const foundElsewhere =
    reviewQ && !visibleRows.length && filter !== "all" ? rows.filter((row) => normalize(row.title).includes(reviewQ)).length : 0;
  const filterLabel = reviewFilters.find((item) => item.id === filter)?.label ?? "Todas";
  const bulkRows = visibleRows.filter(pickable);
  const visiblePicked = bulkRows.filter(isPicked).length;
  useLayoutEffect(() => {
    const value = bulkFocus.current;
    if (value === null) {
      return;
    }
    bulkFocus.current = null;
    const active = document.activeElement;
    // o botão clicado continua lá (nem tudo mudou): o foco fica nele
    if (active instanceof HTMLElement && active.isConnected && active !== document.body) {
      return;
    }
    (value ? unmarkAllRef.current : markAllRef.current)?.focus();
  });
  const reviewAllGroups = groupByMonth(visibleRows);
  const reviewMonthKey = reviewAllGroups.some((group) => group.key === reviewMonth)
    ? reviewMonth
    : (reviewAllGroups[0]?.key ?? null);
  const reviewGroups = reviewAllGroups.filter((group) => group.key === reviewMonthKey);
  const reviewPos = reviewAllGroups.findIndex((group) => group.key === reviewMonthKey);
  const askReviewReveal = useMonthReveal(reviewMonthKey, reviewSectionRef, reviewHeadRef, reviewPickRef);
  // com o seletor de mês à vista, o cabeçalho da seção não repete "Fevereiro de 2027 / 4 datas" logo abaixo dele
  const reviewPicker = reviewAllGroups.length > 1;

  // datas que a importação ainda tem no calendário
  const datesOf = (importId: number) => events.filter((event) => event.calendarImportId === importId).sort(byStart);
  // mesmo calendário já importado: só é repetido se ainda tem datas no calendário;
  // se todas as datas saíram, a importação foi desfeita e o aviso diz isso
  const sameSource =
    check.status === "ok"
      ? imports.filter(
          (item) =>
            (item.checksum && item.checksum === check.checksum) ||
            (check.namedSource && normalize(item.sourceName) === normalize(check.sourceName))
        )
      : [];
  const previous = sameSource.find((item) => datesOf(item.id).length > 0) ?? null;
  const undonePrevious = previous ? null : (sameSource.find((item) => item.totalEvents > 0) ?? null);
  const existingCount = rows.filter((row) => row.duplicate === "existing").length;
  // o calendário já está no sistema: fora as que já existem, só sobraram assuntos de servidores
  const nothingNew = existingCount > 0 && rows.every((row) => row.duplicate === "existing" || staffRows.has(row.index));

  // mesma regra do Painel e do Cronograma (datas oficiais à frente)
  const officialAhead = events.filter(
    (event) =>
      isOfficialDate(event) &&
      event.status !== "cancelled" &&
      event.status !== "completed" &&
      new Date(event.startsAt).getTime() >= now
  ).length;
  const upToDate = officialAhead > 0;
  const lastImport = imports[0] ?? null;
  const resultPast = lastResult
    ? lastResult.events.filter((event) => new Date(event.endsAt ?? event.startsAt).getTime() < now).length
    : 0;
  // desfeita por outro caminho (aviso com Desfazer ou histórico): a importação já está na lista e não tem mais datas
  const resultUndone = lastResult
    ? lastResult.undone ||
      (lastResult.importId !== null &&
        imports.some((item) => item.id === lastResult.importId) &&
        !events.some((event) => event.calendarImportId === lastResult.importId))
    : false;
  const resultCount = lastResult ? lastResult.events.length || lastResult.sent : 0;
  const resultCategories = lastResult ? countByCategory(lastResult.events) : [];

  // painel só de leitura: as datas da importação que seguem no calendário
  const viewEvents = viewing
    ? viewing.importId !== null
      ? datesOf(viewing.importId)
      : viewing.fallback.filter((item) => events.some((event) => event.id === item.id)).sort(byStart)
    : [];
  const viewItems = viewEvents.map((event) => {
    const start = new Date(event.startsAt);
    const end = event.endsAt ? new Date(event.endsAt) : null;
    return { event, start, end, past: (end ?? start).getTime() < now };
  });
  const viewImport = viewing && viewing.importId !== null ? (imports.find((item) => item.id === viewing.importId) ?? null) : null;
  const viewTotal = viewImport ? viewImport.totalEvents : viewing ? viewing.fallback.length : 0;
  // importação desfeita: trouxe datas e nenhuma ficou. Se o mesmo calendário foi importado de novo, o painel leva
  // até essa importação (as datas que estão no calendário hoje)
  const viewUndone = Boolean(viewImport) && viewTotal > 0 && !viewEvents.length;
  const viewRedone = viewUndone
    ? (imports.find((item) => item.id !== viewImport?.id && item.sourceName === viewImport?.sourceName && datesOf(item.id).length > 0) ??
      null)
    : null;
  const viewPast = viewItems.filter((item) => item.past).length;
  const viewCategories = countByCategory(viewEvents);
  const viewQ = normalize(viewQuery);
  const viewVisible = viewItems.filter(
    (item) =>
      (viewFilter === "all" ? true : viewFilter === "past" ? item.past : item.event.category === viewFilter) &&
      (!viewQ || normalize(item.event.title).includes(viewQ))
  );
  const viewAllGroups = groupByMonth(viewVisible);
  // abre no mês da próxima data (as que já passaram ficam para trás); na busca, os meses com resultado
  const viewMonthKey = viewAllGroups.some((group) => group.key === viewMonth)
    ? viewMonth
    : (viewAllGroups.find((group) => group.items.some((item) => !item.past))?.key ?? viewAllGroups[0]?.key ?? null);
  const viewGroups = viewAllGroups.filter((group) => group.key === viewMonthKey);
  const viewPos = viewAllGroups.findIndex((group) => group.key === viewMonthKey);
  const askViewReveal = useMonthReveal(viewMonthKey, viewSectionRef, viewHeadRef, viewPickRef);
  const viewPicker = viewAllGroups.length > 1;
  const importsPaged = usePaged(imports, IMPORTS_PAGE);

  // filtros com contagem; um filtro que pega todas as datas some (seria a mesma lista de "Todas")
  const reviewFilterList = reviewFilters
    .map((item) => ({ ...item, count: item.id === "all" ? rows.length : rows.filter((row) => matches(item.id, row)).length }))
    .filter(
      (item) => item.id === "all" || item.id === filter || (item.count > 0 && item.count < rows.length)
    );
  const viewFilterList: Array<{ id: ViewFilter; label: string; count: number; dot?: string }> = [
    { id: "all", label: "Todas", count: viewEvents.length },
    ...viewCategories.map(([category, count]) => ({
      id: category,
      label: categoryMeta[category].label,
      count,
      dot: categoryMeta[category].accent,
    })),
    ...(viewPast ? [{ id: "past" as const, label: "Passadas", count: viewPast }] : []),
  ];
  // um aviso só no alto da conferência: importação anterior, repetidas e assuntos de servidores
  const noteParts: string[] = [];
  if (previous) {
    noteParts.push(`Esse calendário já foi importado ${formatOnDayAt(previous.importedAt)}.`);
  } else if (undonePrevious) {
    noteParts.push(`Esse calendário foi importado ${formatOnDayAt(undonePrevious.importedAt)} e depois desfeito.`);
  }
  if (existingCount) {
    noteParts.push(existingCount === 1 ? "A data que já existe não entra de novo." : `As ${existingCount} datas que já existem não entram de novo.`);
  }
  if (staffRows.size) {
    noteParts.push(
      staffRows.size === 1
        ? "1 assunto só de servidores (PIT, RAD, diários) veio desmarcado."
        : `${staffRows.size} assuntos só de servidores (PIT, RAD, diários) vieram desmarcados.`
    );
  }

  useEffect(() => {
    if (resultFocus) {
      resultRef.current?.focus();
    }
  }, [resultFocus]);

  // PDF solto em outra tela: o app abre esta e entrega o arquivo; cada arquivo é lido uma vez
  useEffect(() => {
    if (!incomingPdf || handledPdf.current === incomingPdf.id) {
      return;
    }
    handledPdf.current = incomingPdf.id;
    const file = incomingPdf.file;
    queueMicrotask(() => void readPdf(file));
    // readPdf muda a cada render; o que importa é o arquivo novo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingPdf]);

  // depois que a confirmação fecha, o foco vai para um lugar que continua na tela
  useEffect(() => {
    if (!confirm && focusAfterConfirm.current) {
      focusAfterConfirm.current.focus();
      focusAfterConfirm.current = null;
    }
  }, [confirm]);

  function changeText(value: string) {
    setText(value);
    setSubmitError(null);
    // leitura nova: o resultado da importação anterior e o "Leitura descartada" saem da tela
    setLastResult(null);
    setDiscarded(null);
  }

  /** Tira a leitura da tela (depois de importar ou quando a pessoa descarta). */
  function clearReading() {
    setText("");
    setPicked({});
    setStaffRows(new Set());
    setReadFile(null);
    setSubmitError(null);
    setFilter("all");
    setReviewQuery("");
    setReviewMonth(null);
  }

  /**
   * "Descartar": a leitura sai da tela e, no lugar dela, o card diz "Leitura descartada. Nada foi gravado." com
   * Desfazer (10 s). O foco volta para o card.
   */
  function discardReading() {
    const snapshot = { text, picked, staffRows, readFile, filter, reviewQuery, reviewMonth };
    clearReading();
    queueMicrotask(() => cardRef.current?.focus());
    setDiscarded({
      undo: () => {
        setDiscarded(null);
        setText(snapshot.text);
        setPicked(snapshot.picked);
        setStaffRows(snapshot.staffRows);
        setReadFile(snapshot.readFile);
        setFilter(snapshot.filter);
        setReviewQuery(snapshot.reviewQuery);
        setReviewMonth(snapshot.reviewMonth);
        // a leitura volta: o foco vai para o "Conferir datas" dela
        window.requestAnimationFrame(() => pendingConferRef.current?.focus());
      },
    });
  }

  function chooseFilter(id: ReviewFilter) {
    setFilter(id);
    askReviewReveal({ force: false, focus: false });
  }

  function changeReviewQuery(value: string) {
    setReviewQuery(value);
    askReviewReveal({ force: false, focus: false });
  }

  /** Mês da faixa (o foco fica no chip) ou do pé da lista (o foco vai para o título do mês novo). */
  function goReviewMonth(key: string, fromFooter: boolean) {
    setReviewMonth(key);
    askReviewReveal({ force: fromFooter, focus: fromFooter });
  }

  function goViewMonth(key: string, fromFooter: boolean) {
    setViewMonth(key);
    askViewReveal({ force: fromFooter, focus: fromFooter });
  }

  function chooseViewFilter(id: ViewFilter) {
    setViewFilter(id);
    askViewReveal({ force: false, focus: false });
  }

  function changeViewQuery(value: string) {
    setViewQuery(value);
    askViewReveal({ force: false, focus: false });
  }

  function setMany(list: PreviewRow[], value: boolean) {
    setPicked((current) => {
      const next = { ...current };
      for (const row of list) {
        if (pickable(row)) {
          next[row.key] = value;
        }
      }
      return next;
    });
  }

  /** "Marcar todas" e "Desmarcar todas": o botão clicado some, e o foco passa para o outro. */
  function bulkPick(value: boolean) {
    bulkFocus.current = value;
    setMany(bulkRows, value);
  }

  function closeReview() {
    if (importing) {
      return;
    }
    setReviewOpen(false);
    setSubmitError(null);
  }

  function openPicker() {
    if (!pdfReading) {
      pdfRef.current?.click();
    }
  }

  /**
   * PDF do Calendário Acadêmico: a API lê as datas e o painel Conferir datas abre (por dentro, as datas seguem a
   * mesma validação de sempre). Assuntos só de servidores (PIT, RAD, diários) vêm desmarcados.
   */
  async function readPdf(file: File | undefined) {
    if (!file || !onReadPdf || pdfReading) {
      return;
    }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setPdfError(`"${file.name}" não é um PDF. Use o PDF do Calendário Acadêmico publicado pela instituição.`);
      return;
    }
    if (file.size > 10_000_000) {
      setPdfError(`"${file.name}" passa de 10 MB. Use o PDF do Calendário Acadêmico publicado pela instituição.`);
      return;
    }
    setPdfReading(true);
    setPdfError(null);
    try {
      const result = await onReadPdf(file);
      const payload: CalendarImportInput = {
        sourceName: result.sourceName,
        checksum: result.checksum,
        // "audience" é só da prévia; a importação recebe as datas como no JSON
        events: result.events.map(({ title, description, category, startsAt, endsAt, sourceExternalId }) => ({
          title,
          description,
          category,
          startsAt,
          endsAt,
          sourceExternalId,
        })),
      };
      const json = JSON.stringify(payload, null, 2);
      const checked = validateImport(json, events, now);
      if (checked.status !== "ok") {
        setPdfError("Não deu para conferir as datas deste PDF. Escolha o arquivo de novo.");
        return;
      }
      const staff = new Set(result.events.flatMap((event, index) => (event.audience === "staff" ? [index] : [])));
      changeText(json);
      setPicked({});
      setStaffRows(staff);
      setReadFile(file.name);
      setFilter(firstFilter(checked.rows, staff));
      setReviewQuery("");
      setReviewMonth(null);
      setReviewOpen(true);
    } catch (err) {
      // a API explica o que houve com o arquivo (422) em português; o resto usa a frase padrão
      const message = err instanceof ApiError && err.status === 422 && err.message ? err.message : errorMessage(err);
      setPdfError(message);
    } finally {
      setPdfReading(false);
    }
  }

  /** "Ler o calendário de exemplo": baixa o PDF que vem com o sistema e lê como se ele tivesse sido arrastado. */
  async function readSamplePdf() {
    if (busy || pdfReading || sampleLoading) {
      return;
    }
    setSampleLoading(true);
    setPdfError(null);
    let file: File;
    try {
      const response = await fetch(SAMPLE_PDF_URL);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      file = new File([await response.blob()], "calendario-academico-2027.pdf", { type: "application/pdf" });
    } catch {
      setPdfError("Não deu para abrir o PDF de exemplo. Tente de novo.");
      return;
    } finally {
      setSampleLoading(false);
    }
    await readPdf(file);
  }

  async function runImport() {
    if (busy || check.status !== "ok" || !chosen.length) {
      return;
    }
    const payload: CalendarImportInput = {
      sourceName: check.sourceName,
      sourceUrl: check.sourceUrl,
      checksum: check.checksum,
      events: chosen.map((row) => row.payload),
    };
    setSubmitError(null);

    if (!onImport) {
      onImportJson?.(payload);
      setReviewOpen(false);
      return;
    }

    setImporting(true);
    try {
      const outcome = await onImport(payload);
      if (outcome.ok) {
        clearReading();
        setReviewOpen(false);
        setLastResult({
          importId: outcome.result?.import?.id ?? null,
          sourceName: check.sourceName,
          importedAt: outcome.result?.import?.importedAt ?? zonedNow().toISOString(),
          events: outcome.result?.events ?? [],
          sent: payload.events.length,
          undone: false,
        });
        setResultFocus((value) => value + 1);
      } else {
        setSubmitError(describeImportError(outcome.error, chosen));
      }
    } catch (err) {
      setSubmitError(describeImportError(err, chosen));
    } finally {
      setImporting(false);
    }
  }

  function askUndo(importId: number | null, ids: number[], titles: string[], sourceName: string, after: () => void) {
    if (!onUndoImport || !ids.length) {
      return;
    }
    const names = titles.slice(0, 4).join(", ") + (titles.length > 4 ? ` e mais ${titles.length - 4}` : "");
    setConfirm({
      title: "Desfazer importação?",
      message: `${datesLabel(ids.length)} de "${sourceName}" ${ids.length === 1 ? "sai" : "saem"} do calendário de todas as turmas: ${names}.`,
      confirmLabel: "Desfazer importação",
      action: async () => {
        const ok = await onUndoImport(importId, ids);
        if (ok !== false) {
          after();
        }
      },
    });
  }

  function undoLastResult() {
    if (!lastResult) {
      return;
    }
    const current = lastResult.importId !== null ? datesOf(lastResult.importId) : lastResult.events;
    askUndo(
      lastResult.importId,
      current.map((event) => event.id),
      current.map((event) => event.title),
      lastResult.sourceName,
      () => {
        setLastResult((value) => (value ? { ...value, undone: true } : value));
        focusAfterConfirm.current = resultRef.current;
      }
    );
  }

  function openImport(target: ViewTarget) {
    setViewFilter("all");
    setViewQuery("");
    setViewMonth(null);
    setViewing(target);
  }

  /** Do resumo "já está no sistema": fecha a conferência e abre as datas da importação anterior. */
  function openPreviousImport(item: CalendarImport) {
    setReviewOpen(false);
    setSubmitError(null);
    openImport({ importId: item.id, sourceName: item.sourceName, importedAt: item.importedAt, fallback: [] });
  }

  function undoViewing() {
    if (!viewing) {
      return;
    }
    const target = viewing;
    askUndo(
      target.importId,
      viewEvents.map((event) => event.id),
      viewEvents.map((event) => event.title),
      target.sourceName,
      () => {
        setViewing(null);
        if (lastResult && lastResult.importId === target.importId) {
          setLastResult({ ...lastResult, undone: true });
        }
      }
    );
  }

  if (!isAdmin) {
    // a tela é da administração; quem chega aqui por outro caminho vê o porquê (Figma, Estados e feedback)
    return (
      <section className="card pad anim-in" aria-labelledby={restrictedId}>
        <div className="empty-inline">
          <span className="empty-ico imp-lock">
            <Lock className="h-6 w-6" aria-hidden />
          </span>
          <h2 id={restrictedId} className="mt-1.5 text-[15px] font-bold text-ink">
            Só a administração importa datas oficiais
          </h2>
          <p className="max-w-sm text-sm leading-5 text-muted">Você continua vendo o calendário oficial no cronograma.</p>
          {onOpenCalendar ? (
            <button className="btn btn-s btn-sm mt-2" onClick={() => onOpenCalendar({ categories: officialCategories })} type="button">
              Abrir cronograma
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const reviewReady = reviewOpen && check.status === "ok";
  const pendingReading = check.status === "ok" && !reviewOpen;
  const dropTitle = pdfReading ? (
    "Lendo o calendário"
  ) : pdfDragging ? (
    "Solte o PDF para ler as datas"
  ) : pdfError ? (
    "Não deu para ler este arquivo"
  ) : (
    // no celular não há o que arrastar: o título fala do botão
    <>
      <span className="imp-drop-fine">Arraste o PDF do calendário para cá</span>
      <span className="imp-drop-coarse">Escolha o PDF do calendário</span>
    </>
  );
  const DropIcon = pdfReading ? Loader2 : pdfError && !pdfDragging ? AlertTriangle : FileUp;

  return (
    // sem cabeçalho de página (o nome da tela está no trilho): começa pelos indicadores
    <div className="imp-page grid gap-5">
      <div className="kpis imp-kpis">
        <ImportTile
          icon={Landmark}
          iconTone="azul"
          label="Fonte"
          value="Instituição"
          text
          hint="calendário letivo oficial"
          hintShort="calendário oficial"
          order={0}
        />
        <ImportTile
          icon={History}
          iconTone="ipe"
          label="Última importação"
          value={lastImport ? dayLabel(lastImport.importedAt, now) : "Nunca"}
          text
          hint={lastImport ? `às ${formatTime(lastImport.importedAt)}, ${lastImport.sourceName}` : "nenhuma importação ainda"}
          hintShort={lastImport ? `às ${formatTime(lastImport.importedAt)}` : "nenhuma ainda"}
          order={1}
        />
        <ImportTile
          icon={CalendarCheck}
          iconTone="brand"
          label="Datas da instituição"
          value={String(officialAhead)}
          unit={officialAhead === 1 ? "futura" : "futuras"}
          hint="visíveis para todas as turmas"
          hintShort="para todas as turmas"
          order={2}
        />
        <ImportTile
          icon={upToDate ? CircleCheckBig : AlertTriangle}
          iconTone={upToDate ? "ok" : "ipe"}
          label="Situação"
          value={upToDate ? "Em dia" : "Falta importar"}
          text
          hint={upToDate ? "nenhuma pendência de importação" : "nenhum evento oficial à frente"}
          hintShort={upToDate ? "sem pendências" : "nada oficial à frente"}
          tone={upToDate ? "ok" : "warn"}
          order={3}
        />
      </div>

      {lastResult ? (
        <section
          ref={resultRef}
          tabIndex={-1}
          className={cx("card anim-in imp-done", resultUndone && "is-undone")}
          style={delay(4)}
          aria-labelledby={resultTitleId}
        >
          <span className="imp-done-ico" aria-hidden>
            {resultUndone ? <Undo2 className="h-6 w-6" /> : <CheckCircle2 className="h-7 w-7" />}
          </span>
          <div className="imp-done-body">
            <h2 id={resultTitleId} className="imp-done-title">
              {resultUndone ? (
                "Importação desfeita"
              ) : (
                <>
                  <span className="imp-done-n">{resultCount}</span> {resultCount === 1 ? "data importada" : "datas importadas"}
                </>
              )}
            </h2>
            <p className="imp-done-sub wrap-anywhere">
              {resultUndone
                ? `As datas de ${lastResult.sourceName} saíram do calendário de todas as turmas.`
                : `De ${lastResult.sourceName}, ${atLabel(lastResult.importedAt, now)}`}
            </p>
            {!resultUndone && resultCategories.length ? (
              <ul className="imp-done-cats" aria-label="Datas por categoria">
                {resultCategories.map(([category, count]) => (
                  <li key={category}>
                    <span className={cx("dot", categoryMeta[category].accent)} aria-hidden />
                    {categoryMeta[category].label}
                    <b>{count}</b>
                  </li>
                ))}
              </ul>
            ) : null}
            {!resultUndone && resultPast ? (
              <p className="imp-done-past">
                <Clock className="h-4 w-4 shrink-0" aria-hidden />
                {resultPast === 1 ? "1 data já passou e aparece só em Passados." : `${resultPast} datas já passaram e aparecem só em Passados.`}
              </p>
            ) : null}
          </div>
          {!resultUndone ? (
            <div className="imp-done-acts">
              {onOpenCalendar ? (
                <button
                  className={primaryButton}
                  onClick={() => onOpenCalendar({ categories: [...new Set(lastResult.events.map((event) => event.category))] })}
                  type="button"
                >
                  <CalendarDays className="h-4 w-4" aria-hidden />
                  Ver no cronograma
                </button>
              ) : null}
              <button
                className={secondaryButton}
                aria-haspopup="dialog"
                onClick={() =>
                  openImport({
                    importId: lastResult.importId,
                    sourceName: lastResult.sourceName,
                    importedAt: lastResult.importedAt,
                    fallback: lastResult.events,
                  })
                }
                type="button"
              >
                <ListChecks className="h-4 w-4" aria-hidden />
                Ver as datas
              </button>
              {onUndoImport ? (
                <button className={dangerButton} aria-disabled={busy || undefined} onClick={() => !busy && undoLastResult()} type="button">
                  <Undo2 className="h-4 w-4" aria-hidden />
                  Desfazer importação
                </button>
              ) : null}
            </div>
          ) : null}
          <button
            className={cx(iconButton, "imp-done-x")}
            aria-label="Fechar o resumo da importação"
            title="Fechar"
            onClick={() => {
              setLastResult(null);
              cardRef.current?.focus();
            }}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </section>
      ) : null}

      {onReadPdf ? (
        <section ref={cardRef} tabIndex={-1} className="card pad anim-in imp-card" style={delay(5)} aria-labelledby={cardTitleId}>
          <div className="imp-card-head">
            <span className="imp-head-ic is-rosa" aria-hidden>
              <CalendarDays />
            </span>
            <div className="min-w-0">
              <h2 className="imp-h" id={cardTitleId}>
                Importar o calendário acadêmico
              </h2>
              <p className="imp-sub">As datas do PDF abrem para você conferir antes de gravar.</p>
            </div>
          </div>

          {pendingReading ? (
            <div className="imp-pending">
              <span className="imp-pending-ico" aria-hidden>
                <FileText className="h-5 w-5" />
              </span>
              <p className="imp-pending-text wrap-anywhere">
                <b>{datesLabel(rows.length)} esperando conferência</b>
                <span>
                  {readFile ? `Lidas de ${readFile}. ` : ""}
                  Nada foi gravado ainda.
                </span>
              </p>
              <div className="imp-pending-acts">
                <button
                  ref={pendingConferRef}
                  className={cx(primaryButton, "btn-sm")}
                  aria-haspopup="dialog"
                  onClick={() => setReviewOpen(true)}
                  type="button"
                >
                  Conferir datas
                </button>
                <button className={cx(secondaryButton, "btn-sm")} onClick={discardReading} type="button">
                  Descartar
                </button>
              </div>
            </div>
          ) : discarded && !reviewOpen ? (
            // o aviso do Descartar fica aqui, onde estava a leitura, e não num toast por cima da tela
            <div className="imp-pending is-discarded" role="status">
              <span className="imp-pending-ico" aria-hidden>
                <FileText className="h-5 w-5" />
              </span>
              <p className="imp-pending-text">
                <b>Leitura descartada</b>
                <span>Nada foi gravado.</span>
              </p>
              <div className="imp-pending-acts">
                <button className={cx(secondaryButton, "btn-sm")} onClick={discarded.undo} type="button">
                  <Undo2 className="h-4 w-4" aria-hidden />
                  Desfazer
                </button>
              </div>
            </div>
          ) : null}

          <div className="imp-grid">
            <div
              className={cx("imp-drop", pdfDragging && "is-over", pdfReading && "is-busy", pdfError && !pdfDragging && "is-bad")}
              role="group"
              aria-labelledby={dropTitleId}
              aria-describedby={dropHintId}
              aria-busy={pdfReading || undefined}
              onClick={(event) => {
                // a área inteira abre a escolha do arquivo; o botão e o link cuidam do próprio clique
                if (!(event.target as HTMLElement).closest("button, a, input")) {
                  openPicker();
                }
              }}
              onDragEnter={(event) => {
                event.preventDefault();
                setPdfDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setPdfDragging(false);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!pdfDragging) setPdfDragging(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setPdfDragging(false);
                void readPdf(event.dataTransfer.files?.[0]);
              }}
            >
              <span className="imp-drop-ico" aria-hidden>
                <DropIcon className={cx("h-8 w-8", pdfReading && "animate-spin")} />
              </span>
              <p className="imp-drop-title" id={dropTitleId}>
                {dropTitle}
              </p>
              {pdfReading ? (
                <p className="imp-drop-text">As datas abrem para conferir em instantes.</p>
              ) : pdfError && !pdfDragging ? (
                <p className="imp-drop-err" role="alert">
                  {pdfError}
                </p>
              ) : null}
              {!pdfReading ? (
                <div className="imp-drop-acts">
                  <span className="imp-drop-or">ou</span>
                  <button className={primaryButton} aria-describedby={dropHintId} onClick={openPicker} type="button">
                    <FileUp className="h-4 w-4" aria-hidden />
                    {pdfError ? "Escolher outro PDF" : "Escolher PDF"}
                  </button>
                </div>
              ) : null}
              <p className="imp-drop-hint" id={dropHintId}>
                PDF publicado pela instituição, até 10 MB
              </p>
              <p className="sr-only" role="status">
                {pdfReading ? "Lendo o calendário" : ""}
              </p>
              <input
                ref={pdfRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  event.target.value = "";
                  void readPdf(selected);
                }}
              />
            </div>

            <div className="imp-aside">
              <section className="imp-sample" aria-labelledby={sampleTitleId}>
                <h3 className="imp-aside-title" id={sampleTitleId}>
                  <span className="imp-aside-ic" aria-hidden>
                    <Lightbulb />
                  </span>
                  Não tem o PDF à mão?
                </h3>
                <p className="imp-aside-text">Use o Calendário Acadêmico 2027 do Campus Três Lagoas para ver como funciona.</p>
                <button
                  className={cx(secondaryButton, "imp-sample-btn")}
                  aria-busy={sampleLoading || undefined}
                  aria-disabled={busy || pdfReading || sampleLoading || undefined}
                  onClick={() => void readSamplePdf()}
                  type="button"
                >
                  {sampleLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
                  Ler o calendário de exemplo
                </button>
                <a className="link imp-sample-link" href={SAMPLE_PDF_URL} target="_blank" rel="noopener">
                  Abrir o PDF de exemplo
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </section>
            </div>
          </div>

          {/* os três passos numa faixa embaixo: a área de soltar e o exemplo ficam da mesma altura, sem sobra */}
          <section className="imp-steps" aria-labelledby={stepsTitleId}>
            <h3 className="imp-aside-title" id={stepsTitleId}>
              Como funciona
            </h3>
            <ol>
              <li>
                <span className="imp-step-n" aria-hidden>
                  1
                </span>
                <span>
                  <b>Envie o PDF.</b> As datas são lidas na hora.
                </span>
              </li>
              <li>
                <span className="imp-step-n" aria-hidden>
                  2
                </span>
                <span>
                  <b>Confira.</b> Assuntos só de servidores, como PIT e RAD, vêm desmarcados.
                </span>
              </li>
              <li>
                <span className="imp-step-n" aria-hidden>
                  3
                </span>
                <span>
                  <b>Importe.</b> As datas aparecem para todas as turmas; quem marcar evento no mesmo dia vê um aviso de conflito.
                </span>
              </li>
            </ol>
          </section>
        </section>
      ) : null}

      <section className="card anim-in imp-hist" style={delay(6)} aria-labelledby={histId}>
        <div className="imp-hist-head">
          <span className="imp-head-ic is-ipe" aria-hidden>
            <History />
          </span>
          <div className="min-w-0">
            <h2 ref={histHeadRef} className="imp-h" id={histId}>
              Importações realizadas
            </h2>
            {imports.length ? <p className="imp-sub">Abra uma importação para ver as datas que ela trouxe ou desfazer.</p> : null}
          </div>
        </div>
        {imports.length ? (
          <table className="tbl">
            <thead>
              <tr>
                {/* a primeira e a última coluna alinham com o título do card (padding em importar.css) */}
                <th scope="col" className="imp-hist-c1">
                  Fonte
                </th>
                <th scope="col" className="hidden whitespace-nowrap @min-[600px]:table-cell">
                  Importado em
                </th>
                <th scope="col" className="px-3 @min-[400px]:px-4">
                  Datas
                </th>
                <th scope="col" className="hidden @min-[820px]:table-cell">
                  Origem
                </th>
                <th scope="col" className="hidden @min-[440px]:table-cell">
                  Situação
                </th>
                <th scope="col" className="imp-hist-cl w-10">
                  <span className="sr-only">Abrir</span>
                </th>
              </tr>
            </thead>
            <tbody id={`${histId}-linhas`}>
              {importsPaged.items.map((item) => {
                const current = datesOf(item.id);
                const state = importState(item, current.length);
                const origin = originOf(item);
                const target: ViewTarget = { importId: item.id, sourceName: item.sourceName, importedAt: item.importedAt, fallback: [] };
                // "2" quando todas as datas seguem no calendário; "1 de 2" quando alguma saiu. Desfeita (nenhuma
                // ficou): quantas ela trouxe, apagado, ao lado da etiqueta "Desfeita" (o "0 de 115" não dizia nada)
                const undone = state.label === "Desfeita";
                const count = current.length === item.totalEvents || undone ? String(item.totalEvents) : `${current.length} de ${item.totalEvents}`;
                return (
                  <tr
                    key={item.id}
                    className={cx("imp-hist-row", viewing?.importId === item.id && "is-open")}
                    onClick={(event) => {
                      // a linha inteira abre (atalho do mouse); pelo teclado, o botão da fonte
                      if (!(event.target as HTMLElement).closest("button, a")) {
                        rowButtons.current.get(item.id)?.focus();
                        openImport(target);
                      }
                    }}
                  >
                    <td className="imp-hist-c1">
                      <button
                        ref={(node) => {
                          if (node) {
                            rowButtons.current.set(item.id, node);
                          } else {
                            rowButtons.current.delete(item.id);
                          }
                        }}
                        className="imp-hist-open"
                        aria-haspopup="dialog"
                        onClick={() => openImport(target)}
                        type="button"
                      >
                        <span className={cx("imp-hist-ic", undone && "is-undone")} aria-hidden>
                          <FileText />
                        </span>
                        <span className="min-w-0">
                          <span className="t block wrap-anywhere">{item.sourceName}</span>
                          <span className="s block @min-[600px]:hidden">{formatShortDateTime(item.importedAt)}</span>
                          <span className="mt-1.5 flex @min-[440px]:hidden">
                            <span className={cx("pill", state.pill)}>{state.label}</span>
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="hidden whitespace-nowrap @min-[600px]:table-cell">{formatShortDateTime(item.importedAt)}</td>
                    <td className={cx("whitespace-nowrap px-3 @min-[400px]:px-4", undone && "text-muted")}>
                      {count}
                      {undone ? <span className="sr-only">{item.totalEvents === 1 ? " data, desfeita" : " datas, desfeita"}</span> : null}
                    </td>
                    <td className={cx("hidden @min-[820px]:table-cell", origin.mono && "break-all font-mono text-[13px]")}>{origin.text}</td>
                    <td className="hidden @min-[440px]:table-cell">
                      <span className={cx("pill", state.pill)}>{state.label}</span>
                    </td>
                    <td className="imp-hist-cl text-right">
                      <ChevronRight className="imp-hist-chev ml-auto h-4 w-4" aria-hidden />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-6 pb-6">
            <EmptyState icon={History} text="Nenhuma importação ainda" hint="Leia o calendário de exemplo para testar." />
          </div>
        )}
        {importsPaged.pageCount > 1 ? (
          <div className="imp-hist-pager">
            <Pager paged={importsPaged} noun={["importação", "importações"]} focusRef={histHeadRef} />
          </div>
        ) : null}
      </section>

      {/* Conferir datas: filtros, busca e a faixa dos meses no alto; a lista mostra um mês por vez, com o
          vizinho no pé (a busca mostra tudo o que achou); o total marcado fica no rodapé */}
      <Drawer
        open={reviewReady}
        size="wide"
        busy={importing}
        title="Conferir datas"
        initialFocusRef={reviewEntryRef}
        onClose={closeReview}
        subtitle={
          check.status === "ok" ? (
            <>
              <span className="imp-sub-src">{check.sourceName}</span>
              <span className="imp-sub-count is-total">{datesLabel(rows.length)}</span>
            </>
          ) : null
        }
        footer={
          <>
            <p className="imp-foot-count" aria-live="polite">
              {pickableCount ? (
                <span>
                  <b>{chosen.length}</b> de {pickableCount} {chosen.length === 1 ? "marcada" : "marcadas"}
                </span>
              ) : (
                <span>Nada a marcar</span>
              )}
              {pastChosen ? (
                <small>
                  {pastChosen === 1 ? "1 já passou e aparece só em Passados" : `${pastChosen} já passaram e aparecem só em Passados`}
                </small>
              ) : existingCount ? (
                <small>{existingCount === 1 ? "1 já está no calendário" : `${existingCount} já estão no calendário`}</small>
              ) : null}
            </p>
            <button className={secondaryButton} disabled={importing} onClick={closeReview} type="button">
              {nothingNew && !chosen.length ? "Fechar" : "Cancelar"}
            </button>
            <button
              className={cx(primaryButton, "imp-foot-go")}
              disabled={!canImport}
              aria-disabled={busy || undefined}
              aria-busy={importing || undefined}
              onClick={() => void runImport()}
              type="button"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudDownload className="h-4 w-4" aria-hidden />}
              {importing
                ? "Importando"
                : chosen.length
                  ? `Importar ${datesLabel(chosen.length)}`
                  : nothingNew
                    ? "Nada novo para importar"
                    : "Nenhuma data marcada"}
            </button>
          </>
        }
      >
        <div className="imp-review">
          <div className="imp-review-bar">
            <div className="imp-bar-top">
              <div className="chips chips-row imp-chips" role="group" aria-label="Filtrar as datas">
                {reviewFilterList.map(({ id, label, count }) => {
                  const active = filter === id;
                  return (
                    <button
                      key={id}
                      ref={active ? filterChipRef : undefined}
                      className={cx("chip", active && "all")}
                      aria-pressed={active}
                      onClick={() => chooseFilter(id)}
                      type="button"
                    >
                      {label}
                      <span className="n">{count}</span>
                    </button>
                  );
                })}
              </div>
              <Select
                buttonRef={filterSelectRef}
                className="imp-filter-select"
                ariaLabel="Mostrar"
                value={filter}
                searchable={false}
                options={reviewFilterList.map(({ id, label, count }) => ({ value: id, label, count }))}
                onChange={(value) => chooseFilter(value as ReviewFilter)}
              />
              <DateSearch value={reviewQuery} onChange={changeReviewQuery} />
            </div>
            {reviewPicker ? (
              <div className="imp-months">
                <MonthPicker
                  {...monthPicker(reviewAllGroups, reviewMonthKey, (key) => goReviewMonth(key, false))}
                  titleRef={reviewPickRef}
                  noun={["data", "datas", "nenhuma data"]}
                />
              </div>
            ) : null}
            <div className="imp-bulk">
              {/* busca sem resultado: quem diz é o vazio da lista (com as saídas); aqui a linha não repete */}
              {reviewQ && !visibleRows.length ? null : (
                <p className={cx("imp-bulk-n", reviewQ && "is-found")} aria-live="polite">
                  {reviewQ
                    ? `${datesLabel(visibleRows.length)} com "${reviewQuery.trim()}"${reviewAllGroups.length > 1 ? ` em ${reviewAllGroups.length} meses` : ""}`
                    : `${datesLabel(visibleRows.length)} em ${reviewAllGroups.length} ${reviewAllGroups.length === 1 ? "mês" : "meses"}`}
                </p>
              )}
              {/* cada botão só aparece quando tem o que fazer; o que some passa o foco para o outro */}
              {bulkRows.length && visiblePicked < bulkRows.length ? (
                <button
                  ref={markAllRef}
                  className={cx(secondaryButton, "btn-sm")}
                  disabled={busy}
                  aria-label={`Marcar todas, as ${datesLabel(bulkRows.length)} da lista`}
                  onClick={() => bulkPick(true)}
                  type="button"
                >
                  Marcar todas
                </button>
              ) : null}
              {visiblePicked > 0 ? (
                <button
                  ref={unmarkAllRef}
                  className={cx(secondaryButton, "btn-sm")}
                  disabled={busy}
                  aria-label={`Desmarcar todas, as ${datesLabel(bulkRows.length)} da lista`}
                  onClick={() => bulkPick(false)}
                  type="button"
                >
                  Desmarcar todas
                </button>
              ) : null}
            </div>
          </div>

          <div className="imp-review-list">
            {/* o aviso fica no começo da lista (o primeiro mês), e não se repete a cada mês */}
            {reviewQ || reviewPos > 0 ? null : nothingNew ? (
              // demonstração com o calendário já importado: diz que deu certo antes e mostra a saída
              // no celular, só o título e "Ver detalhes" (o texto e as ações abrem no lugar): a lista de datas,
              // que é o que se confere aqui, começa logo abaixo em vez de no fim da tela
              <div className={cx("imp-uptodate", upToDateOpen && "is-open")}>
                <span className="imp-uptodate-ico" aria-hidden>
                  <CircleCheckBig className="h-5 w-5" />
                </span>
                <div className="imp-uptodate-body">
                  <div className="imp-uptodate-head">
                    <p className="imp-uptodate-title">Este calendário já está no sistema</p>
                    <button
                      className="link imp-uptodate-more"
                      aria-expanded={upToDateOpen}
                      aria-controls={`${baseId}-em-dia`}
                      onClick={() => setUpToDateOpen((value) => !value)}
                      type="button"
                    >
                      {upToDateOpen ? "Ocultar detalhes" : "Ver detalhes"}
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <div id={`${baseId}-em-dia`} className="imp-uptodate-more-body">
                  <p className="imp-uptodate-text">
                    {existingCount === rows.length
                      ? existingCount === 1
                        ? "A data já existe"
                        : `As ${datesLabel(existingCount)} já existem`
                      : `${existingCount} de ${datesLabel(rows.length)} já existem`}
                    {previous ? `, importadas ${formatOnDayAt(previous.importedAt)}` : ""}.
                    {rows.length > existingCount
                      ? ` ${rows.length - existingCount === 1 ? "A outra é só de servidores (PIT, RAD, diários) e fica de fora, a não ser que você marque." : `As outras ${rows.length - existingCount} são só de servidores (PIT, RAD, diários) e ficam de fora, a não ser que você marque.`}`
                      : ""}
                  </p>
                  <div className="imp-uptodate-acts">
                    {previous ? (
                      <button
                        className={cx(secondaryButton, "btn-sm")}
                        aria-haspopup="dialog"
                        onClick={() => openPreviousImport(previous)}
                        type="button"
                      >
                        <ListChecks className="h-4 w-4" aria-hidden />
                        Ver a importação de {dayMonth(new Date(previous.importedAt))}
                      </button>
                    ) : null}
                    {filter !== "existing" && existingCount < rows.length ? (
                      <button className="link imp-uptodate-link" onClick={() => chooseFilter("existing")} type="button">
                        Ver as que já existem
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  </div>
                </div>
              </div>
            ) : noteParts.length ? (
              <p className={cx("callout imp-note", previous ? "amber" : "blue")}>
                {previous || undonePrevious ? (
                  <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                )}
                <span>{noteParts.join(" ")}</span>
              </p>
            ) : null}

            {reviewGroups.length ? (
              reviewGroups.map((group) => {
                const pickRows = group.items.filter(pickable);
                const on = pickRows.filter(isPicked).length;
                const locked = group.items.length - pickRows.length;
                const lockedText = locked === 1 ? "1 já existe" : `${locked} já existem`;
                const headId = `${baseId}-mes-${group.key}`;
                return (
                  <section
                    key={group.key}
                    ref={reviewSectionRef}
                    className="imp-month"
                    aria-labelledby={headId}
                  >
                    <div className="imp-month-head">
                      <label className="imp-month-check">
                        <MonthCheck
                          state={pickRows.length && on === pickRows.length ? "all" : on ? "some" : "none"}
                          label={`Todas as datas de ${group.label.toLowerCase()}`}
                          disabled={busy || !pickRows.length}
                          onChange={(value) => setMany(group.items, value)}
                        />
                        {reviewPicker ? (
                          <span className="imp-month-all" aria-hidden>
                            Todas do mês
                          </span>
                        ) : null}
                      </label>
                      {/* com o seletor de mês logo acima, o nome do mês fica só para o leitor de tela; à vista,
                          a caixa do mês ganha um rótulo curto */}
                      <h3
                        ref={reviewHeadRef}
                        className={cx("imp-month-name", reviewPicker ? "sr-only" : "drawer-h3")}
                        id={headId}
                        tabIndex={-1}
                      >
                        {group.label}
                      </h3>
                      <span className="imp-month-n">
                        {pickRows.length
                          ? `${on} de ${pickRows.length} ${pickRows.length === 1 ? "marcada" : "marcadas"}${locked ? `, ${lockedText}` : ""}`
                          : lockedText}
                      </span>
                    </div>
                    <ul className="imp-rows">
                      {group.items.map((row) => {
                        const rowOn = isPicked(row);
                        const rowLocked = !pickable(row);
                        const meta = categoryMeta[row.category];
                        return (
                          <li key={row.key}>
                            <label
                              className={cx("imp-row", !rowOn && "is-off", rowLocked && "is-locked")}
                              title={rowLocked ? "Já está no calendário" : undefined}
                            >
                              <input
                                type="checkbox"
                                className="imp-check"
                                checked={rowOn}
                                disabled={busy || rowLocked}
                                onChange={(event) => setPicked((value) => ({ ...value, [row.key]: event.target.checked }))}
                              />
                              <DateCell start={row.start} end={row.end} />
                              <span className="imp-row-title">{row.title}</span>
                              <span className="imp-row-meta">
                                {staffRows.has(row.index) ? <span className="imp-tag staff">Só de servidores</span> : null}
                                {row.duplicate === "existing" ? <span className="imp-tag">Já existe</span> : null}
                                {row.duplicate === "file" ? <span className="imp-tag warn">Repetida no arquivo</span> : null}
                                {row.past ? (
                                  <span className="imp-tag">
                                    <Clock className="h-3 w-3" aria-hidden />
                                    Já passou
                                  </span>
                                ) : null}
                                <span className={cx("pill imp-row-cat", meta.tint)}>{meta.short}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            ) : nothingNew && !reviewQ ? null : (
              <div className="imp-review-empty">
                {reviewQ && foundElsewhere ? (
                  // a busca acha datas em outro filtro: diz quantas e leva até elas, sem perder a busca
                  <div className="empty-inline compact" role="status">
                    <span className="empty-ico">
                      <Search className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink wrap-anywhere">
                        {`Nenhuma data de "${filterLabel}" com "${reviewQuery.trim()}"`}
                      </p>
                      <p className="mt-0.5 text-sm leading-5 text-muted wrap-anywhere">
                        {`Em Todas, ${foundElsewhere === 1 ? "1 data tem" : `${foundElsewhere} datas têm`} esse texto.`}
                      </p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <button
                          className={cx(secondaryButton, "btn-sm")}
                          onClick={() => {
                            // o botão some com o vazio: o foco vai para o filtro, que agora diz "Todas"
                            chooseFilter("all");
                            window.requestAnimationFrame(() => reviewEntryRef.current?.focus());
                          }}
                          type="button"
                        >
                          Ver em Todas
                        </button>
                        <button className="btn btn-g btn-sm" onClick={() => changeReviewQuery("")} type="button">
                          Limpar busca
                        </button>
                      </div>
                    </div>
                  </div>
                ) : reviewQ ? (
                  <div role="status">
                    <EmptyState
                      compact
                      icon={Search}
                      text={`Nenhuma data com "${reviewQuery.trim()}"`}
                      action={{ label: "Limpar busca", onClick: () => changeReviewQuery("") }}
                    />
                  </div>
                ) : (
                  <EmptyState
                    compact
                    icon={ListChecks}
                    text="Nenhuma data neste filtro"
                    action={{ label: "Ver todas", onClick: () => chooseFilter("all") }}
                  />
                )}
              </div>
            )}

            {reviewAllGroups.length > 1 ? (
              <MonthNeighbors
                main="next"
                prev={reviewPos > 0 ? pagerTarget(reviewAllGroups[reviewPos - 1], (key) => goReviewMonth(key, true)) : null}
                next={
                  reviewPos >= 0 && reviewPos < reviewAllGroups.length - 1
                    ? pagerTarget(reviewAllGroups[reviewPos + 1], (key) => goReviewMonth(key, true))
                    : null
                }
              />
            ) : null}
          </div>

          {submitError ? (
            <div role="alert" className="imp-review-error">
              <div className="callout rose">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 wrap-anywhere">
                  <b className="block">A importação não foi feita. As datas continuam aqui para tentar de novo.</b>
                  {submitError}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </Drawer>

      {/* Datas de uma importação feita: só leitura, um mês por vez (abre no da próxima data), com Desfazer no pé */}
      <Drawer
        open={Boolean(viewing)}
        size="wide"
        busy={saving}
        title="Datas importadas"
        initialFocusRef={viewEntryRef}
        onClose={() => setViewing(null)}
        subtitle={
          viewing ? (
            <>
              <span className="imp-sub-src">{viewing.sourceName}</span>
              <span className="imp-sub-count">
                importado {atLabel(viewing.importedAt, now)}
                {viewUndone ? ", depois desfeito" : ""}
              </span>
            </>
          ) : null
        }
        footer={
          <>
            <p className="imp-foot-count">
              <span>
                {viewUndone ? (
                  <>
                    <b>{viewTotal}</b> {viewTotal === 1 ? "data trazida, nenhuma no calendário" : "datas trazidas, nenhuma no calendário"}
                  </>
                ) : viewEvents.length === viewTotal || !viewTotal ? (
                  <>
                    <b>{viewEvents.length}</b> {viewEvents.length === 1 ? "data no calendário" : "datas no calendário"}
                  </>
                ) : (
                  <>
                    <b>{viewEvents.length}</b> de {datesLabel(viewTotal)} no calendário
                  </>
                )}
              </span>
            </p>
            <button className={secondaryButton} onClick={() => setViewing(null)} type="button">
              Fechar
            </button>
            {onUndoImport && viewEvents.length ? (
              <button className={dangerButton} aria-disabled={busy || undefined} onClick={() => !busy && undoViewing()} type="button">
                <Undo2 className="h-4 w-4" aria-hidden />
                Desfazer importação
              </button>
            ) : null}
          </>
        }
      >
        <div className="imp-review">
          {viewEvents.length ? (
            <div className="imp-review-bar">
              <div className="imp-bar-top">
                <div className="chips chips-row imp-chips" role="group" aria-label="Filtrar as datas">
                  {viewFilterList.map(({ id, label, count, dot }) => {
                    const active = viewFilter === id;
                    return (
                      <button
                        key={id}
                        ref={active ? viewChipRef : undefined}
                        className={cx("chip", active && "all")}
                        aria-pressed={active}
                        onClick={() => chooseViewFilter(id)}
                        type="button"
                      >
                        {dot ? <span className={cx("dot", dot)} aria-hidden /> : null}
                        {label}
                        <span className="n">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <Select
                  buttonRef={viewSelectRef}
                  className="imp-filter-select"
                  ariaLabel="Mostrar"
                  value={viewFilter}
                  searchable={false}
                  options={viewFilterList.map(({ id, label, count }) => ({ value: id, label, count }))}
                  onChange={(value) => chooseViewFilter(value as ViewFilter)}
                />
                <DateSearch value={viewQuery} onChange={changeViewQuery} />
              </div>
              {viewPicker ? (
                <div className="imp-months">
                  <MonthPicker
                    {...monthPicker(viewAllGroups, viewMonthKey, (key) => goViewMonth(key, false))}
                    titleRef={viewPickRef}
                    noun={["data", "datas", "nenhuma data"]}
                  />
                </div>
              ) : null}
              {/* busca sem resultado: quem diz é o vazio da lista; aqui a linha não repete "Nenhuma data" */}
              {viewQ && viewVisible.length ? (
                <p className="imp-bulk-n imp-found" aria-live="polite">
                  {`${datesLabel(viewVisible.length)} com "${viewQuery.trim()}"${viewAllGroups.length > 1 ? ` em ${viewAllGroups.length} meses` : ""}`}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="imp-review-list">
            {viewGroups.length ? (
              viewGroups.map((group) => {
                const headId = `${baseId}-ver-${group.key}`;
                return (
                  <section key={group.key} ref={viewSectionRef} className="imp-month" aria-labelledby={headId}>
                    {/* com o seletor de mês logo acima ("Janeiro de 2027 / 2 datas"), o cabeçalho não se repete: o
                        nome do mês fica só para o leitor de tela */}
                    {viewPicker ? (
                      <h3 ref={viewHeadRef} className="imp-month-name sr-only" id={headId} tabIndex={-1}>
                        {group.label}
                      </h3>
                    ) : (
                      <div className="imp-month-head">
                        <h3 ref={viewHeadRef} className="imp-month-name drawer-h3" id={headId} tabIndex={-1}>
                          {group.label}
                        </h3>
                        <span className="imp-month-n">{datesLabel(group.items.length)}</span>
                      </div>
                    )}
                    <ul className="imp-rows">
                      {group.items.map(({ event, start, end, past }) => {
                        const meta = categoryMeta[event.category];
                        return (
                          <li key={event.id} className="imp-row is-view">
                            <DateCell start={start} end={end} />
                            <span className="imp-row-title">{event.title}</span>
                            <span className="imp-row-meta">
                              {past ? (
                                <span className="imp-tag">
                                  <Clock className="h-3 w-3" aria-hidden />
                                  Já passou
                                </span>
                              ) : null}
                              <span className={cx("pill imp-row-cat", meta.tint)}>{meta.short}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            ) : (
              <div className="imp-review-empty">
                {viewQ ? (
                  <div role="status">
                    <EmptyState
                      compact
                      icon={Search}
                      text={`Nenhuma data com "${viewQuery.trim()}"`}
                      action={{ label: "Limpar busca", onClick: () => changeViewQuery("") }}
                    />
                  </div>
                ) : viewUndone ? (
                  // desfeita: o que aconteceu, quantas datas ela trouxe e o caminho para as que estão no calendário
                  <EmptyState
                    icon={Undo2}
                    text="Importação desfeita"
                    hint={`${viewTotal === 1 ? "A data que ela trouxe saiu" : `As ${viewTotal} datas que ela trouxe saíram`} do calendário de todas as turmas. ${
                      viewRedone
                        ? `O mesmo calendário foi importado de novo ${formatOnDayAt(viewRedone.importedAt)}.`
                        : "Para tê-las de novo, importe o calendário outra vez."
                    }`}
                    action={
                      viewRedone
                        ? {
                            label: "Ver a importação nova",
                            onClick: () =>
                              openImport({
                                importId: viewRedone.id,
                                sourceName: viewRedone.sourceName,
                                importedAt: viewRedone.importedAt,
                                fallback: [],
                              }),
                          }
                        : undefined
                    }
                  />
                ) : (
                  <EmptyState
                    compact
                    icon={History}
                    text={viewTotal ? "As datas desta importação não estão mais no calendário" : "Esta importação não trouxe datas"}
                  />
                )}
              </div>
            )}

            {viewAllGroups.length > 1 ? (
              <MonthNeighbors
                main="next"
                prev={viewPos > 0 ? pagerTarget(viewAllGroups[viewPos - 1], (key) => goViewMonth(key, true)) : null}
                next={
                  viewPos >= 0 && viewPos < viewAllGroups.length - 1
                    ? pagerTarget(viewAllGroups[viewPos + 1], (key) => goViewMonth(key, true))
                    : null
                }
              />
            ) : null}
          </div>
        </div>
      </Drawer>

      {confirm ? (
        <ConfirmDialog
          confirm={confirm}
          busy={confirmBusy}
          onCancel={() => {
            if (!confirmBusy) {
              setConfirm(null);
            }
          }}
          onConfirm={() => {
            if (confirmBusy) {
              return;
            }
            setConfirmBusy(true);
            void Promise.resolve(confirm.action()).finally(() => {
              setConfirmBusy(false);
              setConfirm(null);
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** "Hoje", "Ontem" ou "dom, 01/11". */
function dayLabel(value: string, now: number) {
  const date = new Date(value);
  const diff = Math.round((startOfDay(new Date(now)).getTime() - startOfDay(date).getTime()) / 86400000);
  if (diff === 0) {
    return "Hoje";
  }
  if (diff === 1) {
    return "Ontem";
  }
  return formatShortDate(date);
}
