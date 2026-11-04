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
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx, dateParts, isAllDay, isSameDay } from "@/lib/format";
import { categoryMeta, showsOfficialPill, statusMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, TeachingAssignment, UserRole } from "@/lib/types";
import { calendarUpcomingCount, delay, isOfficialDate, upcomingOfficialDates } from "./dashboard-bits";
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

function mediaStore(query: string) {
  return {
    subscribe(notify: () => void) {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    read: () => window.matchMedia(query).matches,
  };
}
const onServer = () => true;
// abas em botões a partir de 1100px; abaixo, uma lista de escolha
const tabsMedia = mediaStore("(min-width: 1100px)");
// tabela de cinco colunas (Figma) a partir de 1280px. Turma, Data, Situação e Ações têm largura fixa
// (600px) e o título fica com o resto, inteiro nos títulos comuns. Abaixo disso a coluna do evento
// ficaria estreita demais, e entram os cartões, que mostram o título inteiro.
const tableMedia = mediaStore("(min-width: 1280px)");
// o card ao lado só fica ao lado da lista a partir de 1600px (a tabela fica com 916px); abaixo disso
// ele desce para depois da lista e a tabela usa a largura toda, como no Figma (1116px a 1440px)
const SIDE_COLUMNS = "min-[1600px]:grid-cols-[minmax(0,1fr)_300px]";
// respiro do card parado no alto, em cima e embaixo (o mesmo do menu)
const SIDE_ROOM = 20;
// com aviso no canto, o card parado sobe no máximo isso acima do alto da tela (o -16px do .manage-side
// no globals.css): sai só parte do respiro de cima, e o título continua à vista
const SIDE_LIFT = 16;

/**
 * O card ao lado só fica parado no alto quando cabe inteiro na tela, com o respiro em cima e embaixo
 * (o título à vista). Com aviso embaixo (room: a altura que os avisos tomam, com a folga; ver toastRoom),
 * ele também precisa caber entre SIDE_LIFT acima do alto da tela e o aviso. Se não cabe, ele rola com a
 * página, como o card de baixo, e nada clicável fica preso embaixo do aviso.
 */
function sideSticks(cardHeight: number, viewportHeight: number, room = 0) {
  if (cardHeight <= 0 || cardHeight + 2 * SIDE_ROOM > viewportHeight) {
    return false;
  }
  return cardHeight + Math.max(SIDE_ROOM, room) - SIDE_LIFT <= viewportHeight;
}

/**
 * Altura que os avisos tomam embaixo, das medidas que o ui.tsx põe no :root enquanto eles estão na tela:
 * o canto ocupado por eles (--toast-corner) e o pé que eles abrem no fim da página (--toast-foot, que no
 * fim da lista empurra o card parado para cima). Vale a maior; sem aviso, 0.
 */
function toastRoom() {
  const style = document.documentElement.style;
  return Math.max(
    parseFloat(style.getPropertyValue("--toast-corner")) || 0,
    parseFloat(style.getPropertyValue("--toast-foot")) || 0
  );
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

const startTime = (event: AcademicEvent) => new Date(event.startsAt).getTime();
const isOpen = (event: AcademicEvent) => event.status === "scheduled" || event.status === "changed";

/** Fim do evento: o término; no dia todo sem término, a meia-noite seguinte (o feriado de hoje ainda não passou). */
function endTime(event: AcademicEvent) {
  if (event.endsAt) {
    return new Date(event.endsAt).getTime();
  }
  const start = new Date(event.startsAt);
  return isAllDay(event.startsAt)
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime()
    : start.getTime();
}

function tabOf(event: AcademicEvent, now: number): Exclude<StatusTab, "all"> {
  if (event.status === "cancelled") {
    return "cancelled";
  }
  if (event.status === "completed") {
    return "completed";
  }
  return endTime(event) < now ? "past" : "upcoming";
}

/**
 * Data oficial à frente: a regra do Painel (isOfficialDate e calendarUpcomingCount, em dashboard-bits).
 * O card ao lado, o "Ver todos (N)" e o filtro da lista contam os mesmos eventos.
 */
function isOfficialAhead(event: AcademicEvent, now: number) {
  return isOfficialDate(event) && calendarUpcomingCount([event], now) > 0;
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

/** Para quem é o evento, nos cartões do celular ("Matemática, TADS 5"). */
function audienceOf(event: AcademicEvent, withTeacher: boolean) {
  return [
    event.subject?.name,
    event.academicClass?.name ?? "Toda a instituição",
    withTeacher && event.source === "teacher" ? event.teacher?.fullName : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Turno com inicial maiúscula, como no Painel da docente: "Noturno". */
function shiftLabel(shift?: string | null) {
  return shift ? shift.charAt(0).toUpperCase() + shift.slice(1) : null;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Data da linha em duas linhas curtas que cabem na coluna: "qui, 05/11" e "19:00 até 21:00" (ou "08:00 até 21/11"). */
function rowWhen(event: AcademicEvent) {
  const when = eventWhen(event.startsAt, event.endsAt);
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (when.time !== "Dia todo" && end && end.getTime() > start.getTime() && !isSameDay(start, end)) {
    return {
      day: when.day,
      time: `${pad(start.getHours())}:${pad(start.getMinutes())} até ${pad(end.getDate())}/${pad(end.getMonth() + 1)}`,
    };
  }
  return when;
}

/**
 * Quando, no card das datas oficiais, numa linha só: o dia do início já está no bloco da data.
 * "19:00 até 21:00", "08:00 até 05/11", "Dia todo" ou "17/11 a 19/11, dia todo".
 */
function sideWhen(event: AcademicEvent) {
  const when = rowWhen(event);
  return when.time === "Dia todo" && when.day.includes(" a ") ? `${when.day}, dia todo` : when.time;
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
  /** Mantido por compatibilidade: o card das datas oficiais usa a lista da Gestão, a mesma do filtro. */
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
  const wide = useSyncExternalStore(tabsMedia.subscribe, tabsMedia.read, onServer);
  const tableWide = useSyncExternalStore(tableMedia.subscribe, tableMedia.read, onServer);
  const headingId = useId();
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<StatusTab>("upcoming");
  const [search, setSearch] = useState("");
  // filtro "Próximas datas oficiais", ligado pelo "Ver todos (N)" do card ao lado
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
  // card ao lado: a altura dele vai para --side-h (o sticky do globals.css, .manage-side, usa)
  const [sideNode, setSideNode] = useState<HTMLDivElement | null>(null);
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
      (event) => (!official || isOfficialAhead(event, now)) && (!searchTerm || searchText(event).includes(searchTerm))
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
      const keepOfficial = !onlyOfficial || isOfficialAhead(target, now);
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

  // datas oficiais (administração): N conta todas as que o filtro mostra, também as canceladas e as
  // concluídas, como o "Ver todas no cronograma (N)" do Painel; o card lista as mesmas do Painel
  // (upcomingOfficialDates: abertas, com algum dia de hoje em diante, a em andamento inclusive)
  const officialDates = admin ? manageableEvents.filter(isOfficialDate) : [];
  const officialTotal = admin ? calendarUpcomingCount(officialDates, now) : 0;
  const officialSoon = admin ? upcomingOfficialDates(manageableEvents, now) : [];

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

  // o card ao lado fica parado no alto só quando cabe na tela (data-stick, que o sticky do globals.css,
  // .manage-side, usa); mais alto que a tela, ele rola com a página e o título não some. A altura dele
  // vai para --side-h: com aviso no canto, o card parado sobe para deixar o espaço do aviso. Quando nem
  // assim ele cabe, ele rola com a página enquanto houver aviso e volta a ficar parado quando o aviso sai
  useLayoutEffect(() => {
    if (!sideNode) {
      return;
    }
    const update = () => {
      const height = sideNode.offsetHeight;
      sideNode.style.setProperty("--side-h", `${height}px`);
      const stick = sideSticks(height, window.innerHeight, toastRoom());
      if (stick === sideNode.hasAttribute("data-stick")) {
        return;
      }
      // ao prender ou soltar, o card desliza de onde está até o lugar novo, sem pular
      const from = sideNode.getBoundingClientRect().top;
      sideNode.toggleAttribute("data-stick", stick);
      const shift = from - sideNode.getBoundingClientRect().top;
      if (Math.abs(shift) >= 1 && !reducedMotion()) {
        sideNode.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], {
          duration: 200,
          easing: "ease",
        });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sideNode);
    // os avisos põem e tiram o --toast-corner e o --toast-foot no style do :root (ui.tsx)
    const toasts = new MutationObserver(update);
    toasts.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      toasts.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [sideNode]);

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

  /** "Ver todos (N)" do card ao lado: a lista mostra as N datas de uma vez, em Todos (com as canceladas). */
  function showAllOfficial() {
    pendingRef.current = null;
    setOnlyOfficial(true);
    setSearch("");
    setTab("all");
    setLimit(Math.max(PAGE, officialTotal));
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

  const savedPill = (
    <span className="pill bg-brand text-white">
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Salvo agora
    </span>
  );
  const editingPill = (
    <span className="pill bg-brand-100 text-brand-ink">
      <Pencil className="h-3 w-3" aria-hidden />
      Em edição
    </span>
  );
  const officialPill = (
    <span className="pill prio shrink-0">
      <ShieldCheck className="h-3 w-3" aria-hidden />
      Oficial
    </span>
  );

  // cartões (celular): todas as pílulas, que quebram linha
  const statusPills = (event: AcademicEvent) => {
    const past = tabOf(event, now) === "past";
    return (
      <>
        {past && event.status === "scheduled" ? null : (
          <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>
        )}
        {past ? <span className="pill stat">Já passou</span> : null}
        {editingEventId === event.id ? editingPill : null}
        {flash?.id === event.id ? savedPill : null}
      </>
    );
  };

  // tabela: uma pílula por linha, para as linhas terem a mesma altura. "Salvo agora" logo depois de
  // salvar, "Em edição" com o painel aberto (que mostra a situação no cabeçalho) e, no mais, a situação
  const situationPill = (event: AcademicEvent) => {
    if (flash?.id === event.id) {
      return savedPill;
    }
    if (editingEventId === event.id) {
      return editingPill;
    }
    if (tabOf(event, now) === "past") {
      return <span className="pill stat">Já passou</span>;
    }
    return <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>;
  };

  // segunda linha do evento na tabela (Figma: "Prova  10 pts"); na administração, quem publicou
  const rowDetail = (event: AcademicEvent) =>
    [
      admin && event.source === "teacher" ? event.teacher?.fullName : null,
      event.points !== null ? `${event.points.toLocaleString("pt-BR")} pts` : admin ? null : "sem pontuação",
    ]
      .filter(Boolean)
      .join(", ");

  // Figma (Gestão de eventos): Evento | Turma, disciplina | Data | Situação | Ações, rente às bordas do card.
  // Cada célula tem um número fixo de linhas e corta com reticências: todas as linhas ficam da mesma altura.
  // Só o Evento estica: Turma, disciplina (160px de texto, "Engenharia de Software" inteira), Data
  // ("08:00 até 05/11"), Situação ("Salvo agora") e Ações (os botões, 6px depois da situação) são fixas.
  // O título do evento vai até duas linhas (com o card ao lado, a partir de 1600px, o texto tem 278px).
  // Toda linha tem 80px: cabem o título em duas linhas (20px cada), 4px e a linha da pílula (24px),
  // com 5px de folga em cima e embaixo; o resto das células fica centrado nela, como antes.
  const table = (
    <div className="overflow-x-auto overflow-y-hidden border-t border-line">
      <table className="tbl table-fixed [&_td]:px-3 [&_td]:py-[5px] [&_td:first-child]:pl-6 [&_td:last-child]:pl-1.5 [&_td:last-child]:pr-6 [&_th]:px-3 [&_th:first-child]:pl-6 [&_th:last-child]:pl-1.5 [&_th:last-child]:pr-6">
        <caption className="sr-only">
          {`${activeLabel}: ${visibleRows.length} de ${rows.length} evento${rows.length === 1 ? "" : "s"}`}
        </caption>
        <colgroup>
          <col />
          <col className="w-[184px]" />
          <col className="w-[128px]" />
          <col className="w-[132px]" />
          <col className={onSetStatus ? "w-[156px] pointer-coarse:w-[174px]" : "w-[112px] pointer-coarse:w-[124px]"} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Evento</th>
            <th scope="col">Turma, disciplina</th>
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
            const when = rowWhen(event);
            const editing = editingEventId === event.id;
            const cancelled = event.status === "cancelled";
            const closed = cancelled || event.status === "completed";
            const classLabel = event.academicClass?.name ?? "Toda a instituição";
            const subject = event.subject?.name;
            const detail = rowDetail(event);
            return (
              <tr
                key={event.id}
                data-event-id={event.id}
                data-editing={editing ? "" : undefined}
                aria-current={editing ? "true" : undefined}
                className={cx(
                  "h-20 transition-colors hover:bg-surface-2",
                  // concluído e cancelado ficam no fundo cinza, como no Figma
                  closed && "bg-surface-2",
                  editing && "!bg-brand-50 [&>td:first-child]:shadow-[inset_3px_0_0_var(--brand)]"
                )}
              >
                <td>
                  <p className={cx("t line-clamp-2 break-words leading-5", closed && "text-ink-3")} title={event.title}>
                    {event.title}
                  </p>
                  <div className="s !mt-1 flex items-center gap-2 overflow-hidden whitespace-nowrap">
                    <span className={cx("pill shrink-0", meta.tint)}>{meta.short}</span>
                    {admin && showsOfficialPill(event) ? officialPill : null}
                    {detail ? <span className="min-w-0 truncate">{detail}</span> : null}
                  </div>
                </td>
                {/* duas linhas curtas, como a Data: a turma em cima e a disciplina embaixo */}
                <td className={cx(closed && "text-muted")}>
                  <p className="truncate" title={classLabel}>
                    {classLabel}
                  </p>
                  {subject ? (
                    <p className="s truncate" title={subject}>
                      {subject}
                    </p>
                  ) : null}
                </td>
                <td className={cx(closed && "text-muted")}>
                  <p className={cx("truncate font-semibold", cancelled && "line-through")}>{when.day}</p>
                  <p className={cx("s truncate", cancelled && "line-through")}>{when.time}</p>
                </td>
                <td>
                  <div className="flex">{situationPill(event)}</div>
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

  // coluna presa à largura do card (grid-cols-1): título, local ou nome comprido sem espaço quebram
  // dentro do cartão em vez de alargá-lo
  const cards = (
    <ul className="grid grid-cols-1 gap-3" aria-label={`${activeLabel}: ${visibleRows.length} de ${rows.length}`}>
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
                    "text-[15px] font-[650] leading-[1.3] wrap-anywhere",
                    event.status === "cancelled" && "text-muted line-through"
                  )}
                >
                  {event.title}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-ink-3">{eventWhenLabel(event.startsAt, event.endsAt)}</p>
                <p className="text-[13px] leading-5 text-muted wrap-anywhere">{audienceOf(event, admin)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={cx("pill", meta.tint)}>{meta.short}</span>
                  {admin && showsOfficialPill(event) ? officialPill : null}
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
      <p className="mt-2 text-[15px] font-bold text-ink wrap-anywhere">
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

  // a tabela fica rente às bordas do card, como no Figma; cabeçalho, cartões e rodapé têm o respiro do card
  const listCard = (
    <section className="card rise min-w-0 overflow-hidden" style={delay(0)} aria-labelledby={headingId}>
      <div className={cx("px-6 pt-6", manageableEvents.length ? "pb-5" : "pb-6")}>
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
                  aria-label="Próximas datas oficiais, tirar o filtro"
                  onClick={clearOfficial}
                  type="button"
                >
                  Próximas datas oficiais
                  <X className="h-3.5 w-3.5" aria-hidden />
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
      </div>

      {manageableEvents.length ? (
        <>
          <div ref={listRef}>
            {rows.length ? (
              tableWide ? (
                table
              ) : (
                <div className="px-6 pb-6">{cards}</div>
              )
            ) : (
              <div className="px-6 pb-6">{emptyFiltered}</div>
            )}
          </div>

          {rows.length > visibleRows.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 px-6 py-4">
              <p className="text-[13px] text-muted">{`Mostrando ${visibleRows.length} de ${rows.length}`}</p>
              <button className="btn btn-s btn-sm" onClick={showMore} type="button">
                {`Mostrar mais ${Math.min(PAGE, rows.length - visibleRows.length)}`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );

  const sideCard = admin ? (
    <OfficialDatesCard
      events={officialSoon}
      total={officialTotal}
      onEdit={onEdit}
      onNewEvent={onNewEvent}
      onShowAll={showAllOfficial}
    />
  ) : assignments.length ? (
    <AssignmentsCard assignments={assignments} events={manageableEvents} now={now} onNewEventFor={onNewEventFor} />
  ) : null;

  // lado a lado a partir de 1600px: cada card tem a altura do conteúdo (nada de coluna branca até o fim)
  // e o de lado fica parado no alto enquanto a lista rola, se couber na tela. Abaixo disso, o card desce
  // para depois da lista, e a tabela usa a largura toda, como no Figma. Com aviso embaixo, o fim da
  // página ganha a altura dele (o pé do #conteudo, growToastFoot no ui.tsx): rolando até o fim, nada
  // clicável fica embaixo do aviso.
  return (
    <div className={cx("manage-view grid items-start gap-5", sideCard && SIDE_COLUMNS)}>
      {noAssignments ? (
        <section className="card pad rise">
          <NoAssignmentsNotice heading="h2" />
        </section>
      ) : null}
      {listCard}
      {sideCard ? (
        <div ref={setSideNode} className="manage-side min-w-0">
          {sideCard}
        </div>
      ) : null}
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
      <ul className="manage-side-list">
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
                className="mini h-full items-center"
                aria-label={`Novo evento de ${subject} para ${className}`}
                onClick={() => onNewEventFor(assignment.academicClassId, assignment.subjectId)}
                type="button"
              >
                <span className="mini-ico">
                  <Plus className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mini-t block wrap-anywhere">{`Novo evento de ${subject}`}</span>
                  <span className="mini-s block wrap-anywhere">
                    {[
                      className,
                      shiftLabel(assignment.academicClass?.shift),
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

/**
 * Datas oficiais à frente (administração): as abertas com algum dia de hoje em diante, como no Painel.
 * O "Ver todos (N)" aparece quando o filtro da lista mostra mais (N conta também as canceladas e as concluídas).
 */
function OfficialDatesCard({
  events,
  total,
  onEdit,
  onNewEvent,
  onShowAll,
}: {
  events: AcademicEvent[];
  total: number;
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
      {/* vale para todas: a data pode ser de uma turma só, e a linha diz para quem é */}
      <p className="sub">Feriados, recessos e eventos institucionais.</p>
      {shown.length ? (
        <ul className="manage-side-list">
          {shown.map((event) => {
            const parts = dateParts(event.startsAt);
            const audience = event.academicClass?.name ?? "Toda a instituição";
            // a linha inteira abre o painel de edição: o texto fica com a largura toda do item
            // (título em até duas linhas, quando e para quem em uma cada) e o lápis só indica a ação
            return (
              <li key={event.id}>
                <button
                  className="mini h-full items-center"
                  aria-label={`Editar ${event.title}, ${eventWhenLabel(event.startsAt, event.endsAt)}, ${event.academicClass?.name ?? "toda a instituição"}`}
                  onClick={() => onEdit(event)}
                  type="button"
                >
                  <span className="ev-date bg-white">
                    <span className="dw">{parts.weekday}</span>
                    <span className="dn">{parts.day}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mini-t line-clamp-2 wrap-anywhere">{event.title}</span>
                    <span className="mini-s block truncate">{sideWhen(event)}</span>
                    <span className="mini-s !mt-0 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">{audience}</span>
                      <Pencil className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-inline mt-4 !py-6">
          <p className="text-[15px] font-bold text-ink">Nenhuma data oficial à frente.</p>
          <button className="btn btn-s btn-sm mt-2" onClick={onNewEvent} type="button">
            <Plus className="h-4 w-4" aria-hidden />
            Novo evento oficial
          </button>
        </div>
      )}
      {shown.length > 0 && total > shown.length ? (
        <button className="btn btn-s btn-sm mt-3 w-full" onClick={onShowAll} type="button">
          {`Ver todos (${total})`}
        </button>
      ) : null}
    </section>
  );
}
