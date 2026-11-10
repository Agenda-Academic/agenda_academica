"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Eye,
  EyeOff,
  FileClock,
  FileSpreadsheet,
  Info,
  Loader2,
  Lock,
  RotateCcw,
  Send,
  Upload,
  Users,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  conflictOf,
  deleteGradeImport,
  getEventGrades,
  getGradeImport,
  getGradeImports,
  publishGrades,
  saveGrade,
  unpublishGrades,
  type ConflictDetails,
} from "@/lib/api";
import {
  cx,
  enrollmentStatusText,
  errorMessage,
  fieldErrors,
  formatDateBR,
  formatScore,
  formatShortDateTime,
  gradeSourceText,
  parseScore,
} from "@/lib/format";
import { gradeImportSourceLabels, gradeStatusLabels, statusMeta } from "@/lib/meta";
import type {
  AcademicEvent,
  EventGradeRow,
  EventGrades,
  GradeImport,
  GradeImportApplied,
  GradeInput,
  GradeStatus,
} from "@/lib/types";
import { useAppActions, useBackLayer } from "./app-actions";
import { GradeImportBody, GradeImportFooter, useGradeImport } from "./grade-import";
import { Drawer, EmptyState, ErrorState, Segmented, SegmentedButton, primaryButton, secondaryButton } from "./ui";

/**
 * Notas de uma avaliação (desenho 5.7, amostras docente-notas-evento e docente-importar-previa).
 *
 * O lugar normal delas é a aba Notas do painel "Editar evento" (EventGradesTab, montada pelo event-editor.tsx):
 * a ação "Notas" da Gestão e da tela Notas abre o painel do evento nessa aba, e "Editar" abre na aba Dados do
 * evento. A gaveta sozinha (EventGradesDrawer) fica para quando o evento não está na lista da página.
 *
 * Conteúdo: GET /events/:id/grades (lista com e sem nota, lançar com saveGrade, salva na hora), "Publicar para
 * alunos e responsáveis" (publishGrades, toast com Desfazer = unpublishGrades), "Importações feitas"
 * (getGradeImports, "Desfazer importação" quando canUndo) e "Importar notas", que troca o conteúdo do painel
 * pelos 4 passos (arquivo, colunas, prévia, aplicar; grade-import*.tsx e lib/grades-file.ts), com Voltar.
 * Nunca abre outro painel por cima. Dona: área Notas (docente).
 */
export type EventGradesDrawerProps = {
  /** Avaliação aberta; null: gaveta fechada. */
  eventId: number | null;
  /** O evento da lista da página (título e data antes da carga); pode faltar. */
  event: AcademicEvent | null;
  /** Fecha a gaveta (o foco volta ao botão que abriu). Com importação em andamento, pergunte antes (confirm). */
  onClose: () => void;
  /** Nota, importação ou publicação mudou: a página recarrega os eventos (gradesPublishedAt). */
  onChanged: () => void;
};

/* ------------------------------------------------------------------ */
/* Aviso de mudança para a tela Notas (GradesTeacher) e o editor       */
/* ------------------------------------------------------------------ */

type GradesListener = (eventId: number) => void;
const gradesListeners = new Set<GradesListener>();

/** A tela Notas da docente (e o painel do evento) escuta para atualizar a situação da avaliação que mudou. */
export function subscribeGradesChanged(listener: GradesListener) {
  gradesListeners.add(listener);
  return () => {
    gradesListeners.delete(listener);
  };
}

function notifyGradesChanged(eventId: number) {
  gradesListeners.forEach((listener) => listener(eventId));
}

/* ------------------------------------------------------------------ */
/* Ajudantes                                                           */
/* ------------------------------------------------------------------ */

/** Notas lançadas (com nota, falta ou dispensa). */
export function launchedCount(counts: EventGrades["counts"]) {
  return counts.graded + counts.absent + counts.excused;
}

