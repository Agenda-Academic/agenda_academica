"use client";

import {
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  EyeOff,
  Eye,
  History,
  Info,
  MoreHorizontal,
  PenLine,
  RotateCcw,
  Search,
  Upload,
  UserX,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { countText, cx, formatDateBR, formatScore, normalizeText, parseScore } from "@/lib/format";
import type { BulkGradeInput, EventGradeRow, EventGrades, Grade } from "@/lib/types";
import { ValueChange } from "./grade-import-preview";
import { popoverHost, useAnchoredPosition, useOutsidePress } from "./select";
import { EmptyState, isOnTopLayer } from "./ui";

/**
 * Lançamento de notas em planilha (rodada 7, amostra notas.html da direção A). Digitar é rascunho; salvar é um
 * compromisso com revisão ("Revisar e salvar", que manda tudo de uma vez pelo PUT /events/:id/grades); publicar
 * é outro compromisso. Aqui ficam:
 * - useGradeSheet: o rascunho (o texto de cada célula mudada), a pilha do Ctrl+Z e o que mudou;
 * - GradesStatus: a faixa de situação (Publicadas, Ocultas, Sem notas), o progresso e média, menor e maior;
 * - GradesSheet: a barra (Todos, Sem nota, Alteradas, busca, Baixar e Importar planilha) e a grade, com
 *   digitação contínua (Enter e setas), F e D, colar uma coluna, balão de erro e desfazer por linha;
 * - GradesReview: a revisão "de 7,5 para 8" antes de salvar.
 * A gaveta (event-grades-drawer.tsx) junta as partes, o rodapé e o salvar. Dona: área Notas (docente).
 */

/* ------------------------------------------------------------------ */
/* Valor de uma célula                                                 */
/* ------------------------------------------------------------------ */

/** O que a célula diz: nota em centésimos, falta, dispensa ou nada (célula vazia nunca vira zero). */
export type CellValue = { kind: "empty" } | { kind: "score"; cents: number } | { kind: "absent" } | { kind: "excused" };

/** O texto digitado lido: um valor, ou o motivo de não ser um (o balão da célula). */
export type CellRead = CellValue | { kind: "error"; message: string };

const ABSENT_WORDS = new Set(["f", "falta", "faltou", "ausente"]);
const EXCUSED_WORDS = new Set(["d", "dispensa", "dispensado", "dispensada"]);

/** Texto da célula para falta e dispensa (o que aparece na própria célula). */
export const ABSENT_TEXT = "Falta";
export const EXCUSED_TEXT = "Dispensa";

/** Valor gravado de uma nota. */
export function gradeValue(grade: Grade | null): CellValue {
  if (!grade) return { kind: "empty" };
  if (grade.status === "absent") return { kind: "absent" };
  if (grade.status === "excused") return { kind: "excused" };
  return grade.score === null ? { kind: "empty" } : { kind: "score", cents: grade.score };
}

/** "7,5", "Falta", "Dispensa" ou "" (o texto que a célula mostra para um valor). */
export function valueText(value: CellValue) {
  if (value.kind === "score") return formatScore(value.cents);
  if (value.kind === "absent") return ABSENT_TEXT;
  if (value.kind === "excused") return EXCUSED_TEXT;
  return "";
}

/** Como o valor aparece na revisão e na coluna Antes ("sem nota" para a vazia). */
export function valueLabel(value: CellValue) {
  return value.kind === "empty" ? "sem nota" : valueText(value);
}

/** Lê o texto digitado: "7,5", "7.5", "10", F (falta), D (dispensa) ou vazio. */
export function readCell(text: string, maxScore: number | null, maxScoreText: string | null): CellRead {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  const word = normalizeText(trimmed);
  if (ABSENT_WORDS.has(word)) return { kind: "absent" };
  if (EXCUSED_WORDS.has(word)) return { kind: "excused" };
  // apagando "Falta" ou "Dispensa" letra a letra ("Falt", "Fa", "Disp"): segue a etiqueta, sem balão no caminho
  if ("falta".startsWith(word)) return { kind: "absent" };
  if ("dispensa".startsWith(word)) return { kind: "excused" };
  // "7," é digitação no meio: vale 7 até chegar a casa decimal, sem erro
  const typing = /^\d+[.,]$/.test(trimmed);
  const cents = parseScore(typing ? trimmed.slice(0, -1) : trimmed);
  if (cents === null || Number.isNaN(cents)) {
    if (/^-/.test(trimmed)) {
      return { kind: "error", message: maxScoreText ? `A nota vai de 0 a ${maxScoreText}.` : "A nota não pode ser negativa." };
    }
    if (/^\d+[.,]\d{3,}$/.test(trimmed)) {
      return { kind: "error", message: "Use no máximo duas casas, como 7,25." };
    }
    return { kind: "error", message: "Use um número como 7,5, F para falta ou D para dispensa." };
  }
  if (maxScore === null) {
    return { kind: "error", message: "A avaliação ainda não tem pontuação. Defina quanto ela vale nos dados do evento." };
  }
  if (cents > maxScore) {
    return { kind: "error", message: `${formatScore(cents)} passa de ${maxScoreText}. A nota vai de 0 a ${maxScoreText}.` };
  }
  return { kind: "score", cents };
}

export function sameValue(a: CellValue, b: CellValue) {
  if (a.kind !== b.kind) return false;
  return a.kind !== "score" || a.cents === (b as { cents: number }).cents;
}

/** A linha do PUT em lote para um valor. */
export function bulkInput(studentId: number, value: CellValue): BulkGradeInput {
  if (value.kind === "score") return { studentId, status: "graded", score: value.cents };
  if (value.kind === "absent") return { studentId, status: "absent" };
  if (value.kind === "excused") return { studentId, status: "excused" };
  return { studentId, status: "cleared" };
}

/* ------------------------------------------------------------------ */
/* Rascunho da planilha                                                */
/* ------------------------------------------------------------------ */

export type SheetRow = {
  row: EventGradeRow;
  /** Número da linha (1, 2, 3), na ordem da lista. */
  number: number;
  name: string;
  /** O que está gravado. */
  before: CellValue;
  /** O que a célula mostra (o rascunho, ou o gravado). */
  text: string;
  /** A célula tem rascunho (foi mexida). */
  touched: boolean;
  /** O valor digitado é outro, e válido. */
  changed: boolean;
  /** O valor digitado lido (null: com erro). */
  after: CellValue | null;
  /** Motivo do erro da célula (digitação ou a API recusou). */
  error: string | null;
};

/** Grupo da revisão: novas, alteradas, apagadas, falta e dispensa. */
export type ChangeGroup = "new" | "changed" | "cleared" | "status";

export type SheetChange = { row: SheetRow; after: CellValue; group: ChangeGroup };

function changeGroup(before: CellValue, after: CellValue): ChangeGroup {
  if (after.kind === "absent" || after.kind === "excused") return "status";
  if (after.kind === "empty") return "cleared";
  if (before.kind === "empty") return "new";
  return "changed";
}

type UndoStep = Array<{ id: number; prev: string | undefined }>;

/**
 * Estado da planilha: o texto de cada célula mudada (o resto mostra o gravado), os erros que a API devolveu,
 * a pilha do Ctrl+Z e as linhas que piscam em verde depois de salvar.
 */
export function useGradeSheet(data: EventGrades | null) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const [stack, setStack] = useState<UndoStep[]>([]);
  const [flash, setFlash] = useState<number[]>([]);
  const flashTimer = useRef(0);

  const maxScore = data?.event.maxScore ?? null;
  const maxScoreText = data?.event.maxScoreText ?? null;

  const rows = useMemo<SheetRow[]>(() => {
    if (!data) return [];
    return data.students.map((row, index) => {
      const before = gradeValue(row.grade);
      const touched = row.studentId in drafts;
      const text = touched ? drafts[row.studentId] : valueText(before);
      const read = touched ? readCell(text, maxScore, maxScoreText) : before;
      const typed = read.kind === "error" ? read.message : null;
      const after = read.kind === "error" ? null : read;
      const changed = after !== null && !sameValue(after, before);
      return {
        row,
        number: index + 1,
        name: row.fullName || row.email,
        before,
        text,
        touched,
        changed,
        after,
        error: typed ?? (touched ? (serverErrors[row.studentId] ?? null) : null),
      };
    });
  }, [data, drafts, maxScore, maxScoreText, serverErrors]);

  const changes: SheetChange[] = rows
    .filter((item) => item.changed && item.after && !item.error)
    .map((item) => ({ row: item, after: item.after as CellValue, group: changeGroup(item.before, item.after as CellValue) }));
  const errorRows = rows.filter((item) => item.touched && item.error);
  const pending = rows.filter((item) => item.touched && (item.changed || item.error)).length;

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  function setCell(studentId: number, text: string) {
    setDrafts((current) => ({ ...current, [studentId]: text }));
    setServerErrors((current) => {
      if (!(studentId in current)) return current;
      const next = { ...current };
      delete next[studentId];
      return next;
    });
  }

  /** Grava vários de uma vez (colar uma coluna, menu da linha), como um passo só do Ctrl+Z. */
  function setCells(values: Array<{ id: number; text: string | undefined }>) {
    if (!values.length) return;
    setStack((current) => [...current.slice(-99), values.map(({ id }) => ({ id, prev: drafts[id] }))]);
    setDrafts((current) => {
      const next = { ...current };
      for (const { id, text } of values) {
        if (text === undefined) delete next[id];
        else next[id] = text;
      }
      return next;
    });
  }

  /** Guarda um passo do Ctrl+Z: o texto da célula antes da edição que acabou (ao sair dela). */
  function record(studentId: number, prev: string | undefined) {
    setStack((current) => [...current.slice(-99), [{ id: studentId, prev }]]);
  }

  /**
   * Devolve a célula ao texto de quando entrou nela (Esc, ou o Ctrl+Z dentro da célula), sem empilhar um passo:
   * o próximo Ctrl+Z volta ao passo anterior de verdade, em vez de refazer o que acabou de ser desfeito.
   */
  function restoreCell(studentId: number, text: string | undefined) {
    setDrafts((current) => {
      const next = { ...current };
      if (text === undefined) delete next[studentId];
      else next[studentId] = text;
      return next;
    });
  }

  /** Volta a linha para o gravado (o ícone Desfazer da linha). */
  function revertRow(studentId: number) {
    if (!(studentId in drafts)) return;
    setCells([{ id: studentId, text: undefined }]);
  }

  /** Ctrl+Z: desfaz o último passo; devolve as linhas que mudaram (para o foco ir até a primeira). */
  function undo(): number[] {
    const last = stack[stack.length - 1];
    if (!last) return [];
    setStack((current) => current.slice(0, -1));
    setDrafts((current) => {
      const next = { ...current };
      for (const { id, prev } of last) {
        if (prev === undefined) delete next[id];
        else next[id] = prev;
      }
      return next;
    });
    return last.map((item) => item.id);
  }

  /** Descartar: tudo volta ao gravado. */
  function discard() {
    setDrafts({});
    setServerErrors({});
    setStack([]);
  }

  /** Depois de salvar: o rascunho sai e as linhas salvas piscam em verde. */
  function markSaved(ids: number[]) {
    discard();
    setFlash(ids);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash([]), 2200);
  }

  return {
    rows,
    drafts,
    changes,
    errorRows,
    pending,
    flash,
    canUndo: stack.length > 0,
    setCell,
    setCells,
    record,
    restoreCell,
    revertRow,
    undo,
    discard,
    markSaved,
    setServerErrors,
  };
}

