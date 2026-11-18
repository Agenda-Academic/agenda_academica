"use client";

import {
  ArrowRight,
  BellRing,
  BookOpen,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
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
  useSyncExternalStore,
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
  groupByMonth,
  groupByWeek,
  isSameDay,
  isWholeDay,
  NBSP,
  relativeDue,
  startOfDay,
  yearSuffix,
} from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, AppNotification, Category, Reminder } from "@/lib/types";
import { useOptionalAppActions } from "./app-actions";
import { EventRow, StatusPill, eventLastDay } from "./event-bits";
import { useBackLayer } from "./app-actions";
import { Drawer, EmptyState, SectionTitle } from "./ui";

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
    if (last.getTime() <= startOfDay(start).getTime()) {
      return `${formatShortDate(start)}, dia todo`;
    }
    // o ano (fora do ano corrente) vai só no fim quando os dois dias são do mesmo ano: "seg, 11/01 a sex, 15/01/2027"
    const from = start.getFullYear() === last.getFullYear() ? formatShortDate(start).replace(/\/\d{4}$/, "") : formatShortDate(start);
    return `${from} a ${formatShortDate(last)}`;
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

/**
 * Lista que pode mostrar mais itens: quantos tem, quantos mostra no mínimo e no máximo. floor (padrão: min) é o
 * menor número a que ela pode descer, lado a lado, para a outra coluna não ficar com um buraco no fim.
 */
export type FillList = { total: number; min: number; max: number; floor?: number };

type FillState = {
  key: string;
  main: number;
  side: number;
  /** Lista que acabou de ganhar (main, side) ou perder (cutMain, cutSide) um item, e a sobra que havia antes. */
  tried: "main" | "side" | "cutMain" | "cutSide" | null;
  before: number;
  /** Já tirou item de alguma lista: não volta a pôr (senão a conta não para). */
  cutting: boolean;
  /** A última troca foi desfeita: falta só medir a sobra final. */
  final: boolean;
  done: boolean;
  /**
   * Lado a lado, sobrou mais de LOOSE_GAP no fim de uma coluna mesmo assim (as listas acabaram): a mais baixa
   * fica parada no alto ao rolar.
   */
  loose: boolean;
};

/** Sobra pequena demais para mais um item (px). */
const FILL_SLACK = 40;

/** Maior diferença aceitável no fim das colunas (px, decisão 5); acima dela, as colunas ficam soltas (loose). */
const LOOSE_GAP = 80;

/**
 * Altura do conteúdo de uma coluna (.duo-col): a soma dos cards e dos vãos entre eles, sem transform (a entrada
 * suave não muda a conta) e sem o espaçador .fill-gap de um card que ainda estique em outra tela.
 */
function columnContentHeight(column: HTMLElement) {
  const kids = (Array.from(column.children) as HTMLElement[]).filter((kid) => kid.offsetHeight > 0);
  if (!kids.length) {
    return 0;
  }
  const gap = parseFloat(getComputedStyle(column).rowGap) || 0;
  const spacers = (Array.from(column.querySelectorAll(".fill-gap")) as HTMLElement[]).reduce(
    (sum, spacer) => sum + spacer.offsetHeight,
    0
  );
  return kids.reduce((sum, kid) => sum + kid.offsetHeight, 0) + gap * (kids.length - 1) - spacers;
}

/**
 * Duas colunas lado a lado (.duo) que terminam juntas, sem sobra grande e sem rolagem por dentro.
 * Nenhum card estica (decisão 5: o card termina no próprio conteúdo, sem buraco dentro nem rodapé puxado;
 * painel.css): o equilíbrio vem do número de itens. A lista da coluna (a do card de baixo, como no Painel da
 * docente, ou a de outro card da mesma coluna, como no da administração) mostra mais um item enquanto a coluna for a
 * mais baixa e ainda houver itens. Se o item a mais deixa a outra coluna com mais sobra do que
 * antes, ele sai. Quando a lista da coluna mais baixa já mostra tudo e ainda sobra espaço, a lista da outra
 * coluna perde itens (até o floor dela) enquanto isso diminuir a sobra: as colunas terminam juntas sem um
 * card esticado com um buraco. Com as colunas uma embaixo da outra, cada lista mostra o mínimo. A conta recomeça
 * quando a largura, as fontes ou os dados (dataKey) mudam; tudo acontece antes da pintura. looseGap é a maior
 * diferença aceitável no fim das colunas (padrão LOOSE_GAP); acima dela, a mais baixa fica parada no alto ao rolar
 * (duo-loose, a exceção do card lateral sticky ao lado de uma lista longa). mainGapRef e sideGapRef continuam
 * no retorno para os cards que ainda põem o espaçador (.fill-gap, escondido no Painel).
 */
