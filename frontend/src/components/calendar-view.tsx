"use client";

import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  History,
  Inbox,
  ListChecks,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildMonthMatrix,
  cx,
  monthTitle,
  startOfDay,
  weekdayLabels,
} from "@/lib/format";
import { allCategories, categoryMeta } from "@/lib/meta";
import type { AcademicEvent, Category } from "@/lib/types";
import { EmptyDetail, EventDetailContent, EventRow } from "./event-bits";
import { EmptyState, Modal, SectionTitle, SegmentedButton, iconButton, secondaryButton } from "./ui";

export type CalendarMode = "list" | "month";
type TimeFilter = "upcoming" | "past" | "all";

const timeFilters: Array<{ value: TimeFilter; label: string }> = [
  { value: "upcoming", label: "Próximos" },
  { value: "past", label: "Passados" },
  { value: "all", label: "Todos" },
];

function Filters({
  search,
  selectedCategories,
  setSearch,
  timeFilter,
  setTimeFilter,
  toggleCategory,
  showTimeFilter,
}: {
  search: string;
  selectedCategories: Category[];
  setSearch: (value: string) => void;
  timeFilter: TimeFilter;
  setTimeFilter: (value: TimeFilter) => void;
  toggleCategory: (category: Category) => void;
  showTimeFilter: boolean;
}) {
  return (
    <div className="mt-4 grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            placeholder="Filtrar por título, disciplina, turma ou professor"
            aria-label="Filtrar por título, disciplina, turma ou professor"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {showTimeFilter ? (
          <div className="grid shrink-0 grid-cols-3 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
            {timeFilters.map((item) => (
              <button
                key={item.value}
                className={cx(
                  "h-8 rounded-md px-3 transition",
                  timeFilter === item.value
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                )}
                aria-pressed={timeFilter === item.value}
                onClick={() => setTimeFilter(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {allCategories.map((category) => {
          const active = selectedCategories.includes(category);
          return (
            <button
              key={category}
              className={cx(
                "h-8 rounded-lg border px-3 text-sm font-semibold transition",
                active
                  ? categoryMeta[category].pill
                  : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              )}
              aria-pressed={active}
              onClick={() => toggleCategory(category)}
              type="button"
            >
              {categoryMeta[category].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MonthCalendar({
  events,
  selectedEventId,
  onSelect,
}: {
  events: AcademicEvent[];
  selectedEventId: number | null;
  onSelect: (id: number) => void;
}) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const weeks = useMemo(
    () => buildMonthMatrix(cursor.year, cursor.month, events),
    [cursor, events]
  );

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-tight text-slate-950">
          {monthTitle(cursor.year, cursor.month)}
        </h3>
        <div className="flex items-center gap-2">
          <button
            className={cx(iconButton, "h-9 w-9")}
            onClick={() => shiftMonth(-1)}
            title="Mês anterior"
            type="button"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            className={cx(secondaryButton, "h-9 min-h-0 px-3")}
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
            type="button"
          >
            Hoje
          </button>
          <button
            className={cx(iconButton, "h-9 w-9")}
            onClick={() => shiftMonth(1)}
            title="Próximo mês"
            type="button"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
          {weekdayLabels.map((label) => (
            <span key={label} className="py-2">
              {label}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((cell) => (
            <div
              key={cell.date.toISOString()}
              className={cx(
                "min-h-[92px] border-b border-r border-slate-100 p-1.5 last:border-r-0 sm:min-h-[112px] sm:p-2",
                !cell.inMonth ? "bg-slate-50/70" : "",
                cell.today ? "bg-emerald-50/50" : ""
              )}
            >
              <span
                className={cx(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                  cell.today
                    ? "bg-emerald-600 text-white"
                    : cell.inMonth
                      ? "text-slate-700"
                      : "text-slate-300"
                )}
              >
                {cell.date.getDate()}
              </span>
              <div className="mt-1 grid gap-1">
                {cell.events.slice(0, 3).map((event) => (
                  <button
                    key={`${cell.date.toISOString()}-${event.id}`}
                    className={cx(
                      "truncate rounded-md px-1.5 py-1 text-left text-[11px] font-semibold leading-tight transition sm:text-xs",
                      categoryMeta[event.category].chip,
                      selectedEventId === event.id ? "ring-2 ring-slate-950/60" : "",
                      event.status === "cancelled" ? "line-through opacity-60" : ""
                    )}
                    onClick={() => onSelect(event.id)}
                    title={event.title}
                    type="button"
                  >
                    {event.title}
                  </button>
                ))}
                {cell.events.length > 3 ? (
                  <span
                    className="px-1.5 text-[11px] font-semibold text-slate-400"
                    title={cell.events
                      .slice(3)
                      .map((event) => event.title)
                      .join(" · ")}
                  >
                    +{cell.events.length - 3} evento{cell.events.length - 3 === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {allCategories.map((category) => (
          <span key={category} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span className={cx("h-2.5 w-2.5 rounded-full", categoryMeta[category].accent)} aria-hidden />
            {categoryMeta[category].label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CalendarView({
  calendarMode,
  canManageEvent,
  events,
  reminderOffset,
  saving,
  search,
  selectedCategories,
  selectedEvent,
  selectedEventId,
  setCalendarMode,
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
  calendarMode: CalendarMode;
  canManageEvent: (event: AcademicEvent) => boolean;
  events: AcademicEvent[];
  reminderOffset: string;
  saving: boolean;
  search: string;
  selectedCategories: Category[];
  selectedEvent: AcademicEvent | null;
  selectedEventId: number | null;
  setCalendarMode: (mode: CalendarMode) => void;
  setReminderOffset: (value: string) => void;
  setSearch: (value: string) => void;
  toggleCategory: (category: Category) => void;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  onRemoveReminder: (event: AcademicEvent) => void;
  onSaveReminder: () => void;
  onSelect: (id: number | null) => void;
  onSetStatus: (event: AcademicEvent, status: "scheduled" | "completed" | "cancelled") => void;
}) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");

  const listEvents = useMemo(() => {
    if (timeFilter === "all") {
      return events;
    }
    const todayStart = startOfDay(new Date()).getTime();
    return events.filter((event) => {
      const reference = new Date(event.endsAt ?? event.startsAt).getTime();
      return timeFilter === "upcoming" ? reference >= todayStart : reference < todayStart;
    });
  }, [events, timeFilter]);

  const detailContent = selectedEvent ? (
    <EventDetailContent
      canManage={canManageEvent(selectedEvent)}
      event={selectedEvent}
      reminderOffset={reminderOffset}
      saving={saving}
      setReminderOffset={setReminderOffset}
      onDelete={onDelete}
      onEdit={onEdit}
      onRemoveReminder={onRemoveReminder}
      onSaveReminder={onSaveReminder}
      onSetStatus={onSetStatus}
    />
  ) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="surface min-w-0 p-4">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <SectionTitle
            eyebrow="Cronograma"
            icon={CalendarDays}
            title="Linha do tempo acadêmica"
            subtitle={
              calendarMode === "list"
                ? `${listEvents.length} evento${listEvents.length === 1 ? "" : "s"} dentro dos filtros atuais`
                : "Visão mensal com todas as categorias filtradas"
            }
          />
          <div className="flex gap-2">
            <SegmentedButton
              active={calendarMode === "list"}
              onClick={() => setCalendarMode("list")}
              icon={ListChecks}
              label="Agenda"
            />
            <SegmentedButton
              active={calendarMode === "month"}
              onClick={() => setCalendarMode("month")}
              icon={CalendarRange}
              label="Calendário"
            />
          </div>
        </div>

        <Filters
          search={search}
          selectedCategories={selectedCategories}
          setSearch={setSearch}
          timeFilter={timeFilter}
          setTimeFilter={setTimeFilter}
          toggleCategory={toggleCategory}
          showTimeFilter={calendarMode === "list"}
        />

        {calendarMode === "list" ? (
          listEvents.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {listEvents.map((event, index) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={selectedEventId === event.id}
                  separated={index < listEvents.length - 1}
                  onClick={() => onSelect(event.id)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                icon={timeFilter === "past" ? History : Inbox}
                text="Nenhum evento encontrado."
                hint="Ajuste os filtros ou o período para ver mais resultados."
              />
            </div>
          )
        ) : (
          <MonthCalendar events={events} selectedEventId={selectedEventId} onSelect={onSelect} />
        )}
      </section>

      {/* Painel lateral (desktop) */}
      <aside className="surface hidden h-fit p-4 xl:sticky xl:top-3 xl:block">
        {detailContent ?? <EmptyDetail />}
      </aside>

      {/* Modal de detalhes (mobile/tablet) */}
      {selectedEvent ? (
        <div className="xl:hidden">
          <Modal title="Detalhes do evento" onClose={() => onSelect(null)}>
            {detailContent}
          </Modal>
        </div>
      ) : null}
    </div>
  );
}
