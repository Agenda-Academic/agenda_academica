"use client";

import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  History,
  Inbox,
  Info,
  ListChecks,
  Megaphone,
  Search,
  SearchX,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { addDays, cx, formatTime, isWholeDay, monthTitle, startOfDay, weekdayLabels } from "@/lib/format";
import { allCategories, categoryMeta } from "@/lib/meta";
import type { AcademicClass, AcademicEvent, Category, UserRole } from "@/lib/types";
import { EventDetailContent, EventRow, eventLastDay, type EventStatusChange } from "./event-bits";
import { Modal, SectionTitle, Segmented, SegmentedButton } from "./ui";

export type CalendarMode = "list" | "month";
type TimeFilter = "upcoming" | "past" | "all";
type MonthCursor = { year: number; month: number };

const timeFilters: Array<{ value: TimeFilter; label: string }> = [
  { value: "upcoming", label: "Próximos" },
  { value: "past", label: "Passados" },
  { value: "all", label: "Todos" },
];

const periodNames: Record<TimeFilter, string> = { upcoming: "Próximos", past: "Passados", all: "Todos" };

const shortMonths = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function inPeriod(event: AcademicEvent, period: TimeFilter) {
  if (period === "all") {
    return true;
  }
  // vale o último dia do evento (término às 00:00 não conta aquele dia)
  const todayStart = startOfDay(new Date()).getTime();
  const lastDay = eventLastDay(event).getTime();
  return period === "upcoming" ? lastDay >= todayStart : lastDay < todayStart;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function byStart(a: AcademicEvent, b: AcademicEvent) {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

/* ------------------------------------------------------------------ */
/* Dias e meses                                                        */
/* ------------------------------------------------------------------ */

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthName(cursor: MonthCursor) {
  return new Date(cursor.year, cursor.month, 1).toLocaleDateString("pt-BR", { month: "long" });
}

function dayAndMonth(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

/** "Quinta, 5 de novembro" */
function dayTitle(date: Date) {
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long" }).replace("-feira", "");
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayAndMonth(date)}`;
}

/** "quinta-feira, 5 de novembro, 3 eventos" (para o leitor de tela) */
function dayLabel(date: Date, count: number, today: boolean) {
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long" });
  const events = count ? plural(count, "evento", "eventos") : "nenhum evento";
  return `${today ? "hoje, " : ""}${weekday}, ${dayAndMonth(date)}, ${events}`;
}

/** Primeiro e último dia da grade do mês (semanas completas, domingo a sábado). */
function gridRange(cursor: MonthCursor) {
  const first = new Date(cursor.year, cursor.month, 1);
  const last = new Date(cursor.year, cursor.month + 1, 0);
  return { start: addDays(first, -first.getDay()), end: addDays(last, 6 - last.getDay()) };
}

function gridShows(cursor: MonthCursor, date: Date) {
  const { start, end } = gridRange(cursor);
  const time = startOfDay(date).getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function eventSpan(event: AcademicEvent) {
  return { first: startOfDay(new Date(event.startsAt)).getTime(), last: eventLastDay(event).getTime() };
}

function occursOnDay(event: AcademicEvent, day: Date) {
  const span = eventSpan(event);
  const time = startOfDay(day).getTime();
  return span.first <= time && span.last >= time;
}

function occursInMonth(event: AcademicEvent, cursor: MonthCursor) {
  const span = eventSpan(event);
  return span.first <= new Date(cursor.year, cursor.month + 1, 0).getTime() && span.last >= new Date(cursor.year, cursor.month, 1).getTime();
}

type DayCell = { key: string; date: Date; inMonth: boolean; today: boolean; events: AcademicEvent[] };

function buildWeeks(cursor: MonthCursor, events: AcademicEvent[]) {
  const { start, end } = gridRange(cursor);
  const todayKey = dayKey(new Date());
  const spans = events.map((event) => ({ event, ...eventSpan(event) }));
  const weeks: DayCell[][] = [];
  for (let day = start; day.getTime() <= end.getTime(); day = addDays(day, 1)) {
    if (day.getDay() === 0) {
      weeks.push([]);
    }
    const time = day.getTime();
    weeks[weeks.length - 1].push({
      key: dayKey(day),
      date: day,
      inMonth: day.getMonth() === cursor.month,
      today: dayKey(day) === todayKey,
      events: spans
        .filter((span) => span.first <= time && span.last >= time)
        .map((span) => span.event)
        .sort(byStart),
    });
  }
  return weeks;
}

/** Mesmo dia num mês vizinho (31/01 vira 28/02). */
function shiftMonthKeepDay(date: Date, delta: number) {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + delta + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + delta, Math.min(date.getDate(), lastDay));
}

/** Grupos da lista: semanas e meses nos Próximos; meses em Passados (do mais recente) e Todos. */
function groupList(events: AcademicEvent[], period: TimeFilter) {
  const groups: Array<{ label: string; items: AcademicEvent[] }> = [];
  const push = (label: string, event: AcademicEvent) => {
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(event);
    } else {
      groups.push({ label, items: [event] });
    }
  };
  const ordered = [...events].sort(byStart);
  if (period === "upcoming") {
    const today = startOfDay(new Date());
    const nextWeekStart = addDays(today, 7 - today.getDay());
    const nextWeekEnd = addDays(nextWeekStart, 6);
    const range = `${nextWeekStart.getDate()} ${shortMonths[nextWeekStart.getMonth()]} a ${nextWeekEnd.getDate()} ${shortMonths[nextWeekEnd.getMonth()]}`;
    for (const event of ordered) {
      const day = startOfDay(new Date(event.startsAt));
      if (day < nextWeekStart) {
        push("Esta semana", event);
      } else if (day <= nextWeekEnd) {
        push(`Próxima semana, ${range}`, event);
      } else if (day.getMonth() === today.getMonth() && day.getFullYear() === today.getFullYear()) {
        push(`Mais adiante em ${monthName({ year: day.getFullYear(), month: day.getMonth() })}`, event);
      } else {
        push(monthTitle(day.getFullYear(), day.getMonth()), event);
      }
    }
    return groups;
  }
  for (const event of period === "past" ? ordered.reverse() : ordered) {
    const day = new Date(event.startsAt);
    push(monthTitle(day.getFullYear(), day.getMonth()), event);
  }
  return groups;
}

/** Media query com matchMedia; falso até montar (sem diferença entre servidor e navegador). */
function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Dois quadros depois: passa na frente do foco e da rolagem que a casca faz ao trocar de tela. */
function afterPaint(callback: () => void) {
  window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
}

/** Topo do elemento na página, sem as animações de entrada (offsetTop ignora transform). */
function pageTop(element: HTMLElement) {
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    top += node.offsetTop;
  }
  return top;
}

const ASIDE_GAP = 20;
// folga entre o dia escolhido (ou a lista dele) e as bordas da tela
const DAY_GAP = 16;

/**
 * Depois de rolar até a linha, o começo do painel ao lado (título e data) continua à vista. Com a lista
 * mais curta que o painel, ou perto do fim dela, o painel não tem onde grudar e subiria junto com a página.
 */
function keepAsideStart(aside: HTMLElement | null) {
  const row = aside?.parentElement;
  if (!aside || !row) {
    return;
  }
  const lowest = Math.max(0, pageTop(row) + row.offsetHeight - aside.offsetHeight - ASIDE_GAP);
  if (window.scrollY > lowest) {
    window.scrollTo({ top: lowest, behavior: "instant" });
  }
}

/** Até onde vai, no alto da tela, o cabeçalho DOM a SÁB quando gruda (no celular, abaixo do cabeçalho do app). */
function stuckHeadBottom(day: HTMLElement) {
  const head = day.closest(".cal")?.querySelector<HTMLElement>(".cal-head");
  return head ? (Number.parseFloat(getComputedStyle(head).top) || 0) + head.offsetHeight : 0;
}

/**
 * Rolagem do dia escolhido na grade. Parte do dia no mesmo lugar da tela (`top`), mesmo que a lista
 * de outro dia, acima dele, tenha saído. Com `list` (a lista do dia, logo abaixo da semana), desce só o
 * que falta para ela aparecer inteira; sem `list`, só traz o dia inteiro para a tela. O dia nunca fica
 * sob o cabeçalho DOM a SÁB: quando os dois não cabem juntos, valem o dia e o começo da lista, com o
 * título dela (que recebe o foco) sempre à vista.
 */
function placeDay(day: HTMLElement, top: number, list: HTMLElement | null, title: HTMLElement | null) {
  const safeTop = stuckHeadBottom(day) + DAY_GAP;
  const safeBottom = window.innerHeight - DAY_GAP;
  const dayTop = pageTop(day);
  const end = list ? pageTop(list) + list.offsetHeight : dayTop + day.offsetHeight;
  // parte do dia no mesmo lugar e desce até o fim aparecer, sem passar do ponto em que o dia encosta no cabeçalho
  let scroll = Math.min(Math.max(dayTop - top, end - safeBottom), dayTop - safeTop);
  if (title) {
    scroll = Math.max(scroll, pageTop(title) + title.offsetHeight - safeBottom);
  }
  scroll = Math.max(0, Math.round(scroll));
  if (scroll !== Math.round(window.scrollY)) {
    window.scrollTo({ top: scroll, behavior: "instant" });
  }
}

/**
 * Painel ao lado sem rolagem própria (a roda sempre rola a página): preso no alto quando cabe na janela;
 * mais alto que ela, desce e sobe junto com a página até mostrar o fim ou o começo, e então fica preso.
 * Devolve a função que volta a mostrar o começo do painel.
 */
function useAsideFollow(ref: RefObject<HTMLElement | null>, active: boolean, resetKey: string) {
  const topRef = useRef(ASIDE_GAP);
  const holdUntil = useRef(0);

  useEffect(() => {
    const aside = ref.current;
    if (!active || !aside) {
      return;
    }
    let lastY = window.scrollY;
    const apply = () => {
      const lowest = Math.min(ASIDE_GAP, window.innerHeight - aside.offsetHeight - ASIDE_GAP);
      topRef.current = Math.min(ASIDE_GAP, Math.max(lowest, topRef.current));
      aside.style.top = `${topRef.current}px`;
    };
    const onScroll = () => {
      const y = window.scrollY;
      // a rolagem que o sistema faz logo depois de escolher um evento não esconde o começo do painel
      if (performance.now() > holdUntil.current) {
        topRef.current -= y - lastY;
      }
      lastY = y;
      apply();
    };
    const observer = new ResizeObserver(apply);
    observer.observe(aside);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", apply);
    apply();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", apply);
      aside.style.top = "";
    };
  }, [ref, active]);

  // começo do painel à vista; a rolagem que o sistema faz logo em seguida não o esconde
  const reset = useCallback(() => {
    topRef.current = ASIDE_GAP;
    holdUntil.current = performance.now() + 450;
    if (ref.current) {
      ref.current.style.top = `${ASIDE_GAP}px`;
    }
  }, [ref]);

  // outro evento: o painel volta a mostrar o começo
  useEffect(() => reset(), [reset, resetKey]);

  return reset;
}

/* ------------------------------------------------------------------ */
/* Peças                                                               */
/* ------------------------------------------------------------------ */

function ListEmpty({ actions, hint, icon: Icon, title }: { actions?: ReactNode; hint?: string; icon: LucideIcon; title: string }) {
  return (
    <div className="empty-inline">
      <span className="empty-ico">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[15px] font-bold text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-sm leading-5 text-muted">{hint}</p> : null}
      {actions ? <div className="mt-3 flex flex-wrap justify-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

/**
 * Título do evento na grade, que quebra só entre as palavras. A 1ª palavra é a única que pode passar
 * da largura na 1ª linha (as outras descem para a 2ª, que o corte termina em reticências): ela vai num
 * bloco que também termina em reticências ("Seminá..."), em vez de partir ao meio ("Seminári / o").
 */
function chipTitle(title: string) {
  const [first, ...rest] = title.trim().split(/\s+/);
  return (
    <>
      <span>{first}</span>
      {rest.length ? ` ${rest.join(" ")}` : null}
    </>
  );
}

/** Eventos de um dia escolhido no mês, logo abaixo da semana dele (o card do dia do Figma, perto do dia). */
function DayEvents({
  date,
  events,
  hideClass,
  level,
  selectedEventId,
  showTeacher,
  titleRef,
  onOpen,
}: {
  date: Date;
  events: AcademicEvent[];
  hideClass: boolean;
  level: 2 | 3;
  selectedEventId: number | null;
  showTeacher: (event: AcademicEvent) => boolean;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onOpen: (id: number) => void;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div>
      <Heading ref={titleRef} tabIndex={-1} className="h2 pr-12">
        {dayTitle(date)}
      </Heading>
      <p className="sub">{events.length ? plural(events.length, "evento", "eventos") : "Nenhum evento neste dia."}</p>
      {events.length ? (
        <div className="mt-3 grid gap-0.5">
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              hideClass={hideClass}
              hideDate
              selected={event.id === selectedEventId}
              showTeacher={showTeacher(event)}
              onClick={() => onOpen(event.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MonthCalendar({
  cursor,
  dayPanel,
  events,
  monthEventCount,
  selectedDay,
  selectedEventId,
  setCursor,
  onOpenEvent,
  onSelectDay,
}: {
  cursor: MonthCursor;
  /** Lista do dia escolhido: entra logo abaixo da semana dele (se o dia não está na grade mostrada, não aparece). */
  dayPanel?: ReactNode;
  events: AcademicEvent[];
  monthEventCount: number;
  selectedDay: string | null;
  selectedEventId: number | null;
  setCursor: (cursor: MonthCursor) => void;
  onOpenEvent: (id: number, day: string) => void;
  onSelectDay: (day: string) => void;
}) {
  const titleId = useId();
  const weeks = useMemo(() => buildWeeks(cursor, events), [cursor, events]);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const cells = weeks.flat();
  const keys = new Set(cells.map((cell) => cell.key));
  const firstOfMonth = cells.find((cell) => cell.inMonth)?.key ?? null;
  const todayCell = cells.find((cell) => cell.today)?.key ?? null;
  // tabulação em um dia só (setas andam entre os dias)
  const rovingKey = [activeDay, selectedDay, todayCell].find((key) => key !== null && keys.has(key)) ?? firstOfMonth;

  const present = allCategories.filter((category) =>
    cells.some((cell) => cell.inMonth && cell.events.some((event) => event.category === category))
  );

  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) {
      return;
    }
    const button = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`);
    if (button) {
      pendingFocus.current = null;
      button.focus();
    }
  });

  function showMonthOf(date: Date) {
    setCursor({ year: date.getFullYear(), month: date.getMonth() });
  }

  function shiftMonth(delta: number) {
    showMonthOf(new Date(cursor.year, cursor.month + delta, 1));
  }

  function onGridKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const key = (event.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day;
    if (!key) {
      return;
    }
    const date = parseDayKey(key);
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      Home: () => addDays(date, -date.getDay()),
      End: () => addDays(date, 6 - date.getDay()),
      PageUp: () => shiftMonthKeepDay(date, -1),
      PageDown: () => shiftMonthKeepDay(date, 1),
    };
    const move = moves[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    const next = move();
    const nextKey = dayKey(next);
    setActiveDay(nextKey);
    pendingFocus.current = nextKey;
    if (!gridShows(cursor, next) || event.key === "PageUp" || event.key === "PageDown") {
      showMonthOf(next);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={titleId} className="disp text-[22px] font-bold">
          {monthTitle(cursor.year, cursor.month)}
        </h3>
        <div className="flex items-center gap-2">
          <button className="ib sm" aria-label="Mês anterior" onClick={() => shiftMonth(-1)} title="Mês anterior" type="button">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button className="btn btn-s btn-sm" onClick={() => showMonthOf(new Date())} type="button">
            Hoje
          </button>
          <button className="ib sm" aria-label="Próximo mês" onClick={() => shiftMonth(1)} title="Próximo mês" type="button">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {present.length ? (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink-3" aria-label="Cores das categorias">
          {present.map((category) => (
            <li key={category} className="inline-flex items-center gap-1.5">
              <span className={cx("dot", categoryMeta[category].accent)} aria-hidden />
              {categoryMeta[category].label}
            </li>
          ))}
        </ul>
      ) : null}

      {monthEventCount === 0 ? <p className="callout past mb-3">Nenhum evento em {monthName(cursor)}.</p> : null}

      <div ref={gridRef} className="cal" role="group" aria-labelledby={titleId} onKeyDown={onGridKey}>
        <div className="cal-head" aria-hidden>
          {weekdayLabels.map((label) => (
            <span key={label} className="max-sm:px-0 max-sm:text-center">
              {label}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <Fragment key={week[0].key}>
            <div className="week">
              {week.map((cell) => {
                const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
                const selected = cell.key === selectedDay;
                const dots = Array.from(new Set(cell.events.map((event) => event.category))).slice(0, 4);
                const more = cell.events.length - 2;
                return (
                  <button
                    key={cell.key}
                    aria-label={dayLabel(cell.date, cell.events.length, cell.today)}
                    aria-pressed={selected}
                    className={cx(
                      "day w-full text-left max-lg:min-h-16 max-lg:items-center max-lg:px-1 max-lg:py-1.5",
                      !cell.inMonth && "out",
                      cell.today && "today",
                      weekend && "we",
                      selected && "sel"
                    )}
                    data-day={cell.key}
                    onClick={(click) => {
                      // os chips dos eventos abrem o evento; o resto do dia mostra a lista do dia
                      const chip = (click.target as HTMLElement).closest<HTMLElement>("[data-event-id]");
                      if (chip?.dataset.eventId) {
                        onOpenEvent(Number(chip.dataset.eventId), cell.key);
                      } else {
                        onSelectDay(cell.key);
                      }
                    }}
                    onFocus={() => setActiveDay(cell.key)}
                    tabIndex={cell.key === rovingKey ? 0 : -1}
                    type="button"
                  >
                    <span className="dnum">{cell.date.getDate()}</span>
                    {cell.events.length ? (
                      <span className="hidden min-w-0 flex-col gap-1 lg:flex">
                        {cell.events.slice(0, 2).map((event) => (
                          <span
                            key={event.id}
                            className={cx(
                              "ce transition hover:brightness-95",
                              categoryMeta[event.category].tint,
                              selectedEventId === event.id && "ring-2 ring-night/60",
                              event.status === "cancelled" && "line-through opacity-70"
                            )}
                            data-event-id={event.id}
                            title={event.title}
                          >
                            <span className="t">{chipTitle(event.title)}</span>
                            <span className="h">{isWholeDay(event.startsAt, event.endsAt) ? "dia todo" : formatTime(event.startsAt)}</span>
                          </span>
                        ))}
                        {more > 0 ? (
                          <span className="px-2 text-[12px] font-semibold text-muted">
                            +{plural(more, "evento", "eventos")}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {dots.length ? (
                      <span className="cal-dots lg:hidden" aria-hidden>
                        {dots.map((category) => (
                          <span key={category} className={cx("dot", categoryMeta[category].accent)} />
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {/* a lista do dia abre embaixo da semana dele: o dia e os eventos cabem juntos na tela */}
            {selectedDay && week.some((cell) => cell.key === selectedDay) ? dayPanel : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cronograma                                                          */
/* ------------------------------------------------------------------ */

function selectionKey(id: number | null, event: AcademicEvent | null) {
  return id === null ? "" : `${id}:${event ? 1 : 0}`;
}

function noticeFor(event: AcademicEvent, from: TimeFilter) {
  return from === "upcoming"
    ? `Mostrando Todos para incluir "${event.title}", que já passou.`
    : `Mostrando Todos para incluir "${event.title}", que ainda vai acontecer.`;
}

export function CalendarView({
  allEvents,
  calendarMode,
  canManageEvent,
  classes,
  events,
  reminderOffset,
  role,
  saving,
  search,
  selectedCategories,
  selectedEvent,
  selectedEventId,
  setCalendarMode,
  setCategories,
  setReminderOffset,
  setSearch,
  toggleCategory,
  onDelete,
  onEdit,
  onRemoveReminder,
  onSaveReminder,
  onSelect,
  onSetStatus,
}: {
  /** Eventos já filtrados pela busca e sem o filtro de categoria, para as contagens dos chips. */
  allEvents?: AcademicEvent[];
  calendarMode: CalendarMode;
  canManageEvent: (event: AcademicEvent) => boolean;
  classes: AcademicClass[];
  events: AcademicEvent[];
  reminderOffset: string;
  role: UserRole;
  saving: boolean;
  search: string;
  selectedCategories: Category[];
  selectedEvent: AcademicEvent | null;
  selectedEventId: number | null;
  setCalendarMode: (mode: CalendarMode) => void;
  setCategories?: (categories: Category[]) => void;
  setReminderOffset: (value: string) => void;
  setSearch: (value: string) => void;
  toggleCategory: (category: Category) => void;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  onRemoveReminder: (event: AcademicEvent) => void;
  onSaveReminder: () => void;
  onSelect: (id: number | null) => void;
  onSetStatus: (event: AcademicEvent, status: EventStatusChange) => void;
}) {
  const wide = useMediaQuery("(min-width: 1280px)");
  const narrow = useMediaQuery("(max-width: 1279px)");
  const touch = useMediaQuery("(pointer: coarse)");
  const monthMode = calendarMode === "month";
  // painel ao lado só no computador e só na Agenda. No Calendário ele deixaria cada dia com no máximo
  // uns 110 px (a casca vai até 1560 px) e os títulos não caberiam: a grade fica larga, a lista do dia
  // abre embaixo da semana dele (o dia e os eventos cabem juntos na tela) e o detalhe abre no Modal,
  // por cima. Os dois ficam falsos até montar.
  const side = wide && !monthMode;
  const compact = (wide || narrow) && !side;

  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() =>
    selectedEvent && !inPeriod(selectedEvent, "upcoming") ? "all" : "upcoming"
  );
  const [periodNotice, setPeriodNotice] = useState<string | null>(() =>
    selectedEvent && !inPeriod(selectedEvent, "upcoming") ? noticeFor(selectedEvent, "upcoming") : null
  );
  const [mineOnly, setMineOnly] = useState(false);
  const [classFilter, setClassFilter] = useState("all");
  // mês guardado aqui para não voltar ao mês atual ao alternar Agenda e Calendário
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const base = selectedEvent ? new Date(selectedEvent.startsAt) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(() =>
    calendarMode === "month" && selectedEvent ? dayKey(new Date(selectedEvent.startsAt)) : null
  );
  // último evento escolhido aqui dentro (lista, grade ou dia): esse já está à vista
  const [internalId, setInternalId] = useState<number | null>(null);

  // evento escolhido de outro lugar (Painel, avisos) ou salvo com outra data: deixa à vista (período, mês e dia)
  const currentKey = selectionKey(selectedEventId, selectedEvent);
  // o instante (e não o texto), para a mesma data em outro formato não contar como mudança
  const currentStart = selectedEvent ? new Date(selectedEvent.startsAt).getTime() : null;
  const [tracked, setTracked] = useState({ key: currentKey, start: currentStart });
  if (tracked.key !== currentKey || tracked.start !== currentStart) {
    // o mesmo evento mudou de data: a lista e o mês vão atrás dele, mesmo se foi escolhido aqui
    const moved = tracked.key === currentKey && tracked.start !== null && currentStart !== null;
    setTracked({ key: currentKey, start: currentStart });
    if (selectedEvent && (moved || selectedEvent.id !== internalId)) {
      if (!inPeriod(selectedEvent, timeFilter)) {
        setPeriodNotice(noticeFor(selectedEvent, timeFilter));
        setTimeFilter("all");
      }
      const start = new Date(selectedEvent.startsAt);
      if (!gridShows(cursor, start)) {
        setCursor({ year: start.getFullYear(), month: start.getMonth() });
      }
      if (calendarMode === "month" && !(selectedDay && occursOnDay(selectedEvent, parseDayKey(selectedDay)))) {
        setSelectedDay(dayKey(start));
      }
    } else if (selectedEventId === null) {
      setPeriodNotice(null);
    }
  }

  const sectionRef = useRef<HTMLElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const dayTitleRef = useRef<HTMLHeadingElement>(null);
  const dayPanelRef = useRef<HTMLElement>(null);
  const allChipRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // evento, modo e data para os quais a página já rolou até a linha ou o dia
  const scrolledFor = useRef<{ id: number; mode: CalendarMode; start: number | null } | null>(null);
  const pendingFocus = useRef<"detail" | null>(null);
  // dia escolhido na grade e onde ele estava na tela: fica no mesmo lugar quando a lista muda de semana,
  // e com `list` a página desce só o que falta para a lista dele aparecer (e o foco vai para ela)
  const dayAnchor = useRef<{ key: string; top: number; list: boolean } | null>(null);

  const scope = useCallback(
    (list: AcademicEvent[]) => {
      let scoped = list;
      if (role === "teacher" && mineOnly) {
        scoped = scoped.filter(canManageEvent);
      }
      if (role === "admin" && classFilter !== "all") {
        scoped =
          classFilter === "official"
            ? scoped.filter((event) => !event.academicClassId)
            : scoped.filter((event) => event.academicClassId === Number(classFilter));
      }
      return scoped;
    },
    [role, mineOnly, classFilter, canManageEvent]
  );

  const scopedEvents = useMemo(() => scope(events), [scope, events]);
  const listEvents = useMemo(() => scopedEvents.filter((event) => inPeriod(event, timeFilter)), [scopedEvents, timeFilter]);
  const monthEvents = useMemo(() => scopedEvents.filter((event) => occursInMonth(event, cursor)), [scopedEvents, cursor]);
  const groups = useMemo(() => groupList(listEvents, timeFilter), [listEvents, timeFilter]);
  const spansMonths = useMemo(
    () =>
      new Set(
        listEvents.map((event) => {
          const start = new Date(event.startsAt);
          return start.getFullYear() * 12 + start.getMonth();
        })
      ).size > 1,
    [listEvents]
  );

  // contagem por categoria: allEvents já chega filtrado pela busca; aqui entram o perfil e o período
  // da Agenda ou, no Calendário, o mês que está na tela (o mesmo do contador)
  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(allCategories.map((category) => [category, 0])) as Record<Category, number>;
    for (const event of scope(allEvents ?? events)) {
      if (monthMode ? occursInMonth(event, cursor) : inPeriod(event, timeFilter)) {
        counts[event.category] += 1;
      }
    }
    return counts;
  }, [allEvents, events, scope, monthMode, cursor, timeFilter]);

  const term = search.trim();
  const otherPeriod: TimeFilter | null = timeFilter === "upcoming" ? "past" : timeFilter === "past" ? "upcoming" : null;
  const otherCount = otherPeriod ? scopedEvents.filter((event) => inPeriod(event, otherPeriod)).length : 0;
  const allSelected = selectedCategories.length === allCategories.length;
  const narrowed = !allSelected || mineOnly || classFilter !== "all";
  const hasFilter = Boolean(term) || narrowed || (calendarMode === "list" && timeFilter !== "upcoming");

  const counterText =
    calendarMode === "month"
      ? `${term ? plural(monthEvents.length, "encontrado", "encontrados") : plural(monthEvents.length, "evento", "eventos")} em ${monthName(cursor)}`
      : term
        ? plural(listEvents.length, "encontrado", "encontrados")
        : timeFilter === "upcoming"
          ? plural(listEvents.length, "próximo", "próximos")
          : timeFilter === "past"
            ? plural(listEvents.length, "passado", "passados")
            : plural(listEvents.length, "evento", "eventos");

  const selectedDayDate = selectedDay ? parseDayKey(selectedDay) : null;
  const dayEvents = selectedDayDate ? scopedEvents.filter((event) => occursOnDay(event, selectedDayDate)) : [];
  const asideOpen = side && selectedEvent !== null;
  const asideRef = useRef<HTMLElement>(null);
  const resetAside = useAsideFollow(asideRef, asideOpen, String(selectedEventId ?? ""));
  const hiddenByFilters =
    !monthMode && selectedEvent !== null && !periodNotice && !listEvents.some((event) => event.id === selectedEvent.id);

  const showTeacher = useCallback(
    (event: AcademicEvent) => (role === "teacher" ? !canManageEvent(event) : role === "admin" && event.source === "teacher"),
    [role, canManageEvent]
  );

  // evento escolhido (aqui, no Painel, nos avisos ou na busca): a página rola até a linha ou o dia dele,
  // sem rolar se já está à vista. O mesmo evento num lugar novo (salvo com outra data, ou o outro modo)
  // vai para o centro: a lista acompanha o evento.
  const targetDay = selectedDay ?? (selectedEvent ? dayKey(new Date(selectedEvent.startsAt)) : null);
  const targetVisible =
    selectedEventId !== null &&
    selectedEvent !== null &&
    (monthMode
      ? targetDay !== null && gridShows(cursor, parseDayKey(targetDay))
      : listEvents.some((event) => event.id === selectedEventId));
  useEffect(() => {
    if (selectedEventId === null || !targetVisible) {
      return;
    }
    const last = scrolledFor.current;
    if (last && last.id === selectedEventId && last.mode === calendarMode && last.start === currentStart) {
      return;
    }
    scrolledFor.current = { id: selectedEventId, mode: calendarMode, start: currentStart };
    const relocated = last?.id === selectedEventId;
    afterPaint(() => {
      const root = sectionRef.current;
      const target = monthMode
        ? root?.querySelector<HTMLElement>(`[data-day="${targetDay}"]`)
        : root?.querySelector<HTMLElement>(`.ev[data-event-id="${selectedEventId}"]`);
      if (!target) {
        return;
      }
      if (relocated) {
        resetAside();
      }
      target.scrollIntoView({ block: relocated ? "center" : "nearest" });
      // com o painel ao lado, o título do detalhe nunca fica acima da tela
      keepAsideStart(asideRef.current);
    });
  }, [selectedEventId, calendarMode, targetVisible, currentStart, monthMode, targetDay, resetAside]);

  // no computador, o foco vai para o título do detalhe ao lado (no Modal, quem cuida é o próprio Modal)
  useEffect(() => {
    if (!side || selectedEventId === null) {
      return;
    }
    afterPaint(() => {
      const title = detailTitleRef.current;
      if (!title) {
        return;
      }
      title.focus({ preventScroll: true });
      const box = title.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) {
        title.scrollIntoView({ block: "nearest" });
      }
    });
  }, [side, selectedEventId]);

  // foco pedido por uma ação (abrir do dia ou da grade)
  useEffect(() => {
    if (!pendingFocus.current) {
      return;
    }
    pendingFocus.current = null;
    window.requestAnimationFrame(() => detailTitleRef.current?.focus({ preventScroll: true }));
  });

  function dayButton(key: string | null) {
    return key ? (sectionRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`) ?? null) : null;
  }

  /** Dia escolhido na grade: fica onde estava na tela e, com `list`, a lista dele aparece logo abaixo. */
  function placeChosenDay() {
    const anchor = dayAnchor.current;
    dayAnchor.current = null;
    const button = dayButton(anchor?.key ?? null);
    if (!anchor || !button) {
      return;
    }
    if (anchor.list) {
      placeDay(button, anchor.top, dayPanelRef.current, dayTitleRef.current);
      dayTitleRef.current?.focus({ preventScroll: true });
      return;
    }
    // evento aberto pelo chip: só desfaz o deslocamento da lista de outro dia que saiu de cima (o Modal cobre a tela)
    const scroll = Math.max(0, Math.round(pageTop(button) - anchor.top));
    if (scroll !== Math.round(window.scrollY)) {
      window.scrollTo({ top: scroll, behavior: "instant" });
    }
  }

  // antes de pintar, para o dia escolhido não pular de lugar debaixo do cursor
  useLayoutEffect(() => {
    if (dayAnchor.current) {
      placeChosenDay();
    }
  });

  function setPeriod(value: TimeFilter) {
    setTimeFilter(value);
    setPeriodNotice(null);
  }

  function clearAll() {
    setSearch("");
    setPeriod("upcoming");
    setMineOnly(false);
    setClassFilter("all");
    if (setCategories) {
      setCategories(allCategories);
    } else {
      allCategories.filter((category) => !selectedCategories.includes(category)).forEach(toggleCategory);
    }
  }

  /** O botão clicado some da tela: o foco vai para o chip "Todas", que fica (e não cai no início da página). */
  function focusAllChip() {
    window.requestAnimationFrame(() => allChipRef.current?.focus());
  }

  function clearSearch() {
    setSearch("");
    focusAllChip();
  }

  function clearFilters() {
    clearAll();
    focusAllChip();
  }

  /** Ao ir para o Calendário com um evento aberto, a grade mostra o mês e o dia dele. */
  function changeMode(mode: CalendarMode) {
    if (mode === "month" && !monthMode && selectedEvent) {
      const start = new Date(selectedEvent.startsAt);
      if (!gridShows(cursor, start)) {
        setCursor({ year: start.getFullYear(), month: start.getMonth() });
      }
      if (!(selectedDay && occursOnDay(selectedEvent, parseDayKey(selectedDay)))) {
        setSelectedDay(dayKey(start));
      }
    }
    setCalendarMode(mode);
  }

  function selectFromList(id: number) {
    setInternalId(id);
    onSelect(id);
  }

  function selectDay(key: string) {
    const button = dayButton(key);
    if (button) {
      dayAnchor.current = { key, top: pageTop(button) - window.scrollY, list: true };
    }
    if (key === selectedDay) {
      // o mesmo dia de novo: nada muda na tela, a lista dele volta a aparecer e recebe o foco
      placeChosenDay();
      return;
    }
    setSelectedDay(key);
  }

  /** Fecha a lista do dia e devolve o foco ao dia na grade, que fica onde está (à vista). */
  function closeDay() {
    const day = selectedDay;
    setSelectedDay(null);
    window.requestAnimationFrame(() => {
      const button = dayButton(day);
      if (button) {
        button.focus({ preventScroll: true });
        placeDay(button, pageTop(button) - window.scrollY, null, null);
      }
    });
  }

  function openFromDay(id: number) {
    setInternalId(id);
    pendingFocus.current = "detail";
    onSelect(id);
  }

  function openFromGrid(id: number, key: string) {
    const button = dayButton(key);
    if (button && key !== selectedDay) {
      dayAnchor.current = { key, top: pageTop(button) - window.scrollY, list: false };
    }
    setInternalId(id);
    setSelectedDay(key);
    pendingFocus.current = "detail";
    onSelect(id);
  }

  /** Fecha o painel ao lado e devolve o foco para a linha de origem. */
  function closeAside() {
    const eventId = selectedEventId;
    if (eventId === null) {
      return;
    }
    onSelect(null);
    window.requestAnimationFrame(() => {
      const row = sectionRef.current?.querySelector<HTMLElement>(`.ev[data-event-id="${eventId}"]`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    });
  }

  function renderDetail(event: AcademicEvent) {
    return (
      <EventDetailContent
        key={event.id}
        canManage={canManageEvent(event)}
        event={event}
        reminderOffset={reminderOffset}
        saving={saving}
        setReminderOffset={setReminderOffset}
        cornerSpace={side}
        titleRef={detailTitleRef}
        onDelete={onDelete}
        onEdit={onEdit}
        onRemoveReminder={onRemoveReminder}
        onSaveReminder={onSaveReminder}
        onSetStatus={onSetStatus}
      />
    );
  }

  const title =
    role === "admin" ? "Cronograma institucional" : role === "teacher" ? "Cronograma das suas turmas" : "Cronograma da sua turma";
  const subtitle = monthMode
    ? `${touch ? "Toque" : "Clique"} num dia para ver os eventos dele`
    : `${touch ? "Toque" : "Clique"} num evento para ver os detalhes`;

  function listBody() {
    if (listEvents.length) {
      return (
        <div key={`lista-${timeFilter}`} className="pop">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="ev-group">{group.label}</p>
              <div className="grid gap-0.5">
                {group.items.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    hideClass={role === "student"}
                    selected={selectedEventId === event.id}
                    showMonth={spansMonths}
                    showTeacher={showTeacher(event)}
                    onClick={() => selectFromList(event.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    const seeOther =
      otherPeriod && otherCount ? (
        <button className="btn btn-p" onClick={() => setPeriod(otherPeriod)} type="button">
          Ver em {periodNames[otherPeriod]}
        </button>
      ) : null;
    const otherHint =
      otherPeriod && otherCount
        ? `Há ${plural(otherCount, "resultado", "resultados")} em ${periodNames[otherPeriod]}.`
        : undefined;

    if (term) {
      return (
        <ListEmpty
          icon={SearchX}
          title={otherHint ? `Nada encontrado em ${periodNames[timeFilter]} para "${term}".` : `Nada encontrado para "${term}".`}
          hint={otherHint ?? (narrowed ? "Os filtros escolhidos também valem para a busca." : undefined)}
          actions={
            <>
              {seeOther}
              <button className="btn btn-s" onClick={clearSearch} type="button">
                Limpar busca
              </button>
            </>
          }
        />
      );
    }

    return (
      <ListEmpty
        icon={timeFilter === "past" ? History : Inbox}
        title={
          timeFilter === "upcoming"
            ? "Nenhum evento nos próximos dias."
            : timeFilter === "past"
              ? "Nenhum evento passado."
              : "Nenhum evento encontrado."
        }
        hint={narrowed ? "Ajuste ou limpe os filtros para ver mais." : otherHint}
        actions={
          seeOther || narrowed ? (
            <>
              {seeOther}
              {narrowed ? (
                <button className="btn btn-s" onClick={clearFilters} type="button">
                  Limpar filtros
                </button>
              ) : null}
            </>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className={cx("grid items-start gap-5", asideOpen && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
      <section ref={sectionRef} className="card pad rise min-w-0" aria-label="Cronograma">
        <div className="head">
          <SectionTitle title={title} subtitle={subtitle} />
          <Segmented label="Modo de visualização">
            <SegmentedButton active={calendarMode === "list"} onClick={() => changeMode("list")} icon={ListChecks} label="Agenda" />
            <SegmentedButton active={calendarMode === "month"} onClick={() => changeMode("month")} icon={CalendarRange} label="Calendário" />
          </Segmented>
        </div>

        <div className="mt-4 grid gap-3 border-b border-line-2 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* no celular a busca fica aqui; a partir de 768px ela fica no menu e aqui aparece só o chip */}
            <label className="relative flex min-w-[200px] flex-1 items-center md:hidden">
              <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted" aria-hidden />
              <input
                ref={searchInputRef}
                className="input min-h-[44px] pl-10 pr-11"
                placeholder="Buscar no cronograma"
                aria-label="Filtrar por título, disciplina, turma ou docente"
                enterKeyHint="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && search) {
                    event.preventDefault();
                    setSearch("");
                  }
                }}
              />
              {search ? (
                <button
                  className="absolute right-1.5 grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
                  aria-label="Limpar busca"
                  onClick={() => {
                    // o X faz parte do campo: o foco volta para ele, pronto para outra busca
                    setSearch("");
                    searchInputRef.current?.focus();
                  }}
                  title="Limpar busca"
                  type="button"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </label>

            {term ? (
              <span className="chip picked hidden max-w-full pr-1.5 md:inline-flex">
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">
                  Busca: <b>{term}</b>
                </span>
                <button
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-surface-2"
                  aria-label="Limpar busca"
                  onClick={clearSearch}
                  title="Limpar busca"
                  type="button"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </span>
            ) : null}

            {calendarMode === "list" ? (
              <Segmented label="Período">
                {timeFilters.map((item) => (
                  <SegmentedButton
                    key={item.value}
                    active={timeFilter === item.value}
                    label={item.label}
                    onClick={() => setPeriod(item.value)}
                  />
                ))}
              </Segmented>
            ) : null}

            {role === "teacher" ? (
              <button
                className={cx("chip", mineOnly && "picked text-brand-ink bg-brand-50")}
                aria-pressed={mineOnly}
                onClick={() => setMineOnly(!mineOnly)}
                type="button"
              >
                <Megaphone className="h-3.5 w-3.5" aria-hidden />
                Só meus eventos
              </button>
            ) : null}

            {role === "admin" && classes.length ? (
              <select
                aria-label="Turma"
                className={cx("input min-h-[44px] w-auto font-semibold", classFilter !== "all" && "border-night text-night")}
                value={classFilter}
                onChange={(event) => setClassFilter(event.target.value)}
              >
                <option value="all">Todas as turmas</option>
                <option value="official">Somente institucionais</option>
                {classes.map((academicClass) => (
                  <option key={academicClass.id} value={academicClass.id}>
                    {academicClass.name}
                  </option>
                ))}
              </select>
            ) : null}

            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-ink-3" role="status">
                {counterText}
              </span>
              {hasFilter ? (
                <button className="link" onClick={clearFilters} type="button">
                  Limpar filtros
                </button>
              ) : null}
            </span>
          </div>

          <div className="chips chips-row items-center" role="group" aria-label="Categorias">
            <button
              ref={allChipRef}
              className={cx("chip", allSelected && "all")}
              aria-pressed={allSelected}
              onClick={() => (setCategories ? setCategories(allCategories) : clearAll())}
              type="button"
            >
              Todas
              <span className="n">{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span>
            </button>
            {allCategories.map((category) => {
              const picked = !allSelected && selectedCategories.includes(category);
              const meta = categoryMeta[category];
              // sem nada para mostrar, o chip some (a não ser que esteja escolhido)
              if (allEvents && categoryCounts[category] === 0 && !picked) {
                return null;
              }
              return (
                <button
                  key={category}
                  className={cx("chip", picked && cx("picked", meta.tint))}
                  aria-pressed={picked}
                  onClick={() => toggleCategory(category)}
                  type="button"
                >
                  <span className={cx("dot", meta.accent)} aria-hidden />
                  {meta.label}
                  <span className="n">{categoryCounts[category]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {calendarMode === "list" && periodNotice ? (
          <div className="callout blue mt-3 flex-wrap items-center">
            <Info className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">{periodNotice}</span>
            <button className="link" onClick={() => setPeriod("upcoming")} type="button">
              Ver só os próximos
            </button>
          </div>
        ) : null}
        {calendarMode === "list" && term && listEvents.length && otherPeriod && otherCount ? (
          <div className="callout blue mt-3 flex-wrap items-center">
            <Info className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              Também há {plural(otherCount, "resultado", "resultados")} em {periodNames[otherPeriod]}.
            </span>
            <button className="link" onClick={() => setPeriod(otherPeriod)} type="button">
              Ver em {periodNames[otherPeriod]}
            </button>
          </div>
        ) : null}
        {hiddenByFilters && selectedEvent ? (
          <div className="callout blue mt-3 flex-wrap items-center">
            <Info className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">&quot;{selectedEvent.title}&quot; não aparece na lista com os filtros atuais.</span>
            <button className="link" onClick={clearFilters} type="button">
              Limpar filtros
            </button>
          </div>
        ) : null}

        <div className="mt-3">
          {calendarMode === "list" ? (
            listBody()
          ) : (
            <MonthCalendar
              cursor={cursor}
              dayPanel={
                // a lista do dia entra na grade, embaixo da semana dele; a grade continua larga
                compact && selectedDayDate ? (
                  <section
                    key={selectedDay}
                    ref={dayPanelRef}
                    className="cal-day pop"
                    aria-label={`Eventos de ${dayTitle(selectedDayDate)}`}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && !event.defaultPrevented) {
                        event.preventDefault();
                        closeDay();
                      }
                    }}
                  >
                    <button
                      className="ib sm absolute right-3 top-3"
                      aria-label="Fechar dia"
                      onClick={closeDay}
                      title="Fechar dia"
                      type="button"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                    <DayEvents
                      date={selectedDayDate}
                      events={dayEvents}
                      hideClass={role === "student"}
                      level={3}
                      selectedEventId={selectedEventId}
                      showTeacher={showTeacher}
                      titleRef={dayTitleRef}
                      onOpen={openFromDay}
                    />
                  </section>
                ) : null
              }
              events={scopedEvents}
              monthEventCount={monthEvents.length}
              selectedDay={selectedDay}
              selectedEventId={selectedEventId}
              setCursor={setCursor}
              onOpenEvent={openFromGrid}
              onSelectDay={selectDay}
            />
          )}
        </div>
      </section>

      {/* computador, na Agenda: detalhe ao lado, que acompanha a página (sem rolagem própria) */}
      {asideOpen && selectedEvent ? (
        <aside
          ref={asideRef}
          className="card pad rise relative min-w-0 xl:sticky xl:top-5"
          style={{ "--i": 1 } as CSSProperties}
          aria-label="Detalhe do evento"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              closeAside();
            }
          }}
        >
          <button
            className="ib sm absolute right-4 top-4 z-[1]"
            aria-label="Fechar detalhe"
            onClick={closeAside}
            title="Fechar detalhe"
            type="button"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
          <div key={`evento-${selectedEvent.id}`} className="pop">
            {renderDetail(selectedEvent)}
          </div>
        </aside>
      ) : null}

      {/* celular, tablet e Calendário: detalhe no Modal, com o foco no título do evento */}
      {compact && selectedEvent ? (
        <Modal title="Detalhes do evento" initialFocusRef={detailTitleRef} onClose={() => onSelect(null)}>
          {renderDetail(selectedEvent)}
        </Modal>
      ) : null}
    </div>
  );
}
