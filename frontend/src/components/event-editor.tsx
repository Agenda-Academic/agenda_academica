"use client";

import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Eye,
  Info,
  Loader2,
  Lock,
  MapPin,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { addDays, cx, dateParts, isSameDay, isWholeDay, startOfDay, toDateTimeLocal, weekdayLabels } from "@/lib/format";
import { adminOnlyCategories, allCategories, categoryMeta, statusMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Category, UserRole } from "@/lib/types";
import { StatusPill, eventLastDay, onDay, reactivatedStatus, type EventStatusChange } from "./event-bits";
import { ConfirmDialog, Drawer, isOnTopLayer, type ConfirmState } from "./ui";

/* ------------------------------------------------------------------ */
/* Formulário: tipos e valores iniciais                                */
/* ------------------------------------------------------------------ */

export type EventFormState = {
  title: string;
  description: string;
  category: Category;
  startsAt: string;
  endsAt: string;
  points: string;
  location: string;
  academicClassId: string;
  subjectId: string;
};

export type EventFieldErrors = Partial<Record<keyof EventFormState, string>>;

export type { EventStatusChange } from "./event-bits";

/** Faixa do rodapé depois de mudar a situação pelo painel ("Evento cancelado: ...", com Desfazer). */
export type StatusNotice = { text: string; onUndo?: () => void };

type FieldKey = keyof EventFormState;

const TITLE_MAX = 140;
const teacherCategories = allCategories.filter((category) => !adminOnlyCategories.includes(category));

/** Próximo dia útil (seg a sex) às 19:00, horário das aulas da noite. */
function nextClassDay() {
  const today = new Date();
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 19, 0);
  while (day.getDay() === 0 || day.getDay() === 6) {
    day.setDate(day.getDate() + 1);
  }
  return day;
}

/** Formulário vazio. Com o contexto, o docente de um vínculo só já vem com disciplina e turma. */
export const createInitialEventForm = (role?: UserRole, context?: AcademicContext | null): EventFormState => {
  const assignments = context?.teachingAssignments ?? [];
  const only = role === "teacher" && assignments.length === 1 ? assignments[0] : null;
  return {
    title: "",
    description: "",
    category: role === "admin" ? "institutional" : "exam",
    startsAt: toDateTimeLocal(nextClassDay()),
    endsAt: "",
    points: "",
    location: "",
    academicClassId: only ? String(only.academicClassId) : "",
    subjectId: only ? String(only.subjectId) : "",
  };
};

/** Formulário preenchido com os dados de um evento existente. */
export function eventToForm(event: AcademicEvent): EventFormState {
  return {
    title: event.title,
    description: event.description ?? "",
    category: event.category,
    startsAt: toDateTimeLocal(new Date(event.startsAt)),
    endsAt: event.endsAt ? toDateTimeLocal(new Date(event.endsAt)) : "",
    points: event.points === null ? "" : String(event.points),
    location: event.location ?? "",
    academicClassId: event.academicClassId ? String(event.academicClassId) : "",
    subjectId: event.subjectId ? String(event.subjectId) : "",
  };
}

/** Os dois formulários têm os mesmos valores? (base do "Alterações não salvas") */
export function isSameEventForm(a: EventFormState, b: EventFormState) {
  return (Object.keys(a) as FieldKey[]).every((key) => a[key] === b[key]);
}

/* ------------------------------------------------------------------ */
/* Datas por extenso curto                                             */
/* ------------------------------------------------------------------ */

const pad = (value: number) => String(value).padStart(2, "0");
const hhmm = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const dayMonth = (date: Date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
const shortDay = (date: Date) => `${weekdayLabels[date.getDay()]}, ${dayMonth(date)}`;

/** Valor de um campo datetime-local como data local (ou null). */
function parseLocal(value: string) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Quando o evento acontece, em duas partes: "qui, 05/11" e "19:00 até 21:00" (ou "Dia todo"). */
export function eventWhen(startsAt: string, endsAt: string | null) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) {
    return { day: "", time: "" };
  }
  const endDate = endsAt ? new Date(endsAt) : null;
  const end = endDate && endDate.getTime() > start.getTime() ? endDate : null;

  // dia todo só sem horário de término ("00:00 até 10:00" mostra os horários)
  if (isWholeDay(startsAt, end ? endsAt : null)) {
    // dia inteiro: término à meia-noite vale até o dia anterior
    const last = end ? new Date(end.getTime() - (end.getHours() === 0 && end.getMinutes() === 0 ? 1 : 0)) : null;
    if (last && startOfDay(last).getTime() > startOfDay(start).getTime()) {
      return { day: `${dayMonth(start)} a ${dayMonth(last)}`, time: "Dia todo" };
    }
    return { day: shortDay(start), time: "Dia todo" };
  }
  if (!end) {
    return { day: shortDay(start), time: hhmm(start) };
  }
  if (isSameDay(start, end)) {
    return { day: shortDay(start), time: `${hhmm(start)} até ${hhmm(end)}` };
  }
  return { day: shortDay(start), time: `${hhmm(start)} até ${shortDay(end)}, ${hhmm(end)}` };
}

/** "qui, 05/11, 19:00 até 21:00" ou "seg, 16/11, dia todo". */
export function eventWhenLabel(startsAt: string, endsAt: string | null) {
  const { day, time } = eventWhen(startsAt, endsAt);
  if (!time) {
    return day;
  }
  return `${day}, ${time === "Dia todo" ? "dia todo" : time}`;
}

function pointsLabel(points: string) {
  const value = Number(points);
  if (!points.trim() || !Number.isFinite(value)) {
    return null;
  }
  return `Vale ${value.toLocaleString("pt-BR")} ${value === 1 ? "ponto" : "pontos"}`;
}

const isOfficial = (event: AcademicEvent) => event.officialPriority || event.source !== "teacher";
const isEvaluation = (category: Category) => category === "exam" || category === "assignment";

/* ------------------------------------------------------------------ */
/* Validação e conflitos                                               */
/* ------------------------------------------------------------------ */

const fieldOrder: FieldKey[] = [
  "title",
  "startsAt",
  "endsAt",
  "academicClassId",
  "subjectId",
  "location",
  "points",
  "description",
];

