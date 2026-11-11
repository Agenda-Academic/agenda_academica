"use client";

import {
  ArrowRight,
  BellRing,
  BookOpen,
  CheckCheck,
  CheckCircle2,
  ChevronUp,
  Clock,
  Loader2,
  MapPin,
  PieChart,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import {
  countdown,
  cx,
  dateParts,
  formatShortDate,
  formatShortDateTime,
  formatTime,
  groupByWeek,
  isSameDay,
  isWholeDay,
  relativeDue,
  startOfDay,
} from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, AppNotification, Category, Reminder } from "@/lib/types";
import { useOptionalAppActions } from "./app-actions";
import { EventRow, StatusPill, eventLastDay } from "./event-bits";
import { EmptyState } from "./ui";

/** Filtro com que os painéis abrem o Cronograma (ex.: só Provas). */
export type CalendarFilter = { categories?: Category[] };

/* ------------------------------------------------------------------ */
/* Datas oficiais: uma regra só para o Painel, a Gestão e o Cronograma */
/* ------------------------------------------------------------------ */

/** Categorias do calendário oficial do campus (só a administração publica nelas). */
export const officialCategories: Category[] = ["institutional", "holiday", "recess"];

/** Origem oficial: publicado pela administração ou importado do calendário oficial. */
export function isOfficialSource(event: AcademicEvent) {
  return event.officialPriority || event.source !== "teacher";
}

/**
 * Data oficial: evento de origem oficial (administração ou importação) numa das categorias do
 * calendário oficial (institucional, feriado, recesso), com turma ou sem. Um evento oficial de outra
 * categoria (ex.: uma prova unificada) é evento oficial, mas não é data oficial. Como só a
 * administração publica nessas categorias, é o mesmo conjunto que o Cronograma mostra com o filtro
 * delas (officialCategories).
 */
export function isOfficialDate(event: AcademicEvent) {
  return isOfficialSource(event) && officialCategories.includes(event.category);
}

/** Nem cancelado nem concluído. */
function isOpen(event: AcademicEvent) {
  return event.status !== "cancelled" && event.status !== "completed";
}

/** Ainda tem algum dia de hoje em diante (é o "Próximos" do Cronograma). */
function hasDayAhead(event: AcademicEvent, today: number) {
  return eventLastDay(event).getTime() >= today;
}