/** "18 novas, 2 alteradas, 2 ficaram de fora" (totais de uma importação). */
export function importTotalsText(item: Pick<GradeImport, "totals">) {
  const { totals } = item;
  const parts = [
    totals.new ? `${totals.new} ${totals.new === 1 ? "nova" : "novas"}` : null,
    totals.changed ? `${totals.changed} ${totals.changed === 1 ? "alterada" : "alteradas"}` : null,
    totals.newerInAgenda ? `${totals.newerInAgenda} ${totals.newerInAgenda === 1 ? "mudou" : "mudaram"} na Agenda` : null,
    totals.same ? `${totals.same} ${totals.same === 1 ? "igual" : "iguais"}` : null,
    totals.rejected ? `${totals.rejected} ${totals.rejected === 1 ? "ficou" : "ficaram"} de fora` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nenhuma linha com nota";
}

const importStatus: Record<GradeImport["status"], { label: string; pill: string }> = {
  draft: { label: "Rascunho", pill: "st-alt" },
  applied: { label: "Aplicada", pill: "st-conc" },
  undone: { label: "Desfeita", pill: "st-ag" },
  discarded: { label: "Descartada", pill: "st-ag" },
};

/**
 * Ordem da lista de importações: o rascunho em andamento primeiro (é o que pede uma ação), depois as aplicadas, da
 * mais nova para a mais antiga, e por fim as desfeitas e as descartadas. Dentro de cada grupo, a mais nova em cima.
 */
const importOrder: Record<GradeImport["status"], number> = { draft: 0, applied: 1, undone: 2, discarded: 3 };

function importWhen(item: GradeImport) {
  return item.status === "applied" || item.status === "undone" ? (item.appliedAt ?? item.createdAt) : item.createdAt;
}

function sortImports(list: GradeImport[]) {
  return [...list].sort(
    (a, b) =>
      importOrder[a.status] - importOrder[b.status] || new Date(importWhen(b)).getTime() - new Date(importWhen(a)).getTime()
  );
}

/** Recalcula as contagens depois de lançar uma nota (a API conta só os alunos ativos). */
function withRow(data: EventGrades, row: EventGradeRow): EventGrades {
  const students = data.students.map((item) => (item.studentId === row.studentId ? { ...item, ...row } : item));
  const active = students.filter((item) => item.enrollmentStatus === "active");
  const count = (status: GradeStatus) => active.filter((item) => item.grade?.status === status).length;
  return {
    ...data,
    students,
    counts: {
      students: active.length,
      graded: count("graded"),
      absent: count("absent"),
      excused: count("excused"),
      missing: active.filter((item) => !item.grade).length,
    },
  };
}

/** Valor a devolver no Desfazer de uma nota apagada ou trocada. */
function restoreInput(grade: EventGradeRow["grade"]): GradeInput | null {
  if (!grade) return null;
  if (grade.status !== "graded") return { status: grade.status };
  return grade.score === null ? null : { score: grade.score };
}

/**
 * Os avisos (toasts) não cobrem o campo em foco. No celular eles ficam dentro do painel, logo acima do rodapé: o
 * fim da lista ganha a altura deles (devolvida aqui, para um espaço no fim) e, quando o campo em foco fica embaixo
 * deles, o corpo do painel rola até ele aparecer acima dos avisos. No computador eles ficam ao lado do painel.
 */
function useToastClearance(rootRef: RefObject<HTMLElement | null>) {
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const root = rootRef.current;
    const body = root?.closest<HTMLElement>(".drawer-body") ?? null;
    const stack = document.querySelector<HTMLElement>(".toast-stack");
    if (!root || !body || !stack) {
      return;
    }
    const frames = new Set<number>();
    const timers = new Set<number>();
    const later = (run: () => void) => {
      const frame = window.requestAnimationFrame(() => {
        frames.delete(frame);
        run();
      });
      frames.add(frame);
    };
    // topo dos avisos que estão sobre o corpo do painel (null: nenhum)
    const toastTop = () => {
      if (stack.classList.contains("held")) {
        return null;
      }
      const area = body.getBoundingClientRect();
      const over = Array.from(stack.querySelectorAll<HTMLElement>(".toast"))
        .map((toast) => toast.getBoundingClientRect())
        .filter((box) => box.height > 0 && box.bottom > area.top && box.top < area.bottom && box.right > area.left && box.left < area.right);
      return over.length ? Math.min(...over.map((box) => box.top)) : null;
    };
    const clearFocus = () => {
      const top = toastTop();
      const active = document.activeElement;
      if (top === null || !(active instanceof HTMLElement) || !root.contains(active)) {
        return;
      }
      const field = active.closest<HTMLElement>(".notas-docente-grade, .mini, .notas-docente-imp") ?? active;
      const box = field.getBoundingClientRect();
      const area = body.getBoundingClientRect();
      // o aviso entra subindo 14 px: a folga cobre a animação
      if (box.bottom > top - 12 && box.top < area.bottom) {
        body.scrollBy({ top: box.bottom - top + 24 });
      }
    };
    const measure = () => {
      later(() => {
        const top = toastTop();
        const area = body.getBoundingClientRect();
        setRoom(top === null ? 0 : Math.ceil(area.bottom - top) + 24);
        // com o espaço no fim da lista, o campo em foco já tem para onde subir
        later(clearFocus);
      });
      // de novo depois da animação de entrada do aviso
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        later(clearFocus);
      }, 320);
      timers.add(timer);
    };
    const watcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    watcher?.observe(stack);
    const onFocus = () => later(clearFocus);
    root.addEventListener("focusin", onFocus);
    measure();
    return () => {
      watcher?.disconnect();
      root.removeEventListener("focusin", onFocus);
      frames.forEach((frame) => window.cancelAnimationFrame(frame));
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [rootRef]);
  return room;
}

/* ------------------------------------------------------------------ */
/* Gaveta sozinha e aba Notas do painel do evento                      */
/* ------------------------------------------------------------------ */

export function EventGradesDrawer(props: EventGradesDrawerProps) {
  if (props.eventId === null) {
    return null;
  }
  // uma gaveta por avaliação: trocar de avaliação começa do zero (lista, passos e rascunho)
  return <GradesPanel key={props.eventId} {...props} eventId={props.eventId} />;
}

function GradesPanel({ event, eventId, onChanged, onClose }: EventGradesDrawerProps & { eventId: number }) {
  const panel = useGradesPanel({ event, eventId, onChanged, onClose });
  // Voltar do navegador: volta uma parte da gaveta; no resumo, fecha
  useBackLayer(true, () => {
    if (panel.inSubView()) {
      panel.back();
    } else {
      panel.requestClose();
    }
  });
  return (
    <Drawer
      open
      busy={panel.busy}
      footer={<div className="notas-docente-foot">{panel.footer}</div>}
      subtitle={panel.subtitle}
      title={panel.drawerTitle}
      onClose={panel.requestClose}
    >
      {panel.body}
    </Drawer>
  );
}

export type GradesPart = "overview" | "students" | "import";

/** O que o painel do evento precisa saber da aba Notas (título, número da aba, pílula e ocupado). */
export type GradesTabState = {
  eventId: number;
  view: GradesPart;
  /** Notas lançadas (com nota, falta ou dispensa); null enquanto carrega. */
  launched: number | null;
  published: boolean;
  /** Importação enviando, aplicando ou descartando: Esc e clique fora não fecham. */
  busy: boolean;
  /** Subtítulo do painel durante a importação ("Prova 2 de Matemática, TADS 5, nota de 0 a 10"). */
  importSubtitle: string;
};

/** Ações da aba Notas para o painel do evento (X, Esc, Fechar e o Voltar do navegador). */
export type GradesTabControl = {
  /** Pede para sair: com arquivo da importação ainda não enviado, pergunta antes; ocupada, não sai. */
  guardLeave: (then: () => void) => void;
  /** A aba está numa parte de dentro (lista de alunos ou importação): o Voltar volta para o resumo. */
  inSubView: () => boolean;
  /** Volta uma parte (da lista ou da importação para o resumo), perguntando antes se precisar. */
  back: () => void;
};

/**
 * Aba Notas do painel "Editar evento" (amostra docente-notas-evento). O corpo fica no lugar e o rodapé vai para
 * `footerSlot`, o rodapé do painel quando a aba está à vista. O painel recebe o título e o número da aba por
 * `onState`, e o X, o Esc e o Voltar passam por `controlRef`. Fica montada enquanto o painel está aberto no
 * evento (também na aba Dados), para trocar de aba sem perder a importação nem a lista.
 */
