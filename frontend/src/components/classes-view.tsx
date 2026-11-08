"use client";

import { ArrowRight, BookOpen, ChevronRight, CircleAlert, Plus, School, Search, UserRound, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getClasses, getCourses, getSubjects, searchUsers } from "@/lib/api";
import { classTermLabel, countText, cx, errorMessage, latestTermLabel, normalizeText } from "@/lib/format";
import type { AcademicContext, ClassSummary, Course, Subject, UserSummary } from "@/lib/types";
import { useAppActions, useBackLayer, type ClassesTarget } from "./app-actions";
import { ClassPanel, NewClassPanel } from "./classes-class-panel";
import { AddOfferPanel, AddStudentsPanel, NewSubjectPanel, OfferPanel, SubjectPanel } from "./classes-panels";
import { plural, useDebounced, useRemote, type PanelApi, type PanelView } from "./classes-shared";
import { StudentPanel } from "./classes-student-panel";
import { SavedPill, showAllText } from "./dashboard-bits";
import { Drawer, EmptyState, ErrorState, Segmented, SegmentedButton, SectionTitle, primaryButton } from "./ui";

/**
 * Tela "Turmas e disciplinas" (só administração; desenho 5.3). Dona: área Admin.
 *
 * Dois cards alinhados (Turmas e Disciplinas); criar e editar no Drawer à direita, com useBackLayer; painel da
 * turma, do aluno, "Nova disciplina" e "Vincular docente" trocam o conteúdo do mesmo painel, com Voltar.
 */
export type ClassesViewProps = {
  context: AcademicContext | null;
  /** Texto da busca do menu: filtra turmas, disciplinas e alunos nesta tela (sem barra de busca própria). */
  search: string;
  /**
   * Pedido para abrir uma turma e, nela, um aluno (?tela=turmas&turma=1&membro=4, o card Pendências ou
   * useAppActions().openClasses). classId null com memberId: só o painel do aluno. Muda a cada pedido (key).
   */
  target: ClassesTarget | null;
  /** Chame assim que tratar o target: a página tira turma e membro do endereço (o F5 não reabre o painel). */
  onTargetHandled: () => void;
  /** Quantos resultados a busca encontra aqui (undefined sem busca): o menu diz "3 resultados encontrados". */
  onSearchCount?: (count: number | undefined) => void;
};

/** Dados das listas da tela, que os conteúdos do painel também usam (cursos e disciplinas). */
export type ClassesData = {
  classes: ClassSummary[];
  archivedClasses: ClassSummary[];
  subjects: Subject[];
  archivedSubjects: Subject[];
  courses: Course[];
};

const CLASS_LIMIT = 8;
const SUBJECT_MIN = 4;
const SUBJECT_MAX = 8;
const STUDENT_SEARCH_LIMIT = 6;

type StackEntry = { id: number; view: PanelView; title?: string; returnKey?: string; scrollTop?: number };

type Swap = { mode: "open" | "push" | "pop"; returnKey?: string; scrollTop?: number };

/** "2026-2" ou "2026-0" (anuais): o valor do filtro de período. */
function termKey(item: Pick<ClassSummary, "year" | "semester">) {
  return `${item.year}-${item.semester || 0}`;
}

/** O período do filtro vale para a turma? "2026/2" traz também as anuais de 2026 (como a API); "2026, anual" só elas. */
function inTerm(item: ClassSummary, key: string) {
  const [year, semester] = key.split("-").map(Number);
  if (item.year !== year) {
    return false;
  }
  return semester === 0 ? !item.semester : !item.semester || item.semester === semester;
}

function classMatches(item: ClassSummary, words: string[]) {
  if (!words.length) {
    return true;
  }
  const haystack = normalizeText(
    [item.name, item.course?.name, item.course?.code, item.period, item.shift, classTermLabel(item, { long: true })].join(" ")
  );
  return words.every((word) => haystack.includes(word));
}

function subjectMatches(item: Subject, words: string[]) {
  if (!words.length) {
    return true;
  }
  const haystack = normalizeText(`${item.name} ${item.code}`);
  return words.every((word) => haystack.includes(word));
}

