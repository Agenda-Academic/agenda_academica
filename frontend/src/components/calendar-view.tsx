"use client";

import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  History,
  Inbox,
  ListChecks,
  Megaphone,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { buildMonthMatrix, cx, formatTime, isAllDay, monthTitle, startOfDay, weekdayLabels } from "@/lib/format";
import { allCategories, categoryMeta } from "@/lib/meta";
import type { AcademicClass, AcademicEvent, Category, UserRole } from "@/lib/types";
import { EventList } from "./dashboard-bits";
import { EmptyDetail, EventDetailContent } from "./event-bits";
import { EmptyState, Modal, SectionTitle, Segmented, SegmentedButton } from "./ui";

export type CalendarMode = "list" | "month";
type TimeFilter = "upcoming" | "past" | "all";

const timeFilters: Array<{ value: TimeFilter; label: string }> = [
  { value: "upcoming", label: "Próximos" },
  { value: "past", label: "Passados" },
  { value: "all", label: "Todos" },
];

function inPeriod(event: AcademicEvent, period: TimeFilter) {
  if (period === "all") {
    return true;
  }
  const todayStart = startOfDay(new Date()).getTime();
  const reference = new Date(event.endsAt ?? event.startsAt).getTime();
  return period === "upcoming" ? reference >= todayStart : reference < todayStart;
}