export function EventGradesTab({
  active,
  controlRef,
  event,
  eventId,
  footerSlot,
  onChanged,
  onClose,
  onState,
  reloadKey = 0,
}: {
  active: boolean;
  controlRef: { current: GradesTabControl | null };
  event: AcademicEvent | null;
  eventId: number;
  footerSlot: HTMLElement | null;
  onChanged: () => void;
  onClose: () => void;
  onState: (state: GradesTabState) => void;
  /**
   * Muda quando o painel descobre que as notas podem ter mudado por fora (o 409 HAS_GRADES ao salvar a aba Dados):
   * a aba busca de novo a lista e as importações, e o número da aba, "N com nota" e a lista acompanham.
   */
  reloadKey?: number;
}) {
  const panel = useGradesPanel({ event, eventId, onChanged, onClose, reloadKey });
  const { back, busy, guardLeave, importSubtitle, inSubView, launched, published, view } = panel;

  useLayoutEffect(() => {
    const control: GradesTabControl = { guardLeave, inSubView, back };
    controlRef.current = control;
    return () => {
      if (controlRef.current === control) {
        controlRef.current = null;
      }
    };
  });

  useEffect(() => {
    onState({ eventId, view, launched, published, busy, importSubtitle });
  }, [busy, eventId, importSubtitle, launched, onState, published, view]);

  return (
    <>
      {panel.body}
      {active && footerSlot ? createPortal(panel.footer, footerSlot) : null}
    </>
  );
}

type FocusTarget = "students" | "import" | "publish" | null;

/**
 * Estado e conteúdo das notas de uma avaliação: o resumo, a lista de alunos e os passos da importação. Usado pela
 * gaveta sozinha (GradesPanel) e pela aba Notas do painel do evento (EventGradesTab), que só mudam a moldura.
 */
