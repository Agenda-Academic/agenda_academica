"use client";

import { ArrowLeft, CircleAlert, FileClock, FileSpreadsheet, Info, Loader2, Lock, RotateCcw, Save, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  bulkGradeErrorsOf,
  conflictOf,
  deleteGradeImport,
  getEventGrades,
  getGradeImport,
  getGradeImports,
  publishGrades,
  saveGradesBulk,
  unpublishGrades,
  type ConflictDetails,
} from "@/lib/api";
import { countText, cx, errorMessage, formatShortDateTime } from "@/lib/format";
import { categoryMeta, gradeImportSourceLabels } from "@/lib/meta";
import type { AcademicEvent, BulkGradeInput, EventGrades, GradeImport, GradeImportApplied } from "@/lib/types";
import { useAppActions, useBackLayer } from "./app-actions";
import { GradeImportBody, GradeImportFooter, useGradeImport, type GradeImportFlow } from "./grade-import";
import { GradesReview, GradesSheet, GradesStatus, bulkInput, useGradeSheet, type GradesSheetApi } from "./grades-sheet";
import { Pager, usePaged } from "./pager";
import { Drawer, EmptyState, ErrorState, isOnTopLayer, primaryButton, secondaryButton } from "./ui";

/**
 * Notas de uma avaliação, em planilha (rodada 7, amostra notas.html da direção A).
 *
 * O lugar normal delas é a aba Notas do painel "Editar evento" (EventGradesTab, montada pelo event-editor.tsx):
 * a ação "Notas" da Gestão e da tela Notas abre o painel do evento nessa aba. A gaveta sozinha (EventGradesDrawer)
 * fica para quando o evento não está na lista da página.
 *
 * A aba abre direto na grade (grades-sheet.tsx): faixa de situação, Todos/Sem nota/Alteradas, busca, Baixar e
 * Importar planilha e a tabela. Digitar é rascunho; "Revisar e salvar" troca o corpo pela revisão ("de 7,5 para
 * 8") e salva tudo num pedido só (PUT /events/:id/grades). Publicar fica no rodapé (sem pendências) e ocultar,
 * no menu da etiqueta "Publicadas". O histórico de importações é um link discreto que troca o corpo pela lista,
 * e "Importar planilha" abre o seletor de arquivo e vai direto aos passos Conferir e Pronto (grade-import*.tsx).
 * Sair com pendências (X, Esc, Voltar do navegador, recarregar) pergunta antes. Nunca abre outro painel por cima.
 * Dona: área Notas (docente).
 */
export type EventGradesDrawerProps = {
  /** Avaliação aberta; null: gaveta fechada. */
  eventId: number | null;
  /** O evento da lista da página (título e data antes da carga); pode faltar. */
  event: AcademicEvent | null;
  /** Fecha a gaveta (o foco volta ao botão que abriu). Com pendências, a gaveta pergunta antes. */
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
  // situação: etiqueta com fundo (.pill.stat), como Agendado, Concluído e Cancelado
  draft: { label: "Rascunho", pill: "stat stat-alt" },
  applied: { label: "Aplicada", pill: "stat stat-conc" },
  undone: { label: "Desfeita", pill: "stat" },
  discarded: { label: "Descartada", pill: "stat" },
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
      const field = active.closest<HTMLElement>(".nd-row, .mini, .notas-docente-imp") ?? active;
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
  // uma gaveta por avaliação: trocar de avaliação começa do zero (grade, passos e rascunho)
  return <GradesPanel key={props.eventId} {...props} eventId={props.eventId} />;
}

