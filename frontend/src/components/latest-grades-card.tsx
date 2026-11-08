"use client";

import { ArrowRight, ClipboardCheck, Lock, TriangleAlert, Users } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { getMyGrades, getStudentGrades } from "@/lib/api";
import { countText, cx, errorMessage, firstName, formatScore } from "@/lib/format";
import { gradeStatusLabels } from "@/lib/meta";
import type { StudentEvaluation, StudentGradeGroup, StudentGrades } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { delay, showAllText } from "./dashboard-bits";
import { EmptyState, RetryButton, SectionTitle, secondaryButton } from "./ui";

/**
 * Card "Últimas notas" do Painel do aluno e "Notas publicadas" do Painel do responsável (desenho 5.8, amostra
 * responsavel-painel): as 3 de publishedAt mais recente, "7,5 de 10" e "Ver todas (N)". Carrega sozinho:
 * GET /me/grades (aluno) ou GET /students/:id/grades (responsável, com studentId). Responsável de aluno que não
 * compartilha: "Diogo não compartilha as notas", sem número. Enquanto carrega, esqueleto (nunca o vazio).
 * Dona: área Notas (leitura). Renderizado por dashboard-student.tsx e dashboard-guardian.tsx.
 *
 * Este arquivo também exporta o carregamento das notas (useStudentGrades) e as peças que a tela Notas
 * (grades-view.tsx) usa, para os dois mostrarem a nota do mesmo jeito.
 */
export type LatestGradesCardProps = {
  /** Responsável: o aluno escolhido (padrão: useAppActions().student). Aluno: deixe vazio (usa /me/grades). */
  studentId?: number | null;
  /** Padrão "Últimas notas"; no Painel do responsável, "Notas publicadas". */
  title?: string;
  /** Padrão "Aparecem depois que a docente publica". */
  subtitle?: string;
  /** Quantas mostrar (padrão 3). */
  limit?: number;
  /** Posição na animação de entrada do Painel (delay). */
  order?: number;
  /** Classes a mais no card (ex.: "duo-fill" ou "tall", para esticar junto da coluna do Painel). */
  className?: string;
  /** "Ver todas (N)" ou uma nota: abre a tela Notas, com a avaliação destacada quando vier. */
  onSeeAll: (eventId?: number) => void;
};

/* ------------------------------------------------------------------ */
/* Carregamento                                                        */
/* ------------------------------------------------------------------ */

export type LoadStatus = "idle" | "loading" | "error" | "ready";

export type LoadState<T> = {
  /** idle: nada a carregar (sem key); loading: primeira carga desta key (mostre o esqueleto). */
  status: LoadStatus;
  data: T | null;
  error: unknown;
  /** "Tentar de novo" em andamento. */
  retrying: boolean;
  retry: () => void;
};

type Loaded<T> = { key: string; data: T | null; error: unknown };

/**
 * Carrega um dado da API por chave. Trocar a chave (outro aluno) volta ao esqueleto, para nunca mostrar o dado
 * da chave anterior. Mudar `refresh` busca de novo em silêncio (o que está na tela fica até chegar o novo).
 * `fetcher` precisa ser estável (função do módulo).
 */
export function useApiLoad<T>(
  token: string,
  key: string,
  fetcher: (token: string, key: string) => Promise<T>,
  refresh: unknown = null
): LoadState<T> {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!key) {
      return;
    }
    let alive = true;
    fetcher(token, key).then(
      (data) => {
        if (alive) {
          setLoaded({ key, data, error: null });
          setRetrying(false);
        }
      },
      (error: unknown) => {
        if (alive) {
          // falha numa nova busca silenciosa: o que já estava na tela continua
          setLoaded((previous) => ({ key, data: previous && previous.key === key ? previous.data : null, error }));
          setRetrying(false);
        }
      }
    );
    return () => {
      alive = false;
    };
  }, [token, key, fetcher, attempt, refresh]);

  const current = loaded && loaded.key === key ? loaded : null;
  let status: LoadStatus = "ready";
  if (!key) {
    status = "idle";
  } else if (!current) {
    status = "loading";
  } else if (current.data === null) {
    status = "error";
  }
  return {
    status,
    data: current?.data ?? null,
    error: current?.error ?? null,
    retrying,
    retry: () => {
      setRetrying(true);
      setAttempt((value) => value + 1);
    },
  };
}