function useGradesPanel({
  event,
  eventId,
  onChanged,
  onClose,
  reloadKey = 0,
}: {
  event: AcademicEvent | null;
  eventId: number;
  onChanged: () => void;
  onClose: () => void;
  /** Ao mudar, busca de novo as notas e as importações (sem voltar ao esqueleto: o que está na tela fica até chegar). */
  reloadKey?: number;
}) {
  const { confirm, role, showError, toast, token, user } = useAppActions();
  const [view, setView] = useState<GradesPart>("overview");
  const [data, setData] = useState<EventGrades | null>(null);
  const [imports, setImports] = useState<GradeImport[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archivedHit, setArchivedHit] = useState(false);
  const [blockedUndo, setBlockedUndo] = useState<Record<number, ConflictDetails>>({});
  const [undoing, setUndoing] = useState<number | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const studentsButtonRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<FocusTarget>(null);
  const firstView = useRef(true);

  // primeira carga: a lista de notas e as importações da avaliação. De novo a cada reloadKey (o painel do evento
  // pede depois de um 409 HAS_GRADES): a tela fica como está até a resposta chegar
  useEffect(() => {
    let alive = true;
    Promise.all([getEventGrades(token, eventId), getGradeImports(token, eventId)])
      .then(([grades, list]) => {
        if (!alive) return;
        setData(grades);
        setImports(list);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (alive) setLoadError(error);
      });
    return () => {
      alive = false;
    };
  }, [eventId, reloadKey, token]);

  async function refresh() {
    try {
      const [grades, list] = await Promise.all([getEventGrades(token, eventId), getGradeImports(token, eventId)]);
      setData(grades);
      setImports(list);
      setLoadError(null);
    } catch (error) {
      showError(error, `notas-carga-${eventId}`);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      const [grades, list] = await Promise.all([getEventGrades(token, eventId), getGradeImports(token, eventId)]);
      setData(grades);
      setImports(list);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setRetrying(false);
    }
  }

  /** Avisa a tela Notas (e o painel do evento) e, quando muda o evento (publicação, pontuação), a página. */
  function changed(reloadPage: boolean) {
    notifyGradesChanged(eventId);
    if (reloadPage) onChanged();
  }

  const info = data?.event ?? null;
  const published = Boolean(info?.gradesPublishedAt);
  const archived = archivedHit || Boolean(event?.academicClass?.archivedAt);
  const isAssignment = (info?.category ?? event?.category) === "assignment";
  const title = info?.title ?? event?.title ?? "Avaliação";

  function goOverview(target: FocusTarget) {
    focusTarget.current = target;
    setView("overview");
  }

  const flow = useGradeImport({
    info,
    students: data?.students ?? [],
    published,
    onExit: () => goOverview("import"),
    onApplied: handleApplied,
    onDraftsChanged: () => {
      void refresh();
      changed(false);
    },
    onPointsSet: () => changed(true),
  });

  // troca de conteúdo (resumo, lista, passos da importação): o foco vai para o título da parte nova, ou de
  // volta para o botão que abriu a parte de onde se voltou; o corpo volta ao alto
  const viewKey = view === "import" ? `import-${flow.step}` : view;
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const target = focusTarget.current;
    focusTarget.current = null;
    const button =
      (target === "students" && studentsButtonRef.current) ||
      (target === "import" && importButtonRef.current) ||
      (target === "publish" && publishRef.current) ||
      null;
    if (button && !button.disabled) {
      button.focus();
      return;
    }
    const heading = headingRef.current;
    heading?.closest(".drawer-body")?.scrollTo({ top: 0 });
    heading?.focus({ preventScroll: true });
  }, [viewKey]);

  /* --------------------------- ações --------------------------- */

  async function saveRow(studentId: number, input: GradeInput) {
    try {
      const { data: row } = await saveGrade(token, eventId, studentId, input);
      setData((current) => (current ? withRow(current, row) : current));
      changed(false);
      return row;
    } catch (error) {
      if (conflictOf(error, "ARCHIVED")) setArchivedHit(true);
      throw error;
    }
  }

  /**
   * Toast de nota apagada ou trocada, com Desfazer que devolve o valor de antes. Uma chave por avaliação: o aviso
   * novo tira o anterior (nunca uma pilha de avisos sobre os campos), e o Desfazer vale para a última ação.
   */
  function undoableToast(text: string, studentId: number, restore: GradeInput | null) {
    toast(text, {
      key: `nota-${eventId}`,
      undo: restore
        ? async () => {
            try {
              await saveRow(studentId, restore);
            } catch (error) {
              showError(error, `nota-${eventId}`);
            }
          }
        : undefined,
    });
  }

  async function publish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const { data: result, message } = await publishGrades(token, eventId);
      setData((current) => (current ? { ...current, event: { ...current.event, gradesPublishedAt: result.gradesPublishedAt } } : current));
      toast(message, { key: `notas-publicar-${eventId}`, undo: () => unpublish() });
      changed(true);
    } catch (error) {
      if (conflictOf(error, "ARCHIVED")) setArchivedHit(true);
      showError(error, `notas-publicar-${eventId}`);
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const { message } = await unpublishGrades(token, eventId);
      setData((current) => (current ? { ...current, event: { ...current.event, gradesPublishedAt: null } } : current));
      toast(message, { key: `notas-publicar-${eventId}`, undo: archived ? undefined : () => publish() });
      changed(true);
    } catch (error) {
      showError(error, `notas-publicar-${eventId}`);
    } finally {
      setPublishing(false);
    }
  }

  async function undoImport(importId: number) {
    setUndoing(importId);
    try {
      const { message } = await deleteGradeImport(token, importId);
      setBlockedUndo((current) => {
        const next = { ...current };
        delete next[importId];
        return next;
      });
      toast(message, { key: `notas-importacao-${importId}` });
      changed(true);
    } catch (error) {
      const blocked = conflictOf(error, "EDITED_AFTER_IMPORT");
      if (blocked) {
        setBlockedUndo((current) => ({ ...current, [importId]: blocked }));
      }
      if (conflictOf(error, "ARCHIVED")) setArchivedHit(true);
      showError(error, `notas-importacao-${importId}`);
    } finally {
      setUndoing(null);
      void refresh();
    }
  }

  // a API não refaz uma importação desfeita: por isso a confirmação (e não um toast com Desfazer)
  function askUndoImport(item: GradeImport) {
    const total = item.totals.new + item.totals.changed + item.totals.newerInAgenda;
    confirm({
      title: "Desfazer esta importação?",
      message: `${
        total === 1 ? "A nota volta" : "As notas voltam"
      } ao valor de antes da importação de ${formatShortDateTime(item.appliedAt ?? item.createdAt)}. Não dá para voltar atrás: para trazer ${
        total === 1 ? "esta nota" : "estas notas"
      } de novo, importe o arquivo outra vez.`,
      confirmLabel: "Desfazer importação",
      cancelLabel: "Manter notas",
      action: () => undoImport(item.id),
    });
  }

  function askDiscard(item: GradeImport) {
    confirm({
      title: "Descartar o rascunho?",
      message: "Nenhuma nota muda. Para importar este arquivo depois, escolha ele de novo.",
      confirmLabel: "Descartar rascunho",
      cancelLabel: "Manter rascunho",
      action: async () => {
        try {
          const { message } = await deleteGradeImport(token, item.id);
          toast(message, { key: `notas-importacao-${item.id}` });
          changed(false);
        } catch (error) {
          showError(error, `notas-importacao-${item.id}`);
        } finally {
          void refresh();
        }
      },
    });
  }

  async function continueDraft(item: GradeImport) {
    setOpening(item.id);
    try {
      const full = await getGradeImport(token, item.id);
      if (full.status !== "draft") {
        toast("Esta importação já não é rascunho. A lista foi atualizada.", { tone: "info", key: `notas-importacao-${item.id}` });
        void refresh();
        return;
      }
      flow.openDraft(full);
      setView("import");
    } catch (error) {
      showError(error, `notas-importacao-${item.id}`);
    } finally {
      setOpening(null);
    }
  }

  function startImport() {
    flow.start();
    setView("import");
  }

  function handleApplied(applied: GradeImportApplied, message: string) {
    toast(message, { key: `notas-importacao-${applied.id}`, undo: () => undoImport(applied.id) });
    goOverview("publish");
    void refresh();
    changed(true);
  }

  /* --------------------------- fechar e voltar --------------------------- */

  function confirmLeaveImport(then: () => void) {
    confirm({
      title: "Sair da importação?",
      message: flow.draft
        ? "As colunas mudadas ainda não foram enviadas. O rascunho da última prévia continua na lista de importações."
        : "O arquivo escolhido ainda não foi enviado. Para importar depois, escolha o arquivo de novo.",
      confirmLabel: "Sair da importação",
      cancelLabel: "Continuar importando",
      action: then,
    });
  }

  /** Antes de sair (X, Esc, Fechar): importação ocupada não sai; com arquivo lido e não enviado, pergunta. */
  function guardLeave(then: () => void) {
    if (view === "import" && flow.busy) return;
    if (view === "import" && flow.hasUnsentFile) {
      confirmLeaveImport(then);
      return;
    }
    then();
  }

  function requestClose() {
    guardLeave(onClose);
  }

  const inSubView = () => view !== "overview";

  /** Voltar do navegador numa parte de dentro: volta para o resumo (perguntando antes, se precisar). */
  function back() {
    if (view === "students") {
      goOverview("students");
      return;
    }
    if (view !== "import" || flow.busy) return;
    if (flow.hasUnsentFile) {
      confirmLeaveImport(() => goOverview("import"));
      return;
    }
    goOverview("import");
  }

  /* --------------------------- desenho --------------------------- */

  const className = info?.academicClass?.name ?? event?.academicClass?.name ?? null;
  const subjectName = info?.subject?.name ?? event?.subject?.name ?? null;
  const startsAt = info?.startsAt ?? event?.startsAt ?? null;
  const eventStatus = info?.status ?? event?.status ?? null;
  const launched = data ? launchedCount(data.counts) : null;
  const max = info?.maxScoreText ? `nota de 0 a ${info.maxScoreText}` : "ainda sem pontuação";
  const importSubtitle = [title, className, max].filter(Boolean).join(", ");

  let drawerTitle = isAssignment ? "Notas do trabalho" : "Notas da prova";
  let subtitle = (
    <>
      <span className="w-full font-semibold text-ink-2">{title}</span>
      {startsAt ? <span>{formatShortDateTime(startsAt)}</span> : null}
      {className ? <span>{[className, subjectName].filter(Boolean).join(", ")}</span> : null}
      {eventStatus && eventStatus !== "scheduled" ? (
        <span className={cx("pill", statusMeta[eventStatus].pill)}>{statusMeta[eventStatus].label}</span>
      ) : null}
      {published ? (
        <span className="pill st-conc">Notas publicadas</span>
      ) : launched ? (
        <span className="pill st-alt">Notas ocultas</span>
      ) : null}
    </>
  );
  let footer = (
    <>
      <p className="mr-auto basis-full text-[13px] text-muted sm:basis-auto">As notas são salvas na hora, sem precisar de Salvar</p>
      {view === "students" ? (
        <button className={secondaryButton} onClick={() => goOverview("students")} type="button">
          Voltar
        </button>
      ) : (
        <button className={secondaryButton} onClick={requestClose} type="button">
          Fechar
        </button>
      )}
    </>
  );
  if (view === "import") {
    drawerTitle = "Importar notas";
    subtitle = <span>{importSubtitle}</span>;
    footer = <GradeImportFooter flow={flow} />;
  }

  let body;
  if (loadError && !data) {
    const status = (loadError as { status?: number }).status;
    const retryable = status === undefined || status === 0 || (status ?? 0) >= 500;
    body = (
      <ErrorState
        title={status === 403 ? "Sem acesso às notas desta avaliação" : "Não deu para carregar as notas"}
        text={errorMessage(loadError)}
        onRetry={retryable ? () => void retry() : undefined}
        retrying={retrying}
      />
    );
  } else if (!data || !imports) {
    body = <PanelSkeleton />;
  } else if (view === "import") {
    body = <GradeImportBody flow={flow} headingRef={headingRef} />;
  } else if (view === "students") {
    body = (
      <StudentsView
        data={data}
        headingRef={headingRef}
        isAdmin={role === "admin"}
        locked={archived}
        onSave={saveRow}
        onUndoable={undoableToast}
      />
    );
  } else {
    body = (
      <Overview
        archived={archived}
        blockedUndo={blockedUndo}
        data={data}
        headingRef={headingRef}
        importButtonRef={importButtonRef}
        imports={imports}
        isAssignment={isAssignment}
        opening={opening}
        publishRef={publishRef}
        publishing={publishing}
        studentsButtonRef={studentsButtonRef}
        undoing={undoing}
        userId={user.id}
        onContinue={(item) => void continueDraft(item)}
        onDiscard={askDiscard}
        onImport={startImport}
        onPublish={() => void publish()}
        onSeeStudents={() => setView("students")}
        onUndo={askUndoImport}
        onUnpublish={() => void unpublish()}
      />
    );
  }

  return {
    view,
    busy: flow.busy,
    launched,
    published,
    drawerTitle,
    subtitle,
    importSubtitle,
    footer,
    body,
    guardLeave,
    requestClose,
    inSubView,
    back,
  };
}

