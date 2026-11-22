"use client";

import { ArrowLeft, ArrowRight, CalendarX2, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx, monthGroupLabel } from "@/lib/format";
import { popoverHost, useAnchoredPosition, useOutsidePress, useSheetMode } from "./select";

/** Mês vizinho no pé da lista: "Próximo mês", "Dezembro", "5 eventos". */
export type PagerTarget = { title: string; count: string; onGo: () => void };

/* ------------------------------------------------------------------ */
/* Chave do mês                                                        */
/* ------------------------------------------------------------------ */

/** Chave do mês (ano * 12 + mês) de uma data: Date, texto ISO ou milissegundos. */
export function monthKeyOf(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return date.getFullYear() * 12 + date.getMonth();
}

/** "Novembro" no ano corrente e "Março de 2027" fora dele, a partir da chave do mês (decisão 2, como a Gestão). */
export function monthKeyTitle(key: number) {
  return monthGroupLabel(new Date(Math.floor(key / 12), key % 12, 1));
}

/* ------------------------------------------------------------------ */
/* Seletor de mês: "‹ Novembro de 2026 ›" com o popover do ano          */
/* ------------------------------------------------------------------ */

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];
const MONTH_ABBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/** Singular, plural e, se quiser, o texto do zero: ["data", "datas", "nenhuma data"]. Sem o terceiro, "nenhum evento". */
export type MonthNoun = [string, string] | [string, string, string];

/** Contagem por mês (chave ano * 12 + mês): um Map ou uma função. */
export type MonthCounts = ReadonlyMap<number, number> | ((key: number) => number);
/** Meses com marcador (prova ou trabalho): um Set ou uma função. */
export type MonthMarks = ReadonlySet<number> | ((key: number) => boolean);

/** Chave do mês de hoje (ano * 12 + mês). */
export function currentMonthKey(now = new Date()) {
  return now.getFullYear() * 12 + now.getMonth();
}

/** "Novembro" */
export function monthName(key: number) {
  return MONTH_NAMES[((key % 12) + 12) % 12];
}

/** "Novembro de 2026", sempre com o ano (o seletor é um controle de navegação). */
export function monthYearTitle(key: number) {
  return `${monthName(key)} de ${Math.floor(key / 12)}`;
}

/** "nenhum evento", "1 evento", "4 eventos". */
export function monthCountText(count: number, noun: MonthNoun = ["evento", "eventos"]) {
  if (count === 0) {
    return noun[2] ?? `nenhum ${noun[0]}`;
  }
  return `${count} ${count === 1 ? noun[0] : noun[1]}`;
}

/** "2 eventos" com espaço sem quebra: o número e a palavra nunca ficam em linhas diferentes num botão que quebra. */
function keepCountTogether(count: string) {
  return count.replace(/^(\d+) /, "$1 ");
}

function readCount(counts: MonthCounts | undefined, key: number) {
  if (!counts) {
    return 0;
  }
  return typeof counts === "function" ? counts(key) : (counts.get(key) ?? 0);
}

function readMark(marks: MonthMarks | undefined, key: number) {
  if (!marks) {
    return false;
  }
  return typeof marks === "function" ? marks(key) : marks.has(key);
}

/** Conta os itens por mês e marca os meses em que `markOf` é verdadeiro (ex.: tem prova ou trabalho). */
export function countByMonth<T>(
  all: T[],
  dateOf: (item: T) => Date | string | number,
  markOf?: (item: T) => boolean
) {
  const counts = new Map<number, number>();
  const marks = new Set<number>();
  for (const item of all) {
    const key = monthKeyOf(dateOf(item));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (markOf?.(item)) {
      marks.add(key);
    }
  }
  return { counts, marks, keys: [...counts.keys()].sort((a, b) => a - b) };
}

/**
 * Limites da navegação: de janeiro do primeiro ano com itens a dezembro do último, contando sempre o mês de hoje.
 */
export function monthBounds(keys: Iterable<number>, today = currentMonthKey()) {
  let first = today;
  let last = today;
  for (const key of keys) {
    first = Math.min(first, key);
    last = Math.max(last, key);
  }
  return { min: Math.floor(first / 12) * 12, max: Math.floor(last / 12) * 12 + 11 };
}

