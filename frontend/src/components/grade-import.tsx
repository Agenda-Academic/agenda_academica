"use client";

import {
  Check,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileUp,
  Loader2,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { ApiError, applyGradeImport, conflictOf, createGradeImport, deleteGradeImport } from "@/lib/api";
import { countText, cx, errorMessage, fieldErrors, formatShortDateTime, parseScore } from "@/lib/format";
import {
  GradesFileError,
  MAX_BODY_BYTES,
  buildImportRows,
  columnHasData,
  columnSamples,
  columnsVerdict,
  downloadRejected as downloadRejectedSheet,
  downloadTemplate as downloadTemplateSheet,
  fileSlug,
  fitColumns,
  guessColumns,
  jsonSize,
  loadSavedMapping,
  readGradesFile,
  saveMapping,
  toMapping,
  type ColumnChoice,
  type GradesFile,
  type IdentifierType,
} from "@/lib/grades-file";
import type {
  EventGradeRow,
  GradeEventInfo,
  GradeImport,
  GradeImportApplied,
  GradeImportInput,
} from "@/lib/types";
import { useAppActions } from "./app-actions";
import {
  GradeImportPreview,
  importKindCounts,
  importableCount,
  rejectedCount,
  rejectedKinds,
  rowReason,
  situationLabel,
} from "./grade-import-preview";
import { Select, type SelectOption } from "./select";
import { Field, Segmented, SegmentedButton, primaryButton, secondaryButton } from "./ui";

/**
 * Importar notas, dentro da gaveta da avaliação (EventGradesDrawer), em três passos à vista:
 * 1. Enviar: baixar a planilha da turma e soltar a planilha preenchida. Ao escolher, a tela lê a planilha, acha
 *    sozinha a coluna do aluno (e-mail, matrícula ou nome) e a da nota e já cria o rascunho, mostrando o
 *    andamento ("Lendo a planilha", "Conferindo os alunos da turma"). Só pergunta as colunas quando não dá para
 *    adivinhar, ou quando a docente pede ("Ajustar colunas").
 * 2. Conferir: os números (para importar, iguais, com problema) e cada linha com a situação.
 * 3. Pronto: quantas notas entraram, se os alunos já veem e as próximas ações (publicar, ver a lista, desfazer).
 * O estado fica no hook useGradeImport; a gaveta desenha GradeImportBody no corpo e GradeImportFooter no rodapé.
 * Dona: área Notas (docente).
 */

export type ImportStep = "send" | "columns" | "check" | "done";

type FocusField = "file" | "points" | "identifier" | "score";

type ColumnErrors = { identifierColumn?: string; scoreColumn?: string; general?: string };

/** Por que as colunas apareceram: a tela não achou a do aluno ou a da nota, ou a docente pediu para ajustar. */
type ColumnsReason = "student" | "score" | "asked";

export type GradeImportOptions = {
  /** A avaliação (GET /events/:id/grades). */
  info: GradeEventInfo | null;
  /** Alunos da lista de notas (para a planilha da turma). */
  students: EventGradeRow[];
  /** As notas da avaliação já estão publicadas (o Pronto diz se os alunos já veem). */
  published: boolean;
  /** Importações da avaliação (o Pronto percebe a importação desfeita pelo aviso). */
  imports: GradeImport[] | null;
  /** Publicando as notas (o botão "Publicar notas agora" do Pronto). */
  publishing: boolean;
  /** Publica as notas da avaliação (a mesma ação do resumo da gaveta). */
  onPublish: () => void;
  /** Importação sendo desfeita (id), para o botão do Pronto girar. */
  undoingId: number | null;
  /** "Desfazer importação" do Pronto: confirma e desfaz. */
  onUndoApplied: (applied: GradeImportApplied) => void;
  /** Sai da importação (volta para a gaveta da avaliação). */
  onExit: () => void;
  /** "Ver a lista de notas" do Pronto: volta para a gaveta, com a lista atualizada. */
  onFinish: () => void;
  /** Aplicou: a gaveta recarrega a lista (a importação segue no Pronto, que tem o Desfazer). */
  onApplied: (result: GradeImportApplied, message: string) => void;
  /** Um rascunho foi criado ou descartado (a lista de importações muda). */
  onDraftsChanged: () => void;
  /** A importação gravou a pontuação no evento (a página recarrega os eventos). */
  onPointsSet: () => void;
};

export type GradeImportFlow = ReturnType<typeof useGradeImport>;

/** Espera o andamento ficar à vista por um instante (a planilha pequena é lida num piscar). */
function atLeast(started: number, ms: number) {
  const left = ms - (Date.now() - started);
  return left > 0 ? new Promise<void>((resolve) => window.setTimeout(resolve, left)) : Promise.resolve();
}

const idWords: Record<IdentifierType, { article: string; name: string; label: string }> = {
  name: { article: "o nome", name: "nome", label: "Coluna do nome" },
  email: { article: "o e-mail", name: "e-mail", label: "Coluna do e-mail" },
  registration: { article: "a matrícula", name: "matrícula", label: "Coluna da matrícula" },
};

export function useGradeImport({
  imports,
  info,
  onApplied,
  onDraftsChanged,
  onExit,
  onFinish,
  onPointsSet,
  onPublish,
  onUndoApplied,
  published,
  publishing,
  students,
  undoingId,
}: GradeImportOptions) {
  const { token, toast, showError, confirm } = useAppActions();
  const [step, setStep] = useState<ImportStep>("send");
  const [file, setFile] = useState<GradesFile | null>(null);
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  /** Nome da planilha que está sendo lida (o andamento mostra antes de ela ser lida). */
  const [readingName, setReadingName] = useState("");
  const [pointsText, setPointsTextState] = useState("");
  const [pointsError, setPointsError] = useState("");
  const [columns, setColumnsState] = useState<ColumnChoice | null>(null);
  const [columnsReason, setColumnsReason] = useState<ColumnsReason>("asked");
  const [columnErrors, setColumnErrors] = useState<ColumnErrors>({});
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<GradeImport | null>(null);
  const [keepAgenda, setKeepAgenda] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<GradeImportApplied | null>(null);
  /** As notas já estavam publicadas quando a importação foi aplicada (o Pronto diz se acabou de publicar). */
  const [publishedBefore, setPublishedBefore] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [blocked, setBlocked] = useState("");

  // campo a focar depois de uma validação (cada passo tem os próprios refs e atende o pedido)
  const [focusAsk, setFocusAsk] = useState<{ field: FocusField; n: number } | null>(null);
  const askFocus = (field: FocusField) => setFocusAsk((current) => ({ field, n: (current?.n ?? 0) + 1 }));

  /** Troca de passo; um pedido de foco antigo não vale para o passo novo. */
  function goStep(next: ImportStep) {
    setStep(next);
    setFocusAsk(null);
  }

  const needsPoints = info !== null && info.maxScore === null;
  const counts = draft ? importKindCounts(draft) : null;
  const importCount = counts ? importableCount(counts, keepAgenda) : 0;
  const busy = reading || sending || applying || discarding;
  // alunos ativos da planilha da turma
  const templateStudents = students.filter((student) => student.enrollmentStatus === "active");

  function reset() {
    setFile(null);
    setFileError("");
    setReading(false);
    setReadingName("");
    setPointsTextState("");
    setPointsError("");
    setColumnsState(null);
    setColumnsReason("asked");
    setColumnErrors({});
    setDraft(null);
    setKeepAgenda(true);
    setApplied(null);
    setBlocked("");
    setFocusAsk(null);
  }

  /** Começa uma importação nova, no passo Enviar. */
  function start() {
    reset();
    goStep("send");
  }

  /**
   * "Importar planilha" da grade: a planilha já foi escolhida no seletor do sistema (ou arrastada sobre a grade).
   * Começa do zero e lê na hora: sem perguntas, vai direto ao Conferir. O passo Enviar só aparece quando falta a
   * pontuação da avaliação ou quando a leitura falha.
   */
  function startWithFile(selected: File) {
    reset();
    goStep("send");
    void chooseFile(selected);
  }

  /** Abre um rascunho da lista ("Continuar") direto em Conferir. */
  function openDraft(value: GradeImport) {
    reset();
    setDraft(value);
    goStep("check");
  }

  function setPointsText(value: string) {
    setPointsTextState(value);
    if (pointsError) setPointsError("");
  }

  function setColumns(patch: Partial<ColumnChoice>) {
    if (!file) return;
    setColumnsState((current) => {
      const base = current ?? guessColumns(file.sheet, undefined, info?.title);
      const next = { ...base, ...patch };
      // trocou o jeito de achar o aluno: a coluna do aluno acompanha, se a escolhida não serve
      if (patch.identifierType && patch.identifierType !== base.identifierType && !patch.identifierColumn) {
        const guess = guessColumns(file.sheet, patch.identifierType, info?.title);
        if (guess.identifierColumn && guess.identifierColumn !== next.scoreColumn) {
          next.identifierColumn = guess.identifierColumn;
        }
        next.nameColumn = patch.identifierType === "name" ? "" : guess.nameColumn !== next.identifierColumn ? guess.nameColumn : "";
      }
      return next;
    });
    setColumnErrors({});
  }

  /** Pontuação digitada em número (10, 7,5) ou null se inválida. */
  function pointsValue() {
    const cents = parseScore(pointsText);
    if (cents === null || Number.isNaN(cents) || cents < 1 || cents > 99999) {
      return null;
    }
    return cents / 100;
  }

  /** Escolheu a planilha: lê, acha as colunas e, se der, confere na hora (sem perguntar nada). */
  async function chooseFile(selected: File | null | undefined) {
    if (!selected || busy) return;
    const started = Date.now();
    setReadingName(selected.name);
    setReading(true);
    setFileError("");
    setColumnErrors({});
    let read: GradesFile;
    try {
      read = await readGradesFile(selected);
    } catch (error) {
      await atLeast(started, 350);
      setFile(null);
      setColumnsState(null);
      setReading(false);
      setFileError(
        error instanceof GradesFileError
          ? error.message
          : "Não deu para ler a planilha. Confira se ela é do Excel (.xlsx) e escolha de novo."
      );
      askFocus("file");
      return;
    }
    const guess = fitColumns(read.sheet, loadSavedMapping(), info?.title);
    setFile(read);
    setColumnsState(guess);
    await atLeast(started, 450);
    setReading(false);
    await proceed(read, guess, started);
  }

  /**
   * Depois de ler: a planilha da turma ainda sem notas volta com o aviso; sem a pontuação, pede a pontuação; sem
   * a coluna do aluno ou da nota, mostra as colunas; com tudo, cria o rascunho e vai para Conferir.
   */
  async function proceed(read: GradesFile, choice: ColumnChoice, started = Date.now()) {
    const verdict = columnsVerdict(read.sheet, choice);
    if (verdict === "empty-score") {
      setFile(null);
      setColumnsState(null);
      setFileError(
        `A coluna ${choice.scoreColumn} está vazia nesta planilha. Escreva a nota de cada aluno, salve a planilha e envie de novo.`
      );
      askFocus("file");
      return;
    }
    if (needsPoints && pointsValue() === null) {
      setPointsError("Informe quanto vale a avaliação para conferir as notas, de 0,01 a 999,99. Exemplo: 10.");
      askFocus("points");
      return;
    }
    if (verdict !== "ok") {
      setColumnsReason(verdict);
      goStep("columns");
      return;
    }
    await send(read, choice, "send", started);
  }

  /** Cria o rascunho (POST /grade-imports) e vai para Conferir. */
  async function send(read: GradesFile, choice: ColumnChoice, from: "send" | "columns", started = Date.now()) {
    if (!info || busy) return;
    const fail = (message: string) => {
      if (from === "columns") {
        setColumnErrors({ general: message });
      } else {
        setFileError(message);
        askFocus("file");
      }
    };
    const errors: ColumnErrors = {};
    const idText = idWords[choice.identifierType].article;
    if (!choice.identifierColumn) {
      errors.identifierColumn = `Escolha a coluna com ${idText} do aluno.`;
    } else if (!columnHasData(read.sheet, choice.identifierColumn)) {
      // coluna vazia: nenhuma linha acharia o aluno
      errors.identifierColumn = `A coluna ${choice.identifierColumn} está vazia nesta planilha. Escolha a coluna com ${idText} dos alunos.`;
    }
    if (!choice.scoreColumn) {
      errors.scoreColumn = "Escolha a coluna com a nota.";
    } else if (choice.scoreColumn === choice.identifierColumn) {
      errors.scoreColumn = "A nota precisa vir de outra coluna, diferente da coluna do aluno.";
    }
    if (errors.identifierColumn || errors.scoreColumn) {
      setColumnErrors(errors);
      if (from === "send") setColumnsReason(errors.identifierColumn ? "student" : "score");
      goStep("columns");
      askFocus(errors.identifierColumn ? "identifier" : "score");
      return;
    }
    const rows = buildImportRows(read.sheet, choice);
    if (!rows.length) {
      fail("Nenhuma linha com dados nessas colunas. Confira se escolheu as colunas certas.");
      return;
    }
    const points = needsPoints ? pointsValue() : null;
    if (needsPoints && points === null) {
      setPointsError("Informe quanto vale a avaliação para conferir as notas, de 0,01 a 999,99. Exemplo: 10.");
      goStep("send");
      askFocus("points");
      return;
    }
    const input: GradeImportInput = {
      academicEventId: info.id,
      // a origem não é escolhida na tela: a planilha é lida igual, venha de onde vier
      source: "modelo",
      fileName: read.name.slice(0, 200),
      checksum: read.checksum.slice(0, 128),
      fileModifiedAt: read.modifiedAt,
      mapping: toMapping(choice),
      rows,
      ...(points !== null ? { points } : {}),
    };
    if (jsonSize(input) > MAX_BODY_BYTES) {
      fail("As linhas desta planilha passam de 1 MB para enviar. Divida a planilha em duas importações.");
      return;
    }

    setSending(true);
    setColumnErrors({});
    // mandou de novo (outra planilha ou outras colunas): o rascunho anterior sai, para a lista não juntar rascunhos
    const previous = draft && draft.status === "draft" ? draft : null;
    try {
      if (previous) {
        await deleteGradeImport(token, previous.id).catch(() => undefined);
      }
      const created = await createGradeImport(token, input);
      saveMapping(toMapping(choice));
      await atLeast(started, from === "send" ? 1000 : 550);
      setDraft(created);
      setKeepAgenda(true);
      setSending(false);
      goStep("check");
      onDraftsChanged();
      if (points !== null) {
        onPointsSet();
      }
    } catch (error) {
      setSending(false);
      if (previous) {
        setDraft(null);
        onDraftsChanged();
      }
      const fields = fieldErrors(error);
      if (fields.points) {
        setPointsError(fields.points);
        goStep("send");
        askFocus("points");
        return;
      }
      if (error instanceof ApiError && error.status === 413) {
        fail("As linhas desta planilha passam de 1 MB para enviar. Divida a planilha em duas importações.");
        return;
      }
      if (conflictOf(error, "ARCHIVED")) {
        setBlocked(errorMessage(error));
        return;
      }
      if (fields["mapping.identifierColumn"] || fields["mapping.scoreColumn"]) {
        setColumnErrors({
          identifierColumn: fields["mapping.identifierColumn"],
          scoreColumn: fields["mapping.scoreColumn"],
        });
        goStep("columns");
        return;
      }
      fail(errorMessage(error));
    }
  }

  async function apply() {
    if (!draft || applying || importCount === 0) return;
    setApplying(true);
    try {
      const newer = counts?.newer_in_agenda ?? 0;
      const { data, message } = await applyGradeImport(token, draft.id, newer > 0 ? keepAgenda : undefined);
      setApplied(data);
      setPublishedBefore(published);
      setDraft(null);
      setFile(null);
      setColumnsState(null);
      goStep("done");
      onApplied(data, message);
    } catch (error) {
      showError(error, `notas-importacao-${draft.id}`);
      if (conflictOf(error, "NOT_DRAFT")) {
        onDraftsChanged();
        onExit();
      } else if (conflictOf(error, "ARCHIVED")) {
        setBlocked(errorMessage(error));
      }
    } finally {
      setApplying(false);
    }
  }

  function discardDraft() {
    if (!draft) return;
    const target = draft;
    confirm({
      title: "Descartar o rascunho?",
      message: "Nenhuma nota muda. Para importar esta planilha depois, envie ela de novo.",
      confirmLabel: "Descartar rascunho",
      cancelLabel: "Manter rascunho",
      action: async () => {
        setDiscarding(true);
        try {
          const { message } = await deleteGradeImport(token, target.id);
          toast(message, { key: `notas-importacao-${target.id}` });
          setDraft(null);
          onDraftsChanged();
          onExit();
        } catch (error) {
          showError(error, `notas-importacao-${target.id}`);
          if (conflictOf(error, "NOT_DRAFT")) {
            onDraftsChanged();
            onExit();
          }
        } finally {
          setDiscarding(false);
        }
      },
    });
  }

  async function downloadTemplate() {
    if (!info) return;
    const active = templateStudents;
    try {
      await downloadTemplateSheet(info, active);
      const withGrades = active.some((student) => student.grade);
      toast(
        active.length
          ? `Planilha baixada com ${countText(active.length, "aluno", "alunos")}${withGrades ? " e as notas atuais" : ""}. Preencha e use Importar planilha.`
          : "Planilha baixada. A turma ainda não tem alunos ativos: preencha nome, e-mail e nota de cada um.",
        { tone: "info", key: "notas-modelo" }
      );
    } catch {
      toast("Não deu para gerar a planilha. Tente de novo.", { tone: "danger", key: "notas-modelo" });
    }
  }

  async function downloadRejected() {
    if (!draft?.rows || !info) return;
    const rows = draft.rows.filter((row) => rejectedKinds.includes(row.kind));
    try {
      await downloadRejectedSheet(`linhas-com-problema-${fileSlug(info.title)}.xlsx`, rows, situationLabel, rowReason);
    } catch {
      toast("Não deu para gerar a planilha. Tente de novo.", { tone: "danger", key: "notas-rejeitadas" });
    }
  }

  /** Abre as colunas a partir da conferência ("Ajustar colunas"). */
  function adjustColumns() {
    if (!file || busy) return;
    setColumnsReason("asked");
    setColumnErrors({});
    goStep("columns");
  }

  /** Volta para Enviar sem a planilha (para escolher outra; o rascunho sai quando a nova for conferida). */
  function backToSend() {
    setFile(null);
    setColumnsState(null);
    setColumnErrors({});
    goStep("send");
  }

  /** Botão principal do rodapé, conforme o passo. */
  function next() {
    if (busy || blocked) return;
    if (step === "send") {
      if (file && columns) void proceed(file, columns);
    } else if (step === "columns") {
      if (file && columns) void send(file, columns, "columns");
    } else if (step === "check") {
      if (importCount === 0) {
        backToSend();
        askFocus("file");
      } else {
        void apply();
      }
    }
  }

  /** Voltar do rodapé: um passo para trás; no primeiro, sai da importação. */
  function back() {
    if (busy) return;
    if (step === "check" || (step === "send" && file) || (step === "columns" && !(draft && columnsReason === "asked"))) {
      backToSend();
    } else if (step === "columns") {
      goStep("check");
    } else if (step === "done") {
      onFinish();
    } else {
      onExit();
    }
  }

  return {
    step,
    file,
    fileError,
    reading,
    readingName,
    needsPoints,
    pointsText,
    pointsError,
    columns,
    columnsReason,
    columnErrors,
    sending,
    draft,
    keepAgenda,
    applying,
    applied,
    discarding,
    blocked,
    info,
    published,
    publishedBefore,
    publishing,
    imports,
    undoingId,
    counts,
    importCount,
    busy,
    templateCount: templateStudents.length,
    /** Planilha lida e ainda não conferida (ou colunas mudadas): fechar a gaveta pergunta antes. */
    hasUnsentFile: Boolean(file) && (step === "send" || step === "columns"),
    /** Planilha lida que espera a pontuação (o rodapé mostra "Conferir notas"). */
    pendingFile: Boolean(file) && step === "send",
    focusAsk,
    start,
    startWithFile,
    openDraft,
    setPointsText,
    setColumns,
    setKeepAgenda,
    chooseFile,
    adjustColumns,
    next,
    back,
    discardDraft,
    downloadTemplate,
    downloadRejected,
    publish: onPublish,
    undoApplied: () => {
      if (applied) onUndoApplied(applied);
    },
    finish: onFinish,
  };
}

/* ------------------------------------------------------------------ */
/* Passos à vista                                                      */
/* ------------------------------------------------------------------ */

const stepNames = ["Enviar", "Conferir", "Pronto"];

function Stepper({ step }: { step: ImportStep }) {
  const current = step === "done" ? 2 : step === "check" ? 1 : 0;
  const finished = step === "done";
  return (
    <ol className="notas-docente-steps" aria-label={`Passo ${current + 1} de 3: ${stepNames[current]}`}>
      {stepNames.map((label, index) => {
        const done = index < current || finished;
        const isCurrent = index === current;
        return (
          <li key={label} className={cx("notas-docente-step", done && "is-done", isCurrent && "is-cur")} aria-current={isCurrent ? "step" : undefined}>
            <span className="notas-docente-step-n" aria-hidden>
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : index + 1}
            </span>
            <span className="notas-docente-step-t">
              {label}
              {done && !isCurrent ? <span className="sr-only">, feito</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Cartão da planilha escolhida (nome, como foi lida e uma ação ao lado). */
function FileCard({ action, detail, name }: { action?: ReactNode; detail: string; name: string }) {
  // sem espaço ao lado (celular), o botão desce para a linha de baixo e o nome fica com a largura toda
  return (
    <div className="notas-docente-file">
      <span className="mini-ico">
        <FileSpreadsheet className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="notas-docente-file-main">
        <p className="notas-docente-file-t">{name}</p>
        <p className="notas-docente-file-s">{detail}</p>
      </div>
      {action ? <div className="notas-docente-file-act">{action}</div> : null}
    </div>
  );
}

function fileDetail(file: GradesFile) {
  const lines = file.sheet.rows.length;
  const kind = file.sheet.format === "xlsx" ? "Planilha do Excel" : "Planilha em CSV";
  return `${kind}, ${countText(lines, "linha", "linhas")}`;
}

/** Andamento no lugar da área de soltar: lendo a planilha e depois conferindo os alunos da turma. */
function Processing({ flow }: { flow: GradeImportFlow }) {
  const ref = useRef<HTMLDivElement>(null);
  const reading = flow.reading;
  const lines = flow.file?.sheet.rows.length ?? 0;
  // o botão que abriu a escolha some: o foco fica no andamento (e volta ao título do passo seguinte)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const name = flow.file?.name ?? flow.readingName;
  const stages = [
    { label: "Lendo a planilha", done: !reading, current: reading },
    {
      label:
        flow.templateCount === 1
          ? "Conferindo com o aluno da turma"
          : flow.templateCount
            ? `Conferindo com os ${flow.templateCount} alunos da turma`
            : "Conferindo os alunos da turma",
      done: false,
      current: !reading,
    },
  ];
  return (
    <div ref={ref} className="notas-docente-proc outline-none" role="status" aria-live="polite" tabIndex={-1}>
      <span className="notas-docente-ring" aria-hidden />
      <p className="notas-docente-proc-t">{reading ? "Lendo a planilha" : "Conferindo os alunos da turma"}</p>
      <p className="notas-docente-proc-s wrap-anywhere">
        {reading || !lines ? name : `${countText(lines, "linha", "linhas")} de ${name}`}
      </p>
      <ol className="notas-docente-proc-list" aria-hidden>
        {stages.map((stage) => (
          <li key={stage.label} className={cx(stage.done && "is-done", stage.current && "is-cur")}>
            <span className="dot">{stage.done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}</span>
            {stage.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SendStep({
  flow,
  headingRef,
  onPick,
}: {
  flow: GradeImportFlow;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onPick: () => void;
}) {
  const fileButtonRef = useRef<HTMLButtonElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const { focusAsk } = flow;
  // validação: o foco vai para o campo com erro
  useEffect(() => {
    // depois da gaveta (que leva o foco ao título quando o passo muda)
    const timer = window.setTimeout(() => {
      if (focusAsk?.field === "file") fileButtonRef.current?.focus();
      else if (focusAsk?.field === "points") pointsRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusAsk]);
  const hintId = useId();
  const errorId = useId();
  const [dragging, setDragging] = useState(false);
  const { file, fileError, info, reading, sending } = flow;
  const processing = reading || sending;
  const count = flow.templateCount;
  const maxText = info?.maxScoreText;

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void flow.chooseFile(event.dataTransfer.files?.[0]);
  }

  let area: ReactNode;
  if (processing) {
    area = <Processing flow={flow} />;
  } else if (file && flow.pendingFile) {
    area = (
      <FileCard
        name={file.name}
        detail={fileDetail(file)}
        action={
          <button ref={fileButtonRef} className={cx(secondaryButton, "btn-sm shrink-0")} onClick={onPick} type="button">
            Trocar planilha
          </button>
        }
      />
    );
  } else {
    area = (
      <div
        className={cx("notas-docente-drop", dragging && "is-over", fileError && "is-bad")}
        onClick={(event) => {
          // a área toda escolhe a planilha (o botão de dentro já faz isso sozinho)
          if (!(event.target as HTMLElement).closest("button")) onPick();
        }}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={onDrop}
      >
        <span className="notas-docente-drop-ico" aria-hidden>
          <FileUp className="h-6 w-6" />
        </span>
        <p className="notas-docente-drop-t">
          <span className="notas-docente-drag">Arraste a planilha para cá ou</span>
          <span className="notas-docente-touch">Escolha a planilha com as notas</span>
        </p>
        <button
          ref={fileButtonRef}
          className={primaryButton}
          aria-describedby={cx(hintId, fileError && errorId) || undefined}
          onClick={onPick}
          type="button"
        >
          <FileUp className="h-4 w-4" aria-hidden />
          Escolher planilha
        </button>
        <p className="notas-docente-drop-s">Planilha do Excel (.xlsx) ou CSV, até 2.000 linhas</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h3 ref={headingRef} className="sr-only" tabIndex={-1}>
        Enviar a planilha
      </h3>

      <section className="notas-docente-stage" aria-labelledby="notas-docente-etapa-1">
        <span className="notas-docente-stage-n" aria-hidden>
          1
        </span>
        <div className="notas-docente-stage-main">
          <h4 className="notas-docente-stage-t" id="notas-docente-etapa-1">
            Baixe a planilha da turma
          </h4>
          <p className="notas-docente-stage-s">
            {count
              ? `Já vem com ${count === 1 ? "o aluno" : `os ${count} alunos`} da turma. Você só escreve a nota${maxText ? `, de 0 a ${maxText}` : ""}.`
              : "A turma ainda não tem alunos ativos: a planilha vem com as colunas para preencher."}
          </p>
          <button className={cx(secondaryButton, "btn-sm mt-3")} onClick={() => void flow.downloadTemplate()} type="button">
            <Download className="h-4 w-4" aria-hidden />
            Baixar planilha da turma
          </button>
        </div>
      </section>

      <section className="notas-docente-stage" aria-labelledby="notas-docente-etapa-2">
        <span className="notas-docente-stage-n" aria-hidden>
          2
        </span>
        <div className="notas-docente-stage-main grid gap-3">
          <h4 className="notas-docente-stage-t" id="notas-docente-etapa-2">
            Envie a planilha preenchida
          </h4>
          {flow.needsPoints ? (
            <Field label="Quanto vale a avaliação" hint="Ela ainda não tem pontuação" error={flow.pointsError}>
              <input
                ref={pointsRef}
                className="input max-w-[12rem]"
                inputMode="decimal"
                placeholder="Exemplo: 10"
                value={flow.pointsText}
                onChange={(event) => flow.setPointsText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && flow.pendingFile) {
                    event.preventDefault();
                    flow.next();
                  }
                }}
              />
            </Field>
          ) : null}
          {area}
          {fileError ? (
            <p className="field-error" id={errorId} role="alert">
              <span>{fileError}</span>
            </p>
          ) : null}
          <p className="notas-docente-help !mt-0" id={hintId}>
            Também serve a planilha de outro sistema, com o nome ou o e-mail do aluno e a nota.
          </p>
        </div>
      </section>
    </div>
  );
}

function ColumnSelect({
  allowEmpty,
  error,
  hint,
  label,
  onChange,
  selectRef,
  value,
  flow,
}: {
  allowEmpty?: string;
  error?: string;
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  selectRef?: RefObject<HTMLButtonElement | null>;
  value: string;
  flow: GradeImportFlow;
}) {
  const headers = flow.file?.sheet.headers ?? [];
  const example = flow.file && value ? columnSamples(flow.file.sheet, value, 1)[0] : "";
  // a lista de escolha própria (Select): cada coluna com um exemplo da primeira linha, para achar a certa sem abrir
  // a planilha
  const options: SelectOption[] = [
    ...(allowEmpty ? [{ value: "", label: allowEmpty }] : []),
    ...headers.map((header) => {
      const sample = flow.file ? columnSamples(flow.file.sheet, header, 1)[0] : "";
      return { value: header, label: header, description: sample ? `Primeira linha: ${sample}` : "Coluna vazia" };
    }),
  ];
  return (
    <div className="grid content-start">
      <Select
        buttonRef={selectRef}
        error={error}
        hint={hint}
        label={label}
        options={options}
        placeholder="Escolha a coluna"
        value={value}
        onChange={(next) => onChange(next)}
      />
      {example && !error ? <p className="mt-1.5 text-[13px] text-muted wrap-anywhere">{`Primeira linha: ${example}`}</p> : null}
    </div>
  );
}

const typeHelp: Record<IdentifierType, string> = {
  name: "O nome completo, como está na Agenda. Acento, maiúsculas e espaços a mais não importam. Dois alunos da turma com o mesmo nome ficam de fora.",
  email: "O e-mail da conta do aluno na Agenda. Maiúsculas e espaços não importam.",
  registration: "A matrícula que a secretaria gravou na turma. Zeros à esquerda não importam: 000123 é o mesmo que 123.",
};

function ColumnsStep({ flow, headingRef, onPick }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null>; onPick: () => void }) {
  const { columnErrors, columns, file, focusAsk } = flow;
  const identifierRef = useRef<HTMLButtonElement>(null);
  const scoreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (focusAsk?.field === "identifier") identifierRef.current?.focus();
      else if (focusAsk?.field === "score") scoreRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusAsk]);
  if (!file || !columns) {
    return null;
  }
  if (flow.sending) {
    return (
      <div className="grid gap-4">
        <h3 ref={headingRef} className="sr-only" tabIndex={-1}>
          Conferindo as notas
        </h3>
        <Processing flow={flow} />
      </div>
    );
  }
  const type = columns.identifierType;
  const words = idWords[type];
  const sample = buildImportRows(file.sheet, columns).slice(0, 3);
  // coluna escolhida vazia neste arquivo: avisa e sugere outro jeito de achar o aluno, se a planilha tiver
  const idEmpty = Boolean(columns.identifierColumn) && !columnHasData(file.sheet, columns.identifierColumn);
  const other = idEmpty
    ? (["email", "registration", "name"] as IdentifierType[])
        .filter((option) => option !== type)
        .map((option) => ({ type: option, column: guessColumns(file.sheet, option).identifierColumn }))
        .find(
          (option) =>
            option.column &&
            option.column !== columns.identifierColumn &&
            option.column !== columns.scoreColumn &&
            columnHasData(file.sheet, option.column)
        )
    : undefined;
  const scoreEmpty = Boolean(columns.scoreColumn) && !columnHasData(file.sheet, columns.scoreColumn);
  const reason = flow.columnsReason;
  return (
    <div className="grid gap-4">
      <FileCard
        name={file.name}
        detail={fileDetail(file)}
        action={
          <button className={cx(secondaryButton, "btn-sm shrink-0")} onClick={onPick} type="button">
            Trocar planilha
          </button>
        }
      />
      <div className="grid gap-1.5">
        <h3 ref={headingRef} className="notas-docente-h3 drawer-h3 outline-none" tabIndex={-1}>
          Quais colunas usar
        </h3>
        {reason === "asked" ? (
          <p className="text-[14px] leading-5 text-muted">Diga de onde vêm o aluno e a nota. A conferência é refeita com as colunas novas.</p>
        ) : null}
      </div>
      {reason !== "asked" ? (
        <p className="callout amber">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {reason === "student" ? (
              <>
                <b>A Agenda não achou a coluna do aluno nesta planilha.</b> Escolha abaixo a coluna com o nome, o e-mail ou a
                matrícula de cada aluno.
              </>
            ) : (
              <>
                <b>A Agenda não achou a coluna da nota nesta planilha.</b> Escolha abaixo a coluna com as notas.
              </>
            )}
          </span>
        </p>
      ) : null}

      <div className="grid gap-2">
        <p className="lbl">Como achar o aluno</p>
        <Segmented label="Como achar o aluno">
          <SegmentedButton active={type === "name"} label="Pelo nome" onClick={() => flow.setColumns({ identifierType: "name" })} />
          <SegmentedButton active={type === "email"} label="Pelo e-mail" onClick={() => flow.setColumns({ identifierType: "email" })} />
          <SegmentedButton
            active={type === "registration"}
            label="Pela matrícula"
            onClick={() => flow.setColumns({ identifierType: "registration" })}
          />
        </Segmented>
        <p className="text-[13px] leading-5 text-muted">{typeHelp[type]}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColumnSelect
          flow={flow}
          error={columnErrors.identifierColumn}
          label={words.label}
          selectRef={identifierRef}
          value={columns.identifierColumn}
          onChange={(value) => flow.setColumns({ identifierColumn: value })}
        />
        <ColumnSelect
          flow={flow}
          error={columnErrors.scoreColumn}
          label="Coluna da nota"
          selectRef={scoreRef}
          value={columns.scoreColumn}
          onChange={(value) => flow.setColumns({ scoreColumn: value })}
        />
      </div>
      <div role="status" className="grid gap-3 empty:hidden">
        {idEmpty && !columnErrors.identifierColumn ? (
          <div className="callout amber">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="grid min-w-0 gap-2">
              <p className="wrap-anywhere">
                <b>{`A coluna ${columns.identifierColumn} está vazia nesta planilha.`}</b>{" "}
                {other
                  ? `Nenhum aluno seria achado por ela. A coluna ${other.column} tem ${idWords[other.type].article} dos alunos: use ela.`
                  : `Nenhum aluno seria achado por ela. Escolha a coluna com ${words.article} dos alunos.`}
              </p>
              {other ? (
                <button
                  className={cx(secondaryButton, "btn-sm justify-self-start")}
                  onClick={() => flow.setColumns({ identifierType: other.type, identifierColumn: other.column })}
                  type="button"
                >
                  {`Achar o aluno pel${other.type === "registration" ? "a" : "o"} ${idWords[other.type].name}`}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {scoreEmpty && !columnErrors.scoreColumn ? (
          <p className="callout amber">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 wrap-anywhere">
              <b>{`A coluna ${columns.scoreColumn} está vazia nesta planilha.`}</b> Nenhuma nota entraria. Escreva as notas na
              planilha e envie de novo, ou escolha outra coluna da nota.
            </span>
          </p>
        ) : null}
      </div>

      {type !== "name" ? (
        <ColumnSelect
          allowEmpty="Sem coluna de nome"
          flow={flow}
          hint="Opcional, só para conferir"
          label="Coluna do nome"
          value={columns.nameColumn}
          onChange={(value) => flow.setColumns({ nameColumn: value })}
        />
      ) : null}

      {sample.length && columns.identifierColumn && columns.scoreColumn ? (
        <section className="grid gap-2" aria-labelledby="notas-docente-amostra">
          <h4 className="notas-docente-h4" id="notas-docente-amostra">
            Primeiras linhas como serão lidas
          </h4>
          <ul className="notas-docente-rows">
            {sample.map((row) => (
              <li key={row.rowNumber}>
                <div className="notas-docente-r-body">
                  <p className="notas-docente-r-t wrap-anywhere">
                    {row.identifier ? String(row.identifier) : `sem ${words.name}`}
                    {row.name ? <span className="mat"> {row.name}</span> : null}
                  </p>
                  <p className="notas-docente-r-s">{`linha ${row.rowNumber} da planilha`}</p>
                </div>
                <p className="notas-docente-r-v">{row.score ? String(row.score) : <span className="font-medium text-muted">sem nota</span>}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {columnErrors.general ? (
        <p className="field-error" role="alert">
          <span>{columnErrors.general}</span>
        </p>
      ) : null}
    </div>
  );
}

function CheckStep({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { draft, file } = flow;
  if (!draft) {
    return null;
  }
  const { identifierColumn, scoreColumn } = draft.mapping;
  const columnsText = `Aluno pela coluna ${identifierColumn} e nota pela coluna ${scoreColumn}.`;
  const source = (
    <div className="notas-docente-src">
      <span className="mini-ico">
        <FileSpreadsheet className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="notas-docente-file-main">
        <p className="notas-docente-file-t">{draft.fileName}</p>
        <p className="notas-docente-file-s">
          {file ? columnsText : `Rascunho de ${formatShortDateTime(draft.createdAt)}. ${columnsText}`}{" "}
          {file ? (
            <button className="link min-h-6 text-[13px] max-md:min-h-11 pointer-coarse:min-h-11" aria-disabled={flow.busy || undefined} onClick={flow.adjustColumns} type="button">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Ajustar colunas
            </button>
          ) : null}
        </p>
      </div>
      {draft.canDiscard ? (
        <div className="notas-docente-file-act">
          <button className="btn btn-g btn-sm shrink-0" aria-busy={flow.discarding || undefined} onClick={flow.discardDraft} type="button">
            <Trash2 className="h-4 w-4" aria-hidden />
            Descartar rascunho
          </button>
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="grid gap-4">
      <h3 ref={headingRef} className="notas-docente-h3 drawer-h3 outline-none" tabIndex={-1}>
        Confira antes de importar
      </h3>
      <GradeImportPreview
        key={draft.id}
        draft={draft}
        keepAgenda={flow.keepAgenda}
        maxScore={flow.info?.maxScore ?? null}
        maxScoreText={flow.info?.maxScoreText ?? null}
        onDownloadRejected={flow.downloadRejected}
        onKeepAgenda={flow.setKeepAgenda}
        source={source}
      />
    </div>
  );
}

function DoneStep({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { applied, info, published } = flow;
  if (!applied) {
    return null;
  }
  const undone = flow.imports?.find((item) => item.id === applied.id)?.status === "undone";
  const { created, keptAgenda, skipped, unchanged, updated } = applied.applied;
  const total = created + updated;
  const same = applied.totals.same + unchanged;
  const left = applied.totals.rejected + skipped;
  const where = [info?.title, info?.academicClass?.name].filter(Boolean).join(", ");
  const parts = [
    created ? { text: countText(created, "nova", "novas"), tone: "new" } : null,
    updated ? { text: countText(updated, "alterada", "alteradas"), tone: "chg" } : null,
    same ? { text: countText(same, "igual, ficou como estava", "iguais, ficaram como estavam"), tone: "same" } : null,
    keptAgenda ? { text: countText(keptAgenda, "mantida da Agenda", "mantidas da Agenda"), tone: "same" } : null,
    left ? { text: countText(left, "ficou de fora", "ficaram de fora"), tone: "bad" } : null,
  ].filter((part): part is { text: string; tone: string } => part !== null);

  if (undone) {
    return (
      <div className="grid gap-4">
        <div className="notas-docente-done is-undone">
          <span className="notas-docente-done-ico" aria-hidden>
            <RotateCcw className="h-8 w-8" />
          </span>
          <h3 ref={headingRef} className="notas-docente-done-t outline-none" tabIndex={-1}>
            Importação desfeita
          </h3>
          <p className="notas-docente-done-s">{where}</p>
          <p className="notas-docente-done-s">As notas voltaram ao valor de antes da importação.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="notas-docente-done">
        <span className="notas-docente-done-ico" aria-hidden>
          <Check className="h-9 w-9" strokeWidth={2.6} />
        </span>
        <h3 ref={headingRef} className="notas-docente-done-t outline-none" tabIndex={-1}>
          {total ? (
            <>
              <span className="notas-docente-done-n">{total}</span> {total === 1 ? "nota importada" : "notas importadas"}
            </>
          ) : (
            "Importação aplicada"
          )}
        </h3>
        <p className="notas-docente-done-s">{total ? where : `${where}. Nenhuma nota mudou.`}</p>
        {parts.length ? (
          <ul className="notas-docente-done-parts" aria-label="Como ficou cada linha">
            {parts.map((part) => (
              <li key={part.text} className={`is-${part.tone}`}>
                {part.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {published ? (
        <div className="notas-docente-vis is-on" role="status">
          <span className="notas-docente-vis-ico" aria-hidden>
            <Eye className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="notas-docente-vis-t">
              {flow.publishedBefore ? "Os alunos já veem as notas." : "Notas publicadas. Os alunos já veem as notas."}
            </p>
            <p className="notas-docente-vis-s">
              {flow.publishedBefore
                ? "Alunos e responsáveis veem a nota nova na hora, na tela de notas."
                : "Alunos e responsáveis receberam um aviso. Para ocultar de novo, use a lista de notas."}
            </p>
          </div>
        </div>
      ) : (
        <div className="notas-docente-vis">
          <span className="notas-docente-vis-ico" aria-hidden>
            <EyeOff className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="notas-docente-vis-t">Os alunos ainda não veem estas notas.</p>
            <p className="notas-docente-vis-s">Ao publicar, alunos e responsáveis recebem um aviso. Dá para ocultar de novo depois.</p>
            <button
              className={cx(primaryButton, "mt-3 aria-disabled:cursor-not-allowed aria-disabled:opacity-55")}
              aria-busy={flow.publishing || undefined}
              aria-disabled={flow.publishing || undefined}
              onClick={() => {
                if (!flow.publishing) flow.publish();
              }}
              type="button"
            >
              {flow.publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              Publicar notas agora
            </button>
          </div>
        </div>
      )}

      {left ? (
        <p className="callout past">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {left === 1
              ? "1 linha ficou de fora. Lance a nota dela direto na lista ou corrija a planilha e envie de novo."
              : `${left} linhas ficaram de fora. Lance as notas direto na lista ou corrija a planilha e envie de novo.`}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Corpo da gaveta durante a importação: os passos e o conteúdo do passo atual. */
export function GradeImportBody({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pick = () => {
    if (!flow.busy) inputRef.current?.click();
  };
  return (
    <div className="grid gap-5">
      <Stepper step={flow.step} />
      {flow.blocked ? (
        <p className="callout rose" role="alert">
          <span>{flow.blocked}</span>
        </p>
      ) : null}
      {flow.step === "send" ? <SendStep flow={flow} headingRef={headingRef} onPick={pick} /> : null}
      {flow.step === "columns" ? <ColumnsStep flow={flow} headingRef={headingRef} onPick={pick} /> : null}
      {flow.step === "check" ? <CheckStep flow={flow} headingRef={headingRef} /> : null}
      {flow.step === "done" ? <DoneStep flow={flow} headingRef={headingRef} /> : null}
      <input
        ref={inputRef}
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          void flow.chooseFile(selected);
        }}
      />
    </div>
  );
}

/** Por que a conferência não tem nada para importar (fica acima do botão "Enviar outra planilha"). */
function nothingToImportText(flow: GradeImportFlow) {
  const counts = flow.counts;
  if (!counts) return "Nada para importar. Envie outra planilha.";
  const rejected = rejectedCount(counts);
  if (counts.newer_in_agenda && flow.keepAgenda) {
    return "Nada para importar: você manteve as notas da Agenda. Para trocar por estas, escolha Trocar pelas da planilha.";
  }
  if (rejected && counts.same) return "Nada para importar: as linhas ficam de fora ou já estão na Agenda. Corrija a planilha e envie de novo.";
  if (rejected) return "Nada para importar: todas as linhas ficam de fora. Corrija a planilha e envie de novo.";
  if (counts.same) return "Nada para importar: as notas da planilha já estão na Agenda.";
  return "Nada para importar: a planilha não tem linhas com dados. Envie outra planilha.";
}

/** Rodapé da gaveta durante a importação: dica, Voltar e o botão do passo. */
export function GradeImportFooter({ flow }: { flow: GradeImportFlow }) {
  const { applying, busy, importCount, sending, step } = flow;
  const hintId = useId();

  if (step === "done") {
    const undone = flow.applied ? flow.imports?.find((item) => item.id === flow.applied?.id)?.status === "undone" : false;
    const canUndo = Boolean(flow.applied?.canUndo) && !undone;
    const undoing = flow.applied !== null && flow.undoingId === flow.applied.id;
    return (
      <>
        {canUndo ? (
          <button
            className="btn btn-g mr-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
            aria-busy={undoing || undefined}
            aria-disabled={undoing || undefined}
            onClick={() => {
              if (!undoing) flow.undoApplied();
            }}
            type="button"
          >
            {undoing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
            Desfazer importação
          </button>
        ) : (
          <span className="mr-auto" />
        )}
        <button className={flow.published || undone ? primaryButton : secondaryButton} onClick={flow.finish} type="button">
          Ver a lista de notas
        </button>
      </>
    );
  }

  // conferência sem nada para importar: o botão diz o que fazer, e a razão fica acima dele
  const nothing = step === "check" && Boolean(flow.draft) && importCount === 0;
  let label: string | null = null;
  let hint = "Nada muda nas notas até você conferir e confirmar";
  if (step === "send") {
    label = flow.pendingFile && !busy ? "Conferir notas" : null;
  } else if (step === "columns") {
    label = "Conferir notas";
    hint = "Nada muda até você confirmar na conferência";
  } else if (nothing) {
    label = "Enviar outra planilha";
    hint = nothingToImportText(flow);
  } else if (step === "check") {
    label = importCount === 1 ? "Importar 1 nota" : `Importar ${importCount} notas`;
    hint = flow.draft && !flow.draft.canApply
      ? "Só quem criou o rascunho, com a disciplina em vigor, aplica"
      : flow.published
        ? "As notas já estão publicadas: aparecem na hora para os alunos"
        : "As notas ficam ocultas até você publicar";
  }
  const waiting = sending || applying;
  const disabled = Boolean(flow.blocked) || (step === "check" && !nothing && !flow.draft?.canApply);
  return (
    <>
      {/* o motivo de "nada para importar" é longo: fica numa linha só dele, acima dos botões */}
      <p className={cx("mr-auto min-w-0 basis-full text-[13px] leading-5 text-muted", !nothing && "sm:flex-1 sm:basis-0")} id={hintId}>
        {hint}
      </p>
      <button
        className={cx(secondaryButton, "aria-disabled:opacity-55", nothing && "sm:ml-auto")}
        aria-disabled={busy || undefined}
        onClick={flow.back}
        type="button"
      >
        Voltar
      </button>
      {label ? (
        <button
          className={cx(primaryButton, "aria-disabled:cursor-not-allowed aria-disabled:opacity-55")}
          aria-busy={waiting || undefined}
          aria-describedby={hintId}
          aria-disabled={busy || disabled || undefined}
          onClick={() => {
            if (!disabled) flow.next();
          }}
          type="button"
        >
          {waiting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : nothing ? (
            <FileUp className="h-4 w-4" aria-hidden />
          ) : step === "check" ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : null}
          {applying ? "Importando" : sending ? "Conferindo" : label}
        </button>
      ) : null}
    </>
  );
}