function validateForm(form: EventFormState, role: UserRole, pointsUnreadable: boolean): EventFieldErrors {
  const errors: EventFieldErrors = {};
  const title = form.title.trim();
  if (!title) {
    errors.title = "Escreva o título do evento.";
  } else if (title.length < 3) {
    errors.title = "Use pelo menos 3 caracteres no título.";
  } else if (title.length > TITLE_MAX) {
    errors.title = `Use no máximo ${TITLE_MAX} caracteres. Agora são ${title.length}.`;
  }

  const start = parseLocal(form.startsAt);
  if (!start) {
    errors.startsAt = "Escolha a data e o horário de início.";
  }
  if (form.endsAt) {
    const end = parseLocal(form.endsAt);
    if (!end) {
      errors.endsAt = "Escolha um término válido ou deixe em branco.";
    } else if (start && end.getTime() <= start.getTime()) {
      errors.endsAt = `O término precisa ser depois de ${dayMonth(start)}, ${hhmm(start)}.`;
    }
  }

  if (role !== "admin" && (!form.academicClassId || !form.subjectId)) {
    errors.subjectId = "Escolha a disciplina e a turma.";
  }

  if (pointsUnreadable) {
    errors.points = "Use só números, como 10 ou 2,5.";
  } else if (form.points.trim()) {
    const value = Number(form.points);
    if (!Number.isFinite(value)) {
      errors.points = "Use só números, como 10 ou 2,5.";
    } else if (value < 0) {
      errors.points = "A pontuação não pode ser negativa.";
    } else if (!Number.isInteger(value * 2)) {
      errors.points = "Use pontos inteiros ou meio ponto, como 10 ou 2,5.";
    }
  }
  return errors;
}

function joinTitles(titles: string[]) {
  if (titles.length <= 2) {
    return titles.join(" e ");
  }
  return `${titles.slice(0, 2).join(", ")} e mais ${titles.length - 2}`;
}

/** Avisos de choque com eventos oficiais e com a agenda da turma, em todos os dias do evento. Não bloqueiam o envio. */
function findConflicts({
  start,
  end,
  form,
  allEvents,
  editingId,
  className,
}: {
  start: Date | null;
  end: Date | null;
  form: EventFormState;
  allEvents: AcademicEvent[];
  editingId: number | null;
  className: string | null;
}) {
  if (!start) {
    return [];
  }
  const classId = Number(form.academicClassId) || null;
  const others = allEvents.filter((event) => event.id !== editingId && event.status !== "cancelled");
  // do dia do início ao último dia do término, com a regra das linhas (término às 00:00 não conta o dia)
  const firstDay = startOfDay(start);
  const lastDay = eventLastDay({
    startsAt: start.toISOString(),
    endsAt: end && end.getTime() > start.getTime() ? end.toISOString() : null,
  });
  const multi = lastDay.getTime() > firstDay.getTime();
  // o que cai em algum dia do período, com o primeiro dia em comum
  const overlaps = others
    .flatMap((event) => {
      const from = startOfDay(new Date(event.startsAt));
      if (from.getTime() > lastDay.getTime() || eventLastDay(event).getTime() < firstDay.getTime()) {
        return [];
      }
      return [{ event, day: from.getTime() > firstDay.getTime() ? from : firstDay }];
    })
    .sort(
      (a, b) =>
        a.day.getTime() - b.day.getTime() ||
        new Date(a.event.startsAt).getTime() - new Date(b.event.startsAt).getTime()
    );
  const lines: string[] = [];

  const official = overlaps.filter(
    ({ event }) => isOfficial(event) && (!classId || !event.academicClassId || event.academicClassId === classId)
  );
  if (official.length) {
    const kind = official.length > 1 ? "eventos oficiais" : "evento oficial";
    lines.push(
      multi
        ? `No período: ${joinTitles(official.map(({ event, day }) => `${event.title} ${onDay(day)}`))} (${kind})`
        : `Nesse dia: ${joinTitles(official.map(({ event }) => event.title))} (${kind})`
    );
  }

  const classEvents = overlaps.filter(
    ({ event }) => !isOfficial(event) && (classId ? event.academicClassId === classId : Boolean(event.academicClassId))
  );
  if (classEvents.length) {
    const [{ event: first, day }] = classEvents;
    const firstStart = new Date(first.startsAt);
    const where = !classId && first.academicClass ? ` (${first.academicClass.name})` : "";
    const more = classEvents.length > 1 ? ` e mais ${classEvents.length - 1}` : "";
    if (multi) {
      // num período, o dia vai por extenso; o horário, só quando o evento começa nesse dia
      const time = isWholeDay(first.startsAt, first.endsAt) ? ", dia todo" : isSameDay(firstStart, day) ? `, às ${hhmm(firstStart)}` : "";
      const item = `${first.title}${where} ${onDay(day)}${time}${more}`;
      lines.push(classId ? `A turma ${className ?? ""} já tem no período: ${item}` : `No período as turmas já têm: ${item}`);
    } else {
      const time = isWholeDay(first.startsAt, first.endsAt) ? "dia todo" : hhmm(firstStart);
      lines.push(
        classId
          ? `A turma ${className ?? ""} já tem nesse dia: ${first.title}, ${time}${more}`
          : `Nesse dia as turmas já têm: ${first.title}${where}, ${time}${more}`
      );
    }
  }

  if (classId) {
    const evaluations = others
      .filter((event) => event.academicClassId === classId && isEvaluation(event.category))
      .map((event) => new Date(event.startsAt).getTime());
    const extra = isEvaluation(form.category) ? 1 : 0;
    // cada semana (domingo a sábado) que o período toca, até um semestre; avisa a mais cheia
    let heaviest: { start: Date; count: number } | null = null;
    let week = addDays(firstDay, -firstDay.getDay());
    for (let index = 0; index < 26 && week.getTime() <= lastDay.getTime(); index += 1) {
      const from = week.getTime();
      const to = addDays(week, 7).getTime();
      const count = evaluations.filter((time) => time >= from && time < to).length + extra;
      if (count >= 3 && (!heaviest || count > heaviest.count)) {
        heaviest = { start: week, count };
      }
      week = addDays(week, 7);
    }
    if (heaviest) {
      lines.push(
        `Semana carregada: ${heaviest.count} avaliações da turma ${className ?? ""} entre ${dayMonth(heaviest.start)} e ${dayMonth(addDays(heaviest.start, 6))}`
      );
    }
  }
  return lines;
}

/**
 * Leva o foco ao campo com erro sem esconder o resumo: rola o corpo do painel para mostrar
 * o resumo e o campo juntos quando cabem; senão, o campo com o rótulo.
 */
