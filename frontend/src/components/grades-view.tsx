"use client";

import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronUp,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Info,
  Lock,
  PenLine,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMyGuardians } from "@/lib/api";
import {
  classLabel,
  countText,
  cx,
  errorMessage,
  firstName,
  formatShortDate,
  formatShortDateTime,
  formatTime,
  gradeSourceText,
  isAllDay,
  normalizeText,
  relationshipText,
} from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, LinkedStudent, MyGuardians, StudentEvaluation, UserRole } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { delay, showAllText } from "./dashboard-bits";
import { GradesTeacher } from "./grades-teacher";
import { GuardianDataDialog } from "./guardian-data-dialog";
import { GradeValue, scoreParts, useApiLoad, useStudentGrades } from "./latest-grades-card";
import { EmptyState, ErrorState, RetryButton, SectionTitle, primaryButton, secondaryButton } from "./ui";

/**
 * Tela Notas (?tela=notas). Decide pelo papel:
 * - aluno: as próprias notas publicadas (GET /me/grades);
 * - responsável: as do aluno escolhido (GET /students/:id/grades); "Diogo não compartilha as notas" quando
 *   shareGrades vem false (sem nenhum número);
 * - docente e administração: GradesTeacher (área Notas docente).
 * Por disciplina, "7,5 de 10" (gradeDisplay), a data e "Fonte: SUAP, importada em 04/11/2026" (gradeSourceText);
 * "Aguardando publicação" quando published é false; sem média e sem ranking (desenho 5.8, amostras notas-*).
 * Dona: área Notas (leitura).
 */
export type GradesViewProps = {
  role: UserRole;
  context: AcademicContext | null;
  /** Responsável: o aluno escolhido (null sem vínculo ativo). */
  student: LinkedStudent | null;
  /** Avaliação a destacar ao abrir (?tela=notas&evento=1, do aviso "Nota publicada"). */
  focusEventId: number | null;
  /** Docente e administração: as avaliações (prova e trabalho de turma) que a pessoa gerencia. */
  events: AcademicEvent[];
  /** Texto da busca do menu. */
  search: string;
  /** Docente e administração: abre a gaveta de notas da avaliação. */
  onOpenGrades: (eventId: number) => void;
  /** Abre o detalhe do evento no Cronograma. */
  onOpenEvent: (eventId: number) => void;
  /** Quantas avaliações a busca do menu acha nesta tela (undefined sem busca ou enquanto carrega). */
  onSearchCount?: (count: number | undefined) => void;
};

export function GradesView(props: GradesViewProps) {
  const { role } = props;

  if (role === "teacher" || role === "admin") {
    return (
      <GradesTeacher
        context={props.context}
        events={props.events}
        focusEventId={props.focusEventId}
        role={role}
        search={props.search}
        onOpenEvent={props.onOpenEvent}
        onOpenGrades={props.onOpenGrades}
        onSearchCount={props.onSearchCount}
      />
    );
  }

  return <ReaderGrades {...props} />;
}

/* ------------------------------------------------------------------ */
/* Aluno e responsável                                                 */
/* ------------------------------------------------------------------ */

/** Avaliações por disciplina mostradas antes do "Ver todas (N)". */
const GROUP_LIMIT = 3;

type GroupView = {
  key: string;
  title: string;
  sub: string;
  /** Docente que publica (para "quando a Profa. Maraísa publicar"). */
  teacher: string | null;
  /** As que já aconteceram ou já têm nota, da mais recente para a mais antiga. */
  items: StudentEvaluation[];
  /** Próxima avaliação (para o grupo em que nada aconteceu ainda). */
  next: StudentEvaluation | null;
  upcomingCount: number;
  published: number;
  awaiting: number;
  /** Turma com matrícula ativa (vem antes das turmas que o aluno já deixou). */
  current: boolean;
  annual: boolean;
};

/** "a Profa. Maraísa", "o Prof. Pedro" ou o nome como veio. */
function withArticle(name: string | null) {
  if (!name) {
    return "a docente";
  }
  if (/^profa\.?\s/i.test(name)) {
    return `a ${name}`;
  }
  if (/^prof\.?\s/i.test(name)) {
    return `o ${name}`;
  }
  return name;
}

