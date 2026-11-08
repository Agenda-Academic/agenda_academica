"use client";

import { CalendarDays, ChevronDown, ChevronUp, ClipboardCheck, Eye, EyeOff, FileClock, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEventGrades, getGradeImports } from "@/lib/api";
import { cx, dateParts, errorMessage, formatShortDateTime, matchesSearch } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, UserRole } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { launchedCount, subscribeGradesChanged } from "./event-grades-drawer";
import { EmptyState, SectionTitle, Segmented, SegmentedButton, secondaryButton } from "./ui";

/**
 * Tela Notas da docente e da administração (desenho 5.7): as avaliações (prova e trabalho de turma) que a
 * pessoa gerencia, com a situação de cada uma (gradesPublishedAt: "Notas ocultas" ou publicadas) e a ação
 * "Notas", que abre a gaveta da avaliação (onOpenGrades, a mesma da Gestão). Renderizada por grades-view.tsx.
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
};

/** Situação das notas de uma avaliação (GET /events/:id/grades e as importações dela). */
type Summary =
  | { ok: true; publishedAt: string | null; students: number; launched: number; drafts: number }
  | { ok: false; message: string; forbidden: boolean };

type Tab = "past" | "next" | "all";

/** Linhas à vista antes do "Ver todas (N)". */
const FIRST_ROWS = 8;
/** Avaliações cuja situação carrega ao mesmo tempo. */
const PARALLEL = 3;

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