function byStart(a: AcademicEvent, b: AcademicEvent) {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

/**
 * Eventos à frente: os abertos (sem os cancelados e os concluídos) que ainda têm algum dia de hoje
 * em diante, o que está em andamento e o que já começou hoje inclusive, em ordem de início. É o
 * "Próximos" do Cronograma sem os cancelados e os concluídos.
 */
export function openAhead(events: AcademicEvent[], now: number) {
  const today = startOfDay(new Date(now)).getTime();
  return events.filter((event) => isOpen(event) && hasDayAhead(event, today)).sort(byStart);
}

/**
 * Próximas datas oficiais (o KPI e os cards "Datas oficiais à frente" e "Próximas datas oficiais",
 * no Painel e na Gestão): as datas oficiais à frente (openAhead), a que está em andamento inclusive.
 */
export function upcomingOfficialDates(events: AcademicEvent[], now: number) {
  return openAhead(events.filter(isOfficialDate), now);
}

/** O que o Cronograma lista em "Próximos" (só das categorias dadas, se houver), em qualquer situação. */
function calendarUpcoming(events: AcademicEvent[], now: number, categories?: Category[]) {
  const today = startOfDay(new Date(now)).getTime();
  return events.filter((event) => (!categories || categories.includes(event.category)) && hasDayAhead(event, today));
}

/**
 * Quantos eventos o Cronograma lista em "Próximos" (só das categorias dadas, se houver): os que
 * ainda têm algum dia de hoje em diante, em qualquer situação (cancelados e concluídos entram).
 */
export function calendarUpcomingCount(events: AcademicEvent[], now: number, categories?: Category[]) {
  return calendarUpcoming(events, now, categories).length;
}

function counted(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Por que o Cronograma (em "Próximos", com o filtro que o indicador abre) mostra outro número que o
 * indicador (own), para a dica dele dizer a diferença: as canceladas e as concluídas que o
 * Cronograma também lista ("o cronograma mostra também 1 cancelada") ou, se a diferença é outra
 * (o indicador olha só 30 dias), quantos ele lista ("o cronograma mostra 23 ao todo"). Sem
 * diferença, null. feminine: a palavra do indicador é feminina (datas, provas).
 */
export function calendarNote(
  events: AcademicEvent[],
  now: number,
  own: number,
  options: { categories?: Category[]; feminine?: boolean } = {}
) {
  const listed = calendarUpcoming(events, now, options.categories);
  if (listed.length === own) {
    return null;
  }
  const cancelled = listed.filter((event) => event.status === "cancelled").length;
  const completed = listed.filter((event) => event.status === "completed").length;
  if (cancelled + completed !== listed.length - own) {
    return `o cronograma mostra ${listed.length} ao todo`;
  }
  const female = options.feminine;
  const parts = [
    cancelled
      ? counted(cancelled, female ? "cancelada" : "cancelado", female ? "canceladas" : "cancelados")
      : null,
    completed
      ? counted(completed, female ? "concluída" : "concluído", female ? "concluídas" : "concluídos")
      : null,
  ].filter((part): part is string => Boolean(part));
  return `o cronograma mostra também ${parts.join(" e ")}`;
}

/**
 * Texto do rodapé "Ver todos (N)" (decisão 2): N é quantos o destino lista (destination), que pode
 * ser mais que a lista do card, porque o Cronograma conta também os cancelados, os concluídos e os
 * que já começaram hoje. Sem destination, o destino lista o mesmo conjunto da lista (own).
 */
export function showAllText(label: string, own: number, destination?: number) {
  return `${label} (${destination ?? own})`;
}

/** O que muda a altura de uma lista do Painel (para as colunas de useColumnFill refazerem a conta). */
export function heightKey(events: AcademicEvent[]) {
  return events.map((event) => `${event.id}:${event.title}:${event.startsAt}:${event.endsAt}:${event.status}`).join(",");
}

/** Nenhum dos eventos tem turma: só assim um subtítulo pode dizer que eles valem para todas as turmas. */
export function allWithoutClass(events: AcademicEvent[]) {
  return events.every((event) => event.academicClassId === null);
}

/** Atraso da entrada suave (classe "rise"): blocos aparecem em sequência. */
export function delay(order: number) {
  return { "--i": order } as CSSProperties;
}

/** "Vale 10 pontos" (pontuação informativa). */
export function pointsLabel(points: number) {
  return `Vale ${points.toLocaleString("pt-BR")} ${points === 1 ? "ponto" : "pontos"}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Quando é uma data oficial, no rótulo curto: "seg, 02/11, dia todo", "qui, 05/11, 18:00" ou "seg, 23/11 a sex, 27/11". */
export function officialWhen(event: AcademicEvent) {
  const start = new Date(event.startsAt);
  const last = eventLastDay(event);
  if (isWholeDay(event.startsAt, event.endsAt)) {
    return last.getTime() > startOfDay(start).getTime()
      ? `${formatShortDate(start)} a ${formatShortDate(last)}`
      : `${formatShortDate(start)}, dia todo`;
  }
  return formatShortDateTime(start);
}

// enquanto envia, o botão continua focável, só fica apagado
const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/** Pílula "Salvo agora" (a mesma da Gestão). */
export function SavedPill() {
  return (
    <span className="pill bg-brand text-white">
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Salvo agora
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Evento salvo pelo painel lateral                                    */
/* ------------------------------------------------------------------ */

/** Roda quando nenhum diálogo (painel lateral ou confirmação) estiver aberto, para o foco não voltar para trás. */
function afterDialogs(run: () => void) {
  let frame = 0;
  let timer = 0;
  let tries = 0;
  const check = () => {
    tries += 1;
    if (document.querySelector('[aria-modal="true"]') && tries < 120) {
      frame = window.requestAnimationFrame(check);
      return;
    }
    timer = window.setTimeout(run, 40);
  };
  frame = window.requestAnimationFrame(check);
  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Título da tela (h1, tabIndex -1) ou, sem ele, o conteúdo: para onde o foco vai quando o alvo sumiu. */
function screenHeading() {
  return document.querySelector<HTMLElement>("#conteudo h1") ?? document.getElementById("conteudo");
}

/** Fundo verde que some em 3 s (o mesmo da linha salva na Gestão). */
function flashSaved(element: HTMLElement) {
  const from = getComputedStyle(document.documentElement).getPropertyValue("--brand-100").trim() || "#d3eddb";
  const to = getComputedStyle(element).backgroundColor;
  element.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: 3000, easing: "ease-out" });
}

/** Folga entre o evento mostrado e a borda da tela, a barra do topo ou os avisos. */
const REVEAL_GAP = 16;

/**
 * Faixa da tela em que nada cobre o evento: abaixo da barra do topo do celular (a folga de
 * rolagem do próprio elemento, em globals.css) e longe da pilha de avisos, quando ela fica na
 * frente dele. A caixa da pilha não tem a animação de entrada dos avisos: já é o lugar final.
 */
function freeBand(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const viewH = window.innerHeight;
  let top = Math.max(Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0, REVEAL_GAP);
  let bottom = viewH - REVEAL_GAP;
  const stack = document.querySelector<HTMLElement>(".toast-stack")?.getBoundingClientRect();
  if (stack && stack.height > 0 && stack.left < box.right && stack.right > box.left) {
    if (stack.top + stack.height / 2 > viewH / 2) {
      bottom = Math.min(bottom, stack.top - REVEAL_GAP);
    } else {
      top = Math.max(top, stack.bottom + REVEAL_GAP);
    }
  }
  return { top, bottom };
}

/**
 * Quanto a página rola para o evento ficar inteiro na faixa livre: nada, se ele já está nela; se
 * não, ele vai para o meio dela ou, mais alto que ela, fica com o topo logo abaixo da barra (o
 * começo dele, com o título e a pílula, à vista). A conta já para no começo e no fim da página.
 */
function revealPlan(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const band = freeBand(element);
  if (box.top >= band.top && box.bottom <= band.bottom) {
    return { band, shift: 0 };
  }
  const room = band.bottom - band.top;
  const goal = box.height >= room ? band.top : band.top + (room - box.height) / 2;
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const y = Math.min(Math.max(window.scrollY + box.top - goal, 0), maxY);
  return { band, shift: y - window.scrollY };
}

/**
 * Foco num bloco que não é botão (o destaque), sem rolar: ganha tabIndex -1 só enquanto está com o
 * foco. A folga de rolagem dele (globals.css) é a mesma do topo da faixa livre: com o topo dele ali,
 * os avisos (useToastRoom, em ui.tsx) não têm por que subir a página de novo.
 */
function focusBlock(element: HTMLElement) {
  if (!element.hasAttribute("tabindex") && !element.matches("a[href], button, input, select, textarea")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  }
  element.focus({ preventScroll: true });
}

/**
 * Mostra no Painel o evento salvo pelo painel lateral (savedTick muda a cada salvamento):
 * espera a lista nova e nenhum diálogo aberto, põe a pílula "Salvo agora" no destaque ou na
 * linha com data-event-id e, já com a altura final, rola até ela ficar livre da barra do topo
 * e dos avisos, põe o foco na ação principal dela e pisca o fundo. Quando o destaque é mais alto
 * que a faixa livre (celular deitado), o topo dele fica logo abaixo da barra e o foco vai para
 * ele mesmo. Devolve o id que tem a pílula. Se o evento não aparece no Painel, o foco vai para o
 * título da tela, nunca para o "Editar" de outro evento.
 */
export function useSavedReveal<T extends HTMLElement>(
  lastSavedId: number | null | undefined,
  savedTick: number | undefined,
  /** Lista que muda quando os dados recarregam (ex.: upcomingEvents). */
  list: unknown
) {
  const rootRef = useRef<T>(null);
  const [seenTick, setSeenTick] = useState(savedTick);
  // list: a lista do momento do salvamento; a busca espera a lista nova (evento novo, data mudada)
  const [reveal, setReveal] = useState<{ id: number; list: unknown; ready: boolean } | null>(null);
  // objeto novo a cada salvamento: salvar de novo o mesmo evento também rola e pisca
  const [saved, setSaved] = useState<{ id: number } | null>(null);

  if (savedTick !== seenTick) {
    setSeenTick(savedTick);
    if (lastSavedId != null) {
      setReveal({ id: lastSavedId, list, ready: false });
    }
  }
  if (reveal && !reveal.ready && list !== reveal.list) {
    setReveal({ ...reveal, ready: true });
  }

  // a recarga demorou (rede lenta ou erro): procura com a lista da tela, que já tem a versão salva
  useEffect(() => {
    if (!reveal || reveal.ready) {
      return;
    }
    const timer = window.setTimeout(
      () => setReveal((current) => (current && !current.ready ? { ...current, ready: true } : current)),
      2000
    );
    return () => window.clearTimeout(timer);
  }, [reveal]);

  useEffect(() => {
    if (!reveal?.ready) {
      return;
    }
    const id = reveal.id;
    return afterDialogs(() => {
      setReveal(null);
      if (!rootRef.current?.querySelector(`[data-event-id="${id}"]`)) {
        screenHeading()?.focus({ preventScroll: true });
        return;
      }
      // a pílula entra antes de rolar: com ela a linha cresce, e a rolagem conta com a altura final
      setSaved({ id });
    });
  }, [reveal]);

  // com a pílula na tela, antes da pintura: rola, põe o foco e pisca
  useLayoutEffect(() => {
    if (!saved) {
      return;
    }
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-event-id="${saved.id}"]`);
    if (!target) {
      screenHeading()?.focus({ preventScroll: true });
      return;
    }
    const { band, shift } = revealPlan(target);
    // a linha é o próprio botão; no destaque, a ação principal é o botão marcado. Ela só fica com o
    // foco se, depois da rolagem, estiver inteira na faixa livre; senão (destaque mais alto que a
    // faixa), o foco vai para o próprio destaque, com o topo à vista, e não para um "Editar"
    // embaixo dos avisos ou fora da tela
    const action = target.matches("button") ? target : target.querySelector<HTMLElement>("[data-primary-action]");
    const box = action?.getBoundingClientRect();
    const free = Boolean(box && box.top - shift >= band.top && box.bottom - shift <= band.bottom);
    if (shift) {
      window.scrollTo({ top: window.scrollY + shift, behavior: reducedMotion() ? "auto" : "smooth" });
    }
    if (action && free) {
      action.focus({ preventScroll: true });
    } else {
      focusBlock(target);
    }
    flashSaved(target);
  }, [saved]);

  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = window.setTimeout(() => setSaved(null), 6000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  return { rootRef, savedId: saved?.id ?? null };
}