function fetchGrades(token: string, key: string) {
  return key === "me" ? getMyGrades(token) : getStudentGrades(token, Number(key));
}

/**
 * Notas publicadas do aluno (GET /me/grades) ou do aluno acompanhado (GET /students/:id/grades, responsável e
 * administração). Busca de novo, sem esqueleto, quando a página recarrega os eventos ou chega um aviso
 * "Nota publicada".
 */
export function useStudentGrades(studentId?: number | null) {
  const { token, role, events, notices } = useAppActions();
  let key = "";
  if (role === "student") {
    key = "me";
  } else if ((role === "guardian" || role === "admin") && studentId) {
    key = String(studentId);
  }
  const gradeNotices = notices
    .filter((notice) => notice.kind === "grades_published")
    .map((notice) => notice.id)
    .join(",");
  // a lista de eventos é outra a cada recarga da página (botão Atualizar, volta da conexão, outro aluno)
  const [refresh, setRefresh] = useState({ events, gradeNotices, tick: 0 });
  if (refresh.events !== events || refresh.gradeNotices !== gradeNotices) {
    setRefresh({ events, gradeNotices, tick: refresh.tick + 1 });
  }
  return useApiLoad<StudentGrades>(token, key, fetchGrades, refresh.tick);
}

/* ------------------------------------------------------------------ */
/* Peças comuns da nota                                                */
/* ------------------------------------------------------------------ */

export type GradeItem = StudentEvaluation & { group: StudentGradeGroup };

/** Avaliações publicadas com nota (com número, falta ou dispensa), da publicação mais recente para a mais antiga. */
export function publishedGrades(data: StudentGrades): GradeItem[] {
  return data.subjects
    .flatMap((group) => group.evaluations.filter((item) => item.published && item.grade).map((item) => ({ ...item, group })))
    .sort((a, b) => {
      const byPublished = new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime();
      return byPublished || new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
    });
}

/** "7,5" e "10" da avaliação (textos da API; centésimos como reserva). */
export function scoreParts(evaluation: StudentEvaluation) {
  const grade = evaluation.grade;
  const score = grade ? (grade.scoreText ?? formatScore(grade.score)) : "";
  const max = evaluation.maxScoreText ?? (evaluation.maxScore !== null ? formatScore(evaluation.maxScore) : "");
  return { score, max };
}

/**
 * O valor da nota: "7,5 de 10" com o número grande, ou a pílula "Falta", "Dispensa" ou "Sem nota"
 * (avaliação publicada sem nota para este aluno).
 */
export function GradeValue({
  as: Tag = "p",
  className,
  evaluation,
}: {
  /** "span" dentro de botão (p não pode ficar dentro de button). */
  as?: "p" | "span";
  className: string;
  evaluation: StudentEvaluation;
}) {
  const grade = evaluation.grade;
  if (!grade || grade.status !== "graded") {
    const label = grade ? gradeStatusLabels[grade.status] : "Sem nota";
    return (
      <Tag className={cx(className, "is-pill")}>
        <span className={cx("pill", grade?.status === "absent" ? "st-alt" : "st-ag")}>{label}</span>
      </Tag>
    );
  }
  const { max, score } = scoreParts(evaluation);
  return (
    <Tag className={className}>
      <b>{score}</b>
      {max ? ` de ${max}` : null}
    </Tag>
  );
}

const two = (value: number) => String(value).padStart(2, "0");

