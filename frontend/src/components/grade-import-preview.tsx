"use client";

import { ChevronDown, ChevronUp, CircleAlert, Copy, Download, History, UserX, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { countText, cx, parseScore } from "@/lib/format";
import { gradeImportKindLabels, gradeStatusLabels } from "@/lib/meta";
import type { GradeImport, GradeImportRow, GradeImportRowKind } from "@/lib/types";

/**
 * Passo Prévia da importação de notas (desenho 5.7, amostra docente-importar-previa): totais em chips, as linhas
 * com problema primeiro, as alteradas com o valor de antes e o novo, as iguais ocultas e a pergunta das notas
 * mudadas na Agenda depois do arquivo (keepAgendaWhenNewer). Dona: área Notas (docente).
 */

const allKinds: GradeImportRowKind[] = [
  "new",
  "changed",
  "same",
  "no_match",
  "not_enrolled",
  "invalid",
  "duplicate",
  "newer_in_agenda",
];

/** Linhas que ficam de fora (o "rejected" dos totais). */
export const rejectedKinds: GradeImportRowKind[] = ["invalid", "no_match", "not_enrolled", "duplicate"];

/** Contagem de cada classificação: o breakdown do rascunho ou, sem ele, a conta das linhas. */
export function importKindCounts(draft: GradeImport): Record<GradeImportRowKind, number> {
  const counts = Object.fromEntries(allKinds.map((kind) => [kind, 0])) as Record<GradeImportRowKind, number>;
  if (draft.breakdown) {
    for (const kind of allKinds) {
      counts[kind] = draft.breakdown[kind] ?? 0;
    }
    return counts;
  }
  if (draft.rows?.length) {
    for (const row of draft.rows) {
      counts[row.kind] += 1;
    }
    return counts;
  }
  // só o resumo (lista de importações): os totais
  counts.new = draft.totals.new;
  counts.changed = draft.totals.changed;
  counts.same = draft.totals.same;
  counts.newer_in_agenda = draft.totals.newerInAgenda;
  counts.invalid = draft.totals.rejected;
  return counts;
}

/** Quantas notas o Aplicar grava: novas, alteradas e, se a docente escolheu substituir, as mudadas na Agenda. */
export function importableCount(counts: Record<GradeImportRowKind, number>, keepAgenda: boolean) {
  return counts.new + counts.changed + (keepAgenda ? 0 : counts.newer_in_agenda);
}

type ChipTone = "new" | "chg" | "same" | "bad";

const chips: Array<{ kind: GradeImportRowKind; tone: ChipTone; one: string; many: string }> = [
  { kind: "new", tone: "new", one: "nova", many: "novas" },
  { kind: "changed", tone: "chg", one: "alterada", many: "alteradas" },
  { kind: "newer_in_agenda", tone: "chg", one: "mudou na Agenda", many: "mudaram na Agenda" },
  { kind: "same", tone: "same", one: "igual", many: "iguais" },
  { kind: "no_match", tone: "bad", one: "sem aluno", many: "sem aluno" },
  { kind: "not_enrolled", tone: "bad", one: "fora da turma", many: "fora da turma" },
  { kind: "invalid", tone: "bad", one: "nota inválida", many: "notas inválidas" },
  { kind: "duplicate", tone: "bad", one: "repetida", many: "repetidas" },
];

/** Chips dos totais: "18 novas", "2 alteradas", "1 sem aluno", "1 nota inválida". */
export function ImportTotals({ counts }: { counts: Record<GradeImportRowKind, number> }) {
  const visible = chips.filter((chip) => counts[chip.kind] > 0);
  if (!visible.length) {
    return null;
  }
  return (
    <ul className="notas-docente-tot" aria-label="Totais da prévia">
      {visible.map((chip) => (
        <li key={chip.kind} className={`is-${chip.tone}`}>
          <b>{counts[chip.kind]}</b> {counts[chip.kind] === 1 ? chip.one : chip.many}
        </li>
      ))}
    </ul>
  );
}

/** Situação da linha no relatório e na etiqueta ("Sem aluno", "Nota inválida"). */
export function rowKindLabel(row: GradeImportRow) {
  return gradeImportKindLabels[row.kind] ?? row.kind;
}

/** Valor anterior da linha: a nota da Agenda, "Falta" ou "Dispensa". */
function previousText(row: GradeImportRow) {
  if (row.previousStatus && row.previousStatus !== "graded") {
    return gradeStatusLabels[row.previousStatus];
  }
  return row.previousScoreText ?? "";
}

const rejectedIcons: Partial<Record<GradeImportRowKind, LucideIcon>> = {
  no_match: UserX,
  not_enrolled: UserX,
  duplicate: Copy,
};

/** Quem é a linha: o aluno casado, o nome do arquivo ou o identificador. */
function rowWho(row: GradeImportRow) {
  return row.student?.fullName || row.nameHint || row.identifier || (row.rowNumber ? `Linha ${row.rowNumber}` : "Linha sem dados");
}

/** Como a importação acha o aluno: para "Linha sem e-mail" ou "Linha sem matrícula". */
type IdentifierType = GradeImport["mapping"]["identifierType"];

/**
 * Título curto da linha que fica de fora, como na amostra: "joao.s@... não está na turma", "11,5 passa de 10".
 * A frase longa da API continua no relatório das rejeitadas.
 */
function rejectedTitle(row: GradeImportRow, by: IdentifierType, maxScore: number | null, maxScoreText: string | null) {
  const idName = by === "registration" ? "matrícula" : "e-mail";
  const who = row.student?.fullName || row.nameHint || row.identifier || "O aluno";
  const raw = (row.rawScore ?? "").trim();
  if (row.kind === "no_match") {
    if (!row.identifier) return `Linha sem ${idName}`;
    return /mais de um/i.test(row.message ?? "")
      ? `${row.identifier} serve para mais de um aluno`
      : `${row.identifier} não está na turma`;
  }
  if (row.kind === "not_enrolled") {
    return `${who} não está ativo na turma`;
  }
  if (row.kind === "duplicate") {
    return `${who} aparece mais de uma vez`;
  }
  if (row.kind === "invalid") {
    if (!row.identifier) return `Linha sem ${idName} do aluno`;
    if (!raw) return "Nota em branco";
    const value = parseScore(raw);
    if (value !== null && Number.isNaN(value)) {
      return /^-/.test(raw) ? `${raw} é negativa` : /^\d+[.,]\d{3,}$/.test(raw) ? `${raw} tem mais de duas casas` : `${raw} não é uma nota`;
    }
    if (value !== null && maxScore !== null && value > maxScore && maxScoreText) {
      return `${raw} passa de ${maxScoreText}`;
    }
  }
  return row.message ?? rowKindLabel(row);
}

function RejectedRow({
  by,
  maxScore,
  maxScoreText,
  row,
}: {
  by: IdentifierType;
  maxScore: number | null;
  maxScoreText: string | null;
  row: GradeImportRow;
}) {
  const Icon = rejectedIcons[row.kind] ?? CircleAlert;
  const title = rejectedTitle(row, by, maxScore, maxScoreText);
  const who = row.student?.fullName || row.nameHint || null;
  const raw = (row.rawScore ?? "").trim();
  // a segunda linha completa o título: a linha do arquivo, quem é e a nota, sem repetir o que o título já diz
  const details = [
    row.rowNumber ? `linha ${row.rowNumber} do arquivo` : null,
    who && !title.includes(who) ? who : null,
    row.identifier && !title.includes(row.identifier) && row.identifier !== who ? row.identifier : null,
    raw && !title.includes(raw) ? `nota ${raw}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const tag = row.kind === "invalid" && !row.identifier ? "Sem identificação" : rowKindLabel(row);
  return (
    <li>
      <span className="notas-docente-r-ico">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="notas-docente-r-body">
        <p className="notas-docente-r-t">{title}</p>
        <p className="notas-docente-r-s">
          <span className="notas-docente-tag is-bad">{tag}</span>
          {details ? <span className="min-w-0 wrap-anywhere">{details}</span> : null}
        </p>
      </div>
    </li>
  );
}

/** "6,0 para 7,5" (a de antes riscada). */
function Change({ from, to }: { from: string; to: string }) {
  return (
    <p className="notas-docente-r-v">
      <span className="sr-only">{`de ${from || "sem nota"} para ${to}`}</span>
      <span aria-hidden>
        {from ? <s>{from}</s> : null}
        {from ? <span className="to">para</span> : null}
        {to}
      </span>
    </p>
  );
}

function StudentLine({ row }: { row: GradeImportRow }) {
  return (
    <p className="notas-docente-r-t">
      {rowWho(row)}
      {row.identifier ? <span className="mat"> {row.identifier}</span> : null}
    </p>
  );
}

const FIRST_ROWS = 8;

/** Seção da prévia com os primeiros itens e "Ver todas (N)". */
function PreviewSection({
  action,
  bad,
  children,
  count,
  title,
}: {
  action?: ReactNode;
  bad?: boolean;
  children: ReactNode[];
  count: number;
  title: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? children : children.slice(0, FIRST_ROWS);
  return (
    <section className="notas-docente-sec">
      <div className="notas-docente-sec-h">
        <h4 className="notas-docente-h3">
          {title} <span className="n">({count})</span>
        </h4>
        {action}
      </div>
      <ul className={cx("notas-docente-rows", bad && "is-bad")}>{shown}</ul>
      {children.length > FIRST_ROWS ? (
        <button className="link min-h-6 self-start" aria-expanded={all} onClick={() => setAll((value) => !value)} type="button">
          {all ? "Mostrar menos" : `Ver todas (${children.length})`}
          {all ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
      ) : null}
    </section>
  );
}

export function GradeImportPreview({
  draft,
  keepAgenda,
  maxScore = null,
  maxScoreText = null,
  onDownloadRejected,
  onKeepAgenda,
}: {
  draft: GradeImport;
  keepAgenda: boolean;
  /** Quanto vale a avaliação, em centésimos e em texto ("10"), para o título "11,5 passa de 10". */
  maxScore?: number | null;
  maxScoreText?: string | null;
  onDownloadRejected: () => void;
  onKeepAgenda: (keep: boolean) => void;
}) {
  const rows = draft.rows ?? [];
  const counts = importKindCounts(draft);
  const rejected = rows.filter((row) => rejectedKinds.includes(row.kind));
  const newer = rows.filter((row) => row.kind === "newer_in_agenda");
  const changed = rows.filter((row) => row.kind === "changed");
  const created = rows.filter((row) => row.kind === "new");
  const same = counts.same;
  const nothing = !rows.length;

  return (
    <>
      <ImportTotals counts={counts} />

      {nothing ? (
        <p className="callout past">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Nenhuma linha com dados neste arquivo. Volte e confira as colunas escolhidas.</span>
        </p>
      ) : null}

      {newer.length ? (
        <div className="notas-docente-ask" role="radiogroup" aria-labelledby={`notas-docente-pergunta-${draft.id}`}>
          <p className="notas-docente-ask-q">
            <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span id={`notas-docente-pergunta-${draft.id}`}>
              {newer.length === 1
                ? "1 nota foi alterada na Agenda depois deste arquivo. Manter a da Agenda ou substituir?"
                : `${newer.length} notas foram alteradas na Agenda depois deste arquivo. Manter as da Agenda ou substituir?`}
            </span>
          </p>
          <label className={cx("opt", keepAgenda && "on")}>
            <input
              className="sr-only"
              checked={keepAgenda}
              name={`manter-${draft.id}`}
              onChange={() => onKeepAgenda(true)}
              type="radio"
            />
            <span className="radio" aria-hidden />
            <span>
              <span className="block text-sm font-bold text-ink">Manter as da Agenda</span>
              <span className="block text-sm text-muted">Quem mudou a nota na Agenda conferiu depois do arquivo.</span>
            </span>
          </label>
          <label className={cx("opt", !keepAgenda && "on")}>
            <input
              className="sr-only"
              checked={!keepAgenda}
              name={`manter-${draft.id}`}
              onChange={() => onKeepAgenda(false)}
              type="radio"
            />
            <span className="radio" aria-hidden />
            <span>
              <span className="block text-sm font-bold text-ink">Substituir pelas do arquivo</span>
              <span className="block text-sm text-muted">Vale o que está no arquivo para estes alunos.</span>
            </span>
          </label>
        </div>
      ) : null}

      {rejected.length ? (
        <PreviewSection
          bad
          count={rejected.length}
          title="Ficam de fora"
          action={
            <button className="link min-h-6 text-[13.5px]" onClick={onDownloadRejected} type="button">
              <Download className="h-4 w-4" aria-hidden />
              Baixar relatório das rejeitadas
            </button>
          }
        >
          {rejected.map((row) => (
            <RejectedRow
              key={row.id}
              by={draft.mapping.identifierType}
              maxScore={maxScore}
              maxScoreText={maxScoreText}
              row={row}
            />
          ))}
        </PreviewSection>
      ) : null}

      {newer.length ? (
        <PreviewSection count={newer.length} title="Mudaram na Agenda">
          {newer.map((row) => (
            <li key={row.id}>
              <div className="notas-docente-r-body">
                <StudentLine row={row} />
                {row.message ? <p className="notas-docente-r-s">{row.message}</p> : null}
              </div>
              {keepAgenda ? (
                <p className="notas-docente-r-v">
                  <span className="sr-only">{`fica ${previousText(row)}, a da Agenda; o arquivo trazia ${row.scoreText ?? ""}`}</span>
                  <span aria-hidden>
                    <span className="to">fica</span>
                    {previousText(row)}
                  </span>
                </p>
              ) : (
                <Change from={previousText(row)} to={row.scoreText ?? ""} />
              )}
            </li>
          ))}
        </PreviewSection>
      ) : null}

      {changed.length ? (
        <PreviewSection count={changed.length} title="Alteradas">
          {changed.map((row) => (
            <li key={row.id}>
              <div className="notas-docente-r-body">
                <StudentLine row={row} />
              </div>
              <Change from={previousText(row)} to={row.scoreText ?? ""} />
            </li>
          ))}
        </PreviewSection>
      ) : null}

      {created.length ? (
        <PreviewSection count={created.length} title="Novas">
          {created.map((row) => (
            <li key={row.id}>
              <div className="notas-docente-r-body">
                <StudentLine row={row} />
              </div>
              <p className="notas-docente-r-v">{row.scoreText}</p>
            </li>
          ))}
        </PreviewSection>
      ) : null}

      {same ? (
        <p className="text-sm text-muted">
          {same === 1
            ? "1 nota igual à da Agenda fica como está e não aparece na lista."
            : `${countText(same, "nota igual", "notas iguais")} às da Agenda ficam como estão e não aparecem na lista.`}
        </p>
      ) : null}
    </>
  );
}
