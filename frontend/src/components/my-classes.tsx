"use client";

import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  Power,
  RefreshCw,
  School,
  SearchX,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  createJoinCode,
  decideEnrollments,
  disableJoinCode,
  getClass,
  getClassStudents,
  getClasses,
  updateEnrollment,
} from "@/lib/api";
import {
  classPeriodLine,
  classTermLabel,
  countText,
  cx,
  enrollmentSourceText,
  errorMessage,
  formatOnDayAt,
  normalizeText,
} from "@/lib/format";
import { shiftLabels, teachingRoleLabels } from "@/lib/meta";
import type {
  AcademicContext,
  ClassDetail,
  ClassOffer,
  ClassShift,
  ClassStudent,
  ClassSummary,
  JoinCodeResult,
} from "@/lib/types";
import { useAppActions, useBackLayer } from "./app-actions";
import { showAllText } from "./dashboard-bits";
import { Drawer, EmptyState, ErrorState, isOnTopLayer } from "./ui";

/**
 * Aba "Minhas turmas" da Gestão da docente (desenho 5.4, amostra docente-notas-evento: abas "Eventos" e "Minhas
 * turmas"). A lista (GET /classes, só as turmas com vínculo em vigor) abre o painel lateral da turma (GET
 * /classes/:id e /classes/:id/students) com as disciplinas (as da docente em destaque), os alunos só para leitura,
 * com "Aprovar" e "Recusar" nos pedidos de entrada (PATCH /enrollments/:id e o lote /students/decide), e o código
 * da turma (mostrar, gerar novo e desligar). A docente não cria, não arquiva e não exclui turma nem disciplina.
 *
 * Renderizada dentro do card da Gestão (manage-view.tsx), logo abaixo das abas: não tem card próprio.
 * Dona: área Docente.
 */
export type MyClassesProps = {
  context: AcademicContext | null;
  /** Texto da busca do menu: filtra a lista de turmas. */
  search: string;
  /** Turmas e pedidos de entrada carregados (para o número da aba). null enquanto carrega ou com erro. */
  onSummary?: (summary: MyClassesSummary | null) => void;
  /** Quantas turmas a busca do menu acha (undefined sem busca ou enquanto a lista não chegou). */
  onSearchCount?: (count: number | undefined) => void;
};

export type MyClassesSummary = { classes: number; pending: number };

/** Alunos ativos mostrados antes do "Ver todos (N)" no painel da turma. */
const STUDENTS_SHOWN = 8;

type ListState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; classes: ClassSummary[] };

type CountsPatch = { active: number; pending: number };