/** "28/10" */
export function dayMonth(value: string) {
  const date = new Date(value);
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}`;
}

/** Nome da disciplina do grupo (ou da turma, na avaliação sem disciplina). */
export function groupSubjectName(group: StudentGradeGroup) {
  return group.subject?.name ?? group.academicClass.name;
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function LatestGradesCard({
  className,
  limit = 3,
  order = 0,
  studentId,
  subtitle = "Aparecem depois que a docente publica",
  title = "Últimas notas",
  onSeeAll,
}: LatestGradesCardProps) {
  const { role, student } = useAppActions();
  const titleId = useId();
  const targetId = role === "guardian" ? (studentId ?? student?.id ?? null) : (studentId ?? null);
  const grades = useStudentGrades(targetId);
  const data = grades.data;
  const list = data && data.shareGrades ? publishedGrades(data) : [];
  const shown = list.slice(0, Math.max(1, limit));
  const name = firstName(data?.student.fullName ?? student?.fullName ?? "O aluno");

  let body;
  if (grades.status === "idle") {
    body = (
      <EmptyState
        compact
        icon={Users}
        text="Nenhum aluno vinculado"
        hint="Vincule um aluno com o código que ele gerou no perfil. As notas publicadas aparecem aqui."
      />
    );
  } else if (grades.status === "loading") {
    body = (
      <div className="notas-last" role="status">
        <span className="sr-only">Carregando notas</span>
        {Array.from({ length: Math.max(1, Math.min(limit, 3)) }, (_, index) => (
          <span key={index} className="notas-last-skel">
            <span className="grid flex-1 gap-2">
              <span className="skel h-3.5 w-3/4" />
              <span className="skel h-3 w-1/3" />
            </span>
            <span className="skel h-6 w-14" />
          </span>
        ))}
      </div>
    );
  } else if (grades.status === "error") {
    body = (
      <div className="empty-inline compact mt-3.5" role="alert">
        <span className="empty-ico bg-[#ffe4e8] text-[#be123c]">
          <TriangleAlert className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Não foi possível carregar as notas</p>
          <p className="mt-0.5 text-sm leading-5 text-muted wrap-anywhere">{errorMessage(grades.error)}</p>
          <RetryButton className={cx(secondaryButton, "btn-sm mt-2.5")} onRetry={grades.retry} retrying={grades.retrying} />
        </div>
      </div>
    );
  } else if (data && !data.shareGrades) {
    body = (
      <div className="mt-3.5">
        <EmptyState
          compact
          icon={Lock}
          text={`${name} não compartilha as notas`}
          hint={`Elas aparecem aqui se ${name} ativar Compartilhar minhas notas no perfil.`}
        />
      </div>
    );
  } else if (!shown.length) {
    const awaiting = data?.counts?.awaiting ?? 0;
    body = (
      <div className="mt-3.5">
        <EmptyState
          compact
          icon={ClipboardCheck}
          text="Nenhuma nota publicada ainda"
          hint={
            awaiting
              ? `${countText(awaiting, "avaliação aguarda", "avaliações aguardam")} a docente publicar. Você recebe um aviso quando sair.`
              : "A nota aparece aqui quando a docente publicar. Você recebe um aviso."
          }
        />
      </div>
    );
  } else {
    body = (
      <ul className="notas-last">
        {shown.map((item) => (
          <li key={item.eventId}>
            <button className="notas-last-btn" onClick={() => onSeeAll(item.eventId)} type="button">
              <span className="min-w-0 flex-1">
                <span className="notas-last-t">{item.title}</span>
                <span className="notas-last-s">
                  {groupSubjectName(item.group)}, {dayMonth(item.startsAt)}
                </span>
              </span>
              <GradeValue as="span" className="notas-last-v" evaluation={item} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const footer =
    grades.status === "idle" ? null : (
      <div className="card-foot">
        <button className="link min-h-6" onClick={() => onSeeAll()} type="button">
          {list.length ? showAllText("Ver todas", list.length) : "Ver notas"}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );

  return (
    <section className={cx("card pad rise flex flex-col", className)} style={delay(order)} aria-labelledby={titleId}>
      <SectionTitle id={titleId} title={title} subtitle={subtitle} />
      {body}
      {footer}
    </section>
  );
}