/** Pendências da turma, para as pílulas da linha e o "2 com pendência". */
function hasPending(item: ClassSummary) {
  return item.counts.pendingStudents > 0 || item.counts.subjectsWithoutTeacher > 0;
}

async function loadLists(token: string): Promise<ClassesData> {
  const [classes, archivedClasses, subjects, archivedSubjects, courses] = await Promise.all([
    getClasses(token),
    getClasses(token, { archived: true }),
    getSubjects(token),
    getSubjects(token, { archived: true }),
    getCourses(token),
  ]);
  return { classes, archivedClasses, subjects, archivedSubjects, courses };
}

/**
 * Linha salva pelo painel: depois que ele fecha, a linha aparece inteira, ganha o foco, pisca o fundo e mostra
 * "Salvo agora" por 6 s (como o evento salvo no Painel).
 */
function useRowReveal() {
  const [request, setRequest] = useState<{ row: string; tick: number } | null>(null);
  const [savedRow, setSavedRow] = useState<string | null>(null);

  useEffect(() => {
    if (!request) {
      return;
    }
    let frame = 0;
    let tries = 0;
    const check = () => {
      tries += 1;
      const element = document.querySelector<HTMLElement>(`[data-row="${request.row}"]`);
      const dialogOpen = Boolean(document.querySelector('[aria-modal="true"]'));
      if ((dialogOpen || !element) && tries < 180) {
        frame = window.requestAnimationFrame(check);
        return;
      }
      setRequest(null);
      if (!element) {
        return;
      }
      setSavedRow(request.row);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      element.focus({ preventScroll: true });
      const from = getComputedStyle(document.documentElement).getPropertyValue("--brand-100").trim() || "#d3eddb";
      element.animate([{ backgroundColor: from }, { backgroundColor: "transparent" }], { duration: 3000, easing: "ease-out" });
    };
    frame = window.requestAnimationFrame(check);
    return () => window.cancelAnimationFrame(frame);
  }, [request]);

  useEffect(() => {
    if (!savedRow) {
      return;
    }
    const timer = window.setTimeout(() => setSavedRow(null), 6000);
    return () => window.clearTimeout(timer);
  }, [savedRow]);

  return {
    savedRow,
    reveal: (row: string) => setRequest((current) => ({ row, tick: (current?.tick ?? 0) + 1 })),
  };
}

