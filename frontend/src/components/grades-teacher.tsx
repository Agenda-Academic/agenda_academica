"use client";

import {
  CalendarDays,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileClock,
  Lock,
  Search,
  Users,
  X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getEventGrades, getGradeImports } from "@/lib/api";
import {
  countText,
  cx,
  dateParts,
  formatDateBR,
  errorMessage,
  formatShortDate,
  formatTime,
  isAllDay,
  matchesSearch,
  monthGroupLabel,
  relativeDue,
  startOfDay,
} from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, UserRole } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { eventLastDay } from "./event-bits";
import { activeAssignments } from "./event-editor";
import { launchedCount, subscribeGradesChanged } from "./event-grades-drawer";
import { Pager, usePaged } from "./pager";
import { Select, type SelectOption } from "./select";
import { EmptyState, secondaryButton } from "./ui";

/**
 * Tela Notas da docente e da administração (desenho 5.7): as avaliações (prova e trabalho de turma) que a
 * pessoa gerencia, com a situação de cada uma (gradesPublishedAt: "Notas ocultas" ou publicadas) e a ação
 * "Abrir notas", que abre a gaveta da avaliação (onOpenGrades, a mesma da Gestão). Renderizada por grades-view.tsx.
 *
 * Rodada de UX de 2026-11-17: a lista não expande mais no lugar ("Ver todas" virava uma rolagem sem fim). Ela
 * mostra 8 avaliações por página (pager.tsx), agrupadas por mês, com a aba "Pendentes" (as que já aconteceram e
 * ainda não têm notas publicadas) na frente, e filtros por turma e disciplina quando há mais de uma.
 *
 * Rodada 10 (visual Pantanal): sem cabeçalho de página. A tela começa pela barra de abas e filtros; o título e o
 * resumo ficam só para o leitor de tela (o nome da tela já está no trilho).
 * Dona: área Notas (docente).
 */
export type GradesTeacherProps = {
  role: UserRole;
  context: AcademicContext | null;
  /** Avaliações que a pessoa gerencia (só prova e trabalho de turma), em ordem de data. */
  events: AcademicEvent[];
  /** Texto da busca do menu. */
  search: string;
  /** Avaliação a destacar ao abrir (?tela=notas&evento=). */
  focusEventId: number | null;
  /** Abre a gaveta de notas da avaliação (EventGradesDrawer). */
  onOpenGrades: (eventId: number) => void;
  /** Abre o detalhe do evento no Cronograma. */
  onOpenEvent: (eventId: number) => void;
  /** Quantas avaliações a busca do menu acha nesta tela (undefined sem busca). */
  onSearchCount?: (count: number | undefined) => void;
  /** Apaga a busca do menu. */
  onClearSearch?: () => void;
};

/** Situação das notas de uma avaliação (GET /events/:id/grades e as importações dela). */
type Summary =
  | { ok: true; publishedAt: string | null; students: number; launched: number; drafts: number }
  | { ok: false; message: string; forbidden: boolean };

type Tab = "pending" | "past" | "next" | "all";

/** Avaliações por página. */
const PAGE_SIZE = 8;
/** Avaliações cuja situação carrega ao mesmo tempo (só as da página à vista). */
const PARALLEL = 6;

async function loadSummary(token: string, eventId: number): Promise<Summary> {
  try {
    const [grades, imports] = await Promise.all([getEventGrades(token, eventId), getGradeImports(token, eventId)]);
    return {
      ok: true,
      publishedAt: grades.event.gradesPublishedAt,
      students: grades.counts.students,
      launched: launchedCount(grades.counts),
      drafts: imports.filter((item) => item.status === "draft").length,
    };
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    return { ok: false, message: errorMessage(error), forbidden: status === 403 || status === 404 };
  }
}

/**
 * A docente lança nota só nas ofertas dela (api.md, fase 3): turma e disciplina com vínculo em vigor; prova ou
 * trabalho sem disciplina, só a autora. Turma arquivada fica na lista (só leitura) para quem criou a avaliação.
 * A administração vê todas.
 */
function inMyOffers(event: AcademicEvent, role: UserRole, userId: number, context: AcademicContext | null) {
  if (role === "admin") return true;
  if (role !== "teacher" || event.academicClassId === null) return false;
  const assignments = (context?.teachingAssignments ?? []).filter(
    (item) => item.teacherId === userId && !item.endedAt && item.academicClassId === event.academicClassId
  );
  const archivedOwn = Boolean(event.academicClass?.archivedAt) && event.teacherId === userId;
  if (event.subjectId !== null) {
    return assignments.some((item) => item.subjectId === event.subjectId) || archivedOwn;
  }
  return event.teacherId === userId && (assignments.length > 0 || archivedOwn);
}