/* ------------------------------------------------------------------ */
/* Carregando                                                          */
/* ------------------------------------------------------------------ */

function PanelSkeleton() {
  return (
    <div className="grid gap-4" role="status">
      <span className="sr-only">Carregando as notas da avaliação</span>
      <span className="skel h-[74px] w-full !rounded-[14px]" />
      <span className="skel h-11 w-72 max-w-full !rounded-xl" />
      <span className="skel h-16 w-full !rounded-[14px]" />
      <span className="mt-2 skel h-4 w-40" />
      {[0, 1].map((item) => (
        <span key={item} className="skel h-[92px] w-full !rounded-[14px]" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resumo: situação, publicar e importações                            */
/* ------------------------------------------------------------------ */

const FIRST_IMPORTS = 3;

function Overview({
  archived,
  blockedUndo,
  data,
  headingRef,
  importButtonRef,
  imports,
  isAssignment,
  onContinue,
  onDiscard,
  onImport,
  onPublish,
  onSeeStudents,
  onUndo,
  onUnpublish,
  opening,
  publishRef,
  publishing,
  studentsButtonRef,
  undoing,
  userId,
}: {
  archived: boolean;
  blockedUndo: Record<number, ConflictDetails>;
  data: EventGrades;
  headingRef: RefObject<HTMLHeadingElement | null>;
  importButtonRef: RefObject<HTMLButtonElement | null>;
  imports: GradeImport[];
  isAssignment: boolean;
  onContinue: (item: GradeImport) => void;
  onDiscard: (item: GradeImport) => void;
  onImport: () => void;
  onPublish: () => void;
  onSeeStudents: () => void;
  onUndo: (item: GradeImport) => void;
  onUnpublish: () => void;
  opening: number | null;
  publishRef: RefObject<HTMLButtonElement | null>;
  publishing: boolean;
  studentsButtonRef: RefObject<HTMLButtonElement | null>;
  undoing: number | null;
  userId: number;
}) {
  const [allImports, setAllImports] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toastRoom = useToastClearance(rootRef);
  const { counts, event: info, students } = data;
  const launched = launchedCount(counts);
  const published = Boolean(info.gradesPublishedAt);
  const noPoints = info.maxScore === null;
  // o rascunho em andamento fica no alto da lista e o aviso do topo traz o botão para continuar ali mesmo
  const ordered = sortImports(imports);
  const drafts = ordered.filter((item) => item.status === "draft");
  const nextDraft = archived ? null : (drafts.find((item) => item.canApply) ?? null);
  const shownImports = allImports ? ordered : ordered.slice(0, FIRST_IMPORTS);
  const kind = isAssignment ? "deste trabalho" : "desta prova";

  let callout;
  if (published) {
    callout = (
      <p className="callout green">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <b>{`Notas publicadas em ${formatDateBR(info.gradesPublishedAt as string)}.`}</b>{" "}
          Alunos e responsáveis já veem. Nota lançada ou mudada agora aparece na hora, sem aviso novo.
        </span>
      </p>
    );
  } else if (launched) {
    callout = (
      <p className="callout amber">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <b>Notas ocultas.</b>{" "}
          {`${launched} de ${counts.students} ${counts.students === 1 ? "aluno tem" : "alunos têm"} nota. Alunos e responsáveis só veem depois que você publicar.`}
        </span>
      </p>
    );
  } else if (nextDraft) {
    // o botão fica no próprio aviso: no celular o item do rascunho, na lista, fica abaixo da dobra
    const openingDraft = opening === nextDraft.id;
    callout = (
      <div className="callout past">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="grid min-w-0 gap-2.5">
          <p>
            <b>Nenhuma nota lançada ainda.</b> Há um rascunho de importação esperando: continue a importação para
            conferir e aplicar.
          </p>
          <button
            className={cx(secondaryButton, "btn-sm justify-self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-55")}
            aria-busy={openingDraft || undefined}
            aria-disabled={openingDraft || undefined}
            onClick={() => {
              if (!openingDraft) onContinue(nextDraft);
            }}
            type="button"
          >
            {openingDraft ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileClock className="h-4 w-4" aria-hidden />}
            Continuar importação
          </button>
        </div>
      </div>
    );
  } else {
    callout = (
      <p className="callout past">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <b>Nenhuma nota lançada ainda.</b> {`Importe o arquivo com as notas ${kind} ou lance à mão em Ver notas.`}
        </span>
      </p>
    );
  }

  const countsLine = [
    `${counts.graded} com nota`,
    `${counts.missing} sem nota`,
    counts.absent ? `${counts.absent} com falta` : null,
    counts.excused ? `${counts.excused} com dispensa` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const left = students.filter((item) => item.enrollmentStatus !== "active").length;

  return (
    <div ref={rootRef} className="grid gap-4">
      <h3 ref={headingRef} className="sr-only" tabIndex={-1}>
        Situação das notas
      </h3>
      {archived ? (
        <p className="callout past">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b>Turma arquivada.</b> As notas ficam só para leitura: dá para ver e ocultar, mas não lançar, importar nem publicar.
          </span>
        </p>
      ) : null}
      {callout}
      {noPoints && !archived ? (
        <p className="callout amber">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b>Sem pontuação.</b> Ao importar, você informa quanto a avaliação vale. Para lançar a nota à mão, defina a
            pontuação no evento, na Gestão. Falta e dispensa já dá para marcar.
          </span>
        </p>
      ) : null}

      {published ? (
        <div>
          <button
            ref={publishRef}
            className={cx(secondaryButton, "aria-disabled:opacity-55")}
            aria-busy={publishing || undefined}
            aria-disabled={publishing || undefined}
            onClick={onUnpublish}
            type="button"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
            Ocultar as notas de novo
          </button>
          <p className="notas-docente-help">Os avisos ainda não lidos saem junto. Dá para publicar de novo depois.</p>
        </div>
      ) : !archived ? (
        <div>
          <button
            ref={publishRef}
            className={cx(primaryButton, "aria-disabled:cursor-not-allowed aria-disabled:opacity-55")}
            aria-busy={publishing || undefined}
            aria-describedby="notas-docente-publicar-ajuda"
            aria-disabled={publishing || !launched || undefined}
            onClick={() => {
              if (launched && !publishing) onPublish();
            }}
            type="button"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Publicar para alunos e responsáveis
          </button>
          <p className="notas-docente-help" id="notas-docente-publicar-ajuda">
            {launched
              ? "Alunos e responsáveis recebem um aviso no sistema. Dá para ocultar de novo depois."
              : "Lance ou importe ao menos uma nota para publicar."}
          </p>
        </div>
      ) : null}

      <div className="mini items-center">
        <span className="mini-ico">
          <Users className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="mini-t">{countsLine}</p>
          <p className="mini-s">
            {counts.students
              ? `${counts.students === 1 ? "1 aluno ativo" : `${counts.students} alunos ativos`} na turma${
                  left ? `, mais ${left === 1 ? "1 que saiu" : `${left} que saíram`} com nota` : ""
                }${info.maxScoreText ? `. Nota de 0 a ${info.maxScoreText}.` : "."}`
              : "A turma ainda não tem alunos ativos."}
          </p>
        </div>
        <button ref={studentsButtonRef} className="link min-h-6 shrink-0 text-[13.5px]" onClick={onSeeStudents} type="button">
          {`Ver notas (${students.length})`}
        </button>
      </div>

      <section className="notas-docente-sec" aria-labelledby="notas-docente-importacoes">
        <div className="notas-docente-sec-h">
          <h3 className="notas-docente-h3" id="notas-docente-importacoes">
            {/* o número é o da lista toda (o mesmo do "Ver todas"), nunca "(0)" sobre itens na tela */}
            Importações feitas {imports.length ? <span className="n">({imports.length})</span> : null}
          </h3>
          {!archived ? (
            <button ref={importButtonRef} className={cx(secondaryButton, "btn-sm")} onClick={onImport} type="button">
              <Upload className="h-4 w-4" aria-hidden />
              Importar notas
            </button>
          ) : null}
        </div>
        {imports.length ? (
          <ul className="grid gap-2.5">
            {shownImports.map((item) => (
              <ImportItem
                key={item.id}
                archived={archived}
                blocked={blockedUndo[item.id] ?? null}
                item={item}
                opening={opening === item.id}
                undoing={undoing === item.id}
                userId={userId}
                onContinue={onContinue}
                onDiscard={onDiscard}
                onUndo={onUndo}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={FileSpreadsheet}
            text="Nenhuma importação ainda"
            hint={
              archived
                ? "A turma está arquivada: as notas ficam só para leitura."
                : "Traga o arquivo do SUAP, do Moodle, do Classroom ou o Modelo da Agenda com Importar notas."
            }
          />
        )}
        {imports.length > FIRST_IMPORTS ? (
          <button className="link min-h-6 self-start" aria-expanded={allImports} onClick={() => setAllImports((value) => !value)} type="button">
            {allImports ? "Mostrar menos" : `Ver todas (${imports.length})`}
            {allImports ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>
        ) : null}
      </section>
      {toastRoom ? <div aria-hidden style={{ height: toastRoom }} /> : null}
    </div>
  );
}

function ImportItem({
  archived,
  blocked,
  item,
  onContinue,
  onDiscard,
  onUndo,
  opening,
  undoing,
  userId,
}: {
  archived: boolean;
  blocked: ConflictDetails | null;
  item: GradeImport;
  onContinue: (item: GradeImport) => void;
  onDiscard: (item: GradeImport) => void;
  onUndo: (item: GradeImport) => void;
  opening: boolean;
  undoing: boolean;
  userId: number;
}) {
  const status = importStatus[item.status];
  const when = item.status === "applied" || item.status === "undone" ? (item.appliedAt ?? item.createdAt) : item.createdAt;
  const by = item.createdBy && item.createdBy.id !== userId && item.createdBy.fullName ? `, por ${item.createdBy.fullName}` : "";
  const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

  let lock: string | null = null;
  if (blocked) {
    const names = (blocked.grades ?? []).map((grade) => grade.fullName).filter(Boolean);
    lock = names.length ? `${blocked.message} Notas editadas depois: ${names.join(", ")}.` : blocked.message;
  } else if (item.status === "applied" && !item.canUndo) {
    lock = archived
      ? "Turma arquivada: não dá para desfazer."
      : "Não dá para desfazer: notas desta importação mudaram depois, na lista ou em outra importação.";
  }

  return (
    <li className="notas-docente-imp">
      <span className="mini-ico">
        {item.status === "draft" ? <FileClock className="h-[18px] w-[18px]" aria-hidden /> : <FileSpreadsheet className="h-[18px] w-[18px]" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="notas-docente-imp-t">
          <span>{`${formatShortDateTime(when)}, ${gradeImportSourceLabels[item.source] ?? item.source}${by}`}</span>
          <span className={cx("pill", status.pill)}>{status.label}</span>
        </p>
        <p className="notas-docente-imp-s wrap-anywhere">{`${item.fileName}: ${importTotalsText(item)}`}</p>
        {item.status === "undone" && item.undoneAt ? (
          <p className="notas-docente-imp-s">{`Desfeita em ${formatShortDateTime(item.undoneAt)}. As notas voltaram ao valor de antes.`}</p>
        ) : null}
        {lock ? (
          <p className="notas-docente-imp-lock">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{lock}</span>
          </p>
        ) : null}
        {item.status === "draft" && (item.canApply || item.canDiscard) ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {item.canApply ? (
              <button
                className={cx(secondaryButton, "btn-sm", busyLook)}
                aria-busy={opening || undefined}
                aria-disabled={opening || undefined}
                onClick={() => {
                  if (!opening) onContinue(item);
                }}
                type="button"
              >
                {opening ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Continuar importação
              </button>
            ) : null}
            {item.canDiscard ? (
              <button className="btn btn-g btn-sm" onClick={() => onDiscard(item)} type="button">
                Descartar
              </button>
            ) : null}
          </div>
        ) : null}
        {item.status === "applied" && item.canUndo && !blocked ? (
          <button
            className={cx(secondaryButton, "btn-sm mt-2.5", busyLook)}
            aria-busy={undoing || undefined}
            aria-disabled={undoing || undefined}
            onClick={() => {
              if (!undoing) onUndo(item);
            }}
            type="button"
          >
            {undoing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
            Desfazer importação
          </button>
        ) : null}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Lista de alunos: lançar, editar e apagar à mão                      */
/* ------------------------------------------------------------------ */

type StudentsFilter = "all" | "missing";

function StudentsView({
  data,
  headingRef,
  isAdmin,
  locked,
  onSave,
  onUndoable,
}: {
  data: EventGrades;
  headingRef: RefObject<HTMLHeadingElement | null>;
  isAdmin: boolean;
  locked: boolean;
  onSave: (studentId: number, input: GradeInput) => Promise<EventGradeRow>;
  onUndoable: (text: string, studentId: number, restore: GradeInput | null) => void;
}) {
  const [filter, setFilter] = useState<StudentsFilter>("all");
  // "Sem nota": a lista fica parada enquanto a docente lança (a linha não some ao salvar); o número do filtro
  // acompanha cada nota salva
  const [missingIds, setMissingIds] = useState<number[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  const toastRoom = useToastClearance(rootRef);
  const { event: info, students } = data;
  const missingNow = students.filter((item) => item.enrollmentStatus === "active" && !item.grade);
  const visible = filter === "missing" ? students.filter((item) => missingIds.includes(item.studentId)) : students;
  const noPoints = info.maxScore === null;

  /** Enter: o foco vai para a nota do próximo aluno (false: era o último). */
  function focusNext(studentId: number) {
    const ids = visible.map((item) => item.studentId);
    for (let index = ids.indexOf(studentId) + 1; index < ids.length; index += 1) {
      const input = inputs.current.get(ids[index]);
      if (input && !input.disabled && !input.readOnly) {
        input.focus();
        input.select();
        return true;
      }
    }
    return false;
  }

  return (
    <div ref={rootRef} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 ref={headingRef} className="notas-docente-h3 outline-none" tabIndex={-1}>
          Alunos <span className="n">({students.length})</span>
        </h3>
        <Segmented label="Mostrar alunos">
          <SegmentedButton active={filter === "all"} label={`Todos (${students.length})`} onClick={() => setFilter("all")} />
          <SegmentedButton
            active={filter === "missing"}
            label={`Sem nota (${missingNow.length})`}
            onClick={() => {
              setMissingIds(missingNow.map((item) => item.studentId));
              setFilter("missing");
            }}
          />
        </Segmented>
      </div>
      <p className="text-[13.5px] leading-5 text-muted">
        {locked
          ? "Turma arquivada: as notas ficam só para leitura."
          : noPoints
            ? "Sem pontuação no evento: dá para marcar falta e dispensa. Para lançar nota, defina a pontuação na Gestão ou importe o arquivo."
            : `Digite a nota de 0 a ${info.maxScoreText}, com vírgula (como 7,5), e aperte Enter ou saia do campo. Para apagar, deixe o campo vazio.`}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          text="Nenhum aluno ativo na turma"
          hint="Os alunos entram pela secretaria ou pelo código da turma. Quando entrarem, aparecem aqui para lançar a nota."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={Check}
          text="Todos os alunos têm nota"
          hint="Volte para Todos para conferir ou mudar alguma nota."
          action={{ label: `Ver todos (${students.length})`, onClick: () => setFilter("all") }}
        />
      ) : (
        <ul className="notas-docente-grades">
          {visible.map((row) => (
            <GradeRowItem
              key={row.studentId}
              isAdmin={isAdmin}
              locked={locked}
              maxScore={info.maxScore}
              maxScoreText={info.maxScoreText}
              row={row}
              announce={setAnnouncement}
              onEnter={focusNext}
              onSave={onSave}
              onUndoable={onUndoable}
              registerInput={(element) => {
                if (element) inputs.current.set(row.studentId, element);
                else inputs.current.delete(row.studentId);
              }}
            />
          ))}
        </ul>
      )}
      {toastRoom ? <div aria-hidden style={{ height: toastRoom }} /> : null}
    </div>
  );
}

function GradeRowItem({
  announce,
  isAdmin,
  locked,
  maxScore,
  maxScoreText,
  onEnter,
  onSave,
  onUndoable,
  registerInput,
  row,
}: {
  announce: (text: string) => void;
  isAdmin: boolean;
  locked: boolean;
  maxScore: number | null;
  maxScoreText: string | null;
  onEnter: (studentId: number) => boolean;
  onSave: (studentId: number, input: GradeInput) => Promise<EventGradeRow>;
  onUndoable: (text: string, studentId: number, restore: GradeInput | null) => void;
  registerInput: (element: HTMLInputElement | null) => void;
  row: EventGradeRow;
}) {
  const name = row.fullName || row.email;
  const grade = row.grade;
  const serverStatus: GradeStatus = grade?.status ?? "graded";
  const serverText = grade?.status === "graded" ? formatScore(grade.score) : "";
  const [text, setText] = useState(serverText);
  const [synced, setSynced] = useState(serverText);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<GradeStatus | null>(null);
  const editSeq = useRef(0);
  // texto que já está indo para a API (o Enter no último aluno e a saída do campo não mandam duas vezes)
  const sendingText = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const errorId = useId();

  // a nota mudou fora deste campo (Desfazer, outra aba): o campo acompanha, se a docente não está digitando
  if (synced !== serverText) {
    setSynced(serverText);
    if (!dirty) setText(serverText);
  }

  const status = pendingStatus ?? serverStatus;
  const noPoints = maxScore === null;
  const scoreDisabled = locked || noPoints || status !== "graded";
  const maxLabel = maxScoreText ?? "";

  async function save(input: GradeInput, announceText: string | null) {
    const seq = editSeq.current;
    sendingText.current = text;
    setSaving(true);
    setError("");
    try {
      const updated = await onSave(row.studentId, input);
      if (editSeq.current === seq) {
        setDirty(false);
        setText(updated.grade?.status === "graded" ? formatScore(updated.grade.score) : "");
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      if (announceText) announce(announceText);
      return true;
    } catch (failure) {
      setError(fieldErrors(failure).score ?? errorMessage(failure));
      announce(`Nota de ${name} não foi salva.`);
      return false;
    } finally {
      sendingText.current = null;
      setSaving(false);
      setPendingStatus(null);
    }
  }

  /** Confere o que foi digitado: erro de formato ou de faixa fica abaixo do campo, sem apagar o texto. */
  function validate(value: number | null) {
    if (value !== null && Number.isNaN(value)) {
      return `Use um número de 0 a ${maxLabel}, com até duas casas, como 7,5.`;
    }
    if (value !== null && maxScore !== null && value > maxScore) {
      return `A nota precisa estar entre 0 e ${maxLabel}.`;
    }
    return "";
  }

  async function commit() {
    if (scoreDisabled || !dirty || sendingText.current === text) return;
    const value = parseScore(text);
    const problem = validate(value);
    if (problem) {
      setError(problem);
      return;
    }
    if (value === null) {
      if (grade?.status === "graded") {
        const restore = restoreInput(grade);
        if (await save({ score: null }, null)) {
          onUndoable(`Nota de ${name} apagada.`, row.studentId, restore);
        }
      } else {
        setDirty(false);
        setError("");
      }
      return;
    }
    if (grade?.status === "graded" && grade.score === value) {
      setDirty(false);
      setError("");
      setText(formatScore(value));
      return;
    }
    await save({ score: value }, `Nota de ${name} salva: ${formatScore(value)}.`);
  }

  async function changeStatus(next: GradeStatus) {
    if (locked || saving) return;
    editSeq.current += 1;
    setDirty(false);
    setError("");
    if (next === "graded") {
      if (grade && grade.status !== "graded") {
        setPendingStatus("graded");
        const restore = restoreInput(grade);
        if (await save({ score: null }, null)) {
          onUndoable(`${gradeStatusLabels[grade.status]} de ${name} apagada.`, row.studentId, restore);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }
      }
      return;
    }
    if (grade?.status === next) return;
    setPendingStatus(next);
    setText("");
    const lostScore = grade?.status === "graded" ? grade.score : null;
    const label = gradeStatusLabels[next];
    const ok = await save({ status: next }, lostScore === null ? `${label} lançada para ${name}.` : null);
    if (ok && lostScore !== null) {
      onUndoable(`${name}: ${label.toLowerCase()} no lugar da nota ${formatScore(lostScore)}.`, row.studentId, { score: lostScore });
    }
  }

  const meta = [row.email !== name ? row.email : null, isAdmin && row.registration ? `matrícula ${row.registration}` : null]
    .filter(Boolean)
    .join(", ");

  return (
    <li className={cx("notas-docente-grade", error && "is-bad")}>
      <div className="notas-docente-grade-who">
        <p className="notas-docente-grade-name">
          <span className="wrap-anywhere">{name}</span>
          {row.enrollmentStatus !== "active" ? (
            <span className="notas-docente-tag">{`Matrícula ${enrollmentStatusText(row.enrollmentStatus).toLowerCase()}`}</span>
          ) : null}
        </p>
        {meta ? <p className="notas-docente-grade-meta wrap-anywhere">{meta}</p> : null}
        {grade ? <p className="notas-docente-grade-meta">{gradeSourceText(grade.source, grade.updatedAt)}</p> : null}
      </div>
      <div className="notas-docente-grade-ctrl">
        <span className="notas-docente-score-wrap">
          <input
            ref={(element) => {
              inputRef.current = element;
              registerInput(element);
            }}
            className="input notas-docente-score"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            aria-label={maxLabel ? `Nota de ${name}, de 0 a ${maxLabel}` : `Nota de ${name}`}
            autoComplete="off"
            disabled={scoreDisabled && !locked}
            enterKeyHint="next"
            inputMode="decimal"
            placeholder={status !== "graded" ? gradeStatusLabels[status] : noPoints ? "sem valor" : ""}
            readOnly={locked}
            value={text}
            onBlur={() => {
              // salva depois que o foco chegou ao próximo campo: com o Tab, a saída deste campo acontece antes, e
              // o que muda na linha nesse meio tempo (giro, erro abaixo do campo) faria o painel puxar o foco
              // para ele, em vez de deixar na Situação do mesmo aluno
              window.setTimeout(() => void commit(), 0);
            }}
            onChange={(changeEvent) => {
              editSeq.current += 1;
              setText(changeEvent.target.value);
              setDirty(true);
              if (error) setError("");
            }}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === "Enter") {
                keyEvent.preventDefault();
                const problem = dirty ? validate(parseScore(text)) : "";
                if (problem) {
                  setError(problem);
                  return;
                }
                // a próxima linha recebe o foco e a saída deste campo salva a nota; no último aluno, salva aqui
                if (!onEnter(row.studentId)) {
                  void commit();
                }
              } else if (keyEvent.key === "Escape" && dirty) {
                // Esc desfaz o que foi digitado (sem fechar a gaveta)
                keyEvent.preventDefault();
                editSeq.current += 1;
                setText(serverText);
                setDirty(false);
                setError("");
              }
            }}
          />
          {maxLabel ? (
            <span className="notas-docente-of" aria-hidden>
              {`de ${maxLabel}`}
            </span>
          ) : null}
        </span>
        {/* enquanto a nota salva, a Situação continua no Tab (desativar tiraria o foco dela no meio do Tab):
            a troca espera o salvar terminar (changeStatus) e o campo fica com aria-disabled */}
        <select
          className="input notas-docente-status aria-disabled:cursor-wait"
          aria-busy={saving || undefined}
          aria-disabled={saving || undefined}
          aria-label={`Situação de ${name}`}
          disabled={locked}
          value={status}
          onChange={(changeEvent) => void changeStatus(changeEvent.target.value as GradeStatus)}
        >
          <option value="graded">Nota</option>
          <option value="absent">Falta</option>
          <option value="excused">Dispensa</option>
        </select>
        <span className="notas-docente-state" aria-hidden>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
          ) : saved ? (
            <Check className="h-4 w-4 text-brand" strokeWidth={2.6} />
          ) : null}
        </span>
      </div>
      {error ? (
        <p className="field-error notas-docente-grade-err" id={errorId}>
          <CircleAlert aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </li>
  );
}