export function ClassesView({ search, target, onTargetHandled, onSearchCount }: ClassesViewProps) {
  const actions = useAppActions();
  const { token, user, confirm, reload: reloadPage } = actions;
  const lists = useRemote(`admin:${user.id}:listas`, () => loadLists(token));
  const data = lists.data;

  // filtros do card Turmas
  const [segment, setSegment] = useState<"active" | "archived">("active");
  const [courseFilter, setCourseFilter] = useState("");
  const [termFilter, setTermFilter] = useState("");
  const [allClasses, setAllClasses] = useState(false);
  // card Disciplinas
  const [subjectSegment, setSubjectSegment] = useState<"active" | "archived">("active");
  const [allSubjects, setAllSubjects] = useState(false);

  const words = useMemo(() => normalizeText(search).split(/\s+/).filter(Boolean), [search]);
  const term = search.trim();
  const studentTerm = useDebounced(term.length >= 2 ? term : "", 300);
  const students = useRemote<UserSummary[]>(studentTerm ? `admin:${user.id}:busca-alunos:${normalizeText(studentTerm)}` : null, () =>
    searchUsers(token, { role: "student", q: studentTerm })
  );

  const segmentClasses = useMemo(
    () => (segment === "active" ? (data?.classes ?? []) : (data?.archivedClasses ?? [])),
    [data, segment]
  );
  const courseOptions = useMemo(() => {
    const byId = new Map<number, Course>();
    for (const course of data?.courses ?? []) {
      byId.set(course.id, course);
    }
    for (const item of [...(data?.classes ?? []), ...(data?.archivedClasses ?? [])]) {
      if (item.course && !byId.has(item.course.id)) {
        byId.set(item.course.id, item.course);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [data]);
  const termOptions = useMemo(() => {
    const keys = new Map<string, { year: number; semester: number }>();
    for (const item of segmentClasses) {
      keys.set(termKey(item), { year: item.year, semester: item.semester || 0 });
    }
    return Array.from(keys.entries())
      .sort(([, a], [, b]) => b.year - a.year || (b.semester || 0.5) - (a.semester || 0.5))
      .map(([key, value]) => ({
        key,
        label: value.semester ? `${value.year}/${value.semester}` : `${value.year}, só anuais`,
      }));
  }, [segmentClasses]);

  const filtersActive = Boolean(courseFilter || termFilter);
  const visibleClasses = useMemo(
    () =>
      segmentClasses.filter(
        (item) =>
          (!courseFilter || String(item.courseId) === courseFilter) &&
          (!termFilter || inTerm(item, termFilter)) &&
          classMatches(item, words)
      ),
    [segmentClasses, courseFilter, termFilter, words]
  );
  const shownClasses = allClasses ? visibleClasses : visibleClasses.slice(0, CLASS_LIMIT);

  const segmentSubjects = subjectSegment === "active" ? (data?.subjects ?? []) : (data?.archivedSubjects ?? []);
  const visibleSubjects = segmentSubjects.filter((item) => subjectMatches(item, words));
  // o card Disciplinas acompanha a altura do card Turmas: uma linha a mais que as turmas mostradas, de 4 a 8
  const subjectLimit = Math.min(SUBJECT_MAX, Math.max(SUBJECT_MIN, shownClasses.length + 1));
  const shownSubjects = allSubjects ? visibleSubjects : visibleSubjects.slice(0, subjectLimit);

  const foundStudents = studentTerm ? (students.data ?? []) : [];
  const searchCount = term ? visibleClasses.length + visibleSubjects.length + foundStudents.length : undefined;
  useEffect(() => {
    onSearchCount?.(data ? searchCount : undefined);
  }, [data, searchCount, onSearchCount]);

  /* ---------------------------------------------------------------- */
  /* Painel lateral (um por vez; o conteúdo troca e o Voltar volta)    */
  /* ---------------------------------------------------------------- */

  const [stack, setStack] = useState<StackEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [footerNode, setFooterNode] = useState<HTMLElement | null>(null);
  const [subtitleNode, setSubtitleNode] = useState<HTMLElement | null>(null);
  const seq = useRef(1);
  const swapRef = useRef<Swap | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const top = stack[stack.length - 1] ?? null;
  const open = stack.length > 0;
  const { savedRow, reveal } = useRowReveal();

  // pedido de fora (endereço, card Pendências, aviso): abre a turma e, nela, o aluno
  const [handledKey, setHandledKey] = useState<number | null>(null);
  if (target && target.key !== handledKey) {
    setHandledKey(target.key);
    const entries: StackEntry[] = [];
    if (target.classId) {
      entries.push({ id: -(target.key * 10 + 1), view: { kind: "class", classId: target.classId } });
    }
    if (target.memberId) {
      entries.push({
        id: -(target.key * 10 + 2),
        view: { kind: "student", classId: target.classId ?? null, userId: target.memberId },
        returnKey: undefined,
      });
    }
    if (entries.length) {
      if (entries.length > 1) {
        entries[0].returnKey = `aluno-${target.memberId}`;
      }
      setStack(entries);
    }
  }
  useEffect(() => {
    if (target) {
      onTargetHandled();
    }
  }, [target, onTargetHandled]);

  function bodyElement() {
    return contentRef.current?.closest<HTMLElement>(".drawer-body") ?? null;
  }

  function openPanel(view: PanelView) {
    swapRef.current = { mode: "open" };
    setBusy(false);
    setStack([{ id: seq.current++, view }]);
  }

  function push(view: PanelView, returnKey?: string) {
    const scrollTop = bodyElement()?.scrollTop ?? 0;
    swapRef.current = { mode: "push" };
    setStack((current) => {
      if (!current.length) {
        return [{ id: seq.current++, view }];
      }
      const last = current[current.length - 1];
      return [...current.slice(0, -1), { ...last, returnKey, scrollTop }, { id: seq.current++, view }];
    });
  }

  function popNow() {
    const previous = stack[stack.length - 2];
    if (!previous) {
      closeNow();
      return;
    }
    swapRef.current = { mode: "pop", returnKey: previous.returnKey, scrollTop: previous.scrollTop };
    setBusy(false);
    setStack((current) => current.slice(0, -1));
  }

  function closeNow() {
    setBusy(false);
    setStack([]);
  }

  function discard(run: () => void, many: boolean) {
    confirm({
      title: "Descartar as alterações?",
      message: many
        ? "O que você digitou neste painel ainda não foi salvo e vai se perder."
        : "O que você digitou aqui ainda não foi salvo e vai se perder.",
      confirmLabel: "Descartar",
      cancelLabel: "Continuar editando",
      action: run,
    });
  }

  /** X, Esc e clique fora: fecha tudo, perguntando antes se há rascunho. */
  function requestClose() {
    if (busy) {
      return;
    }
    if (stack.some((entry) => "dirty" in entry.view && entry.view.dirty)) {
      discard(closeNow, true);
      return;
    }
    closeNow();
  }

  /** Voltar (o do painel e o do navegador): volta um conteúdo; no primeiro, fecha. */
  function requestBack() {
    if (busy) {
      return;
    }
    if (stack.length <= 1) {
      requestClose();
      return;
    }
    if (top && "dirty" in top.view && top.view.dirty) {
      discard(popNow, false);
      return;
    }
    popNow();
  }

  useBackLayer(open, requestBack);

  // conteúdo novo: o foco vai para o campo principal dele; ao voltar, para o botão que abriu o que fechou
  const topId = top?.id ?? null;
  useEffect(() => {
    if (topId === null) {
      return;
    }
    const swap = swapRef.current ?? { mode: "open" as const };
    swapRef.current = null;
    let frame = 0;
    let tries = 0;
    const body = bodyElement();
    if (body) {
      body.scrollTop = swap.mode === "pop" ? (swap.scrollTop ?? 0) : 0;
    }
    // onde o foco estava ao trocar: se a pessoa já foi para outro lugar, o foco fica onde ela pôs
    const startFocus = document.activeElement;
    const find = () => {
      const root = contentRef.current;
      if (!root) {
        return null;
      }
      if (swap.mode === "pop" && swap.returnKey) {
        return root.querySelector<HTMLElement>(`[data-return="${swap.returnKey}"]`);
      }
      return root.querySelector<HTMLElement>("[data-panel-focus]");
    };
    const run = () => {
      tries += 1;
      const element = find();
      if (!element && tries < 60) {
        frame = window.requestAnimationFrame(run);
        return;
      }
      const target = element ?? contentRef.current?.querySelector<HTMLElement>("[data-panel-start]");
      // o foco só sai do lugar se ainda estiver no próprio painel (a pessoa não começou a mexer em outro campo)
      const active = document.activeElement;
      const drawer = contentRef.current?.closest<HTMLElement>(".drawer");
      const idle =
        !active || active === document.body || active === drawer || active === startFocus || !drawer?.contains(active);
      if (target && idle && target !== active) {
        target.focus({ preventScroll: swap.mode === "pop" });
        if (swap.mode === "pop") {
          target.scrollIntoView({ block: "nearest" });
        }
      }
    };
    frame = window.requestAnimationFrame(run);
    return () => window.cancelAnimationFrame(frame);
  }, [topId]);

  const api: PanelApi = {
    push,
    back: requestBack,
    close: closeNow,
    replace: (view) => {
      swapRef.current = { mode: "open" };
      setStack((current) => [...current.slice(0, -1), { id: seq.current++, view }]);
    },
    setView: (view) =>
      setStack((current) => (current.length ? [...current.slice(0, -1), { ...current[current.length - 1], view }] : current)),
    setTitle: (title) =>
      setStack((current) =>
        current.length && current[current.length - 1].title !== title
          ? [...current.slice(0, -1), { ...current[current.length - 1], title }]
          : current
      ),
    setBusy,
    changed: (options = {}) => {
      void lists.reload();
      if (options.catalog) {
        void reloadPage();
      }
    },
    saved: (row) => {
      closeNow();
      reveal(row);
    },
    canGoBack: stack.length > 1,
    footer: footerNode,
  };

  function titleOf(entry: StackEntry): string {
    if (entry.title) {
      return entry.title;
    }
    const view = entry.view;
    switch (view.kind) {
      case "class": {
        const found = [...(data?.classes ?? []), ...(data?.archivedClasses ?? [])].find((item) => item.id === view.classId);
        return found?.name ?? "Turma";
      }
      case "newClass":
        return "Nova turma";
      case "subject": {
        const found = [...(data?.subjects ?? []), ...(data?.archivedSubjects ?? [])].find((item) => item.id === view.subjectId);
        return found?.name ?? "Disciplina";
      }
      case "newSubject":
        return "Nova disciplina";
      case "addOffer":
        return "Adicionar disciplina";
      case "offer":
        return "Vincular docente";
      case "addStudents":
        return "Adicionar alunos";
      case "student":
        return view.name ?? "Aluno";
    }
  }

  function renderPanel(entry: StackEntry) {
    const view = entry.view;
    const common = { api, data, subtitle: subtitleNode };
    switch (view.kind) {
      case "class":
        return <ClassPanel {...common} view={view} />;
      case "newClass":
        return <NewClassPanel {...common} view={view} />;
      case "subject":
        return <SubjectPanel {...common} view={view} />;
      case "newSubject":
        return <NewSubjectPanel {...common} view={view} />;
      case "addOffer":
        return <AddOfferPanel {...common} view={view} />;
      case "offer":
        return <OfferPanel {...common} view={view} />;
      case "addStudents":
        return <AddStudentsPanel {...common} view={view} />;
      case "student":
        return <StudentPanel {...common} view={view} />;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Tela                                                              */
  /* ---------------------------------------------------------------- */

  const activeCount = data?.classes.length ?? 0;
  const pendingCount = (data?.classes ?? []).filter(hasPending).length;
  const turmasSub = data
    ? `${countText(activeCount, "ativa", "ativas")}, ${
        pendingCount ? `${pendingCount} com pendência` : "nenhuma com pendência"
      }`
    : "Carregando turmas";
  const subjectsSub = data
    ? subjectSegment === "active"
      ? countText(data.subjects.length, "ativa", "ativas")
      : countText(data.archivedSubjects.length, "arquivada", "arquivadas")
    : "Carregando disciplinas";

  const courseName = courseOptions.find((course) => String(course.id) === courseFilter)?.code;
  const termName = termOptions.find((option) => option.key === termFilter)?.label;

  function clearFilters() {
    setCourseFilter("");
    setTermFilter("");
    setAllClasses(false);
  }

  function classesEmpty() {
    if (term) {
      return (
        <EmptyState
          compact
          icon={Search}
          text={`Nenhuma turma com "${term}"`}
          hint={
            filtersActive
              ? "Limpe os filtros do card ou mude a busca no menu."
              : "Confira o nome da turma ou do curso, ou limpe a busca no menu."
          }
          action={filtersActive ? { label: "Limpar filtros", onClick: clearFilters } : undefined}
        />
      );
    }
    if (segment === "archived") {
      return (
        <EmptyState
          compact
          icon={School}
          text="Nenhuma turma arquivada"
          hint="Ao arquivar uma turma, ela aparece aqui e pode ser restaurada."
          action={{ label: "Ver turmas ativas", onClick: () => setSegment("active") }}
        />
      );
    }
    const where = termName ?? (courseName ? undefined : latestTermLabel(data?.classes ?? []));
    const text = [
      "Nenhuma turma",
      courseName ? `de ${courseName}` : null,
      where ? `em ${where.replace(", só anuais", "")}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <EmptyState
        icon={School}
        text={text}
        hint="Crie a turma e depois adicione as disciplinas e os alunos."
        action={{ label: "Criar turma", onClick: () => openPanel({ kind: "newClass" }) }}
      />
    );
  }

  function subjectsEmpty() {
    if (term) {
      return (
        <EmptyState compact icon={Search} text={`Nenhuma disciplina com "${term}"`} hint="Confira o nome ou o código, ou limpe a busca no menu." />
      );
    }
    if (subjectSegment === "archived") {
      return (
        <EmptyState
          compact
          icon={BookOpen}
          text="Nenhuma disciplina arquivada"
          hint="Disciplina arquivada sai dos seletores e pode ser restaurada aqui."
          action={{ label: "Ver ativas", onClick: () => setSubjectSegment("active") }}
        />
      );
    }
    return (
      <EmptyState
        compact
        icon={BookOpen}
        text="Nenhuma disciplina cadastrada"
        hint="Cadastre as disciplinas para ofertar nas turmas."
        action={{ label: "Criar disciplina", onClick: () => openPanel({ kind: "newSubject" }) }}
      />
    );
  }

  const firstLoad = lists.loading;
  const loadError = !data && lists.error ? lists.error : null;

  return (
    <div className="grid gap-5">
      {loadError ? (
        <ErrorState
          title="Não deu para carregar as turmas"
          text={errorMessage(loadError)}
          onRetry={() => void lists.reload()}
        />
      ) : (
        <div className="duo admin-duo">
          {/* Turmas */}
          <section className="card duo-main admin-turmas" aria-labelledby="turmas-titulo" aria-busy={firstLoad || undefined}>
            <div className="admin-card-head">
              <SectionTitle
                id="turmas-titulo"
                title="Turmas"
                subtitle={turmasSub}
                action={
                  <button className={primaryButton} onClick={() => openPanel({ kind: "newClass" })} type="button">
                    <Plus className="h-4 w-4" aria-hidden />
                    Nova turma
                  </button>
                }
              />
            </div>
            <div className="admin-filters" role="group" aria-label="Filtros das turmas">
              <select
                className="input admin-f-course"
                aria-label="Curso"
                disabled={!data}
                value={courseFilter}
                onChange={(event) => {
                  setCourseFilter(event.target.value);
                  setAllClasses(false);
                }}
              >
                <option value="">Todos os cursos</option>
                {courseOptions.map((course) => (
                  <option key={course.id} value={String(course.id)}>
                    {course.name}
                  </option>
                ))}
              </select>
              <select
                className="input admin-f-term"
                aria-label="Período"
                disabled={!data}
                value={termFilter}
                onChange={(event) => {
                  setTermFilter(event.target.value);
                  setAllClasses(false);
                }}
              >
                <option value="">Todos os períodos</option>
                {termOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
                {termFilter && !termOptions.some((option) => option.key === termFilter) ? (
                  <option value={termFilter}>{termFilter.replace("-", "/")}</option>
                ) : null}
              </select>
              {filtersActive ? (
                <button className="link admin-clear" onClick={clearFilters} type="button">
                  Limpar filtros
                </button>
              ) : null}
              <div className="admin-seg">
                <Segmented label="Situação das turmas">
                  <SegmentedButton
                    active={segment === "active"}
                    label={`Ativas (${data?.classes.length ?? 0})`}
                    onClick={() => {
                      setSegment("active");
                      setTermFilter("");
                      setAllClasses(false);
                    }}
                  />
                  <SegmentedButton
                    active={segment === "archived"}
                    label={`Arquivadas (${data?.archivedClasses.length ?? 0})`}
                    onClick={() => {
                      setSegment("archived");
                      setTermFilter("");
                      setAllClasses(false);
                    }}
                  />
                </Segmented>
              </div>
            </div>

            {firstLoad ? (
              <div className="admin-rows-pad">
                <ClassRowsSkeleton />
              </div>
            ) : shownClasses.length ? (
              <>
                <div className="admin-thead" aria-hidden>
                  <span>Turma</span>
                  <span>Período</span>
                  <span>Alunos</span>
                  <span />
                </div>
                <ul className="admin-rows" aria-label={segment === "active" ? "Turmas ativas" : "Turmas arquivadas"}>
                  {shownClasses.map((item) => (
                    <li key={item.id}>
                      <ClassRow
                        item={item}
                        saved={savedRow === `class-${item.id}`}
                        onOpen={() => openPanel({ kind: "class", classId: item.id })}
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="admin-rows-pad">{classesEmpty()}</div>
            )}

            {!firstLoad && visibleClasses.length > CLASS_LIMIT ? (
              <div className="card-foot admin-card-foot">
                <button className="link" aria-expanded={allClasses} onClick={() => setAllClasses((value) => !value)} type="button">
                  {allClasses ? "Mostrar menos" : showAllText("Ver todas", visibleClasses.length)}
                  <ArrowRight className={cx("h-[15px] w-[15px]", allClasses && "-rotate-90")} aria-hidden />
                </button>
              </div>
            ) : null}
          </section>

          {/* Disciplinas */}
          <section className="card pad duo-side admin-disc" aria-labelledby="disciplinas-titulo" aria-busy={firstLoad || undefined}>
            <SectionTitle
              id="disciplinas-titulo"
              title="Disciplinas"
              subtitle={subjectsSub}
              action={
                <button className={primaryButton} onClick={() => openPanel({ kind: "newSubject" })} type="button">
                  <Plus className="h-4 w-4" aria-hidden />
                  Nova disciplina
                </button>
              }
            />
            {firstLoad ? (
              <div className="mt-3.5">
                <ClassRowsSkeleton compact />
              </div>
            ) : shownSubjects.length ? (
              <ul className="admin-dlist" aria-label={subjectSegment === "active" ? "Disciplinas ativas" : "Disciplinas arquivadas"}>
                {shownSubjects.map((item) => (
                  <li key={item.id}>
                    <button
                      className="admin-drow"
                      data-row={`subject-${item.id}`}
                      onClick={() => openPanel({ kind: "subject", subjectId: item.id })}
                      type="button"
                    >
                      <span className="admin-d-main">
                        <span className="admin-d-t">{item.name}</span>
                        <span className={cx("admin-d-s", !item.usedIn && subjectSegment === "active" && "none")}>
                          <span className="admin-code">{item.code}</span>
                          {subjectSegment === "archived"
                            ? "arquivada"
                            : item.usedIn
                              ? `usada em ${plural(item.usedIn, "turma", "turmas")}`
                              : "ainda sem turma"}
                        </span>
                        {savedRow === `subject-${item.id}` ? (
                          <span className="mt-1.5 flex">
                            <SavedPill />
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight className="admin-go" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3.5">{subjectsEmpty()}</div>
            )}
            {!firstLoad ? (
              <div className="card-foot">
                {visibleSubjects.length > subjectLimit ? (
                  <button className="link" aria-expanded={allSubjects} onClick={() => setAllSubjects((value) => !value)} type="button">
                    {allSubjects ? "Mostrar menos" : showAllText("Ver todas", visibleSubjects.length)}
                    <ArrowRight className={cx("h-[15px] w-[15px]", allSubjects && "-rotate-90")} aria-hidden />
                  </button>
                ) : (
                  <span />
                )}
                <button
                  className="link admin-link-muted"
                  onClick={() => {
                    setSubjectSegment((value) => (value === "active" ? "archived" : "active"));
                    setAllSubjects(false);
                  }}
                  type="button"
                >
                  {subjectSegment === "active"
                    ? `Arquivadas (${data?.archivedSubjects.length ?? 0})`
                    : `Ativas (${data?.subjects.length ?? 0})`}
                </button>
              </div>
            ) : null}
          </section>
        </div>
      )}

      {/* Busca do menu: alunos com o nome ou o e-mail */}
      {studentTerm && data ? (
        <section className="card pad" aria-labelledby="busca-alunos-titulo" aria-busy={students.loading || undefined}>
          <SectionTitle
            id="busca-alunos-titulo"
            title="Alunos"
            subtitle={
              students.loading
                ? "Buscando alunos"
                : foundStudents.length
                  ? `${plural(foundStudents.length, "aluno encontrado", "alunos encontrados")} com "${studentTerm}"`
                  : `Nenhum aluno com "${studentTerm}"`
            }
          />
          {students.loading ? (
            <div className="mt-3.5">
              <ClassRowsSkeleton compact />
            </div>
          ) : students.error ? (
            <p className="field-error mt-3.5" role="alert">
              <CircleAlert aria-hidden />
              <span>{errorMessage(students.error)}</span>
            </p>
          ) : foundStudents.length ? (
            <ul className="admin-people mt-3.5">
              {foundStudents.slice(0, STUDENT_SEARCH_LIMIT * 4).map((person) => (
                <li key={person.id}>
                  <button
                    className="admin-srow"
                    onClick={() => openPanel({ kind: "student", classId: null, userId: person.id, name: person.fullName ?? undefined })}
                    type="button"
                  >
                    <span className="admin-av-sm" aria-hidden>
                      <UserRound className="h-4 w-4" />
                    </span>
                    <span className="admin-s-main">
                      <span className="admin-s-name">{person.fullName ?? person.email}</span>
                      <span className="admin-s-mail">{person.email}</span>
                    </span>
                    <ChevronRight className="admin-go" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3.5">
              <EmptyState
                compact
                icon={Users}
                text="Nenhum aluno encontrado"
                hint="Confira o nome ou o e-mail. Quem ainda não tem conta entra pela lista de e-mails da turma, em Adicionar alunos."
              />
            </div>
          )}
        </section>
      ) : null}

      <Drawer
        open={open}
        title={top ? titleOf(top) : ""}
        subtitle={<span ref={setSubtitleNode} className="contents" />}
        footer={<div ref={setFooterNode} className="admin-foot-slot" />}
        onClose={requestClose}
        busy={busy}
      >
        {top ? (
          <div ref={contentRef} key={top.id} className="admin-panel">
            {renderPanel(top)}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function ClassRow({ item, saved, onOpen }: { item: ClassSummary; saved: boolean; onOpen: () => void }) {
  const archived = Boolean(item.archivedAt);
  return (
    <button className="admin-row" data-row={`class-${item.id}`} onClick={onOpen} type="button">
      <span className="admin-c-main">
        <span className="admin-t-line">
          <span className="admin-t">{item.name}</span>
          {archived ? <span className="pill st-ag">Arquivada</span> : null}
          {!archived && item.counts.pendingStudents ? (
            <span className="pill st-alt">
              <Users className="h-3 w-3" aria-hidden />
              {plural(item.counts.pendingStudents, "pedido", "pedidos")}
            </span>
          ) : null}
          {!archived && item.counts.subjectsWithoutTeacher ? (
            <span className="pill st-alt">
              <CircleAlert className="h-3 w-3" aria-hidden />
              {plural(item.counts.subjectsWithoutTeacher, "disciplina sem docente", "disciplinas sem docente")}
            </span>
          ) : null}
          {saved ? <SavedPill /> : null}
        </span>
        <span className="admin-s">{item.course?.name}</span>
      </span>
      <span className="admin-c-term">
        <span className="admin-t">{classTermLabel(item)}</span>
        <span className="admin-s">{[item.period, item.shift?.toLocaleLowerCase("pt-BR")].filter(Boolean).join(", ")}</span>
      </span>
      <span className="admin-c-num">
        <span className="admin-t">{item.counts.activeStudents}</span>
        <span className="admin-s">{item.counts.activeStudents === 1 ? "ativo" : "ativos"}</span>
      </span>
      <ChevronRight className="admin-go" aria-hidden />
    </button>
  );
}

function ClassRowsSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="admin-skel" role="status">
      <span className="sr-only">Carregando</span>
      {Array.from({ length: compact ? 4 : 3 }, (_, index) => (
        <span key={index} className="admin-skel-row">
          <span className="grid flex-1 gap-2">
            <span className="skel h-4 w-1/3" />
            <span className="skel h-3 w-2/3" />
          </span>
          {compact ? null : <span className="skel hidden h-8 w-24 sm:block" />}
        </span>
      ))}
    </div>
  );
}
