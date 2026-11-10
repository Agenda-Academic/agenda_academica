"use client";

import { ArrowRight, BookOpen, ChevronRight, CircleAlert, Plus, School, Search, UserRound, Users } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getClasses, getCourses, getSubjects, searchUsers } from "@/lib/api";
import { classTermLabel, countText, cx, errorMessage, latestTermLabel, normalizeText } from "@/lib/format";
import type { AcademicContext, ClassSummary, Course, Subject, UserSummary } from "@/lib/types";
import { useAppActions, useBackLayer, type ClassesTarget } from "./app-actions";
import { ClassPanel, NewClassPanel } from "./classes-class-panel";
import { AddOfferPanel, AddStudentsPanel, NewSubjectPanel, OfferPanel, SubjectPanel } from "./classes-panels";
import { plural, refreshRemotes, useDebounced, useRemote, type PanelApi, type PanelView } from "./classes-shared";
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

/** Linha recém-salva que fica à vista na lista, mesmo fora dos primeiros itens ou dos filtros de agora. */
type Pin = { kind: "class" | "subject"; id: number; sig: string };

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
 * Roda `task` a cada quadro até ela devolver true, por até `limit` quadros. Para assim que a pessoa usa o
 * teclado ou o mouse: daí em diante o foco fica onde ela puser. Devolve a função que para.
 */
function whileIdle(task: () => boolean, limit = 120) {
  let frame = 0;
  let tries = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    document.removeEventListener("keydown", stop, true);
    document.removeEventListener("pointerdown", stop, true);
  };
  document.addEventListener("keydown", stop, true);
  document.addEventListener("pointerdown", stop, true);
  const run = () => {
    if (stopped) {
      return;
    }
    tries += 1;
    if (task() || tries >= limit) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(run);
  };
  frame = window.requestAnimationFrame(run);
  return stop;
}

/** O foco se perdeu: está no body, no próprio painel ou no conteúdo da tela, e não num item. */
function focusLost() {
  const active = document.activeElement;
  return (
    !active ||
    active === document.body ||
    !active.isConnected ||
    (active instanceof HTMLElement && active.matches(".drawer, .modal-box, main"))
  );
}

/** Chama `done` quando a confirmação aberta agora fechar (a confirmação é um portal no body). */
function afterConfirmCloses(done: () => void) {
  let seen = false;
  const observer = new MutationObserver(() => check());
  const giveUp = window.setTimeout(() => {
    if (!seen) {
      observer.disconnect();
    }
  }, 3000);
  function check() {
    const open = Boolean(document.querySelector('[role="alertdialog"]'));
    if (open) {
      seen = true;
      return;
    }
    if (seen) {
      observer.disconnect();
      window.clearTimeout(giveUp);
      done();
    }
  }
  observer.observe(document.body, { childList: true });
  check();
}

/**
 * Linha salva pelo painel: depois que ele fecha, a linha aparece inteira, ganha o foco, pisca o fundo e mostra
 * "Salvo agora" por 6 s (como o evento salvo no Painel). A lista recarrega antes: a busca espera a linha por até
 * 10 s.
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
      if ((dialogOpen || !element) && tries < 600) {
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

/**
 * No celular o painel ocupa a tela, e os avisos ficam logo acima do rodapé dele, por cima do corpo. O corpo
 * ganha embaixo o espaço dos avisos (--admin-toast-room, em admin.css), para o fim do conteúdo rolar até acima
 * deles, e o item com o foco que ficou embaixo de um aviso sobe. Os botões do rodapé ficam sempre livres (os
 * avisos ficam acima dele).
 */
