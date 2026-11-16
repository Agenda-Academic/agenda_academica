"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleCheckBig,
  Clock,
  CloudDownload,
  FileText,
  FileUp,
  History,
  Loader2,
  Lock,
  ShieldCheck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { ApiError, type CalendarImportEventInput, type CalendarImportInput, type CalendarPdfResult } from "@/lib/api";
import { cx, errorMessage, formatOnDayAt, formatShortDate, formatShortDateTime, formatTime, startOfDay } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, CalendarImport, Category } from "@/lib/types";
import { delay, isOfficialDate, officialCategories } from "./dashboard-bits";
import { useSideFit } from "./reminders-view";
import { ConfirmDialog, EmptyState, type ConfirmState } from "./ui";

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

/** Situação da importação: desfeita quando trouxe datas e nenhuma está mais no calendário. */
function importState(item: CalendarImport, current: number) {
  if (item.status === "failed") {
    return { label: "Falhou", pill: "st-canc" };
  }
  if (!current && item.totalEvents > 0) {
    return { label: "Desfeita", pill: "st-ag" };
  }
  return { label: "Concluída", pill: "st-conc" };
}

/** Indicador do alto, como no Figma: rótulo, valor curto e dica. */
function ImportTile({
  hint,
  icon: Icon,
  label,
  order,
  tone,
  value,
}: {
  hint: string;
  icon?: LucideIcon;
  label: string;
  order: number;
  tone?: "ok" | "warn";
  value: string;
}) {
  return (
    <div className={cx("card kpi rise", tone && `imp-kpi-${tone}`)} style={delay(order)}>
      <p className="kpi-label">{label}</p>
      <p className="imp-kpi-val">
        {Icon ? <Icon className="h-[22px] w-[22px] shrink-0" aria-hidden /> : null}
        {value}
      </p>
      <p className="kpi-hint wrap-anywhere">{hint}</p>
    </div>
  );
}