/** "Matemática", "Matemática e Banco de Dados", "A, B e C". */
function joinNames(names: string[]) {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function shiftText(shift: string) {
  return shiftLabels[shift as ClassShift] ?? (shift ? shift.charAt(0).toUpperCase() + shift.slice(1) : "");
}

function studentName(student: Pick<ClassStudent, "fullName" | "email">) {
  return student.fullName?.trim() || student.email;
}

/** Tratamentos que não entram nas iniciais: Prof., Profa., Dr., Dra. e Dr(a). */
const honorific = /^(prof|profa|profª|dr|dra|dr\(a\))\.?$/i;

/**
 * Iniciais do primeiro e do último nome, sem o tratamento: "Ana Beatriz Rocha" vira "AR" e "Profa. Paula Souza",
 * "PS". Com um nome só, as duas primeiras letras, como o menu ("Profa. Maraísa" vira "MA").
 */
function initials(name: string) {
  const words = name
    .split(/\s+/)
    .filter((word) => word && !honorific.test(word))
    .map((word) => word.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (!words.length) {
    return "?";
  }
  const first = words[0];
  const text = words.length > 1 ? `${first.charAt(0)}${words[words.length - 1].charAt(0)}` : first.slice(0, 2);
  return text.toLocaleUpperCase("pt-BR");
}

/** Pendentes primeiro, depois por nome (a mesma ordem da API). */
function sortStudents(students: ClassStudent[]) {
  return [...students].sort((a, b) => {
    const pendingFirst = Number(b.status === "pending") - Number(a.status === "pending");
    return pendingFirst || studentName(a).localeCompare(studentName(b), "pt-BR");
  });
}

/** "Pediu pelo código na quarta, 04/11, às 20:14". */
function requestedText(student: ClassStudent) {
  const how = student.source === "code" ? "Pediu pelo código" : enrollmentSourceText(student.source);
  return student.createdAt ? `${how} ${formatOnDayAt(student.createdAt)}` : how;
}

/** Disciplinas da docente em cada turma (vínculos em vigor do /context). */
function mySubjectsByClass(context: AcademicContext | null) {
  const map = new Map<number, string[]>();
  for (const assignment of context?.teachingAssignments ?? []) {
    if (assignment.endedAt) {
      continue;
    }
    const name = assignment.subject?.name;
    const list = map.get(assignment.academicClassId) ?? [];
    if (name && !list.includes(name)) {
      list.push(name);
    }
    map.set(assignment.academicClassId, list);
  }
  return map;
}

/**
 * Leva o foco ao elemento assim que ele estiver na camada de cima (a confirmação fechou e o painel voltou a
 * receber foco). Desiste em 3 s.
 */
function focusWhenOnTop(target: () => HTMLElement | null | undefined) {
  let tries = 0;
  let timer = 0;
  const attempt = () => {
    const element = target();
    if (element && isOnTopLayer(element) && !element.closest("[inert]")) {
      element.focus({ preventScroll: false });
      return;
    }
    tries += 1;
    if (tries < 60) {
      timer = window.setTimeout(attempt, 50);
    }
  };
  timer = window.setTimeout(attempt, 30);
  return () => window.clearTimeout(timer);
}

/* ------------------------------------------------------------------ */
/* Lista de turmas                                                     */
/* ------------------------------------------------------------------ */

export function MyClasses({ context, search, onSummary, onSearchCount }: MyClassesProps) {
  const { token } = useAppActions();
  const headingId = useId();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  // mudança feita aqui (aprovar, recusar): uma carga que saiu antes dela não passa por cima do número novo
  const seqRef = useRef(0);

  // carrega ao abrir a Gestão e de novo, sem esqueleto, quando a página recarrega o contexto
  useEffect(() => {
    let alive = true;
    const seq = seqRef.current;
    getClasses(token)
      .then((classes) => {
        if (!alive || seq !== seqRef.current) {
          return;
        }
        setState({ status: "ready", classes });
        setRetrying(false);
      })
      .catch((error: unknown) => {
        if (!alive) {
          return;
        }
        setRetrying(false);
        // com a lista na tela, uma recarga que falha não apaga o que já está ali
        setState((current) => (current.status === "ready" ? current : { status: "error", error }));
      });
    return () => {
      alive = false;
    };
  }, [token, context, attempt]);

  const classes = state.status === "ready" ? state.classes : null;

  useEffect(() => {
    if (!onSummary) {
      return;
    }
    onSummary(
      classes
        ? { classes: classes.length, pending: classes.reduce((sum, item) => sum + item.counts.pendingStudents, 0) }
        : null
    );
  }, [classes, onSummary]);

  const mySubjects = mySubjectsByClass(context);
  const words = normalizeText(search).split(/\s+/).filter(Boolean);
  const term = search.trim();
  const shown = (classes ?? []).filter((item) => {
    if (!words.length) {
      return true;
    }
    const haystack = normalizeText(
      [
        item.name,
        item.course?.name,
        item.course?.code,
        classTermLabel(item, { long: true }),
        item.period,
        item.shift,
        ...(mySubjects.get(item.id) ?? []),
      ]
        .filter(Boolean)
        .join(" ")
    );
    return words.every((word) => haystack.includes(word));
  });
  const openClass = classes?.find((item) => item.id === openId) ?? null;

  // a busca do menu conta as turmas achadas (a página mostra "2 resultados encontrados")
  const searchCount = words.length && classes ? shown.length : undefined;
  useEffect(() => {
    onSearchCount?.(searchCount);
  }, [onSearchCount, searchCount]);

  function patchCounts(classId: number, patch: CountsPatch) {
    seqRef.current += 1;
    setState((current) =>
      current.status === "ready"
        ? {
            status: "ready",
            classes: current.classes.map((item) =>
              item.id === classId
                ? {
                    ...item,
                    counts: {
                      ...item.counts,
                      activeStudents: Math.max(0, item.counts.activeStudents + patch.active),
                      pendingStudents: Math.max(0, item.counts.pendingStudents + patch.pending),
                    },
                  }
                : item
            ),
          }
        : current
    );
  }

  function retry() {
    setRetrying(true);
    setAttempt((value) => value + 1);
  }

  const totalPending = (classes ?? []).reduce((sum, item) => sum + item.counts.pendingStudents, 0);
  let subline: ReactNode;
  if (!classes) {
    subline = state.status === "error" ? "Não foi possível carregar agora." : <span className="skel inline-block h-4 w-48" />;
  } else if (term) {
    subline = `${shown.length} de ${countText(classes.length, "turma", "turmas")} para "${term}"`;
  } else if (classes.length) {
    subline = `${countText(classes.length, "turma", "turmas")}, ${
      totalPending ? countText(totalPending, "pedido de entrada", "pedidos de entrada") : "nenhum pedido de entrada"
    }`;
  } else {
    subline = "Nenhuma turma vinculada a você.";
  }

  let body: ReactNode;
  if (state.status === "loading") {
    body = (
      <div className="docente-turma-list" role="status">
        <span className="sr-only">Carregando suas turmas</span>
        {[0, 1].map((row) => (
          <div key={row} className="docente-turma-row is-skel" aria-hidden>
            <span className="docente-turma-main grid gap-2">
              <span className="skel h-4 w-32" />
              <span className="skel h-3.5 w-64 max-w-full" />
            </span>
            <span className="docente-turma-per grid gap-2">
              <span className="skel h-4 w-16" />
              <span className="skel h-3.5 w-28" />
            </span>
            <span className="docente-turma-num grid gap-2">
              <span className="skel h-4 w-8" />
            </span>
          </div>
        ))}
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div className="px-6 pb-6">
        <ErrorState
          title="Não foi possível carregar suas turmas."
          text={errorMessage(state.error)}
          retrying={retrying}
          onRetry={retry}
        />
      </div>
    );
  } else if (!state.classes.length) {
    body = (
      <div className="px-6 pb-6">
        <EmptyState
          icon={School}
          text="Você ainda não tem turmas vinculadas"
          hint="Peça à secretaria para vincular você a uma disciplina da turma. A turma aparece aqui assim que o vínculo for feito."
        />
      </div>
    );
  } else if (!shown.length) {
    body = (
      <div className="px-6 pb-6">
        <EmptyState
          icon={SearchX}
          text={`Nenhuma turma encontrada para "${term}".`}
          hint="Busque pelo nome da turma, do curso ou da disciplina, ou apague a busca do menu para ver todas."
        />
      </div>
    );
  } else {
    body = (
      <>
        <div className="docente-turma-head" aria-hidden>
          <span>Turma</span>
          <span>Período</span>
          <span>Alunos</span>
          <span />
        </div>
        <ul className="docente-turma-list" aria-labelledby={headingId}>
          {shown.map((item) => {
            const pending = item.counts.pendingStudents;
            const active = item.counts.activeStudents;
            const subjects = mySubjects.get(item.id) ?? [];
            const subjectsText = subjects.length
              ? `${subjects.length === 1 ? "Sua disciplina" : "Suas disciplinas"}: ${joinNames(subjects)}`
              : null;
            // nome falado da linha, na ordem do que se vê (as partes ficam em blocos separados)
            const label = [
              item.name,
              pending ? countText(pending, "pedido de entrada", "pedidos de entrada") : null,
              item.course?.name,
              subjectsText,
              classTermLabel(item, { long: true }),
              classPeriodLine(item),
              countText(active, "aluno ativo", "alunos ativos"),
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <li key={item.id}>
                <button
                  className={cx("docente-turma-row", openId === item.id && "sel")}
                  aria-label={label}
                  aria-haspopup="dialog"
                  onClick={() => setOpenId(item.id)}
                  type="button"
                >
                  <span className="docente-turma-main">
                    <span className="docente-turma-line">
                      <span className="t">{item.name}</span>
                      {pending ? (
                        <span className="pill st-alt">
                          <UserPlus className="h-3 w-3" aria-hidden />
                          {countText(pending, "pedido", "pedidos")}
                        </span>
                      ) : null}
                    </span>
                    {item.course?.name ? <span className="s">{item.course.name}</span> : null}
                    {subjectsText ? (
                      <span className="s docente-turma-subj">
                        <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0">{subjectsText}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="docente-turma-per">
                    <span className="t">{classTermLabel(item)}</span>
                    <span className="s">{classPeriodLine(item)}</span>
                  </span>
                  <span className="docente-turma-num">
                    <span className="t">{active}</span>
                    <span className="s">{active === 1 ? "aluno ativo" : "alunos ativos"}</span>
                  </span>
                  <ChevronRight className="docente-turma-go" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <div className="docente-turmas">
      <div className="px-6 pb-5 pt-[18px]">
        <h2 id={headingId} className="h2">
          Turmas em que você dá aula
        </h2>
        <p className="sub">{subline}</p>
      </div>
      {body}
      <ClassDrawer cls={openClass} onClose={() => setOpenId(null)} onCounts={patchCounts} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Painel da turma                                                     */
/* ------------------------------------------------------------------ */

function ClassDrawer({
  cls,
  onClose,
  onCounts,
}: {
  cls: ClassSummary | null;
  onClose: () => void;
  onCounts: (classId: number, patch: CountsPatch) => void;
}) {
  const open = cls !== null;
  useBackLayer(open, onClose);

  const subtitle = cls ? (
    <>
      {cls.course?.name ? <span className="w-full">{cls.course.name}</span> : null}
      <span className="pill st-ag">{classTermLabel(cls, { long: true })}</span>
      {cls.period ? <span className="pill st-ag">{cls.period}</span> : null}
      {cls.shift ? <span className="pill st-ag">{shiftText(cls.shift)}</span> : null}
    </>
  ) : undefined;

  return (
    <Drawer
      open={open}
      title={cls?.name ?? "Turma"}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <p className="docente-foot-note">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Dados da turma, disciplinas e docentes ficam com a secretaria.
          </p>
          <button className="btn btn-s ml-auto" onClick={onClose} type="button">
            Fechar
          </button>
        </>
      }
    >
      {cls ? <ClassPanelBody key={cls.id} cls={cls} onCounts={onCounts} /> : null}
    </Drawer>
  );
}

type Busy =
  | { kind: "approve" | "reject"; id: number }
  | { kind: "bulk" | "code-on" | "code-new" | "code-off" };

type PanelData = { detail: ClassDetail; students: ClassStudent[] };

function ClassPanelBody({
  cls,
  onCounts,
}: {
  cls: ClassSummary;
  onCounts: (classId: number, patch: CountsPatch) => void;
}) {
  const { token, user, toast, showError, confirm, reload } = useAppActions();
  const ids = {
    offers: useId(),
    students: useId(),
    code: useId(),
    codeHelp: useId(),
  };
  const [data, setData] = useState<PanelData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [codeShown, setCodeShown] = useState(false);
  const studentsRef = useRef<HTMLDivElement>(null);
  const studentsHeadingRef = useRef<HTMLHeadingElement>(null);
  const codeRef = useRef<HTMLParagraphElement>(null);
  const codeActionsRef = useRef<HTMLDivElement>(null);
  // depois de aprovar ou recusar: o índice do pedido que saiu (o foco vai para o pedido que ficou no lugar)
  const focusPendingRef = useRef<number | null>(null);
  // depois de mexer no código: "code" leva ao código novo; "actions" ao primeiro botão do código
  const focusCodeRef = useRef<"code" | "actions" | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getClass(token, cls.id), getClassStudents(token, cls.id)])
      .then(([detail, students]) => {
        if (alive) {
          setData({ detail, students: sortStudents(students) });
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err);
        }
      });
    return () => {
      alive = false;
    };
  }, [token, cls.id, attempt]);

  // foco depois das ações que tiram o botão clicado da tela
  useEffect(() => {
    const pendingIndex = focusPendingRef.current;
    const codeTarget = focusCodeRef.current;
    focusPendingRef.current = null;
    focusCodeRef.current = null;
    if (pendingIndex !== null) {
      return focusWhenOnTop(() => {
        const buttons = studentsRef.current?.querySelectorAll<HTMLElement>("[data-approve]");
        if (buttons?.length) {
          return buttons[Math.min(pendingIndex, buttons.length - 1)];
        }
        return studentsHeadingRef.current;
      });
    }
    if (codeTarget) {
      return focusWhenOnTop(() =>
        codeTarget === "code" ? codeRef.current : codeActionsRef.current?.querySelector<HTMLElement>("button")
      );
    }
  }, [data]);

  function refresh() {
    setAttempt((value) => value + 1);
  }

  /** Pedido que mudou por fora (a secretaria decidiu antes): recarrega o painel. */
  function refreshIfStale(err: unknown) {
    if (err instanceof ApiError && [403, 404, 409].includes(err.status)) {
      refresh();
    }
  }

  if (!data) {
    if (error) {
      return (
        <ErrorState
          title="Não foi possível abrir a turma."
          text={errorMessage(error)}
          onRetry={() => {
            setError(null);
            refresh();
          }}
        />
      );
    }
    return <PanelSkeleton />;
  }

  const isMine = (offer: ClassOffer) => offer.teachers.some((teacher) => teacher.teacherId === user.id);
  const { detail, students } = data;
  const className = detail.name || cls.name;
  const offers = detail.offers
    .filter((offer) => !offer.archivedAt)
    .sort((a, b) => {
      const mine = Number(isMine(b)) - Number(isMine(a));
      return mine || (a.subject?.name ?? "").localeCompare(b.subject?.name ?? "", "pt-BR");
    });
  const mineCount = offers.filter(isMine).length;
  const withoutTeacher = offers.filter((offer) => offer.withoutTeacher).length;
  const pending = students.filter((student) => student.status === "pending");
  const active = students.filter((student) => student.status === "active");
  const visibleActive = showAll ? active : active.slice(0, STUDENTS_SHOWN);
  const chosen = selected.filter((id) => pending.some((student) => student.enrollmentId === id));
  const allChosen = pending.length > 0 && chosen.length === pending.length;
  const codeOn = detail.joinCodeActive && Boolean(detail.joinCodeFormatted ?? detail.joinCode);
  const codeText = detail.joinCodeFormatted ?? detail.joinCode ?? "";

  function updateStudents(change: (list: ClassStudent[]) => ClassStudent[]) {
    setData((current) => (current ? { ...current, students: sortStudents(change(current.students)) } : current));
  }

  function updateCode(result: JoinCodeResult) {
    setData((current) =>
      current
        ? {
            ...current,
            detail: {
              ...current.detail,
              joinCode: result.joinCode,
              joinCodeFormatted: result.joinCodeFormatted,
              joinCodeActive: result.joinCodeActive,
            },
          }
        : current
    );
  }

  async function approve(student: ClassStudent, index: number) {
    if (busy) {
      return;
    }
    const name = studentName(student);
    const key = `pedido-${student.enrollmentId}`;
    setBusy({ kind: "approve", id: student.enrollmentId });
    try {
      const updated = await updateEnrollment(token, student.enrollmentId, { status: "active" });
      focusPendingRef.current = index;
      updateStudents((list) =>
        list.map((item) => (item.enrollmentId === student.enrollmentId ? { ...item, ...updated } : item))
      );
      setSelected((list) => list.filter((id) => id !== student.enrollmentId));
      onCounts(cls.id, { active: 1, pending: -1 });
      toast(`${name} entrou em ${className}.`, { key });
      void reload();
    } catch (err) {
      showError(err, key);
      refreshIfStale(err);
    } finally {
      setBusy(null);
    }
  }

  function reject(student: ClassStudent, index: number) {
    if (busy) {
      return;
    }
    const name = studentName(student);
    const key = `pedido-${student.enrollmentId}`;
    confirm({
      title: `Recusar o pedido de ${name}?`,
      message: `${name} não entra em ${className}. Se foi engano, basta pedir de novo com o código da turma.`,
      confirmLabel: "Recusar pedido",
      cancelLabel: "Manter pedido",
      tone: "danger",
      action: async () => {
        setBusy({ kind: "reject", id: student.enrollmentId });
        try {
          await updateEnrollment(token, student.enrollmentId, { status: "inactive" });
          focusPendingRef.current = index;
          updateStudents((list) => list.filter((item) => item.enrollmentId !== student.enrollmentId));
          setSelected((list) => list.filter((id) => id !== student.enrollmentId));
          onCounts(cls.id, { active: 0, pending: -1 });
          toast(`Pedido de ${name} recusado.`, { key });
          void reload();
        } catch (err) {
          showError(err, key);
          refreshIfStale(err);
        } finally {
          setBusy(null);
        }
      },
    });
  }

  async function approveChosen() {
    if (busy || !chosen.length) {
      return;
    }
    const key = `pedidos-${cls.id}`;
    setBusy({ kind: "bulk" });
    try {
      const result = await decideEnrollments(token, cls.id, chosen, "active");
      const skipped = new Set(result.skipped);
      const approved = chosen.filter((id) => !skipped.has(id));
      focusPendingRef.current = 0;
      updateStudents((list) =>
        list.map((item) => (approved.includes(item.enrollmentId) ? { ...item, status: "active" } : item))
      );
      setSelected([]);
      onCounts(cls.id, { active: approved.length, pending: -approved.length });
      const skippedText = skipped.size
        ? skipped.size === 1
          ? " 1 pedido já tinha sido decidido."
          : ` ${skipped.size} pedidos já tinham sido decididos.`
        : "";
      toast(`${countText(result.updated, "pedido aprovado", "pedidos aprovados")} em ${className}.${skippedText}`, {
        key,
      });
      if (skipped.size) {
        refresh();
      }
      void reload();
    } catch (err) {
      showError(err, key);
      refreshIfStale(err);
    } finally {
      setBusy(null);
    }
  }

  function toggleAll() {
    setSelected(allChosen ? [] : pending.map((student) => student.enrollmentId));
  }

  function toggleOne(id: number) {
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  }

  async function generateCode(kind: "code-on" | "code-new") {
    const key = `codigo-${cls.id}`;
    setBusy({ kind });
    try {
      const result = await createJoinCode(token, cls.id);
      focusCodeRef.current = "code";
      updateCode(result);
      setCodeShown(true);
      toast(
        kind === "code-new"
          ? "Código novo gerado. O anterior parou de valer."
          : `Código de ${className} ligado. Passe para os alunos.`,
        { key }
      );
    } catch (err) {
      showError(err, key);
      refreshIfStale(err);
    } finally {
      setBusy(null);
    }
  }

  function askNewCode() {
    if (busy) {
      return;
    }
    confirm({
      title: "Gerar um código novo?",
      message: `O código ${codeText} para de valer. Quem ainda não entrou em ${className} vai precisar do código novo.`,
      confirmLabel: "Gerar código novo",
      cancelLabel: "Manter código",
      tone: "primary",
      action: () => generateCode("code-new"),
    });
  }

  async function turnOff() {
    if (busy) {
      return;
    }
    const key = `codigo-${cls.id}`;
    setBusy({ kind: "code-off" });
    try {
      const result = await disableJoinCode(token, cls.id);
      focusCodeRef.current = "actions";
      updateCode(result);
      setCodeShown(false);
      toast(`Código de ${className} desligado. Ninguém mais entra com ele.`, { key });
    } catch (err) {
      showError(err, key);
      refreshIfStale(err);
    } finally {
      setBusy(null);
    }
  }

  function copyCode() {
    const key = `codigo-${cls.id}`;
    const fail = () => toast("Não deu para copiar aqui. Selecione o código e copie.", { tone: "info", key });
    if (!navigator.clipboard) {
      fail();
      return;
    }
    navigator.clipboard.writeText(codeText).then(() => toast("Código copiado.", { key }), fail);
  }

  function showCodeFromEmpty() {
    if (codeOn) {
      setCodeShown(true);
      // o código aparece no próximo quadro: rola até ele e leva o foco, para ler e copiar
      window.setTimeout(() => {
        codeRef.current?.scrollIntoView({ block: "center" });
        codeRef.current?.focus({ preventScroll: true });
      }, 30);
    } else {
      void generateCode("code-on");
    }
  }

  const waiting = busy !== null;
  const spin = (match: (current: Busy) => boolean) =>
    busy && match(busy) ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null;

  return (
    <div className="docente-panel">
      {/* Disciplinas e docentes */}
      <section className="docente-dsec" aria-labelledby={ids.offers}>
        <div className="docente-dsec-head">
          <div>
            <h3 id={ids.offers} className="docente-dsec-t">
              Disciplinas e docentes
            </h3>
            <p className="docente-dsec-s">
              {offers.length
                ? [
                    countText(offers.length, "disciplina", "disciplinas"),
                    mineCount ? countText(mineCount, "sua", "suas") : null,
                    withoutTeacher ? `${withoutTeacher} sem docente` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : "Nenhuma disciplina ofertada nesta turma."}
            </p>
          </div>
        </div>
        {offers.length ? (
          <ul className="docente-ofertas">
            {offers.map((offer) => {
              const mine = isMine(offer);
              return (
                <li key={offer.id} className={cx("docente-oferta", mine && "mine", offer.withoutTeacher && "warn")}>
                  <div className="docente-of-top">
                    <span className="docente-of-name">
                      <b>{offer.subject?.name ?? "Disciplina"}</b>
                      {offer.subject?.code ? <span className="docente-code-chip">{offer.subject.code}</span> : null}
                    </span>
                    {mine ? <span className="pill docente-pill-mine">Sua disciplina</span> : null}
                  </div>
                  {offer.withoutTeacher ? (
                    <p className="docente-docs">
                      <span className="pill st-alt">Sem docente</span>
                      <span>A secretaria ainda vai vincular quem dá aula.</span>
                    </p>
                  ) : (
                    <ul className="docente-docs">
                      {offer.teachers.map((teacher) => {
                        const you = teacher.teacherId === user.id;
                        return (
                          <li key={teacher.assignmentId} className="docente-doc">
                            <span className="docente-av-xs" aria-hidden>
                              {initials(teacher.fullName ?? "")}
                            </span>
                            <span>{you ? `${teacher.fullName} (você)` : teacher.fullName}</span>
                            <span className="pill docente-pill-wt">
                              {teachingRoleLabels[teacher.role] ?? teacher.role}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={BookOpen}
            text="Nenhuma disciplina ofertada"
            hint="A secretaria inclui as disciplinas da turma. Fale com ela se faltar alguma."
          />
        )}
      </section>

      {/* Alunos */}
      <section className="docente-dsec" aria-labelledby={ids.students}>
        <div className="docente-dsec-head">
          <div>
            <h3 id={ids.students} ref={studentsHeadingRef} tabIndex={-1} className="docente-dsec-t">
              Alunos
            </h3>
            <p className="docente-dsec-s">
              {`${countText(active.length, "ativo", "ativos")} e ${countText(pending.length, "pedido de entrada", "pedidos de entrada")}`}
            </p>
          </div>
        </div>

        <div ref={studentsRef}>
          {pending.length ? (
            <>
              <p className="docente-group">{`Pedidos de entrada (${pending.length})`}</p>
              <div className="docente-pend-box">
                {pending.length > 1 ? (
                  <div className="docente-bulk">
                    <label className="docente-ck">
                      <input
                        type="checkbox"
                        checked={allChosen}
                        ref={(node) => {
                          if (node) {
                            node.indeterminate = chosen.length > 0 && !allChosen;
                          }
                        }}
                        onChange={toggleAll}
                      />
                      {`Selecionar os ${pending.length}`}
                    </label>
                    <button
                      className="btn btn-s btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                      aria-disabled={!chosen.length || waiting || undefined}
                      aria-busy={busy?.kind === "bulk" || undefined}
                      onClick={() => void approveChosen()}
                      type="button"
                    >
                      {spin((current) => current.kind === "bulk") ?? <Check className="h-4 w-4" aria-hidden />}
                      {chosen.length ? `Aprovar selecionados (${chosen.length})` : "Aprovar selecionados"}
                    </button>
                  </div>
                ) : null}
                <ul>
                  {pending.map((student, index) => {
                    const name = studentName(student);
                    const rowBusy = busy && "id" in busy && busy.id === student.enrollmentId ? busy.kind : null;
                    const nameId = `${ids.students}-pedido-${student.enrollmentId}`;
                    return (
                      <li key={student.enrollmentId} className="docente-prow">
                        {pending.length > 1 ? (
                          // a caixa fica dentro do rótulo com o nome: clicar no nome também marca (alvo maior que 24 px)
                          <label className="docente-p-pick">
                            <input
                              type="checkbox"
                              aria-labelledby={nameId}
                              checked={chosen.includes(student.enrollmentId)}
                              onChange={() => toggleOne(student.enrollmentId)}
                            />
                            <span className="docente-p-main">
                              <span className="docente-p-name" id={nameId}>
                                {name}
                              </span>
                              {student.fullName ? <span className="docente-p-sub">{student.email}</span> : null}
                              <span className="docente-p-sub">{requestedText(student)}</span>
                            </span>
                          </label>
                        ) : (
                          <div className="docente-p-main">
                            <p className="docente-p-name">{name}</p>
                            {student.fullName ? <p className="docente-p-sub">{student.email}</p> : null}
                            <p className="docente-p-sub">{requestedText(student)}</p>
                          </div>
                        )}
                        <div className="docente-p-acts">
                          <button
                            className="btn btn-p btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                            data-approve=""
                            aria-label={`Aprovar ${name}`}
                            aria-disabled={waiting || undefined}
                            aria-busy={rowBusy === "approve" || undefined}
                            onClick={() => void approve(student, index)}
                            type="button"
                          >
                            {rowBusy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                            Aprovar
                          </button>
                          <button
                            className="btn btn-s btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                            aria-label={`Recusar ${name}`}
                            aria-disabled={waiting || undefined}
                            aria-busy={rowBusy === "reject" || undefined}
                            onClick={() => reject(student, index)}
                            type="button"
                          >
                            {rowBusy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                            Recusar
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : null}

          {active.length ? (
            <>
              <p className="docente-group">{`Alunos ativos (${active.length})`}</p>
              <ul className="docente-slist">
                {visibleActive.map((student) => {
                  const name = studentName(student);
                  return (
                    <li key={student.enrollmentId} className="docente-srow">
                      <span className="docente-av-sm" aria-hidden>
                        {initials(name)}
                      </span>
                      <div className="docente-s-main">
                        <p className="docente-s-name">{name}</p>
                        {student.fullName ? <p className="docente-s-mail">{student.email}</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {active.length > STUDENTS_SHOWN ? (
                <button
                  className="link docente-more"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((value) => !value)}
                  type="button"
                >
                  {showAll ? "Mostrar menos" : showAllText("Ver todos", active.length)}
                </button>
              ) : null}
            </>
          ) : null}

          {!pending.length && !active.length ? (
            <EmptyState
              compact
              icon={Users}
              text="Turma sem alunos ainda"
              hint="Passe o código da turma. Quem não está na lista da turma aparece aqui como pedido, para você aprovar."
              action={{ label: codeOn ? "Mostrar código" : "Gerar código", onClick: showCodeFromEmpty }}
            />
          ) : null}
        </div>
      </section>

      {/* Código da turma */}
      <section className="docente-dsec" aria-labelledby={ids.code}>
        <div className="docente-dsec-head">
          <div>
            <h3 id={ids.code} className="docente-dsec-t">
              Código da turma
            </h3>
            <p className="docente-dsec-s">Quem tem o código pede para entrar, e o pedido aparece em Alunos.</p>
          </div>
          <span className={cx("pill shrink-0", codeOn ? "st-conc" : "st-ag")}>{codeOn ? "Ligado" : "Desligado"}</span>
        </div>
        <div className="docente-codebox">
          <span className="mini-ico">
            <KeyRound className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            {codeOn && codeShown ? (
              <>
                <p ref={codeRef} tabIndex={-1} className="docente-code-big">
                  {codeText}
                </p>
                <p className="docente-p-sub">Os alunos digitam esse código no Painel deles.</p>
              </>
            ) : codeOn ? (
              <>
                <p className="docente-p-name">Código escondido</p>
                <p className="docente-p-sub">Mostre só na hora de passar para a turma.</p>
              </>
            ) : (
              <>
                <p className="docente-p-name">Nenhum código ligado</p>
                <p className="docente-p-sub">Ninguém entra na turma por código agora.</p>
              </>
            )}
          </div>
          {codeOn && codeShown ? (
            <button className="btn btn-s btn-sm shrink-0" aria-label={`Copiar o código ${codeText}`} onClick={copyCode} type="button">
              <Copy className="h-4 w-4" aria-hidden />
              Copiar
            </button>
          ) : null}
        </div>
        <div ref={codeActionsRef} className="docente-code-acts">
          {codeOn ? (
            <>
              <button
                className="btn btn-s btn-sm"
                aria-expanded={codeShown}
                onClick={() => setCodeShown((value) => !value)}
                type="button"
              >
                {codeShown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                {codeShown ? "Esconder código" : "Mostrar código"}
              </button>
              <button
                className="btn btn-s btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                aria-disabled={waiting || undefined}
                aria-busy={busy?.kind === "code-new" || undefined}
                aria-describedby={ids.codeHelp}
                onClick={askNewCode}
                type="button"
              >
                {spin((current) => current.kind === "code-new") ?? <RefreshCw className="h-4 w-4" aria-hidden />}
                Gerar novo
              </button>
              <button
                className="btn btn-s btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                aria-disabled={waiting || undefined}
                aria-busy={busy?.kind === "code-off" || undefined}
                onClick={() => void turnOff()}
                type="button"
              >
                {spin((current) => current.kind === "code-off") ?? <Power className="h-4 w-4" aria-hidden />}
                Desligar
              </button>
            </>
          ) : (
            <button
              className="btn btn-p btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              aria-disabled={waiting || undefined}
              aria-busy={busy?.kind === "code-on" || undefined}
              aria-describedby={ids.codeHelp}
              onClick={() => {
                if (!waiting) {
                  void generateCode("code-on");
                }
              }}
              type="button"
            >
              {spin((current) => current.kind === "code-on") ?? <KeyRound className="h-4 w-4" aria-hidden />}
              Gerar código
            </button>
          )}
        </div>
        <p id={ids.codeHelp} className="field-help">
          {codeOn
            ? "Gerar novo faz o código antigo parar de valer."
            : "O código novo já vem ligado. Quem não está na lista da turma entra como pedido, para você aprovar."}
        </p>
      </section>
    </div>
  );
}

/** Esqueleto do painel da turma enquanto os dados chegam (nunca a mensagem de vazio). */
function PanelSkeleton() {
  return (
    <div className="docente-panel" role="status">
      <span className="sr-only">Carregando a turma</span>
      {[0, 1, 2].map((section) => (
        <div key={section} className="docente-dsec grid gap-3" aria-hidden>
          <span className="skel h-5 w-48" />
          <span className="skel h-3.5 w-64 max-w-full" />
          {[0, 1].map((row) => (
            <span key={row} className="flex items-center gap-3">
              <span className="skel h-9 w-9 shrink-0 !rounded-[10px]" />
              <span className="grid flex-1 gap-2">
                <span className="skel h-3.5 w-3/4" />
                <span className="skel h-3 w-1/2" />
              </span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