const byStartAsc = (a: AcademicEvent, b: AcademicEvent) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
const byStartDesc = (a: AcademicEvent, b: AcademicEvent) => byStartAsc(b, a);

/** Turma e disciplina da avaliação: a chave do filtro e o nome dele ("TADS 5, Matemática"). */
function offerOf(event: AcademicEvent) {
  return {
    key: `${event.academicClassId ?? 0}-${event.subjectId ?? 0}`,
    className: event.academicClass?.name ?? "Sem turma",
    subjectName: event.subject?.name ?? "Sem disciplina",
  };
}

/** "Novembro" no ano corrente; "Dezembro de 2025" em outro ano (o mesmo cabeçalho de mês da Gestão e do Cronograma). */
function monthHeading(value: string, now: number) {
  return monthGroupLabel(value, new Date(now));
}

/** Aspas curvas em volta do texto da busca. */
const quoted = (value: string) => `“${value}”`;

export function GradesTeacher({
  context,
  events,
  focusEventId,
  onOpenEvent,
  onClearSearch,
  onOpenGrades,
  onSearchCount,
  role,
  search,
}: GradesTeacherProps) {
  const { loading, navigate, token, user } = useAppActions();
  const [now] = useState(() => Date.now());
  // null: a aba escolhida pela tela (a da avaliação destacada, "Pendentes" quando há, ou "Passadas")
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  // turma e disciplina escolhidas no filtro (null: todas)
  const [offer, setOffer] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState(focusEventId);
  // a página da avaliação destacada já foi aberta para este pedido e esta aba
  const [placedFocus, setPlacedFocus] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<number, Summary>>({});
  // avaliações abertas na gaveta nesta aba e página: continuam na lista de Pendentes mesmo depois de publicadas
  // (com a etiqueta "Publicadas"), para a linha e o botão de onde a gaveta abriu não sumirem; saem ao trocar de
  // aba, filtro, busca ou página
  const [kept, setKept] = useState<{ key: string; ids: number[] }>({ key: "", ids: [] });
  const inflight = useRef(new Set<number>());
  const versions = useRef(new Map<number, number>());
  const listRef = useRef<HTMLDivElement>(null);

  // avaliação nova pedida pelo endereço (?tela=notas&evento=): a aba, o filtro e a página se ajustam a ela
  if (seenFocus !== focusEventId) {
    setSeenFocus(focusEventId);
    setChosenTab(null);
    setOffer(null);
    setPlacedFocus(null);
  }

  const mine = useMemo(() => events.filter((event) => inMyOffers(event, role, user.id, context)), [context, events, role, user.id]);
  const matched = useMemo(() => mine.filter((event) => matchesSearch(event, search)), [mine, search]);
  // a avaliação pedida pelo endereço (?tela=notas&evento=) aparece mesmo que a busca do menu a esconda, destacada
  // e com o aviso de que a busca esconde as outras
  const forced = useMemo(
    () =>
      focusEventId !== null && !matched.some((event) => event.id === focusEventId)
        ? (mine.find((event) => event.id === focusEventId) ?? null)
        : null,
    [focusEventId, matched, mine]
  );
  const found = useMemo(() => (forced ? [...matched, forced] : matched), [forced, matched]);

  // filtros de turma e disciplina: só quando a pessoa tem mais de uma. As opções vêm de todas; a contagem de cada
  // uma segue a busca e a aba de situação aberta (como as categorias do Cronograma), e é feita mais abaixo
  const offerOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string }>();
    const classes = new Set(mine.map((event) => event.academicClassId ?? 0));
    for (const event of mine) {
      const item = offerOf(event);
      if (!map.has(item.key)) {
        map.set(item.key, { key: item.key, label: classes.size > 1 ? `${item.className}, ${item.subjectName}` : item.subjectName });
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [mine]);
  const multiClass = new Set(mine.map((event) => event.academicClassId ?? 0)).size > 1;
  const activeOffer = offer && offerOptions.some((item) => item.key === offer) ? offer : null;
  const filtered = useMemo(
    () => (activeOffer ? found.filter((event) => offerOf(event).key === activeOffer) : found),
    [activeOffer, found]
  );

  /** Notas publicadas: a situação carregada vale mais que a lista de eventos (que só atualiza no próximo carregamento). */
  const isPublished = (event: AcademicEvent) => {
    const summary = summaries[event.id];
    return summary?.ok ? Boolean(summary.publishedAt) : Boolean(event.gradesPublishedAt);
  };
  // já começou: a situação das notas carrega e a linha deixa de dizer "Agendada" (a prova de hoje à noite já
  // pode receber nota)
  const happened = (event: AcademicEvent) => new Date(event.startsAt).getTime() <= now;
  // Passadas e Próximas com a regra do Cronograma e da Gestão: passou o último dia do evento (a de hoje
  // continua em Próximas até a meia-noite)
  const todayStart = startOfDay(new Date(now)).getTime();
  const isPast = (event: AcademicEvent) => eventLastDay(event).getTime() < todayStart;

  const cancelled = (event: AcademicEvent) => event.status === "cancelled";
  const past = filtered.filter(isPast).sort(byStartDesc);
  // Próximas: só o que vai acontecer (a cancelada continua em Todas, com a etiqueta "Cancelada")
  const upcoming = filtered.filter((event) => !isPast(event) && !cancelled(event)).sort(byStartAsc);
  const baseKey = `${search.trim()}|${activeOffer ?? ""}`;
  const keptIds = kept.key.startsWith(`pending|${baseKey}|`) ? kept.ids : [];
  const pending = past.filter((event) => !cancelled(event) && (!isPublished(event) || keptIds.includes(event.id)));
  // o número da aba e do subtítulo conta só as que ainda esperam publicação
  const pendingCount = pending.filter((event) => !isPublished(event)).length;
  // Todas: em ordem de data, abrindo na página de hoje (as anteriores ficam em "Anterior")
  const all = [...filtered].sort(byStartAsc);

  // a busca do menu conta as avaliações achadas aqui (sem a pedida pelo endereço)
  const searchCount = search.trim() ? matched.length : undefined;
  useEffect(() => {
    onSearchCount?.(searchCount);
  }, [onSearchCount, searchCount]);

  let autoTab: Tab = pending.length ? "pending" : past.length ? "past" : "next";
  if (focusEventId !== null) {
    if (upcoming.some((event) => event.id === focusEventId)) autoTab = "next";
    else if (pending.some((event) => event.id === focusEventId)) autoTab = "pending";
    else if (past.some((event) => event.id === focusEventId)) autoTab = "past";
    else if (filtered.some((event) => event.id === focusEventId)) autoTab = "all";
  }
  const tab = chosenTab ?? autoTab;
  const list = tab === "pending" ? pending : tab === "past" ? past : tab === "next" ? upcoming : all;

  // contagem do filtro de turma e disciplina dentro da aba aberta: "Todas as disciplinas 2" com 2 linhas em
  // Passadas, e cada disciplina com o que ela teria nessa aba (a regra da aba é a mesma das listas acima)
  const inTab = (event: AcademicEvent) => {
    if (tab === "pending") return isPast(event) && !cancelled(event) && (!isPublished(event) || keptIds.includes(event.id));
    if (tab === "past") return isPast(event);
    if (tab === "next") return !isPast(event) && !cancelled(event);
    return true;
  };
  const tabFound = found.filter(inTab);
  const offers = offerOptions.map((item) => ({
    ...item,
    count: tabFound.filter((event) => offerOf(event).key === item.key).length,
  }));

  const listKey = `${tab}|${baseKey}`;
  const paged = usePaged(list, PAGE_SIZE, listKey);
  // trocou de aba, filtro, busca ou página: as publicadas nesta visita saem de Pendentes
  const pageKey = `${listKey}|${paged.page}`;
  if (kept.ids.length && kept.key !== pageKey) {
    setKept({ key: "", ids: [] });
  }
  // a lista abre na página da avaliação destacada; em Todas, sem destaque, na página da próxima avaliação
  // (uma vez por pedido, aba, filtro e busca)
  let anchorIndex = focusEventId === null ? -1 : list.findIndex((event) => event.id === focusEventId);
  if (anchorIndex < 0 && tab === "all" && list.length) {
    const nextIndex = list.findIndex((event) => !isPast(event));
    anchorIndex = nextIndex < 0 ? list.length - 1 : nextIndex;
  }
  const anchorKey = `${focusEventId}|${listKey}`;
  if (anchorIndex >= 0 && placedFocus !== anchorKey) {
    setPlacedFocus(anchorKey);
    const target = Math.floor(anchorIndex / PAGE_SIZE) + 1;
    if (target !== paged.page) paged.setPage(target);
  }
  const shown = paged.items;
  // a situação só carrega para as que já aconteceram (as futuras mostram "Agendada")
  const loadKey = shown
    .filter((event) => happened(event) && !cancelled(event))
    .map((event) => event.id)
    .join(",");

  /** Tira a situação guardada da avaliação: ela carrega de novo (a que está carregando é ignorada). */
  function forget(eventId: number) {
    versions.current.set(eventId, (versions.current.get(eventId) ?? 0) + 1);
    setSummaries((current) => {
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  }

  // a situação de cada avaliação da página, algumas por vez
  useEffect(() => {
    const ids = loadKey ? loadKey.split(",").map(Number) : [];
    const waiting = ids.filter((id) => !(id in summaries) && !inflight.current.has(id));
    const room = Math.max(0, PARALLEL - inflight.current.size);
    for (const id of waiting.slice(0, room)) {
      inflight.current.add(id);
      const version = versions.current.get(id) ?? 0;
      void loadSummary(token, id).then((summary) => {
        inflight.current.delete(id);
        if ((versions.current.get(id) ?? 0) !== version) {
          // mudou enquanto carregava: carrega de novo
          setSummaries((current) => ({ ...current }));
          return;
        }
        setSummaries((current) => ({ ...current, [id]: summary }));
      });
    }
  }, [loadKey, summaries, token]);

  // a gaveta mudou notas, importação ou publicação: a situação daquela avaliação carrega de novo
  useEffect(() => {
    const timers = new Map<number, number>();
    const unsubscribe = subscribeGradesChanged((eventId) => {
      window.clearTimeout(timers.get(eventId));
      timers.set(
        eventId,
        window.setTimeout(() => {
          timers.delete(eventId);
          versions.current.set(eventId, (versions.current.get(eventId) ?? 0) + 1);
          setSummaries((current) => {
            if (!(eventId in current)) return { ...current };
            const next = { ...current };
            delete next[eventId];
            return next;
          });
        }, 600)
      );
    });
    return () => {
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  // a avaliação destacada (aviso, link) fica à vista
  useEffect(() => {
    if (focusEventId === null || loading) return;
    document
      .querySelector<HTMLElement>(`[data-grades-event="${focusEventId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusEventId, loading, tab, paged.page]);

  const admin = role === "admin";
  const term = search.trim();
  const searching = term.length > 0;
  // docente sem vínculo em vigor (como a Gestão e o painel do evento contam): não tem para quem criar avaliação
  const noClass = role === "teacher" && context !== null && activeAssignments(context).length === 0;

  /** "Limpar busca": apaga a busca do menu e devolve o foco para a avaliação destacada (ou para o título). */
  function clearMenuSearch() {
    onClearSearch?.();
    const eventId = focusEventId;
    window.requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>(`[data-grades-event="${eventId}"] [data-grades-open]`) ??
        document.getElementById("notas-docente-titulo");
      if (target && !target.matches("button")) target.setAttribute("tabindex", "-1");
      target?.focus({ preventScroll: true });
    });
  }

  /** "Ver todas as disciplinas": tira o filtro; o botão some, então o foco vai para o título do card. */
  function showAllOffers() {
    setOffer(null);
    window.requestAnimationFrame(() => {
      const title = document.getElementById("notas-docente-titulo");
      title?.setAttribute("tabindex", "-1");
      title?.focus({ preventScroll: true });
    });
  }

  function pickTab(next: Tab) {
    setChosenTab(next);
  }

  /**
   * Abre a gaveta de notas a partir de uma linha. A aba fica fixa (sem isso, publicar a última pendente trocava
   * a aba sozinha por trás da gaveta) e a linha continua na lista até trocar de aba ou de página, para o foco
   * voltar ao botão "Abrir notas" quando a gaveta fecha.
   */
  function openRow(eventId: number) {
    setChosenTab(tab);
    setKept((current) => ({
      key: pageKey,
      ids: current.key === pageKey ? [...current.ids.filter((id) => id !== eventId), eventId] : [eventId],
    }));
    onOpenGrades(eventId);
  }

  let subtitle: string;
  if (!mine.length || (searching && !matched.length)) {
    // sem resultado na busca, o vazio logo abaixo já diz o que aconteceu
    subtitle = admin ? "Provas e trabalhos de todas as turmas" : "Provas e trabalhos das suas disciplinas";
  } else if (searching) {
    subtitle = `${countText(matched.length, "avaliação", "avaliações")} com ${quoted(term)}`;
  } else if (pendingCount) {
    subtitle = `${countText(pendingCount, "avaliação já aconteceu e espera", "avaliações já aconteceram e esperam")} notas publicadas`;
  } else {
    subtitle = past.length ? "As notas de todas as avaliações que já aconteceram estão publicadas" : "Nenhuma avaliação aconteceu ainda";
  }

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    // a ordem das abas de tempo de todas as telas (Próximas, Passadas, Todas), depois da que pede ação
    { id: "pending", label: "Pendentes", count: pendingCount },
    { id: "next", label: "Próximas", count: upcoming.length },
    { id: "past", label: "Passadas", count: past.length },
    { id: "all", label: "Todas", count: filtered.length },
  ];
  const tabName = tabs.find((item) => item.id === tab)?.label ?? "";
  // o filtro de turma e disciplina esconde parte do que a aba tem (com ou sem busca): a tela diz quantas e oferece
  // mostrar todas (decisão 14)
  const hiddenByOffer = activeOffer ? Math.max(0, tabFound.length - list.length) : 0;
  const offerLabel = offerOptions.find((item) => item.key === activeOffer)?.label ?? "";
  const offerFilterName = multiClass ? "filtro de turma e disciplina" : "filtro de disciplina";
  const showAllOffersLabel = multiClass ? "Ver todas as turmas" : "Ver todas as disciplinas";
  const hiddenText = `${hiddenByOffer} ${hiddenByOffer === 1 ? "escondida" : "escondidas"} pelo ${offerFilterName}`;

  let content;
  if (loading && !events.length) {
    content = <ListSkeleton />;
  } else if (!mine.length && noClass) {
    // docente sem turma: a Gestão também não deixa criar avaliação, então o próximo passo é pedir o vínculo
    content = (
      <div className="p-6 max-sm:p-4">
        <EmptyState
          icon={Users}
          text="Você ainda não tem turmas vinculadas"
          hint="Peça à administração o vínculo com uma turma e uma disciplina. Depois disso, as provas e os trabalhos que você criar aparecem aqui para lançar, importar e publicar as notas."
        />
      </div>
    );
  } else if (!mine.length) {
    content = (
      <div className="p-6 max-sm:p-4">
        <EmptyState
          icon={ClipboardCheck}
          text={admin ? "Nenhuma prova ou trabalho de turma" : "Nenhuma prova ou trabalho nas suas disciplinas"}
          hint="Crie uma prova ou um trabalho de turma na Gestão. Ele aparece aqui para lançar, importar e publicar as notas."
          action={{ label: "Ir para a Gestão", onClick: () => navigate("manage") }}
        />
      </div>
    );
  } else if (!found.length) {
    content = (
      <div className="p-6 max-sm:p-4">
        <EmptyState
          icon={Search}
          text={`Nenhuma avaliação com ${quoted(term)}`}
          hint="Confira o texto da busca ou limpe a busca para ver todas as avaliações."
          action={onClearSearch ? { label: "Limpar busca", onClick: clearMenuSearch } : undefined}
        />
      </div>
    );
  } else if (!list.length && hiddenByOffer) {
    // a aba ficou vazia só por causa do filtro: o vazio diz isso (e a busca, quando há), com o caminho de volta
    content = (
      <div className="p-6 max-sm:p-4" role="status">
        <div className="empty-inline compact">
          <span className="empty-ico">
            <Search aria-hidden />
          </span>
          <div className="empty-body">
            <p className="empty-t">
              {searching
                ? `Nenhuma avaliação de ${offerLabel} com ${quoted(term)} em ${tabName}`
                : `Nenhuma avaliação de ${offerLabel} em ${tabName}`}
            </p>
            <p className="empty-s">{`${hiddenText}.`}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={cx(secondaryButton, "btn-sm")} onClick={showAllOffers} type="button">
                {showAllOffersLabel}
              </button>
              {searching && onClearSearch ? (
                <button className="btn btn-g btn-sm" onClick={clearMenuSearch} type="button">
                  <X className="h-4 w-4" aria-hidden />
                  Limpar busca
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  } else if (!list.length) {
    let empty: { icon: typeof ClipboardCheck; text: string; hint: string; action?: { label: string; onClick: () => void } };
    if (tab === "pending") {
      empty = {
        icon: CircleCheck,
        text: "Tudo em dia",
        // o subtítulo do card já diz que tudo está publicado: aqui, o que vem depois (sem repetir a frase)
        hint: "Depois de cada prova ou entrega de trabalho, a avaliação aparece aqui até as notas serem publicadas.",
        action: past.length ? { label: `Ver passadas (${past.length})`, onClick: () => pickTab("past") } : undefined,
      };
    } else if (tab === "past") {
      empty = {
        icon: ClipboardCheck,
        text: "Nenhuma avaliação aconteceu ainda",
        hint: "As notas entram depois da prova ou da entrega do trabalho.",
        action: upcoming.length ? { label: `Ver próximas (${upcoming.length})`, onClick: () => pickTab("next") } : undefined,
      };
    } else {
      empty = {
        icon: CalendarDays,
        text: "Nenhuma avaliação pela frente",
        hint: "As próximas provas e trabalhos aparecem aqui. Crie novas na Gestão.",
        action: past.length ? { label: `Ver passadas (${past.length})`, onClick: () => pickTab("past") } : undefined,
      };
    }
    content = (
      <div className="p-6 max-sm:p-4">
        <EmptyState compact icon={empty.icon} text={empty.text} hint={empty.hint} action={empty.action} />
      </div>
    );
  } else {
    // a página agrupada por mês: o cabeçalho aparece no começo da página e a cada mês novo. Como na Gestão, ele diz
    // quantas avaliações o mês tem na lista toda (não só nesta página)
    const monthKey = (event: AcademicEvent) => {
      const date = new Date(event.startsAt);
      return `${date.getFullYear()}-${date.getMonth()}`;
    };
    const monthTotals = new Map<string, number>();
    for (const event of list) {
      monthTotals.set(monthKey(event), (monthTotals.get(monthKey(event)) ?? 0) + 1);
    }
    const months: Array<{ key: string; title: string; total: number; items: AcademicEvent[] }> = [];
    for (const event of shown) {
      const key = monthKey(event);
      const last = months[months.length - 1];
      if (last && last.key === key) last.items.push(event);
      else months.push({ key, title: monthHeading(event.startsAt, now), total: monthTotals.get(key) ?? 1, items: [event] });
    }
    content = (
      <>
        {forced ? (
          <div className="notas-docente-busca" role="status">
            <p className="callout blue">
              <Search className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                <b>A busca está escondendo outras avaliações.</b>{" "}
                <span className="wrap-anywhere">{`${quoted(forced.title)} aparece porque o link pediu por ela.`}</span>
              </span>
            </p>
            <button className={cx(secondaryButton, "btn-sm")} onClick={clearMenuSearch} type="button">
              <X className="h-4 w-4" aria-hidden />
              Limpar busca
            </button>
          </div>
        ) : searching ? (
          // a busca do menu filtra a lista: a tela diz isso, quantas estão na aba, quantas o filtro de disciplina
          // esconde e como voltar (decisão 14, como em Notas do aluno e na Gestão)
          <div className="notas-docente-searchnote" role="status">
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 wrap-anywhere">
              Busca: <b>{term}</b>, {`${countText(list.length, "avaliação", "avaliações")} em ${tabName}`}
              {hiddenByOffer ? `, ${hiddenText}` : ""}
            </span>
            <span className="notas-docente-searchnote-acts">
              {hiddenByOffer ? (
                <button className="btn btn-g btn-sm shrink-0" onClick={showAllOffers} type="button">
                  {showAllOffersLabel}
                </button>
              ) : null}
              {onClearSearch ? (
                <button className="btn btn-g btn-sm shrink-0" onClick={clearMenuSearch} type="button">
                  <X className="h-4 w-4" aria-hidden />
                  Limpar busca
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        <div
          ref={listRef}
          className="notas-docente-list"
          role="group"
          aria-label={paged.pageCount > 1 ? `${tabName}, página ${paged.page} de ${paged.pageCount}` : tabName}
        >
          {months.map((month) => (
            <Fragment key={month.key}>
              <h3 className="notas-docente-month">
                {month.title}
                <span className="n">{countText(month.total, "avaliação", "avaliações")}</span>
                {month.total > month.items.length ? (
                  <span className="sr-only">, {countText(month.items.length, "aparece", "aparecem")} nesta página</span>
                ) : null}
              </h3>
              <ul className="notas-docente-evs">
                {month.items.map((event) => (
                  <EvaluationRow
                    key={event.id}
                    admin={admin}
                    event={event}
                    focused={event.id === focusEventId}
                    future={!happened(event)}
                    index={shown.indexOf(event)}
                    summary={summaries[event.id] ?? null}
                    onOpenEvent={onOpenEvent}
                    onOpenGrades={openRow}
                    onRetry={() => forget(event.id)}
                  />
                ))}
              </ul>
            </Fragment>
          ))}
        </div>
        <Pager className="notas-docente-pager" paged={paged} noun={["avaliação", "avaliações"]} focusRef={listRef} />
      </>
    );
  }

  const showControls = mine.length > 0 && found.length > 0;
  // aba vazia sem disciplina escolhida: o filtro sairia só com "Todas 0"; quem fala é o vazio
  const showOffers = showControls && offers.length > 1 && (tabFound.length > 0 || activeOffer !== null);
  return (
    <div className="notas-docente-page">
      {/* sem cabeçalho visível (rodada 10): o título e o resumo seguem para o leitor de tela */}
      <h2 className="sr-only" id="notas-docente-titulo">
        Notas das avaliações
      </h2>
      <p className="sr-only">{subtitle}</p>
      {showControls ? (
        <div className="notas-docente-bar">
          <div className="seg notas-docente-tabs-seg" role="group" aria-label="Quais avaliações mostrar">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={cx(tab === item.id && "on")}
                aria-pressed={tab === item.id}
                onClick={() => pickTab(item.id)}
                type="button"
              >
                <span className="t">{item.label}</span>
                <span className="n">{item.count}</span>
              </button>
            ))}
          </div>
          {showOffers ? (
            <OfferFilter byClass={multiClass} offers={offers} total={tabFound.length} value={activeOffer} onChange={setOffer} />
          ) : null}
        </div>
      ) : null}
      <section className="card notas-docente-card" aria-labelledby="notas-docente-titulo">
        {content}
      </section>
    </div>
  );
}

/** Valor de "todas" no filtro de turma e disciplina. */
const ALL_OFFERS = "todas";

/**
 * Filtro por turma e disciplina (amostra A, "Disciplina: Todas"): o Select próprio em pílula, azul quando há um
 * filtro aplicado. Cada opção traz quantas avaliações a aba aberta tem nela; a que não tem nenhuma fica apagada.
 */
function OfferFilter({
  byClass,
  offers,
  onChange,
  total,
  value,
}: {
  /** As opções trazem a turma ("TADS 5, Matemática"): há mais de uma turma. */
  byClass: boolean;
  offers: Array<{ key: string; label: string; count: number }>;
  onChange: (value: string | null) => void;
  total: number;
  value: string | null;
}) {
  const options: SelectOption[] = [
    { value: ALL_OFFERS, label: byClass ? "Todas as turmas" : "Todas", count: total },
    ...offers.map((item) => ({
      value: item.key,
      label: item.label,
      count: item.count,
      disabled: item.count === 0 && value !== item.key,
    })),
  ];
  return (
    <Select
      className="notas-docente-offer"
      ariaLabel={byClass ? "Turma e disciplina" : "Disciplina"}
      prefix={byClass ? "Turma e disciplina:" : "Disciplina:"}
      variant="filter"
      size="sm"
      width="auto"
      active={value !== null}
      value={value ?? ALL_OFFERS}
      options={options}
      onChange={(next) => onChange(next === ALL_OFFERS ? null : next)}
      onClear={() => onChange(null)}
    />
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 p-6 max-sm:p-4" role="status">
      <span className="sr-only">Carregando as avaliações</span>
      {[0, 1, 2, 3].map((item) => (
        <span key={item} className="flex items-center gap-4">
          <span className="skel h-14 w-[54px] shrink-0 !rounded-xl" />
          <span className="grid flex-1 gap-2">
            <span className="skel h-4 w-2/3" />
            <span className="skel h-3.5 w-1/2" />
          </span>
          <span className="skel hidden h-9 w-24 !rounded-[10px] sm:block" />
        </span>
      ))}
    </div>
  );
}

/** "1 de 3 com nota" com a barra do quanto já tem nota (cheia e verde quando todos têm). */
function Progress({ launched, students }: { launched: number; students: number }) {
  const pct = students ? Math.min(100, Math.round((launched / students) * 100)) : 0;
  const full = students > 0 && launched >= students;
  return (
    <span className={cx("notas-docente-prog", full && "is-full")}>
      <span
        className="notas-docente-prog-bar"
        role="progressbar"
        aria-label="Alunos com nota"
        aria-valuemin={0}
        aria-valuemax={students}
        aria-valuenow={Math.min(launched, students)}
      >
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="notas-docente-prog-t">
        <b>{`${launched} de ${students}`}</b> com nota
      </span>
    </span>
  );
}

function SummaryPills({
  event,
  future,
  onRetry,
  summary,
}: {
  event: AcademicEvent;
  future: boolean;
  onRetry: () => void;
  summary: Summary | null;
}) {
  // cancelada: a situação fica num lugar só (sem "Agendada" nem a situação das notas, que nem carrega)
  if (event.status === "cancelled") {
    return (
      <span className="notas-docente-ev-status">
        <span className="stat red">Cancelada</span>
      </span>
    );
  }
  // avaliação que ainda não aconteceu: uma etiqueta só, com quanto falta (a situação nem carrega)
  if (future) {
    return (
      <span className="notas-docente-ev-status">
        <span className="stat gray">Agendada</span>
        <span className="notas-docente-ev-when">{relativeDue(event.startsAt)}</span>
      </span>
    );
  }
  if (!summary) {
    return (
      <span className="notas-docente-ev-status">
        <span className="skel h-6 w-28 !rounded-full" aria-hidden />
        <span className="sr-only">Carregando a situação das notas</span>
      </span>
    );
  }
  if (!summary.ok) {
    return (
      <span className="notas-docente-ev-status">
        <span className="stat gray">
          {summary.forbidden ? <Lock aria-hidden /> : null}
          {summary.forbidden ? "Sem acesso" : "Situação não carregou"}
        </span>
        <span className="notas-docente-ev-line">
          {summary.message}
          {summary.forbidden ? null : (
            <>
              {" "}
              <button className="link min-h-6 text-[13px] max-md:min-h-11 pointer-coarse:min-h-11" onClick={onRetry} type="button">
                Tentar de novo
              </button>
            </>
          )}
        </span>
      </span>
    );
  }
  const publishedAt = summary.publishedAt ?? event.gradesPublishedAt ?? null;
  const ofTotal = summary.students ? (
    <Progress launched={summary.launched} students={summary.students} />
  ) : (
    <span className="notas-docente-ev-line">A turma ainda não tem alunos ativos</span>
  );
  const draftPill = summary.drafts ? (
    <span className="stat amber">
      <FileClock aria-hidden />
      Rascunho de importação
    </span>
  ) : null;
  if (publishedAt) {
    return (
      <span className="notas-docente-ev-status">
        <span className="stat green">
          <Eye aria-hidden />
          {`Publicadas em ${formatDateBR(publishedAt)}`}
        </span>
        {draftPill}
        {ofTotal}
      </span>
    );
  }
  if (summary.launched) {
    return (
      <span className="notas-docente-ev-status">
        <span className="stat amber">
          <EyeOff aria-hidden />
          Notas ocultas
        </span>
        {draftPill}
        {ofTotal}
      </span>
    );
  }
  return (
    <span className="notas-docente-ev-status">
      {draftPill ?? <span className="stat gray">Sem notas</span>}
      {summary.drafts ? <span className="notas-docente-ev-line">Falta conferir e aplicar a importação</span> : ofTotal}
    </span>
  );
}

function EvaluationRow({
  admin,
  event,
  focused,
  future,
  index,
  onOpenEvent,
  onOpenGrades,
  onRetry,
  summary,
}: {
  admin: boolean;
  event: AcademicEvent;
  focused: boolean;
  future: boolean;
  /** Posição na página: atrasa a entrada da linha (cascata). */
  index: number;
  onOpenEvent: (eventId: number) => void;
  onOpenGrades: (eventId: number) => void;
  onRetry: () => void;
  summary: Summary | null;
}) {
  const meta = categoryMeta[event.category];
  const parts = dateParts(event.startsAt);
  const points = event.points !== null && event.points > 0 ? `${event.points.toLocaleString("pt-BR")} pts` : "sem pontuação";
  // os detalhes separados por vírgula, como no Painel e no Cronograma; a data já está no bloco ao lado
  const details = [
    isAllDay(event.startsAt) ? "Dia todo" : formatTime(event.startsAt),
    event.academicClass?.name,
    event.subject?.name,
    points,
    admin ? event.teacher?.fullName : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <li
      className={cx("notas-docente-ev", focused && "is-focus")}
      data-grades-event={event.id}
      style={{ "--i": index } as CSSProperties}
    >
      <span className="dbadge" aria-hidden>
        <small>{parts.weekday}</small>
        <b>{parts.day}</b>
      </span>
      <div className="notas-docente-ev-body">
        <p className="ev-title">{event.title}</p>
        <p className="ev-meta">
          <span className={cx("cat", meta.tint)}>{meta.short}</span>
          <span className="sr-only">{formatShortDate(event.startsAt)}, </span>
          <span className="wrap-anywhere">{details}</span>
        </p>
      </div>
      <SummaryPills event={event} future={future} summary={summary} onRetry={onRetry} />
      <div className="notas-docente-ev-acts">
        <button
          className="ib sm"
          aria-label={`Ver ${event.title} no cronograma`}
          title="Ver no cronograma"
          onClick={() => onOpenEvent(event.id)}
          type="button"
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
        </button>
        <button
          className={cx(secondaryButton, "btn-sm notas-docente-open")}
          data-grades-open=""
          aria-label={`Abrir as notas de ${event.title}`}
          aria-haspopup="dialog"
          onClick={() => onOpenGrades(event.id)}
          type="button"
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          Abrir notas
          <ChevronRight className="h-4 w-4 opacity-70" aria-hidden />
        </button>
      </div>
    </li>
  );
}