export type GradeSheetState = ReturnType<typeof useGradeSheet>;

/* ------------------------------------------------------------------ */
/* Menu pequeno (três pontos da linha, etiqueta de situação)           */
/* ------------------------------------------------------------------ */

type MenuItem = { id: string; label: string; icon: LucideIcon; disabled?: boolean; hint?: string };

/**
 * Botão que abre um menu pequeno. O menu entra no diálogo aberto (popoverHost), fica preso ao botão, anda com as
 * setas, fecha com Esc (sem fechar o painel), Tab ou clique fora, e devolve o foco ao botão antes da ação.
 */
function MenuButton({
  children,
  className,
  items,
  label,
  onSelect,
  title,
}: {
  children: ReactNode;
  className: string;
  items: MenuItem[];
  label: string;
  onSelect: (id: string) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useAnchoredPosition(open, triggerRef, menuRef, { gap: 6, minWidth: 220, maxHeight: 320 }, host);
  useOutsidePress(open, [triggerRef, menuRef], () => setOpen(false));

  useEffect(() => {
    if (open) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    }
  }, [open, host]);

  function show() {
    setHost(popoverHost(triggerRef.current));
    setOpen(true);
  }

  function close(focus: boolean) {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  }

  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === "ArrowDown") next = options[(index + 1) % options.length];
    else if (event.key === "ArrowUp") next = options[(index - 1 + options.length) % options.length];
    else if (event.key === "Home") next = options[0];
    else if (event.key === "End") next = options[options.length - 1];
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    } else if (event.key === "Tab") {
      event.preventDefault();
      close(true);
      return;
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={cx(className, open && "on")}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            show();
          }
        }}
        type="button"
      >
        {children}
      </button>
      {open && host
        ? createPortal(
            <div ref={menuRef} id={menuId} className="nd-menu" role="menu" aria-label={label} onKeyDown={onMenuKey}>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className="nd-menu-item"
                    role="menuitem"
                    aria-disabled={item.disabled || undefined}
                    tabIndex={-1}
                    onClick={() => {
                      if (item.disabled) return;
                      close(true);
                      onSelect(item.id);
                    }}
                    type="button"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span className="min-w-0">
                      <span className="block">{item.label}</span>
                      {item.hint ? <span className="nd-menu-hint">{item.hint}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>,
            host
          )
        : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Faixa de situação                                                   */
/* ------------------------------------------------------------------ */

/** Média, menor e maior das notas gravadas dos alunos ativos (só para a docente, nunca para o aluno). */
function stats(data: EventGrades) {
  const scores = data.students
    .filter((row) => row.enrollmentStatus === "active" && row.grade?.status === "graded" && row.grade.score !== null)
    .map((row) => row.grade?.score as number);
  if (!scores.length) return null;
  const sum = scores.reduce((total, value) => total + value, 0);
  // a média com uma casa (7,4); os três saem no mesmo formato: inteiro sem casa ("9"), senão com vírgula ("7,5")
  return { mean: Math.round(sum / scores.length / 10) * 10, min: Math.min(...scores), max: Math.max(...scores) };
}

export function GradesStatus({
  archived,
  data,
  launched,
  onUnpublish,
  publishing,
}: {
  archived: boolean;
  data: EventGrades;
  launched: number;
  onUnpublish: () => void;
  publishing: boolean;
}) {
  const { counts, event: info } = data;
  const publishedAt = info.gradesPublishedAt;
  const total = counts.students;
  const pct = total ? Math.min(100, Math.round((launched / total) * 100)) : 0;
  const numbers = stats(data);

  let status: ReactNode;
  let note: string;
  if (publishedAt) {
    note = "Alunos e responsáveis veem estas notas";
    status = (
      <MenuButton
        className="stat green nd-stat-btn"
        label={`Notas publicadas em ${formatDateBR(publishedAt)}. Mais opções`}
        items={[
          {
            id: "hide",
            label: "Ocultar as notas de novo",
            hint: "Os avisos ainda não lidos saem junto",
            icon: EyeOff,
            disabled: publishing,
          },
        ]}
        onSelect={onUnpublish}
      >
        <Eye aria-hidden />
        {`Publicadas em ${formatDateBR(publishedAt)}`}
        <ChevronDown aria-hidden />
      </MenuButton>
    );
  } else if (launched) {
    note = archived ? "Turma arquivada: só leitura" : "Só você vê estas notas até publicar";
    status = (
      <span className="stat amber">
        <EyeOff aria-hidden />
        Ocultas
      </span>
    );
  } else {
    note = archived ? "Turma arquivada: só leitura" : "Lance na tabela ou importe a planilha";
    status = <span className="stat gray">Sem notas</span>;
  }

  return (
    <section className="nd-strip" aria-label="Situação das notas">
      <div className="nd-strip-vis">
        {status}
        <small>{note}</small>
      </div>
      <div className="nd-prog">
        <div className="nd-prog-l">
          <span>
            <b>{`${launched} de ${total}`}</b> {launched === 1 ? "lançada" : "lançadas"}
          </span>
          <span>{counts.missing ? `${counts.missing} sem nota` : total ? "todos com nota" : "sem alunos ativos"}</span>
        </div>
        <span
          className={cx("nd-bar", total > 0 && launched >= total && "is-full")}
          role="progressbar"
          aria-label="Alunos com nota"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(launched, total)}
        >
          <i style={{ width: `${pct}%` }} />
        </span>
      </div>
      {numbers ? (
        <dl className="nd-nums">
          <div>
            <dt>Média</dt>
            <dd>{formatScore(numbers.mean)}</dd>
          </div>
          <div>
            <dt>Menor</dt>
            <dd>{formatScore(numbers.min)}</dd>
          </div>
          <div>
            <dt>Maior</dt>
            <dd>{formatScore(numbers.max)}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* A grade                                                             */
/* ------------------------------------------------------------------ */

type Filter = "all" | "missing" | "changed";

/** Acima disso a barra mostra a busca de aluno. */
const SEARCH_FROM = 10;

export type GradesSheetProps = {
  data: EventGrades;
  sheet: GradeSheetState;
  /** Turma arquivada: só leitura. */
  locked: boolean;
  isAdmin: boolean;
  /** Primeiro foco da parte (sr-only "Notas dos alunos"). */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** "Baixar planilha": a planilha da turma com as notas atuais. */
  onDownload: () => void;
  /** "Importar planilha": a gaveta decide se pergunta antes (rascunho na grade) e então chama `pick`. */
  onImport: (pick: () => void) => void;
  /** A planilha escolhida (botão ou arrastada sobre a grade). */
  onImportFile: (file: File) => void;
  /** Importações feitas (link discreto "Histórico de importações N"). */
  historyCount: number;
  historyRef: RefObject<HTMLButtonElement | null>;
  onOpenHistory: () => void;
  /** Botão "Importar planilha" (o foco volta para ele ao sair da importação). */
  importRef: RefObject<HTMLButtonElement | null>;
  /** Mostra o cartão "1 Baixe, 2 Preencha, 3 Importe" (nenhuma nota ainda). */
  showSteps: boolean;
  /** Algo para avisar ao leitor de tela (colou 5 notas, desfez). */
  announce: (text: string) => void;
  /** O que a gaveta pode pedir à grade (levar o foco a um aluno, mesmo escondido pela busca ou pelo filtro). */
  apiRef?: RefObject<GradesSheetApi | null>;
};

export type GradesSheetApi = {
  /** Foco na célula do aluno; se a busca ou o filtro a escondem, limpa os dois antes. */
  focusStudent: (studentId: number) => void;
  /** Foco na primeira célula da lista à vista. Devolve false se não há célula (ou se outra camada está por cima). */
  focusFirst: () => boolean;
};

export function GradesSheet({
  announce,
  apiRef,
  data,
  headingRef,
  historyCount,
  historyRef,
  importRef,
  isAdmin,
  locked,
  onDownload,
  onImport,
  onImportFile,
  onOpenHistory,
  sheet,
  showSteps,
}: GradesSheetProps) {
  const [filter, setFilter] = useState<Filter>("all");
  // "Sem nota" e "Alteradas" ficam paradas enquanto a docente digita: a linha não some ao ganhar nota
  const [frozen, setFrozen] = useState<number[]>([]);
  const [term, setTerm] = useState("");
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const entry = useRef<{ id: number; text: string | undefined } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const legendId = useId();
  const { event: info } = data;
  const { rows } = sheet;
  const maxText = info.maxScoreText;

  // "Sem nota" conta e mostra o mesmo grupo: alunos ativos sem nada gravado (quem saiu da turma não entra)
  const isMissing = (item: SheetRow) => item.row.enrollmentStatus === "active" && item.before.kind === "empty";
  const missingNow = rows.filter(isMissing);
  const changedNow = rows.filter((item) => item.touched && (item.changed || item.error));
  const query = normalizeText(term.trim());
  const visible = rows.filter((item) => {
    if (filter === "missing" && !(frozen.includes(item.row.studentId) || isMissing(item))) return false;
    if (filter === "changed" && !(frozen.includes(item.row.studentId) || (item.touched && (item.changed || item.error)))) return false;
    if (query && !normalizeText(`${item.name} ${item.row.email}`).includes(query)) return false;
    return true;
  });
  // sem pendências (salvou, descartou ou desfez tudo), a aba Alteradas sai: volta para Todos
  if (filter === "changed" && !changedNow.length) {
    setFilter("all");
    setFrozen([]);
  }

  function pickFilter(next: Filter) {
    setFilter(next);
    setFrozen(next === "missing" ? missingNow.map((item) => item.row.studentId) : next === "changed" ? changedNow.map((item) => item.row.studentId) : []);
  }

  /** Foco numa linha da lista à vista (selecionando o conteúdo, para sobrescrever direto). */
  function focusRow(studentId: number | undefined) {
    if (studentId === undefined) return false;
    const input = inputs.current.get(studentId);
    if (!input) return false;
    input.focus({ preventScroll: true });
    // a margem de rolagem da célula (CSS) deixa lugar para o cabeçalho preso e para o balão de erro
    input.scrollIntoView({ block: "nearest" });
    input.select();
    return true;
  }

  // a gaveta pede foco num aluno (a primeira nota com erro): se a busca ou o filtro o escondem, limpa e foca depois
  const pendingFocus = useRef<number | null>(null);
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    focusRow(id);
  });
  useImperativeHandle(apiRef, () => ({
    focusStudent(studentId) {
      if (focusRow(studentId)) return;
      pendingFocus.current = studentId;
      setTerm("");
      setFilter("all");
      setFrozen([]);
    },
    focusFirst() {
      const first = visible[0]?.row.studentId;
      const input = first === undefined ? undefined : inputs.current.get(first);
      if (!input || !isOnTopLayer(input)) return false;
      return focusRow(first);
    },
  }));

  function move(studentId: number, step: 1 | -1) {
    const ids = visible.map((item) => item.row.studentId);
    return focusRow(ids[ids.indexOf(studentId) + step]);
  }

  /** Saiu da célula: o que mudou nela vira um passo do Ctrl+Z. */
  function leave(studentId: number) {
    const start = entry.current;
    if (start && start.id === studentId && sheet.drafts[studentId] !== start.text) {
      sheet.record(studentId, start.text);
    }
    entry.current = null;
  }

  function onCellKey(event: ReactKeyboardEvent<HTMLInputElement>, item: SheetRow) {
    const id = item.row.studentId;
    if (event.key === "Enter" || (event.key === "ArrowDown" && !event.altKey)) {
      event.preventDefault();
      move(id, event.key === "Enter" && event.shiftKey ? -1 : 1);
    } else if (event.key === "ArrowUp" && !event.altKey) {
      event.preventDefault();
      move(id, -1);
    } else if (event.key === "Escape") {
      // Esc desfaz o que foi digitado nesta célula; sem nada digitado, o Esc é do painel
      const start = entry.current;
      if (start && start.id === id && sheet.drafts[id] !== start.text) {
        event.preventDefault();
        sheet.restoreCell(id, start.text);
        window.requestAnimationFrame(() => inputs.current.get(id)?.select());
      }
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const start = entry.current;
      if (start && start.id === id && sheet.drafts[id] !== start.text) {
        // primeiro desfaz o que foi digitado nesta célula (sem passo novo); o próximo Ctrl+Z volta no histórico
        sheet.restoreCell(id, start.text);
        window.requestAnimationFrame(() => inputs.current.get(id)?.select());
        return;
      }
      const ids = sheet.undo();
      if (ids.length) {
        announce(ids.length === 1 ? "Mudança desfeita." : `${ids.length} mudanças desfeitas.`);
        window.requestAnimationFrame(() => focusRow(ids[0]));
        entry.current = null;
      }
    }
  }

  function onCellChange(item: SheetRow, value: string) {
    const id = item.row.studentId;
    const word = normalizeText(value.trim());
    // F e D viram a etiqueta na hora; o conteúdo fica selecionado, e o próximo dígito troca por uma nota.
    // Menos quando se está apagando: com Backspace em "Falta", o "F" que sobra não volta a ser "Falta"
    const deleting = value.length < item.text.length && item.text.startsWith(value);
    if ((word === "f" || word === "d") && !deleting) {
      sheet.setCell(id, word === "f" ? ABSENT_TEXT : EXCUSED_TEXT);
      window.requestAnimationFrame(() => inputs.current.get(id)?.select());
      return;
    }
    sheet.setCell(id, value);
  }

  /** Colar uma coluna do Excel ou do Sheets: preenche para baixo a partir da célula. */
  function onCellPaste(event: ClipboardEvent<HTMLInputElement>, item: SheetRow) {
    // turma arquivada: só leitura (o readOnly do campo não segura o colar de várias linhas)
    if (locked) {
      event.preventDefault();
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (!/[\r\n\t]/.test(text.replace(/[\r\n]+$/, ""))) return;
    event.preventDefault();
    const values = text
      .replace(/\r/g, "")
      .replace(/\n+$/, "")
      .split("\n")
      .map((line) => {
        const value = line.split("\t")[0].trim();
        // F e D da planilha viram a etiqueta, como ao digitar
        const word = normalizeText(value);
        return ABSENT_WORDS.has(word) ? ABSENT_TEXT : EXCUSED_WORDS.has(word) ? EXCUSED_TEXT : value;
      });
    const ids = visible.map((row) => row.row.studentId);
    const start = ids.indexOf(item.row.studentId);
    const targets = ids.slice(start, start + values.length);
    sheet.setCells(targets.map((id, index) => ({ id, text: values[index] })));
    entry.current = null;
    const left = values.length - targets.length;
    announce(
      `${countText(targets.length, "valor colado", "valores colados")}${left ? `. ${countText(left, "valor ficou", "valores ficaram")} de fora: a lista acabou.` : "."}`
    );
  }

  function onMenu(item: SheetRow, choice: string) {
    const id = item.row.studentId;
    if (choice === "score") {
      sheet.setCells([{ id, text: item.before.kind === "score" ? valueText(item.before) : "" }]);
      window.requestAnimationFrame(() => focusRow(id));
      return;
    }
    const text = choice === "absent" ? ABSENT_TEXT : choice === "excused" ? EXCUSED_TEXT : "";
    sheet.setCells([{ id, text }]);
    announce(
      `${item.name}: ${choice === "absent" ? "falta" : choice === "excused" ? "dispensa" : "sem nota"}, ainda não salvo.`
    );
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (locked || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    if (!dropping) setDropping(true);
  }

  const missingCount = missingNow.length;
  const scoreHeader = maxText ? `Nota, de 0 a ${maxText}` : "Nota";

  return (
    <div
      className="nd-sheet"
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!dropping) return;
        event.preventDefault();
        setDropping(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onImport(() => onImportFile(file));
      }}
    >
      <h3 ref={headingRef} className="sr-only" tabIndex={-1}>
        Notas dos alunos
      </h3>

      {showSteps && !locked ? (
        <ol className="nd-steps" aria-label="Como lançar as notas">
          <li>
            <span className="nd-steps-n" aria-hidden>
              1
            </span>
            <span className="min-w-0">
              <b>Baixe a planilha da turma</b>
              <span>já vem com os alunos</span>
            </span>
          </li>
          <li>
            <span className="nd-steps-n" aria-hidden>
              2
            </span>
            <span className="min-w-0">
              <b>Preencha no Excel</b>
              <span>uma nota por aluno</span>
            </span>
          </li>
          <li>
            <span className="nd-steps-n" aria-hidden>
              3
            </span>
            <span className="min-w-0">
              <b>Importe aqui</b>
              <span>ou digite direto na tabela</span>
            </span>
          </li>
        </ol>
      ) : null}

      <div className="nd-tbar">
        <div className="seg nd-seg" role="group" aria-label="Quais alunos mostrar">
          <button className={cx(filter === "all" && "on")} aria-pressed={filter === "all"} onClick={() => pickFilter("all")} type="button">
            Todos <span className="n">{rows.length}</span>
          </button>
          <button
            className={cx(filter === "missing" && "on")}
            aria-pressed={filter === "missing"}
            onClick={() => pickFilter("missing")}
            type="button"
          >
            Sem nota <span className="n">{missingCount}</span>
          </button>
          {changedNow.length || filter === "changed" ? (
            <button
              className={cx(filter === "changed" && "on")}
              aria-pressed={filter === "changed"}
              onClick={() => pickFilter("changed")}
              type="button"
            >
              Alteradas <span className="n nd-n-amb">{changedNow.length}</span>
            </button>
          ) : null}
        </div>
        {rows.length > SEARCH_FROM ? (
          <label className="nd-search" htmlFor={searchId}>
            <Search className="h-4 w-4" aria-hidden />
            <input
              id={searchId}
              className="nd-search-input"
              aria-label="Buscar aluno"
              autoComplete="off"
              placeholder="Buscar aluno"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && term) {
                  event.preventDefault();
                  setTerm("");
                } else if (event.key === "Enter" || event.key === "ArrowDown") {
                  event.preventDefault();
                  focusRow(visible[0]?.row.studentId);
                }
              }}
            />
            {term ? (
              <button className="nd-search-x" aria-label="Limpar a busca" onClick={() => setTerm("")} type="button">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </label>
        ) : null}
        <div className="nd-tbar-files" role="group" aria-label="Planilha">
          <button className="btn btn-s" aria-label="Baixar planilha" onClick={onDownload} type="button">
            <Download className="h-4 w-4" aria-hidden />
            <span className="nd-lbl-long">Baixar planilha</span>
            <span className="nd-lbl-short">Baixar</span>
          </button>
          {!locked ? (
            <button
              ref={importRef}
              className="btn btn-s"
              aria-label="Importar planilha"
              onClick={() => onImport(() => fileRef.current?.click())}
              type="button"
            >
              <Upload className="h-4 w-4" aria-hidden />
              <span className="nd-lbl-long">Importar planilha</span>
              <span className="nd-lbl-short">Importar</span>
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          type="file"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (selected) onImportFile(selected);
          }}
        />
      </div>

      <div className="nd-legend">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <p id={legendId} className="min-w-0">
          {locked ? (
            "Turma arquivada: as notas ficam só para leitura."
          ) : (
            <>
              <span className="nd-legend-keys">
                Digite a nota com vírgula. <span className="kbd">F</span> falta, <span className="kbd">D</span> dispensa,{" "}
                <span className="kbd">Enter</span> desce para o próximo aluno.
                <span className="sr-only"> Dá para colar uma coluna de notas do Excel a partir de uma célula.</span>
              </span>
              <span className="nd-legend-touch">
                Falta e dispensa ficam no menu <MoreHorizontal className="nd-legend-ico" aria-hidden />
                <span className="sr-only"> Mais opções de cada aluno. A nota vai com vírgula, como 7,5.</span>
              </span>
            </>
          )}
        </p>
        {historyCount ? (
          <button
            ref={historyRef}
            className="nd-hist"
            aria-label={`Histórico de importações, ${historyCount}`}
            onClick={onOpenHistory}
            type="button"
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            <span className="nd-lbl-long">Histórico de importações</span>
            <span className="nd-lbl-short">Histórico</span>
            <span className="badge">{historyCount}</span>
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          text="Nenhum aluno ativo na turma"
          hint="Os alunos entram pela secretaria ou pelo código da turma. Quando entrarem, aparecem na lista para lançar a nota."
        />
      ) : visible.length === 0 ? (
        <div className="empty-inline compact" role="status">
          <span className="empty-ico">
            {filter === "missing" ? <Check aria-hidden /> : <Search aria-hidden />}
          </span>
          <div className="empty-body">
            <p className="empty-t">
              {query ? `Nenhum aluno com “${term.trim()}”` : filter === "missing" ? "Todos os alunos têm nota" : "Nenhuma alteração"}
            </p>
            <button className="btn btn-s btn-sm" onClick={() => (query ? setTerm("") : pickFilter("all"))} type="button">
              {query ? "Limpar a busca" : `Ver todos (${rows.length})`}
            </button>
          </div>
        </div>
      ) : (
        <div className="nd-tablewrap">
          <table className="nd-table" aria-describedby={legendId}>
            <caption className="sr-only">{`Notas de ${info.title}${maxText ? `, de 0 a ${maxText}` : ""}`}</caption>
            <thead>
              <tr>
                <th scope="col" className="nd-c-no">
                  Nº
                </th>
                <th scope="col">Aluno</th>
                <th scope="col" className="nd-c-cell">
                  {scoreHeader}
                </th>
                <th scope="col" className="nd-c-before">
                  Antes
                </th>
                <th scope="col" className="nd-c-ico">
                  <span className="sr-only">Situação</span>
                </th>
                <th scope="col" className="nd-c-act">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item, index) => (
                <SheetLine
                  key={item.row.studentId}
                  index={index}
                  focused={focusedId === item.row.studentId}
                  flash={sheet.flash.includes(item.row.studentId)}
                  isAdmin={isAdmin}
                  item={item}
                  locked={locked}
                  maxText={maxText}
                  noPoints={info.maxScore === null}
                  registerInput={(element) => {
                    if (element) inputs.current.set(item.row.studentId, element);
                    else inputs.current.delete(item.row.studentId);
                  }}
                  onBlur={() => {
                    leave(item.row.studentId);
                    setFocusedId((current) => (current === item.row.studentId ? null : current));
                  }}
                  onChange={(value) => onCellChange(item, value)}
                  onFocus={(input) => {
                    entry.current = { id: item.row.studentId, text: sheet.drafts[item.row.studentId] };
                    setFocusedId(item.row.studentId);
                    input.select();
                  }}
                  onKeyDown={(event) => onCellKey(event, item)}
                  onMenu={(choice) => onMenu(item, choice)}
                  onPaste={(event) => onCellPaste(event, item)}
                  onRevert={() => {
                    sheet.revertRow(item.row.studentId);
                    announce(`Mudança de ${item.name} desfeita.`);
                    window.requestAnimationFrame(() => focusRow(item.row.studentId));
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dropping ? (
        <div className="nd-drop" aria-hidden>
          <Upload className="h-7 w-7" />
          <p>Solte para importar a planilha</p>
        </div>
      ) : null}
    </div>
  );
}

function SheetLine({
  flash,
  focused,
  index,
  isAdmin,
  item,
  locked,
  maxText,
  noPoints,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  onMenu,
  onPaste,
  onRevert,
  registerInput,
}: {
  flash: boolean;
  focused: boolean;
  /** Posição na lista à vista: atrasa a entrada da linha (cascata, só nas primeiras). */
  index: number;
  isAdmin: boolean;
  item: SheetRow;
  locked: boolean;
  maxText: string | null;
  noPoints: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  onFocus: (input: HTMLInputElement) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onMenu: (choice: string) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onRevert: () => void;
  registerInput: (element: HTMLInputElement | null) => void;
}) {
  const errorId = useId();
  const selectOnUp = useRef(false);
  const { after, before, changed, error, name, row, text, touched } = item;
  const shown = after ?? null;
  const pending = touched && (changed || Boolean(error));
  const tag = shown?.kind === "absent" ? "is-f" : shown?.kind === "excused" ? "is-d" : null;
  const empty = !text.trim();
  const isNew = pending && before.kind === "empty" && !error;
  const cleared = changed && shown?.kind === "empty";
  const meta = [row.email !== name ? row.email : null, isAdmin && row.registration ? `matrícula ${row.registration}` : null]
    .filter(Boolean)
    .join(", ");
  const left = row.enrollmentStatus !== "active";
  const menuItems: MenuItem[] = [
    // no celular o botão de desfazer some da linha e fica só aqui
    ...(pending ? [{ id: "revert", label: "Desfazer a mudança", icon: RotateCcw }] : []),
    { id: "score", label: "Lançar nota", icon: PenLine, disabled: noPoints },
    { id: "absent", label: "Marcar falta", icon: UserX, disabled: shown?.kind === "absent" },
    { id: "excused", label: "Marcar dispensa", icon: Ban, disabled: shown?.kind === "excused" },
    { id: "clear", label: "Deixar sem nota", icon: X, disabled: shown?.kind === "empty" },
  ];

  return (
    <tr
      className={cx("nd-row", pending && !error && "is-pend", error && "is-bad", flash && "is-saved")}
      style={{ "--i": Math.min(index, 14) } as CSSProperties}
    >
      <td className="nd-c-no">{item.number}</td>
      <td className="nd-c-st">
        <span className="nd-nm" title={name}>{name}</span>
        {meta ? <span className="nd-em">{meta}</span> : null}
        {left ? <span className="nd-tag">saiu da turma</span> : null}
        {isNew ? <span className="nd-tag is-new">Nova</span> : null}
        {/* no celular a coluna Antes vira uma linha pequena abaixo do nome */}
        {pending && !isNew ? <span className="nd-before-m">{`antes ${valueLabel(before)}`}</span> : null}
      </td>
      <td className="nd-c-cell">
        <div className={cx("nd-cell", tag, error && "is-err", pending && !error && "is-chg", empty && "is-empty", cleared && "is-clear")}>
          <input
            ref={registerInput}
            className="nd-input"
            data-student-id={row.studentId}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            aria-label={maxText ? `Nota de ${name}, de 0 a ${maxText}` : `Nota de ${name}`}
            autoComplete="off"
            enterKeyHint="next"
            inputMode="decimal"
            placeholder={cleared ? "apagar" : "sem nota"}
            readOnly={locked}
            spellCheck={false}
            value={text}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
            onFocus={(event) => onFocus(event.currentTarget)}
            onMouseDown={(event) => {
              selectOnUp.current = document.activeElement !== event.currentTarget;
            }}
            onMouseUp={(event) => {
              // o clique que entra na célula deixa o conteúdo selecionado (como numa planilha: digitar troca a nota);
              // com a célula já em foco, o clique posiciona o cursor normalmente
              if (selectOnUp.current) event.preventDefault();
              selectOnUp.current = false;
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {error ? (
            <span id={errorId} className={focused ? "nd-balloon" : "sr-only"} role={focused ? "alert" : undefined}>
              <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </span>
          ) : null}
        </div>
      </td>
      <td className="nd-c-before">
        {pending && !isNew ? (
          before.kind === "empty" ? (
            <span className="nd-before-none">sem nota</span>
          ) : (
            <s aria-label={`antes ${valueLabel(before)}`}>{valueLabel(before)}</s>
          )
        ) : null}
      </td>
      <td className="nd-c-ico">
        {error ? (
          <CircleAlert className="h-4 w-4 text-[var(--red)]" aria-label="Com erro" />
        ) : flash ? (
          <Check className="h-4 w-4 text-[var(--green)]" strokeWidth={2.6} aria-label="Salva" />
        ) : !pending && before.kind !== "empty" ? (
          <Check className="h-4 w-4 text-faint" aria-label="Gravada" />
        ) : null}
      </td>
      <td className="nd-c-act">
        <span className="nd-acts">
          {pending ? (
            <button className="ib sm ghost nd-undo" aria-label={`Desfazer a mudança de ${name}`} title="Desfazer" onClick={onRevert} type="button">
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          {!locked ? (
            <MenuButton className="ib sm ghost" items={menuItems} label={`Mais opções de ${name}`} onSelect={(choice) => (choice === "revert" ? onRevert() : onMenu(choice))} title="Mais opções">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </MenuButton>
          ) : null}
        </span>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Revisar e salvar                                                    */
/* ------------------------------------------------------------------ */

const groupTitles: Record<ChangeGroup, [string, string]> = {
  new: ["Nova", "Novas"],
  changed: ["Alterada", "Alteradas"],
  cleared: ["Apagada", "Apagadas"],
  status: ["Falta e dispensa", "Falta e dispensa"],
};
const groupOrder: ChangeGroup[] = ["new", "changed", "status", "cleared"];

export function GradesReview({
  archived,
  changes,
  headingRef,
  onPublishAfter,
  publishAfter,
  published,
}: {
  archived: boolean;
  changes: SheetChange[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  onPublishAfter: (value: boolean) => void;
  publishAfter: boolean;
  published: boolean;
}) {
  const people = new Set(changes.map((change) => change.row.row.studentId)).size;
  return (
    <div className="nd-review">
      <div>
        <h3 ref={headingRef} className="drawer-h3 outline-none" tabIndex={-1}>
          {changes.length === 1 ? "Revisar 1 alteração" : `Revisar ${changes.length} alterações`}
        </h3>
        <p className="mt-1 text-[13px] text-muted">Nada foi gravado ainda. Confira e salve tudo de uma vez.</p>
      </div>
      {published ? (
        <p className="callout amber">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b>Estas notas já estão publicadas.</b>{" "}
            {people === 1
              ? "O aluno e os responsáveis veem a nota nova assim que você salvar, e recebem um aviso da mudança."
              : `Os ${people} alunos e os responsáveis veem a nota nova assim que você salvar, e recebem um aviso da mudança.`}
          </span>
        </p>
      ) : (
        <p className="callout past">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b>As notas continuam ocultas.</b> Ninguém vê até você publicar.
          </span>
        </p>
      )}
      {groupOrder.map((group) => {
        const list = changes.filter((change) => change.group === group);
        if (!list.length) return null;
        const [one, many] = groupTitles[group];
        return (
          <section key={group} className="nd-rv-group" aria-label={`${list.length === 1 ? one : many}, ${list.length}`}>
            <h4 className="nd-rv-h">
              {list.length === 1 ? one : many} <span className="badge">{list.length}</span>
            </h4>
            <ul className="nd-rv-list">
              {list.map(({ after, row }) => (
                <li
                  key={row.row.studentId}
                  className={cx(group === "cleared" && "is-clear", after.kind === "absent" && "is-f", after.kind === "excused" && "is-d")}
                >
                  <span className="nd-rv-name">{row.name}</span>
                  <ValueChange
                    from={row.before.kind === "empty" ? "" : valueLabel(row.before)}
                    to={valueLabel(after)}
                    tone={group === "cleared" ? "off" : undefined}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!published && !archived ? (
        <label className="nd-rv-pub">
          <input type="checkbox" checked={publishAfter} onChange={(event) => onPublishAfter(event.target.checked)} />
          <span>
            <b>Publicar para alunos e responsáveis depois de salvar</b>
            <span>Eles recebem um aviso. Dá para ocultar de novo depois.</span>
          </span>
        </label>
      ) : null}
    </div>
  );
}