export function GradesTeacher({ context, events, focusEventId, onOpenEvent, onOpenGrades, role, search }: GradesTeacherProps) {
  const { loading, navigate, token, user } = useAppActions();
  const [now] = useState(() => Date.now());
  // null: a aba escolhida pela tela (a da avaliação destacada ou "Já aconteceram" quando há)
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [seenFocus, setSeenFocus] = useState(focusEventId);
  const [summaries, setSummaries] = useState<Record<number, Summary>>({});
  const inflight = useRef(new Set<number>());
  const versions = useRef(new Map<number, number>());

  // avaliação nova pedida pelo endereço (?tela=notas&evento=): a aba e a lista se ajustam a ela
  if (seenFocus !== focusEventId) {
    setSeenFocus(focusEventId);
    setChosenTab(null);
    setExpanded(false);
  }

  const mine = useMemo(() => events.filter((event) => inMyOffers(event, role, user.id, context)), [context, events, role, user.id]);
  const found = useMemo(() => mine.filter((event) => matchesSearch(event, search)), [mine, search]);
  const past = useMemo(() => found.filter((event) => new Date(event.startsAt).getTime() <= now).sort(byStartDesc), [found, now]);
  const upcoming = useMemo(() => found.filter((event) => new Date(event.startsAt).getTime() > now).sort(byStartAsc), [found, now]);
  const all = useMemo(() => [...found].sort(byStartDesc), [found]);

  let autoTab: Tab = past.length ? "past" : "next";
  if (focusEventId !== null) {
    if (upcoming.some((event) => event.id === focusEventId)) autoTab = "next";
    else if (past.some((event) => event.id === focusEventId)) autoTab = "past";
  }
  const tab = chosenTab ?? autoTab;
  const list = tab === "past" ? past : tab === "next" ? upcoming : all;
  const focusIndex = focusEventId === null ? -1 : list.findIndex((event) => event.id === focusEventId);
  const limit = expanded ? list.length : Math.max(FIRST_ROWS, focusIndex + 1);
  const shown = list.slice(0, limit);
  const shownKey = shown.map((event) => event.id).join(",");

  /** Tira a situação guardada da avaliação: ela carrega de novo (a que está carregando é ignorada). */
  function forget(eventId: number) {
    versions.current.set(eventId, (versions.current.get(eventId) ?? 0) + 1);
    setSummaries((current) => {
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  }

  // a situação de cada avaliação à vista, poucas por vez
  useEffect(() => {
    const ids = shownKey ? shownKey.split(",").map(Number) : [];
    const pending = ids.filter((id) => !(id in summaries) && !inflight.current.has(id));
    const room = Math.max(0, PARALLEL - inflight.current.size);
    for (const id of pending.slice(0, room)) {
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
  }, [shownKey, summaries, token]);

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
  }, [focusEventId, loading, tab]);

  const admin = role === "admin";
  const searching = search.trim().length > 0;
  const subtitle = mine.length
    ? `${past.length === 1 ? "1 já aconteceu" : `${past.length} já aconteceram`}, ${upcoming.length === 1 ? "1 próxima" : `${upcoming.length} próximas`}${
        searching ? `, com a busca "${search.trim()}"` : ""
      }`
    : admin
      ? "Provas e trabalhos de todas as turmas"
      : "Provas e trabalhos das suas disciplinas";

  let content;
  if (loading && !events.length) {
    content = <ListSkeleton />;
  } else if (!mine.length) {
    content = (
      <div className="px-6 pb-6">
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
      <div className="px-6 pb-6">
        <EmptyState
          icon={ClipboardCheck}
          text={`Nenhuma avaliação com "${search.trim()}"`}
          hint="Confira o texto ou apague a busca no menu para ver todas as avaliações."
        />
      </div>
    );
  } else if (!list.length) {
    content = (
      <div className="px-6 pb-6">
        <EmptyState
          compact
          icon={ClipboardCheck}
          text={tab === "past" ? "Nenhuma avaliação aconteceu ainda" : "Nenhuma avaliação pela frente"}
          hint={tab === "past" ? "As notas entram depois da prova ou da entrega do trabalho." : "As próximas provas e trabalhos aparecem aqui."}
          action={
            tab === "past"
              ? { label: `Ver próximas (${upcoming.length})`, onClick: () => setChosenTab("next") }
              : { label: `Ver as que já aconteceram (${past.length})`, onClick: () => setChosenTab("past") }
          }
        />
      </div>
    );
  } else {
    content = (
      <>
        <ul className="notas-docente-evs" aria-label={tab === "past" ? "Avaliações que já aconteceram" : tab === "next" ? "Próximas avaliações" : "Todas as avaliações"}>
          {shown.map((event) => (
            <EvaluationRow
              key={event.id}
              admin={admin}
              event={event}
              focused={event.id === focusEventId}
              now={now}
              summary={summaries[event.id] ?? null}
              onOpenEvent={onOpenEvent}
              onOpenGrades={onOpenGrades}
              onRetry={() => forget(event.id)}
            />
          ))}
        </ul>
        {list.length > shown.length || expanded ? (
          <div className="notas-docente-more">
            {list.length > FIRST_ROWS ? (
              <button className="link min-h-6" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} type="button">
                {expanded ? "Mostrar menos" : `Ver todas (${list.length})`}
                {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
              </button>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className="card notas-docente-card" aria-labelledby="notas-docente-titulo">
      <div className="notas-docente-card-head">
        <SectionTitle id="notas-docente-titulo" title="Notas das avaliações" subtitle={subtitle} />
        {mine.length && found.length ? (
          <Segmented label="Quais avaliações mostrar">
            <SegmentedButton
              active={tab === "past"}
              label={`Já aconteceram (${past.length})`}
              onClick={() => {
                setChosenTab("past");
                setExpanded(false);
              }}
            />
            <SegmentedButton
              active={tab === "next"}
              label={`Próximas (${upcoming.length})`}
              onClick={() => {
                setChosenTab("next");
                setExpanded(false);
              }}
            />
            <SegmentedButton
              active={tab === "all"}
              label={`Todas (${found.length})`}
              onClick={() => {
                setChosenTab("all");
                setExpanded(false);
              }}
            />
          </Segmented>
        ) : null}
      </div>
      {content}
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3 px-6 pb-6" role="status">
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

function SummaryPills({
  event,
  now,
  onRetry,
  summary,
}: {
  event: AcademicEvent;
  now: number;
  onRetry: () => void;
  summary: Summary | null;
}) {
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
        <span className="pill st-ag">
          {summary.forbidden ? <Lock className="h-3 w-3" aria-hidden /> : null}
          {summary.forbidden ? "Sem acesso" : "Situação não carregou"}
        </span>
        <span className="notas-docente-ev-line">
          {summary.message}
          {summary.forbidden ? null : (
            <>
              {" "}
              <button className="link min-h-6 text-[13px]" onClick={onRetry} type="button">
                Tentar de novo
              </button>
            </>
          )}
        </span>
      </span>
    );
  }
  const publishedAt = summary.publishedAt ?? event.gradesPublishedAt ?? null;
  const ofTotal = `${summary.launched} de ${summary.students} com nota`;
  const draftPill = summary.drafts ? (
    <span className="pill st-alt">
      <FileClock className="h-3 w-3" aria-hidden />
      Rascunho de importação
    </span>
  ) : null;
  if (publishedAt) {
    return (
      <span className="notas-docente-ev-status">
        <span className="pill st-conc">
          <Eye className="h-3 w-3" aria-hidden />
          Publicadas
        </span>
        {draftPill}
        <span className="notas-docente-ev-line">{ofTotal}</span>
      </span>
    );
  }
  if (summary.launched) {
    return (
      <span className="notas-docente-ev-status">
        <span className="pill st-alt">
          <EyeOff className="h-3 w-3" aria-hidden />
          Notas ocultas
        </span>
        {draftPill}
        <span className="notas-docente-ev-line">{ofTotal}</span>
      </span>
    );
  }
  const future = new Date(event.startsAt).getTime() > now;
  return (
    <span className="notas-docente-ev-status">
      {draftPill ?? <span className="pill st-ag">Sem notas</span>}
      <span className="notas-docente-ev-line">
        {summary.drafts
          ? "Falta conferir e aplicar a importação"
          : future
            ? "Ainda não aconteceu"
            : summary.students === 1
              ? "1 aluno sem nota"
              : `${summary.students} alunos sem nota`}
      </span>
    </span>
  );
}

function EvaluationRow({
  admin,
  event,
  focused,
  now,
  onOpenEvent,
  onOpenGrades,
  onRetry,
  summary,
}: {
  admin: boolean;
  event: AcademicEvent;
  focused: boolean;
  now: number;
  onOpenEvent: (eventId: number) => void;
  onOpenGrades: (eventId: number) => void;
  onRetry: () => void;
  summary: Summary | null;
}) {
  const meta = categoryMeta[event.category];
  const parts = dateParts(event.startsAt);
  const where = [event.academicClass?.name, event.subject?.name].filter(Boolean).join(", ");
  const points = event.points !== null && event.points > 0 ? `${event.points.toLocaleString("pt-BR")} pts` : "sem pontuação";
  return (
    <li className={cx("notas-docente-ev", focused && "is-focus")} data-grades-event={event.id}>
      <span className="ev-date" aria-hidden>
        <span className="dw">{parts.month}</span>
        <span className="dn">{parts.day}</span>
      </span>
      <div className="notas-docente-ev-body">
        <p className="ev-title">{event.title}</p>
        <p className="ev-meta">
          <span className={cx("pill", meta.tint)}>{meta.short}</span>
          <span>{formatShortDateTime(event.startsAt)}</span>
          {where ? <span className="wrap-anywhere">{where}</span> : null}
          <span>{points}</span>
          {admin && event.teacher?.fullName ? <span>{event.teacher.fullName}</span> : null}
        </p>
      </div>
      <SummaryPills event={event} now={now} summary={summary} onRetry={onRetry} />
      <div className="notas-docente-ev-acts">
        <button
          className="ib sm"
          aria-label={`Ver ${event.title} no Cronograma`}
          title="Ver no Cronograma"
          onClick={() => onOpenEvent(event.id)}
          type="button"
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
        </button>
        <button
          className={cx(secondaryButton, "btn-sm")}
          aria-label={`Notas de ${event.title}`}
          onClick={() => onOpenGrades(event.id)}
          type="button"
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden />
          Notas
        </button>
      </div>
    </li>
  );
}