/* ------------------------------------------------------------------ */
/* Colunas que terminam juntas                                         */
/* ------------------------------------------------------------------ */

/** Lista que pode mostrar mais itens: quantos tem, quantos mostra no mínimo e no máximo. */
export type FillList = { total: number; min: number; max: number };

type FillState = {
  key: string;
  main: number;
  side: number;
  /** Lista que acabou de ganhar um item, e a sobra que havia antes dele. */
  tried: "main" | "side" | null;
  before: number;
  done: boolean;
};

/** Sobra pequena demais para mais um item (px). */
const FILL_SLACK = 40;

/**
 * Duas colunas lado a lado (.duo) que terminam juntas, sem sobra grande e sem rolagem por dentro:
 * o card de baixo de cada coluna (.duo-fill) estica até o fim da coluna mais alta e guarda a sobra
 * no espaçador .fill-gap dele. A lista da coluna (a desse card, como no Painel da docente, ou a de
 * outro card da mesma coluna, como no da administração) mostra mais um item enquanto a coluna for a
 * mais baixa e ainda houver itens. Se o item a mais deixa a outra coluna com mais sobra do que
 * antes, ele sai. Com as colunas uma embaixo da outra, cada lista mostra o mínimo. A conta recomeça
 * quando a largura, as fontes ou os dados (dataKey) mudam; tudo acontece antes da pintura.
 */
