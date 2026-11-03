"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  CloudDownload,
  Copy,
  FileUp,
  History,
  ListChecks,
  Loader2,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { CalendarImportEventInput, CalendarImportInput } from "@/lib/api";
import { addDays, cx, errorMessage, formatOnDayAt, formatShortDate, formatShortDateTime, formatTime, startOfDay } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, CalendarImport, Category } from "@/lib/types";
import { InsightTile, delay, isOfficialDate } from "./dashboard-bits";
import { ConfirmDialog, EmptyState, Field, SectionTitle, type ConfirmState } from "./ui";

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

/** "qui, 20/11" ou "qui, 20/11, 19:00" (meia-noite e 23:59 contam como dia todo). */
function shortWhen(date: Date) {
  const day = `${weekdays[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes === 0 || minutes === 23 * 60 + 59 ? day : `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function rangeLabel(start: Date, end: Date | null) {
  if (!end || end.getTime() === start.getTime()) {
    return shortWhen(start);
  }
  const sameDay = startOfDay(start).getTime() === startOfDay(end).getTime();
  if (sameDay) {
    return `${shortWhen(start)} até ${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }
  return `${shortWhen(start)} até ${shortWhen(end)}`;
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

/** Exemplo usado quando a página não manda o seu (mesmo formato do calendário de demonstração). */
function buildDemoPayload(): CalendarImportInput {
  const today = startOfDay(new Date());
  const day = (offset: number, time: string) => {
    const date = addDays(today, offset);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
  };
  return {
    sourceName: "Calendário de demonstração",
    sourceUrl: "https://www.ifms.edu.br/",
    checksum: `demo-${day(0, "00:00").slice(0, 10)}`,
    events: [
      {
        title: "Semana acadêmica",
        description: "Evento institucional integrado ao calendário.",
        category: "institutional",
        startsAt: day(14, "00:00"),
        endsAt: day(16, "23:59"),
        color: "#2563eb",
      },
      {
        title: "Prazo final de ajuste de matrícula",
        description: "Data oficial da secretaria acadêmica.",
        category: "institutional",
        startsAt: day(18, "00:00"),
        color: "#0f766e",
      },
    ],
  };
}

/** Modelo para copiar, sempre com datas futuras. */
function buildTemplate() {
  const today = startOfDay(new Date());
  const iso = (offset: number) => {
    const date = addDays(today, offset);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const br = (offset: number) => {
    const date = addDays(today, offset);
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  };
  return JSON.stringify(
    {
      sourceName: "Calendário oficial do campus",
      events: [
        { title: "Início do semestre letivo", category: "institucional", startsAt: `${iso(30)}T07:00` },
        { title: "Feriado municipal", category: "feriado", startsAt: iso(45) },
        { title: "Recesso escolar", category: "recesso", startsAt: br(60), endsAt: br(64) },
      ],
    },
    null,
    2
  );
}

function DateList({ items }: { items: Array<{ key: string | number; title: string; category: Category; start: Date; end: Date | null }> }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((item) => {
        const meta = categoryMeta[item.category];
        return (
          <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line-2 bg-white px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-40 font-bold text-ink">{item.title}</span>
            <span className="text-ink-3">{rangeLabel(item.start, item.end)}</span>
            {meta ? <span className={cx("pill", meta.tint)}>{meta.short}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function SyncView({
  events,
  imports,
  isAdmin,
  saving,
  demoPayload,
  onImport,
  onImportJson,
  onOpenCalendar,
  onUndoImport,
}: {
  events: AcademicEvent[];
  imports: CalendarImport[];
  isAdmin: boolean;
  saving: boolean;
  /** Dados do "Usar dados de exemplo". Sem ele, a tela monta um exemplo próprio. */
  demoPayload?: CalendarImportInput;
  /** Importa e devolve o resultado; o texto colado só é limpo quando der certo. */
  onImport?: (payload: CalendarImportInput) => Promise<ImportOutcome>;
  /** Apaga os eventos criados por uma importação. */
  onUndoImport?: (ids: number[]) => Promise<boolean | void>;
  onOpenCalendar?: (filter?: { categories?: Category[] }) => void;
  /** Reserva antiga, sem onImport: importa sem esperar a resposta. */
  onImportJson?: (payload: CalendarImportInput) => void;
}) {
  const baseId = useId();
  const textId = `${baseId}-json`;
  const statusId = `${baseId}-status`;
  const formatId = `${baseId}-formato`;

  const [text, setText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileNote, setFileNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [openImportId, setOpenImportId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [resultFocus, setResultFocus] = useState(0);
  const [previewFocus, setPreviewFocus] = useState(0);
  // horário de referência fixado na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  const [template] = useState(buildTemplate);

  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);
  const rowButtons = useRef(new Map<number, HTMLButtonElement>());
  const focusAfterConfirm = useRef<HTMLElement | null>(null);

  const busy = importing || saving;
  const check = useMemo(() => validateImport(text, events, now), [text, events, now]);
  const rows = check.status === "ok" ? check.rows : [];
  const isPicked = (row: PreviewRow) => picked[row.key] ?? row.duplicate === null;
  const chosen = rows.filter(isPicked);
  const duplicates = rows.filter((row) => row.duplicate !== null).length;
  const pastChosen = chosen.filter((row) => row.past).length;
  const canImport = check.status === "ok" && chosen.length > 0;

  // mesmo calendário já importado: vale o que ainda tem datas no calendário; se todas saíram, foi desfeito
  const sameSource =
    check.status === "ok"
      ? imports.filter(
          (item) =>
            (item.checksum && item.checksum === check.checksum) ||
            (check.namedSource && normalize(item.sourceName) === normalize(check.sourceName))
        )
      : [];
  const hasDates = (item: CalendarImport) => events.some((event) => event.calendarImportId === item.id);
  const previous = sameSource.find(hasDates) ?? sameSource[0] ?? null;
  const previousUndone = previous !== null && previous.totalEvents > 0 && !hasDates(previous);

  // mesma regra do Painel e do Cronograma ("Datas oficiais à frente")
  const officialAhead = events.filter(
    (event) =>
      isOfficialDate(event) &&
      event.status !== "cancelled" &&
      event.status !== "completed" &&
      new Date(event.startsAt).getTime() >= now
  ).length;
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

  useEffect(() => {
    if (resultFocus) {
      resultRef.current?.focus();
    }
  }, [resultFocus]);

  useEffect(() => {
    if (previewFocus) {
      previewRef.current?.focus();
    }
  }, [previewFocus]);

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
  }

  function fillExample() {
    changeText(JSON.stringify(demoPayload ?? buildDemoPayload(), null, 2));
    setPicked({});
    setFileNote(null);
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > 1_000_000) {
      setFileNote({ tone: "err", text: "O arquivo passa de 1 MB. Divida as datas em arquivos menores." });
      return;
    }
    try {
      changeText(await file.text());
      setPicked({});
      setFileNote({ tone: "ok", text: `Arquivo carregado: ${file.name}` });
    } catch {
      setFileNote({ tone: "err", text: "Não foi possível ler o arquivo. Tente de novo ou cole o texto." });
    }
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(template);
      setCopyNote("Modelo copiado. Cole no campo acima e troque pelos dados do calendário.");
    } catch {
      setCopyNote("Não foi possível copiar. Selecione o modelo abaixo e copie.");
    }
  }

  function openPreview() {
    if (check.status !== "ok") {
      return;
    }
    setPreviewOpen(true);
    setPreviewFocus((value) => value + 1);
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
      setPreviewOpen(false);
      return;
    }

    setImporting(true);
    try {
      const outcome = await onImport(payload);
      if (outcome.ok) {
        setText("");
        setPicked({});
        setPreviewOpen(false);
        setFileNote(null);
        setLastResult({
          importId: outcome.result?.import?.id ?? null,
          sourceName: check.sourceName,
          importedAt: outcome.result?.import?.importedAt ?? new Date().toISOString(),
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

  function askUndo(ids: number[], titles: string[], sourceName: string, after: () => void) {
    if (!onUndoImport || !ids.length) {
      return;
    }
    const names = titles.slice(0, 4).join(", ") + (titles.length > 4 ? ` e mais ${titles.length - 4}` : "");
    setConfirm({
      title: "Desfazer importação?",
      message: `${datesLabel(ids.length)} de "${sourceName}" ${ids.length === 1 ? "sai" : "saem"} do calendário de todas as turmas: ${names}.`,
      confirmLabel: "Desfazer importação",
      action: async () => {
        const ok = await onUndoImport(ids);
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
    askUndo(
      lastResult.events.map((event) => event.id),
      lastResult.events.map((event) => event.title),
      lastResult.sourceName,
      () => {
        setLastResult((current) => (current ? { ...current, undone: true } : current));
        focusAfterConfirm.current = resultRef.current;
      }
    );
  }

  const tiles = (
    <div className={cx("grid gap-4", isAdmin && "sm:grid-cols-2")}>
      {isAdmin ? (
        <InsightTile
          icon={History}
          label="Última importação"
          value={lastImport ? dayLabel(lastImport.importedAt, now) : "Nunca"}
          tone="c-ativ"
          hint={lastImport ? `às ${formatTime(lastImport.importedAt)}, ${lastImport.sourceName}` : "Nenhuma importação ainda."}
          order={0}
        />
      ) : null}
      <InsightTile
        icon={ShieldCheck}
        label="Datas oficiais à frente"
        value={String(officialAhead)}
        tone="c-inst"
        hint="Datas oficiais aparecem para todas as turmas."
        order={1}
      />
    </div>
  );

  if (!isAdmin) {
    return (
      <div className="grid gap-5">
        {tiles}
        <section className="card pad rise" style={delay(2)} aria-label="Importar calendário">
          <SectionTitle title="Importar calendário" subtitle="Só a administração importa o calendário oficial." />
          <p className="callout blue mt-4">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            As datas oficiais já aparecem no Cronograma para todas as turmas.
          </p>
        </section>
      </div>
    );
  }

  const statusTone = check.status === "ok" ? "font-semibold text-brand-ink" : "";
  const statusText =
    check.status === "empty"
      ? "Cole o conteúdo do arquivo, escolha um arquivo .json ou use os dados de exemplo."
      : check.status === "error"
        ? check.message
        : `${datesLabel(rows.length)} ${rows.length === 1 ? "pronta" : "prontas"} para conferir.${
            duplicates ? ` ${duplicates === 1 ? "1 já existe" : `${duplicates} já existem`} no calendário.` : ""
          }`;

  return (
    <div className="grid gap-5">
      {tiles}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="card pad rise min-w-0" style={delay(2)} aria-label="Importar calendário">
          <SectionTitle title="Importar calendário" subtitle="Datas oficiais aparecem para todas as turmas." />

          <div className="mt-5 grid gap-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <button className="btn btn-s" onClick={() => fileRef.current?.click()} type="button">
                <FileUp className="h-4 w-4" aria-hidden />
                Escolher arquivo .json
              </button>
              <button className="link min-h-11" onClick={fillExample} type="button">
                Usar dados de exemplo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => void readFile(event)}
              />
            </div>
            {fileNote ? (
              <p
                role={fileNote.tone === "err" ? "alert" : "status"}
                className={cx("text-sm", fileNote.tone === "err" ? "font-semibold text-[var(--danger)]" : "text-ink-3")}
              >
                {fileNote.text}
              </p>
            ) : null}

            <div>
              <Field label="Dados do calendário (JSON)" hint="cole o texto do arquivo">
                <textarea
                  id={textId}
                  className="input field-sizing-content min-h-44 max-h-[32rem] font-mono text-[13px]"
                  value={text}
                  onChange={(event) => changeText(event.target.value)}
                  placeholder="Cole aqui o conteúdo do arquivo do calendário."
                  aria-describedby={`${statusId} ${formatId}`}
                  aria-invalid={check.status === "error" ? true : undefined}
                  spellCheck={false}
                />
              </Field>
              <p
                id={statusId}
                aria-live="polite"
                className={check.status === "error" ? "field-error" : cx("field-help flex items-start gap-1.5", statusTone)}
              >
                {check.status === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                {check.status === "error" ? <AlertTriangle aria-hidden /> : null}
                <span>{statusText}</span>
              </p>
              <p id={formatId} className="field-help">
                Cada data precisa de title, category e startsAt. Veja abaixo como montar o arquivo.
              </p>
            </div>

            {!previewOpen ? (
              <div>
                <button className="btn btn-p w-full sm:w-auto" disabled={check.status !== "ok" || busy} onClick={openPreview} type="button">
                  <ListChecks className="h-4 w-4" aria-hidden />
                  Conferir datas
                </button>
              </div>
            ) : (
              <div className="grid gap-3 rounded-2xl border border-line-2 bg-surface-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 ref={previewRef} tabIndex={-1} className="text-[16px] font-bold outline-none">
                    Conferir datas
                  </h3>
                  {check.status === "ok" ? <p className="text-sm text-ink-3">Fonte: {check.sourceName}</p> : null}
                </div>

                {check.status === "ok" ? (
                  <>
                    {previous && previousUndone ? (
                      // as datas daquela importação saíram do calendário: não há repetida a evitar
                      <p className="callout blue">
                        <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>Esse calendário foi importado {formatOnDayAt(previous.importedAt)} e depois desfeito.</span>
                      </p>
                    ) : previous ? (
                      <p className="callout amber">
                        <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>
                          Esse calendário já foi importado {formatOnDayAt(previous.importedAt)}.
                          {duplicates ? " As datas que já existem ficaram desmarcadas." : ""}
                        </span>
                      </p>
                    ) : null}
                    <ul className="grid gap-2">
                      {rows.map((row) => {
                        const meta = categoryMeta[row.category];
                        const inputId = `${baseId}-linha-${row.index}`;
                        return (
                          <li key={row.key} className={cx("flex items-start gap-3 rounded-xl border bg-white p-3", isPicked(row) ? "border-line" : "border-line-2")}>
                            <input
                              id={inputId}
                              type="checkbox"
                              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                              checked={isPicked(row)}
                              disabled={busy}
                              onChange={(event) => setPicked((current) => ({ ...current, [row.key]: event.target.checked }))}
                            />
                            <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
                              <span className={cx("block text-[15px] font-bold leading-snug", !isPicked(row) && "text-ink-3")}>{row.title}</span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-3">
                                <span className={cx("pill", meta.tint)}>{meta.short}</span>
                                <span>{rangeLabel(row.start, row.end)}</span>
                                {row.duplicate === "existing" ? <span className="pill stat">Já existe</span> : null}
                                {row.duplicate === "file" ? <span className="pill stat">Repetida no arquivo</span> : null}
                                {row.past ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5" aria-hidden />
                                    Já passou
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-sm text-ink-3">
                      {chosen.length === rows.length
                        ? `${datesLabel(rows.length)} para importar.`
                        : `${chosen.length} de ${datesLabel(rows.length)} marcadas para importar.`}
                      {duplicates && !chosen.length ? " Todas já existem. Marque alguma se quiser importar mesmo assim." : ""}
                      {pastChosen ? ` ${pastChosen === 1 ? "1 data já passou e aparece" : `${pastChosen} datas já passaram e aparecem`} só em Passados.` : ""}
                    </p>
                  </>
                ) : (
                  <p className="callout rose">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {check.status === "error"
                      ? "Os dados têm um problema. Corrija o que aparece embaixo do campo para conferir as datas."
                      : "Cole os dados do calendário para conferir."}
                  </p>
                )}

                {submitError ? (
                  <div role="alert" className="callout rose">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      <b className="block">A importação não foi feita. O texto continua no campo.</b>
                      {submitError}
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                  <button
                    className="btn btn-p w-full sm:w-auto"
                    disabled={!canImport}
                    aria-disabled={busy || undefined}
                    onClick={() => void runImport()}
                    type="button"
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudDownload className="h-4 w-4" aria-hidden />}
                    {importing
                      ? "Importando"
                      : check.status !== "ok"
                        ? "Importar datas"
                        : chosen.length
                          ? `Importar ${datesLabel(chosen.length)}`
                          : "Nenhuma data marcada"}
                  </button>
                  <button className="btn btn-s w-full sm:w-auto" disabled={importing} onClick={() => setPreviewOpen(false)} type="button">
                    Fechar prévia
                  </button>
                </div>
              </div>
            )}

            <details className="group rounded-2xl border border-line-2 px-4 py-3">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-[14.5px] font-bold [&::-webkit-details-marker]:hidden">
                Como montar o arquivo
                <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="mt-3 grid gap-3 text-sm leading-6 text-ink-3">
                <p>Um objeto com o nome da fonte e a lista de datas. Também vale colar só a lista.</p>
                <div className="rounded-xl border border-line">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">Campo</th>
                        <th scope="col">Como preencher</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="font-mono">sourceName</td>
                        <td>Nome da fonte, de 3 a 120 caracteres. Opcional.</td>
                      </tr>
                      <tr>
                        <td className="font-mono">events</td>
                        <td>Lista com as datas. Obrigatório.</td>
                      </tr>
                      <tr>
                        <td className="font-mono">title</td>
                        <td>Título da data, de 3 a 140 caracteres. Obrigatório.</td>
                      </tr>
                      <tr>
                        <td className="font-mono">category</td>
                        <td>{categoryHelp}. Obrigatório.</td>
                      </tr>
                      <tr>
                        <td className="font-mono">startsAt</td>
                        <td>Início: {dateHelp}. Obrigatório.</td>
                      </tr>
                      <tr>
                        <td className="font-mono">endsAt</td>
                        <td>Término, no mesmo formato e depois do início. Só o dia vale até 23:59. Opcional.</td>
                      </tr>
                      <tr>
                        <td className="font-mono">description, location</td>
                        <td>Descrição e local. Opcionais.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button className="btn btn-s btn-sm" onClick={() => void copyTemplate()} type="button">
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Copiar modelo
                  </button>
                  {copyNote ? (
                    <span role="status" className="text-sm">
                      {copyNote}
                    </span>
                  ) : null}
                </div>
                <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 p-3 font-mono text-[12.5px] leading-5 text-ink-2">
                  {template}
                </pre>
              </div>
            </details>
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          {lastResult ? (
            <section
              ref={resultRef}
              tabIndex={-1}
              className="card pad rise outline-none"
              aria-label={resultUndone ? "Importação desfeita" : "Resultado da importação"}
            >
              <div className="flex items-start gap-3">
                <span className={cx("kpi-ico shrink-0", resultUndone && "c-ativ")}>
                  {resultUndone ? <Undo2 className="h-[18px] w-[18px]" aria-hidden /> : <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <h2 className="h2">
                    {resultUndone ? "Importação desfeita" : `${datesLabel(resultCount)} ${resultCount === 1 ? "importada" : "importadas"}`}
                  </h2>
                  <p className="sub">
                    {resultUndone
                      ? `As datas de "${lastResult.sourceName}" saíram do calendário.`
                      : `De "${lastResult.sourceName}", ${formatOnDayAt(lastResult.importedAt)}.`}
                  </p>
                </div>
              </div>

              {!resultUndone && lastResult.events.length ? (
                <>
                  <div className="mt-4">
                    <DateList
                      items={[...lastResult.events]
                        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
                        .map((event) => ({
                          key: event.id,
                          title: event.title,
                          category: event.category,
                          start: new Date(event.startsAt),
                          end: event.endsAt ? new Date(event.endsAt) : null,
                        }))}
                    />
                  </div>
                  {resultPast ? (
                    <p className="callout amber mt-3">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {resultPast === 1 ? "1 data já passou e aparece só em Passados." : `${resultPast} datas já passaram e aparecem só em Passados.`}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
                    {onOpenCalendar ? (
                      <button
                        className="btn btn-s w-full sm:w-auto"
                        onClick={() => onOpenCalendar({ categories: [...new Set(lastResult.events.map((event) => event.category))] })}
                        type="button"
                      >
                        Ver no cronograma
                      </button>
                    ) : null}
                    {onUndoImport ? (
                      <button className="btn btn-danger w-full sm:w-auto" disabled={busy} onClick={undoLastResult} type="button">
                        <Undo2 className="h-4 w-4" aria-hidden />
                        Desfazer importação
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}

          <section className="card pad rise flex-1" style={delay(3)} aria-label="Importações">
            <SectionTitle title="Importações" subtitle="Abra uma importação para ver as datas que ela trouxe." />
            {imports.length ? (
              <div className="mt-4 rounded-2xl border border-line">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col" className="px-3 @min-[400px]:px-4">
                        Fonte
                      </th>
                      <th scope="col" className="hidden whitespace-nowrap px-3 @min-[400px]:table-cell @min-[400px]:px-4">
                        Importado em
                      </th>
                      <th scope="col" className="px-3 text-right @min-[400px]:px-4">
                        Datas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((item) => {
                      const current = events
                        .filter((event) => event.calendarImportId === item.id)
                        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
                      const open = openImportId === item.id;
                      const detailsId = `${baseId}-importacao-${item.id}`;
                      return (
                        <Fragment key={item.id}>
                          <tr className={cx(open && "bg-surface-2")}>
                            <td className="px-3 @min-[400px]:px-4">
                              <button
                                ref={(node) => {
                                  if (node) {
                                    rowButtons.current.set(item.id, node);
                                  } else {
                                    rowButtons.current.delete(item.id);
                                  }
                                }}
                                className="flex w-full items-start gap-2 rounded-lg text-left"
                                aria-expanded={open}
                                aria-controls={detailsId}
                                onClick={() => setOpenImportId(open ? null : item.id)}
                                type="button"
                              >
                                <ChevronDown className={cx("mt-0.5 h-4 w-4 shrink-0 text-muted transition", open && "rotate-180")} aria-hidden />
                                <span className="min-w-0">
                                  <span className="t block break-words">{item.sourceName}</span>
                                  <span className="s block @min-[400px]:hidden">{formatShortDateTime(item.importedAt)}</span>
                                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                                    <span className="pill stat">
                                      {item.status === "failed" ? "Falhou" : current.length || !item.totalEvents ? "Concluída" : "Desfeita"}
                                    </span>
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td className="hidden whitespace-nowrap px-3 @min-[400px]:table-cell @min-[400px]:px-4">
                              {formatShortDateTime(item.importedAt)}
                            </td>
                            <td className="whitespace-nowrap px-3 text-right @min-[400px]:px-4">
                              {current.length} de {item.totalEvents}
                            </td>
                          </tr>
                          {open ? (
                            <tr id={detailsId} className="bg-surface-2">
                              <td colSpan={3} className="px-3 pt-0 @min-[400px]:px-4">
                                {current.length ? (
                                  <div className="grid gap-3">
                                    <DateList
                                      items={current.map((event) => ({
                                        key: event.id,
                                        title: event.title,
                                        category: event.category,
                                        start: new Date(event.startsAt),
                                        end: event.endsAt ? new Date(event.endsAt) : null,
                                      }))}
                                    />
                                    {onUndoImport ? (
                                      <div>
                                        <button
                                          className="btn btn-danger btn-sm"
                                          disabled={busy}
                                          onClick={() =>
                                            askUndo(
                                              current.map((event) => event.id),
                                              current.map((event) => event.title),
                                              item.sourceName,
                                              () => {
                                                focusAfterConfirm.current = rowButtons.current.get(item.id) ?? null;
                                              }
                                            )
                                          }
                                          type="button"
                                        >
                                          <Undo2 className="h-3.5 w-3.5" aria-hidden />
                                          Desfazer importação
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <p className="text-sm text-ink-3">
                                    {item.totalEvents
                                      ? "As datas desta importação não estão mais no calendário."
                                      : "Esta importação não trouxe datas."}
                                  </p>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState icon={History} text="Nenhuma importação ainda." hint="Use os dados de exemplo para testar a importação." />
              </div>
            )}
          </section>
        </div>
      </div>

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