function useToastRoom(open: boolean, contentRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) {
      return;
    }
    let frame = 0;
    let lastBody: HTMLElement | null = null;
    const measure = () => {
      frame = 0;
      const body = contentRef.current?.closest<HTMLElement>(".drawer-body") ?? null;
      if (!body) {
        return;
      }
      lastBody = body;
      const area = body.getBoundingClientRect();
      let top = Infinity;
      for (const toast of Array.from(document.querySelectorAll<HTMLElement>(".toast-stack:not(.held) .toast"))) {
        const box = toast.getBoundingClientRect();
        if (box.height && box.left < area.right && box.right > area.left && box.top < area.bottom && box.bottom > area.top) {
          top = Math.min(top, box.top);
        }
      }
      const room = top === Infinity ? 0 : Math.ceil(area.bottom - top) + 12;
      body.style.setProperty("--admin-toast-room", `${room}px`);
      const active = document.activeElement;
      if (room && active instanceof HTMLElement && body.contains(active) && active !== body) {
        const box = active.getBoundingClientRect();
        const below = box.bottom + 12 - top;
        if (below > 0) {
          // sem levar o começo do item para cima do topo da área que rola
          body.scrollBy({ top: Math.min(below, Math.max(0, box.top - area.top - 12)) });
        }
      }
    };
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(measure);
      }
    };
    const stack = document.querySelector<HTMLElement>(".toast-stack");
    const mutations = new MutationObserver(schedule);
    const sizes = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (stack) {
      mutations.observe(stack, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
      sizes?.observe(stack);
    }
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes?.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      lastBody?.style.removeProperty("--admin-toast-room");
    };
  }, [open, contentRef]);
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
  // linha recém-salva, à vista mesmo fora dos primeiros itens (vale enquanto os filtros forem os mesmos)
  const [pin, setPin] = useState<Pin | null>(null);
  const newClassRef = useRef<HTMLButtonElement>(null);
  const newSubjectRef = useRef<HTMLButtonElement>(null);

  const words = useMemo(() => normalizeText(search).split(/\s+/).filter(Boolean), [search]);
  const term = search.trim();
  const studentTerm = useDebounced(term.length >= 2 ? term : "", 300);
  const students = useRemote<UserSummary[]>(studentTerm ? `admin:${user.id}:busca-alunos:${normalizeText(studentTerm)}` : null, () =>
    searchUsers(token, { role: "student", q: studentTerm })
  );

  const classSig = `${segment}|${courseFilter}|${termFilter}|${search}`;
  const subjectSig = `${subjectSegment}|${search}`;

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
  const pinnedClass =
    pin?.kind === "class" && pin.sig === classSig ? (segmentClasses.find((item) => item.id === pin.id) ?? null) : null;
  const baseClasses = allClasses ? visibleClasses : visibleClasses.slice(0, CLASS_LIMIT);
  const shownClasses =
    pinnedClass && !baseClasses.some((item) => item.id === pinnedClass.id) ? [...baseClasses, pinnedClass] : baseClasses;

  const segmentSubjects = subjectSegment === "active" ? (data?.subjects ?? []) : (data?.archivedSubjects ?? []);
  const visibleSubjects = segmentSubjects.filter((item) => subjectMatches(item, words));
  // o card Disciplinas acompanha a altura do card Turmas: uma linha a mais que as turmas mostradas, de 4 a 8
  const subjectLimit = Math.min(SUBJECT_MAX, Math.max(SUBJECT_MIN, shownClasses.length + 1));
  const pinnedSubject =
    pin?.kind === "subject" && pin.sig === subjectSig ? (segmentSubjects.find((item) => item.id === pin.id) ?? null) : null;
  const baseSubjects = allSubjects ? visibleSubjects : visibleSubjects.slice(0, subjectLimit);
  const shownSubjects =
    pinnedSubject && !baseSubjects.some((item) => item.id === pinnedSubject.id)
      ? [...baseSubjects, pinnedSubject]
      : baseSubjects;

  const foundStudents = studentTerm ? (students.data ?? []) : [];
  const searchCount = term ? visibleClasses.length + visibleSubjects.length + foundStudents.length : undefined;
  useEffect(() => {
    onSearchCount?.(data ? searchCount : undefined);
  }, [data, searchCount, onSearchCount]);

  // busca do menu: o card com resultado vem primeiro (no celular, "Ver 1 resultado" não deixa o resultado
  // embaixo de dois cards vazios)
  const classesHit = visibleClasses.length > 0;
  const subjectsHit = visibleSubjects.length > 0;
  const studentsFirst = Boolean(term) && Boolean(data) && !classesHit && !subjectsHit && foundStudents.length > 0;
  const subjectsFirst = Boolean(term) && Boolean(data) && !classesHit && subjectsHit;

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
  // o último campo que teve o foco no conteúdo de agora: o Voltar do navegador com rascunho volta para ele
  const lastFieldRef = useRef<HTMLElement | null>(null);
  const top = stack[stack.length - 1] ?? null;
  const open = stack.length > 0;
  const { savedRow, reveal } = useRowReveal();
  useToastRoom(open, contentRef);

  // Excluiu a turma ou a disciplina (api.removed): a tela recarrega só depois que o painel fechou. Fechado, o
  // conteúdo dele já parou de acompanhar o que saiu (a turma, os alunos e os convites dela) e nada disso é pedido
  // de novo à API, o que daria 404
  const refreshWhenClosed = useRef(false);
  useEffect(() => {
    if (open || !refreshWhenClosed.current) {
      return;
    }
    refreshWhenClosed.current = false;
    void refreshRemotes("admin:");
    void reloadPage();
  }, [open, reloadPage]);

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

  function drawerElement() {
    return contentRef.current?.closest<HTMLElement>(".drawer") ?? null;
  }

  /**
   * Antes de trocar o conteúdo, o foco passa para o próprio painel: o botão que foi clicado sai junto com o
   * conteúdo, e o foco não cai no body nem num botão do rodapé novo. Depois da troca, o efeito abaixo leva o foco
   * para o lugar certo.
   */
  function holdFocus() {
    const drawer = drawerElement();
    if (drawer && drawer.contains(document.activeElement)) {
      drawer.focus({ preventScroll: true });
    }
  }

  function openPanel(view: PanelView) {
    swapRef.current = { mode: "open" };
    setBusy(false);
    setStack([{ id: seq.current++, view }]);
  }

  function push(view: PanelView, returnKey?: string) {
    const scrollTop = bodyElement()?.scrollTop ?? 0;
    swapRef.current = { mode: "push" };
    holdFocus();
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
    holdFocus();
    setBusy(false);
    setStack((current) => current.slice(0, -1));
  }

  function closeNow() {
    setBusy(false);
    setStack([]);
  }

  /** O controle que pediu para fechar (o X, o Cancelar) ou, sem ele, o X do painel. */
  function closingControl() {
    const active = document.activeElement;
    const drawer = drawerElement();
    if (active instanceof HTMLElement && drawer?.contains(active) && active !== drawer) {
      return active;
    }
    return drawer?.querySelector<HTMLElement>(".drawer-head button") ?? null;
  }

  /** O campo em edição no conteúdo de agora ou, sem ele, o título do conteúdo. */
  function editingTarget() {
    const field = lastFieldRef.current;
    if (field?.isConnected && contentRef.current?.contains(field) && !field.matches(":disabled")) {
      return field;
    }
    return contentRef.current?.querySelector<HTMLElement>("[data-panel-start]") ?? null;
  }

  /**
   * Pergunta antes de descartar. "Continuar editando" (ou Esc) devolve o foco a `returnTo`: o X ou o botão que
   * pediu, ou o campo em edição quando quem pediu foi o Voltar do navegador.
   */
  function discard(run: () => void, many: boolean, returnTo: HTMLElement | null) {
    // a confirmação devolve o foco para quem tinha o foco quando ela abriu
    if (returnTo?.isConnected && document.activeElement !== returnTo) {
      returnTo.focus({ preventScroll: true });
    }
    let decided = false;
    confirm({
      title: "Descartar as alterações?",
      message: many
        ? "O que você digitou neste painel ainda não foi salvo e vai se perder."
        : "O que você digitou aqui ainda não foi salvo e vai se perder.",
      confirmLabel: "Descartar",
      cancelLabel: "Continuar editando",
      action: () => {
        decided = true;
        run();
      },
    });
    afterConfirmCloses(() => {
      if (decided || !returnTo) {
        return;
      }
      // por meio segundo, o foco que cair no body ou no próprio painel volta para returnTo
      whileIdle(() => {
        if (returnTo.isConnected && document.activeElement !== returnTo && focusLost()) {
          returnTo.focus({ preventScroll: true });
        }
        return !returnTo.isConnected;
      }, 30);
    });
  }

  /** X, Esc, clique fora e Cancelar: fecha tudo, perguntando antes se há rascunho. */
  function requestClose(returnTo?: HTMLElement | null) {
    if (busy) {
      return;
    }
    if (stack.some((entry) => "dirty" in entry.view && entry.view.dirty)) {
      discard(closeNow, true, returnTo ?? closingControl());
      return;
    }
    closeNow();
  }

  /** Voltar (o do painel e o do navegador): volta um conteúdo; no primeiro, fecha. */
  function requestBack(fromHistory = false) {
    if (busy) {
      return;
    }
    const returnTo = fromHistory ? editingTarget() : closingControl();
    if (stack.length <= 1) {
      requestClose(returnTo);
      return;
    }
    if (top && "dirty" in top.view && top.view.dirty) {
      discard(popNow, false, returnTo);
      return;
    }
    popNow();
  }

  useBackLayer(open, () => requestBack(true));

  // conteúdo novo: o foco vai para o primeiro campo (data-panel-focus) ou para o título dele (data-panel-start);
  // ao voltar, para o botão ou a linha que abriu o conteúdo que fechou (data-return). Enquanto o conteúdo carrega,
  // o título fica com o foco e o campo recebe quando chegar. O foco só sai do lugar se a pessoa ainda não usou o
  // teclado nem o mouse depois da troca
  const topId = top?.id ?? null;
  useEffect(() => {
    if (topId === null) {
      return;
    }
    const swap = swapRef.current ?? { mode: "open" as const };
    swapRef.current = null;
    lastFieldRef.current = null;
    const body = contentRef.current?.closest<HTMLElement>(".drawer-body");
    if (body) {
      body.scrollTop = swap.mode === "pop" ? (swap.scrollTop ?? 0) : 0;
    }
    return whileIdle(() => {
      const root = contentRef.current;
      if (!root) {
        return false;
      }
      const wanted =
        swap.mode === "pop" && swap.returnKey
          ? root.querySelector<HTMLElement>(`[data-return="${swap.returnKey}"]`)
          : root.querySelector<HTMLElement>("[data-panel-focus]");
      const start = root.querySelector<HTMLElement>("[data-panel-start]");
      const loading = Boolean(root.querySelector('[aria-busy="true"], .admin-skel'));
      const goal = wanted ?? start;
      if (!goal) {
        return false;
      }
      if (document.activeElement !== goal) {
        goal.focus({ preventScroll: swap.mode === "pop" });
        if (swap.mode === "pop" && goal === wanted) {
          goal.scrollIntoView({ block: "nearest" });
        }
      }
      // pronto quando o foco ficou no que se queria, ou no título depois de carregar
      return document.activeElement === goal && (goal === wanted || !loading);
    });
  }, [topId]);

  /** Depois de excluir: quando a linha sai da lista, o foco que caiu no body vai para "Nova turma" ou "Nova disciplina". */
  function focusAfterRemoval(row: string) {
    const button = row.startsWith("subject-") ? newSubjectRef : newClassRef;
    whileIdle(() => {
      if (document.querySelector('[aria-modal="true"]') || document.querySelector(`[data-row="${row}"]`)) {
        return false;
      }
      if (focusLost()) {
        button.current?.focus();
      }
      return true;
    }, 600);
  }

  const api: PanelApi = {
    push,
    back: () => requestBack(false),
    close: closeNow,
    cancel: () => requestClose(),
    removed: (kind) => {
      refreshWhenClosed.current = true;
      closeNow();
      const id = top?.view.kind === "class" ? top.view.classId : top?.view.kind === "subject" ? top.view.subjectId : null;
      focusAfterRemoval(`${kind}-${id ?? ""}`);
    },
    replace: (view) => {
      swapRef.current = { mode: "open" };
      holdFocus();
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
    // a lista, o painel aberto e o card Pendências recarregam (inclusive depois do Desfazer de um aviso antigo)
    changed: (options = {}) => {
      void refreshRemotes("admin:");
      if (options.catalog) {
        void reloadPage();
      }
    },
    saved: (row) => {
      closeNow();
      showRow(row);
    },
    canGoBack: stack.length > 1,
    footer: footerNode,
  };

  /** A linha salva fica à vista (a lista volta para as ativas e, se preciso, mostra a linha no fim) e é destacada. */
  function showRow(row: string) {
    const [kind, raw] = row.split("-");
    const id = Number(raw);
    if (kind === "class") {
      if (segment !== "active") {
        setSegment("active");
        setTermFilter("");
      }
      setPin({ kind: "class", id, sig: `active|${courseFilter}|${segment === "active" ? termFilter : ""}|${search}` });
    } else if (kind === "subject") {
      if (subjectSegment !== "active") {
        setSubjectSegment("active");
      }
      setPin({ kind: "subject", id, sig: `active|${search}` });
    }
    reveal(row);
  }

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

  const classesCard = (
    <section className="card duo-main admin-turmas" aria-labelledby="turmas-titulo" aria-busy={firstLoad || undefined}>
      <div className="admin-card-head admin-head">
        <SectionTitle id="turmas-titulo" title="Turmas" subtitle={turmasSub} />
        <button ref={newClassRef} className={primaryButton} onClick={() => openPanel({ kind: "newClass" })} type="button">
          <Plus className="h-4 w-4" aria-hidden />
          Nova turma
        </button>
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
            {/* sem contagem enquanto a lista carrega: "Ativas (0)" diria que não há nenhuma */}
            <SegmentedButton
              active={segment === "active"}
              label={data ? `Ativas (${data.classes.length})` : "Ativas"}
              onClick={() => {
                setSegment("active");
                setTermFilter("");
                setAllClasses(false);
              }}
            />
            <SegmentedButton
              active={segment === "archived"}
              label={data ? `Arquivadas (${data.archivedClasses.length})` : "Arquivadas"}
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
  );

  const subjectsCard = (
    <section className="card pad duo-side admin-disc" aria-labelledby="disciplinas-titulo" aria-busy={firstLoad || undefined}>
      {/* o título e o botão numa linha, como no card Turmas: a lista começa logo abaixo */}
      <div className="admin-head">
        <SectionTitle id="disciplinas-titulo" title="Disciplinas" subtitle={subjectsSub} />
        <button ref={newSubjectRef} className={primaryButton} onClick={() => openPanel({ kind: "newSubject" })} type="button">
          <Plus className="h-4 w-4" aria-hidden />
          Nova disciplina
        </button>
      </div>
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
      {!firstLoad && data ? (
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
            {subjectSegment === "active" ? `Arquivadas (${data.archivedSubjects.length})` : `Ativas (${data.subjects.length})`}
          </button>
        </div>
      ) : null}
    </section>
  );

  const studentsCard =
    studentTerm && data ? (
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
    ) : null;

  return (
    <div className="grid gap-5">
      {/* Busca do menu com aluno encontrado e nenhuma turma ou disciplina: o card Alunos vem primeiro */}
      {studentsFirst ? studentsCard : null}

      {loadError ? (
        <ErrorState
          title="Não deu para carregar as turmas"
          text={errorMessage(loadError)}
          onRetry={() => void lists.reload()}
        />
      ) : (
        <div className="duo admin-duo">
          {(subjectsFirst ? ["disciplinas", "turmas"] : ["turmas", "disciplinas"]).map((card) => (
            <Fragment key={card}>{card === "turmas" ? classesCard : subjectsCard}</Fragment>
          ))}
        </div>
      )}

      {/* Busca do menu: alunos com o nome ou o e-mail */}
      {studentsFirst ? null : studentsCard}

      <Drawer
        open={open}
        title={top ? titleOf(top) : ""}
        subtitle={<span ref={setSubtitleNode} className="contents" />}
        footer={<div ref={setFooterNode} className="admin-foot-slot" />}
        onClose={() => requestClose()}
        busy={busy}
      >
        {top ? (
          <div
            ref={contentRef}
            key={top.id}
            className="admin-panel"
            onFocus={(event) => {
              if (event.target instanceof HTMLElement && event.target.matches("input, select, textarea")) {
                lastFieldRef.current = event.target;
              }
            }}
          >
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