export function useColumnFill(main: FillList, side: FillList, dataKey: string) {
  const gridRef = useRef<HTMLDivElement>(null);
  const mainGapRef = useRef<HTMLDivElement>(null);
  const sideGapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fontsTick, setFontsTick] = useState(0);
  const key = `${dataKey}|${width}|${fontsTick}`;
  const fresh = (forKey: string): FillState => ({
    key: forKey,
    main: main.min,
    side: side.min,
    tried: null,
    before: 0,
    done: false,
  });
  const [fill, setFill] = useState<FillState>(() => fresh(key));
  let current = fill;
  if (fill.key !== key) {
    current = fresh(key);
    setFill(current);
  }

  // largura das colunas (sem transform: a entrada suave não muda a conta)
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }
    setWidth(grid.clientWidth);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setWidth(grid.clientWidth));
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  // a fonte que chega depois muda a altura dos textos
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) {
        setFontsTick((tick) => tick + 1);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (fill.done || fill.key !== key) {
      return;
    }
    const columns = Array.from(gridRef.current?.children ?? []) as HTMLElement[];
    const sideBySide = columns.length > 1 && Math.abs(columns[0].offsetTop - columns[1].offsetTop) < 2;
    const freeMain = sideBySide ? (mainGapRef.current?.offsetHeight ?? 0) : 0;
    const freeSide = sideBySide ? (sideGapRef.current?.offsetHeight ?? 0) : 0;
    if (fill.tried === "main" && freeSide > fill.before) {
      setFill({ ...fill, main: fill.main - 1, tried: null, done: true });
    } else if (fill.tried === "side" && freeMain > fill.before) {
      setFill({ ...fill, side: fill.side - 1, tried: null, done: true });
    } else if (freeMain > FILL_SLACK && fill.main < Math.min(main.total, main.max)) {
      setFill({ ...fill, main: fill.main + 1, tried: "main", before: freeMain });
    } else if (freeSide > FILL_SLACK && fill.side < Math.min(side.total, side.max)) {
      setFill({ ...fill, side: fill.side + 1, tried: "side", before: freeSide });
    } else if (columns.length) {
      setFill({ ...fill, tried: null, done: true });
    }
  }, [fill, key, main.total, main.max, side.total, side.max]);

  return { gridRef, mainGapRef, sideGapRef, mainCount: current.main, sideCount: current.side };
}

/* ------------------------------------------------------------------ */
/* Indicadores e listas                                                */
/* ------------------------------------------------------------------ */

/**
 * Card de indicador (KPI) do Figma. Com onClick, o card inteiro vira um botão
 * (.kpi.is-link): o botão fica no rótulo e a área dele cobre o card.
 */