/** "ter, 03/11, 19:00" (sem horário quando é o dia todo). */
function whenText(value: string) {
  return isAllDay(value) ? formatShortDate(value) : formatShortDateTime(value);
}

/** "Fonte: SUAP, importada em 04/11/2026", "Fonte: modelo da Agenda, importada em 04/11/2026" ou "Fonte: lançada na Agenda em 06/11/2026". */
function sourceLine(grade: NonNullable<StudentEvaluation["grade"]>) {
  return gradeSourceText(grade.source, grade.updatedAt);
}

function pointsText(max: string) {
  return max === "1" ? "vale 1 ponto" : `vale ${max} pontos`;
}

function ReaderGrades({ role, context, student, focusEventId, search, onOpenEvent, onSearchCount }: GradesViewProps) {
  const { navigate, linkedStudents, events, openProfile } = useAppActions();
  const isGuardian = role === "guardian";
  const grades = useStudentGrades(isGuardian ? (student?.id ?? null) : null);
  const myGuardians = useMyGuardians(role === "student");
  // referência de "agora" fixada na montagem (render precisa ser puro)
  const [now] = useState(() => Date.now());
  const [dataOpen, setDataOpen] = useState(false);
  // grupo aberto ("Ver todas") ou fechado pela pessoa; sem escolha, abre o grupo da avaliação destacada
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const focusDone = useRef<number | null>(null);

  const data = grades.data;
  const name = firstName(data?.student.fullName ?? student?.fullName ?? "O aluno");

  // docente de cada avaliação: vem dos eventos da página (a rota de notas não traz o nome)
  const teacherByEvent = useMemo(() => {
    const map = new Map<number, string>();
    for (const event of events) {
      if (event.teacher?.fullName) {
        map.set(event.id, event.teacher.fullName);
      }
    }
    return map;
  }, [events]);

  const activeClassIds = useMemo(() => {
    if (isGuardian) {
      return new Set((student?.classes ?? []).map((item) => item.id));
    }
    return new Set((context?.enrollments ?? []).map((item) => item.academicClassId));
  }, [context, isGuardian, student]);

  const groups = useMemo<GroupView[]>(() => {
    if (!data || !data.shareGrades) {
      return [];
    }
    const multiClass = new Set(data.subjects.map((group) => group.academicClass.id)).size > 1;
    const views = data.subjects.map((group) => {
      const happened = (item: StudentEvaluation) => item.published || new Date(item.startsAt).getTime() <= now;
      const items = group.evaluations
        .filter((item) => happened(item) || item.eventId === focusEventId)
        .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
      const upcoming = group.evaluations
        .filter((item) => !happened(item) && item.status !== "cancelled")
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      // docentes do grupo, a que mais aparece primeiro
      const tally = new Map<string, number>();
      for (const item of group.evaluations) {
        const teacher = teacherByEvent.get(item.eventId);
        if (teacher) {
          tally.set(teacher, (tally.get(teacher) ?? 0) + 1);
        }
      }
      const teachers = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([teacher]) => teacher);
      const title = group.subject?.name ?? `Avaliações de ${group.academicClass.name}`;
      const sub = [group.subject?.code, multiClass ? classLabel(group.academicClass) : null, teachers.slice(0, 2).join(" e ") || null]
        .filter(Boolean)
        .join(", ");
      return {
        key: `${group.academicClass.id}-${group.subject?.id ?? 0}`,
        title,
        sub,
        teacher: teachers[0] ?? null,
        items,
        next: upcoming[0] ?? null,
        upcomingCount: upcoming.length,
        published: items.filter((item) => item.published).length,
        awaiting: items.filter((item) => !item.published && new Date(item.startsAt).getTime() <= now).length,
        current: activeClassIds.has(group.academicClass.id),
        annual: !group.academicClass.semester,
      };
    });
    // turmas atuais primeiro; dentro delas, a ordem da API (nome da disciplina)
    return views.sort((a, b) => Number(b.current) - Number(a.current));
  }, [activeClassIds, data, focusEventId, now, teacherByEvent]);

  // busca do menu: título, disciplina, código, docente ou tipo ("prova", "trabalho")
  const words = normalizeText(search).split(/\s+/).filter(Boolean);
  const visibleGroups = words.length
    ? groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            const haystack = normalizeText(
              [item.title, group.title, group.sub, categoryMeta[item.category]?.short, teacherByEvent.get(item.eventId)].join(" ")
            );
            return words.every((word) => haystack.includes(word));
          }),
        }))
        .filter((group) => group.items.length)
    : groups;
  const matchCount = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);

  // a busca do menu conta as avaliações achadas aqui (sem as notas na tela, ainda não há o que contar)
  const searchCount = words.length && grades.status === "ready" ? matchCount : undefined;
  useEffect(() => {
    onSearchCount?.(searchCount);
  }, [onSearchCount, searchCount]);

  const all = groups.flatMap((group) => group.items);
  const focusKnown = focusEventId !== null && Boolean(data?.subjects.some((group) => group.evaluations.some((item) => item.eventId === focusEventId)));

  // aviso "Nota publicada": leva até a avaliação e põe o foco nela (uma vez por pedido)
  useEffect(() => {
    if (grades.status !== "ready" || !focusEventId || focusDone.current === focusEventId) {
      return;
    }
    focusDone.current = focusEventId;
    const row = document.querySelector<HTMLElement>(`[data-grade-id="${focusEventId}"]`);
    if (!row) {
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  }, [focusEventId, grades.status]);

  /* ---------- responsável sem vínculo ativo ---------- */
  if (isGuardian && !student) {
    const pending = linkedStudents.find((item) => item.status === "pending") ?? null;
    return (
      <section className="card pad" aria-labelledby="notas-titulo">
        <SectionTitle id="notas-titulo" title="Notas" subtitle="As notas publicadas do aluno que você acompanha" />
        <div className="mt-5">
          <EmptyState
            icon={ClipboardCheck}
            text={pending ? "Vínculo aguardando a secretaria" : "Nenhum aluno vinculado"}
            hint={
              pending
                ? `Seu pedido para acompanhar ${firstName(pending.fullName ?? "o aluno")} aguarda a secretaria. As notas aparecem aqui depois da aprovação.`
                : "Peça o código ao aluno, no perfil dele, ou à secretaria do campus. Depois do vínculo, as notas publicadas aparecem aqui."
            }
            action={{ label: pending ? "Ver no Painel" : "Vincular aluno", onClick: () => navigate("dashboard") }}
          />
        </div>
      </section>
    );
  }

  /* ---------- carregando e erro ---------- */
  if (grades.status === "loading" || grades.status === "idle") {
    return <GradesSkeleton />;
  }
  if (grades.status === "error" || !data) {
    return (
      <section className="card pad" aria-label="Notas">
        <ErrorState
          title="Não foi possível carregar as notas"
          text={errorMessage(grades.error)}
          onRetry={grades.retry}
          retrying={grades.retrying}
        />
      </section>
    );
  }

  const guardianCard =
    isGuardian && student ? (
      <GuardianSeesCard name={name} shares={data.shareGrades} student={student} onOpenData={() => setDataOpen(true)} />
    ) : null;
  const dialog = isGuardian ? <GuardianDataDialog open={dataOpen} onClose={() => setDataOpen(false)} /> : null;

  /* ---------- responsável de aluno adulto que não compartilha: nenhum número ---------- */
  if (isGuardian && !data.shareGrades) {
    const firstClass = student?.classes[0] ?? null;
    const subtitle = [
      data.student.fullName ?? student?.fullName,
      firstClass?.course?.name ?? firstClass?.name,
      firstClass?.shift ? firstClass.shift.toLocaleLowerCase("pt-BR") : null,
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <div className="notas-pair notas-wide">
        <section className="card pad rise" style={delay(0)} aria-labelledby="notas-titulo">
          <SectionTitle id="notas-titulo" title={`Notas de ${name}`} subtitle={subtitle} />
          <div className="notas-stage">
            <span className="notas-stage-ico">
              <Lock className="h-[22px] w-[22px]" aria-hidden />
            </span>
            <p className="notas-stage-t">{name} não compartilha as notas</p>
            <p className="notas-stage-s">{name} é maior de idade e decide quem vê as notas.</p>
            <p className="notas-howto">
              <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brand" aria-hidden />
              <span>
                Para mostrar, {name} ativa <b>Compartilhar minhas notas</b> no perfil, na seção <b>Quem acompanha minha agenda</b>.
                Depois disso, as notas publicadas aparecem aqui.
              </span>
            </p>
            <button className={cx(primaryButton, "mt-5")} onClick={() => navigate("calendar")} type="button">
              <CalendarDays className="h-4 w-4" aria-hidden />
              Ver cronograma da turma
            </button>
          </div>
        </section>
        {guardianCard}
        {dialog}
      </div>
    );
  }

  const howCard = <HowGradesCard guardianName={isGuardian ? name : null} />;
  const sideCards = (
    <div className="notas-pair">
      {isGuardian ? guardianCard : <WhoSeesCard state={myGuardians} onOpenProfile={openProfile} />}
      {howCard}
    </div>
  );

  /* ---------- sem nenhuma prova ou trabalho ---------- */
  if (!groups.length) {
    const notInClass = !isGuardian && context !== null && context.enrollments.length === 0;
    const pendingClass = context?.pendingEnrollments?.[0]?.academicClass?.name ?? null;
    let empty: { text: string; hint: string; action: { label: string; onClick: () => void } };
    if (notInClass) {
      empty = {
        text: pendingClass ? `Pedido para entrar na ${pendingClass} aguardando` : "Você ainda não está em uma turma",
        hint: pendingClass
          ? "A docente ou a secretaria confirma o pedido. Depois disso, as provas e os trabalhos da turma aparecem aqui."
          : "Entre na turma com o código que a docente ou a secretaria passou. As provas e os trabalhos aparecem aqui.",
        action: { label: pendingClass ? "Ver pedido no Painel" : "Entrar em uma turma", onClick: () => navigate("dashboard") },
      };
    } else {
      empty = {
        text: "Nenhuma prova ou trabalho por enquanto",
        hint: isGuardian
          ? `Quando a docente marcar provas e trabalhos da turma de ${name}, eles aparecem aqui, com a nota depois de publicada.`
          : "Quando a docente marcar provas e trabalhos da sua turma, eles aparecem aqui, com a nota depois de publicada.",
        action: { label: "Ver cronograma", onClick: () => navigate("calendar") },
      };
    }
    return (
      <div className="grid gap-5">
        <section className="card pad rise" style={delay(0)} aria-labelledby="notas-titulo">
          <SectionTitle id="notas-titulo" title={isGuardian ? `Notas de ${name}` : "Suas notas"} />
          <div className="mt-5">
            <EmptyState icon={ClipboardCheck} text={empty.text} hint={empty.hint} action={empty.action} />
          </div>
        </section>
        {sideCards}
        {dialog}
      </div>
    );
  }

  /* ---------- indicadores ---------- */
  const publishedTotal = all.filter((item) => item.published && item.grade).length;
  const groupsWithGrades = groups.filter((group) => group.items.some((item) => item.published && item.grade));
  let scope = "";
  if (groupsWithGrades.length && groupsWithGrades.every((group) => group.current)) {
    if (groupsWithGrades.every((group) => !group.annual)) {
      scope = " neste semestre";
    } else if (groupsWithGrades.every((group) => group.annual)) {
      scope = " neste ano";
    }
  }
  const waiting = all
    .filter((item) => !item.published && new Date(item.startsAt).getTime() <= now)
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  const nextEval =
    groups
      .map((group) => group.next)
      .filter((item): item is StudentEvaluation => item !== null)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null;

  let waitingHint = "Nenhuma avaliação esperando nota";
  if (waiting.length === 1) {
    waitingHint = waiting[0].title;
  } else if (waiting.length > 1) {
    waitingHint = `A mais recente: ${waiting[0].title}`;
  }
  let nextHint = "Nenhuma prova ou trabalho marcado";
  if (nextEval) {
    const max = scoreParts(nextEval).max;
    nextHint = [nextEval.title, isAllDay(nextEval.startsAt) ? null : formatTime(nextEval.startsAt), max ? pointsText(max) : null]
      .filter(Boolean)
      .join(", ");
  }

  return (
    <div className="grid gap-5">
      <div className="notas-kpis">
        <div className="card kpi rise" style={delay(0)}>
          <div className="kpi-top">
            <p className="kpi-label">Notas publicadas</p>
            <span className="kpi-ico" aria-hidden>
              <CircleCheck className="h-[18px] w-[18px]" />
            </span>
          </div>
          <p className="kpi-val">{publishedTotal}</p>
          <p className="kpi-hint">
            {publishedTotal
              ? `em ${countText(groupsWithGrades.length, "disciplina", "disciplinas")}${scope}`
              : "A docente publica depois de corrigir"}
          </p>
        </div>
        <div className="card kpi rise" style={delay(1)}>
          <div className="kpi-top">
            <p className="kpi-label">Aguardando publicação</p>
            <span className="kpi-ico notas-ico-blue" aria-hidden>
              <Clock className="h-[18px] w-[18px]" />
            </span>
          </div>
          <p className="kpi-val">{waiting.length}</p>
          <p className="kpi-hint wrap-anywhere">{waitingHint}</p>
        </div>
        <div className={cx("card kpi rise notas-kpi-next", nextEval && "is-link")} style={delay(2)}>
          <div className="kpi-top">
            {nextEval ? (
              <button
                className="kpi-hit kpi-label"
                onClick={() => onOpenEvent(nextEval.eventId)}
                aria-label={`Próxima avaliação: ${nextEval.title}, ${whenText(nextEval.startsAt)}. Ver no Cronograma`}
                type="button"
              >
                Próxima avaliação
              </button>
            ) : (
              <p className="kpi-label">Próxima avaliação</p>
            )}
            <span className="kpi-ico" aria-hidden>
              <CalendarDays className="h-[18px] w-[18px]" />
            </span>
          </div>
          <p className={cx("kpi-val", !nextEval && "notas-kpi-none")}>{nextEval ? formatShortDate(nextEval.startsAt) : "Nenhuma"}</p>
          <p className="kpi-hint wrap-anywhere">{nextHint}</p>
        </div>
      </div>

      {focusEventId !== null && !focusKnown ? (
        <p className="callout blue" role="status">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          A avaliação do aviso não tem nota publicada agora. Ela aparece aqui quando a docente publicar de novo.
        </p>
      ) : null}

      {words.length && matchCount ? (
        <p className="notas-search" role="status">
          Busca do menu: {countText(matchCount, "avaliação encontrada", "avaliações encontradas")}. Apague a busca para ver
          todas.
        </p>
      ) : null}

      {words.length && !matchCount ? (
        <section className="card pad" aria-label="Busca nas notas" role="status">
          <EmptyState
            icon={ClipboardCheck}
            text={`Nenhuma prova ou trabalho com “${search.trim()}”`}
            hint="Confira o texto da busca no menu, ou apague a busca para ver todas as notas."
            action={{ label: "Buscar no Cronograma", onClick: () => navigate("calendar") }}
          />
        </section>
      ) : null}

      {visibleGroups.map((group, index) => {
        const hiddenFocus = group.items.slice(GROUP_LIMIT).some((item) => item.eventId === focusEventId);
        const open = expanded[group.key] ?? hiddenFocus;
        const shown = open ? group.items : group.items.slice(0, GROUP_LIMIT);
        const listId = `notas-lista-${group.key}`;
        const countParts = [
          group.published ? countText(group.published, "publicada", "publicadas") : null,
          group.awaiting ? `${group.awaiting} aguardando` : null,
        ].filter(Boolean);
        if (!countParts.length && group.upcomingCount) {
          countParts.push(countText(group.upcomingCount, "agendada", "agendadas"));
        }
        return (
          <section key={group.key} className="card notas-disc rise" style={delay(3 + index)} aria-labelledby={`notas-d-${group.key}`}>
            <div className="notas-disc-head">
              <span className="notas-disc-ico" aria-hidden>
                <BookOpen className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h2 className="h2 wrap-anywhere" id={`notas-d-${group.key}`}>
                  {group.title}
                </h2>
                {group.sub ? <p className="sub">{group.sub}</p> : null}
              </div>
              {countParts.length ? <p className="notas-disc-count">{countParts.join(", ")}</p> : null}
            </div>

            {shown.length ? (
              <ul id={listId}>
                {shown.map((item) => (
                  <GradeRow
                    key={item.eventId}
                    evaluation={item}
                    focused={item.eventId === focusEventId}
                    guardianName={isGuardian ? name : null}
                    now={now}
                    teacher={teacherByEvent.get(item.eventId) ?? group.teacher}
                  />
                ))}
              </ul>
            ) : (
              <div className="notas-soon">
                <p>
                  Nenhuma avaliação aconteceu ainda.
                  {group.next ? ` A próxima é ${group.next.title}, ${whenText(group.next.startsAt)}.` : null}
                </p>
                {group.next ? (
                  <button className="link min-h-6" onClick={() => group.next && onOpenEvent(group.next.eventId)} type="button">
                    Ver no Cronograma
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            )}

            {group.items.length > GROUP_LIMIT ? (
              <div className="notas-more">
                <button
                  className="link min-h-6"
                  aria-controls={listId}
                  aria-expanded={open}
                  onClick={() => setExpanded((previous) => ({ ...previous, [group.key]: !open }))}
                  type="button"
                >
                  {open ? "Mostrar menos" : showAllText("Ver todas", group.items.length)}
                  {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            ) : null}
          </section>
        );
      })}

      {sideCards}
      {dialog}
    </div>
  );
}

/** Uma avaliação: título, tipo, data, a nota (ou "Aguardando publicação") e a linha da fonte. */
function GradeRow({
  evaluation,
  focused,
  guardianName,
  now,
  teacher,
}: {
  evaluation: StudentEvaluation;
  focused: boolean;
  guardianName: string | null;
  now: number;
  teacher: string | null;
}) {
  const meta = categoryMeta[evaluation.category];
  const grade = evaluation.grade;
  const waiting = !evaluation.published;
  const future = new Date(evaluation.startsAt).getTime() > now;

  let line: ReactNode;
  if (waiting) {
    line = (
      <>
        <Info className="h-[15px] w-[15px]" aria-hidden />
        {future
          ? `Acontece ${whenText(evaluation.startsAt)}. A nota aparece aqui quando ${withArticle(teacher)} publicar.`
          : `A nota aparece aqui quando ${withArticle(teacher)} publicar. Você recebe um aviso.`}
      </>
    );
  } else if (grade) {
    const Icon = grade.source?.type === "import" ? FileSpreadsheet : PenLine;
    line = (
      <>
        <Icon className="h-[15px] w-[15px]" aria-hidden />
        {sourceLine(grade)}
      </>
    );
  } else {
    line = (
      <>
        <Info className="h-[15px] w-[15px]" aria-hidden />
        {guardianName
          ? `Publicada sem nota para ${guardianName}. Dúvida? Fale com a docente da disciplina.`
          : "Publicada sem nota para você. Dúvida? Fale com a docente da disciplina."}
      </>
    );
  }

  return (
    <li className={cx("notas-grade", waiting && "is-wait", focused && "is-focus")} data-grade-id={evaluation.eventId} tabIndex={-1}>
      <p className="notas-g-title wrap-anywhere">{evaluation.title}</p>
      <p className="notas-g-meta">
        {meta ? <span className={cx("pill", meta.tint)}>{meta.short}</span> : null}
        <span>{whenText(evaluation.startsAt)}</span>
        {evaluation.status === "cancelled" ? <span className="pill stat stat-canc">Cancelada</span> : null}
      </p>
      <p className="notas-g-src">{line}</p>
      {waiting ? (
        <div className="notas-g-wait">
          <span className="pill st-ag">
            <Clock className="h-[15px] w-[15px]" aria-hidden />
            {future ? "Agendada" : "Aguardando publicação"}
          </span>
        </div>
      ) : (
        <GradeValue className="notas-g-score" evaluation={evaluation} />
      )}
    </li>
  );
}

/** Esqueleto da tela: os três indicadores e duas disciplinas. */
function GradesSkeleton() {
  return (
    <div className="grid gap-5" role="status">
      <span className="sr-only">Carregando notas</span>
      <div className="notas-kpis">
        {[0, 1, 2].map((item) => (
          <div key={item} className={cx("card kpi grid content-start gap-3", item === 2 && "notas-kpi-wide")}>
            <span className="skel h-3.5 w-32" />
            <span className="skel h-9 w-16" />
            <span className="skel h-3.5 w-3/4" />
          </div>
        ))}
      </div>
      {[0, 1].map((card) => (
        <div key={card} className="card notas-disc">
          <div className="notas-disc-head">
            <span className="skel h-11 w-11 shrink-0 !rounded-xl" />
            <span className="grid flex-1 gap-2">
              <span className="skel h-5 w-48 max-w-full" />
              <span className="skel h-3.5 w-36 max-w-full" />
            </span>
          </div>
          {[0, 1].map((row) => (
            <div key={row} className="notas-grade">
              <span className="grid gap-2" style={{ gridArea: "t" }}>
                <span className="skel h-4 w-2/3" />
                <span className="skel h-3.5 w-1/3" />
                <span className="skel h-3 w-1/2" />
              </span>
              <span className="skel h-7 w-16" style={{ gridArea: "s" }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards de apoio                                                      */
/* ------------------------------------------------------------------ */

function fetchMyGuardians(token: string) {
  return getMyGuardians(token);
}

function useMyGuardians(enabled: boolean) {
  const { token } = useAppActions();
  return useApiLoad<MyGuardians>(token, enabled ? "me" : "", fetchMyGuardians);
}

/** Aluno: "Quem vê suas notas", com os responsáveis e se cada um vê as notas publicadas. */
function WhoSeesCard({ state, onOpenProfile }: { state: ReturnType<typeof useMyGuardians>; onOpenProfile: () => void }) {
  const data = state.data;
  const people = (data?.guardians ?? []).filter((item) => item.status === "active" || item.status === "pending");

  let body: ReactNode;
  if (state.status === "loading" || state.status === "idle") {
    body = (
      <div className="notas-who" role="status">
        <span className="sr-only">Carregando quem acompanha sua agenda</span>
        <span className="skel h-10 w-10 shrink-0 !rounded-xl" />
        <span className="grid flex-1 gap-2">
          <span className="skel h-3.5 w-32" />
          <span className="skel h-3 w-44 max-w-full" />
        </span>
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div className="notas-who" role="alert">
        <div className="min-w-0 flex-1">
          <p className="notas-who-n">Não foi possível carregar quem acompanha sua agenda</p>
          <p className="notas-who-s">{errorMessage(state.error)}</p>
        </div>
        <RetryButton className={cx(secondaryButton, "btn-sm")} onRetry={state.retry} retrying={state.retrying} />
      </div>
    );
  } else if (!people.length) {
    body = (
      <EmptyState
        compact
        icon={Users}
        text="Nenhum responsável acompanha sua agenda"
        hint="Para alguém acompanhar, gere um código no perfil, em Quem acompanha minha agenda."
      />
    );
  } else {
    body = (
      <ul className="grid gap-2.5">
        {people.map((person) => {
          let pill: ReactNode;
          if (person.status === "pending") {
            pill = (
              <span className="pill st-alt">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                Aguardando a secretaria
              </span>
            );
          } else if (person.shareGrades) {
            pill = (
              <span className="pill st-conc">
                <Eye className="h-3.5 w-3.5" aria-hidden />
                Vê as notas publicadas
              </span>
            );
          } else {
            pill = (
              <span className="pill st-ag">
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
                Não vê as notas
              </span>
            );
          }
          return (
            <li key={person.id} className="notas-who">
              <span className="notas-who-av" aria-hidden>
                {person.initials}
              </span>
              <div className="min-w-0">
                <p className="notas-who-n wrap-anywhere">{person.fullName ?? "Responsável"}</p>
                <p className="notas-who-s">{relationshipText(person.relationship)}, acompanha sua agenda</p>
              </div>
              {pill}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="card pad" aria-labelledby="notas-quem">
      <SectionTitle
        id="notas-quem"
        title="Quem vê suas notas"
        subtitle={
          data?.isMinor
            ? "Você, a docente de cada disciplina e quem acompanha sua agenda. Colegas nunca veem."
            : "Você, a docente de cada disciplina e quem você autorizar no perfil. Colegas nunca veem."
        }
      />
      <div className="mt-4">{body}</div>
      <div className="mt-auto pt-4">
        <button className={cx(secondaryButton, "w-full")} onClick={onOpenProfile} type="button">
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Alterar no perfil
        </button>
      </div>
    </section>
  );
}

/** Responsável: "O que você vê" (o mesmo resumo da página "Quais dados o responsável vê"). */
function GuardianSeesCard({
  name,
  shares,
  student,
  onOpenData,
}: {
  name: string;
  shares: boolean;
  student: LinkedStudent;
  onOpenData: () => void;
}) {
  const relation = student.relationship !== "outro" ? ` como ${relationshipText(student.relationship).toLocaleLowerCase("pt-BR")}` : "";
  const rows: Array<{ icon: typeof Bell; label: string; value: string; tone: string }> = [
    { icon: CalendarDays, label: "Agenda da turma", value: "Sim", tone: "st-conc" },
    { icon: ShieldCheck, label: "Datas do campus", value: "Sim", tone: "st-conc" },
    {
      icon: ClipboardCheck,
      label: "Notas publicadas",
      value: shares ? "Sim" : `Se ${name} compartilhar`,
      tone: shares ? "st-conc" : "st-alt",
    },
    { icon: Bell, label: `Lembretes de ${name}`, value: "Não", tone: "st-ag" },
    { icon: Users, label: "Colegas da turma", value: "Não", tone: "st-ag" },
  ];
  return (
    <section className="card pad" aria-labelledby="notas-ve">
      <SectionTitle id="notas-ve" title="O que você vê" subtitle={`Você acompanha a agenda de ${name}${relation}.`} />
      <ul className="notas-sees">
        {rows.map((row) => (
          <li key={row.label}>
            <span className="notas-sees-lab">
              <row.icon className="h-[15px] w-[15px]" aria-hidden />
              {row.label}
            </span>
            <span className={cx("pill", row.tone)}>{row.value}</span>
          </li>
        ))}
      </ul>
      <p className="notas-note">
        {shares
          ? "Você vê só as notas que a docente publica. Média da turma e notas de colegas não aparecem."
          : "Aluno maior de idade decide quem vê as notas e pode mudar isso a qualquer hora no perfil."}
      </p>
      <div className="card-foot">
        <button className="link min-h-6" onClick={onOpenData} type="button">
          Quais dados o responsável vê
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}

/** "Como as notas chegam": os três passos, sem média e sem comparação. */
function HowGradesCard({ guardianName }: { guardianName: string | null }) {
  const steps = [
    "A docente lança ou importa as notas de cada prova e trabalho.",
    "A nota fica oculta até a docente publicar.",
    "Ao publicar, a nota aparece aqui e você recebe um aviso no sistema.",
  ];
  return (
    <section className="card pad" aria-labelledby="notas-como">
      <SectionTitle id="notas-como" title="Como as notas chegam" />
      <ol className="notas-steps">
        {steps.map((step, index) => (
          <li key={step}>
            <span className="notas-step-n" aria-hidden>
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="notas-note mt-auto">
        {guardianName
          ? `Sem média da turma e sem comparação com colegas. Dúvida sobre uma nota? Converse com ${guardianName} ou com a docente da disciplina.`
          : "Sem média da turma e sem comparação com colegas. Dúvida sobre uma nota? Fale com a docente da disciplina."}
      </p>
    </section>
  );
}
