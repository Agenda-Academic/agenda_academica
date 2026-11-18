"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { cx, monthGroupLabel } from "@/lib/format";

/** Mês para onde um botão leva: o nome dele ("Dezembro", "Março de 2027") e a ação. Sem mês, o botão fica indisponível. */
export type MonthStep = { title: string; onGo: () => void } | null;

function StepButton({ direction, step, emptyHint }: { direction: "prev" | "next"; step: MonthStep; emptyHint: string }) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const name = direction === "prev" ? "Mês anterior" : "Próximo mês";
  // indisponível sem "disabled": o foco fica no botão quando ele chega à ponta (não cai no início da página)
  return (
    <button
      className="ib sm crono-step"
      aria-disabled={step ? undefined : true}
      aria-label={step ? `${name}: ${step.title}` : `${name}: ${emptyHint}`}
      onClick={() => step?.onGo()}
      title={step ? step.title : emptyHint}
      type="button"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

/**
 * Cabeçalho do mês, o mesmo na Agenda e no Calendário: "‹ Novembro ›" ("‹ Março de 2027 ›" fora do ano corrente). O título recebe o foco
 * quando a pessoa troca de mês pelo pé da lista, e o leitor de tela anuncia o mês novo.
 */
export function MonthBar({
  barRef,
  emptyNext = "Não há eventos depois",
  emptyPrev = "Não há eventos antes",
  extra,
  next,
  prev,
  shortTitle,
  title,
  titleId,
  titleRef,
}: {
  barRef?: RefObject<HTMLDivElement | null>;
  emptyNext?: string;
  emptyPrev?: string;
  /** À direita (no Calendário, o "Hoje"). */
  extra?: ReactNode;
  next: MonthStep;
  prev: MonthStep;
  /**
   * Nome curto ("Nov", "Mar de 2027"), mostrado no lugar do título abaixo de 480 px quando há o `extra` na mesma
   * linha (o nome inteiro passava por baixo da seta). O leitor de tela continua com o nome inteiro.
   */
  shortTitle?: string;
  title: string;
  titleId?: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div ref={barRef} className="crono-bar">
      <div className="crono-bar-main">
        <StepButton direction="prev" step={prev} emptyHint={emptyPrev} />
        <h3 ref={titleRef} id={titleId} className="crono-title disp" tabIndex={-1} aria-live="polite">
          {shortTitle && extra ? (
            <>
              <span className="crono-title-full">{title}</span>
              <span className="crono-title-short" aria-hidden>
                {shortTitle}
              </span>
            </>
          ) : (
            title
          )}
        </h3>
        <StepButton direction="next" step={next} emptyHint={emptyNext} />
      </div>
      {extra ? <div className="crono-bar-extra">{extra}</div> : null}
    </div>
  );
}

export type MonthChip = {
  /** ano * 12 + mês */
  index: number;
  year: number;
  /** "nov" */
  short: string;
  count: number;
  /** "Novembro, 4 eventos" ou "Março de 2027, 16 eventos" (nome do botão) */
  label: string;
  /** Classes dos pontos de cor das categorias da turma que o mês tem (provas, trabalhos...). */
  dots: string[];
  active: boolean;
  /** Mês de hoje. */
  now: boolean;
};

/**
 * No celular a faixa rola de lado: o chip que recebe o foco pelo teclado entra inteiro, fora do degradê das
 * bordas (o scroll-padding da faixa, no cronograma.css). No toque e no clique a faixa não se mexe antes do
 * clique, para o chip não sair de baixo do dedo.
 */
function revealFocusedMonth(event: ReactFocusEvent<HTMLElement>) {
  const strip = event.currentTarget;
  const chip = event.target as HTMLElement;
  if (chip === strip || strip.scrollWidth <= strip.clientWidth || !chip.matches(":focus-visible")) {
    return;
  }
  const style = getComputedStyle(strip);
  const start = Number.parseFloat(style.scrollPaddingLeft) || 0;
  const end = Number.parseFloat(style.scrollPaddingRight) || 0;
  const box = strip.getBoundingClientRect();
  const item = chip.getBoundingClientRect();
  let shift = 0;
  if (item.right > box.right - end) {
    shift = item.right - (box.right - end);
  }
  if (item.left - shift < box.left + start) {
    shift = item.left - (box.left + start);
  }
  if (Math.round(shift)) {
    strip.scrollLeft += Math.round(shift);
  }
}

/**
 * Faixa dos meses que têm eventos no filtro, com a contagem de cada um ("nov 3", "dez 5"). O ano aparece
 * antes do primeiro mês dele. Para o teclado, a faixa é uma parada de Tab só, e as setas andam entre os meses. Quando a faixa não cabe (celular, ou o card estreito com o detalhe ao lado),
 * ela rola de lado, só ela, e o mês escolhido vai para o meio.
 */
export function MonthStrip({
  chips,
  label = "Meses com eventos",
  onPick,
}: {
  chips: MonthChip[];
  /** Nome do grupo para o leitor de tela ("Meses com resultados", "Meses com datas"). */
  label?: string;
  onPick: (index: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const active = chips.find((chip) => chip.active)?.index ?? null;
  // uma parada de Tab só para a faixa toda (o mês na tela, ou o último que teve o foco); as setas, o Home e o
  // End andam entre os meses, e Enter ou espaço abrem o mês
  const [rover, setRover] = useState<number | null>(null);
  // o mês na tela mudou (setas do cabeçalho, pé da lista): a parada de Tab volta para ele
  const [roverFor, setRoverFor] = useState(active);
  if (roverFor !== active) {
    setRoverFor(active);
    setRover(null);
  }
  const tabStop = chips.some((chip) => chip.index === rover) ? rover : (active ?? chips[0]?.index ?? null);

  function onStripKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = [...(stripRef.current?.querySelectorAll<HTMLButtonElement>(".crono-mchip") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) {
      return;
    }
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = Math.min(buttons.length - 1, index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = Math.max(0, index - 1);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = buttons.length - 1;
    }
    if (next < 0) {
      return;
    }
    event.preventDefault();
    buttons[next].focus();
  }

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !chip) {
      return;
    }
    const room = strip.scrollWidth - strip.clientWidth;
    if (room <= 0) {
      return;
    }
    const left = Math.min(room, Math.max(0, chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2));
    if (Math.abs(left - strip.scrollLeft) < 2) {
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // na primeira vez, já no lugar; depois, desliza até o mês novo
    strip.scrollTo({ left, behavior: placed.current && !still ? "smooth" : "auto" });
    placed.current = true;
  }, [active, chips.length]);

  return (
    <div
      ref={stripRef}
      className="crono-strip"
      role="group"
      aria-label={label}
      onFocus={revealFocusedMonth}
      onKeyDown={onStripKey}
    >
      {chips.map((chip, position) => {
        const button = (
          <button
            className={cx("crono-mchip", chip.active && "on", chip.now && "now", chip.count === 0 && "zero")}
            // só o primeiro mês ativo é o "atual" (a busca marca todos os meses da página como on)
            aria-current={chip.index === active ? "true" : undefined}
            aria-label={chip.label}
            tabIndex={chip.index === tabStop ? 0 : -1}
            onFocus={() => setRover(chip.index)}
            onClick={() => onPick(chip.index)}
            title={chip.label}
            type="button"
          >
            <span className="m">{chip.short}</span>
            <span className="n">{chip.count}</span>
            {chip.dots.length ? (
              <span className="ds" aria-hidden>
                {chip.dots.map((dot) => (
                  <span key={dot} className={cx("dot", dot)} />
                ))}
              </span>
            ) : null}
          </button>
        );
        // o ano fica junto do primeiro mês dele: a linha não quebra entre os dois
        return position === 0 || chips[position - 1].year !== chip.year ? (
          <span key={chip.index} className="crono-ystart">
            <span className="crono-year" aria-hidden>
              {chip.year}
            </span>
            {button}
          </span>
        ) : (
          <Fragment key={chip.index}>{button}</Fragment>
        );
      })}
    </div>
  );
}

/** Mês vizinho no pé da lista: "Próximo mês", "Dezembro", "5 eventos". */
export type PagerTarget = { title: string; count: string; onGo: () => void };

/**
 * Pé da lista do mês: segue para o mês vizinho sem voltar ao topo. O botão do sentido da leitura (o
 * próximo mês; em Passados, o anterior) é o destacado, e no celular vem primeiro.
 */
export function MonthPagerFooter({ main, next, prev }: { main: "prev" | "next"; next: PagerTarget | null; prev: PagerTarget | null }) {
  if (!prev && !next) {
    return null;
  }
  const item = (direction: "prev" | "next", target: PagerTarget) => {
    const kind = direction === "prev" ? "Mês anterior" : "Próximo mês";
    const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
    return (
      <button
        className={cx("crono-pg", direction, main === direction && "main")}
        aria-label={`${kind}: ${target.title}, ${target.count}`}
        onClick={target.onGo}
        type="button"
      >
        <Icon className="crono-pg-ico" aria-hidden />
        <span className="crono-pg-txt">
          <span className="k">{kind}</span>
          <span className="v">
            {target.title} <span className="c">{target.count}</span>
          </span>
        </span>
      </button>
    );
  };
  return (
    <nav className="crono-pager" aria-label="Outros meses">
      {prev ? item("prev", prev) : null}
      {next ? item("next", next) : null}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Lista paginada por mês, pronta para as outras telas                 */
/* ------------------------------------------------------------------ */

const SHORT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Chave do mês (ano * 12 + mês) de uma data: Date, texto ISO ou milissegundos. */
export function monthKeyOf(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return date.getFullYear() * 12 + date.getMonth();
}

/** "Novembro" no ano corrente e "Março de 2027" fora dele, a partir da chave do mês (decisão 2, como a Gestão). */
export function monthKeyTitle(key: number) {
  return monthGroupLabel(new Date(Math.floor(key / 12), key % 12, 1));
}

function nearestKey(keys: number[], target: number, preferEarlier: boolean) {
  let best = keys[0];
  for (const key of keys) {
    const distance = Math.abs(key - target);
    const bestDistance = Math.abs(best - target);
    if (distance < bestDistance || (distance === bestDistance && (preferEarlier ? key < best : key > best))) {
      best = key;
    }
  }
  return best;
}

export type MonthPages<T> = {
  /** Mês na tela (chave ano * 12 + mês); null sem itens. */
  key: number | null;
  /** "Março de 2027" */
  title: string;
  /** Itens do mês na tela, na ordem em que chegaram. */
  items: T[];
  /** Meses que têm itens, em ordem. */
  keys: number[];
  prev: number | null;
  next: number | null;
  total: number;
  count: (key: number) => number;
  setKey: (key: number) => void;
};

/**
 * Divide uma lista por mês, como a Agenda do Cronograma: a tela mostra um mês por vez, com as setas, a faixa
 * dos meses e o pé com o mês vizinho (MonthPagesNav e MonthPagesFooter). Começa no mês com itens mais perto de
 * hoje ("today", o padrão), no primeiro ("first") ou no mais recente ("last"). Quando `resetKey` muda (aba,
 * filtro, busca), volta para o mês inicial.
 *
 * Uso:
 *   const pages = useMonthPages(rows, (row) => row.startsAt, { resetKey: aba, start: aba === "past" ? "last" : "today" });
 *   <MonthPagesNav pages={pages} noun={["evento", "eventos"]} titleRef={tituloRef} />
 *   {pages.items.map(...)}
 *   <MonthPagesFooter pages={pages} noun={["evento", "eventos"]} topRef={tituloRef} />
 */
export function useMonthPages<T>(
  all: T[],
  dateOf: (item: T) => Date | string | number,
  { resetKey = "", start = "today" }: { resetKey?: string; start?: "today" | "first" | "last" } = {}
): MonthPages<T> {
  const groups = new Map<number, T[]>();
  for (const item of all) {
    const key = monthKeyOf(dateOf(item));
    const list = groups.get(key);
    if (list) {
      list.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const [state, setState] = useState<{ reset: string; key: number | null }>({ reset: resetKey, key: null });
  let chosen = state.key;
  if (state.reset !== resetKey) {
    chosen = null;
    setState({ reset: resetKey, key: null });
  }
  let key: number | null = null;
  if (keys.length) {
    if (chosen !== null && groups.has(chosen)) {
      key = chosen;
    } else {
      const target =
        chosen ?? (start === "first" ? keys[0] : start === "last" ? keys[keys.length - 1] : monthKeyOf(new Date()));
      key = nearestKey(keys, target, start === "last");
    }
  }
  const position = key === null ? -1 : keys.indexOf(key);
  return {
    key,
    title: key === null ? "" : monthKeyTitle(key),
    items: key === null ? [] : (groups.get(key) ?? []),
    keys,
    prev: position > 0 ? keys[position - 1] : null,
    next: position >= 0 && position < keys.length - 1 ? keys[position + 1] : null,
    total: all.length,
    count: (month) => groups.get(month)?.length ?? 0,
    setKey: (month) => setState({ reset: resetKey, key: month }),
  };
}

function countLabel(count: number, noun: [string, string]) {
  return `${count} ${count === 1 ? noun[0] : noun[1]}`;
}

/** Cabeçalho da lista por mês: "‹ Março de 2027 ›" e a faixa dos meses com a contagem de cada um. */
export function MonthPagesNav<T>({
  label,
  noun,
  pages,
  titleRef,
}: {
  /** Nome da faixa para o leitor de tela; o padrão é "Meses com" + o plural. */
  label?: string;
  noun: [string, string];
  pages: MonthPages<T>;
  titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
  if (pages.key === null) {
    return null;
  }
  const today = monthKeyOf(new Date());
  const chips: MonthChip[] = pages.keys.map((key) => {
    const year = Math.floor(key / 12);
    const count = pages.count(key);
    return {
      index: key,
      year,
      short: SHORT_MONTHS[key % 12],
      count,
      label: `${monthKeyTitle(key)}, ${countLabel(count, noun)}${key === today ? ", mês atual" : ""}`,
      dots: [],
      active: key === pages.key,
      now: key === today,
    };
  });
  const step = (key: number | null): MonthStep => (key === null ? null : { title: monthKeyTitle(key), onGo: () => pages.setKey(key) });
  return (
    <div className="crono-nav">
      <MonthBar
        title={pages.title}
        titleRef={titleRef}
        prev={step(pages.prev)}
        next={step(pages.next)}
        emptyPrev={`Não há ${noun[1]} antes`}
        emptyNext={`Não há ${noun[1]} depois`}
      />
      {chips.length > 1 ? <MonthStrip chips={chips} label={label ?? `Meses com ${noun[1]}`} onPick={pages.setKey} /> : null}
    </div>
  );
}

/**
 * Pé da lista por mês: segue para o mês vizinho e leva o título (`topRef`) para a vista, com o foco nele.
 * `forward` falso (listas do mais recente para o mais antigo) destaca o mês anterior.
 */
export function MonthPagesFooter<T>({
  forward = true,
  noun,
  pages,
  topRef,
}: {
  forward?: boolean;
  noun: [string, string];
  pages: MonthPages<T>;
  topRef?: RefObject<HTMLElement | null>;
}) {
  // troca feita pelo pé: depois de pintar o mês novo, o título vai para a vista e recebe o foco
  const [moves, setMoves] = useState(0);
  useEffect(() => {
    if (!moves) {
      return;
    }
    const target = topRef?.current;
    if (!target) {
      return;
    }
    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
    }
    target.focus({ preventScroll: true });
    if (target.getBoundingClientRect().top < 0) {
      target.scrollIntoView({ block: "start" });
    }
  }, [moves, topRef]);
  const go = (key: number) => {
    setMoves((count) => count + 1);
    pages.setKey(key);
  };
  const target = (key: number | null): PagerTarget | null =>
    key === null ? null : { title: monthKeyTitle(key), count: countLabel(pages.count(key), noun), onGo: () => go(key) };
  return <MonthPagerFooter main={forward ? "next" : "prev"} prev={target(pages.prev)} next={target(pages.next)} />;
}