export function useColumnFill(main: FillList, side: FillList, dataKey: string, looseGap = LOOSE_GAP) {
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
    cutting: false,
    final: false,
    done: false,
    loose: false,
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
    // a sobra de cada coluna é a diferença entre as alturas do conteúdo delas (os cards não esticam: painel.css)
    const heightMain = sideBySide ? columnContentHeight(columns[0]) : 0;
    const heightSide = sideBySide ? columnContentHeight(columns[1]) : 0;
    const freeMain = Math.max(0, heightSide - heightMain);
    const freeSide = Math.max(0, heightMain - heightSide);
    const loose = sideBySide && Math.max(freeMain, freeSide) > looseGap;
    if (fill.final) {
      setFill({ ...fill, final: false, done: true, loose });
      return;
    }
    // quantos cada lista mostra de fato (o limite pode passar do total)
    const shownMain = Math.min(fill.main, main.total);
    const shownSide = Math.min(fill.side, side.total);
    const mainFloor = Math.min(main.floor ?? main.min, main.total);
    const sideFloor = Math.min(side.floor ?? side.min, side.total);
    if (fill.tried === "main" && freeSide > fill.before) {
      setFill({ ...fill, main: fill.main - 1, tried: null, final: true });
    } else if (fill.tried === "side" && freeMain > fill.before) {
      setFill({ ...fill, side: fill.side - 1, tried: null, final: true });
    } else if (fill.tried === "cutSide" && freeSide > fill.before) {
      // sem o item, a coluna de apoio ficou mais baixa que a outra por mais do que o buraco de antes: ele volta
      setFill({ ...fill, side: fill.side + 1, tried: null, final: true });
    } else if (fill.tried === "cutMain" && freeMain > fill.before) {
      setFill({ ...fill, main: fill.main + 1, tried: null, final: true });
    } else if (!fill.cutting && freeMain > FILL_SLACK && fill.main < Math.min(main.total, main.max)) {
      setFill({ ...fill, main: fill.main + 1, tried: "main", before: freeMain });
    } else if (!fill.cutting && freeSide > FILL_SLACK && fill.side < Math.min(side.total, side.max)) {
      setFill({ ...fill, side: fill.side + 1, tried: "side", before: freeSide });
    } else if (freeMain > FILL_SLACK && shownSide > sideFloor) {
      setFill({ ...fill, side: shownSide - 1, tried: "cutSide", before: freeMain, cutting: true });
    } else if (freeSide > FILL_SLACK && shownMain > mainFloor) {
      setFill({ ...fill, main: shownMain - 1, tried: "cutMain", before: freeSide, cutting: true });
    } else if (columns.length) {
      setFill({ ...fill, tried: null, done: true, loose });
    }
  }, [fill, key, looseGap, main.total, main.max, main.floor, main.min, side.total, side.max, side.floor, side.min]);

  return {
    gridRef,
    mainGapRef,
    sideGapRef,
    mainCount: current.main,
    sideCount: current.side,
    /** Classe da grade (.duo): "duo-loose" quando as colunas ficam soltas (ver FillState.loose). */
    gridClass: current.loose ? "duo-loose" : undefined,
  };
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
  valueClassName,
  onClick,
}: {
  order?: number;
  icon: LucideIcon;
  label: string;
  value: string;
  /** Classe a mais no número (ex.: "is-date" quando o valor é uma data, como "01 jan"). */
  valueClassName?: string;
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
      <p className={cx("kpi-val", valueClassName)}>
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
  emptyText = "Nenhum evento no período",
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
  /**
   * Separa em grupos com cabeçalho: "week" (ou true) dá "Esta semana", "Próxima semana" e um grupo por mês
   * depois delas; "month" dá um grupo por mês ("Janeiro de 2027"). Sem grupos, a linha mostra o mês no bloco
   * de data quando a lista atravessa meses.
   */
  grouped?: boolean | "week" | "month";
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
    // para o espaçador, que useColumnFill continua medindo; o rodapé que é o caminho do card (always) fica
    return (
      <>
        {block}
        {fillRef ? <div ref={fillRef} className="fill-gap" aria-hidden /> : null}
        {showAll?.always && (showAll.count ?? 0) > 0 ? (
          <div className="card-foot">
            <button className="link" onClick={showAll.onClick} type="button">
              {showAllText(showAll.label, 0, showAll.count)}
              <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
            </button>
          </div>
        ) : null}
      </>
    );
  }

  // numa lista (ou num grupo) que atravessa meses sem cabeçalho de mês, cada data mostra o mês
  const spansMonths = (items: AcademicEvent[]) =>
    new Set(items.map((event) => {
      const date = new Date(event.startsAt);
      return date.getFullYear() * 12 + date.getMonth();
    })).size > 1;

  // as linhas (EventRow) já dizem qual evento abrem (data-opens-event), para o foco voltar a elas
  const row = (event: AcademicEvent, showMonth = false) => (
    <EventRow
      key={event.id}
      event={event}
      hideClass={hideClass}
      showMonth={showMonth}
      mine={isMine ? isMine(event) : mineId !== undefined && event.teacherId === mineId}
      saved={savedId === event.id}
      showTeacher={isMine ? !isMine(event) : mineId !== undefined ? event.teacherId !== mineId : undefined}
      selected={selectedId === event.id}
      onClick={() => onSelect(event.id)}
    />
  );

  const groups = grouped ? (grouped === "month" ? groupByMonth(visible) : groupByWeek(visible)) : null;
  const list = groups ? (
    <div className={cx("pnl-list", className)}>
      {groups.map((group) => {
        const withMonth = spansMonths(group.items);
        return (
          <div key={group.label}>
            <p className="ev-group">{group.label}</p>
            <div className="grid gap-0.5">{group.items.map((event) => row(event, withMonth))}</div>
          </div>
        );
      })}
    </div>
  ) : (
    <div className={cx("pnl-list grid gap-0.5", className)}>
      {visible.map((event) => row(event, spansMonths(visible)))}
    </div>
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

/**
 * Card "Datas da instituição" (feriados, recessos e datas institucionais), o mesmo no Painel de todos os
 * perfis: as próximas datas oficiais com o cabeçalho do mês (e o ano, fora do ano corrente) e o rodapé que
 * abre o Cronograma filtrado nelas. É o único lugar do Painel em que elas aparecem: não entram nos
 * compromissos da turma nem no destaque.
 */
export function InstitutionDatesCard({
  className,
  emptyText = "Nenhuma data da instituição à frente",
  events,
  fillRef,
  limit,
  listed,
  order = 0,
  savedId,
  subtitle = "Feriados, recessos e eventos oficiais",
  onOpenAll,
  onSelect,
}: {
  /** Classes a mais no card (ex.: "duo-fill", para esticar junto da coluna). */
  className?: string;
  /** O vazio; quando a próxima data já está no destaque, "Nenhuma outra data..." (decisão 13). */
  emptyText?: string;
  /** As datas oficiais à frente (upcomingOfficialDates), sem a que já aparece no destaque da tela. */
  events: AcademicEvent[];
  /** Espaçador do card que estica (useColumnFill). */
  fillRef?: Ref<HTMLDivElement>;
  /** Quantas mostrar. */
  limit: number;
  /** Quantas o Cronograma lista com o filtro das datas oficiais (o N do rodapé). */
  listed?: number;
  order?: number;
  savedId?: number | null;
  subtitle?: string;
  /** Abre o Cronograma filtrado nas datas oficiais. */
  onOpenAll?: () => void;
  onSelect: (id: number) => void;
}) {
  const titleId = useId();
  return (
    <section className={cx("card pad rise flex flex-col", className)} style={delay(order)} aria-labelledby={titleId}>
      <SectionTitle id={titleId} title="Datas da instituição" subtitle={subtitle} />
      <EventList
        className="mt-2"
        events={events}
        grouped="month"
        hideClass
        limit={limit}
        fillRef={fillRef}
        savedId={savedId}
        emptyCompact
        emptyIcon={CalendarDays}
        emptyText={emptyText}
        emptyHint="Feriados e semanas acadêmicas aparecem aqui quando a secretaria publica."
        showAll={
          onOpenAll
            ? { label: "Ver todas no cronograma", count: listed, always: (listed ?? events.length) > Math.min(limit, events.length), onClick: onOpenAll }
            : undefined
        }
        onSelect={onSelect}
      />
    </section>
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

/** Dias de calendário entre hoje e a data (a mesma conta do "em 6 dias" das listas, relativeDue). */
function calendarDays(value: string, now: Date) {
  return Math.round((startOfDay(new Date(value)).getTime() - startOfDay(now).getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * O número grande da contagem do destaque. Com 2 dias ou mais pela frente, os dias de calendário ("6 dias"), a
 * mesma conta do "em 6 dias" da lista logo abaixo (antes, "5d 18h" ao lado de "em 6 dias" parecia erro); mais
 * perto, o relógio ("18h 21m"), que corre sozinho (live).
 */
export function heroCountdown(value: string, now: Date) {
  const days = calendarDays(value, now);
  if (days >= 2) {
    return { text: `${days}${NBSP}dias`, words: `Faltam ${days} dias`, live: false };
  }
  return { text: countdown(value, now), words: countdownWords(value, now), live: true };
}

/** Contagem regressiva que se atualiza sozinha. note troca o texto miúdo de baixo (ex.: "visível para toda a turma"). */
function Countdown({ startsAt, until, note }: { startsAt: string; until: string; note?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const count = heroCountdown(startsAt, now);
  return (
    <div className="countdown">
      <p className="eyebrow hero-label" aria-hidden>
        {count.live ? <span className="live" /> : null}
        Faltam
      </p>
      <b aria-hidden>{count.text}</b>
      <small aria-hidden>{note ?? until}</small>
      <span className="sr-only">
        {count.words} {until}.{note ? ` ${capitalize(note)}.` : ""}
      </span>
    </div>
  );
}

/** Quando é o evento do destaque: "Amanhã, 19:00", "Amanhã, 19:00 até 21:30" ou "Hoje, dia todo". */
export function heroWhen(event: AcademicEvent) {
  // a contagem ao lado já diz os dias ("6 dias"): de 2 dias em diante, a linha diz o dia ("seg, 23/11"), como no
  // destaque do responsável; hoje e amanhã continuam relativos
  const day =
    calendarDays(event.startsAt, new Date()) >= 2
      ? capitalize(formatShortDate(event.startsAt))
      : capitalize(relativeDue(event.startsAt));
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
  emptyNote,
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
  /** Linha a mais no vazio (ex.: a próxima data da instituição, que não é compromisso da turma). */
  emptyNote?: ReactNode;
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
          <p className="hero-label">{kicker}</p>
          <h2 className="hero-title">{emptyTitle}</h2>
          <p className="mt-3 text-sm text-ink-3">{emptyText}</p>
          {emptyNote ? <div className="hero-empty-note">{emptyNote}</div> : null}
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
          <span className="hero-label">{kicker}</span>
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

/**
 * Painéis montados que já mostram o card de avisos (prop host). Enquanto houver um, a outra cópia do card (a que
 * a página, app/page.tsx, põe acima do Painel quando só há avisos do sistema) não aparece: fica uma instância só,
 * e o painel lateral aberto e o foco não se perdem quando o último lembrete sai e ficam só os avisos do sistema.
 */
let avisoHosts = 0;
const avisoHostListeners = new Set<() => void>();

function subscribeAvisoHosts(listener: () => void) {
  avisoHostListeners.add(listener);
  return () => {
    avisoHostListeners.delete(listener);
  };
}

function changeAvisoHosts(delta: number) {
  avisoHosts += delta;
  avisoHostListeners.forEach((listener) => listener());
}

/** Registra o card do painel (host) e diz se algum painel já mostra o card. */
function useAvisoHost(host: boolean) {
  useLayoutEffect(() => {
    if (!host) {
      return;
    }
    changeAvisoHosts(1);
    return () => changeAvisoHosts(-1);
  }, [host]);
  return useSyncExternalStore(
    subscribeAvisoHosts,
    () => avisoHosts > 0,
    () => false
  );
}

/**
 * Evento aberto pelo "Ver evento" do painel lateral de avisos. No computador o detalhe abre no Cronograma e o
 * Painel desmonta: o card novo, na volta, lê daqui qual evento o "Ver todos os avisos" abre (data-opens-event).
 */
let drawerOpened: { eventId: number; at: number } | null = null;
const DRAWER_RETURN_MS = 30 * 60 * 1000;

function drawerReturnEvent() {
  return drawerOpened && Date.now() - drawerOpened.at < DRAWER_RETURN_MS ? drawerOpened.eventId : null;
}

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
 * O card some sem nenhum dos dois. Os painéis o montam sempre com host (ele aparece com lembrete avisando ou com
 * aviso do sistema); a cópia que a página (app/page.tsx) põe acima do Painel com só avisos do sistema fica
 * escondida enquanto um painel host está montado, para o card ser um só (o painel lateral aberto não fecha
 * quando o último lembrete sai).
 */
export function AvisosCard({
  avisos,
  events = [],
  fallbackFocus,
  host = false,
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
  /** Card do Painel: com ele montado, a cópia da página (sem host) não aparece. */
  host?: boolean;
  /** Quantos o card mostra antes do "Ver todos os avisos (N)" (padrão 3). */
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
  const titleRef = useRef<HTMLHeadingElement>(null);
  // botões "Dispensar" e "Marcar como lido" do card e do painel lateral (cada lugar com os seus)
  const cardButtons = useRef(new Map<string, HTMLButtonElement>());
  const drawerButtons = useRef(new Map<string, HTMLButtonElement>());
  // "Ver evento" do card (por evento) e "Ver todos os avisos": para onde o foco vai antes de abrir um evento pelo
  // painel lateral, para o detalhe saber de onde veio e devolver o foco ao card
  const cardOpeners = useRef(new Map<number, HTMLButtonElement>());
  const allButtonRef = useRef<HTMLButtonElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // evento aberto pelo "Ver evento" do painel lateral: o "Ver todos os avisos" passa a abrir esse evento
  // (data-opens-event), para o foco voltar ao card quando o detalhe fecha (o botão do painel lateral já saiu)
  const [returnEvent, setReturnEvent] = useState<number | null>(drawerReturnEvent);
  const actions = useOptionalAppActions();
  const hosted = useAvisoHost(host);
  const closeDrawer = () => setDrawerOpen(false);
  useBackLayer(drawerOpen, closeDrawer);
  const notices: AppNotification[] = systemNotices && actions ? actions.notices : [];
  const total = avisos.length + notices.length;
  if (!total || (!host && hosted)) {
    return null;
  }

  // os mais recentes primeiro: o lembrete pela hora do aviso, o aviso do sistema pela hora em que chegou
  const items: AvisoItem[] = [
    ...avisos.map((aviso): AvisoItem => ({ type: "reminder", key: `r${aviso.id}`, at: arrivedAt(aviso.sendAt), aviso })),
    ...notices.map((notice): AvisoItem => ({ type: "notice", key: `n${notice.id}`, at: arrivedAt(notice.createdAt), notice })),
  ].sort((a, b) => b.at - a.at);
  const max = Math.max(1, limit);
  const more = items.length > max;
  const shown = items.slice(0, max);
  const readAll = onReadAll ?? actions?.readAllNotices;
  const canReadAll = Boolean(readAll) && notices.length > 1;
  // no painel lateral, os lembretes que avisam e os avisos do sistema em seções separadas
  const reminderItems = items.filter((item) => item.type === "reminder");
  const noticeItems = items.filter((item) => item.type === "notice");
  // ordem dos botões na tela de cada lugar: o foco vai para o vizinho de quem saiu
  const cardKeys = shown.map((item) => item.key);
  const drawerKeys = [...reminderItems, ...noticeItems].map((item) => item.key);

  const fallback = () => fallbackFocus?.() ?? screenHeading();

  function focusAfter(key: string) {
    const inDrawer = drawerOpen;
    const keys = inDrawer ? drawerKeys : cardKeys;
    const buttons = inDrawer ? drawerButtons : cardButtons;
    const at = keys.indexOf(key);
    const rest = keys.filter((item) => item !== key);
    // no card, o item que sobe da lista (o 4º) entra no lugar: ele também vale como vizinho
    const pool = inDrawer ? rest : items.map((item) => item.key).filter((item) => item !== key).slice(0, max);
    const nextKey = (inDrawer ? rest : pool)[Math.min(Math.max(at, 0), (inDrawer ? rest : pool).length - 1)];
    if (nextKey === undefined) {
      // era o último aviso: o card some (e o painel lateral fecha); o foco vai para o lugar de reserva
      if (inDrawer) {
        setDrawerOpen(false);
        afterDialogs(() => fallback()?.focus({ preventScroll: true }));
      } else {
        fallback()?.focus({ preventScroll: true });
      }
      return;
    }
    const ready = buttons.current.get(nextKey) ?? null;
    if (ready) {
      ready.focus({ preventScroll: !inDrawer });
      return;
    }
    // o vizinho ainda não está na tela (subiu para o card agora): ele entra no próximo quadro
    window.requestAnimationFrame(() => {
      const next = buttons.current.get(nextKey) ?? null;
      (next ?? fallback())?.focus({ preventScroll: true });
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
    actions?.toast(`${count} avisos marcados como lidos.`, { key: "avisos-lidos" });
    if (drawerOpen) {
      // ficam só os lembretes: o foco vai para o primeiro "Dispensar"; sem eles, o painel fecha
      const first = reminderItems[0]?.key;
      if (first) {
        window.requestAnimationFrame(() => drawerButtons.current.get(first)?.focus());
      } else {
        setDrawerOpen(false);
        afterDialogs(() => fallback()?.focus({ preventScroll: true }));
      }
      return;
    }
    // com lembretes ainda avisando, o card fica e o foco vai para o título dele; sem eles, o card some
    const target = avisos.length ? titleRef.current : fallback();
    target?.focus({ preventScroll: avisos.length > 0 });
  }

  function keepButton(where: "card" | "drawer", key: string) {
    const map = where === "card" ? cardButtons : drawerButtons;
    return (node: HTMLButtonElement | null) => {
      if (node) {
        map.current.set(key, node);
      } else {
        map.current.delete(key);
      }
    };
  }

  function renderReminder(aviso: Reminder, where: "card" | "drawer") {
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
            ref={
              where === "card"
                ? (node) => {
                    if (node) {
                      cardOpeners.current.set(aviso.academicEventId, node);
                    } else if (cardOpeners.current.get(aviso.academicEventId)?.isConnected === false) {
                      cardOpeners.current.delete(aviso.academicEventId);
                    }
                  }
                : undefined
            }
            className="btn btn-p btn-sm"
            aria-label={event ? `Ver evento ${event.title}` : undefined}
            data-opens-event={aviso.academicEventId}
            onClick={() => {
              const eventId = aviso.academicEventId;
              setDrawerOpen(false);
              if (where === "card") {
                onOpen(eventId);
                return;
              }
              // pelo painel lateral: ele fecha primeiro (e sai do histórico); o foco vai para o "Ver evento" do
              // mesmo evento no card ou, sem ele, para o "Ver todos os avisos", que passa a abrir esse evento; só
              // então o detalhe abre, e ao fechar ele devolve o foco para lá (o botão do painel lateral já saiu)
              drawerOpened = { eventId, at: Date.now() };
              setReturnEvent(eventId);
              afterDialogs(() => {
                const target = cardOpeners.current.get(eventId) ?? allButtonRef.current;
                target?.focus({ preventScroll: true });
                onOpen(eventId);
              });
            }}
            type="button"
          >
            Ver evento
          </button>
          {onDismiss ? (
            <button
              ref={keepButton(where, `r${aviso.id}`)}
              className="btn btn-s btn-sm"
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

  function renderNotice(notice: AppNotification, where: "card" | "drawer") {
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
              className="btn btn-p btn-sm"
              aria-label={`Abrir o aviso: ${notice.title}`}
              onClick={() => {
                setDrawerOpen(false);
                actions?.openNotice(notice);
              }}
              type="button"
            >
              Abrir
            </button>
          ) : null}
          <button
            ref={keepButton(where, `n${notice.id}`)}
            className="btn btn-s btn-sm"
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

  const render = (item: AvisoItem, where: "card" | "drawer") =>
    item.type === "reminder" ? renderReminder(item.aviso, where) : renderNotice(item.notice, where);

  return (
    <section className="card pad rise flex flex-col" style={delay(order)} aria-labelledby={titleId}>
      <div className="flex items-start gap-3.5">
        <span className="aviso-ico" aria-hidden>
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          {/* data-avisos-title: a página devolve o foco aqui quando o perfil aberto pelo "Abrir" de um aviso fecha */}
          <h2 ref={titleRef} className="h2" id={titleId} tabIndex={-1} data-avisos-title>
            Avisos <span className="h2-n">{total}</span>
          </h2>
          {note ? <p className="sub">O aviso aparece aqui e também chega no seu e-mail.</p> : null}
        </div>
      </div>
      <ul className="avisos">{shown.map((item) => render(item, "card"))}</ul>
      {more || canReadAll ? (
        <div className="card-foot avisos-foot">
          {more ? (
            // a lista inteira abre no painel lateral, por cima da tela: o Painel não desce
            <button
              ref={allButtonRef}
              className="link avisos-all"
              aria-haspopup="dialog"
              data-opens-event={returnEvent ?? undefined}
              onClick={() => {
                drawerOpened = null;
                setReturnEvent(null);
                setDrawerOpen(true);
              }}
              type="button"
            >
              {showAllText("Ver todos os avisos", items.length)}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          {canReadAll ? (
            <button className="btn btn-s btn-sm avisos-readall" onClick={markAllRead} type="button">
              <CheckCheck className="h-4 w-4" aria-hidden />
              Marcar todos como lidos
            </button>
          ) : null}
        </div>
      ) : null}

      <Drawer
        open={drawerOpen}
        title={`Avisos ${total}`}
        subtitle="O aviso aparece aqui e também chega no seu e-mail."
        onClose={closeDrawer}
        footer={
          <>
            <button className="btn btn-s" onClick={closeDrawer} type="button">
              Fechar
            </button>
            {canReadAll ? (
              <button className="btn btn-p" onClick={markAllRead} type="button">
                <CheckCheck className="h-4 w-4" aria-hidden />
                Marcar todos como lidos
              </button>
            ) : null}
          </>
        }
      >
        {reminderItems.length ? (
          <section aria-labelledby={`${titleId}-lemb`}>
            <h3 id={`${titleId}-lemb`} className="avisos-sec">
              Lembretes avisando <span className="avisos-n">{reminderItems.length}</span>
            </h3>
            <ul className="avisos">{reminderItems.map((item) => render(item, "drawer"))}</ul>
          </section>
        ) : null}
        {noticeItems.length ? (
          <section className={reminderItems.length ? "mt-6" : undefined} aria-labelledby={`${titleId}-sis`}>
            <h3 id={`${titleId}-sis`} className="avisos-sec">
              Do sistema <span className="avisos-n">{noticeItems.length}</span>
            </h3>
            <ul className="avisos">{noticeItems.map((item) => render(item, "drawer"))}</ul>
          </section>
        ) : null}
      </Drawer>
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

/**
 * Data curta dos chips do indicador: "seg 23" e, quando os chips atravessam meses (withMonth), "qua 02/12"
 * (com o ano fora do ano corrente: "sex 01/01/2027"), para a data do outro mês não parecer deste (decisão 2).
 */
export function dateChip(value: string, withMonth = false) {
  const parts = dateParts(value);
  const base = `${parts.weekday.toLowerCase()} ${parts.day}`;
  if (!withMonth) {
    return base;
  }
  const month = String(new Date(value).getMonth() + 1).padStart(2, "0");
  return `${base}/${month}${yearSuffix(value)}`;
}

/** Os chips atravessam meses (ou anos): cada um mostra o mês (dateChip com withMonth). */
export function chipsSpanMonths(values: string[]) {
  return (
    new Set(
      values.map((value) => {
        const date = new Date(value);
        return date.getFullYear() * 12 + date.getMonth();
      })
    ).size > 1
  );
}