export function InsightTile({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  note,
  tone,
  order = 0,
  children,
  extra,
  actionLabel,
  onClick,
}: {
  order?: number;
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  hint?: ReactNode;
  /**
   * Linha a mais na dica, quando o destino do clique mostra outro número (calendarNote): "o
   * cronograma mostra também 1 cancelada". Entra também no nome do botão.
   */
  note?: string | null;
  /** Cor do ícone: classe de categoria (ex.: "c-prova"). Padrão: verde da marca. */
  tone?: string;
  /** Peças só visuais (gráfico, barra). */
  children?: ReactNode;
  /** Botões próprios do card (ex.: datas das provas), por cima da área clicável. */
  extra?: ReactNode;
  /** O que o clique faz, para o nome do botão (ex.: "Ver no cronograma"). */
  actionLabel?: string;
  onClick?: () => void;
}) {
  const name = `${label}: ${value}${unit ? ` ${unit}` : ""}${actionLabel ? `. ${actionLabel}` : ""}${
    note ? `. ${capitalize(note)}` : ""
  }`;
  return (
    <div className={cx("card kpi rise", onClick && "is-link")} style={delay(order)}>
      <div className="kpi-top">
        <p className="kpi-label">
          {onClick ? (
            // alvo de no mínimo 24 px de altura (o rótulo tem 18 px); centrado ao lado do ícone, o texto não sai do lugar
            <button className="kpi-hit inline-flex min-h-6 items-center" aria-label={name} onClick={onClick} type="button">
              {label}
            </button>
          ) : (
            label
          )}
        </p>
        <span className={cx("kpi-ico", tone)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
      <p className="kpi-val">
        {value}
        {unit ? <small>{unit}</small> : null}
      </p>
      {children}
      {extra ? <div className="kpi-extra">{extra}</div> : null}
      {/* a dica pode trazer nomes de disciplina ou de turma: palavra longa quebra em qualquer ponto */}
      {hint || note ? (
        <p className="kpi-hint wrap-anywhere">
          {hint}
          {note ? <span className="block">{note}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export function CategoryBreakdown({
  counts,
  emptyText = "Nenhum evento no período.",
}: {
  counts: Array<{ category: Category; count: number }>;
  emptyText?: string;
}) {
  const present = counts.filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  const total = present.reduce((sum, item) => sum + item.count, 0);

  if (!total) {
    return <EmptyState compact icon={PieChart} text={emptyText} />;
  }

  return (
    <div>
      <div
        className="stack"
        role="img"
        aria-label={present.map(({ category, count }) => `${categoryMeta[category].label} ${count}`).join(", ")}
      >
        {present.map(({ category, count }) => (
          <span key={category} className={categoryMeta[category].accent} style={{ flex: count }} />
        ))}
      </div>
      <ul className="legend">
        {present.map(({ category, count }) => (
          <li key={category}>
            <span>
              <span className={cx("dot", categoryMeta[category].accent)} aria-hidden />
              {categoryMeta[category].label}
            </span>
            <b>
              {count}
              <small>{Math.round((count / total) * 100)}%</small>
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rodapé "Ver todos (N)" de uma lista do Painel. */
export type ShowAll = {
  label: string;
  onClick: () => void;
  /** Quantos o destino lista: é o N do rodapé (showAllText). Sem ele, o destino lista o mesmo conjunto da lista. */
  count?: number;
  /** O rodapé fica mesmo quando a lista cabe inteira (é o caminho do card para o destino). */
  always?: boolean;
};

export function EventList({
  className,
  emptyCompact,
  emptyHint,
  emptyIcon,
  emptyText,
  events,
  fillRef,
  grouped,
  hideClass,
  limit,
  mineId,
  isMine,
  savedId,
  selectedId,
  showAll,
  onSelect,
}: {
  /** Classes do bloco da lista (ex.: margem em cima). */
  className?: string;
  /** Vazio em uma linha (cards do Painel). */
  emptyCompact?: boolean;
  emptyHint?: string;
  emptyIcon: LucideIcon;
  emptyText: string;
  events: AcademicEvent[];
  /** Card que estica para a coluna terminar junto (useColumnFill): espaçador entre a lista e o rodapé. */
  fillRef?: Ref<HTMLDivElement>;
  /** Separa em "Esta semana", "Próxima semana" e "Mais adiante". */
  grouped?: boolean;
  hideClass?: boolean;
  limit?: number;
  /** Eventos deste docente; nos de colegas, a linha mostra quem publicou. */
  mineId?: number;
  isMine?: (event: AcademicEvent) => boolean;
  /** Evento salvo há pouco pelo painel lateral: a linha ganha a pílula "Salvo agora". */
  savedId?: number | null;
  selectedId?: number | null;
  /** Rodapé "Ver todos (N)", quando a lista não cabe inteira (ou sempre, com always). */
  showAll?: ShowAll;
  onSelect: (id: number) => void;
}) {
  const visible = limit ? events.slice(0, limit) : events;

  if (!visible.length) {
    const empty = <EmptyState compact={emptyCompact} icon={emptyIcon} text={emptyText} hint={emptyHint} />;
    const block = className ? <div className={className}>{empty}</div> : empty;
    // no card que estica, o vazio fica logo abaixo do título (como nos outros cards) e a sobra vai
    // para o espaçador, que useColumnFill continua medindo
    return fillRef ? (
      <>
        {block}
        <div ref={fillRef} className="fill-gap" aria-hidden />
      </>
    ) : (
      block
    );
  }

  // as linhas (EventRow) já dizem qual evento abrem (data-opens-event), para o foco voltar a elas
  const row = (event: AcademicEvent) => (
    <EventRow
      key={event.id}
      event={event}
      hideClass={hideClass}
      mine={isMine ? isMine(event) : mineId !== undefined && event.teacherId === mineId}
      saved={savedId === event.id}
      showTeacher={isMine ? !isMine(event) : mineId !== undefined ? event.teacherId !== mineId : undefined}
      selected={selectedId === event.id}
      onClick={() => onSelect(event.id)}
    />
  );

  const list = grouped ? (
    <div className={className}>
      {groupByWeek(visible).map((group) => (
        <div key={group.label}>
          <p className="ev-group">{group.label}</p>
          <div className="grid gap-0.5">{group.items.map(row)}</div>
        </div>
      ))}
    </div>
  ) : (
    <div className={cx("grid gap-0.5", className)}>{visible.map(row)}</div>
  );

  // fora de uma caixa, o rodapé vira filho direto do card e desce para o pé dele
  return (
    <>
      {list}
      {fillRef ? <div ref={fillRef} className="fill-gap" aria-hidden /> : null}
      {showAll && (visible.length < events.length || showAll.always) ? (
        <div className="card-foot">
          <button className="link" onClick={showAll.onClick} type="button">
            {showAllText(showAll.label, events.length, showAll.count)}
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Destaque                                                            */
/* ------------------------------------------------------------------ */

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Faltam 4 dias, 7 horas e 3 minutos", para leitores de tela. */
function countdownWords(value: string, now: Date) {
  const ms = new Date(value).getTime() - now.getTime();
  if (ms <= 0) {
    return "Começa agora";
  }
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) {
    return "Falta menos de 1 minuto";
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days ? plural(days, "dia", "dias") : null,
    hours ? plural(hours, "hora", "horas") : null,
    rest ? plural(rest, "minuto", "minutos") : null,
  ].filter((part): part is string => Boolean(part));
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}` : parts[0];
  const single = parts.length === 1 && /^1 /.test(text);
  return `${single ? "Falta" : "Faltam"} ${text}`;
}

/** Contagem regressiva que se atualiza sozinha. note troca o texto miúdo de baixo (ex.: "visível para toda a turma"). */
function Countdown({ startsAt, until, note }: { startsAt: string; until: string; note?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="countdown">
      <p className="eyebrow" aria-hidden>
        <span className="live" />
        Faltam
      </p>
      <b aria-hidden>{countdown(startsAt, now)}</b>
      <small aria-hidden>{note ?? until}</small>
      <span className="sr-only">
        {countdownWords(startsAt, now)} {until}.{note ? ` ${capitalize(note)}.` : ""}
      </span>
    </div>
  );
}

/** Quando é o evento do destaque: "Amanhã, 19:00", "Amanhã, 19:00 até 21:30" ou "Hoje, dia todo". */
function heroWhen(event: AcademicEvent) {
  const day = capitalize(relativeDue(event.startsAt));
  if (isWholeDay(event.startsAt, event.endsAt)) {
    return `${day}, dia todo`;
  }
  const start = new Date(event.startsAt);
  const endsAt = event.endsAt;
  const end = endsAt ? new Date(endsAt) : null;
  const tail = endsAt && end && end > start && isSameDay(start, end) ? ` até ${formatTime(endsAt)}` : "";
  return `${day}, ${formatTime(event.startsAt)}${tail}`;
}

export type HeroAction = {
  label: string;
  /** Sem ícone, o botão fica só com o texto (como no Figma). */
  icon?: LucideIcon;
  onClick: () => void;
  /** Enviando: giro no lugar do ícone e o clique não repete. */
  busy?: boolean;
  /** O botão abre o detalhe deste evento: ganha data-opens-event, para o foco voltar a ele. */
  opensEvent?: number;
};

/**
 * Destaque do próximo compromisso (card branco com faixa verde), com bloco de data e contagem
 * regressiva. No computador (globals.css, .hero-slot) ele vira uma grade: a data à esquerda, a
 * contagem no alto à direita e os botões lado a lado, que podem seguir por baixo da contagem.
 */
export function NextEventHero({
  event,
  emptyTitle = "Você está em dia com os prazos",
  emptyText = "Quando novos prazos forem publicados, eles aparecem aqui.",
  kicker = "Próximo compromisso",
  primaryLabel = "Ver detalhes",
  primaryAction,
  saved,
  secondary,
  hideClass,
  hideTeacher,
  showStatus,
  countdownNote,
  onOpen,
  onEmptyAction,
}: {
  event: AcademicEvent | null;
  emptyTitle?: string;
  emptyText?: string;
  kicker?: string;
  primaryLabel?: string;
  /** Troca o botão principal (padrão: abrir o detalhe com primaryLabel). */
  primaryAction?: HeroAction;
  /** Evento salvo há pouco pelo painel lateral: pílula "Salvo agora". */
  saved?: boolean;
  secondary?: HeroAction;
  /** Esconde a turma na linha de dados (aluno, que só tem uma). */
  hideClass?: boolean;
  /** Esconde o nome do docente (no painel do próprio docente). */
  hideTeacher?: boolean;
  /** Mostra a situação (Agendado, Alterado) ao lado da categoria, como no Painel da docente do Figma. */
  showStatus?: boolean;
  /** Texto miúdo da contagem no lugar de "até o início" (ex.: "visível para toda a turma"). */
  countdownNote?: string;
  onOpen: (id: number) => void;
  onEmptyAction?: { label: string; onClick: () => void };
}) {
  if (!event) {
    // vazio esticado pelo card ao lado (Painel do aluno, junto da turma): o texto fica no alto, sem flutuar no
    // meio de um vão
    return (
      <section className="hero h-full items-start content-start" aria-label={kicker}>
        <div className="hero-body">
          <p className="eyebrow text-brand">{kicker}</p>
          <h2 className="hero-title">{emptyTitle}</h2>
          <p className="mt-3 text-sm text-ink-3">{emptyText}</p>
          {onEmptyAction ? (
            <div className="hero-actions">
              <button className="btn btn-p" onClick={onEmptyAction.onClick} type="button">
                {onEmptyAction.label}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const meta = categoryMeta[event.category];
  const parts = dateParts(event.startsAt);
  const course = [event.subject?.name, hideClass ? null : event.academicClass?.name].filter(Boolean).join(", ");
  const SecondaryIcon = secondary?.icon;
  const PrimaryIcon = primaryAction?.icon;

  // a chave troca o card quando o evento muda: o foco não fica num "Editar" que passou a ser de outro evento
  return (
    <section key={event.id} className="hero with-date is-event h-full" aria-label={kicker} data-event-id={event.id}>
      <div className="datebig">
        <span className="dw">{parts.weekday}</span>
        <span className="dn">{parts.day}</span>
        <span className="mo">{parts.month}</span>
      </div>
      <div className="hero-body">
        <div className="hero-kicker">
          <span className="eyebrow">{kicker}</span>
          <span className={cx("pill", meta.tint)}>{meta.short}</span>
          {showStatus ? <StatusPill event={event} showScheduled /> : null}
          {saved ? <SavedPill /> : null}
        </div>
        {/* título, disciplina, turma, local e nome vêm da pessoa: palavra ou link longo quebra em
            qualquer ponto, sem passar da borda do destaque */}
        <h2 className="hero-title wrap-anywhere">{event.title}</h2>
        <div className="hero-meta wrap-anywhere">
          <span>
            <Clock className="h-[15px] w-[15px]" aria-hidden />
            {heroWhen(event)}
          </span>
          {course ? (
            <span>
              <BookOpen className="h-[15px] w-[15px]" aria-hidden />
              {course}
            </span>
          ) : null}
          {event.location ? (
            <span>
              <MapPin className="h-[15px] w-[15px]" aria-hidden />
              {event.location}
            </span>
          ) : null}
          {!hideTeacher && event.teacher?.fullName ? (
            <span>
              <UserRound className="h-[15px] w-[15px]" aria-hidden />
              {event.teacher.fullName}
            </span>
          ) : null}
          {event.points !== null ? (
            <span>
              <Trophy className="h-[15px] w-[15px]" aria-hidden />
              {pointsLabel(event.points)}
            </span>
          ) : null}
        </div>
        <div className="hero-actions">
          {primaryAction ? (
            <button
              className="btn btn-p"
              data-primary-action
              data-opens-event={primaryAction.opensEvent}
              onClick={primaryAction.onClick}
              type="button"
            >
              {PrimaryIcon ? <PrimaryIcon className="h-4 w-4" aria-hidden /> : null}
              {primaryAction.label}
              {PrimaryIcon ? null : <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          ) : (
            <button
              className="btn btn-p"
              data-primary-action
              data-opens-event={event.id}
              onClick={() => onOpen(event.id)}
              type="button"
            >
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
          {secondary ? (
            <button
              className={cx("btn btn-s", busyLook)}
              aria-busy={secondary.busy || undefined}
              aria-disabled={secondary.busy || undefined}
              data-opens-event={secondary.opensEvent}
              onClick={() => {
                if (!secondary.busy) {
                  secondary.onClick();
                }
              }}
              type="button"
            >
              {secondary.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : SecondaryIcon ? (
                <SecondaryIcon className="h-4 w-4" aria-hidden />
              ) : null}
              {secondary.label}
            </button>
          ) : null}
        </div>
      </div>
      <Countdown
        startsAt={event.startsAt}
        until={event.category === "assignment" ? "até a entrega" : "até o início"}
        note={countdownNote}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

/** Quando é o evento do aviso: "Amanhã, 19:00" ou "Hoje, dia todo". */
function avisoWhen(event: AcademicEvent) {
  return `${capitalize(relativeDue(event.startsAt))}, ${isWholeDay(event.startsAt, event.endsAt) ? "dia todo" : formatTime(event.startsAt)}`;
}

/** Quando chegou o aviso do sistema: "hoje, 14:20", "ontem, 09:05" ou "qua, 04/11". */
function noticeWhen(value: string) {
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(new Date(value)).getTime()) / 86400000);
  if (days === 0) {
    return `hoje, ${formatTime(value)}`;
  }
  if (days === 1) {
    return `ontem, ${formatTime(value)}`;
  }
  return formatShortDate(value);
}

/** Avisos mostrados antes do "Ver todos (N)". */
const AVISOS_LIMIT = 3;

/** Um item do card de avisos: lembrete cuja hora chegou ou aviso do sistema, com a hora em que chegou. */
type AvisoItem =
  | { type: "reminder"; key: string; at: number; aviso: Reminder }
  | { type: "notice"; key: string; at: number; notice: AppNotification };

/** Hora para ordenar (data inválida vai para o fim). */
function arrivedAt(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Avisos: lembretes cuja hora chegou, com o evento ainda por vir, e os avisos do sistema ainda não lidos
 * (vínculo de responsável, pedido aprovado, nota publicada; GET /notifications, lidos do useAppActions). É o
 * mesmo bloco no Painel e em Lembretes. Mostra os 3 mais recentes e "Ver todos (N)" (desenho 5.1: lista sem
 * rolagem e sem empurrar o Painel), e "Marcar todos como lidos" com dois ou mais avisos do sistema. Ao dispensar
 * (ou marcar como lido), o foco vai para o botão que fica no lugar ou, sem mais avisos, para fallbackFocus
 * (padrão: o título da tela).
 *
 * O card some sem nenhum dos dois. Os painéis o mostram quando há lembrete avisando; com só avisos do
 * sistema, a página (app/page.tsx) mostra o card acima do painel, no mesmo lugar.
 */
export function AvisosCard({
  avisos,
  events = [],
  fallbackFocus,
  limit = AVISOS_LIMIT,
  note = true,
  order = 0,
  systemNotices = true,
  onDismiss,
  onOpen,
  onReadAll,
}: {
  avisos: Reminder[];
  /** Para achar o evento quando o lembrete chega sem ele. */
  events?: AcademicEvent[];
  /** Para onde vai o foco depois de dispensar o último aviso (o card some). */
  fallbackFocus?: () => HTMLElement | null;
  /** Quantos mostrar antes do "Ver todos (N)" (padrão 3). */
  limit?: number;
  /** Mostra a frase sobre onde o aviso aparece. */
  note?: boolean;
  order?: number;
  /** Mostra também os avisos do sistema não lidos (padrão: sim). */
  systemNotices?: boolean;
  onDismiss?: (reminderId: number) => void;
  onOpen: (eventId: number) => void;
  /**
   * "Marcar todos como lidos" (POST /notifications/read-all). Sem ele, usa o readAllNotices do useAppActions
   * (a página já passa no contexto); o botão só aparece com algum dos dois e dois ou mais avisos do sistema.
   */
  onReadAll?: () => void | Promise<unknown>;
}) {
  const titleId = useId();
  const listId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dismissButtons = useRef(new Map<string, HTMLButtonElement>());
  const [showAll, setShowAll] = useState(false);
  const actions = useOptionalAppActions();
  const notices: AppNotification[] = systemNotices && actions ? actions.notices : [];
  const total = avisos.length + notices.length;
  if (!total) {
    return null;
  }

  // os mais recentes primeiro: o lembrete pela hora do aviso, o aviso do sistema pela hora em que chegou
  const items: AvisoItem[] = [
    ...avisos.map((aviso): AvisoItem => ({ type: "reminder", key: `r${aviso.id}`, at: arrivedAt(aviso.sendAt), aviso })),
    ...notices.map((notice): AvisoItem => ({ type: "notice", key: `n${notice.id}`, at: arrivedAt(notice.createdAt), notice })),
  ].sort((a, b) => b.at - a.at);
  const max = Math.max(1, limit);
  const more = items.length > max;
  const shown = showAll ? items : items.slice(0, max);
  const readAll = onReadAll ?? actions?.readAllNotices;
  const canReadAll = Boolean(readAll) && notices.length > 1;

  // a ordem dos botões "Dispensar" e "Marcar como lido" na tela: o foco vai para o vizinho de quem saiu
  const keys = items.map((item) => item.key);

  function focusAfter(key: string) {
    const at = keys.indexOf(key);
    const rest = keys.filter((item) => item !== key);
    const nextKey = rest[Math.min(at, rest.length - 1)];
    const fallback = () => fallbackFocus?.() ?? screenHeading();
    const ready = nextKey !== undefined ? (dismissButtons.current.get(nextKey) ?? null) : null;
    if (ready || nextKey === undefined) {
      const target = ready ?? fallback();
      target?.focus({ preventScroll: !ready });
      return;
    }
    // o vizinho estava escondido pelo "Ver todos": ele entra na lista no próximo quadro
    window.requestAnimationFrame(() => {
      const next = dismissButtons.current.get(nextKey) ?? null;
      const target = next ?? fallback();
      target?.focus({ preventScroll: !next });
    });
  }

  function dismiss(id: number) {
    onDismiss?.(id);
    // o aviso sai da lista: o foco vai para o "Dispensar" que fica no lugar, nunca para o início da página
    focusAfter(`r${id}`);
  }

  function markRead(notice: AppNotification) {
    void actions?.readNotice(notice.id);
    focusAfter(`n${notice.id}`);
  }

  function markAllRead() {
    if (!readAll) {
      return;
    }
    const count = notices.length;
    void Promise.resolve(readAll());
    // com lembretes ainda avisando, o card fica e o foco vai para o título dele; sem eles, o card some
    const target = avisos.length ? titleRef.current : (fallbackFocus?.() ?? screenHeading());
    target?.focus({ preventScroll: avisos.length > 0 });
    setShowAll(false);
    actions?.toast(`${count} avisos marcados como lidos.`, { key: "avisos-lidos" });
  }

  function keepButton(key: string) {
    return (node: HTMLButtonElement | null) => {
      if (node) {
        dismissButtons.current.set(key, node);
      } else {
        dismissButtons.current.delete(key);
      }
    };
  }

  function renderReminder(aviso: Reminder) {
    const event = aviso.academicEvent ?? events.find((item) => item.id === aviso.academicEventId);
    const details = event ? [avisoWhen(event), event.location].filter(Boolean).join(", ") : null;
    return (
      <li key={`r${aviso.id}`} className="aviso">
        {/* título e local vêm da pessoa: palavra ou link longo quebra em qualquer ponto */}
        <p className="aviso-t wrap-anywhere">
          {event?.title ?? "Evento da sua agenda"}
          {details ? <span className="block text-sm font-normal text-muted">{details}</span> : null}
        </p>
        <div className="aviso-acts">
          <button
            className="btn btn-s btn-sm"
            aria-label={event ? `Ver evento ${event.title}` : undefined}
            data-opens-event={aviso.academicEventId}
            onClick={() => onOpen(aviso.academicEventId)}
            type="button"
          >
            Ver evento
          </button>
          {onDismiss ? (
            <button
              ref={keepButton(`r${aviso.id}`)}
              className="btn btn-g btn-sm"
              aria-label={`Dispensar o aviso de ${event?.title ?? "evento"}`}
              onClick={() => dismiss(aviso.id)}
              type="button"
            >
              Dispensar
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  function renderNotice(notice: AppNotification) {
    return (
      <li key={`n${notice.id}`} className="aviso">
        <p className="aviso-t wrap-anywhere">
          {notice.title}
          {notice.body ? <span className="block text-sm font-normal text-muted">{notice.body}</span> : null}
          <span className="block text-[13px] font-normal text-muted">{capitalize(noticeWhen(notice.createdAt))}</span>
        </p>
        <div className="aviso-acts">
          {notice.link ? (
            <button
              className="btn btn-s btn-sm"
              aria-label={`Abrir o aviso: ${notice.title}`}
              onClick={() => actions?.openNotice(notice)}
              type="button"
            >
              Abrir
            </button>
          ) : null}
          <button
            ref={keepButton(`n${notice.id}`)}
            className="btn btn-g btn-sm"
            aria-label={`Marcar como lido: ${notice.title}`}
            onClick={() => markRead(notice)}
            type="button"
          >
            Marcar como lido
          </button>
        </div>
      </li>
    );
  }

  return (
    <section className="card pad rise flex flex-col" style={delay(order)} aria-labelledby={titleId}>
      <div className="flex items-start gap-3.5">
        <span className="aviso-ico" aria-hidden>
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 ref={titleRef} className="h2" id={titleId} tabIndex={-1}>
            Avisos ({total})
          </h2>
          {note ? <p className="sub">O aviso aparece aqui e também chega no seu e-mail.</p> : null}
        </div>
      </div>
      <ul className="avisos" id={listId}>
        {shown.map((item) => (item.type === "reminder" ? renderReminder(item.aviso) : renderNotice(item.notice)))}
      </ul>
      {more || canReadAll ? (
        <div className="card-foot">
          {more ? (
            <button
              className="link min-h-6"
              aria-controls={listId}
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
              type="button"
            >
              {showAll ? "Mostrar menos" : showAllText("Ver todos", items.length)}
              {showAll ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          ) : null}
          {canReadAll ? (
            <button className="btn btn-g btn-sm ml-auto" onClick={markAllRead} type="button">
              <CheckCheck className="h-4 w-4" aria-hidden />
              Marcar todos como lidos
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Barras por semana (próximas cinco) para o KPI de 30 dias. */
export function WeekSpark({ events }: { events: AcademicEvent[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weeks = [0, 0, 0, 0, 0];
  for (const event of events) {
    const index = Math.floor((new Date(event.startsAt).getTime() - today.getTime()) / (7 * 86400000));
    if (index >= 0 && index < weeks.length) {
      weeks[index] += 1;
    }
  }
  const max = Math.max(...weeks, 1);
  const peak = weeks.indexOf(max);
  return (
    <div className="flex h-10 items-end gap-1" role="img" aria-label={`Eventos por semana: ${weeks.join(", ")}`}>
      {weeks.map((count, index) => (
        <span
          key={index}
          className={cx("w-2.5 rounded-[3px]", index === peak && count ? "bg-brand" : "bg-brand-100")}
          style={{ height: `${Math.max((count / max) * 100, 8)}%` }}
        />
      ))}
    </div>
  );
}

export function dateChip(value: string) {
  const parts = dateParts(value);
  return `${parts.weekday.toLowerCase()} ${parts.day}`;
}
