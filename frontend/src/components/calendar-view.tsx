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
  type FocusEvent as ReactFocusEvent,
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
// folga entre o que a página traz para a tela (a linha escolhida, o dia e a lista dele) e as bordas dela
const EDGE_GAP = 16;

/**
 * Caixa do elemento na página, com as frações de pixel, como ela fica no fim das entradas animadas (.rise,
 * .pop) dele e dos blocos em volta. O getBoundingClientRect mede o quadro atual da animação (até 13 px fora),
 * e a soma dos offsetTop, que são inteiros, errava até 2 px. As animações vão até o fim só durante a medida
 * e voltam para onde estavam antes de a tela ser pintada de novo.
 */
function settledBox(element: HTMLElement) {
  const seeks: Array<[Animation, CSSNumberish]> = [];
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const animations = typeof node.getAnimations === "function" ? node.getAnimations() : [];
    for (const animation of animations) {
      const time = animation.currentTime;
      const end = animation.effect?.getComputedTiming().endTime;
      if (time !== null && typeof end === "number" && Number.isFinite(end) && animation.playState === "running") {
        seeks.push([animation, time]);
        animation.currentTime = end;
      }
    }
  }
  const box = element.getBoundingClientRect();
  for (const [animation, time] of seeks) {
    animation.currentTime = time;
  }
  return { top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };
}

/**
 * Maior rolagem com o começo do painel ao lado (título e data) à vista. O painel gruda no alto só até
 * onde a grade vai: daí para baixo ele sobe junto com a página.
 */
function asideStartLimit(aside: HTMLElement) {
  const grid = aside.parentElement;
  return grid ? pageTop(grid) + grid.offsetHeight - aside.offsetHeight - ASIDE_GAP : Number.POSITIVE_INFINITY;
}

/**
 * Folga no fim da Agenda com o detalhe ao lado (useAsideRoom): a altura que falta embaixo da última linha
 * para ela, a EDGE_GAP da borda de baixo, caber na tela junto com o começo do painel, preso no alto. Com
 * a lista mais curta que o painel, a grade já vai até o fim dele, e não há folga.
 */