/** Barra de filtros: busca, período e filtro do perfil numa linha; categorias com contagem embaixo. */
function FilterBar({
  categoryCounts,
  classFilter,
  classes,
  mineOnly,
  resultCount,
  role,
  search,
  selectedCategories,
  setCategories,
  setClassFilter,
  setMineOnly,
  setSearch,
  setTimeFilter,
  showTimeFilter,
  timeFilter,
  toggleCategory,
}: {
  categoryCounts: Record<Category, number>;
  classFilter: string;
  classes: AcademicClass[];
  mineOnly: boolean;
  resultCount: number;
  role: UserRole;
  search: string;
  selectedCategories: Category[];
  setCategories?: (categories: Category[]) => void;
  setClassFilter: (value: string) => void;
  setMineOnly: (value: boolean) => void;
  setSearch: (value: string) => void;
  setTimeFilter: (value: TimeFilter) => void;
  showTimeFilter: boolean;
  timeFilter: TimeFilter;
  toggleCategory: (category: Category) => void;
}) {
  const allSelected = selectedCategories.length === allCategories.length;
  const hasFilter =
    Boolean(search.trim()) || !allSelected || (showTimeFilter && timeFilter !== "upcoming") || mineOnly || classFilter !== "all";

  function clearAll() {
    setSearch("");
    setTimeFilter("upcoming");
    setMineOnly(false);
    setClassFilter("all");
    if (setCategories) {
      setCategories(allCategories);
    } else {
      allCategories.filter((category) => !selectedCategories.includes(category)).forEach(toggleCategory);
    }
  }

  return (
    <div className="mt-4 grid gap-3 border-b border-line-2 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted" aria-hidden />
          <input
            className="input min-h-[40px] pl-10 pr-9 text-sm"
            placeholder="Buscar no cronograma"
            aria-label="Filtrar por título, disciplina, turma ou professor"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search ? (
            <button
              className="absolute right-2 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
              onClick={() => setSearch("")}
              title="Limpar busca"
              type="button"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </label>

        {showTimeFilter ? (
          <Segmented label="Período">
            {timeFilters.map((item) => (
              <SegmentedButton
                key={item.value}
                active={timeFilter === item.value}
                label={item.label}
                onClick={() => setTimeFilter(item.value)}
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
            Só minhas publicações
          </button>
        ) : null}

        {role === "admin" && classes.length ? (
          <select
            aria-label="Turma"
            className={cx("input min-h-[40px] w-auto text-sm font-semibold", classFilter !== "all" && "border-night text-night")}
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

        <span className="flex-1" />
        <span className="font-mono text-xs text-muted">
          {resultCount} {resultCount === 1 ? "evento" : "eventos"}
        </span>
      </div>

      <div className="chips items-center">
        <button
          className={cx("chip", allSelected && "all")}
          aria-pressed={allSelected}
          onClick={() => (setCategories ? setCategories(allCategories) : clearAll())}
          type="button"
        >
          Todas
          <span className="n">{Object.values(categoryCounts).reduce((sum, count) => sum + count, 0)}</span>
        </button>
        {allCategories.map((category) => {
          const active = selectedCategories.includes(category);
          const meta = categoryMeta[category];
          return (
            <button
              key={category}
              className={cx("chip", !active && "off", active && !allSelected && cx("picked", meta.tint))}
              aria-pressed={active}
              onClick={() => toggleCategory(category)}
              type="button"
            >
              <span className={cx("dot", meta.accent)} aria-hidden />
              {meta.label}
              <span className="n">{categoryCounts[category]}</span>
            </button>
          );
        })}
        {hasFilter ? (
          <button className="link ml-1 text-[13px]" onClick={clearAll} type="button">
            Limpar filtros
          </button>
        ) : null}
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

  const weeks = useMemo(() => buildMonthMatrix(cursor.year, cursor.month, events), [cursor, events]);

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  return (
    <div className="pop">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="disp text-[22px] font-bold">{monthTitle(cursor.year, cursor.month)}</h3>
        <div className="flex items-center gap-2">
          <button className="ib sm" onClick={() => shiftMonth(-1)} title="Mês anterior" type="button">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            className="btn btn-s btn-sm"
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
            type="button"
          >
            Hoje
          </button>
          <button className="ib sm" onClick={() => shiftMonth(1)} title="Próximo mês" type="button">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="cal">
        <div className="cal-head">
          {weekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0].date.toISOString()} className="week">
            {week.map((cell) => {
              const weekend = cell.date.getDay() === 0 || cell.date.getDay() === 6;
              return (
                <div
                  key={cell.date.toISOString()}
                  className={cx("day", !cell.inMonth && "out", cell.today && "today", weekend && "we")}
                >
                  <span className="dnum">{cell.date.getDate()}</span>
                  {cell.events.slice(0, 2).map((event) => (
                    <button
                      key={`${cell.date.toISOString()}-${event.id}`}
                      className={cx(
                        "ce text-left transition hover:brightness-95",
                        categoryMeta[event.category].tint,
                        selectedEventId === event.id && "ring-2 ring-night/60",
                        event.status === "cancelled" && "line-through opacity-60"
                      )}
                      onClick={() => onSelect(event.id)}
                      title={event.title}
                      type="button"
                    >
                      <span className="t">{event.title}</span>
                      <span className="h">{isAllDay(event.startsAt) ? "dia todo" : formatTime(event.startsAt)}</span>
                    </button>
                  ))}
                  {cell.events.length > 2 ? (
                    <button
                      className="px-2 text-left text-[11.5px] font-semibold text-muted hover:text-ink"
                      onClick={() => onSelect(cell.events[2].id)}
                      title={cell.events
                        .slice(2)
                        .map((event) => event.title)
                        .join(" · ")}
                      type="button"
                    >
                      +{cell.events.length - 2} evento{cell.events.length - 2 === 1 ? "" : "s"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
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
  toggleCategory,
  onDelete,
  onEdit,
  onRemoveReminder,
  onSaveReminder,
  onSelect,
  onSetStatus,
}: {
  /** Todos os eventos (sem o filtro de categoria), para as contagens dos chips. */
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
  toggleCategory: (category: Category) => void;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  onRemoveReminder: (event: AcademicEvent) => void;
  onSaveReminder: () => void;
  onSelect: (id: number | null) => void;
  onSetStatus: (event: AcademicEvent, status: "scheduled" | "completed" | "cancelled") => void;
}) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const [mineOnly, setMineOnly] = useState(false);
  const [classFilter, setClassFilter] = useState("all");

  const scope = useMemo(
    () => (list: AcademicEvent[]) => {
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
  const period: TimeFilter = calendarMode === "list" ? timeFilter : "all";
  const listEvents = useMemo(() => scopedEvents.filter((event) => inPeriod(event, period)), [scopedEvents, period]);

  // Contagem por categoria respeitando busca, período e perfil (mas não a própria seleção de categorias).
  const categoryCounts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const base = scope(allEvents ?? events).filter(
      (event) =>
        inPeriod(event, period) &&
        (!term ||
          [event.title, event.subject?.name, event.academicClass?.name, event.teacher?.fullName]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase("pt-BR").includes(term)))
    );
    return Object.fromEntries(
      allCategories.map((category) => [category, base.filter((event) => event.category === category).length])
    ) as Record<Category, number>;
  }, [allEvents, events, scope, period, search]);

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
    <div className="grid gap-5 xl:h-[calc(100vh-150px)] xl:min-h-[620px] xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="card pad rise flex min-h-0 min-w-0 flex-col" aria-label="Cronograma">
        <div className="head">
          <SectionTitle
            eyebrow="Cronograma"
            title={
              role === "admin"
                ? "Cronograma institucional"
                : role === "teacher"
                  ? "Cronograma das suas turmas"
                  : "Cronograma da sua turma"
            }
            subtitle={calendarMode === "list" ? "Toque num evento para ver os detalhes ao lado" : "Visão mensal com as categorias filtradas"}
          />
          <Segmented label="Modo de visualização">
            <SegmentedButton active={calendarMode === "list"} onClick={() => setCalendarMode("list")} icon={ListChecks} label="Agenda" />
            <SegmentedButton active={calendarMode === "month"} onClick={() => setCalendarMode("month")} icon={CalendarRange} label="Calendário" />
          </Segmented>
        </div>

        <FilterBar
          categoryCounts={categoryCounts}
          classFilter={classFilter}
          classes={classes}
          mineOnly={mineOnly}
          resultCount={calendarMode === "list" ? listEvents.length : scopedEvents.length}
          role={role}
          search={search}
          selectedCategories={selectedCategories}
          setCategories={setCategories}
          setClassFilter={setClassFilter}
          setMineOnly={setMineOnly}
          setSearch={setSearch}
          setTimeFilter={setTimeFilter}
          showTimeFilter={calendarMode === "list"}
          timeFilter={timeFilter}
          toggleCategory={toggleCategory}
        />

        <div className="scroll mt-3">
          {calendarMode === "list" ? (
            listEvents.length ? (
              <div key={`${timeFilter}-${listEvents.length}`} className="pop">
                <EventList
                  events={listEvents}
                  grouped={timeFilter === "upcoming"}
                  hideClass={role === "student"}
                  isMine={role === "teacher" ? canManageEvent : undefined}
                  selectedId={selectedEventId}
                  emptyIcon={Inbox}
                  emptyText="Nenhum evento encontrado."
                  onSelect={(id) => onSelect(id)}
                />
              </div>
            ) : (
              <EmptyState
                icon={timeFilter === "past" ? History : Inbox}
                text="Nenhum evento encontrado."
                hint="Ajuste os filtros ou o período para ver mais resultados."
              />
            )
          ) : (
            <MonthCalendar events={scopedEvents} selectedEventId={selectedEventId} onSelect={onSelect} />
          )}
        </div>
      </section>

      {/* Detalhe ao lado (desktop): mesma altura da lista, com rolagem interna */}
      <aside className="card pad rise hidden min-h-0 flex-col xl:flex" style={{ "--i": 1 } as CSSProperties} aria-label="Detalhe do evento">
        <div key={selectedEvent?.id ?? "vazio"} className="scroll pop">
          {detailContent ?? <EmptyDetail />}
        </div>
      </aside>

      {/* Modal de detalhes (celular/tablet) */}
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
