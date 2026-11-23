"use client";

import { zonedNowMs } from "@/lib/zone";
import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  CircleCheck,
  ClipboardCheck,
  Clock,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Info,
  Lock,
  MessageSquare,
  PenLine,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  gradeSourceShort,
  isAllDay,
  monthGroupLabel,
  normalizeText,
  relationshipText,
} from "@/lib/format";
import { categoryIcons, categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, LinkedStudent, MyGuardians, StudentEvaluation, UserRole } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { delay, showAllText } from "./dashboard-bits";
import { GradesTeacher } from "./grades-teacher";
import { GuardianDataDialog, guardianSeesLabels } from "./guardian-data-dialog";
import { GradeValue, awaitingGrades, isAwaitingGrade, scoreParts, useApiLoad, useStudentGrades } from "./latest-grades-card";
import { Drawer, EmptyState, ErrorState, RetryButton, SectionTitle, primaryButton, secondaryButton } from "./ui";

/**
 * Tela Notas (?tela=notas). Decide pelo papel:
 * - aluno: as próprias notas publicadas (GET /me/grades);
 * - responsável: as do aluno escolhido (GET /students/:id/grades); "Diogo não compartilha as notas" quando
 *   shareGrades vem false (sem nenhum número);
 * - docente e administração: GradesTeacher (área Notas docente).
 * Por disciplina, "7,5 de 10" (gradeDisplay), a data e a fonte curta, "SUAP, 04/11" (gradeSourceShort; o ano só fora do ano corrente);
 * "Aguardando publicação" quando published é false; sem média e sem ranking (desenho 5.8, amostras notas-*).
 * A disciplina em que nada aconteceu ainda não ganha card: entra numa linha do card "Ainda sem notas".
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
  /** Apaga a busca do menu (o "Limpar busca" da tela da docente). */
  onClearSearch?: () => void;
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
        onClearSearch={props.onClearSearch}
      />
    );
  }

  // aluno e responsável: sem cabeçalho de tela (rodada 10), a tela começa pelos indicadores; o nome da tela está no
  // menu e o h1 da página continua para o leitor de tela
  return (
    <div className="notas-tela grid gap-5">
      <ReaderGrades {...props} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aluno e responsável                                                 */
/* ------------------------------------------------------------------ */

/**
 * Avaliações por disciplina mostradas no card. "Ver todas (N)" abre o painel lateral com a lista inteira da
 * disciplina, agrupada por mês: o card não cresce e a página não vira uma rolagem sem fim (rodada de UX de 2026-11-17).
 */
const GROUP_LIMIT = 3;

type GroupView = {
  key: string;
  title: string;
  sub: string;
  /** Docente que publica (para "quando a Profa. Maraísa publicar"). */
  teacher: string | null;
  /**
   * As que já aconteceram ou já têm nota, da mais recente para a mais antiga. Em todos os grupos, as futuras
   * ficam de fora (amostra notas-aluno): a próxima aparece só no indicador "Próxima avaliação".
   */
  items: StudentEvaluation[];
  /** Próxima avaliação do grupo (o "Ver no cronograma" do grupo em que nada aconteceu ainda). */
  next: StudentEvaluation | null;
  /** As que ainda não aconteceram, da mais próxima para a mais distante (entram só na busca, como "Agendada"). */
  upcoming: StudentEvaluation[];
  published: number;
  awaiting: number;
  /** Turma com matrícula ativa (vem antes das turmas que o aluno já deixou). */
  current: boolean;
  annual: boolean;
};

/** "ter, 03/11, 19:00" (sem horário quando é o dia todo). */
function whenText(value: string) {
  return isAllDay(value) ? formatShortDate(value) : formatShortDateTime(value);
}

function pointsText(max: string) {
  return max === "1" ? "vale 1 ponto" : `vale ${max} pontos`;
}

/** "Novembro" no ano corrente; "Dezembro de 2025" em outro ano. */
function monthHeading(value: string, currentYear: number) {
  return monthGroupLabel(value, new Date(currentYear, 0, 1));
}

function ReaderGrades({ role, context, student, focusEventId, search, onOpenEvent, onSearchCount, onClearSearch }: GradesViewProps) {
  const { navigate, linkedStudents, events, openProfile } = useAppActions();
  const isGuardian = role === "guardian";
  const grades = useStudentGrades(isGuardian ? (student?.id ?? null) : null);
  const myGuardians = useMyGuardians(role === "student");
  // referência de "agora" fixada na montagem (render precisa ser puro)
  const [now] = useState(() => zonedNowMs());
  const [dataOpen, setDataOpen] = useState(false);
  // disciplina aberta no painel lateral ("Ver todas")
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // responsável: quantas próximas avaliações cabem embaixo de "O que você vê" (NotasColumns mede)
  const [guardianUp, setGuardianUp] = useState(UPCOMING_SHOWN);
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
        upcoming: upcoming.filter((item) => item.eventId !== focusEventId),
        published: items.filter((item) => item.published).length,
        awaiting: items.filter((item) => isAwaitingGrade(item, now)).length,
        current: activeClassIds.has(group.academicClass.id),
        annual: !group.academicClass.semester,
      };
    });
    // turmas atuais primeiro; dentro delas, a ordem da API (nome da disciplina)
    return views.sort((a, b) => Number(b.current) - Number(a.current));
  }, [activeClassIds, data, focusEventId, now, teacherByEvent]);

  // busca do menu: título, disciplina, código, docente ou tipo ("prova", "trabalho"); acha também as que ainda
  // não aconteceram (com a etiqueta "Agendada"), como a "Prova de Matemática" do indicador Próxima avaliação
  const words = normalizeText(search).split(/\s+/).filter(Boolean);
  const visibleGroups = words.length
    ? groups
        .map((group) => ({
          ...group,
          items: [...group.upcoming, ...group.items].filter((item) => {
            const haystack = normalizeText(
              [item.title, group.title, group.sub, categoryMeta[item.category]?.short, teacherByEvent.get(item.eventId)].join(" ")
            );
            return words.every((word) => haystack.includes(word));
          }),
        }))
        .filter((group) => group.items.length)
    : groups;
  const matchCount = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  // disciplina com avaliação à vista ganha card; a que ainda não teve nenhuma entra no card "Ainda sem notas"
  const cardGroups = visibleGroups.filter((group) => group.items.length);
  const emptyGroups = visibleGroups.filter((group) => !group.items.length);

  // a busca do menu conta as avaliações achadas aqui (sem as notas na tela, ainda não há o que contar)
  const searchCount = words.length && grades.status === "ready" ? matchCount : undefined;
  useEffect(() => {
    onSearchCount?.(searchCount);
  }, [onSearchCount, searchCount]);

  const all = groups.flatMap((group) => group.items);

  /** "Limpar busca": apaga a busca do menu e leva o foco para a primeira disciplina (o botão some com o vazio). */
  function clearSearch() {
    onClearSearch?.();
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(".notas-disc .h2");
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    });
  }
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
  const dialog = isGuardian ? <GuardianDataDialog forGuardian open={dataOpen} onClose={() => setDataOpen(false)} /> : null;

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

  // provas e trabalhos que ainda vão acontecer, das turmas atuais primeiro, da mais próxima para a mais distante
  const upcomingAll = groups
    .flatMap((group) => group.upcoming.map((item) => ({ item, group })))
    .sort((a, b) => new Date(a.item.startsAt).getTime() - new Date(b.item.startsAt).getTime());

  // card de apoio: na coluna da direita a partir de 1200 px (parado no alto enquanto a lista rola); antes disso, embaixo
  // "Alterar no perfil" abre o perfil na aba dos vínculos (Responsáveis), onde fica "Compartilhar minhas notas",
  // como o "Abrir" do aviso de vínculo
  const openProfileLinks = () => openProfile("links");
  const sideCard = isGuardian ? guardianCard : <WhoSeesCard state={myGuardians} onOpenProfile={openProfileLinks} />;

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
    // o vazio no estilo único (decisão 3), num card do tamanho dele, e o card de apoio embaixo, na largura toda: sem
    // caixa tracejada esticada até a altura do card ao lado e sem colunas de alturas diferentes
    return (
      <div className="notas-stack">
        <section className="card pad rise notas-empty-card" style={delay(0)} aria-labelledby="notas-titulo">
          <SectionTitle id="notas-titulo" title={isGuardian ? `Notas de ${name}` : "Suas notas"} />
          <div className="notas-empty-body">
            <EmptyState icon={ClipboardCheck} text={empty.text} hint={empty.hint} action={empty.action} />
          </div>
        </section>
        {sideCard}
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
  // o mesmo número do card "Últimas notas" do Painel: só as que já aconteceram e ainda não têm nota publicada
  const waiting = awaitingGrades(data, now);
  const nextEval =
    groups
      .map((group) => group.next)
      .filter((item): item is StudentEvaluation => item !== null)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null;

  let waitingHint = "nenhuma avaliação esperando nota";
  if (waiting.length === 1) {
    waitingHint = waiting[0].title;
  } else if (waiting.length > 1) {
    waitingHint = `a mais recente: ${waiting[0].title}`;
  }
  // "Próximas avaliações" começa depois da que já está no indicador "Próxima avaliação" (decisão 13: a mesma prova
  // não aparece duas vezes seguidas); sem nenhuma depois dela, o card sai
  const upcomingRest = nextEval ? upcomingAll.filter(({ item }) => item.eventId !== nextEval.eventId) : upcomingAll;
  const restLead = nextEval && upcomingRest.length ? `Depois da próxima, mais ${upcomingRest.length}.` : null;
  let nextHint = "nenhuma prova ou trabalho marcado";
  if (nextEval) {
    const max = scoreParts(nextEval).max;
    nextHint = [nextEval.title, isAllDay(nextEval.startsAt) ? null : formatTime(nextEval.startsAt), max ? pointsText(max) : null]
      .filter(Boolean)
      .join(", ");
  }

  return (
    // aluno: as colunas lado a lado só a partir de 1366 px (notas.css, .notas-aluno). Entre 1200 e 1365 px a lateral
    // dele não tem lista que cresça (as próximas já aparecem todas) e terminaria bem acima das disciplinas
    <div className={cx("grid gap-5", !isGuardian && "notas-aluno")}>
      <div className="notas-kpis">
        {/* o ícone num quadrado suave antes do rótulo e o número em Sora, como os indicadores do Painel */}
        <div className="card kpi rise" style={delay(0)}>
          <div className="kpi-top">
            <span className="kpi-ic k-ok" aria-hidden>
              <CircleCheck />
            </span>
            <p className="kpi-label">Notas publicadas</p>
          </div>
          <p className="kpi-val">{publishedTotal}</p>
          <p className="kpi-hint">
            {publishedTotal
              ? `em ${countText(groupsWithGrades.length, "disciplina", "disciplinas")}${scope}`
              : "a docente publica depois de corrigir"}
          </p>
        </div>
        <div className="card kpi rise" style={delay(1)}>
          <div className="kpi-top">
            {/* amarelo ipê quando há nota esperando; sem nenhuma, o verde dos outros */}
            <span className={cx("kpi-ic", waiting.length > 0 ? "k-ipe" : "k-brand")} aria-hidden>
              <Clock />
            </span>
            <p className="kpi-label">Aguardando publicação</p>
          </div>
          <p className="kpi-val">{waiting.length}</p>
          <p className="kpi-hint wrap-anywhere">{waitingHint}</p>
        </div>
        <div className={cx("card kpi rise notas-kpi-prox", nextEval && "is-link")} style={delay(2)}>
          <div className="kpi-top">
            <span className="kpi-ic k-prova" aria-hidden>
              <CalendarDays />
            </span>
            {nextEval ? (
              // alvo de 24 px com o mouse e 44 px no toque e no celular (notas.css), centrado ao lado do ícone: o texto
              // e a altura do cabeçalho do card não saem do lugar
              <button
                className="kpi-hit kpi-label inline-flex items-center"
                onClick={() => onOpenEvent(nextEval.eventId)}
                aria-label={`Próxima avaliação: ${nextEval.title}, ${whenText(nextEval.startsAt)}. Ver no cronograma`}
                type="button"
              >
                Próxima avaliação
              </button>
            ) : (
              <p className="kpi-label">Próxima avaliação</p>
            )}
          </div>
          <p className={cx("kpi-val", nextEval ? "is-date" : "notas-kpi-none")}>{nextEval ? formatShortDate(nextEval.startsAt) : "Nenhuma"}</p>
          <p className="kpi-hint wrap-anywhere">{nextHint}</p>
          {nextEval ? (
            // o card inteiro é o botão (kpi-hit); o texto só mostra para onde ele leva
            <p className="notas-kpi-go" aria-hidden>
              Ver no cronograma
              <ArrowRight className="h-4 w-4" />
            </p>
          ) : null}
        </div>
      </div>

      {focusEventId !== null && !focusKnown ? (
        <p className="callout blue" role="status">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          A avaliação do aviso não tem nota publicada agora. Ela aparece aqui quando a docente publicar de novo.
        </p>
      ) : null}

      <NotasColumns
        wideFrom={isGuardian ? 1200 : 1366}
        // busca nova ou limpa: o número de próximas recomeça do máximo e desce até as colunas fecharem juntas
        fitKey={words.join(" ")}
        // limite e máximo presos ao tamanho da lista: cada passo muda um item na tela e dispara nova medida
        fit={
          isGuardian
            ? {
                limit: Math.min(guardianUp, upcomingRest.length),
                max: Math.min(UPCOMING_SHOWN, upcomingRest.length),
                onLimit: setGuardianUp,
              }
            : undefined
        }
        side={
          <>
            {sideCard}
            {isGuardian ? (
              // responsável: as próximas que cabem para a lateral terminar junto com as disciplinas (decisão 5).
              // Sem o pé (repetiria o "Ver no cronograma" do indicador Próxima avaliação); quando não cabem todas,
              // o subtítulo diz quantas são e leva ao cronograma
              guardianUp >= 0 && upcomingRest.length ? (
                <UpcomingCard
                  inlineMore
                  lead={restLead}
                  list={upcomingRest}
                  limit={guardianUp}
                  onOpenEvent={onOpenEvent}
                  onOpenCalendar={() => navigate("calendar")}
                />
              ) : null
            ) : nextEval && !upcomingRest.length ? null : (
              <UpcomingCard
                lead={restLead}
                list={upcomingRest}
                onOpenEvent={onOpenEvent}
                onOpenCalendar={() => navigate("calendar")}
              />
            )}
          </>
        }
      >
          {words.length && matchCount ? (
            // a busca do menu filtra as disciplinas: a tela diz isso, quantas achou e como voltar (decisão 14)
            <div className="notas-busca" role="status">
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <span className="wrap-anywhere">
                Busca: <b>{search.trim()}</b>,{" "}
                {`${countText(matchCount, "avaliação", "avaliações")} em ${countText(visibleGroups.length, "disciplina", "disciplinas")}`}
              </span>
              {onClearSearch ? (
                <button className="btn btn-g btn-sm shrink-0" onClick={clearSearch} type="button">
                  <X className="h-4 w-4" aria-hidden />
                  Limpar busca
                </button>
              ) : null}
            </div>
          ) : null}

          {words.length && !matchCount ? (
            <section className="card pad" aria-label="Busca nas notas" role="status">
              <EmptyState
                icon={ClipboardCheck}
                text={`Nenhuma prova ou trabalho com “${search.trim()}”`}
                hint="Confira o texto da busca ou limpe a busca para ver todas as notas."
                action={onClearSearch ? { label: "Limpar busca", onClick: clearSearch } : undefined}
              />
            </section>
          ) : null}

          {cardGroups.map((group, index) => {
            // com ou sem busca, o card mostra no máximo três; o resto do que a busca achou abre no painel lateral
            const limit = GROUP_LIMIT;
            let shown = group.items.slice(0, limit);
            // a avaliação de um aviso fica à vista no card mesmo quando é mais antiga que as três primeiras
            const focusItem = group.items.slice(limit).find((item) => item.eventId === focusEventId);
            if (focusItem) {
              shown = [...shown, focusItem];
            }
            const listId = `notas-lista-${group.key}`;
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
                  <GroupCounts group={group} />
                </div>

                <ul id={listId}>
                  {shown.map((item) => (
                    <GradeRow
                      key={item.eventId}
                      evaluation={item}
                      focused={item.eventId === focusEventId}
                      guardianName={isGuardian ? name : null}
                      now={now}
                    />
                  ))}
                </ul>

                {/* espaçador: com as colunas quase iguais, o último card estica esse pouco aqui (NotasColumns) */}
                <div className="notas-fill" aria-hidden />
                {group.items.length > shown.length ? (
                  <div className="notas-more">
                    <button
                      className={cx(secondaryButton, "btn-sm")}
                      aria-haspopup="dialog"
                      aria-label={
                        words.length
                          ? `Ver as ${group.items.length} avaliações de ${group.title} com “${search.trim()}”`
                          : `Ver todas as ${group.items.length} avaliações de ${group.title}`
                      }
                      onClick={() => setOpenGroup(group.key)}
                      type="button"
                    >
                      {showAllText("Ver todas", group.items.length)}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </section>
            );
          })}

          {/* as disciplinas em que nada aconteceu ainda: uma linha cada, num card só (em vez de um card cheio por disciplina) */}
          {emptyGroups.length ? (
            <section className="card notas-disc notas-empty rise" style={delay(3 + cardGroups.length)} aria-labelledby="notas-vazias">
              <div className="notas-empty-head">
                <h2 className="h2" id="notas-vazias">
                  Ainda sem notas
                </h2>
                <span className="pill stat">{countText(emptyGroups.length, "disciplina", "disciplinas")}</span>
                <p className="notas-empty-hint">Nenhuma prova ou trabalho aconteceu ainda. A nota aparece aqui depois da avaliação.</p>
              </div>
              <ul>
                {emptyGroups.map((group) => (
                  <li key={group.key}>
                    <button
                      className="notas-emp-row"
                      aria-label={`${group.title}: ver no cronograma${group.next ? `, ${group.next.title}` : ""}`}
                      onClick={() => (group.next ? onOpenEvent(group.next.eventId) : navigate("calendar"))}
                      type="button"
                    >
                      <span className="notas-disc-ico" aria-hidden>
                        <BookOpen className="h-[18px] w-[18px]" />
                      </span>
                      <span className="notas-emp-main">
                        <span className="notas-emp-name wrap-anywhere">{group.title}</span>
                        {group.sub ? <span className="notas-emp-sub wrap-anywhere">{group.sub}</span> : null}
                      </span>
                      <span className="notas-emp-link">
                        <span className="notas-emp-next wrap-anywhere">
                          {group.next ? `Próxima: ${group.next.title}, ${formatShortDate(group.next.startsAt)}` : "Nada marcado, ver no cronograma"}
                        </span>
                        <ArrowRight className="notas-emp-go h-4 w-4 shrink-0" aria-hidden />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {/* espaçador: o último card da coluna estica a pequena sobra aqui (NotasColumns) */}
              <div className="notas-fill" aria-hidden />
            </section>
          ) : null}
      </NotasColumns>
      {dialog}
      <GroupDrawer
        group={visibleGroups.find((group) => group.key === openGroup) ?? null}
        searchText={words.length ? search.trim() : ""}
        focusEventId={focusEventId}
        guardianName={isGuardian ? name : null}
        now={now}
        onClose={() => setOpenGroup(null)}
      />
    </div>
  );
}

/**
 * Disciplinas e o card de apoio lado a lado (a partir de wideFrom: 1200 px no responsável, 1366 px no aluno). As colunas terminam juntas (decisão 5): primeiro
 * pelo número de itens (fit: as próximas avaliações do responsável, de UPCOMING_SHOWN até nenhuma); a sobra pequena
 * que restar (até EVEN_GAP) vai para o último card da coluna mais baixa, num espaçador antes do fim dele
 * (.notas-fill). Com sobra maior, o card de apoio fica do tamanho dele e parado no alto enquanto a lista rola.
 */
const EVEN_GAP = 64;
/** Diferença que já não vale tirar um item (px). */
const CUT_SLACK = 24;

/**
 * fit: a lateral tem um card que pode mostrar menos itens (as próximas avaliações do responsável). limit vai de max
 * até 0 (o card só com o título e o caminho "Ver todas") e -1 (sem o card). Lado a lado, tira um por vez enquanto a
 * lateral passar do fim da lista; se o corte deixa a lista mais comprida que a lateral por mais do que antes, o
 * item volta. A lista mudou de altura (busca, largura), recomeça do máximo. Um embaixo do outro, mostra o máximo.
 */
type SideFit = { limit: number; max: number; onLimit: (limit: number) => void };

/** Altura do conteúdo de uma coluna, sem os espaçadores (.notas-fill) que esticam o último card. */
function naturalHeight(column: HTMLElement) {
  const kids = (Array.from(column.children) as HTMLElement[]).filter((kid) => kid.offsetHeight > 0);
  if (!kids.length) {
    return 0;
  }
  const gap = parseFloat(getComputedStyle(column).rowGap) || 0;
  const spacers = (Array.from(column.querySelectorAll(".notas-fill")) as HTMLElement[]).reduce(
    (sum, spacer) => sum + spacer.offsetHeight,
    0
  );
  return kids.reduce((sum, kid) => sum + kid.offsetHeight, 0) + gap * (kids.length - 1) - spacers;
}

function NotasColumns({
  children,
  side,
  fit,
  fitKey = "",
  wideFrom = 1200,
}: {
  children: ReactNode;
  side: ReactNode;
  fit?: SideFit;
  /** Largura (px) em que as colunas ficam lado a lado; a mesma do CSS (.notas-layout, .notas-aluno em notas.css). */
  wideFrom?: number;
  /** Mudou (a busca do menu, por exemplo), o ajuste recomeça do máximo, como quando a tela abre. */
  fitKey?: string;
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef(fit);
  const fitFor = useRef<number | null>(null);
  const fitKeyRef = useRef(fitKey);
  const restart = useRef(false);
  // sobra da lateral antes do último corte (para devolver o item se o corte piorou) e se o ajuste já parou
  const cutFrom = useRef<number | null>(null);
  const settled = useRef(false);
  const updateRef = useRef<(() => void) | null>(null);
  const [even, setEven] = useState(false);
  useLayoutEffect(() => {
    fitRef.current = fit;
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      restart.current = true;
    }
    // mede de novo a cada render: a lista e a lateral podem mudar sem o ResizeObserver avisar a tempo
    updateRef.current?.();
  });
  useLayoutEffect(() => {
    const main = mainRef.current;
    const column = sideRef.current;
    if (!main || !column) {
      return;
    }
    const wide = window.matchMedia(`(min-width: ${wideFrom}px)`);
    const update = () => {
      const sideFit = fitRef.current;
      const heightMain = naturalHeight(main);
      const heightSide = naturalHeight(column);
      const changed = restart.current || (fitFor.current !== null && Math.abs(fitFor.current - heightMain) > 2);
      restart.current = false;
      fitFor.current = heightMain;
      if (sideFit) {
        if (changed) {
          settled.current = false;
          cutFrom.current = null;
        }
        if (sideFit.limit < sideFit.max && (!wide.matches || changed)) {
          sideFit.onLimit(sideFit.max);
          return;
        }
        const over = heightSide - heightMain;
        if (cutFrom.current !== null) {
          const before = cutFrom.current;
          cutFrom.current = null;
          if (-over > before) {
            settled.current = true;
            sideFit.onLimit(sideFit.limit + 1);
            return;
          }
        }
        if (wide.matches && !settled.current && over > CUT_SLACK && sideFit.limit > -1) {
          cutFrom.current = over;
          sideFit.onLimit(sideFit.limit - 1);
          return;
        }
      }
      const gap = Math.abs(heightSide - heightMain);
      setEven(wide.matches && gap > 1 && gap <= EVEN_GAP);
    };
    updateRef.current = update;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(main);
    observer.observe(column);
    wide.addEventListener("change", update);
    return () => {
      observer.disconnect();
      wide.removeEventListener("change", update);
      updateRef.current = null;
    };
  }, [wideFrom]);
  return (
    <div className={cx("notas-layout", even && "is-even")}>
      <div ref={mainRef} className="notas-main">
        {children}
      </div>
      <div ref={sideRef} className="notas-side">
        {side}
      </div>
    </div>
  );
}

/** "2 publicadas" (verde) e "1 aguardando" (amarelo) no canto do card da disciplina. */
function GroupCounts({ group }: { group: GroupView }) {
  if (!group.published && !group.awaiting) {
    return (
      <p className="notas-disc-count">
        <span className="pill stat">Nenhuma nota ainda</span>
      </p>
    );
  }
  return (
    <p className="notas-disc-count">
      {group.published ? <span className="pill stat stat-conc">{countText(group.published, "publicada", "publicadas")}</span> : null}
      {group.awaiting ? <span className="pill stat stat-alt">{`${group.awaiting} aguardando`}</span> : null}
    </p>
  );
}

/**
 * Painel lateral com todas as avaliações de uma disciplina, agrupadas por mês (o painel tem rolagem própria; o
 * card da disciplina continua com as três mais recentes).
 */
function GroupDrawer({
  focusEventId,
  group,
  guardianName,
  now,
  onClose,
  searchText,
}: {
  focusEventId: number | null;
  /** Na busca do menu, o grupo traz só o que a busca achou (as que ainda vão acontecer entram também). */
  group: GroupView | null;
  guardianName: string | null;
  now: number;
  onClose: () => void;
  /** Texto da busca do menu ("" sem busca). */
  searchText: string;
}) {
  const months = useMemo(() => {
    const result: Array<{ key: string; title: string; items: StudentEvaluation[] }> = [];
    const currentYear = new Date(now).getFullYear();
    // da mais recente para a mais antiga (na busca, as agendadas vêm primeiro, no mês delas)
    const ordered = [...(group?.items ?? [])].sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
    for (const item of ordered) {
      const date = new Date(item.startsAt);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const last = result[result.length - 1];
      if (last && last.key === key) {
        last.items.push(item);
      } else {
        result.push({ key, title: monthHeading(item.startsAt, currentYear), items: [item] });
      }
    }
    return result;
  }, [group, now]);

  if (!group) {
    return null;
  }
  const counts = searchText
    ? `${countText(group.items.length, "avaliação", "avaliações")} com “${searchText}”`
    : [
        group.published ? countText(group.published, "publicada", "publicadas") : null,
        group.awaiting ? `${group.awaiting} aguardando` : null,
      ]
        .filter(Boolean)
        .join(", ");
  return (
    <Drawer open title={group.title} subtitle={[group.sub, counts].filter(Boolean).join(". ")} onClose={onClose}>
      <div className="notas-dr">
        {months.map((month) => (
          <section key={month.key} className="notas-dr-month" aria-labelledby={`notas-dr-${month.key}`}>
            <h3 className="notas-dr-h drawer-h3" id={`notas-dr-${month.key}`}>
              {month.title}
              <span className="n">{month.items.length}</span>
            </h3>
            <ul>
              {month.items.map((item) => (
                <GradeRow
                  key={item.eventId}
                  evaluation={item}
                  focused={item.eventId === focusEventId}
                  guardianName={guardianName}
                  now={now}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Drawer>
  );
}

/** Uma avaliação: título, tipo, data, a nota (ou "Aguardando publicação") e a linha da fonte. */
function GradeRow({
  evaluation,
  focused,
  guardianName,
  now,
}: {
  evaluation: StudentEvaluation;
  focused: boolean;
  guardianName: string | null;
  now: number;
}) {
  const meta = categoryMeta[evaluation.category];
  const CategoryIcon = categoryIcons[evaluation.category];
  const grade = evaluation.grade;
  const waiting = !evaluation.published;
  const future = new Date(evaluation.startsAt).getTime() > now;

  // a fonte da nota segue na linha de dados, curta ("Agenda, 19/11"); o "Fonte:" fica para o leitor de tela
  const sourceText = !waiting && grade ? gradeSourceShort(grade.source, grade.updatedAt) : "";
  const SourceIcon = grade?.source?.type === "import" ? FileSpreadsheet : PenLine;
  // publicada sem nota para esta pessoa: a frase que explica fica numa linha própria (a pílula só diz "Sem nota")
  const note =
    !waiting && !grade
      ? guardianName
        ? `Publicada sem nota para ${guardianName}. Dúvida? Fale com a docente da disciplina.`
        : "Publicada sem nota para você. Dúvida? Fale com a docente da disciplina."
      : null;

  return (
    <li className={cx("notas-grade", waiting && "is-wait", focused && "is-focus")} data-grade-id={evaluation.eventId} tabIndex={-1}>
      <span aria-hidden className={cx("notas-g-ico", meta?.tint)}>
        {CategoryIcon ? <CategoryIcon className="h-5 w-5" /> : null}
      </span>
      <div className="notas-g-body">
        <p className="notas-g-title wrap-anywhere">{evaluation.title}</p>
        <p className="notas-g-meta">
          {meta ? <span className={cx("notas-g-cat", meta.tint)}>{meta.short}</span> : null}
          <span>{whenText(evaluation.startsAt)}</span>
          {evaluation.status === "cancelled" ? <span className="pill stat stat-canc">Cancelada</span> : null}
          {sourceText ? (
            <span className="notas-g-src">
              <span aria-hidden>·</span>
              <SourceIcon className="h-[13px] w-[13px]" aria-hidden />
              <span className="sr-only">Fonte: </span>
              {sourceText}
            </span>
          ) : null}
        </p>
        {note ? (
          <p className="notas-g-note">
            <Info className="h-[15px] w-[15px]" aria-hidden />
            {note}
          </p>
        ) : null}
      </div>
      {waiting ? (
        <div className="notas-g-wait">
          <span className={cx("pill stat", !future && "stat-alt")}>
            {future ? <CalendarDays aria-hidden /> : <Clock aria-hidden />}
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
              <span className="skel !h-11 !w-11 !rounded-[14px]" />
              <span className="grid gap-2">
                <span className="skel h-4 w-2/3" />
                <span className="skel h-3.5 w-1/3" />
              </span>
              <span className="skel h-7 w-16" />
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
              <span className="pill stat stat-alt">
                <Clock aria-hidden />
                Aguardando a secretaria
              </span>
            );
          } else if (person.shareGrades) {
            pill = (
              <span className="pill stat stat-conc">
                <Eye aria-hidden />
                Vê as notas publicadas
              </span>
            );
          } else {
            pill = (
              <span className="pill stat">
                <EyeOff aria-hidden />
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
      <div className="notas-fill" aria-hidden />
      {/* o rodapé vem logo depois do conteúdo; só a pequena sobra das colunas quase iguais entra antes dele */}
      <div className="mt-4">
        <button className={cx(secondaryButton, "notas-who-btn")} onClick={onOpenProfile} type="button">
          {/* o mesmo ícone do perfil no menu e do "Alterar no perfil" de Lembretes */}
          <Settings2 className="h-4 w-4" aria-hidden />
          Alterar no perfil
        </button>
      </div>
    </section>
  );
}

/**
 * Aluno: "Próximas avaliações", na coluna da direita embaixo de "Quem vê suas notas". As próximas UPCOMING_SHOWN
 * provas e trabalhos (as mesmas do indicador "Próxima avaliação"), cada uma abre o evento no cronograma. Põe na
 * lateral o que o aluno quer saber depois das notas e deixa as duas colunas terminando juntas (decisão 5).
 */
const UPCOMING_SHOWN = 3;

function UpcomingCard({
  lead = null,
  list,
  limit = UPCOMING_SHOWN,
  inlineMore = false,
  onOpenEvent,
  onOpenCalendar,
}: {
  /** Começo do subtítulo quando a lista vem depois do indicador "Próxima avaliação" ("Depois da próxima, mais 2."). */
  lead?: string | null;
  list: Array<{ item: StudentEvaluation; group: GroupView }>;
  /** Quantas mostrar (o responsável mostra as que cabem na lateral). */
  limit?: number;
  /**
   * Responsável: sem o pé. O caminho para as que não couberam fica no subtítulo ("A mais próxima, de 3 marcadas.
   * Ver todas"), que ocupa menos altura que o pé e deixa a lateral terminar junto com a lista.
   */
  inlineMore?: boolean;
  onOpenEvent: (eventId: number) => void;
  /** Sem ele, o card fica sem o caminho para o cronograma. */
  onOpenCalendar?: () => void;
}) {
  const shown = list.slice(0, limit);
  const more = list.length > shown.length;
  const foot = Boolean(onOpenCalendar) && !inlineMore;
  // as que não couberam: o pé leva ao cronograma com o total ("Ver as 4 no cronograma"); sem o pé, o subtítulo diz
  // quantas são e, no responsável, leva até elas
  let subtitle: ReactNode = lead;
  if (more && !foot) {
    subtitle = onOpenCalendar ? (
      // numa linha só, na largura da lateral: "A mais próxima de 3. Ver todas"
      <>
        {lead ??
          (shown.length === 0
            ? `${countText(list.length, "avaliação marcada", "avaliações marcadas")}.`
            : shown.length === 1
              ? `A mais próxima de ${list.length}.`
              : `As ${shown.length} mais próximas de ${list.length}.`)}{" "}
        <button
          className="link notas-up-more"
          aria-label="Ver todas no cronograma"
          onClick={onOpenCalendar}
          type="button"
        >
          Ver todas
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </>
    ) : lead ? (
      lead
    ) : shown.length === 1 ? (
      `A mais próxima, de ${list.length} marcadas.`
    ) : (
      `As ${shown.length} mais próximas, de ${list.length} marcadas.`
    );
  }
  return (
    <section className="card pad notas-up-card" aria-labelledby="notas-prox">
      <SectionTitle id="notas-prox" title="Próximas avaliações" subtitle={subtitle} />
      {shown.length ? (
        <ul className="notas-up">
          {shown.map(({ item, group }) => {
            const meta = categoryMeta[item.category];
            const when = whenText(item.startsAt);
            return (
              <li key={item.eventId}>
                <button
                  className="notas-up-row"
                  aria-label={`${item.title}, ${group.title}, ${when}. Ver no cronograma`}
                  onClick={() => onOpenEvent(item.eventId)}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="notas-up-t wrap-anywhere">{item.title}</span>
                    <span className="notas-up-m">
                      {meta ? <span className={cx("pill", meta.tint)}>{meta.short}</span> : null}
                      <span className="wrap-anywhere">{when}</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : list.length ? null : (
        <p className="notas-up-none">Nenhuma prova ou trabalho marcado por enquanto.</p>
      )}
      <div className="notas-fill" aria-hidden />
      {foot ? (
        <div className="notas-up-foot">
          <button className="link link-solto" onClick={onOpenCalendar} type="button">
            {more ? `Ver as ${list.length} no cronograma` : "Ver no cronograma"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
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
  // os mesmos rótulos e a mesma ordem do diálogo "O que você vê" e do perfil (guardian-data-dialog.tsx)
  const labels = guardianSeesLabels(name);
  const rows: Array<{ icon: typeof Bell; label: string; value: string; tone: string }> = [
    { icon: CalendarDays, label: labels.agenda, value: "Sim", tone: "stat-conc" },
    { icon: ShieldCheck, label: labels.dates, value: "Sim", tone: "stat-conc" },
    {
      icon: ClipboardCheck,
      label: labels.grades,
      value: shares ? "Sim" : `Se ${name} compartilhar`,
      tone: shares ? "stat-conc" : "stat-alt",
    },
    { icon: Bell, label: labels.reminders, value: "Não", tone: "" },
    { icon: Users, label: labels.classmates, value: "Não", tone: "" },
    { icon: MessageSquare, label: labels.messages, value: "Não", tone: "" },
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
            <span className={cx("pill stat", row.tone)}>{row.value}</span>
          </li>
        ))}
      </ul>
      <p className="notas-note">
        {shares
          ? "Média da turma e notas de colegas não aparecem."
          : "Aluno maior de idade decide quem vê as notas e pode mudar isso a qualquer hora no perfil."}
      </p>
      <div className="notas-fill" aria-hidden />
      <div className="card-foot">
        {/* quem lê é o próprio responsável: o card já se chama "O que você vê" (decisão 10) */}
        <button className="link link-solto" onClick={onOpenData} type="button">
          Ver detalhes do que você vê
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}