function sizeAsideRoom(room: HTMLElement, list: HTMLElement, aside: HTMLElement) {
  const card = room.parentElement;
  const grid = aside.parentElement;
  const rows = list.querySelectorAll<HTMLElement>(".ev");
  const last = rows[rows.length - 1];
  let height = 0;
  if (card && grid && last) {
    const style = getComputedStyle(card);
    // onde o card da lista terminaria sem a folga
    const cardEnd =
      pageTop(room) + (Number.parseFloat(style.paddingBottom) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0);
    // fim da grade com a última linha inteira na tela e o painel preso no alto
    const needed = pageTop(last) + last.offsetHeight + EDGE_GAP - window.innerHeight + ASIDE_GAP + aside.offsetHeight;
    if (needed > Math.max(cardEnd, pageTop(grid) + aside.offsetHeight)) {
      // 2 px a mais pelos arredondamentos do offsetTop
      height = Math.ceil(needed - cardEnd) + 2;
    }
  }
  const value = height ? `${height}px` : "";
  if (room.style.height !== value) {
    room.style.height = value;
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
  const safeTop = stuckHeadBottom(day) + EDGE_GAP;
  const safeBottom = window.innerHeight - EDGE_GAP;
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
 * Dia de um evento que chega de outro lugar (Painel, avisos, a Agenda), com a lista do dia aberta logo
 * abaixo da semana: o dia vai para o meio da tela e, se a lista não couber, a página desce até ela
 * aparecer inteira, sem levar o dia para baixo do cabeçalho DOM a SÁB. Com a lista mais alta que a
 * tela, a linha do evento (a marcada) fica à vista, mesmo que o dia suba.
 */
function placeDayWithEvent(day: HTMLElement, list: HTMLElement, row: HTMLElement | null) {
  const safeTop = stuckHeadBottom(day) + EDGE_GAP;
  const safeBottom = window.innerHeight - EDGE_GAP;
  const dayTop = pageTop(day);
  const listEnd = pageTop(list) + list.offsetHeight;
  let scroll = Math.min(
    Math.max(dayTop - (window.innerHeight - day.offsetHeight) / 2, listEnd - safeBottom),
    dayTop - safeTop
  );
  if (row) {
    const rowTop = pageTop(row);
    scroll = Math.min(Math.max(scroll, rowTop + row.offsetHeight - safeBottom), rowTop - safeTop);
  }
  scroll = Math.max(0, Math.round(scroll));
  if (scroll !== Math.round(window.scrollY)) {
    window.scrollTo({ top: scroll, behavior: "instant" });
  }
}

/**
 * Rola a página até o elemento ficar inteiro na tela, com a folga EDGE_GAP nas bordas (ou o scroll-margin
 * dele, quando é maior: o cabeçalho do celular em cima, os avisos embaixo). "nearest" rola só o que falta e
 * "center" leva o elemento ao meio. A medida é a do fim das entradas animadas (settledBox), para a linha
 * não ficar abaixo da borda quando a animação acaba. Com o painel ao lado (`aside`), o começo dele também
 * fica à vista sempre que cabe junto com o elemento (na Agenda, a folga do useAsideRoom garante isso);
 * quando não cabe, vale o elemento, e o painel sobe com a página.
 */
function revealElement(element: HTMLElement, block: "center" | "nearest", aside?: HTMLElement | null) {
  const box = settledBox(element);
  const style = getComputedStyle(element);
  const top = box.top - Math.max(EDGE_GAP, Number.parseFloat(style.scrollMarginTop) || 0);
  const bottom = box.bottom + Math.max(EDGE_GAP, Number.parseFloat(style.scrollMarginBottom) || 0);
  const viewHeight = window.innerHeight;
  const current = Math.round(window.scrollY);
  // rolagens com o elemento inteiro entre as folgas: da que deixa o fim dele embaixo até a que deixa o
  // começo em cima (mais alto que a tela, vale o começo)
  const maxScroll = Math.floor(top);
  const minScroll = Math.min(maxScroll, Math.ceil(bottom - viewHeight));
  let next = block === "center" ? Math.round((top + bottom - viewHeight) / 2) : current;
  next = Math.min(Math.max(next, minScroll), maxScroll);
  if (aside) {
    next = Math.max(Math.min(next, Math.floor(asideStartLimit(aside))), minScroll);
  }
  next = Math.max(0, next);
  if (next !== current) {
    window.scrollTo({ top: next, behavior: "instant" });
  }
}

/**
 * Celular: a linha de categorias rola de lado, e a borda direita some num degradê. O chip que recebe o
 * foco pelo teclado rola para dentro da linha, inteiro e fora do degradê (o scroll-padding da linha, no
 * globals.css, tem a largura dele). Sozinho, o navegador não rola um chip que já aparece em parte. No
 * toque e no clique a linha não se mexe, para o chip não sair de baixo do dedo antes do clique.
 */
function revealFocusedChip(event: ReactFocusEvent<HTMLElement>) {
  const row = event.currentTarget;
  const chip = event.target as HTMLElement;
  if (chip === row || row.scrollWidth <= row.clientWidth || !chip.matches(":focus-visible")) {
    return;
  }
  const style = getComputedStyle(row);
  const start = Number.parseFloat(style.scrollPaddingLeft) || 0;
  const end = Number.parseFloat(style.scrollPaddingRight) || 0;
  const box = row.getBoundingClientRect();
  const item = chip.getBoundingClientRect();
  let shift = 0;
  if (item.right > box.right - end) {
    shift = item.right - (box.right - end);
  }
  if (item.left - shift < box.left + start) {
    shift = item.left - (box.left + start);
  }
  if (Math.round(shift)) {
    row.scrollLeft += Math.round(shift);
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

/**
 * Folga no fim do card da Agenda enquanto o detalhe está ao lado. Mais alto que a janela, o painel subia
 * com a página perto do fim da lista, e a linha escolhida ou o começo do painel saía da tela. Com a folga,
 * qualquer linha (a última também) cabe na tela junto com o começo do painel, e no fim da página o card da
 * lista e o painel terminam juntos. A medida vale a cada render, antes de pintar, e quando a lista ou o
 * painel mudam de tamanho sozinhos (fontes, janela). A folga não muda o tamanho de nenhum dos dois.
 */
function useAsideRoom(
  roomRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
  asideRef: RefObject<HTMLElement | null>,
  active: boolean
) {
  useLayoutEffect(() => {
    const room = roomRef.current;
    const list = listRef.current;
    const aside = asideRef.current;
    if (active && room && list && aside) {
      sizeAsideRoom(room, list, aside);
    }
  });

  useEffect(() => {
    const room = roomRef.current;
    const list = listRef.current;
    const aside = asideRef.current;
    if (!active || !room || !list || !aside) {
      return;
    }
    const update = () => sizeAsideRoom(room, list, aside);
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observer.observe(aside);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [active, roomRef, listRef, asideRef]);
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
      {/* o termo da busca vem no título: uma palavra mais larga que o card quebra em vez de passar dele */}
      <p className="mt-2 text-[15px] font-bold text-ink wrap-anywhere">{title}</p>
      {hint ? <p className="max-w-sm text-sm leading-5 text-muted">{hint}</p> : null}
      {actions ? <div className="mt-3 flex flex-wrap justify-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

/**
 * Título do evento na grade, que quebra só entre as palavras. Cada palavra vai num bloco que termina em
 * reticências quando ela é mais larga que o chip ("Matemá..."), em qualquer linha, em vez de partir ao
 * meio ("Seminári / o") ou perder as últimas letras na borda ("Prova de / Matemát"). As palavras que
 * cabem voltam a ser texto (fitChipWords): com mais de 2 linhas, o line-clamp corta a 2ª linha com
 * reticências, terminando a última palavra ("de Engenh...") em vez de esconder ela inteira.
 */
function chipTitle(title: string) {
  return title
    .trim()
    .split(/\s+/)
    .map((word, index) => (
      <Fragment key={index}>
        {index ? " " : null}
        <span>{word}</span>
      </Fragment>
    ));
}

/**
 * Palavras dos títulos dos chips (chipTitle): cada uma começa como bloco que corta com reticências
 * (globals.css) e ganha "fits", que a deixa como texto, quando cabe na largura do chip. Lê todas antes
 * de mudar alguma, pelas medidas de layout (sem as animações de entrada): no bloco, a largura do texto é
 * o scrollWidth; no texto, o offsetWidth.
 */
function fitChipWords(grid: HTMLElement | null) {
  if (!grid?.isConnected) {
    return;
  }
  const words = Array.from(grid.querySelectorAll<HTMLElement>(".ce .t > span"));
  const fits = words.map((word) => {
    const natural = word.classList.contains("fits") ? word.offsetWidth : word.scrollWidth;
    return natural <= (word.parentElement?.clientWidth ?? 0);
  });
  words.forEach((word, index) => word.classList.toggle("fits", fits[index]));
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

  // títulos dos chips: antes de pintar, a cada mês ou evento novo; de novo quando a grade muda de
  // largura (janela, menu, chips que aparecem a partir de 1024 px) e quando a Open Sans termina de chegar
  useLayoutEffect(() => fitChipWords(gridRef.current), [weeks]);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    const refit = () => fitChipWords(grid);
    const observer = new ResizeObserver(refit);
    observer.observe(grid);
    void document.fonts.ready.then(refit);
    document.fonts.addEventListener("loadingdone", refit);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", refit);
    };
  }, []);

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
  studentName,
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
  /** Responsável: o primeiro nome do aluno acompanhado ("Cronograma de Diogo"). */
  studentName?: string | null;
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

  // evento aberto ao lado, na Agenda, quando a pessoa passa para o Calendário: fica marcado no dia e na
  // lista do dia, mas o diálogo só abre quando ela clica nele (trocar de modo não abre diálogo sozinho).
  // Vale só para esse evento: outro evento, ou o mesmo escolhido de novo depois de fechar, abre como sempre.
  const [quietId, setQuietId] = useState<number | null>(null);
  if (quietId !== null && quietId !== selectedEventId) {
    setQuietId(null);
  }
  const quiet = quietId !== null && quietId === selectedEventId;

  const sectionRef = useRef<HTMLElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const dayTitleRef = useRef<HTMLHeadingElement>(null);
  const dayPanelRef = useRef<HTMLElement>(null);
  const allChipRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const asideRoomRef = useRef<HTMLDivElement>(null);
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
  useAsideRoom(asideRoomRef, listRef, asideRef, asideOpen);
  const hiddenByFilters =
    !monthMode && selectedEvent !== null && !periodNotice && !listEvents.some((event) => event.id === selectedEvent.id);

  const showTeacher = useCallback(
    (event: AcademicEvent) => (role === "teacher" ? !canManageEvent(event) : role === "admin" && event.source === "teacher"),
    [role, canManageEvent]
  );

  // evento escolhido (aqui, no Painel, nos avisos ou na busca): a página rola até a linha ou o dia dele,
  // sem rolar se já está à vista. O mesmo evento num lugar novo (salvo com outra data, ou o outro modo)
  // vai para o centro: a lista acompanha o evento. No Calendário, com a lista do dia aberta, o dia, a
  // lista e a linha do evento ficam à vista juntos; com um clique na própria grade, nada rola (o que foi
  // clicado já está à vista e não sai de baixo do cursor).
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
    const fromHere = !relocated && internalId === selectedEventId;
    afterPaint(() => {
      const root = sectionRef.current;
      if (monthMode) {
        const day = root?.querySelector<HTMLElement>(`[data-day="${targetDay}"]`);
        const list = dayPanelRef.current;
        if (!day || fromHere) {
          return;
        }
        if (list) {
          placeDayWithEvent(day, list, list.querySelector<HTMLElement>(`.ev[data-event-id="${selectedEventId}"]`));
        } else {
          revealElement(day, relocated ? "center" : "nearest");
        }
        return;
      }
      const row = root?.querySelector<HTMLElement>(`.ev[data-event-id="${selectedEventId}"]`);
      if (!row) {
        return;
      }
      if (relocated) {
        resetAside();
      }
      // a linha inteira à vista e, com o painel ao lado, o título do detalhe também (a folga no fim da
      // lista deixa os dois caberem juntos); a lista ainda pode estar na animação de entrada
      revealElement(row, relocated ? "center" : "nearest", asideRef.current);
    });
  }, [selectedEventId, calendarMode, targetVisible, currentStart, monthMode, targetDay, resetAside, internalId]);

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

  /**
   * "Ver em ..." da lista vazia e "Ver só os próximos" do aviso: o botão clicado some com a lista nova, e o
   * foco vai para a aba do período escolhido, que fica (como na Gestão), em vez de cair no início da página.
   */
  function showPeriod(value: TimeFilter, from: HTMLElement) {
    setPeriod(value);
    const tabs = from.closest("section")?.querySelectorAll<HTMLButtonElement>('.seg[aria-label="Período"] button');
    tabs?.[timeFilters.findIndex((item) => item.value === value)]?.focus();
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

  /**
   * Ao ir para o Calendário com um evento aberto, a grade mostra o mês e o dia dele, com a lista do dia
   * aberta e o evento marcado nela. O detalhe não vira diálogo sozinho: ele abre com um clique no evento.
   */
  function changeMode(mode: CalendarMode) {
    if (mode === "month" && !monthMode && selectedEvent) {
      // um dia do evento já escolhido na grade (evento de vários dias) continua; senão, o 1º dia dele
      const kept = selectedDay && occursOnDay(selectedEvent, parseDayKey(selectedDay)) ? parseDayKey(selectedDay) : null;
      const day = kept ?? new Date(selectedEvent.startsAt);
      if (day.getFullYear() !== cursor.year || day.getMonth() !== cursor.month) {
        setCursor({ year: day.getFullYear(), month: day.getMonth() });
      }
      if (!kept) {
        setSelectedDay(dayKey(day));
      }
      setQuietId(selectedEvent.id);
    }
    setCalendarMode(mode);
  }

  function selectFromList(id: number) {
    setQuietId(null);
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
    setQuietId(null);
    setInternalId(id);
    pendingFocus.current = "detail";
    onSelect(id);
  }

  function openFromGrid(id: number, key: string) {
    const button = dayButton(key);
    if (button && key !== selectedDay) {
      dayAnchor.current = { key, top: pageTop(button) - window.scrollY, list: false };
    }
    setQuietId(null);
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
    role === "admin"
      ? "Cronograma institucional"
      : role === "teacher"
        ? "Cronograma das suas turmas"
        : role === "guardian"
          ? studentName
            ? `Cronograma de ${studentName}`
            : "Cronograma do aluno"
          : "Cronograma da sua turma";
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
                    hideClass={role === "student" || role === "guardian"}
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
        <button className="btn btn-p" onClick={(click) => showPeriod(otherPeriod, click.currentTarget)} type="button">
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

        {/* coluna presa à largura do card (minmax(0, 1fr)): um termo longo não alarga a coluna nem passa da tela */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-b border-line-2 pb-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* a busca fica só no menu (no celular, na gaveta); aqui aparece o chip dela, que limpa a busca.
                O termo longo termina em reticência dentro do card, e o termo inteiro fica no title e no nome
                do X. No toque, o X tem alvo de 40 px (o ::after), sem mudar o desenho. */}
            {term ? (
              <span className="chip picked min-w-0 max-w-full pr-1.5" title={`Busca: ${term}`}>
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">
                  Busca: <b>{term}</b>
                </span>
                <button
                  className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-surface-2 pointer-coarse:after:absolute pointer-coarse:after:-inset-2"
                  aria-label={`Limpar busca por "${term}"`}
                  onClick={clearSearch}
                  title={`Limpar busca por "${term}"`}
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

            {/* o select fica da largura da maior turma: um nome sem espaço não passa do card, e a turma
                escolhida termina em reticência */}
            {role === "admin" && classes.length ? (
              <select
                aria-label="Turma"
                className={cx(
                  "input min-h-[44px] w-auto min-w-0 max-w-full truncate font-semibold",
                  classFilter !== "all" && "border-night text-night"
                )}
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

          <div className="chips chips-row items-center" role="group" aria-label="Categorias" onFocus={revealFocusedChip}>
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
            {/* o aviso traz o título do evento: uma palavra mais larga que o card quebra em vez de passar dele */}
            <span className="min-w-0 flex-1 wrap-anywhere">{periodNotice}</span>
            <button className="link" onClick={(click) => showPeriod("upcoming", click.currentTarget)} type="button">
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
            <span className="min-w-0 flex-1 wrap-anywhere">
              &quot;{selectedEvent.title}&quot; não aparece na lista com os filtros atuais.
            </span>
            <button className="link" onClick={clearFilters} type="button">
              Limpar filtros
            </button>
          </div>
        ) : null}

        <div ref={listRef} className="mt-3">
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
                      hideClass={role === "student" || role === "guardian"}
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
        {/* folga no fim da lista com o detalhe ao lado (useAsideRoom): a linha escolhida e o começo do
            detalhe cabem juntos na tela, e no fim da página os dois cards terminam juntos */}
        {asideOpen ? <div ref={asideRoomRef} aria-hidden /> : null}
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

      {/* celular, tablet e Calendário: detalhe no Modal, com o foco no título do evento. O evento que
          veio da Agenda ao trocar de modo só fica marcado: o Modal abre quando a pessoa clica nele. */}
      {compact && selectedEvent && !quiet ? (
        <Modal title="Detalhes do evento" initialFocusRef={detailTitleRef} onClose={() => onSelect(null)}>
          {renderDetail(selectedEvent)}
        </Modal>
      ) : null}
    </div>
  );
}
