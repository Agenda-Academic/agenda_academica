"use client";

import { ArrowRight, Bell, Clock, MapPin, PieChart, Trophy, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { countdown, cx, dateParts, groupByWeek, isAllDay, relativeDue, formatTime } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, Category } from "@/lib/types";
import { EventRow } from "./event-bits";
import { EmptyState } from "./ui";

/** Atraso da entrada suave (classe "rise"): blocos aparecem em sequência. */
export function delay(order: number) {
  return { "--i": order } as CSSProperties;
}

/** Card de indicador (KPI) do Figma. */
export function InsightTile({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  tone,
  order = 0,
  children,
}: {
  order?: number;
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  hint?: ReactNode;
  /** Cor do ícone: classe de categoria (ex.: "c-prova"). Padrão: verde da marca. */
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card kpi rise" style={delay(order)}>
      <div className="kpi-top">
        <p className="kpi-label">{label}</p>
        <span className={cx("kpi-ico", tone)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
      <p className="kpi-val">
        {value}
        {unit ? <small>{unit}</small> : null}
      </p>
      {children}
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
    return <EmptyState icon={PieChart} text={emptyText} />;
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
  emptyHint,
  emptyIcon,
  emptyText,
  events,
  grouped,
  hideClass,
  limit,
  mineId,
  isMine,
  selectedId,
  onSelect,
}: {
  emptyHint?: string;
  emptyIcon: LucideIcon;
  emptyText: string;
  events: AcademicEvent[];
  /** Separa em "Esta semana", "Próxima semana" e "Mais adiante". */
  grouped?: boolean;
  hideClass?: boolean;
  limit?: number;
  /** Marca como "Sua publicação" os eventos deste professor. */
  mineId?: number;
  isMine?: (event: AcademicEvent) => boolean;
  selectedId?: number | null;
  onSelect: (id: number) => void;
}) {
  const visible = limit ? events.slice(0, limit) : events;

  if (!visible.length) {
    return <EmptyState icon={emptyIcon} text={emptyText} hint={emptyHint} />;
  }

  const row = (event: AcademicEvent) => (
    <EventRow
      key={event.id}
      event={event}
      hideClass={hideClass}
      mine={isMine ? isMine(event) : mineId !== undefined && event.teacherId === mineId}
      selected={selectedId === event.id}
      onClick={() => onSelect(event.id)}
    />
  );

  if (!grouped) {
    return <div className="grid gap-0.5">{visible.map(row)}</div>;
  }

  return (
    <div>
      {groupByWeek(visible).map((group) => (
        <div key={group.label}>
          <p className="ev-group">{group.label}</p>
          <div className="grid gap-0.5">{group.items.map(row)}</div>
        </div>
      ))}
    </div>
  );
}

/** Contagem regressiva que se atualiza sozinha. */
function Countdown({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return <b>{countdown(startsAt, now)}</b>;
}

/** Destaque do próximo compromisso (card branco com faixa verde), com bloco de data e contagem regressiva. */
export function NextEventHero({
  event,
  emptyTitle = "Você está em dia com os prazos",
  emptyText = "Quando novos prazos forem publicados, eles aparecem aqui.",
  kicker = "Próximo compromisso",
  primaryLabel = "Ver detalhes",
  secondary,
  onOpen,
  onEmptyAction,
}: {
  event: AcademicEvent | null;
  emptyTitle?: string;
  emptyText?: string;
  kicker?: string;
  primaryLabel?: string;
  secondary?: { label: string; icon?: LucideIcon; onClick: () => void };
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
  const when = `${relativeDue(event.startsAt).replace(/^./, (c) => c.toUpperCase())}${isAllDay(event.startsAt) ? ", dia todo" : `, ${formatTime(event.startsAt)}`}`;
  const SecondaryIcon = secondary?.icon ?? Bell;

  return (
    <section className="hero h-full" aria-label={kicker}>
      <div className="datebig">
        <span className="dw">{parts.weekday}</span>
        <span className="dn">{parts.day}</span>
        <span className="mo">{parts.month}</span>
      </div>
      <div className="hero-body">
        <div className="hero-kicker">
          <span className="eyebrow">{kicker}</span>
          <span className={cx("pill", meta.tint)}>{meta.short}</span>
        </div>
        <h2 className="hero-title">{event.title}</h2>
        <div className="hero-meta">
          <span>
            <Clock className="h-[15px] w-[15px]" aria-hidden />
            {when}
          </span>
          {event.location ? (
            <span>
              <MapPin className="h-[15px] w-[15px]" aria-hidden />
              {event.location}
            </span>
          ) : null}
          {event.teacher?.fullName ? (
            <span>
              <UserRound className="h-[15px] w-[15px]" aria-hidden />
              {event.teacher.fullName}
            </span>
          ) : null}
          {event.points !== null ? (
            <span>
              <Trophy className="h-[15px] w-[15px]" aria-hidden />
              {event.points} pts (informativa)
            </span>
          ) : null}
        </div>
        <div className="hero-actions">
          <button className="btn btn-p" onClick={() => onOpen(event.id)} type="button">
            {primaryLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          {secondary ? (
            <button className="btn btn-s" onClick={secondary.onClick} type="button">
              <SecondaryIcon className="h-4 w-4" aria-hidden />
              {secondary.label}
            </button>
          ) : null}
        </div>
      </div>
      <div className="countdown">
        <p className="eyebrow">
          <span className="live" aria-hidden />
          Faltam
        </p>
        <Countdown startsAt={event.startsAt} />
        <small>até o início</small>
      </div>
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
    <div className="flex h-10 items-end gap-1" role="img" aria-label={`Compromissos por semana: ${weeks.join(", ")}`}>
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