/** Mês com itens mais perto de `from` no sentido pedido (sem contar o próprio), dentro dos limites. */
export function nearestMonthWith(
  counts: MonthCounts,
  from: number,
  direction: 1 | -1,
  { max = from + 120, min = from - 120 }: { min?: number; max?: number } = {}
) {
  for (let key = from + direction; key >= min && key <= max; key += direction) {
    if (readCount(counts, key) > 0) {
      return key;
    }
  }
  return null;
}

/**
 * Alvo de botão de mês ("Janeiro de 2027", "2 eventos") para o MonthEmpty e o MonthNeighbors.
 * Com `from` (o mês na tela), o ano aparece também quando o alvo é do ano corrente mas a tela está
 * em outro ano: de Janeiro de 2028, "Anterior: Dezembro de 2026", não um "Dezembro" que parece 2027.
 */
export function monthTarget(
  key: number | null,
  counts: MonthCounts,
  onGo: (key: number) => void,
  noun: MonthNoun = ["evento", "eventos"],
  from?: number
): PagerTarget | null {
  if (key === null) {
    return null;
  }
  const otherYear = from !== undefined && Math.floor(from / 12) !== Math.floor(key / 12);
  return {
    title: otherYear ? monthYearTitle(key) : monthKeyTitle(key),
    count: monthCountText(readCount(counts, key), noun),
    onGo: () => onGo(key),
  };
}

export type MonthPickerProps = {
  /** Mês na tela (ano * 12 + mês). */
  value: number;
  onChange: (key: number) => void;
  /** Contagem de cada mês (o filtro em vigor). Mês sem contagem mostra 0, apagado e clicável. */
  counts?: MonthCounts;
  /** Meses com o marcador vermelho (prova ou trabalho). */
  marks?: MonthMarks;
  /** Primeiro e último mês navegáveis (use monthBounds). Sem eles, as setas não param. */
  min?: number;
  max?: number;
  noun?: MonthNoun;
  /** Legenda do marcador no pé do popover. */
  markLabel?: string;
  /** O mesmo, no nome do mês para o leitor de tela ("tem prova ou trabalho"). */
  markSpoken?: string;
  /** "4 eventos" depois das setas (some abaixo de 640 px). Padrão: sim. */
  showCount?: boolean;
  /** Botão "Hoje" à direita, apagado no mês atual. Padrão: sim. */
  showToday?: boolean;
  /** Mais coisas à direita, antes do "Hoje". */
  extra?: ReactNode;
  /** Recebe o botão do título (para devolver o foco a ele, como no pé da lista). */
  titleRef?: RefObject<HTMLElement | null>;
  /** Padding e linha de baixo do cabeçalho de card (16 x 20 px). */
  card?: boolean;
  className?: string;
};

/**
 * Barra "‹ Novembro de 2026 ›" (Agenda, Calendário, Gestão, Importação). As setas andam um mês do calendário,
 * inclusive meses vazios; o título abre o popover com o ano (setas para trocar) e os 12 meses em grade, cada um
 * com a contagem, o marcador de prova ou trabalho, o mês atual em anel e o da tela em azul. "Ir para hoje" no pé.
 * Teclado: setas andam na grade (passam de ano), Home e End vão às pontas do ano, PageUp e PageDown trocam o ano,
 * Enter escolhe, Esc fecha e devolve o foco ao título. Abaixo de 640 px o popover vira folha de baixo.
 *
 *   const { counts, marks, keys } = countByMonth(eventos, (e) => e.startsAt, (e) => e.category === "prova");
 *   const { min, max } = monthBounds(keys);
 *   <MonthPicker card value={mes} onChange={setMes} counts={counts} marks={marks} min={min} max={max} />
 */