function revealField(field: HTMLElement | null | undefined, summary: HTMLElement | null) {
  if (!field) {
    return;
  }
  field.focus({ preventScroll: true });
  // no quadro seguinte o resumo já está na tela
  window.requestAnimationFrame(() => {
    const body = field.closest<HTMLElement>(".drawer-body");
    const box = field.closest<HTMLElement>("[data-field]") ?? field;
    if (!body) {
      box.scrollIntoView({ block: "nearest" });
      return;
    }
    const origin = body.getBoundingClientRect().top - body.scrollTop;
    const boxTop = box.getBoundingClientRect().top - origin;
    const boxBottom = box.getBoundingClientRect().bottom - origin;
    const summaryTop = summary ? summary.getBoundingClientRect().top - origin : boxTop;
    const fromTop = boxBottom - summaryTop + 20 <= body.clientHeight ? summaryTop : boxTop;
    if (fromTop - 8 >= body.scrollTop && boxBottom <= body.scrollTop + body.clientHeight) {
      return;
    }
    body.scrollTo({ top: Math.max(0, fromTop - 20) });
  });
}

/** Roda `run` quando nenhum diálogo estiver por cima do painel (ex.: a confirmação de cancelar). Devolve como desistir. */
function whenOnTop(anchorRef: RefObject<HTMLElement | null>, run: () => void, tries = 300) {
  let timer = 0;
  const attempt = (left: number) => {
    const anchor = anchorRef.current;
    if (!anchor?.isConnected) {
      return;
    }
    // com a confirmação aberta o painel fica inerte e não recebe foco; o detalhe que ficou montado
    // por baixo do painel (com aria-modal) não conta: vale só a camada de cima da pilha
    const covered = Boolean(anchor.closest("[inert]")) || !isOnTopLayer(anchor);
    if (!covered) {
      run();
    } else if (left > 0) {
      timer = window.setTimeout(() => attempt(left - 1), 100);
    }
  };
  attempt(tries);
  return () => window.clearTimeout(timer);
}

/** Botão de situação que está à vista (o do rodapé no computador ou o do fim do painel no celular). */
function visibleStatusButton(panel: HTMLElement | null) {
  const buttons = panel ? Array.from(panel.querySelectorAll<HTMLElement>("[data-status-action]")) : [];
  return buttons.find((button) => button.getClientRects().length > 0) ?? null;
}

/** Último envio do painel aberto (`key`: o evento, "novo" ou null fechado); `failed` quando não salvou. */
type SaveTrack = { key: number | "novo" | null; saving: boolean; failed: boolean };

/**
 * Salvar com sucesso fecha o painel na mesma hora: um envio que termina com o painel aberto no mesmo
 * evento não salvou (sem conexão ou sem resposta no prazo). Erro de campo já aparece no próprio campo.
 * Vale até a próxima tentativa ou até o painel fechar.
 */
function nextSaveTrack(track: SaveTrack, key: SaveTrack["key"], saving: boolean, fieldErrors: boolean): SaveTrack {
  if (track.key === key && track.saving === saving) {
    return track;
  }
  const ended = key !== null && track.key === key && track.saving && !saving;
  return { key, saving, failed: ended && !fieldErrors };
}

/* ------------------------------------------------------------------ */
/* Peças do formulário                                                 */
/* ------------------------------------------------------------------ */

const invalidInput = "aria-[invalid=true]:border-[var(--danger)]";

function describedBy(...ids: Array<string | false | null | undefined>) {
  const list = ids.filter(Boolean);
  return list.length ? list.join(" ") : undefined;
}

