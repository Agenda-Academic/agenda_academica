"use client";

import { PieChart, type LucideIcon } from "lucide-react";
import { cx } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicEvent, Category } from "@/lib/types";
import { EventRow } from "./event-bits";
import { EmptyState } from "./ui";

export function InsightTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {hint ? <p className="mt-1 truncate text-xs text-slate-400">{hint}</p> : null}
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
  const present = counts
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = present.reduce((sum, item) => sum + item.count, 0);

  if (!total) {
    return <EmptyState icon={PieChart} text={emptyText} />;
  }

  return (
    <div>
      {/* Barra proporcional segmentada por categoria */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {present.map(({ category, count }) => (
          <div
            key={category}
            className={cx("h-full transition-all", categoryMeta[category].accent)}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${categoryMeta[category].label}: ${count}`}
          />
        ))}
      </div>

      {/* Legenda apenas com o que existe */}
      <ul className="mt-4 grid gap-2">
        {present.map(({ category, count }) => (
          <li key={category} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cx("h-2.5 w-2.5 shrink-0 rounded-full", categoryMeta[category].accent)}
                aria-hidden
              />
              <span className="truncate text-slate-600">{categoryMeta[category].label}</span>
            </span>
            <span className="shrink-0 font-semibold text-slate-950">
              {count}
              <span className="ml-1 text-xs font-medium text-slate-400">
                {Math.round((count / total) * 100)}%
              </span>
            </span>
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
  hideClass,
  limit,
  onSelect,
}: {
  emptyHint?: string;
  emptyIcon: LucideIcon;
  emptyText: string;
  events: AcademicEvent[];
  hideClass?: boolean;
  limit?: number;
  onSelect: (id: number) => void;
}) {
  const visible = limit ? events.slice(0, limit) : events;

  if (!visible.length) {
    return <EmptyState icon={emptyIcon} text={emptyText} hint={emptyHint} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {visible.map((event, index) => (
        <EventRow
          key={event.id}
          compact
          event={event}
          hideClass={hideClass}
          separated={index < visible.length - 1}
          onClick={() => onSelect(event.id)}
        />
      ))}
    </div>
  );
}