export function MonthPicker({
  card,
  className,
  counts,
  extra,
  markLabel = "Tem prova ou trabalho",
  markSpoken = "tem prova ou trabalho",
  marks,
  max,
  min,
  noun = ["evento", "eventos"],
  onChange,
  showCount = true,
  showToday = true,
  titleRef,
  value,
}: MonthPickerProps) {
  const popId = useId();
  const ownTitle = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const focusGrid = useRef(false);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(Math.floor(value / 12));
  const [focusKey, setFocusKey] = useState(value);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const sheet = useSheetMode();
  const today = currentMonthKey();

  const inRange = (key: number) => (min === undefined || key >= min) && (max === undefined || key <= max);
  const prevKey = inRange(value - 1) ? value - 1 : null;
  const nextKey = inRange(value + 1) ? value + 1 : null;
  const minYear = min === undefined ? null : Math.floor(min / 12);
  const maxYear = max === undefined ? null : Math.floor(max / 12);
  const hasMarks = Boolean(marks);

  function setTitle(element: HTMLButtonElement | null) {
    ownTitle.current = element;
    if (titleRef) {
      titleRef.current = element;
    }
  }

  function openPop() {
    setViewYear(Math.floor(value / 12));
    setFocusKey(value);
    setHost(popoverHost(ownTitle.current));
    focusGrid.current = true;
    setOpen(true);
  }

  function closePop(returnFocus = true) {
    if (returnFocus) {
      ownTitle.current?.focus({ preventScroll: true });
    }
    setOpen(false);
  }

  function pick(key: number) {
    if (!inRange(key)) {
      return;
    }
    closePop();
    if (key !== value) {
      onChange(key);
    }
  }

  function moveFocus(key: number) {
    if (!inRange(key)) {
      return;
    }
    focusGrid.current = true;
    setFocusKey(key);
    setViewYear(Math.floor(key / 12));
  }

  function shiftYear(step: 1 | -1) {
    const year = viewYear + step;
    if ((minYear !== null && year < minYear) || (maxYear !== null && year > maxYear)) {
      return;
    }
    setViewYear(year);
    // o mesmo mês no ano novo, dentro dos limites
    let key = year * 12 + (focusKey % 12);
    if (min !== undefined) {
      key = Math.max(key, min);
    }
    if (max !== undefined) {
      key = Math.min(key, max);
    }
    setFocusKey(key);
  }

  // foco no mês ao abrir e quando as setas andam na grade
  useLayoutEffect(() => {
    if (!open || !focusGrid.current) {
      return;
    }
    focusGrid.current = false;
    popRef.current?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  }, [open, focusKey, viewYear, host]);

  useAnchoredPosition(open, ownTitle, popRef, { width: 332, maxHeight: 520, sheet }, host ? 1 : 0);
  useOutsidePress(open && !sheet, [ownTitle, popRef], () => closePop(false));

  function onGridKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -4,
      ArrowDown: 4,
      PageUp: -12,
      PageDown: 12,
      Home: -(focusKey % 12),
      End: 11 - (focusKey % 12),
    };
    const step = moves[event.key];
    if (step === undefined) {
      return;
    }
    event.preventDefault();
    let target = focusKey + step;
    // a seta para cima ou para baixo na ponta do intervalo para no limite
    if (min !== undefined) {
      target = Math.max(target, min);
    }
    if (max !== undefined) {
      target = Math.min(target, max);
    }
    moveFocus(target);
  }

  function onPopKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePop();
      return;
    }
    if (event.key === "Tab") {
      // o Tab dá a volta dentro do popover (ano, mês da grade, "Ir para hoje")
      const items = [...(popRef.current?.querySelectorAll<HTMLElement>("button") ?? [])].filter((item) => item.tabIndex >= 0);
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (!items.length) {
        return;
      }
      event.preventDefault();
      const next = at < 0 ? 0 : (at + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    }
  }

  const count = readCount(counts, value);
  const countLabel = monthCountText(count, noun);
  const atToday = value === today;

  const cells = Array.from({ length: 12 }, (_, month) => {
    const key = viewYear * 12 + month;
    const cellCount = readCount(counts, key);
    const marked = readMark(marks, key);
    const out = !inRange(key);
    const spoken = [
      monthYearTitle(key),
      monthCountText(cellCount, noun),
      marked ? markSpoken : "",
      key === today ? "mês atual" : "",
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <button
        key={key}
        type="button"
        data-key={key}
        tabIndex={key === focusKey ? 0 : -1}
        className={cx(
          "mpick-cell",
          cellCount === 0 && "is-empty",
          key === today && "is-now",
          key === value && "is-sel"
        )}
        aria-current={key === value ? "true" : undefined}
        aria-disabled={out || undefined}
        aria-label={spoken}
        title={spoken}
        onFocus={() => setFocusKey(key)}
        onClick={() => pick(key)}
      >
        {marked ? <i className="mpick-pd" aria-hidden /> : null}
        <b>{MONTH_ABBR[month]}</b>
        <small>{cellCount}</small>
      </button>
    );
  });

  const yearPrevOff = minYear !== null && viewYear <= minYear;
  const yearNextOff = maxYear !== null && viewYear >= maxYear;

  const pop =
    open && host
      ? createPortal(
          <>
            {sheet ? <div className="select-scrim" aria-hidden onPointerDown={() => closePop(false)} /> : null}
            <div
              ref={popRef}
              id={popId}
              role="dialog"
              aria-label="Escolher mês"
              className={cx("mpick-pop", sheet && "is-sheet")}
              onKeyDown={onPopKey}
            >
              <div className="mpick-head">
                <button
                  type="button"
                  className="mpick-yr"
                  aria-label={`Ano anterior: ${viewYear - 1}`}
                  aria-disabled={yearPrevOff || undefined}
                  onClick={() => shiftYear(-1)}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <b aria-live="polite">{viewYear}</b>
                <button
                  type="button"
                  className="mpick-yr"
                  aria-label={`Próximo ano: ${viewYear + 1}`}
                  aria-disabled={yearNextOff || undefined}
                  onClick={() => shiftYear(1)}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="mpick-grid" role="group" aria-label={`Meses de ${viewYear}`} onKeyDown={onGridKey}>
                {cells}
              </div>
              {/* "Ir para hoje" segue o showToday da barra (no Importar, o PDF pode ser de outro ano) */}
              {hasMarks || showToday ? (
                <div className="mpick-foot">
                  {hasMarks ? (
                    <span className="mpick-leg">
                      <i aria-hidden />
                      {markLabel}
                    </span>
                  ) : (
                    <span />
                  )}
                  {showToday ? (
                    <button type="button" className="mpick-link" onClick={() => pick(today)}>
                      Ir para hoje
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>,
          host
        )
      : null;

  return (
    <div className={cx("mpick-bar", card && "is-card", className)}>
      <button
        type="button"
        className="mpick-step"
        aria-label={prevKey === null ? "Mês anterior: não há" : `Mês anterior: ${monthKeyTitle(prevKey)}`}
        aria-disabled={prevKey === null || undefined}
        title={prevKey === null ? undefined : monthKeyTitle(prevKey)}
        onClick={() => prevKey !== null && onChange(prevKey)}
      >
        <ChevronLeft className="h-[18px] w-[18px]" aria-hidden />
      </button>
      <button
        ref={setTitle}
        type="button"
        className={cx("mpick-title", open && "is-open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${monthYearTitle(value)}, ${countLabel}. Escolher mês`}
        onClick={() => (open ? closePop() : openPop())}
      >
        {/* largura estável: os 12 nomes do ano ficam invisíveis na mesma célula da grade, e o título mede o mais
            largo deles. Assim as setas não mudam de lugar de "Maio" para "Fevereiro" */}
        <span className="mpick-label">
          {MONTH_NAMES.map((name, month) => {
            const current = month === ((value % 12) + 12) % 12;
            return (
              <span key={name} className={current ? "mpick-now" : "mpick-sizer"} aria-hidden={current ? undefined : true}>
                <span className="mpick-month">{name}</span> <span className="mpick-year">
                  {/* no celular estreito, só "Novembro 2026": o "de" sai para o nome caber sem reticências */}
                  <span className="mpick-de">de </span>
                  {Math.floor(value / 12)}
                </span>
              </span>
            );
          })}
        </span>
        <ChevronDown className="mpick-chev" aria-hidden />
      </button>
      <button
        type="button"
        className="mpick-step"
        aria-label={nextKey === null ? "Próximo mês: não há" : `Próximo mês: ${monthKeyTitle(nextKey)}`}
        aria-disabled={nextKey === null || undefined}
        title={nextKey === null ? undefined : monthKeyTitle(nextKey)}
        onClick={() => nextKey !== null && onChange(nextKey)}
      >
        <ChevronRight className="h-[18px] w-[18px]" aria-hidden />
      </button>
      {showCount ? (
        <span className="mpick-count" aria-hidden>
          {countLabel}
        </span>
      ) : null}
      {extra || showToday ? (
        <span className="mpick-end">
          {extra}
          {showToday ? (
            <button
              type="button"
              className="btn btn-s btn-sm mpick-today"
              aria-disabled={atToday || undefined}
              title={atToday ? "Já está no mês atual" : `Ir para ${monthKeyTitle(today)}`}
              onClick={() => !atToday && inRange(today) && onChange(today)}
            >
              Hoje
            </button>
          ) : null}
        </span>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {`${monthYearTitle(value)}, ${countLabel}`}
      </span>
      {pop}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mês vazio e pé com os meses vizinhos                                 */
/* ------------------------------------------------------------------ */

export type MonthEmptyProps = {
  /** "Nenhum evento em dezembro" (com uma categoria só: "Nenhuma prova em dezembro"). */
  title: string;
  /** Uma linha de explicação, opcional. */
  text?: ReactNode;
  /** Mês com itens mais perto depois (use nearestMonthWith + monthTarget): botão principal "Próximo: ...". */
  next?: PagerTarget | null;
  /** Mês com itens mais perto antes: botão "Anterior: ...". */
  prev?: PagerTarget | null;
  /** Sem `next`: "Não há eventos depois de dezembro". */
  endText?: string;
  /** Itens deste mês escondidos pelo filtro: "1 evento escondido pelo filtro neste mês. Mostrar todas". */
  hidden?: { text: string; actionLabel: string; onAction: () => void } | null;
  /** "block" (no lugar da lista, centrado) ou "note" (linha fina acima da grade do Calendário). */
  variant?: "block" | "note";
  className?: string;
};

/**
 * Estado vazio do mês: o mês continua navegável e o vazio leva ao mês com itens mais perto.
 *
 *   <MonthEmpty title="Nenhum evento em dezembro"
 *     next={monthTarget(nearestMonthWith(counts, mes, 1, { max }), counts, setMes)}
 *     prev={monthTarget(nearestMonthWith(counts, mes, -1, { min }), counts, setMes)}
 *     endText="Não há eventos depois de dezembro" />
 */
export function MonthEmpty({ className, endText, hidden, next, prev, text, title, variant = "block" }: MonthEmptyProps) {
  if (variant === "note") {
    return (
      <p className={cx("month-note", className)} role="status">
        <CalendarX2 className="month-note-ico" aria-hidden />
        <span>{title}.</span>
        {next ? (
          <button type="button" className="month-note-link" onClick={next.onGo}>
            Próximo: {next.title}, {keepCountTogether(next.count)}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        ) : endText ? (
          <span className="month-note-end">{endText}.</span>
        ) : null}
      </p>
    );
  }
  // o mesmo desenho do estado vazio (EmptyState de ui.tsx): ícone num círculo de 40 px, título 15/600, texto 14
  // e as ações em btn-s btn-sm (componentes.css, .month-empty)
  return (
    <div className={cx("month-empty", className)} role="status">
      <div className="month-empty-ico" aria-hidden>
        <CalendarX2 className="h-5 w-5" />
      </div>
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {!next && endText ? <p>{endText}</p> : null}
      {next || prev ? (
        <div className="month-empty-acts">
          {prev ? (
            <button type="button" className="btn btn-s btn-sm" onClick={prev.onGo}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span>
                Anterior: {prev.title}, {keepCountTogether(prev.count)}
              </span>
            </button>
          ) : null}
          {next ? (
            <button type="button" className="btn btn-s btn-sm" onClick={next.onGo}>
              <span>
                Próximo: {next.title}, {keepCountTogether(next.count)}
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
      {hidden ? (
        <p className="month-empty-hid">
          {hidden.text}{" "}
          <button type="button" className="month-empty-link" onClick={hidden.onAction}>
            {hidden.actionLabel}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pé discreto da lista do mês: "‹ Outubro, nenhum evento" à esquerda e "Dezembro, 1 evento ›" à direita (o do
 * sentido da leitura com contorno). Mostra o vizinho do calendário mesmo vazio.
 */
export function MonthNeighbors({
  label = "Outros meses",
  main = "next",
  next,
  prev,
}: {
  prev: PagerTarget | null;
  next: PagerTarget | null;
  main?: "prev" | "next";
  label?: string;
}) {
  if (!prev && !next) {
    return null;
  }
  return (
    <nav className="month-nb" aria-label={label}>
      {prev ? (
        <button
          type="button"
          className={cx("btn btn-sm month-nb-btn prev", main === "prev" ? "btn-s" : "btn-g")}
          aria-label={`Mês anterior: ${prev.title}, ${prev.count}`}
          onClick={prev.onGo}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span>
            <b>{prev.title}</b>
            <span className="month-nb-c">, {prev.count}</span>
          </span>
        </button>
      ) : (
        <span />
      )}
      {next ? (
        <button
          type="button"
          className={cx("btn btn-sm month-nb-btn next", main === "next" ? "btn-s" : "btn-g")}
          aria-label={`Próximo mês: ${next.title}, ${next.count}`}
          onClick={next.onGo}
        >
          <span>
            <b>{next.title}</b>
            <span className="month-nb-c">, {next.count}</span>
          </span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Lista por mês com o seletor (inclui meses vazios)                    */
/* ------------------------------------------------------------------ */

export type MonthCursor<T> = {
  /** Mês na tela (ano * 12 + mês). Começa no mês de hoje, mesmo vazio. */
  key: number;
  setKey: (key: number) => void;
  /** Itens do mês na tela, na ordem em que chegaram. */
  items: T[];
  counts: Map<number, number>;
  marks: Set<number>;
  /** Meses com itens, em ordem. */
  keys: number[];
  /** Limites para o MonthPicker (monthBounds). */
  min: number;
  max: number;
  total: number;
  /** Mês com itens mais perto antes e depois do mês na tela (para o MonthEmpty). */
  prevWith: number | null;
  nextWith: number | null;
};

/**
 * Estado da lista por mês com o MonthPicker. `start`: "today" (padrão, o mês de hoje mesmo vazio), "last" (o mais
 * recente com itens, para Passados) ou "first". Quando `resetKey` muda (aba), volta ao mês inicial; o filtro não
 * troca o mês sozinho.
 *
 *   const nav = useMonthCursor(eventos, (e) => e.startsAt, { markOf: (e) => e.category === "prova" });
 *   <MonthPicker card value={nav.key} onChange={nav.setKey} counts={nav.counts} marks={nav.marks} min={nav.min} max={nav.max} />
 *   {nav.items.length ? nav.items.map(...) : <MonthEmpty title={`Nenhum evento em ${monthName(nav.key).toLowerCase()}`}
 *     next={monthTarget(nav.nextWith, nav.counts, nav.setKey)} prev={monthTarget(nav.prevWith, nav.counts, nav.setKey)} />}
 */
export function useMonthCursor<T>(
  all: T[],
  dateOf: (item: T) => Date | string | number,
  {
    markOf,
    resetKey = "",
    start = "today",
  }: { markOf?: (item: T) => boolean; resetKey?: string; start?: "today" | "first" | "last" } = {}
): MonthCursor<T> {
  const { counts, keys, marks } = countByMonth(all, dateOf, markOf);
  const today = currentMonthKey();
  const { max, min } = monthBounds(keys, today);
  const [state, setState] = useState<{ reset: string; key: number | null }>({ reset: resetKey, key: null });
  let chosen = state.key;
  if (state.reset !== resetKey) {
    chosen = null;
    setState({ reset: resetKey, key: null });
  }
  const initial = start === "first" ? (keys[0] ?? today) : start === "last" ? (keys[keys.length - 1] ?? today) : today;
  const key = Math.min(max, Math.max(min, chosen ?? initial));
  const items = all.filter((item) => monthKeyOf(dateOf(item)) === key);
  return {
    key,
    setKey: (next) => setState({ reset: resetKey, key: next }),
    items,
    counts,
    marks,
    keys,
    min,
    max,
    total: all.length,
    prevWith: nearestMonthWith(counts, key, -1, { min, max }),
    nextWith: nearestMonthWith(counts, key, 1, { min, max }),
  };
}