function FormField({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("grid min-w-0 content-start gap-2", className)} data-field="">
      <label className="lbl" htmlFor={id}>
        <span>{label}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </label>
      {children}
      {error ? (
        <p
          id={`${id}-erro`}
          className="field-error flex items-start gap-1.5 text-[13px] font-semibold leading-5 text-[var(--danger)]"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Grupo de categorias: uma parada de Tab, setas, Home e End mudam a escolha. */
function CategoryPicker({
  value,
  options,
  locked,
  labelId,
  helpId,
  onChange,
}: {
  value: Category;
  options: Category[];
  locked: Category[];
  labelId: string;
  helpId?: string;
  onChange: (category: Category) => void;
}) {
  const buttons = useRef(new Map<Category, HTMLButtonElement>());
  const enabled = options.filter((category) => !locked.includes(category));
  const tabStop = enabled.includes(value) ? value : enabled[0];

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: Category) {
    const index = enabled.indexOf(current);
    const last = enabled.length - 1;
    let next: Category | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = enabled[index >= last ? 0 : index + 1];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = enabled[index <= 0 ? last : index - 1];
    } else if (event.key === "Home") {
      next = enabled[0];
    } else if (event.key === "End") {
      next = enabled[last];
    }
    if (!next) {
      return;
    }
    event.preventDefault();
    onChange(next);
    buttons.current.get(next)?.focus();
  }

  return (
    <div className="chips" role="radiogroup" aria-labelledby={labelId} aria-describedby={helpId}>
      {options.map((category) => {
        const meta = categoryMeta[category];
        const picked = value === category;
        const isLocked = locked.includes(category);
        return (
          <button
            key={category}
            ref={(node) => {
              if (node) {
                buttons.current.set(category, node);
              } else {
                buttons.current.delete(category);
              }
            }}
            className={cx("chip", isLocked ? "lock" : picked && cx("picked", meta.tint))}
            role="radio"
            aria-checked={picked}
            aria-disabled={isLocked || undefined}
            tabIndex={category === tabStop ? 0 : -1}
            onClick={() => {
              if (!isLocked) {
                onChange(category);
              }
            }}
            onKeyDown={(event) => onKeyDown(event, category)}
            type="button"
          >
            {isLocked ? (
              <Lock className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <span className={cx("dot", meta.accent)} aria-hidden />
            )}
            {meta.short}
            {isLocked ? <span className="sr-only"> (exclusiva da administração)</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Prévia fiel do evento como aparece na agenda de quem recebe. */
function EventPreview({
  form,
  status,
  official,
  audience,
  past,
}: {
  form: EventFormState;
  status: AcademicEvent["status"] | null;
  official: boolean;
  audience: string;
  past: boolean;
}) {
  const start = parseLocal(form.startsAt);
  const end = parseLocal(form.endsAt);
  const parts = start ? dateParts(start.toISOString()) : null;
  const meta = categoryMeta[form.category];
  const points = pointsLabel(form.points);
  const description = form.description.trim();

  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-1.5">
      <div className="flex items-start gap-4 rounded-[14px] bg-white p-3.5">
        <span className="ev-date">
          <span className="dw">{parts?.weekday ?? "Dia"}</span>
          <span className="dn">{parts?.day ?? "--"}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cx(
              "break-words text-[15px] font-[650] leading-[1.3]",
              status === "cancelled" && "text-muted line-through",
              !form.title.trim() && "text-muted"
            )}
          >
            {form.title.trim() || "Título do evento"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={cx("pill", meta.tint)}>{meta.short}</span>
            {official ? (
              <span className="pill prio">
                <ShieldCheck className="h-3 w-3" aria-hidden />
                Oficial
              </span>
            ) : null}
            {status && status !== "scheduled" ? (
              <span className={cx("pill", statusMeta[status].pill)}>{statusMeta[status].label}</span>
            ) : null}
            {past ? <span className="pill st-alt">Data no passado</span> : null}
          </div>
          <ul className="mt-2.5 grid gap-1 text-[13.5px] leading-5 text-ink-3">
            <li className="flex items-start gap-2">
              <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0">{audience}</span>
            </li>
            <li className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0">
                {start ? eventWhenLabel(start.toISOString(), end ? end.toISOString() : null) : "Escolha a data de início"}
              </span>
            </li>
            {form.location.trim() ? (
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 break-words">{form.location.trim()}</span>
              </li>
            ) : null}
            {points ? (
              <li className="flex items-start gap-2">
                <Trophy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                <span>{points}</span>
              </li>
            ) : null}
          </ul>
          {description ? (
            <p className="mt-2 line-clamp-2 whitespace-pre-line break-words text-[13px] leading-5 text-muted">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Docente sem vínculo: no lugar do formulário, o que fazer para poder publicar. */
export function NoAssignmentsNotice({ heading: Heading = "h3" }: { heading?: "h2" | "h3" }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <span className="empty-ico">
        <Users className="h-6 w-6" aria-hidden />
      </span>
      <Heading className="text-[19px] font-bold leading-tight text-ink">Você ainda não tem turmas vinculadas</Heading>
      <p className="max-w-xl text-sm leading-6 text-ink-3">
        Peça à administração para vincular suas disciplinas e turmas. Depois disso você poderá publicar provas e
        trabalhos para a turma.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Painel lateral de edição                                            */
/* ------------------------------------------------------------------ */

export type EventEditorProps = {
  open: boolean;
  editingEvent: AcademicEvent | null;
  form: EventFormState;
  setForm: (updater: (form: EventFormState) => EventFormState) => void;
  serverErrors?: EventFieldErrors;
  context: AcademicContext | null;
  role: UserRole;
  allEvents: AcademicEvent[];
  saving: boolean;
  /** Uma mudança de situação está indo para a API: Concluir, Cancelar evento, Reativar e Desfazer esperam. */
  statusBusy?: boolean;
  /** Resultado da mudança de situação feita pelo painel, com o Desfazer ao alcance do teclado. */
  statusNotice?: StatusNotice | null;
  dirty: boolean;
  onSubmit: () => void;
  onClose: () => void;
  onDelete?: (event: AcademicEvent) => void;
  onSetStatus?: (event: AcademicEvent, status: EventStatusChange) => void;
};

/** Para quem vai o evento, em poucas palavras ("Matemática, TADS 5", "Toda a instituição"). */
function audienceOf(form: EventFormState, context: AcademicContext | null, isAdmin: boolean) {
  const classId = Number(form.academicClassId);
  const subjectId = Number(form.subjectId);
  if (!isAdmin) {
    const assignment = (context?.teachingAssignments ?? []).find(
      (item) => item.academicClassId === classId && item.subjectId === subjectId
    );
    return {
      className: assignment?.academicClass?.name ?? null,
      label: assignment
        ? [assignment.subject?.name, assignment.academicClass?.name].filter(Boolean).join(", ")
        : null,
    };
  }
  const academicClass = context?.catalog.classes.find((item) => item.id === classId) ?? null;
  const subject = context?.catalog.subjects.find((item) => item.id === subjectId) ?? null;
  return {
    className: academicClass?.name ?? null,
    label: academicClass
      ? [subject?.name, academicClass.name].filter(Boolean).join(", ")
      : subject
        ? `${subject.name}, toda a instituição`
        : "Toda a instituição",
  };
}

export function EventEditor({
  open,
  editingEvent,
  form,
  setForm,
  serverErrors,
  context,
  role,
  allEvents,
  saving,
  statusBusy = false,
  statusNotice = null,
  dirty,
  onSubmit,
  onClose,
  onDelete,
  onSetStatus,
}: EventEditorProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const hintId = useId();
  const noticeId = useId();
  const isAdmin = role === "admin";
  const assignments = context?.teachingAssignments ?? [];
  // docente sem vínculo não tem para quem publicar
  const blocked = !isAdmin && !editingEvent && context !== null && assignments.length === 0;
  const changed = dirty || (editingEvent ? !isSameEventForm(form, eventToForm(editingEvent)) : false);
  // salvando, ou com uma mudança de situação a caminho: nada sai em dobro
  const waiting = saving || statusBusy;
  const lockedSave = waiting || (editingEvent !== null && !changed);
  const audience = audienceOf(form, context, isAdmin);

  // situação de quando o painel abriu o evento: depois de mudá-la, o rodapé não diz "Nada mudou ainda"
  const sessionKey = open && editingEvent ? editingEvent.id : null;
  const currentStatus = editingEvent?.status ?? null;
  const [statusTrack, setStatusTrack] = useState({ key: sessionKey, status: currentStatus, moved: false });
  if (statusTrack.key !== sessionKey) {
    setStatusTrack({ key: sessionKey, status: currentStatus, moved: false });
  } else if (statusTrack.status !== currentStatus) {
    setStatusTrack({ key: sessionKey, status: currentStatus, moved: true });
  }
  const statusMoved = statusTrack.key === sessionKey && (statusTrack.moved || statusTrack.status !== currentStatus);

  // botão que pediu a mudança em andamento (giro e aria-busy só nele)
  const [pendingStatus, setPendingStatus] = useState<EventStatusChange | "undo" | null>(null);
  const [busySeen, setBusySeen] = useState(statusBusy);
  if (busySeen !== statusBusy) {
    setBusySeen(statusBusy);
    if (!statusBusy) {
      setPendingStatus(null);
    }
  }

  // salvamento demorado: no plano gratuito a API dorme e leva até um minuto para voltar
  const [slowSave, setSlowSave] = useState(false);
  if (!saving && slowSave) {
    setSlowSave(false);
  }
  useEffect(() => {
    if (!saving) {
      return;
    }
    const timer = window.setTimeout(() => setSlowSave(true), 5000);
    return () => window.clearTimeout(timer);
  }, [saving]);

  // envio que acabou sem fechar o painel (sem conexão ou sem resposta no prazo): o rascunho continua
  // aqui, Esc, X e Fechar voltam a valer, e o rodapé diz que não salvou até a próxima tentativa
  const saveNoteId = useId();
  const draftKey = open ? (editingEvent?.id ?? "novo") : null;
  const fieldErrorsBack = Object.values(serverErrors ?? {}).some(Boolean);
  const [saveTrack, setSaveTrack] = useState<SaveTrack>({ key: draftKey, saving, failed: false });
  const nextTrack = nextSaveTrack(saveTrack, draftKey, saving, fieldErrorsBack);
  if (nextTrack !== saveTrack) {
    setSaveTrack(nextTrack);
  }
  const saveFailed = nextTrack.failed;

  // depois de mudar a situação por aqui, o botão clicado some (Concluir vira Reativar):
  // o foco vai para o Desfazer da faixa, ou para um lugar que continua na tela.
  // O pedido guarda como a situação estava no clique e só age quando o resultado chega.
  const canUndo = Boolean(statusNotice?.onUndo);
  const statusSnapshot = `${currentStatus ?? ""}|${statusNotice?.text ?? ""}|${canUndo}`;
  const [statusFocus, setStatusFocus] = useState<{ key: number; from: string } | null>(null);
  if (statusFocus && statusFocus.key !== sessionKey) {
    setStatusFocus(null);
  }
  useEffect(() => {
    if (!statusFocus || statusFocus.key !== sessionKey || statusFocus.from === statusSnapshot) {
      return;
    }
    return whenOnTop(footRef, () => {
      const panel = footRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
      const active = document.activeElement;
      const lost = !active || active === document.body || active === panel;
      // quem já levou o foco para um campo ou outro botão fica onde está
      const onStatus =
        active instanceof HTMLElement &&
        (active.matches("[data-status-action]") || Boolean(noticeRef.current?.contains(active)));
      if (!lost && !onStatus) {
        return;
      }
      if (canUndo && undoRef.current) {
        undoRef.current.focus();
      } else if (lost) {
        (noticeRef.current ?? visibleStatusButton(panel) ?? panel)?.focus();
      }
    });
  }, [sessionKey, statusFocus, statusSnapshot, canUndo]);

  const title = editingEvent ? "Editar evento" : isAdmin ? "Novo evento oficial" : "Novo evento";
  const dirtyPill = changed ? <span className="pill st-alt">Alterações não salvas</span> : null;
  const subtitle = editingEvent ? (
    <span className="block">
      <span className="block truncate font-semibold text-ink-2">{editingEvent.title}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{eventWhenLabel(editingEvent.startsAt, editingEvent.endsAt)}</span>
        <StatusPill event={editingEvent} />
        {dirtyPill}
      </span>
    </span>
  ) : (audience.label && !blocked) || dirtyPill ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {audience.label && !blocked ? <span>{audience.label}</span> : null}
      {dirtyPill}
    </span>
  ) : undefined;

  function askStatus(status: EventStatusChange) {
    if (!editingEvent || !onSetStatus || waiting || sessionKey === null) {
      return;
    }
    setStatusFocus({ key: sessionKey, from: statusSnapshot });
    setPendingStatus(status);
    onSetStatus(editingEvent, status);
  }

  function undoStatus() {
    if (!statusNotice?.onUndo || waiting || sessionKey === null) {
      return;
    }
    setStatusFocus({ key: sessionKey, from: statusSnapshot });
    setPendingStatus("undo");
    statusNotice.onUndo();
  }

  const eventOpen = editingEvent ? editingEvent.status === "scheduled" || editingEvent.status === "changed" : false;
  const quiet = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

  function statusButton(status: EventStatusChange, label: string, icon: ReactNode) {
    const spinning = statusBusy && pendingStatus === status;
    return (
      <button
        key={status}
        className={cx("btn btn-s btn-sm", quiet)}
        data-status-action=""
        aria-busy={spinning || undefined}
        aria-disabled={waiting || undefined}
        onClick={() => askStatus(status)}
        type="button"
      >
        {spinning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
        {label}
      </button>
    );
  }

  const statusActions =
    editingEvent && onSetStatus
      ? eventOpen
        ? [
            statusButton("completed", "Concluir", <CheckCircle2 className="h-4 w-4 text-brand" aria-hidden />),
            statusButton("cancelled", "Cancelar evento", <X className="h-4 w-4 text-[var(--danger)]" aria-hidden />),
          ]
        : statusButton(reactivatedStatus(editingEvent), "Reativar", <RotateCcw className="h-4 w-4" aria-hidden />)
      : null;

  // situação e exclusão: no rodapé a partir de 640px; no celular, no fim do painel, para o rodapé ficar curto
  const eventActions =
    editingEvent && (statusActions || onDelete) ? (
      <>
        {statusActions}
        {onDelete ? (
          <button
            className={cx("btn btn-danger btn-sm sm:ml-auto", quiet)}
            aria-disabled={waiting || undefined}
            onClick={() => {
              if (!waiting) {
                onDelete(editingEvent);
              }
            }}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Excluir
          </button>
        ) : null}
      </>
    ) : null;

  // faixa com o resultado da mudança de situação; o Desfazer fica no próprio painel, ao alcance do Tab
  const undoSpinning = statusBusy && pendingStatus === "undo";
  const notice = statusNotice ? (
    <div ref={noticeRef} tabIndex={-1} className="callout green items-center px-3.5 py-2.5">
      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
      <span id={noticeId} className="min-w-0 flex-1">
        {statusNotice.text}
      </span>
      {statusNotice.onUndo ? (
        <button
          ref={undoRef}
          className={cx("btn btn-s btn-sm shrink-0", quiet)}
          aria-busy={undoSpinning || undefined}
          aria-describedby={noticeId}
          aria-disabled={waiting || undefined}
          onClick={undoStatus}
          type="button"
        >
          {undoSpinning ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RotateCcw className="h-4 w-4" aria-hidden />
          )}
          Desfazer
        </button>
      ) : null}
    </div>
  ) : null;

  // ao lado do Salvar apagado: por que está apagado (a situação muda na hora, sem salvar)
  const hint =
    editingEvent && !changed && !statusNotice ? (statusMoved ? "A situação já foi salva" : "Nada mudou ainda") : null;

  const footer = blocked ? (
    <button className="btn btn-s max-sm:flex-1" onClick={onClose} type="button">
      Fechar
    </button>
  ) : (
    <div ref={footRef} className="grid w-full gap-3">
      {notice}
      {eventActions ? (
        <div className="hidden flex-wrap items-center gap-2 sm:flex" role="group" aria-label="Situação do evento">
          {eventActions}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          className={cx("btn btn-p max-sm:flex-1", quiet)}
          form={formId}
          type="submit"
          aria-disabled={lockedSave || undefined}
          aria-busy={saving || undefined}
          aria-describedby={describedBy(hint && hintId, saveFailed && saveNoteId)}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : editingEvent ? (
            <Save className="h-4 w-4" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          {saving ? "Salvando" : editingEvent ? "Salvar alterações" : isAdmin ? "Publicar evento oficial" : "Publicar evento"}
        </button>
        <button
          className={cx("btn btn-s max-sm:flex-1", quiet)}
          aria-disabled={saving || undefined}
          onClick={() => {
            if (!saving) {
              onClose();
            }
          }}
          type="button"
        >
          Fechar
        </button>
        {hint ? (
          <span id={hintId} className="text-[13px] text-muted">
            {hint}
          </span>
        ) : null}
      </div>
      <p
        id={saveNoteId}
        role="status"
        className={
          saveFailed
            ? "flex items-start gap-1.5 text-[13px] font-semibold leading-5 text-[var(--danger)]"
            : slowSave
              ? "flex items-start gap-1.5 text-[13px] leading-5 text-muted"
              : "sr-only"
        }
      >
        {saveFailed ? (
          <>
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {editingEvent
              ? "Não foi possível salvar agora. Suas alterações continuam aqui."
              : "Não foi possível publicar agora. O que você preencheu continua aqui."}
          </>
        ) : slowSave ? (
          <>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            O servidor pode estar acordando. Na primeira vez isso leva até 1 minuto.
          </>
        ) : null}
      </p>
    </div>
  );

  return (
    <Drawer
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={footer}
      initialFocusRef={titleRef}
      busy={saving}
      labelClose="Fechar painel"
    >
      {blocked ? (
        <NoAssignmentsNotice />
      ) : (
        <EditorForm
          key={editingEvent?.id ?? "novo"}
          formId={formId}
          titleRef={titleRef}
          form={form}
          setForm={setForm}
          serverErrors={serverErrors}
          context={context}
          role={role}
          allEvents={allEvents}
          editingEvent={editingEvent}
          saving={saving}
          locked={lockedSave}
          audience={audience}
          phoneActions={eventActions}
          onSubmit={onSubmit}
        />
      )}
    </Drawer>
  );
}

function EditorForm({
  formId,
  titleRef,
  form,
  setForm,
  serverErrors,
  context,
  role,
  allEvents,
  editingEvent,
  saving,
  locked,
  audience,
  phoneActions,
  onSubmit,
}: {
  formId: string;
  titleRef: RefObject<HTMLInputElement | null>;
  form: EventFormState;
  setForm: (updater: (form: EventFormState) => EventFormState) => void;
  serverErrors?: EventFieldErrors;
  context: AcademicContext | null;
  role: UserRole;
  allEvents: AcademicEvent[];
  editingEvent: AcademicEvent | null;
  saving: boolean;
  locked: boolean;
  audience: { className: string | null; label: string | null };
  phoneActions?: ReactNode;
  onSubmit: () => void;
}) {
  const isAdmin = role === "admin";
  const base = useId();
  const fid = (name: string) => `${base}${name}`;
  const [now] = useState(() => Date.now());
  const [initial] = useState(form);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, true>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [pointsUnreadable, setPointsUnreadable] = useState(false);
  const [confirmPast, setConfirmPast] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const startsRef = useRef<HTMLInputElement>(null);
  const endsRef = useRef<HTMLInputElement>(null);
  const pairRef = useRef<HTMLSelectElement>(null);
  const classRef = useRef<HTMLSelectElement>(null);
  const subjectRef = useRef<HTMLSelectElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const fieldRefs: Record<FieldKey, RefObject<HTMLElement | null> | null> = {
    title: titleRef,
    description: descriptionRef,
    category: null,
    startsAt: startsRef,
    endsAt: endsRef,
    points: pointsRef,
    location: locationRef,
    academicClassId: isAdmin ? classRef : pairRef,
    subjectId: isAdmin ? subjectRef : pairRef,
  };

  const assignments = context?.teachingAssignments ?? [];

  // erros do servidor valem até a pessoa mexer no campo
  const serverKey = JSON.stringify(serverErrors ?? {});
  const [serverSeen, setServerSeen] = useState(serverKey);
  const [serverForm, setServerForm] = useState(form);
  if (serverKey !== serverSeen) {
    setServerSeen(serverKey);
    setServerForm(form);
  }

  const localErrors = validateForm(form, role, pointsUnreadable);
  function errorFor(key: FieldKey) {
    if ((submitted || touched[key]) && localErrors[key]) {
      return localErrors[key];
    }
    const server = serverErrors?.[key];
    return server && form[key] === serverForm[key] ? server : undefined;
  }

  // abre com o foco no Título (o painel também pede; aqui é a reserva)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = titleRef.current;
      if (input && !input.closest(".drawer")?.contains(document.activeElement)) {
        input.focus({ preventScroll: true });
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [titleRef]);

  // erro novo do servidor: leva ao primeiro campo marcado
  useEffect(() => {
    const errors = JSON.parse(serverKey) as EventFieldErrors;
    const first = fieldOrder.find((key) => errors[key]);
    const targets: Partial<Record<FieldKey, HTMLElement | null>> = {
      title: titleRef.current,
      startsAt: startsRef.current,
      endsAt: endsRef.current,
      academicClassId: pairRef.current ?? classRef.current,
      subjectId: pairRef.current ?? subjectRef.current,
      location: locationRef.current,
      points: pointsRef.current,
      description: descriptionRef.current,
    };
    if (first) {
      revealField(targets[first], summaryRef.current);
    }
  }, [serverKey, titleRef]);

  function change(patch: Partial<EventFormState> | ((current: EventFormState) => EventFormState)) {
    if (saving) {
      return;
    }
    setForm((current) => (typeof patch === "function" ? patch(current) : { ...current, ...patch }));
  }

  function markTouched(key: FieldKey) {
    if (form[key] !== initial[key] && !touched[key]) {
      setTouched((current) => ({ ...current, [key]: true }));
    }
  }

  // mudar o início leva o término junto, mantendo a duração
  function changeStart(value: string) {
    change((current) => {
      const previousStart = parseLocal(current.startsAt);
      const previousEnd = parseLocal(current.endsAt);
      const nextStart = parseLocal(value);
      let endsAt = current.endsAt;
      if (previousStart && previousEnd && nextStart && previousEnd.getTime() > previousStart.getTime()) {
        endsAt = toDateTimeLocal(new Date(nextStart.getTime() + previousEnd.getTime() - previousStart.getTime()));
      }
      return { ...current, startsAt: value, endsAt };
    });
  }

  const start = parseLocal(form.startsAt);
  const end = parseLocal(form.endsAt);
  const startIsPast = start !== null && start.getTime() < now;
  const original = editingEvent ? eventToForm(editingEvent) : null;
  const originalStart = original?.startsAt ?? null;
  const askAboutPast = startIsPast && form.startsAt !== originalStart;
  // o page.tsx marca como Alterado quando data, término ou local mudam num evento agendado
  const willShowChanged = Boolean(
    original &&
      editingEvent?.status === "scheduled" &&
      (form.startsAt !== original.startsAt ||
        form.endsAt !== original.endsAt ||
        form.location.trim() !== original.location.trim())
  );
  const hasClass = Boolean(form.academicClassId);
  const conflicts = findConflicts({
    start,
    end,
    form,
    allEvents,
    editingId: editingEvent?.id ?? null,
    className: audience.className,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (locked) {
      return;
    }
    setSubmitted(true);
    const unreadable = Boolean(pointsRef.current?.validity.badInput);
    setPointsUnreadable(unreadable);
    const errors = validateForm(form, role, unreadable);
    const first = fieldOrder.find((key) => errors[key]);
    if (first) {
      revealField(fieldRefs[first]?.current, summaryRef.current);
      return;
    }
    if (askAboutPast) {
      setConfirmPast(true);
      return;
    }
    onSubmit();
  }

  // contagem do resumo: para o docente, disciplina e turma são um campo só
  const slots = (Object.keys(localErrors) as FieldKey[]).map((key) =>
    !isAdmin && (key === "academicClassId" || key === "subjectId") ? "vinculo" : key
  );
  const wrongFields = new Set(slots).size;
  const summary =
    submitted && wrongFields
      ? `Corrija ${wrongFields} ${wrongFields === 1 ? "campo" : "campos"} para ${editingEvent ? "salvar" : "publicar"}.`
      : "";

  // opções de vínculo do docente ("Matemática, TADS 5")
  const pairs = assignments.map((assignment) => ({
    value: `${assignment.academicClassId}:${assignment.subjectId}`,
    label: [assignment.subject?.name, assignment.academicClass?.name].filter(Boolean).join(", "),
  }));
  const pairValue = form.academicClassId || form.subjectId ? `${form.academicClassId}:${form.subjectId}` : "";
  if (pairValue && !pairs.some((pair) => pair.value === pairValue)) {
    pairs.push({
      value: pairValue,
      label:
        [editingEvent?.subject?.name, editingEvent?.academicClass?.name].filter(Boolean).join(", ") ||
        "Vínculo atual",
    });
  }

  const categoryOptions = isAdmin
    ? allCategories
    : teacherCategories.includes(form.category)
      ? teacherCategories
      : [...teacherCategories, form.category];
  const lockedCategories = isAdmin ? [] : categoryOptions.filter((category) => adminOnlyCategories.includes(category));

  const titleError = errorFor("title");
  const startsError = errorFor("startsAt");
  const endsError = errorFor("endsAt");
  const pairError = errorFor("subjectId") ?? errorFor("academicClassId");
  const classError = errorFor("academicClassId");
  const subjectError = errorFor("subjectId");
  const pointsError = errorFor("points");
  const locationError = errorFor("location");
  const descriptionError = errorFor("description");
  const titleLength = form.title.trim().length;

  const helpLine = editingEvent
    ? hasClass
      ? "As mudanças aparecem para a turma assim que você salvar."
      : "As mudanças aparecem para toda a instituição assim que você salvar."
    : isAdmin
      ? hasClass
        ? `O evento aparece para a turma ${audience.className ?? ""} assim que você publicar.`
        : "O evento aparece para toda a instituição assim que você publicar."
      : "O evento aparece para a turma assim que você publicar.";

  const previewNote = isAdmin
    ? hasClass
      ? `Só a turma ${audience.className ?? ""} vê esse evento.`
      : "Eventos oficiais aparecem para toda a instituição."
    : "Quem tem lembrete ativo vê o aviso no sistema, na antecedência que escolheu.";

  const startLabel = start ? eventWhenLabel(start.toISOString(), null) : "";
  const pastConfirm: ConfirmState = {
    title: editingEvent ? "Salvar com data no passado?" : "Publicar com data no passado?",
    message: `O início, ${startLabel}, já passou. ${hasClass || !isAdmin ? "A turma vai" : "Todos vão"} ver o evento em Passados, e não entre os próximos.`,
    confirmLabel: editingEvent ? "Salvar mesmo assim" : "Publicar mesmo assim",
    cancelLabel: "Corrigir a data",
    tone: "primary",
    action: onSubmit,
  };

  return (
    <>
      <form id={formId} noValidate onSubmit={handleSubmit} aria-busy={saving || undefined}>
        <div ref={summaryRef} role="alert">
          {summary ? (
            <p className="callout rose mb-5">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {summary}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5">
          <p className="text-sm leading-6 text-muted">{helpLine}</p>

          <FormField
            id={fid("titulo")}
            label="Título"
            hint={
              <span aria-hidden className={cx(titleLength > TITLE_MAX && "font-semibold text-[var(--danger)]")}>
                {titleLength}/{TITLE_MAX}
              </span>
            }
            error={titleError}
          >
            <input
              ref={titleRef}
              id={fid("titulo")}
              name="title"
              className={cx("input", invalidInput)}
              value={form.title}
              onChange={(event) => change({ title: event.target.value })}
              onBlur={() => markTouched("title")}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={describedBy(titleError && `${fid("titulo")}-erro`, fid("titulo-ajuda"))}
              autoComplete="off"
              placeholder={isAdmin ? "Ex.: Semana acadêmica" : "Ex.: Prova de Matemática (P2)"}
            />
            <span id={fid("titulo-ajuda")} className="sr-only">
              Use de 3 a {TITLE_MAX} caracteres.
            </span>
          </FormField>

          <div className="grid gap-2">
            <span className="lbl" id={fid("categoria")}>
              Categoria
            </span>
            <CategoryPicker
              value={form.category}
              options={categoryOptions}
              locked={lockedCategories}
              labelId={fid("categoria")}
              helpId={isAdmin ? undefined : fid("categoria-ajuda")}
              onChange={(category) => change({ category })}
            />
            {!isAdmin ? (
              <p id={fid("categoria-ajuda")} className="field-help !mt-0">
                Institucional, feriado e recesso são exclusivas da administração.
              </p>
            ) : null}
          </div>

          <div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id={fid("inicio")} label="Início" error={startsError}>
                <input
                  ref={startsRef}
                  id={fid("inicio")}
                  name="startsAt"
                  className={cx("input", invalidInput)}
                  type="datetime-local"
                  step={300}
                  value={form.startsAt}
                  onChange={(event) => changeStart(event.target.value)}
                  onBlur={() => markTouched("startsAt")}
                  aria-invalid={startsError ? true : undefined}
                  aria-describedby={describedBy(startsError && `${fid("inicio")}-erro`, startIsPast && fid("passado"))}
                />
              </FormField>
              <FormField id={fid("termino")} label="Término" hint="opcional" error={endsError}>
                <input
                  ref={endsRef}
                  id={fid("termino")}
                  name="endsAt"
                  className={cx("input", invalidInput)}
                  type="datetime-local"
                  step={300}
                  min={form.startsAt || undefined}
                  value={form.endsAt}
                  onChange={(event) => change({ endsAt: event.target.value })}
                  onBlur={() => markTouched("endsAt")}
                  aria-invalid={endsError ? true : undefined}
                  aria-describedby={describedBy(endsError && `${fid("termino")}-erro`)}
                />
              </FormField>
            </div>
            <div role="status" aria-live="polite">
              {startIsPast ? (
                <p id={fid("passado")} className="callout amber mt-3 px-3.5 py-2.5">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {hasClass || !isAdmin
                    ? "Essa data já passou. A turma vai ver o evento em Passados."
                    : "Essa data já passou. O evento vai aparecer em Passados."}
                </p>
              ) : null}
              {willShowChanged ? (
                <p className="callout blue mt-3 px-3.5 py-2.5">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Como a data ou o local mudou, a turma vai ver o evento como Alterado.
                </p>
              ) : null}
              {conflicts.length ? (
                <div className="callout amber mt-3 px-3.5 py-2.5">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <ul className="grid gap-1">
                    {conflicts.map((line) => (
                      <li key={line}>{line}.</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {isAdmin ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id={fid("turma")} label="Turma" hint="opcional" error={classError}>
                <select
                  ref={classRef}
                  id={fid("turma")}
                  name="academicClassId"
                  className={cx("input", invalidInput)}
                  value={form.academicClassId}
                  onChange={(event) => change({ academicClassId: event.target.value })}
                  aria-invalid={classError ? true : undefined}
                  aria-describedby={describedBy(classError && `${fid("turma")}-erro`)}
                >
                  <option value="">Toda a instituição</option>
                  {(context?.catalog.classes ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id={fid("disciplina")} label="Disciplina" hint="opcional" error={subjectError}>
                <select
                  ref={subjectRef}
                  id={fid("disciplina")}
                  name="subjectId"
                  className={cx("input", invalidInput)}
                  value={form.subjectId}
                  onChange={(event) => change({ subjectId: event.target.value })}
                  aria-invalid={subjectError ? true : undefined}
                  aria-describedby={describedBy(subjectError && `${fid("disciplina")}-erro`)}
                >
                  <option value="">Sem disciplina</option>
                  {(context?.catalog.subjects ?? []).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          ) : (
            <FormField id={fid("vinculo")} label="Disciplina e turma" error={pairError}>
              <select
                ref={pairRef}
                id={fid("vinculo")}
                name="assignment"
                className={cx("input", invalidInput)}
                value={pairValue}
                onChange={(event) => {
                  const [academicClassId = "", subjectId = ""] = event.target.value.split(":");
                  change({ academicClassId, subjectId });
                }}
                onBlur={() => markTouched("subjectId")}
                aria-invalid={pairError ? true : undefined}
                aria-describedby={describedBy(pairError && `${fid("vinculo")}-erro`)}
              >
                <option value="">Escolha a disciplina</option>
                {pairs.map((pair) => (
                  <option key={pair.value} value={pair.value}>
                    {pair.label}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={fid("local")} label="Local" hint="opcional" error={locationError}>
              <input
                ref={locationRef}
                id={fid("local")}
                name="location"
                className={cx("input", invalidInput)}
                value={form.location}
                onChange={(event) => change({ location: event.target.value })}
                aria-invalid={locationError ? true : undefined}
                aria-describedby={describedBy(locationError && `${fid("local")}-erro`)}
                placeholder="Sala, laboratório ou link"
              />
            </FormField>
            <FormField id={fid("pontos")} label="Pontuação" hint="opcional" error={pointsError}>
              <input
                ref={pointsRef}
                id={fid("pontos")}
                name="points"
                className={cx("input", invalidInput)}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.5"
                value={form.points}
                onChange={(event) => {
                  setPointsUnreadable(event.target.validity.badInput);
                  change({ points: event.target.value });
                }}
                onBlur={() => markTouched("points")}
                // a roda do mouse rola o painel, não muda o número
                onWheel={(event) => event.currentTarget.blur()}
                aria-invalid={pointsError ? true : undefined}
                aria-describedby={describedBy(pointsError && `${fid("pontos")}-erro`)}
                placeholder="Ex.: 10"
              />
            </FormField>
          </div>

          <FormField id={fid("descricao")} label="Descrição" hint="opcional" error={descriptionError}>
            <textarea
              ref={descriptionRef}
              id={fid("descricao")}
              name="description"
              className={cx("input min-h-28 [field-sizing:content]", invalidInput)}
              rows={4}
              value={form.description}
              onChange={(event) => change({ description: event.target.value })}
              aria-invalid={descriptionError ? true : undefined}
              aria-describedby={describedBy(descriptionError && `${fid("descricao")}-erro`)}
              placeholder={
                isAdmin ? "Detalhes para a comunidade do campus" : "Conteúdo, critérios e orientações para a turma"
              }
            />
          </FormField>

          <section className="grid gap-3 border-t border-line-2 pt-5" aria-labelledby={fid("previa")}>
            <h3 id={fid("previa")} className="text-[15px] font-bold text-ink">
              {hasClass || !isAdmin ? "Como a turma vai ver" : "Como todos vão ver"}
            </h3>
            <EventPreview
              form={form}
              status={editingEvent?.status ?? null}
              official={(editingEvent ? isOfficial(editingEvent) : isAdmin) && !adminOnlyCategories.includes(form.category)}
              audience={audience.label ?? "Escolha a disciplina e a turma"}
              past={startIsPast}
            />
            <p className="callout green">
              <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {previewNote}
            </p>
          </section>

          {phoneActions ? (
            <section className="grid gap-3 border-t border-line-2 pt-5 sm:hidden" aria-labelledby={fid("situacao")}>
              <h3 id={fid("situacao")} className="text-[15px] font-bold text-ink">
                Situação do evento
              </h3>
              <div className="flex flex-wrap items-center gap-2">{phoneActions}</div>
            </section>
          ) : null}
        </div>
      </form>

      {confirmPast ? (
        <ConfirmDialog
          confirm={pastConfirm}
          busy={saving}
          onCancel={() => {
            setConfirmPast(false);
            window.setTimeout(() => startsRef.current?.focus(), 60);
          }}
          onConfirm={() => {
            setConfirmPast(false);
            onSubmit();
          }}
        />
      ) : null}
    </>
  );
}
