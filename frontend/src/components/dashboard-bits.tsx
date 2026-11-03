"use client";

import {
  ArrowRight,
  Bell,
  BellRing,
  BookOpen,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  PieChart,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { countdown, cx, dateParts, formatTime, groupByWeek, isWholeDay, relativeDue, startOfDay } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, Category, Reminder } from "@/lib/types";
import { EventRow, eventLastDay } from "./event-bits";
import { EmptyState } from "./ui";

/** Filtro com que os painéis abrem o Cronograma (ex.: só Provas). */
export type CalendarFilter = { categories?: Category[] };

/** Categorias das datas oficiais do campus. */
export const officialCategories: Category[] = ["institutional", "holiday", "recess"];

/**
 * Data oficial: evento da administração (ou importado) de uma das categorias do calendário
 * oficial. É a regra do filtro com que os painéis abrem o Cronograma, para o número do card
 * bater com a lista que abre.
 */
export function isOfficialDate(event: AcademicEvent) {
  const official = event.officialPriority || event.source === "official" || event.source === "imported";
  return official && officialCategories.includes(event.category);
}

/**
 * Quantos eventos o Cronograma mostra em "Próximos" (só das categorias dadas, se houver):
 * os que ainda têm algum dia pela frente, em qualquer situação, como a lista de lá conta.
 * É o N do "Ver todos no cronograma (N)".
 */