function GradesPanel({ event, eventId, onChanged, onClose }: EventGradesDrawerProps & { eventId: number }) {
  const panel = useGradesPanel({ active: true, event, eventId, onChanged, onClose });
  // Voltar do navegador: volta uma parte da gaveta; na grade, fecha (perguntando, com pendências)
  useBackLayer(true, () => {
    if (panel.inSubView()) {
      panel.back();
    } else {
      panel.requestClose();
    }
  });
  const category = panel.category ? categoryMeta[panel.category] : null;
  return (
    <Drawer
      open
      size="wide"
      busy={panel.busy}
      eyebrow={
        category && panel.view !== "import" ? (
          <span className={cx("cat", category.tint)}>{category.short}</span>
        ) : undefined
      }
      footer={<div className="notas-docente-foot">{panel.footer}</div>}
      subtitle={panel.view === "import" ? <span>{panel.importSubtitle}</span> : <span>{panel.eventLine}</span>}
      title={panel.view === "import" ? "Importar notas" : panel.title}
      onClose={panel.requestClose}
    >
      {panel.body}
    </Drawer>
  );
}

/** Partes da aba: a grade, a revisão antes de salvar, o histórico de importações e os passos da importação. */
export type GradesPart = "sheet" | "review" | "history" | "import";

/** O que o painel do evento precisa saber da aba Notas (título, número da aba, pílula e ocupado). */
export type GradesTabState = {
  eventId: number;
  view: GradesPart;
  /** Notas lançadas (com nota, falta ou dispensa); null enquanto carrega. */
  launched: number | null;
  published: boolean;
  /** Importação ou salvamento em andamento: Esc e clique fora não fecham. */
  busy: boolean;
  /** Subtítulo do painel durante a importação ("Prova 2 de Matemática, TADS 5, nota de 0 a 10"). */
  importSubtitle: string;
  /** Células mudadas e ainda não salvas na grade (0: nada pendente). */
  pending: number;
};

/** Ações da aba Notas para o painel do evento (X, Esc, Fechar e o Voltar do navegador). */
export type GradesTabControl = {
  /** Pede para sair: com notas digitadas e não salvas, ou planilha lida e não conferida, pergunta antes. */
  guardLeave: (then: () => void) => void;
  /** A aba está numa parte de dentro (revisão, histórico, importação) ou tem pendências: o Voltar passa por ela. */
  inSubView: () => boolean;
  /** Volta uma parte (para a grade); na grade com pendências, pergunta e fecha. */
  back: () => void;
};

/**
 * Aba Notas do painel "Editar evento". O corpo fica no lugar e o rodapé vai para `footerSlot`, o rodapé do painel
 * quando a aba está à vista. O painel recebe o título e o número da aba por `onState`, e o X, o Esc e o Voltar
 * passam por `controlRef`. Fica montada enquanto o painel está aberto no evento (também na aba Dados), para trocar
 * de aba sem perder o que foi digitado, a importação nem a lista. O CSS (notas-docente.css) deixa o painel largo
 * (880 px) enquanto a aba Notas está à vista.
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
   * a aba busca de novo a lista e as importações, e o número da aba e a grade acompanham.
   */
  reloadKey?: number;
}) {
  const panel = useGradesPanel({ active, event, eventId, onChanged, onClose, reloadKey });
  const { back, busy, guardLeave, importSubtitle, inSubView, launched, pending, published, view } = panel;

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
    onState({ eventId, view, launched, published, busy, importSubtitle, pending });
  }, [busy, eventId, importSubtitle, launched, onState, pending, published, view]);

  return (
    <>
      {panel.body}
      {active && footerSlot ? createPortal(panel.footer, footerSlot) : null}
    </>
  );
}

type FocusTarget = "history" | "import" | "review" | "error" | null;

/**
 * Estado e conteúdo das notas de uma avaliação: a grade, a revisão, o histórico e os passos da importação. Usado
 * pela gaveta sozinha (GradesPanel) e pela aba Notas do painel do evento (EventGradesTab), que só mudam a moldura.
 */
