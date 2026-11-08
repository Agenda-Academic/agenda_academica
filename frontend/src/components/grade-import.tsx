"use client";

import { Check, Download, FileSpreadsheet, FileUp, Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { ApiError, applyGradeImport, conflictOf, createGradeImport, deleteGradeImport } from "@/lib/api";
import { cx, errorMessage, fieldErrors, formatShortDateTime, parseScore } from "@/lib/format";
import {
  GradesFileError,
  MAX_BODY_BYTES,
  buildImportRows,
  columnSamples,
  downloadCsv,
  fileSlug,
  fitColumns,
  guessColumns,
  jsonSize,
  loadLastSource,
  loadSavedMapping,
  readGradesFile,
  rejectedCsv,
  saveMapping,
  templateCsv,
  toMapping,
  type ColumnChoice,
  type GradesFile,
} from "@/lib/grades-file";
import { gradeImportSourceLabels } from "@/lib/meta";
import type {
  EventGradeRow,
  GradeEventInfo,
  GradeImport,
  GradeImportApplied,
  GradeImportInput,
  GradeImportSource,
} from "@/lib/types";
import { useAppActions } from "./app-actions";
import { GradeImportPreview, importKindCounts, importableCount, rejectedKinds, rowKindLabel } from "./grade-import-preview";
import { Field, Segmented, SegmentedButton, primaryButton, secondaryButton } from "./ui";

/**
 * Importar notas (desenho 5.7): os 4 passos (Arquivo, Colunas, Prévia, Aplicar) dentro da mesma gaveta da
 * avaliação (EventGradesDrawer), que troca o conteúdo e mostra Voltar. O estado fica no hook useGradeImport
 * (a gaveta guarda o hook e desenha GradeImportBody no corpo e GradeImportFooter no rodapé).
 * Dona: área Notas (docente).
 */

export type ImportStep = "file" | "columns" | "preview";

type FocusField = "file" | "points" | "identifier" | "score";

type ColumnErrors = { identifierColumn?: string; scoreColumn?: string; general?: string };

const sourceOptions = (Object.keys(gradeImportSourceLabels) as GradeImportSource[]).map((value) => ({
  value,
  label: gradeImportSourceLabels[value],
}));

const delimiterNames = { ";": "ponto e vírgula", ",": "vírgula", "\t": "tabulação" } as const;
const encodingNames = { "utf-8": "UTF-8", "windows-1252": "Windows-1252", "utf-16": "UTF-16" } as const;

export type GradeImportOptions = {
  /** A avaliação (GET /events/:id/grades). */
  info: GradeEventInfo | null;
  /** Alunos da lista de notas (para o Modelo da Agenda). */
  students: EventGradeRow[];
  /** As notas da avaliação já estão publicadas (o rodapé avisa que aparecem na hora). */
  published: boolean;
  /** Sai da importação (volta para a gaveta da avaliação). */
  onExit: () => void;
  /** Aplicou: a gaveta mostra o toast com Desfazer e volta. */
  onApplied: (result: GradeImportApplied, message: string) => void;
  /** Um rascunho foi criado ou descartado (a lista de importações muda). */
  onDraftsChanged: () => void;
  /** A importação gravou a pontuação no evento (a página recarrega os eventos). */
  onPointsSet: () => void;
};

export type GradeImportFlow = ReturnType<typeof useGradeImport>;

export function useGradeImport({
  info,
  onApplied,
  onDraftsChanged,
  onExit,
  onPointsSet,
  published,
  students,
}: GradeImportOptions) {
  const { token, toast, showError, confirm } = useAppActions();
  const [step, setStep] = useState<ImportStep>("file");
  const [source, setSourceState] = useState<GradeImportSource>("modelo");
  const [file, setFile] = useState<GradesFile | null>(null);
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const [pointsText, setPointsTextState] = useState("");
  const [pointsError, setPointsError] = useState("");
  const [columns, setColumnsState] = useState<ColumnChoice | null>(null);
  const [columnErrors, setColumnErrors] = useState<ColumnErrors>({});
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<GradeImport | null>(null);
  const [keepAgenda, setKeepAgenda] = useState(true);
  const [applying, setApplying] = useState(false);
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
  const busy = sending || applying || discarding;

  function reset(nextSource: GradeImportSource) {
    setSourceState(nextSource);
    setFile(null);
    setFileError("");
    setReading(false);
    setPointsTextState("");
    setPointsError("");
    setColumnsState(null);
    setColumnErrors({});
    setDraft(null);
    setKeepAgenda(true);
    setBlocked("");
    setFocusAsk(null);
  }

  /** Começa uma importação nova, no passo Arquivo, com a origem da última vez. */
  function start() {
    reset(loadLastSource());
    goStep("file");
  }

  /** Abre um rascunho da lista ("Continuar") direto na Prévia. */
  function openDraft(value: GradeImport) {
    reset(value.source);
    setDraft(value);
    goStep("preview");
  }

  function setSource(value: GradeImportSource) {
    setSourceState(value);
    // outra origem: as colunas salvas dela valem para o arquivo já escolhido
    if (file) {
      setColumnsState(fitColumns(file.sheet, loadSavedMapping(value)));
      setColumnErrors({});
    }
  }

  function setPointsText(value: string) {
    setPointsTextState(value);
    if (pointsError) setPointsError("");
  }

  function setColumns(patch: Partial<ColumnChoice>) {
    if (!file) return;
    setColumnsState((current) => {
      const base = current ?? guessColumns(file.sheet);
      const next = { ...base, ...patch };
      // trocou e-mail por matrícula: a coluna do aluno acompanha, se a escolhida não serve
      if (patch.identifierType && patch.identifierType !== base.identifierType && !patch.identifierColumn) {
        const guess = guessColumns(file.sheet, patch.identifierType);
        if (guess.identifierColumn && guess.identifierColumn !== next.scoreColumn) {
          next.identifierColumn = guess.identifierColumn;
        }
      }
      return next;
    });
    setColumnErrors({});
  }

  async function chooseFile(selected: File | null | undefined) {
    if (!selected || reading) return;
    setReading(true);
    setFileError("");
    try {
      const read = await readGradesFile(selected);
      setFile(read);
      setColumnsState(fitColumns(read.sheet, loadSavedMapping(source)));
      setColumnErrors({});
    } catch (error) {
      setFile(null);
      setColumnsState(null);
      setFileError(
        error instanceof GradesFileError
          ? error.message
          : "Não deu para ler o arquivo. Confira se ele é um CSV e escolha de novo."
      );
    } finally {
      setReading(false);
    }
  }

  /** Pontuação digitada em número (10, 7,5) ou null se inválida. */
  function pointsValue() {
    const cents = parseScore(pointsText);
    if (cents === null || Number.isNaN(cents) || cents < 1 || cents > 99999) {
      return null;
    }
    return cents / 100;
  }

  function goColumns() {
    let firstInvalid: FocusField | null = null;
    if (!file) {
      setFileError(fileError || "Escolha o arquivo CSV com as notas.");
      firstInvalid = "file";
    }
    if (needsPoints && pointsValue() === null) {
      setPointsError("Informe quanto vale a avaliação, de 0,01 a 999,99. Exemplo: 10.");
      firstInvalid ??= "points";
    }
    if (firstInvalid) {
      askFocus(firstInvalid);
      return;
    }
    goStep("columns");
  }

  async function sendPreview() {
    if (!file || !columns || !info) return;
    const errors: ColumnErrors = {};
    if (!columns.identifierColumn) {
      errors.identifierColumn = `Escolha a coluna com ${columns.identifierType === "email" ? "o e-mail" : "a matrícula"} do aluno.`;
    }
    if (!columns.scoreColumn) {
      errors.scoreColumn = "Escolha a coluna com a nota.";
    } else if (columns.scoreColumn === columns.identifierColumn) {
      errors.scoreColumn = "A nota precisa vir de outra coluna, diferente da coluna do aluno.";
    }
    if (errors.identifierColumn || errors.scoreColumn) {
      setColumnErrors(errors);
      askFocus(errors.identifierColumn ? "identifier" : "score");
      return;
    }
    const rows = buildImportRows(file.sheet, columns);
    if (!rows.length) {
      setColumnErrors({ general: "Nenhuma linha com dados nessas colunas. Confira se escolheu as colunas certas." });
      return;
    }
    const points = needsPoints ? pointsValue() : null;
    const input: GradeImportInput = {
      academicEventId: info.id,
      source,
      fileName: file.name.slice(0, 200),
      checksum: file.checksum.slice(0, 128),
      fileModifiedAt: file.modifiedAt,
      mapping: toMapping(columns),
      rows,
      ...(points !== null ? { points } : {}),
    };
    if (jsonSize(input) > MAX_BODY_BYTES) {
      setColumnErrors({
        general: "As linhas deste arquivo passam de 1 MB para enviar. Divida o arquivo em duas importações.",
      });
      return;
    }

    setSending(true);
    setColumnErrors({});
    // voltou da Prévia e mandou de novo: o rascunho anterior sai, para a lista não juntar rascunhos iguais
    const previous = draft && draft.status === "draft" ? draft : null;
    try {
      if (previous) {
        await deleteGradeImport(token, previous.id).catch(() => undefined);
      }
      const created = await createGradeImport(token, input);
      saveMapping(source, toMapping(columns));
      setDraft(created);
      setKeepAgenda(true);
      goStep("preview");
      onDraftsChanged();
      if (points !== null) {
        onPointsSet();
      }
    } catch (error) {
      if (previous) {
        setDraft(null);
        onDraftsChanged();
      }
      const fields = fieldErrors(error);
      if (fields.points) {
        setPointsError(fields.points);
        goStep("file");
        askFocus("points");
        return;
      }
      if (error instanceof ApiError && error.status === 413) {
        setColumnErrors({
          general: "As linhas deste arquivo passam de 1 MB para enviar. Divida o arquivo em duas importações.",
        });
        return;
      }
      if (conflictOf(error, "ARCHIVED")) {
        setBlocked(errorMessage(error));
      }
      if (fields["mapping.identifierColumn"] || fields["mapping.scoreColumn"]) {
        setColumnErrors({
          identifierColumn: fields["mapping.identifierColumn"],
          scoreColumn: fields["mapping.scoreColumn"],
        });
        return;
      }
      setColumnErrors({ general: errorMessage(error) });
    } finally {
      setSending(false);
    }
  }

  async function apply() {
    if (!draft || applying || importCount === 0) return;
    setApplying(true);
    try {
      const newer = counts?.newer_in_agenda ?? 0;
      const { data, message } = await applyGradeImport(token, draft.id, newer > 0 ? keepAgenda : undefined);
      setDraft(null);
      setFile(null);
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
      message: "Nenhuma nota muda. Para importar este arquivo depois, escolha ele de novo.",
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

  function downloadTemplate() {
    if (!info) return;
    const active = students.filter((student) => student.enrollmentStatus === "active");
    const name = `modelo-notas-${fileSlug(info.title)}.csv`;
    downloadCsv(name, templateCsv(active));
    toast(
      active.length
        ? `Modelo baixado com ${active.length === 1 ? "1 aluno" : `${active.length} alunos`}. Preencha a coluna nota e importe o arquivo.`
        : "Modelo baixado. A turma ainda não tem alunos ativos: preencha e-mail e nota de cada um.",
      { tone: "info", key: "notas-modelo" }
    );
  }

  function downloadRejected() {
    if (!draft?.rows || !info) return;
    const rows = draft.rows.filter((row) => rejectedKinds.includes(row.kind));
    downloadCsv(`rejeitadas-${fileSlug(info.title)}.csv`, rejectedCsv(rows, rowKindLabel));
  }

  /** Botão principal do rodapé: Continuar, Ver prévia ou Importar N notas. */
  function next() {
    if (busy || blocked) return;
    if (step === "file") goColumns();
    else if (step === "columns") void sendPreview();
    else void apply();
  }

  /** Voltar do rodapé: um passo para trás; no primeiro, sai da importação. */
  function back() {
    if (busy) return;
    if (step === "preview") {
      goStep(file ? "columns" : "file");
    } else if (step === "columns") {
      goStep("file");
    } else {
      onExit();
    }
  }

  return {
    step,
    source,
    file,
    fileError,
    reading,
    needsPoints,
    pointsText,
    pointsError,
    columns,
    columnErrors,
    sending,
    draft,
    keepAgenda,
    applying,
    discarding,
    blocked,
    info,
    published,
    counts,
    importCount,
    busy,
    /** Arquivo lido e ainda não enviado: fechar a gaveta pergunta antes. */
    hasUnsentFile: Boolean(file) && step !== "preview",
    focusAsk,
    start,
    openDraft,
    setSource,
    setPointsText,
    setColumns,
    setKeepAgenda,
    chooseFile,
    next,
    back,
    discardDraft,
    downloadTemplate,
    downloadRejected,
  };
}

/* ------------------------------------------------------------------ */
/* Passos                                                              */
/* ------------------------------------------------------------------ */

const stepNames: Array<{ key: ImportStep | "apply"; label: string }> = [
  { key: "file", label: "Arquivo" },
  { key: "columns", label: "Colunas" },
  { key: "preview", label: "Prévia" },
  { key: "apply", label: "Aplicar" },
];

function Stepper({ applying, step }: { applying: boolean; step: ImportStep }) {
  const current = applying ? 3 : stepNames.findIndex((item) => item.key === step);
  return (
    <ol className="notas-docente-steps" aria-label={`Passo ${current + 1} de 4: ${stepNames[current].label}`}>
      {stepNames.map((item, index) => {
        const done = index < current;
        const isCurrent = index === current;
        return (
          <li key={item.key} className={cx("notas-docente-step", done && "is-done", isCurrent && "is-cur")} aria-current={isCurrent ? "step" : undefined}>
            <span className="notas-docente-step-n" aria-hidden>
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : index + 1}
            </span>
            <span className="notas-docente-step-t">
              {item.label}
              {done ? <span className="sr-only">, feito</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Cartão do arquivo escolhido (nome e como foi lido). */
function FileCard({ action, flow }: { action?: ReactNode; flow: GradeImportFlow }) {
  const { columns, draft, file, source } = flow;
  let detail: string;
  if (file) {
    const lines = file.sheet.rows.length;
    detail = `${gradeImportSourceLabels[source]}, ${lines === 1 ? "1 linha" : `${lines} linhas`}, separado por ${delimiterNames[file.sheet.delimiter]}, ${encodingNames[file.sheet.encoding]}`;
    if (flow.step === "preview" && columns) {
      detail = `${gradeImportSourceLabels[source]}, ${lines === 1 ? "1 linha" : `${lines} linhas`}, aluno pela coluna ${columns.identifierColumn} e nota pela coluna ${columns.scoreColumn}`;
    }
  } else if (draft) {
    detail = `${gradeImportSourceLabels[draft.source]}, rascunho de ${formatShortDateTime(draft.createdAt)}, aluno pela coluna ${draft.mapping.identifierColumn} e nota pela coluna ${draft.mapping.scoreColumn}`;
  } else {
    return null;
  }
  return (
    <div className="notas-docente-file">
      <span className="mini-ico">
        <FileSpreadsheet className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="notas-docente-file-t">{file?.name ?? draft?.fileName}</p>
        <p className="notas-docente-file-s">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function FileStep({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fileButtonRef = useRef<HTMLButtonElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const { focusAsk } = flow;
  // validação do Continuar: o foco vai para o primeiro campo com erro
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
  const { file, fileError, info, reading } = flow;
  const maxText = info?.maxScoreText;

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void flow.chooseFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div className="grid gap-4">
      <h3 ref={headingRef} className="notas-docente-h3 outline-none" tabIndex={-1}>
        Escolha o arquivo
      </h3>

      <Field label="De onde vem o arquivo" hint="As colunas ficam salvas para cada origem">
        <select className="input" value={flow.source} onChange={(event) => flow.setSource(event.target.value as GradeImportSource)}>
          {sourceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <p className="lbl mb-2">Arquivo com as notas</p>
        {file ? (
          <FileCard
            flow={flow}
            action={
              <button
                ref={fileButtonRef}
                className={cx(secondaryButton, "btn-sm shrink-0")}
                aria-describedby={hintId}
                onClick={() => inputRef.current?.click()}
                type="button"
              >
                Trocar arquivo
              </button>
            }
          />
        ) : (
          <div
            className={cx("notas-docente-drop", dragging && "is-over", fileError && "is-bad")}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDrop={onDrop}
          >
            <span className="mini-ico">
              {reading ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <FileUp className="h-[18px] w-[18px]" aria-hidden />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{reading ? "Lendo o arquivo" : "Arraste o arquivo para cá ou use o botão Escolher arquivo CSV"}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-muted" id={hintId}>
                Só CSV por enquanto, separado por ponto e vírgula ou vírgula. Planilha do Excel: use Salvar como, CSV, antes.
              </p>
            </div>
            <button
              ref={fileButtonRef}
              className={cx(secondaryButton, "btn-sm shrink-0")}
              aria-busy={reading || undefined}
              aria-describedby={cx(hintId, fileError && errorId) || undefined}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              Escolher arquivo CSV
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          accept=".csv,text/csv"
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
        {fileError ? (
          <p className="field-error" id={errorId} role="alert">
            <span>{fileError}</span>
          </p>
        ) : null}
      </div>

      {flow.needsPoints ? (
        <Field label="Quanto vale a avaliação" hint="Ela ainda não tem pontuação" error={flow.pointsError}>
          <input
            ref={pointsRef}
            className="input max-w-[12rem]"
            inputMode="decimal"
            placeholder="Exemplo: 10"
            value={flow.pointsText}
            onChange={(event) => flow.setPointsText(event.target.value)}
          />
        </Field>
      ) : null}

      <div className="mini items-center">
        <span className="mini-ico">
          <Download className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="mini-t">Modelo da Agenda</p>
          <p className="mini-s">
            {`Com os alunos da turma nas colunas e-mail, matrícula, nome e nota${maxText ? ` (de 0 a ${maxText})` : ""}. Preencha a nota e importe.`}
          </p>
        </div>
        <button className={cx(secondaryButton, "btn-sm shrink-0")} onClick={flow.downloadTemplate} type="button">
          Baixar modelo da Agenda
        </button>
      </div>
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
  selectRef?: RefObject<HTMLSelectElement | null>;
  value: string;
  flow: GradeImportFlow;
}) {
  const headers = flow.file?.sheet.headers ?? [];
  const example = flow.file && value ? columnSamples(flow.file.sheet, value, 1)[0] : "";
  return (
    <div className="grid content-start">
      <Field label={label} hint={hint} error={error}>
        <select ref={selectRef} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{allowEmpty ?? "Escolha a coluna"}</option>
          {headers.map((header) => (
            <option key={header} value={header}>
              {header}
            </option>
          ))}
        </select>
      </Field>
      {example && !error ? <p className="mt-1.5 text-[13px] text-muted wrap-anywhere">{`Primeira linha: ${example}`}</p> : null}
    </div>
  );
}

function ColumnsStep({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { columnErrors, columns, file, focusAsk } = flow;
  const identifierRef = useRef<HTMLSelectElement>(null);
  const scoreRef = useRef<HTMLSelectElement>(null);
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
  const byEmail = columns.identifierType === "email";
  const sample = buildImportRows(file.sheet, columns).slice(0, 3);
  return (
    <div className="grid gap-4">
      <FileCard flow={flow} />
      <h3 ref={headingRef} className="notas-docente-h3 outline-none" tabIndex={-1}>
        Quais colunas usar
      </h3>

      <div className="grid gap-2">
        <p className="lbl" id="notas-docente-tipo">
          Como achar o aluno
        </p>
        <Segmented label="Como achar o aluno">
          <SegmentedButton active={byEmail} label="Pelo e-mail" onClick={() => flow.setColumns({ identifierType: "email" })} />
          <SegmentedButton active={!byEmail} label="Pela matrícula" onClick={() => flow.setColumns({ identifierType: "registration" })} />
        </Segmented>
        <p className="text-[13px] leading-5 text-muted">
          {byEmail
            ? "O e-mail da conta do aluno na Agenda. Maiúsculas e espaços não importam."
            : "A matrícula que a secretaria gravou na turma. Zeros à esquerda não importam: 000123 é o mesmo que 123."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColumnSelect
          flow={flow}
          error={columnErrors.identifierColumn}
          label={byEmail ? "Coluna do e-mail" : "Coluna da matrícula"}
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
      <ColumnSelect
        allowEmpty="Sem coluna de nome"
        flow={flow}
        hint="Opcional, só para conferir"
        label="Coluna do nome"
        value={columns.nameColumn}
        onChange={(value) => flow.setColumns({ nameColumn: value })}
      />

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
                    {row.identifier ? String(row.identifier) : "sem identificação"}
                    {row.name ? <span className="mat"> {row.name}</span> : null}
                  </p>
                  <p className="notas-docente-r-s">{`linha ${row.rowNumber} do arquivo`}</p>
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

function PreviewStep({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const { draft } = flow;
  if (!draft) {
    return null;
  }
  return (
    <div className="grid gap-4">
      <FileCard
        flow={flow}
        action={
          draft.canDiscard ? (
            <button
              className="btn btn-g btn-sm shrink-0"
              aria-busy={flow.discarding || undefined}
              onClick={flow.discardDraft}
              type="button"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Descartar
            </button>
          ) : null
        }
      />
      <h3 ref={headingRef} className="notas-docente-h3 outline-none" tabIndex={-1}>
        Confira antes de importar
      </h3>
      <GradeImportPreview
        key={draft.id}
        draft={draft}
        keepAgenda={flow.keepAgenda}
        onDownloadRejected={flow.downloadRejected}
        onKeepAgenda={flow.setKeepAgenda}
      />
    </div>
  );
}

/** Corpo da gaveta durante a importação: os passos e o conteúdo do passo atual. */
export function GradeImportBody({ flow, headingRef }: { flow: GradeImportFlow; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="grid gap-5">
      <Stepper applying={flow.applying} step={flow.step} />
      {flow.blocked ? (
        <p className="callout rose" role="alert">
          <span>{flow.blocked}</span>
        </p>
      ) : null}
      {flow.step === "file" ? <FileStep flow={flow} headingRef={headingRef} /> : null}
      {flow.step === "columns" ? <ColumnsStep flow={flow} headingRef={headingRef} /> : null}
      {flow.step === "preview" ? <PreviewStep flow={flow} headingRef={headingRef} /> : null}
    </div>
  );
}

/** Rodapé da gaveta durante a importação: dica, Voltar e o botão do passo. */
export function GradeImportFooter({ flow }: { flow: GradeImportFlow }) {
  const { applying, busy, importCount, sending, step } = flow;
  let label = "Continuar";
  let hint = "Só CSV por enquanto";
  if (step === "columns") {
    label = "Ver prévia";
    hint = "Nada muda até você confirmar na prévia";
  } else if (step === "preview") {
    label = importCount === 1 ? "Importar 1 nota" : `Importar ${importCount} notas`;
    hint = flow.draft && !flow.draft.canApply
      ? "Só quem criou o rascunho, com a disciplina em vigor, ou a administração aplica"
      : importCount
      ? flow.published
        ? "As notas já estão publicadas: aparecem na hora"
        : "Ficam ocultas até você publicar"
      : "Nada para importar: as linhas ficam de fora ou são iguais";
  }
  const waiting = sending || applying;
  const disabled = Boolean(flow.blocked) || (step === "preview" && (importCount === 0 || !flow.draft?.canApply));
  return (
    <>
      <p className="mr-auto basis-full text-[13px] text-muted sm:basis-auto">{hint}</p>
      <button
        className={cx(secondaryButton, "aria-disabled:opacity-55")}
        aria-disabled={busy || undefined}
        onClick={flow.back}
        type="button"
      >
        Voltar
      </button>
      <button
        className={cx(primaryButton, "aria-disabled:cursor-not-allowed aria-disabled:opacity-55")}
        aria-busy={waiting || undefined}
        aria-disabled={busy || disabled || undefined}
        onClick={() => {
          if (!disabled) flow.next();
        }}
        type="button"
      >
        {waiting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : step === "preview" ? <Check className="h-4 w-4" aria-hidden /> : null}
        {label}
      </button>
    </>
  );
}