export function calendarUpcomingCount(events: AcademicEvent[], now: number, categories?: Category[]) {
  const today = startOfDay(new Date(now)).getTime();
  return events.filter(
    (event) => (!categories || categories.includes(event.category)) && eventLastDay(event).getTime() >= today
  ).length;
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

// enquanto envia, o botão continua focável, só fica apagado
const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/** Pílula "Salvo agora" (a mesma da Gestão). */
function SavedPill() {
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
 * Rola a página até o evento ficar inteiro na faixa livre: se ele já está nela, nada se mexe;
 * se não, ele vai para o meio dela (como a linha salva na Gestão). Mais alto que a faixa, fica
 * à vista o começo dele, com o título e a pílula.
 */
function scrollIntoFreeBand(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const band = freeBand(element);
  if (box.top >= band.top && box.bottom <= band.bottom) {
    return;
  }
  const room = band.bottom - band.top;
  const goal = box.height >= room ? band.top : band.top + (room - box.height) / 2;
  window.scrollTo({ top: window.scrollY + box.top - goal, behavior: reducedMotion() ? "auto" : "smooth" });
}

/**
 * Mostra no Painel o evento salvo pelo painel lateral (savedTick muda a cada salvamento):
 * espera a lista nova e nenhum diálogo aberto, põe a pílula "Salvo agora" no destaque ou na
 * linha com data-event-id e, já com a altura final, rola até ela ficar livre da barra do topo
 * e dos avisos, põe o foco na ação principal dela e pisca o fundo. Devolve o id que tem a
 * pílula. Se o evento não aparece no Painel, o foco vai para o título da tela, nunca para o
 * "Editar" de outro evento.
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
    scrollIntoFreeBand(target);
    // a linha é o próprio botão; no destaque, a ação principal é o botão marcado
    const action = target.matches("button") ? target : (target.querySelector<HTMLElement>("[data-primary-action]") ?? target);
    action.focus({ preventScroll: true });
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
  const name = `${label}: ${value}${unit ? ` ${unit}` : ""}${actionLabel ? `. ${actionLabel}` : ""}`;
  return (
    <div className={cx("card kpi rise", onClick && "is-link")} style={delay(order)}>
      <div className="kpi-top">
        <p className="kpi-label">
          {onClick ? (
            <button className="kpi-hit" aria-label={name} onClick={onClick} type="button">
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
      {hint ? <p className="kpi-hint">{hint}</p> : null}
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

export function EventList({
  className,
  emptyCompact,
  emptyHint,
  emptyIcon,
  emptyText,
  events,
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
  /**
   * Rodapé "Ver todos (N)", mostrado quando o destino tem mais eventos que a lista mostra.
   * count é quantos o destino mostra (o Cronograma conta também cancelados e concluídos);
   * sem ele, N é o tamanho da lista.
   */
  showAll?: { label: string; onClick: () => void; count?: number };
  onSelect: (id: number) => void;
}) {
  const visible = limit ? events.slice(0, limit) : events;
  const total = showAll?.count ?? events.length;

  if (!visible.length) {
    const empty = <EmptyState compact={emptyCompact} icon={emptyIcon} text={emptyText} hint={emptyHint} />;
    return className ? <div className={className}>{empty}</div> : empty;
  }

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
      {showAll && visible.length < total ? (
        <div className="card-foot">
          <button className="link" onClick={showAll.onClick} type="button">
            {showAll.label} ({total})
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}

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

/** Contagem regressiva que se atualiza sozinha. */
function Countdown({ startsAt, until }: { startsAt: string; until: string }) {
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
      <small aria-hidden>{until}</small>
      <span className="sr-only">
        {countdownWords(startsAt, now)} {until}.
      </span>
    </div>
  );
}

type HeroAction = {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  /** Enviando: giro no lugar do ícone e o clique não repete. */
  busy?: boolean;
};

/** Destaque do próximo compromisso (card branco com faixa verde), com bloco de data e contagem regressiva. */
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
  onOpen: (id: number) => void;
  onEmptyAction?: { label: string; onClick: () => void };
}) {
  if (!event) {
    return (
      <section className="hero h-full" aria-label={kicker}>
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
  const when = `${capitalize(relativeDue(event.startsAt))}, ${isWholeDay(event.startsAt, event.endsAt) ? "dia todo" : formatTime(event.startsAt)}`;
  const course = [event.subject?.name, hideClass ? null : event.academicClass?.name].filter(Boolean).join(", ");
  const SecondaryIcon = secondary?.icon ?? Bell;
  const PrimaryIcon = primaryAction?.icon;

  // a chave troca o card quando o evento muda: o foco não fica num "Editar" que passou a ser de outro evento
  return (
    <section key={event.id} className="hero with-date h-full" aria-label={kicker} data-event-id={event.id}>
      <div className="datebig">
        <span className="dw">{parts.weekday}</span>
        <span className="dn">{parts.day}</span>
        <span className="mo">{parts.month}</span>
      </div>
      <div className="hero-body">
        <div className="hero-kicker">
          <span className="eyebrow">{kicker}</span>
          <span className={cx("pill", meta.tint)}>{meta.short}</span>
          {saved ? <SavedPill /> : null}
        </div>
        <h2 className="hero-title">{event.title}</h2>
        <div className="hero-meta">
          <span>
            <Clock className="h-[15px] w-[15px]" aria-hidden />
            {when}
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
            <button className="btn btn-p" data-primary-action onClick={primaryAction.onClick} type="button">
              {PrimaryIcon ? <PrimaryIcon className="h-4 w-4" aria-hidden /> : null}
              {primaryAction.label}
              {PrimaryIcon ? null : <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          ) : (
            <button className="btn btn-p" data-primary-action onClick={() => onOpen(event.id)} type="button">
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
          {secondary ? (
            <button
              className={cx("btn btn-s", busyLook)}
              aria-busy={secondary.busy || undefined}
              aria-disabled={secondary.busy || undefined}
              onClick={() => {
                if (!secondary.busy) {
                  secondary.onClick();
                }
              }}
              type="button"
            >
              {secondary.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <SecondaryIcon className="h-4 w-4" aria-hidden />
              )}
              {secondary.label}
            </button>
          ) : null}
        </div>
      </div>
      <Countdown startsAt={event.startsAt} until={event.category === "assignment" ? "até a entrega" : "até o início"} />
    </section>
  );
}

/** Quando é o evento do aviso: "Amanhã, 19:00" ou "Hoje, dia todo". */
function avisoWhen(event: AcademicEvent) {
  return `${capitalize(relativeDue(event.startsAt))}, ${isWholeDay(event.startsAt, event.endsAt) ? "dia todo" : formatTime(event.startsAt)}`;
}

/**
 * Avisos do sistema: lembretes cuja hora chegou, com o evento ainda por vir. É o mesmo bloco
 * no Painel e em Lembretes. Ao dispensar, o foco vai para o "Dispensar" que fica no lugar
 * ou, sem mais avisos, para fallbackFocus (padrão: o título da tela).
 */
export function AvisosCard({
  avisos,
  events = [],
  fallbackFocus,
  note = true,
  order = 0,
  onDismiss,
  onOpen,
}: {
  avisos: Reminder[];
  /** Para achar o evento quando o lembrete chega sem ele. */
  events?: AcademicEvent[];
  /** Para onde vai o foco depois de dispensar o último aviso (o card some). */
  fallbackFocus?: () => HTMLElement | null;
  /** Mostra a frase sobre onde o aviso aparece. */
  note?: boolean;
  order?: number;
  onDismiss?: (reminderId: number) => void;
  onOpen: (eventId: number) => void;
}) {
  const titleId = useId();
  const dismissButtons = useRef(new Map<number, HTMLButtonElement>());
  if (!avisos.length) {
    return null;
  }

  function dismiss(id: number) {
    const ids = avisos.map((aviso) => aviso.id);
    const at = ids.indexOf(id);
    const rest = ids.filter((item) => item !== id);
    const nextId = rest[Math.min(at, rest.length - 1)];
    onDismiss?.(id);
    // o aviso sai da lista: o foco vai para o "Dispensar" que fica no lugar, nunca para o início da página
    const next = nextId !== undefined ? (dismissButtons.current.get(nextId) ?? null) : null;
    const target = next ?? fallbackFocus?.() ?? screenHeading();
    target?.focus({ preventScroll: !next });
  }

  return (
    <section className="card pad rise" style={delay(order)} aria-labelledby={titleId}>
      <div className="flex items-start gap-3.5">
        <span className="aviso-ico" aria-hidden>
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="h2" id={titleId}>
            Avisos ({avisos.length})
          </h2>
          {note ? <p className="sub">O aviso aparece aqui no sistema. O envio por e-mail é o próximo passo.</p> : null}
        </div>
      </div>
      <ul className="avisos">
        {avisos.map((aviso) => {
          const event = aviso.academicEvent ?? events.find((item) => item.id === aviso.academicEventId);
          const details = event ? [avisoWhen(event), event.location].filter(Boolean).join(", ") : null;
          return (
            <li key={aviso.id} className="aviso">
              <p className="aviso-t">
                {event?.title ?? "Evento da sua agenda"}
                {details ? <span className="block text-sm font-normal text-muted">{details}</span> : null}
              </p>
              <div className="aviso-acts">
                <button
                  className="btn btn-s btn-sm"
                  aria-label={event ? `Ver evento ${event.title}` : undefined}
                  onClick={() => onOpen(aviso.academicEventId)}
                  type="button"
                >
                  Ver evento
                </button>
                {onDismiss ? (
                  <button
                    ref={(node) => {
                      if (node) {
                        dismissButtons.current.set(aviso.id, node);
                      } else {
                        dismissButtons.current.delete(aviso.id);
                      }
                    }}
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
        })}
      </ul>
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