function DateList({ items }: { items: Array<{ key: string | number; title: string; category: Category; start: Date; end: Date | null }> }) {
  return (
    <ul className="grid grid-cols-1 gap-1.5">
      {items.map((item) => {
        const meta = categoryMeta[item.category];
        return (
          <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line-2 bg-white px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 basis-40 font-bold text-ink wrap-anywhere">{item.title}</span>
            <span className="text-ink-3">{rangeLabel(item.start, item.end)}</span>
            {meta ? <span className={cx("pill", meta.tint)}>{meta.short}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

const byStart = (a: AcademicEvent, b: AcademicEvent) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

/** Quantas importações a tabela mostra antes do "Ver todas (N)". */
const IMPORTS_PREVIEW = 5;

/** PDF de exemplo (Calendário Acadêmico 2027, Campus Três Lagoas), para ver a importação na demonstração. */
const SAMPLE_PDF_URL = "/exemplos/calendario-academico-2027.pdf";

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
  /** Importa e devolve o resultado; o texto colado só é limpo quando der certo. */
  onImport?: (payload: CalendarImportInput) => Promise<ImportOutcome>;
  /** Apaga os eventos criados por uma importação. */
  onUndoImport?: (ids: number[]) => Promise<boolean | void>;
  onOpenCalendar?: (filter?: { categories?: Category[] }) => void;
  /** Reserva antiga, sem onImport: importa sem esperar a resposta. */
  onImportJson?: (payload: CalendarImportInput) => void;
}) {
  const baseId = useId();
  const demoTitleId = `${baseId}-demo`;
  const pdfTitleId = `${baseId}-pdf`;
  const pdfHintId = `${baseId}-pdf-dica`;
  const resultTitleId = `${baseId}-resultado`;
  const accessId = `${baseId}-acesso`;
  const prioId = `${baseId}-prioridade`;
  const fieldsId = `${baseId}-campos`;
  const histId = `${baseId}-historico`;
  const restrictedId = `${baseId}-restrito`;

  const [text, setText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [openImportId, setOpenImportId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [resultFocus, setResultFocus] = useState(0);
  const [previewFocus, setPreviewFocus] = useState(0);
  // horário de referência fixado na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  // "Ver todas (N)": a tabela mostra as últimas importações e abre o resto ali mesmo
  const [showAllImports, setShowAllImports] = useState(false);

  const [pdfReading, setPdfReading] = useState(false);
  // baixando o PDF de exemplo (depois a leitura segue como a de qualquer PDF)
  const [sampleLoading, setSampleLoading] = useState(false);
  const [pdfDragging, setPdfDragging] = useState(false);
  const [pdfNote, setPdfNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const handledPdf = useRef<number | null>(null);

  const resultRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);
  const rowButtons = useRef(new Map<number, HTMLButtonElement>());
  const focusAfterConfirm = useRef<HTMLElement | null>(null);
  const moreImportsRef = useRef<HTMLButtonElement>(null);
  // tabela que acabou de abrir (com a primeira importação que apareceu) ou de fechar
  const importsToggled = useRef<{ firstNew: number | null } | null>(null);
  // a coluna lateral termina junto da principal (ou fica parada no alto, se ela for bem mais alta)
  const mainColRef = useRef<HTMLDivElement>(null);
  const { sideRef, gapRef, stuck } = useSideFit(mainColRef, isAdmin);

  const busy = importing || saving;
  const check = useMemo(() => validateImport(text, events, now), [text, events, now]);
  const rows = check.status === "ok" ? check.rows : [];
  const isPicked = (row: PreviewRow) => picked[row.key] ?? row.duplicate === null;
  const chosen = rows.filter(isPicked);
  const duplicates = rows.filter((row) => row.duplicate !== null).length;
  const pastChosen = chosen.filter((row) => row.past).length;
  const canImport = check.status === "ok" && chosen.length > 0;

  // datas que a importação ainda tem no calendário
  const datesOf = (item: CalendarImport) => events.filter((event) => event.calendarImportId === item.id).sort(byStart);
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
  const previous = sameSource.find((item) => datesOf(item).length > 0) ?? null;
  const undonePrevious = previous ? null : (sameSource.find((item) => item.totalEvents > 0) ?? null);

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
  // desfeita por outro caminho (aviso com Desfazer ou tabela): a importação já está na lista e não tem mais datas
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

  // "Ver todas": o foco vai para a primeira importação que apareceu; "Mostrar menos": o botão continua à vista
  useEffect(() => {
    const target = importsToggled.current;
    if (!target) {
      return;
    }
    importsToggled.current = null;
    const first = target.firstNew !== null ? rowButtons.current.get(target.firstNew) : null;
    if (first) {
      first.focus();
    } else {
      moreImportsRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [showAllImports]);

  function toggleImports() {
    const open = !showAllImports;
    importsToggled.current = { firstNew: open ? (imports[IMPORTS_PREVIEW]?.id ?? null) : null };
    setShowAllImports(open);
  }

  function changeText(value: string) {
    setText(value);
    setSubmitError(null);
    // texto novo: o resultado da importação anterior sai de baixo do campo
    setLastResult(null);
  }

  /**
   * PDF do Calendário Acadêmico: a API lê as datas e a prévia abre para conferir (por dentro, as datas seguem a
   * mesma validação de sempre). Assuntos só de servidores (PIT, RAD, diários) vêm desmarcados.
   */
  async function readPdf(file: File | undefined) {
    if (!file || !onReadPdf || pdfReading) {
      return;
    }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      setPdfNote({ tone: "err", text: "O arquivo precisa ser um PDF. Use o PDF do Calendário Acadêmico publicado pela instituição." });
      return;
    }
    if (file.size > 10_000_000) {
      setPdfNote({ tone: "err", text: "O PDF passa de 10 MB." });
      return;
    }
    setPdfReading(true);
    setPdfNote(null);
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
      const staff = new Set(result.events.flatMap((event, index) => (event.audience === "staff" ? [index] : [])));
      const checked = validateImport(json, events, now);
      const nextPicked: Record<string, boolean> = {};
      if (checked.status === "ok") {
        for (const row of checked.rows) {
          if (staff.has(row.index)) nextPicked[row.key] = false;
        }
      }
      changeText(json);
      setPicked(nextPicked);
      const unchecked = staff.size
        ? ` ${staff.size === 1 ? "1 assunto só de servidores ficou desmarcado" : `${staff.size} assuntos só de servidores ficaram desmarcados`} (PIT, RAD, diários).`
        : "";
      setPdfNote({ tone: "ok", text: `${datesLabel(result.events.length)} lidas de ${file.name}.${unchecked} Confira em Conferir datas.` });
      setPreviewOpen(true);
      setPreviewFocus((value) => value + 1);
    } catch (err) {
      // a API explica o que houve com o arquivo (422) em português; o resto usa a frase padrão
      const message = err instanceof ApiError && err.status === 422 && err.message ? err.message : errorMessage(err);
      setPdfNote({ tone: "err", text: message });
    } finally {
      setPdfReading(false);
    }
  }

  /** "Ler o PDF de exemplo": baixa o PDF que vem com o sistema e lê como se ele tivesse sido arrastado. */
  async function readSamplePdf() {
    if (busy || pdfReading || sampleLoading) {
      return;
    }
    setSampleLoading(true);
    setPdfNote(null);
    let file: File;
    try {
      const response = await fetch(SAMPLE_PDF_URL);
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      file = new File([await response.blob()], "calendario-academico-2027.pdf", { type: "application/pdf" });
    } catch {
      setPdfNote({ tone: "err", text: "Não deu para abrir o PDF de exemplo. Tente de novo." });
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
        setPdfNote(null);
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

  if (!isAdmin) {
    // a tela é da administração; quem chega aqui por outro caminho vê o porquê (Figma, Estados e feedback)
    return (
      <section className="card pad rise" aria-labelledby={restrictedId}>
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

  return (
    <div className="grid gap-5">
      <div className="kpis">
        <ImportTile label="Fonte" value="Reitoria" hint="calendário letivo oficial" order={0} />
        <ImportTile
          label="Última importação"
          value={lastImport ? dayLabel(lastImport.importedAt, now) : "Nunca"}
          hint={lastImport ? `às ${formatTime(lastImport.importedAt)}, ${lastImport.sourceName}` : "nenhuma importação ainda"}
          order={1}
        />
        <ImportTile
          label="Eventos oficiais"
          value={`${officialAhead} ${officialAhead === 1 ? "futuro" : "futuros"}`}
          hint="visíveis para todas as turmas"
          order={2}
        />
        <ImportTile
          label="Situação"
          value={upToDate ? "Em dia" : "Falta importar"}
          hint={upToDate ? "nenhuma pendência de importação" : "nenhum evento oficial à frente"}
          icon={upToDate ? CircleCheckBig : AlertTriangle}
          tone={upToDate ? "ok" : "warn"}
          order={3}
        />
      </div>

      {/* a coluna principal e a lateral terminam juntas: a sobra fica no pé de Como funciona */}
      <div className={cx("tela-cols", stuck && "is-stuck")}>
        <div ref={mainColRef} className="tela-main">
          {onReadPdf ? (
            <section className="card pad rise imp-pdf-card min-w-0" style={delay(4)} aria-labelledby={pdfTitleId}>
              <div className="flex min-w-0 items-start gap-[18px]">
                <span className="imp-ico pdf" aria-hidden>
                  <FileText className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <h2 className="h2" id={pdfTitleId}>
                    Calendário acadêmico em PDF
                  </h2>
                  <p className="sub">Arraste o PDF do calendário publicado pela instituição. As datas aparecem para conferir antes de gravar.</p>
                </div>
              </div>
              <div
                className={cx("imp-pdf-drop mt-[18px]", pdfDragging && "is-over", pdfNote?.tone === "err" && "is-bad")}
                onDragLeave={() => setPdfDragging(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setPdfDragging(true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setPdfDragging(false);
                  void readPdf(event.dataTransfer.files?.[0]);
                }}
              >
                <span className="mini-ico">
                  {pdfReading ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <FileUp className="h-[18px] w-[18px]" aria-hidden />}
                </span>
                <div className="imp-pdf-main">
                  <p className="text-sm font-semibold text-ink">
                    {pdfReading ? "Lendo o calendário" : "Arraste o PDF para cá ou use o botão Escolher PDF"}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted" id={pdfHintId}>
                    O PDF oficial, com os meses e as datas listadas, como o de 2027. Até 10 MB.
                  </p>
                </div>
                <button
                  className="btn btn-s btn-sm shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                  aria-busy={pdfReading || undefined}
                  aria-disabled={pdfReading || undefined}
                  aria-describedby={pdfHintId}
                  onClick={() => {
                    if (!pdfReading) pdfRef.current?.click();
                  }}
                  type="button"
                >
                  Escolher PDF
                </button>
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
              {pdfNote ? (
                <p
                  role={pdfNote.tone === "err" ? "alert" : "status"}
                  className={cx("mt-2 text-sm wrap-anywhere", pdfNote.tone === "err" ? "font-semibold text-[var(--danger)]" : "text-ink-3")}
                >
                  {pdfNote.text}
                </p>
              ) : null}
            </section>
          ) : null}

          {onReadPdf ? (
            <section className="card pad rise imp-demo" style={delay(4)} aria-labelledby={demoTitleId}>
              <span className="imp-ico" aria-hidden>
                <FileText className="h-6 w-6" />
              </span>
              <div className="imp-demo-text">
                <h2 className="h2" id={demoTitleId}>
                  Calendário de exemplo
                </h2>
                <p className="sub">
                  Lê o Calendário Acadêmico 2027 do Campus Três Lagoas, para ver como a importação funciona. Nada é gravado antes
                  de você conferir.
                </p>
              </div>
              <button
                className="btn btn-p aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                aria-busy={sampleLoading || undefined}
                aria-disabled={busy || pdfReading || sampleLoading || undefined}
                onClick={() => void readSamplePdf()}
                type="button"
              >
                {sampleLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
                Ler o PDF de exemplo
              </button>
              <a className="btn btn-s" href={SAMPLE_PDF_URL} target="_blank" rel="noopener">
                <FileText className="h-4 w-4" aria-hidden />
                Abrir o PDF
              </a>
            </section>
          ) : null}

          {previewOpen || lastResult ? (
            <section className="card pad rise min-w-0" style={delay(5)} aria-label="Conferir e importar datas">
              {previewOpen ? (
                <div className="grid grid-cols-1 gap-3 rounded-2xl border border-line-2 bg-surface-2 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 ref={previewRef} tabIndex={-1} className="text-[16px] font-bold outline-none">
                      Conferir datas
                    </h3>
                    {check.status === "ok" ? <p className="min-w-0 text-sm text-ink-3 wrap-anywhere">Fonte: {check.sourceName}</p> : null}
                  </div>

                  {check.status === "ok" ? (
                    <>
                      {previous ? (
                        <p className="callout amber">
                          <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span>
                            Esse calendário já foi importado {formatOnDayAt(previous.importedAt)}.
                            {duplicates ? " As datas que já existem ficaram desmarcadas." : ""}
                          </span>
                        </p>
                      ) : undonePrevious ? (
                        // as datas daquela importação saíram do calendário: não há repetida a evitar
                        <p className="callout blue">
                          <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          <span>Esse calendário foi importado {formatOnDayAt(undonePrevious.importedAt)} e depois desfeito.</span>
                        </p>
                      ) : null}
                      <ul className="grid grid-cols-1 gap-2">
                        {rows.map((row) => {
                          const meta = categoryMeta[row.category];
                          const inputId = `${baseId}-linha-${row.index}`;
                          return (
                            <li
                              key={row.key}
                              className={cx("flex items-start gap-3 rounded-xl border bg-white p-3", isPicked(row) ? "border-line" : "border-line-2")}
                            >
                              <input
                                id={inputId}
                                type="checkbox"
                                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                                checked={isPicked(row)}
                                disabled={busy}
                                onChange={(event) => setPicked((current) => ({ ...current, [row.key]: event.target.checked }))}
                              />
                              <label htmlFor={inputId} className="min-w-0 flex-1 cursor-pointer">
                                <span className={cx("block text-[15px] font-bold leading-snug wrap-anywhere", !isPicked(row) && "text-ink-3")}>{row.title}</span>
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
                        {pastChosen
                          ? ` ${pastChosen === 1 ? "1 data já passou e aparece" : `${pastChosen} datas já passaram e aparecem`} só em Passados.`
                          : ""}
                      </p>
                    </>
                  ) : (
                    <p className="callout rose">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      Não deu para conferir as datas deste PDF. Escolha o arquivo de novo.
                    </p>
                  )}

                  {submitError ? (
                    <div role="alert" className="callout rose">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 wrap-anywhere">
                        <b className="block">A importação não foi feita. As datas continuam aqui para tentar de novo.</b>
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
              ) : null}
              {lastResult ? (
                <section
                  ref={resultRef}
                  tabIndex={-1}
                  className={cx(
                    "rounded-2xl border p-4 outline-none",
                    resultUndone ? "border-line-2 bg-surface-2" : "border-brand-200 bg-brand-50"
                  )}
                  aria-labelledby={resultTitleId}
                >
                  <div className="flex items-start gap-3">
                    <span className={cx("kpi-ico shrink-0", resultUndone ? "c-ativ" : "bg-white")}>
                      {resultUndone ? <Undo2 className="h-[18px] w-[18px]" aria-hidden /> : <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden />}
                    </span>
                    <div className="min-w-0">
                      <h3 id={resultTitleId} className="text-[16px] font-bold">
                        {resultUndone ? "Importação desfeita" : `${datesLabel(resultCount)} ${resultCount === 1 ? "importada" : "importadas"}`}
                      </h3>
                      <p className="sub !mt-0.5 wrap-anywhere">
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
                          items={[...lastResult.events].sort(byStart).map((event) => ({
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
            </section>
          ) : null}
          {/* a sobra de altura fica aqui, embaixo dos cartões: nenhum deles estica até a altura da lateral */}
          <div className="tela-gap" aria-hidden />
        </div>

        <div ref={sideRef} className="tela-side">
          <section className="card pad rise" style={delay(6)} aria-labelledby={accessId}>
            <div className="flex items-start gap-3.5">
              <span className="kpi-ico imp-night shrink-0" aria-hidden>
                <ShieldCheck className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h2 className="h2" id={accessId}>
                  Acesso liberado
                </h2>
                <p className="sub">Somente a administração pode importar datas oficiais.</p>
              </div>
            </div>
          </section>

          <section className="card pad rise" style={delay(7)} aria-labelledby={prioId}>
            <h2 className="kpi-label" id={prioId}>
              Regra de prioridade
            </h2>
            <p className="imp-prio-n">{officialAhead}</p>
            <p className="imp-prio-t">{officialAhead === 1 ? "evento oficial atual" : "eventos oficiais atuais"}</p>
            <p className="sub">Datas oficiais aparecem para todas as turmas. Quem marca um evento no mesmo dia vê um aviso de conflito.</p>
          </section>

          <section className="card pad rise" style={delay(8)} aria-labelledby={fieldsId}>
            <h2 className="h2" id={fieldsId}>
              Como funciona
            </h2>
            <ol className="mt-3 grid list-decimal gap-2 pl-5 text-sm leading-6 text-ink-2">
              <li>Arraste o PDF do Calendário Acadêmico, ou use o calendário de exemplo.</li>
              <li>Confira as datas. Os assuntos só de servidores, como PIT e RAD, vêm desmarcados.</li>
              <li>Importe. As datas aparecem para todas as turmas, e dá para desfazer.</li>
            </ol>
            {/* fica com a sobra quando a coluna estica para terminar junto da coluna principal */}
            <div ref={gapRef} className="tela-gap" aria-hidden />
          </section>
        </div>
      </div>

      <section className="card rise imp-hist" style={delay(9)} aria-labelledby={histId}>
        <div className="imp-hist-head">
          <h2 className="h2" id={histId}>
            Importações realizadas
          </h2>
          {imports.length ? <p className="sub">Abra uma importação para ver as datas que ela trouxe.</p> : null}
        </div>
        {imports.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col" className="px-3 @min-[400px]:px-4">
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
              </tr>
            </thead>
            <tbody id={`${histId}-linhas`}>
              {(showAllImports ? imports : imports.slice(0, IMPORTS_PREVIEW)).map((item) => {
                const current = datesOf(item);
                const open = openImportId === item.id;
                const detailsId = `${baseId}-importacao-${item.id}`;
                const state = importState(item, current.length);
                const origin = originOf(item);
                // "2" quando todas as datas seguem no calendário; "1 de 2" quando alguma saiu
                const count = current.length === item.totalEvents ? String(item.totalEvents) : `${current.length} de ${item.totalEvents}`;
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
                          aria-controls={open ? detailsId : undefined}
                          onClick={() => setOpenImportId(open ? null : item.id)}
                          type="button"
                        >
                          <ChevronDown className={cx("mt-0.5 h-4 w-4 shrink-0 text-muted transition", open && "rotate-180")} aria-hidden />
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
                      <td className="whitespace-nowrap px-3 @min-[400px]:px-4">{count}</td>
                      <td className={cx("hidden @min-[820px]:table-cell", origin.mono && "break-all font-mono text-[13px]")}>{origin.text}</td>
                      <td className="hidden @min-[440px]:table-cell">
                        <span className={cx("pill", state.pill)}>{state.label}</span>
                      </td>
                    </tr>
                    {open ? (
                      <tr id={detailsId} className="bg-surface-2">
                        <td colSpan={5} className="px-3 pt-0 @min-[400px]:px-4">
                          <div className="grid gap-3 pb-1">
                            <p className="text-sm text-ink-3 @min-[820px]:hidden">
                              Origem: <span className={cx(origin.mono && "break-all font-mono text-[13px]")}>{origin.text}</span>
                            </p>
                            {current.length ? (
                              <>
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
                              </>
                            ) : (
                              <p className="text-sm text-ink-3">
                                {item.totalEvents
                                  ? "As datas desta importação não estão mais no calendário."
                                  : "Esta importação não trouxe datas."}
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-6 pb-6">
            <EmptyState icon={History} text="Nenhuma importação ainda." hint="Use a importação de demonstração para testar." />
          </div>
        )}
        {imports.length > IMPORTS_PREVIEW ? (
          <div className="card-foot border-t border-line-2 px-6 pb-4">
            <button
              ref={moreImportsRef}
              className="link"
              aria-controls={`${histId}-linhas`}
              aria-expanded={showAllImports}
              onClick={toggleImports}
              type="button"
            >
              {showAllImports ? "Mostrar menos" : `Ver todas (${imports.length})`}
              <ChevronDown className={cx("h-[15px] w-[15px] transition", showAllImports && "rotate-180")} aria-hidden />
            </button>
          </div>
        ) : null}
      </section>

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
