"use client";

import type { LucideIcon } from "lucide-react";
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

export function CategoryBar({
  category,
  count,
  total,
}: {
  category: Category;
  count: number;
  total: number;
}) {
  const width = Math.max((count / total) * 100, count ? 10 : 2);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{categoryMeta[category].label}</span>
        <span className="font-semibold text-slate-950">{count}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cx("h-full rounded-full transition-all", categoryMeta[category].accent)}
          style={{ width: `${width}%` }}
        />
      </div>
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