function useGradesPanel({
  active,
  event,
  eventId,
  onChanged,
  onClose,
  reloadKey = 0,
}: {
  /** A parte está à vista (o Ctrl+S só vale nela). */
  active: boolean;
  event: AcademicEvent | null;
  eventId: number;
  onChanged: () => void;
  onClose: () => void;
  /** Ao mudar, busca de novo as notas e as importações (sem voltar ao esqueleto: o que está na tela fica até chegar). */
  reloadKey?: number;
}) {
  const { confirm, role, showError, toast, token, user } = useAppActions();
  const [view, setView] = useState<GradesPart>("sheet");
  const [data, setData] = useState<EventGrades | null>(null);
  const [imports, setImports] = useState<GradeImport[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishAfter, setPublishAfter] = useState(false);
  const [archivedHit, setArchivedHit] = useState(false);
  const [blockedUndo, setBlockedUndo] = useState<Record<number, ConflictDetails>>({});
  const [undoing, setUndoing] = useState<number | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const sheet = useGradeSheet(data);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const historyRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const sheetApi = useRef<GradesSheetApi>(null);
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
  const title = info?.title ?? event?.title ?? "Avaliação";
  const pending = sheet.pending;
  const errorCount = sheet.errorRows.length;
  const changeCount = sheet.changes.length;

  function goTo(next: GradesPart, target: FocusTarget = null) {
    focusTarget.current = target;
    setView(next);
  }

  const flow = useGradeImport({
    info,
    students: data?.students ?? [],
    published,
    imports,
    publishing,
    onPublish: () => void publish(),
    undoingId: undoing,
    onUndoApplied: askUndoApplied,
    onExit: () => goTo("sheet", "import"),
    onFinish: () => goTo("sheet"),
    onApplied: handleApplied,
    onDraftsChanged: () => {
      void refresh();
      changed(false);
    },
    onPointsSet: () => changed(true),
  });

  // troca de conteúdo (grade, revisão, histórico, passos da importação): o foco vai para o título da parte nova,
  // ou de volta para o botão que abriu a parte de onde se voltou; o corpo volta ao alto
  const viewKey = view === "import" ? `import-${flow.step}` : view;
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "error") {
      // a API recusou: o foco vai para a primeira célula marcada, e o balão diz o motivo
      const input = document.querySelector<HTMLInputElement>(".nd-row.is-bad .nd-input");
      if (input) {
        input.focus();
        return;
      }
    }
    const button =
      (target === "history" && historyRef.current) ||
      (target === "import" && importRef.current) ||
      (target === "review" && reviewRef.current) ||
      null;
    if (button && !button.disabled && button.isConnected) {
      button.focus();
      return;
    }
    const heading = headingRef.current;
    heading?.closest(".drawer-body")?.scrollTo({ top: 0 });
    heading?.focus({ preventScroll: true });
  }, [viewKey]);

  // recarregar ou fechar a aba do navegador com notas digitadas: o navegador pergunta antes
  useEffect(() => {
    if (!pending) return;
    const onUnload = (unloadEvent: BeforeUnloadEvent) => {
      unloadEvent.preventDefault();
      unloadEvent.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [pending]);

  /* --------------------------- salvar --------------------------- */

  /** "Revisar e salvar" (e o Ctrl+S): com célula errada, o foco vai até ela; sem, abre a revisão. */
  function openReview() {
    if (!pending || saving || archived) return;
    if (errorCount) {
      // pelo id do aluno (o nome pode ser começo de outro); a grade limpa a busca e o filtro se esconderem a linha
      sheetApi.current?.focusStudent(sheet.errorRows[0].row.studentId);
      setAnnouncement(`${countText(errorCount, "nota com erro", "notas com erro")}. Corrija para salvar.`);
      return;
    }
    if (!changeCount) {
      // só células que voltaram ao valor gravado: nada para salvar
      sheet.discard();
      return;
    }
    setPublishAfter(false);
    goTo("review");
  }

  async function sendBatch(inputs: BulkGradeInput[]) {
    const result = await saveGradesBulk(token, eventId, inputs);
    setData(result.data);
    changed(false);
    return result;
  }

  async function saveAll() {
    if (saving || !changeCount) return;
    const inputs = sheet.changes.map((change) => bulkInput(change.row.row.studentId, change.after));
    const previous = sheet.changes.map((change) => bulkInput(change.row.row.studentId, change.row.before));
    const ids = inputs.map((input) => input.studentId);
    const alsoPublish = publishAfter && !published && !archived;
    setSaving(true);
    try {
      const result = await sendBatch(inputs);
      sheet.markSaved(ids);
      goTo("sheet");
      toast(result.message, {
        key: `notas-lote-${eventId}`,
        undo: async () => {
          try {
            const back = await sendBatch(previous);
            toast(back.summary.updated + back.summary.created + back.summary.cleared ? "Notas voltaram ao valor de antes." : back.message, {
              key: `notas-lote-${eventId}`,
            });
          } catch (error) {
            showError(error, `notas-lote-${eventId}`);
          }
        },
      });
      if (alsoPublish) {
        await publish();
      }
    } catch (error) {
      const rowErrors = bulkGradeErrorsOf(error, inputs);
      if (rowErrors.length) {
        sheet.setServerErrors(Object.fromEntries(rowErrors.map((item) => [item.studentId, item.message])));
        goTo("sheet", "error");
        toast(
          rowErrors.length === 1
            ? "1 nota não foi aceita. Nada foi salvo: corrija a célula marcada e salve de novo."
            : `${rowErrors.length} notas não foram aceitas. Nada foi salvo: corrija as células marcadas e salve de novo.`,
          { tone: "danger", key: `notas-lote-${eventId}` }
        );
      } else {
        if (conflictOf(error, "ARCHIVED")) setArchivedHit(true);
        showError(error, `notas-lote-${eventId}`);
      }
    } finally {
      setSaving(false);
    }
  }

  function askDiscard() {
    confirm({
      title: "Descartar as alterações?",
      message: `${countText(pending, "nota digitada volta", "notas digitadas voltam")} ao valor gravado. Nada foi salvo ainda.`,
      confirmLabel: "Descartar",
      cancelLabel: "Continuar editando",
      action: () => {
        sheet.discard();
        setAnnouncement("Alterações descartadas.");
        focusFirstCellSoon();
      },
    });
  }

  /**
   * Depois de descartar: o botão Descartar some do rodapé e o foco volta à primeira célula da grade. Espera a
   * confirmação fechar (a célula fica na camada de cima) e confere de novo depois que ela devolve o foco.
   */
  function focusFirstCellSoon() {
    let tries = 0;
    const run = () => {
      if (sheetApi.current?.focusFirst()) {
        window.setTimeout(() => {
          // só se o foco se perdeu (body, o próprio painel ou o X dele); se a pessoa já andou, fica onde está
          const now = document.activeElement;
          const lost = !now || now === document.body || now.matches('.drawer, [role="dialog"], [aria-label="Fechar painel"]');
          if (lost) sheetApi.current?.focusFirst();
        }, 300);
        return;
      }
      tries += 1;
      if (tries < 20) window.setTimeout(run, 50);
    };
    window.setTimeout(run, 0);
  }

  // Ctrl+S: na grade abre a revisão; na revisão, salva
  useEffect(() => {
    if (!active || (view !== "sheet" && view !== "review")) return;
    const onKey = (keyEvent: KeyboardEvent) => {
      if ((keyEvent.ctrlKey || keyEvent.metaKey) && !keyEvent.altKey && keyEvent.key.toLowerCase() === "s") {
        keyEvent.preventDefault();
        if (view === "sheet") openReview();
        else void saveAll();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Esc na revisão volta um passo, para a grade (com as notas digitadas), em vez de pedir para sair da gaveta. O
  // document ouve antes da pilha de camadas (window), e o preventDefault faz a gaveta ignorar este Esc. Esc numa
  // confirmação aberta por cima fica com ela (o foco está fora da gaveta).
  useEffect(() => {
    if (!active || view !== "review") return;
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || keyEvent.defaultPrevented || keyEvent.isComposing) return;
      const target = keyEvent.target;
      if (!(target instanceof Element) || !target.closest(".drawer") || !isOnTopLayer(target)) return;
      keyEvent.preventDefault();
      if (!saving) goTo("sheet", "review");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /* --------------------------- publicar --------------------------- */

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

  function askPublish() {
    if (!data || publishing) return;
    const missing = data.counts.missing;
    if (!missing) {
      void publish();
      return;
    }
    confirm({
      title: "Publicar com alunos sem nota?",
      message: `${countText(missing, "aluno ainda está", "alunos ainda estão")} sem nota. Quem tem nota recebe um aviso agora; quem não tem vê a nota quando você lançar.`,
      confirmLabel: "Publicar mesmo assim",
      cancelLabel: "Voltar",
      tone: "primary",
      action: () => publish(),
    });
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

  /* --------------------------- importações --------------------------- */

  /** Desfaz a importação aplicada; true se deu certo. */
  async function undoImport(importId: number) {
    setUndoing(importId);
    let ok = false;
    try {
      const { message } = await deleteGradeImport(token, importId);
      setBlockedUndo((current) => {
        const next = { ...current };
        delete next[importId];
        return next;
      });
      toast(message, { key: `notas-importacao-${importId}` });
      changed(true);
      ok = true;
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
    return ok;
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

  /** "Desfazer importação" da tela Pronto: confirma, desfaz e volta para a grade, com as notas de antes. */
  function askUndoApplied(item: GradeImportApplied) {
    const total = item.applied.created + item.applied.updated;
    confirm({
      title: "Desfazer esta importação?",
      message: `${
        total === 1 ? "A nota volta" : "As notas voltam"
      } ao valor de antes da importação. Não dá para voltar atrás: para trazer ${
        total === 1 ? "esta nota" : "estas notas"
      } de novo, envie a planilha outra vez.`,
      confirmLabel: "Desfazer importação",
      cancelLabel: "Manter notas",
      action: async () => {
        if (await undoImport(item.id)) {
          goTo("sheet", "import");
        }
      },
    });
  }

  function askDiscardDraft(item: GradeImport) {
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
      goTo("import");
    } catch (error) {
      showError(error, `notas-importacao-${item.id}`);
    } finally {
      setOpening(null);
    }
  }

  /**
   * "Importar planilha" (ou a planilha arrastada sobre a grade). Com notas digitadas e não salvas, pergunta antes:
   * a importação confere contra o que está gravado, e o rascunho da grade se perderia no meio.
   */
  function askImport(pick: () => void) {
    if (archived) return;
    if (!pending) {
      pick();
      return;
    }
    confirm({
      title: "Importar e descartar o que foi digitado?",
      message: `${countText(pending, "nota digitada ainda não foi salva", "notas digitadas ainda não foram salvas")}. Para importar a planilha, elas voltam ao valor gravado. Para ficar com elas, salve antes de importar.`,
      confirmLabel: "Descartar e importar",
      cancelLabel: "Continuar editando",
      action: () => {
        sheet.discard();
        pick();
      },
    });
  }

  function importFile(file: File) {
    if (archived) return;
    sheet.discard();
    flow.startWithFile(file);
    goTo("import");
  }

  /**
   * Aplicou: a importação mostra a tela Pronto, que já diz quantas notas entraram e tem o "Desfazer importação" no
   * pé. Sem aviso (toast) por cima: no celular ele cobria o "Publicar notas agora". A grade recarrega por trás.
   */
  function handleApplied() {
    void refresh();
    changed(true);
  }

  /* --------------------------- fechar e voltar --------------------------- */

  function confirmLeaveImport(then: () => void) {
    confirm({
      title: "Sair da importação?",
      message: flow.draft
        ? "As colunas mudadas ainda não foram conferidas. O rascunho da última conferência continua no histórico de importações."
        : "A planilha escolhida ainda não foi conferida. Para importar depois, envie a planilha de novo.",
      confirmLabel: "Sair da importação",
      cancelLabel: "Continuar importando",
      action: then,
    });
  }

  function confirmLeaveSheet(then: () => void) {
    confirm({
      title: "Sair sem salvar?",
      message: `${countText(pending, "nota digitada se perde", "notas digitadas se perdem")}. Para ficar com ${pending === 1 ? "ela" : "elas"}, ${view === "review" ? "use Salvar" : "volte e use Revisar e salvar"}.`,
      confirmLabel: "Sair sem salvar",
      cancelLabel: "Continuar editando",
      action: () => {
        sheet.discard();
        then();
      },
    });
  }

  /** Antes de sair (X, Esc, Fechar): ocupado não sai; com planilha não conferida ou notas não salvas, pergunta. */
  function guardLeave(then: () => void) {
    if (saving || (view === "import" && flow.busy)) return;
    if (view === "import" && flow.hasUnsentFile) {
      confirmLeaveImport(then);
      return;
    }
    if (pending) {
      confirmLeaveSheet(then);
      return;
    }
    then();
  }

  function requestClose() {
    guardLeave(onClose);
  }

  const inSubView = () => view !== "sheet" || pending > 0;

  /** Voltar do navegador: volta para a grade (perguntando antes, se precisar); na grade com pendências, sai. */
  function back() {
    if (view === "review") {
      if (!saving) goTo("sheet", "review");
      return;
    }
    if (view === "history") {
      goTo("sheet", "history");
      return;
    }
    if (view === "sheet") {
      guardLeave(onClose);
      return;
    }
    if (flow.busy) return;
    if (flow.hasUnsentFile) {
      confirmLeaveImport(() => goTo("sheet", "import"));
      return;
    }
    goTo("sheet", "import");
  }

  /* --------------------------- desenho --------------------------- */

  const className = info?.academicClass?.name ?? event?.academicClass?.name ?? null;
  const subjectName = info?.subject?.name ?? event?.subject?.name ?? null;
  const startsAt = info?.startsAt ?? event?.startsAt ?? null;
  const category = info?.category ?? event?.category ?? null;
  const launched = data ? launchedCount(data.counts) : null;
  const max = info?.maxScoreText ? `nota de 0 a ${info.maxScoreText}` : "ainda sem pontuação";
  const importSubtitle = [title, className, max].filter(Boolean).join(", ");
  const eventLine = [
    subjectName,
    className,
    startsAt ? formatShortDateTime(startsAt) : null,
    info?.maxScoreText ? `vale ${info.maxScoreText} ${info.maxScoreText === "1" ? "ponto" : "pontos"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const done = (imports ?? []).filter((item) => item.status !== "discarded");
  const nextDraft = archived ? null : (sortImports(done).find((item) => item.status === "draft" && item.canApply) ?? null);
  const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

  let footer;
  if (view === "import") {
    footer = <GradeImportFooter flow={flow} />;
  } else if (view === "review") {
    footer = (
      <>
        <button className={cx(secondaryButton, busyLook)} aria-disabled={saving || undefined} onClick={() => !saving && goTo("sheet", "review")} type="button">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar para a grade
        </button>
        <button
          className={cx(primaryButton, busyLook)}
          aria-busy={saving || undefined}
          aria-disabled={saving || undefined}
          onClick={() => void saveAll()}
          type="button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {saving ? "Salvando" : changeCount === 1 ? "Salvar 1 nota" : `Salvar ${changeCount} notas`}
        </button>
      </>
    );
  } else if (view === "history") {
    footer = (
      <button className={secondaryButton} onClick={() => goTo("sheet", "history")} type="button">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar para as notas
      </button>
    );
  } else if (pending) {
    footer = (
      <>
        <p className="nd-pending" role="status">
          <span className="nd-pending-dot" aria-hidden />
          <b>{countText(pending, "alteração não salva", "alterações não salvas")}</b>
          {errorCount ? (
            <span className="nd-pending-err">
              <CircleAlert className="h-3.5 w-3.5" aria-hidden />
              {`${errorCount} com erro`}
            </span>
          ) : null}
          {errorCount ? <span className="nd-pending-hint">corrija para salvar</span> : null}
        </p>
        <button className={secondaryButton} onClick={askDiscard} type="button">
          Descartar
        </button>
        <button
          ref={reviewRef}
          className={primaryButton}
          aria-keyshortcuts="Control+S"
          onClick={openReview}
          type="button"
        >
          Revisar e salvar
          <span className="kbd nd-kbd-on" aria-hidden>
            Ctrl S
          </span>
        </button>
      </>
    );
  } else {
    const canPublish = Boolean(data) && !published && !archived && Boolean(launched);
    footer = (
      <>
        <p className="nd-foot-hint">
          {published
            ? "Mudou uma nota? Alunos e responsáveis recebem um aviso quando você salvar."
            : archived
              ? "Turma arquivada: as notas ficam só para leitura."
              : launched
                ? "As notas ficam ocultas até você publicar."
                : "Digite as notas na tabela ou importe a planilha."}
        </p>
        <button className={canPublish ? secondaryButton : primaryButton} onClick={requestClose} type="button">
          Fechar
        </button>
        {canPublish ? (
          <button
            className={cx(primaryButton, busyLook)}
            aria-busy={publishing || undefined}
            aria-disabled={publishing || undefined}
            onClick={askPublish}
            type="button"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Publicar notas
          </button>
        ) : null}
      </>
    );
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
    body = <ImportPane flow={flow} headingRef={headingRef} />;
  } else if (view === "review") {
    body = (
      <GradesReview
        archived={archived}
        changes={sheet.changes}
        headingRef={headingRef}
        publishAfter={publishAfter}
        published={published}
        onPublishAfter={setPublishAfter}
      />
    );
  } else if (view === "history") {
    body = (
      <HistoryView
        archived={archived}
        blockedUndo={blockedUndo}
        headingRef={headingRef}
        imports={imports}
        opening={opening}
        undoing={undoing}
        userId={user.id}
        onContinue={(item) => void continueDraft(item)}
        onDiscard={askDiscardDraft}
        onUndo={askUndoImport}
      />
    );
  } else {
    const noPoints = data.event.maxScore === null;
    body = (
      <SheetPane>
        {archived ? (
          <p className="callout past">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b>Turma arquivada.</b> As notas ficam só para leitura: dá para ver, baixar e ocultar, mas não lançar,
              importar nem publicar.
            </span>
          </p>
        ) : null}
        {noPoints && !archived ? (
          <p className="callout amber">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <b>Sem pontuação.</b> Falta e dispensa já dá para marcar. Para digitar a nota, defina quanto a avaliação
              vale nos dados do evento, ou importe a planilha e informe ali.
            </span>
          </p>
        ) : null}
        {nextDraft ? (
          <div className="callout blue nd-draft">
            <FileClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
              <b>Há uma importação esperando conferência.</b>{" "}
              <span className="wrap-anywhere">{`${nextDraft.fileName}, de ${formatShortDateTime(nextDraft.createdAt)}.`}</span>
            </p>
            <button
              className={cx(secondaryButton, "btn-sm shrink-0", busyLook)}
              aria-busy={opening === nextDraft.id || undefined}
              aria-disabled={opening === nextDraft.id || undefined}
              onClick={() => {
                if (opening !== nextDraft.id) void continueDraft(nextDraft);
              }}
              type="button"
            >
              {opening === nextDraft.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Continuar importação
            </button>
          </div>
        ) : null}
        <GradesStatus archived={archived} data={data} launched={launched ?? 0} publishing={publishing} onUnpublish={() => void unpublish()} />
        <GradesSheet
          announce={setAnnouncement}
          apiRef={sheetApi}
          data={data}
          headingRef={headingRef}
          historyCount={done.length}
          historyRef={historyRef}
          importRef={importRef}
          isAdmin={role === "admin"}
          locked={archived}
          sheet={sheet}
          showSteps={!launched && !nextDraft && done.length === 0 && data.students.length > 0}
          onDownload={() => void flow.downloadTemplate()}
          onImport={askImport}
          onImportFile={importFile}
          onOpenHistory={() => goTo("history")}
        />
      </SheetPane>
    );
  }

  return {
    view,
    busy: flow.busy || saving,
    launched,
    published,
    pending,
    title,
    category,
    eventLine,
    importSubtitle,
    footer,
    body: (
      <div className="nd-panel">
        {body}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    ),
    guardLeave,
    requestClose,
    inSubView,
    back,
  };
}

/** A grade, com o espaço dos avisos no fim (no celular eles ficam sobre o fim do painel). */
function SheetPane({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const toastRoom = useToastClearance(rootRef);
  return (
    <div ref={rootRef} className="nd-pane">
      {children}
      {toastRoom ? <div aria-hidden style={{ height: toastRoom }} /> : null}
    </div>
  );
}

/** Os passos da importação, com o espaço dos avisos no fim (no celular eles ficam sobre o fim do painel). */
function ImportPane({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const toastRoom = useToastClearance(rootRef);
  return (
    <div ref={rootRef}>
      <GradeImportBody flow={flow} headingRef={headingRef} />
      {toastRoom ? <div aria-hidden style={{ height: toastRoom }} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Carregando                                                          */
/* ------------------------------------------------------------------ */

function PanelSkeleton() {
  return (
    <div className="grid gap-4" role="status">
      <span className="sr-only">Carregando as notas da avaliação</span>
      <span className="skel h-[74px] w-full !rounded-[12px]" />
      <span className="flex gap-3">
        <span className="skel h-10 w-64 max-w-full !rounded-[10px]" />
        <span className="skel ml-auto hidden h-10 w-72 !rounded-[10px] sm:block" />
      </span>
      <span className="skel h-4 w-80 max-w-full" />
      {[0, 1, 2, 3, 4].map((item) => (
        <span key={item} className="skel h-11 w-full !rounded-[8px]" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Histórico de importações                                            */
/* ------------------------------------------------------------------ */

const FIRST_IMPORTS = 4;

function HistoryView({
  archived,
  blockedUndo,
  headingRef,
  imports,
  onContinue,
  onDiscard,
  onUndo,
  opening,
  undoing,
  userId,
}: {
  archived: boolean;
  blockedUndo: Record<number, ConflictDetails>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  imports: GradeImport[];
  onContinue: (item: GradeImport) => void;
  onDiscard: (item: GradeImport) => void;
  onUndo: (item: GradeImport) => void;
  opening: number | null;
  undoing: number | null;
  userId: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const toastRoom = useToastClearance(rootRef);
  // o rascunho descartado não entra: nenhuma nota mudou com ele, então não é uma importação feita
  const ordered = sortImports(imports.filter((item) => item.status !== "discarded"));
  // a lista cresce a cada importação: uma página por vez (nunca expande no lugar)
  const paged = usePaged(ordered, FIRST_IMPORTS, "historico");
  return (
    <div ref={rootRef} className="grid gap-4">
      <div>
        <h3 ref={headingRef} className="drawer-h3 outline-none" tabIndex={-1}>
          Histórico de importações <span className="badge">{ordered.length}</span>
        </h3>
        <p className="mt-1 text-[13px] text-muted">Cada planilha importada nesta avaliação. Dá para desfazer a última, se ninguém mudou as notas depois.</p>
      </div>
      {ordered.length ? (
        <ul className="grid gap-2.5">
          {paged.items.map((item) => (
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
        <EmptyState compact icon={FileSpreadsheet} text="Nenhuma importação ainda" hint="Use Importar planilha na grade de notas." />
      )}
      <Pager paged={paged} noun={["importação", "importações"]} focusRef={headingRef} />
      <p className="flex items-start gap-1.5 text-[13px] leading-5 text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />A planilha não fica guardada na Agenda: só as notas que entraram.
      </p>
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
  const when = importWhen(item);
  const by = item.createdBy && item.createdBy.id !== userId && item.createdBy.fullName ? `, por ${item.createdBy.fullName}` : "";
  const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

  let lock: string | null = null;
  if (blocked) {
    const names = (blocked.grades ?? []).map((grade) => grade.fullName).filter(Boolean);
    lock = names.length ? `${blocked.message} Notas editadas depois: ${names.join(", ")}.` : blocked.message;
  } else if (item.status === "applied" && !item.canUndo) {
    lock = archived
      ? "Turma arquivada: não dá para desfazer."
      : "Não dá para desfazer: notas desta importação mudaram depois, na grade ou em outra importação.";
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
        <p className="notas-docente-imp-s wrap-anywhere">
          {`${item.fileName}: ${item.status === "discarded" ? "nenhuma nota mudou" : importTotalsText(item)}`}
        </p>
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
