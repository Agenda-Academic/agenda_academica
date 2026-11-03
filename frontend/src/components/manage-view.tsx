"use client";

import {
  CalendarPlus,
  CheckCircle2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { cx, dateParts } from "@/lib/format";
import { categoryMeta, statusMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, TeachingAssignment, UserRole } from "@/lib/types";
import { delay } from "./dashboard-bits";
import { reactivatedStatus } from "./event-bits";
import { NoAssignmentsNotice, eventWhen, eventWhenLabel, type EventStatusChange } from "./event-editor";
import { SegmentedButton } from "./ui";

/* ------------------------------------------------------------------ */
/* Abas, busca e ordem                                                 */
/* ------------------------------------------------------------------ */

type StatusTab = "upcoming" | "past" | "completed" | "cancelled" | "all";

const tabs: Array<{ id: StatusTab; label: string }> = [
  { id: "upcoming", label: "Próximos" },
  { id: "past", label: "Já passaram" },
  { id: "completed", label: "Concluídos" },
  { id: "cancelled", label: "Cancelados" },
  { id: "all", label: "Todos" },
];

const PAGE = 10;

// tabela a partir de 1024px; abaixo, cartões
const wideQuery = "(min-width: 1024px)";
function subscribeWide(notify: () => void) {
  const query = window.matchMedia(wideQuery);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
const readWide = () => window.matchMedia(wideQuery).matches;
const readWideOnServer = () => true;

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

const isOfficial = (event: AcademicEvent) => event.officialPriority || event.source !== "teacher";
const startTime = (event: AcademicEvent) => new Date(event.startsAt).getTime();
const isOpen = (event: AcademicEvent) => event.status === "scheduled" || event.status === "changed";

function tabOf(event: AcademicEvent, now: number): Exclude<StatusTab, "all"> {
  if (event.status === "cancelled") {
    return "cancelled";
  }
  if (event.status === "completed") {
    return "completed";
  }
  return new Date(event.endsAt ?? event.startsAt).getTime() < now ? "past" : "upcoming";
}

function searchText(event: AcademicEvent) {
  const meta = categoryMeta[event.category];
  return normalize(
    [
      event.title,
      event.description,
      event.subject?.name,
      event.academicClass?.name ?? "Toda a instituição",
      event.teacher?.fullName,
      event.location,
      meta.label,
      meta.short,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function rowsFor(events: AcademicEvent[], tab: StatusTab, now: number) {
  const rows = tab === "all" ? [...events] : events.filter((event) => tabOf(event, now) === tab);
  // o que já passou aparece do mais recente para o mais antigo
  const newestFirst = tab === "past" || tab === "completed";
  return rows.sort((a, b) => (newestFirst ? startTime(b) - startTime(a) : startTime(a) - startTime(b)));
}

function countByTab(events: AcademicEvent[], now: number) {
  const counts: Record<StatusTab, number> = { upcoming: 0, past: 0, completed: 0, cancelled: 0, all: events.length };
  for (const event of events) {
    counts[tabOf(event, now)] += 1;
  }
  return counts;
}

function summaryLine(counts: Record<StatusTab, number>) {
  const parts = [
    counts.upcoming ? `${counts.upcoming} ${counts.upcoming === 1 ? "próximo" : "próximos"}` : null,
    counts.past ? `${counts.past} ${counts.past === 1 ? "já passou" : "já passaram"}` : null,
    counts.completed ? `${counts.completed} ${counts.completed === 1 ? "concluído" : "concluídos"}` : null,
    counts.cancelled ? `${counts.cancelled} ${counts.cancelled === 1 ? "cancelado" : "cancelados"}` : null,
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) {
    return "Nenhum evento ainda.";
  }
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function audienceOf(event: AcademicEvent, withTeacher: boolean) {
  return [
    event.subject?.name,
    event.academicClass?.name ?? "Toda a instituição",
    withTeacher && event.source === "teacher" ? event.teacher?.fullName : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/* ------------------------------------------------------------------ */
/* Foco e destaque depois das ações                                    */
/* ------------------------------------------------------------------ */

/** Roda quando nenhum diálogo (painel ou confirmação) estiver aberto, para o foco não voltar para trás. */
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

/** Fundo verde que some em 3 s na linha salva. */
function flashRow(row: HTMLElement) {
  const from = getComputedStyle(document.documentElement).getPropertyValue("--brand-100").trim() || "#d3eddb";
  const to = getComputedStyle(row).backgroundColor;
  row.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: 3000, easing: "ease-out" });
}

/* ------------------------------------------------------------------ */
/* Gestão                                                              */
/* ------------------------------------------------------------------ */

export type ManageViewProps = {
  canWrite: boolean;
  context: AcademicContext | null;
  role: UserRole;
  isAdmin: boolean;
  manageableEvents: AcademicEvent[];
  allEvents?: AcademicEvent[];
  editingEventId: number | null;
  lastSavedId?: number | null;
  savedTick?: number;
  saving?: boolean;
  onNewEvent: () => void;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
  onEdit: (event: AcademicEvent) => void;
  onDelete: (event: AcademicEvent) => void;
  onSetStatus?: (event: AcademicEvent, status: EventStatusChange) => void;
};

export function ManageView({
  canWrite,
  context,
  role,
  isAdmin,
  manageableEvents,
  allEvents,
  editingEventId,
  lastSavedId,
  savedTick,
  saving = false,
  onNewEvent,
  onNewEventFor,
  onEdit,
  onDelete,
  onSetStatus,
}: ManageViewProps) {
  const admin = isAdmin || role === "admin";
  const wide = useSyncExternalStore(subscribeWide, readWide, readWideOnServer);
  const headingId = useId();
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<StatusTab>("upcoming");
  const [search, setSearch] = useState("");
  const [onlyOfficial, setOnlyOfficial] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  // list: a lista do momento do salvamento; a linha só é mostrada com a lista nova (ou depois de esperar)
  const [reveal, setReveal] = useState<{
    id: number;
    list: AcademicEvent[];
    waited: boolean;
    ready: boolean;
  } | null>(null);
  const [seenTick, setSeenTick] = useState(savedTick);
  const [flash, setFlash] = useState<{ id: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabSelectRef = useRef<HTMLSelectElement>(null);
  // linha que pode sumir (excluir, concluir, editar): o foco vai para a vizinha
  const pendingRef = useRef<{ id: number; index: number } | null>(null);
  const moreFocusRef = useRef<number | null>(null);

  const assignments = context?.teachingAssignments ?? [];
  const term = normalize(search);
  const filtered = (searchTerm: string, official: boolean) =>
    manageableEvents.filter(
      (event) => (!official || isOfficial(event)) && (!searchTerm || searchText(event).includes(searchTerm))
    );

  // salvou (p2 avisa por savedTick): mostrar a linha salva, trocando de aba e de página se preciso
  if (savedTick !== seenTick) {
    setSeenTick(savedTick);
    if (lastSavedId != null) {
      setReveal({ id: lastSavedId, list: manageableEvents, waited: false, ready: false });
    }
  }
  if (reveal && !reveal.ready && (reveal.waited || manageableEvents !== reveal.list)) {
    const target = manageableEvents.find((event) => event.id === reveal.id);
    if (!target && reveal.waited) {
      setReveal(null);
    } else if (target) {
      const keepSearch = !term || searchText(target).includes(term);
      const keepOfficial = !onlyOfficial || isOfficial(target);
      const targetTab = tab === "all" || tabOf(target, now) === tab ? tab : tabOf(target, now);
      const index = rowsFor(filtered(keepSearch ? term : "", onlyOfficial && keepOfficial), targetTab, now).findIndex(
        (event) => event.id === target.id
      );
      const needed = Math.ceil((index + 1) / PAGE) * PAGE;
      if (!keepSearch) {
        setSearch("");
      }
      if (!keepOfficial) {
        setOnlyOfficial(false);
      }
      if (targetTab !== tab) {
        setTab(targetTab);
      }
      setLimit(targetTab !== tab ? Math.max(PAGE, needed) : Math.max(limit, needed));
      setReveal({ ...reveal, ready: true });
    }
  }

  const searched = filtered(term, onlyOfficial);
  const counts = countByTab(searched, now);
  const overall = countByTab(manageableEvents, now);
  const rows = rowsFor(searched, tab, now);
  const visibleRows = rows.slice(0, limit);
  const visibleKey = visibleRows.map((event) => event.id).join(",");
  const canCreate = admin || context === null || assignments.length > 0;

  useEffect(() => {
    if (!reveal || reveal.ready || reveal.waited) {
      return;
    }
    const timer = window.setTimeout(
      () => setReveal((current) => (current && !current.ready ? { ...current, waited: true } : current)),
      1500
    );
    return () => window.clearTimeout(timer);
  }, [reveal]);

  useEffect(() => {
    if (!reveal?.ready) {
      return;
    }
    const id = reveal.id;
    return afterDialogs(() => {
      pendingRef.current = null;
      const row = listRef.current?.querySelector<HTMLElement>(`[data-event-id="${id}"]`);
      if (row) {
        row.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
        row.querySelector<HTMLElement>("[data-edit-button]")?.focus({ preventScroll: true });
        flashRow(row);
      }
      setReveal(null);
      setFlash({ id });
    });
  }, [reveal]);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || reveal || visibleKey.split(",").includes(String(pending.id))) {
      return;
    }
    return afterDialogs(() => {
      pendingRef.current = null;
      const buttons = listRef.current?.querySelectorAll<HTMLElement>("[data-edit-button]");
      const next = buttons?.length ? buttons[Math.min(pending.index, buttons.length - 1)] : null;
      (next ?? headingRef.current)?.focus();
    });
  }, [visibleKey, reveal]);

  useEffect(() => {
    const index = moreFocusRef.current;
    if (index === null) {
      return;
    }
    moreFocusRef.current = null;
    listRef.current?.querySelectorAll<HTMLElement>("[data-edit-button]")[index]?.focus();
  }, [limit]);

  function chooseTab(next: StatusTab) {
    pendingRef.current = null;
    setTab(next);
    setLimit(PAGE);
  }

  function changeSearch(value: string) {
    pendingRef.current = null;
    setSearch(value);
    setLimit(PAGE);
  }

  // os botões de limpar somem com a busca ou o filtro: o foco fica no campo de busca, que continua na tela
  function clearSearch() {
    changeSearch("");
    searchRef.current?.focus();
  }

  function clearOfficial() {
    pendingRef.current = null;
    setOnlyOfficial(false);
    setLimit(PAGE);
    searchRef.current?.focus();
  }

  /** "Ver em ..." do aviso de lista vazia: o aviso some, e o foco vai para a aba escolhida. */
  function showTab(next: StatusTab) {
    chooseTab(next);
    const index = tabs.findIndex((item) => item.id === next);
    (tabsRef.current?.querySelectorAll<HTMLElement>("button")[index] ?? tabSelectRef.current)?.focus();
  }

  function edit(event: AcademicEvent, index: number) {
    pendingRef.current = { id: event.id, index };
    onEdit(event);
  }

  function remove(event: AcademicEvent, index: number) {
    pendingRef.current = { id: event.id, index };
    onDelete(event);
  }

  function changeStatus(event: AcademicEvent, status: EventStatusChange, index: number) {
    if (saving || !onSetStatus) {
      return;
    }
    pendingRef.current = { id: event.id, index };
    onSetStatus(event, status);
  }

  function showMore() {
    moreFocusRef.current = visibleRows.length;
    setLimit((current) => current + PAGE);
  }

  function showAllOfficial() {
    pendingRef.current = null;
    setOnlyOfficial(true);
    setSearch("");
    setTab("upcoming");
    setLimit(PAGE);
    headingRef.current?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }

  if (!canWrite) {
    return (
      <section className="card pad rise flex flex-col items-start">
        <span className="empty-ico">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="h2 mt-4">Gestão docente</h2>
        <p className="sub max-w-xl">
          Seu perfil pode visualizar eventos e configurar lembretes. A criação e a alteração de eventos ficam com
          docentes e com a administração.
        </p>
      </section>
    );
  }

  const noAssignments = !admin && context !== null && assignments.length === 0;
  if (noAssignments && !manageableEvents.length) {
    return (
      <section className="card pad rise">
        <NoAssignmentsNotice heading="h2" />
      </section>
    );
  }

  const newLabel = admin ? "Novo evento oficial" : "Novo evento";
  const activeLabel = tabs.find((item) => item.id === tab)?.label ?? "";
  const otherTab = tabs.find((item) => item.id !== tab && item.id !== "all" && counts[item.id] > 0);
  const officialUpcoming = admin
    ? (allEvents ?? manageableEvents)
        .filter((event) => isOfficial(event) && tabOf(event, now) === "upcoming")
        .sort((a, b) => startTime(a) - startTime(b))
    : [];

  const statusButton = (event: AcademicEvent, index: number, asText: boolean) => {
    if (!onSetStatus) {
      return null;
    }
    const open = isOpen(event);
    const label = open ? "Concluir" : "Reativar";
    const Icon = open ? CheckCircle2 : RotateCcw;
    return (
      <button
        className={cx(
          asText ? "btn btn-s flex-1 px-3" : "ib sm",
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        )}
        aria-disabled={saving || undefined}
        aria-label={`${label} ${event.title}`}
        title={asText ? undefined : label}
        onClick={() => changeStatus(event, open ? "completed" : reactivatedStatus(event), index)}
        type="button"
      >
        <Icon className={cx("h-4 w-4", open && "text-brand")} aria-hidden />
        {asText ? label : null}
      </button>
    );
  };

  const statusPills = (event: AcademicEvent) => {
    const past = tabOf(event, now) === "past";
    const editing = editingEventId === event.id;
    const saved = flash?.id === event.id;
    return (
      <>
        {past && event.status === "scheduled" ? null : (
          <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>
        )}
        {past ? <span className="pill border border-line-strong bg-white text-ink-3">Já passou</span> : null}
        {editing ? (
          <span className="pill bg-brand-100 text-brand-ink">
            <Pencil className="h-3 w-3" aria-hidden />
            Em edição
          </span>
        ) : null}
        {saved ? (
          <span className="pill bg-brand text-white">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            Salvo agora
          </span>
        ) : null}
      </>
    );
  };

  const table = (
    <div className="overflow-x-auto overflow-y-hidden rounded-2xl border border-line">
      <table className="tbl table-fixed [&_td]:px-3 [&_th]:px-3">
        <caption className="sr-only">
          {`${activeLabel}: ${visibleRows.length} de ${rows.length} evento${rows.length === 1 ? "" : "s"}`}
        </caption>
        <colgroup>
          <col />
          <col className="w-[132px]" />
          <col className="w-[132px]" />
          <col className={onSetStatus ? "w-[152px]" : "w-[110px]"} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Evento</th>
            <th scope="col">Data</th>
            <th scope="col">Situação</th>
            <th scope="col" className="text-right">
              Ações
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((event, index) => {
            const meta = categoryMeta[event.category];
            const when = eventWhen(event.startsAt, event.endsAt);
            const editing = editingEventId === event.id;
            return (
              <tr
                key={event.id}
                data-event-id={event.id}
                data-editing={editing ? "" : undefined}
                aria-current={editing ? "true" : undefined}
                className={cx(
                  "transition-colors hover:bg-surface-2",
                  editing && "!bg-brand-50 [&>td:first-child]:shadow-[inset_3px_0_0_var(--brand)]"
                )}
              >
                <td>
                  <p
                    className={cx(
                      "t line-clamp-2 break-words",
                      event.status === "cancelled" && "text-muted line-through"
                    )}
                  >
                    {event.title}
                  </p>
                  <div className="s !mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cx("pill", meta.tint)}>{meta.short}</span>
                    {admin && isOfficial(event) ? (
                      <span className="pill prio">
                        <ShieldCheck className="h-3 w-3" aria-hidden />
                        Oficial
                      </span>
                    ) : null}
                    <span className="min-w-0 break-words">{audienceOf(event, admin)}</span>
                  </div>
                </td>
                <td>
                  <p className="whitespace-nowrap font-semibold">{when.day}</p>
                  <p className="s">{when.time}</p>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1.5">{statusPills(event)}</div>
                </td>
                <td>
                  <div className="acts">
                    <button
                      className="ib sm"
                      data-edit-button=""
                      aria-label={`Editar ${event.title}`}
                      title="Editar"
                      onClick={() => edit(event, index)}
                      type="button"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    {statusButton(event, index, false)}
                    <button
                      className="ib sm text-[#B4234A] hover:bg-[#FFF1F3]"
                      aria-label={`Excluir ${event.title}`}
                      title="Excluir"
                      onClick={() => remove(event, index)}
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const cards = (
    <ul className="grid gap-3" aria-label={`${activeLabel}: ${visibleRows.length} de ${rows.length}`}>
      {visibleRows.map((event, index) => {
        const meta = categoryMeta[event.category];
        const parts = dateParts(event.startsAt);
        const editing = editingEventId === event.id;
        return (
          <li
            key={event.id}
            data-event-id={event.id}
            data-editing={editing ? "" : undefined}
            aria-current={editing ? "true" : undefined}
            className={cx(
              "rounded-2xl border border-line bg-white p-4",
              editing && "!bg-brand-50 border-brand-200 shadow-[inset_3px_0_0_var(--brand)]"
            )}
          >
            <div className="flex items-start gap-3">
              <span className="ev-date">
                <span className="dw">{parts.weekday}</span>
                <span className="dn">{parts.day}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cx(
                    "break-words text-[15px] font-[650] leading-[1.3]",
                    event.status === "cancelled" && "text-muted line-through"
                  )}
                >
                  {event.title}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-ink-3">{eventWhenLabel(event.startsAt, event.endsAt)}</p>
                <p className="text-[13px] leading-5 text-muted">{audienceOf(event, admin)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={cx("pill", meta.tint)}>{meta.short}</span>
                  {admin && isOfficial(event) ? (
                    <span className="pill prio">
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      Oficial
                    </span>
                  ) : null}
                  {statusPills(event)}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="btn btn-s flex-1 px-3"
                data-edit-button=""
                aria-label={`Editar ${event.title}`}
                onClick={() => edit(event, index)}
                type="button"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Editar
              </button>
              {statusButton(event, index, true)}
              <button
                className="btn btn-danger flex-1 px-3"
                aria-label={`Excluir ${event.title}`}
                onClick={() => remove(event, index)}
                type="button"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Excluir
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  const emptyFiltered = (
    <div className="empty-inline !py-7">
      <span className="empty-ico">
        <SearchX className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[15px] font-bold text-ink">
        {term && !counts.all
          ? `Nada encontrado para "${search.trim()}".`
          : term
            ? `Nada em ${activeLabel} para "${search.trim()}".`
            : `Nenhum evento em ${activeLabel}.`}
      </p>
      {otherTab ? (
        <p className="max-w-sm text-[13px] leading-5 text-muted">
          {`Há ${counts[otherTab.id]} em ${otherTab.label}.`}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {otherTab ? (
          <button className="btn btn-s btn-sm" onClick={() => showTab(otherTab.id)} type="button">
            {`Ver em ${otherTab.label}`}
          </button>
        ) : null}
        {term ? (
          <button className="btn btn-s btn-sm" onClick={clearSearch} type="button">
            Limpar busca
          </button>
        ) : null}
      </div>
    </div>
  );

  const listCard = (
    <section className="card pad rise min-w-0" style={delay(0)} aria-labelledby={headingId}>
      <div className="head">
        <div className="min-w-0">
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="h2">
            {admin ? "Eventos da instituição" : "Eventos que você gerencia"}
          </h2>
          <p className="sub">{summaryLine(overall)}</p>
        </div>
        {canCreate ? (
          <button className="btn btn-p" onClick={onNewEvent} type="button">
            <Plus className="h-4 w-4" aria-hidden />
            {newLabel}
          </button>
        ) : null}
      </div>

      {manageableEvents.length ? (
        <>
          <div className="mt-5 flex flex-wrap items-end gap-3">
            {/* largura para o texto de ajuda caber inteiro; sem espaço, as abas descem para a linha de baixo */}
            <div className="relative min-w-[min(100%,18rem)] flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                ref={searchRef}
                className="input pl-10 pr-11 [&::-webkit-search-cancel-button]:hidden"
                type="search"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                placeholder="Título, disciplina ou local"
                aria-label="Buscar nos eventos"
              />
              {search ? (
                <button
                  className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-2"
                  aria-label="Limpar busca"
                  onClick={clearSearch}
                  type="button"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
            {wide ? (
              <div ref={tabsRef} className="seg flex-wrap" role="group" aria-label="Situação dos eventos">
                {tabs.map((item) => (
                  <SegmentedButton
                    key={item.id}
                    active={tab === item.id}
                    label={`${item.label} (${counts[item.id]})`}
                    onClick={() => chooseTab(item.id)}
                  />
                ))}
              </div>
            ) : (
              <label className="grid w-full gap-2">
                <span className="lbl">Situação</span>
                <select
                  ref={tabSelectRef}
                  className="input"
                  value={tab}
                  onChange={(event) => chooseTab(event.target.value as StatusTab)}
                >
                  {tabs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {`${item.label} (${counts[item.id]})`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {onlyOfficial ? (
            <div className="mt-3">
              <button
                className="chip all"
                aria-label="Somente eventos oficiais, tirar o filtro"
                onClick={clearOfficial}
                type="button"
              >
                Somente eventos oficiais
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : null}

          <div ref={listRef} className="mt-4">
            {rows.length ? (wide ? table : cards) : emptyFiltered}
          </div>

          {rows.length > visibleRows.length ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted">{`Mostrando ${visibleRows.length} de ${rows.length}`}</p>
              <button className="btn btn-s btn-sm" onClick={showMore} type="button">
                {`Mostrar mais ${Math.min(PAGE, rows.length - visibleRows.length)}`}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty-inline mt-5">
          <span className="empty-ico">
            <CalendarPlus className="h-6 w-6" aria-hidden />
          </span>
          <p className="mt-2 text-[15px] font-bold text-ink">Nenhum evento criado ainda.</p>
          <p className="max-w-sm text-[13px] leading-5 text-muted">
            {admin
              ? "Publique o primeiro evento oficial para toda a instituição."
              : "Publique a primeira prova ou trabalho para a turma."}
          </p>
          {canCreate ? (
            <button className="btn btn-p mt-3" onClick={onNewEvent} type="button">
              <Plus className="h-4 w-4" aria-hidden />
              {newLabel}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );

  const sideCard = admin ? (
    <OfficialDatesCard events={officialUpcoming} onEdit={onEdit} onNewEvent={onNewEvent} onShowAll={showAllOfficial} />
  ) : assignments.length ? (
    <AssignmentsCard assignments={assignments} events={manageableEvents} now={now} onNewEventFor={onNewEventFor} />
  ) : null;

  return (
    <div className={cx("grid items-stretch gap-5", sideCard && "min-[1400px]:grid-cols-[minmax(0,1fr)_320px]")}>
      {noAssignments ? (
        <section className="card pad rise">
          <NoAssignmentsNotice heading="h2" />
        </section>
      ) : null}
      {listCard}
      {sideCard}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card ao lado: vínculos do docente ou datas oficiais                 */
/* ------------------------------------------------------------------ */

function AssignmentsCard({
  assignments,
  events,
  now,
  onNewEventFor,
}: {
  assignments: TeachingAssignment[];
  events: AcademicEvent[];
  now: number;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
}) {
  const headingId = useId();
  return (
    <section className="card pad rise min-w-0" style={delay(1)} aria-labelledby={headingId}>
      <h2 id={headingId} className="h2">
        Disciplinas e turmas
      </h2>
      <p className="sub">Crie um evento já com a disciplina e a turma escolhidas.</p>
      <ul className="mt-4 flex flex-col gap-2">
        {assignments.map((assignment) => {
          const subject = assignment.subject?.name ?? "Disciplina";
          const className = assignment.academicClass?.name ?? "Turma";
          const ahead = events.filter(
            (event) =>
              event.academicClassId === assignment.academicClassId &&
              event.subjectId === assignment.subjectId &&
              tabOf(event, now) === "upcoming"
          ).length;
          return (
            <li key={assignment.id}>
              <button
                className="mini items-center"
                aria-label={`Novo evento de ${subject} para ${className}`}
                onClick={() => onNewEventFor(assignment.academicClassId, assignment.subjectId)}
                type="button"
              >
                <span className="mini-ico">
                  <Plus className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mini-t block break-words">{`Novo evento de ${subject}`}</span>
                  <span className="mini-s block">
                    {[
                      className,
                      assignment.academicClass?.shift,
                      ahead ? `${ahead} ${ahead === 1 ? "evento" : "eventos"} à frente` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OfficialDatesCard({
  events,
  onEdit,
  onNewEvent,
  onShowAll,
}: {
  events: AcademicEvent[];
  onEdit: (event: AcademicEvent) => void;
  onNewEvent: () => void;
  onShowAll: () => void;
}) {
  const headingId = useId();
  const shown = events.slice(0, 5);
  return (
    <section className="card pad rise min-w-0" style={delay(1)} aria-labelledby={headingId}>
      <h2 id={headingId} className="h2">
        Próximas datas oficiais
      </h2>
      <p className="sub">Aparecem para toda a instituição.</p>
      {shown.length ? (
        <ul className="mt-4 flex flex-col gap-2">
          {shown.map((event) => {
            const parts = dateParts(event.startsAt);
            return (
              <li
                key={event.id}
                className="flex items-center gap-3 rounded-[14px] border border-line-2 bg-surface-2 p-3"
              >
                <span className="ev-date bg-white">
                  <span className="dw">{parts.weekday}</span>
                  <span className="dn">{parts.day}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mini-t block break-words">{event.title}</span>
                  <span className="mini-s block">{eventWhenLabel(event.startsAt, event.endsAt)}</span>
                </span>
                <button
                  className="btn btn-s btn-sm shrink-0"
                  aria-label={`Editar ${event.title}`}
                  onClick={() => onEdit(event)}
                  type="button"
                >
                  Editar
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-inline mt-4 !py-6">
          <p className="text-[15px] font-bold text-ink">Nenhum evento oficial à frente.</p>
          <button className="btn btn-s btn-sm mt-2" onClick={onNewEvent} type="button">
            <Plus className="h-4 w-4" aria-hidden />
            Novo evento oficial
          </button>
        </div>
      )}
      {events.length > shown.length ? (
        <button className="btn btn-s btn-sm mt-3 w-full" onClick={onShowAll} type="button">
          {`Ver todos (${events.length})`}
        </button>
      ) : null}
    </section>
  );
}
