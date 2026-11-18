"use client";

import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CirclePlus,
  Copy,
  Download,
  Equal,
  History,
  PencilLine,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { countText, cx, parseScore } from "@/lib/format";
import { gradeImportKindLabels, gradeStatusLabels } from "@/lib/meta";
import type { GradeImport, GradeImportRow, GradeImportRowKind } from "@/lib/types";
import { Pager, usePaged } from "./pager";
import { Segmented, SegmentedButton } from "./ui";

/**
 * Passo Conferir da importação de notas: no alto os três números (para importar, iguais e com problema), a
 * pergunta das notas mudadas na Agenda depois do arquivo (keepAgendaWhenNewer) e a lista de todas as linhas, cada
 * uma com o aluno achado, a nota (a de antes riscada quando muda) e a situação com cor. O filtro "Com problema"
 * deixa só as linhas que ficam de fora. Dona: área Notas (docente).
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

/**
 * Categorias da conferência: as da API e "no_identifier", a linha sem o aluno (sem nome, e-mail ou matrícula). A
 * API classifica essa linha como "invalid"; a tela separa, para a etiqueta e o relatório dizerem a mesma coisa.
 */
export type ImportKind = GradeImportRowKind | "no_identifier";

export type ImportCounts = Record<ImportKind, number>;

/** A linha não traz o aluno (a API manda como "invalid", sem identificador). */
export function isWithoutIdentifier(row: GradeImportRow) {
  return row.kind === "invalid" && !row.identifier;
}

/** Categoria da linha (a linha sem identificação sai da "invalid"). */
export function rowKind(row: GradeImportRow): ImportKind {
  return isWithoutIdentifier(row) ? "no_identifier" : row.kind;
}

/** Contagem de cada classificação: o breakdown do rascunho ou, sem ele, a conta das linhas. */
export function importKindCounts(draft: GradeImport): ImportCounts {
  const counts = Object.fromEntries([...allKinds, "no_identifier"].map((kind) => [kind, 0])) as ImportCounts;
  if (draft.breakdown) {
    for (const kind of allKinds) {
      counts[kind] = draft.breakdown[kind] ?? 0;
    }
    // a linha sem identificação vem dentro de "invalid" no breakdown: passa para a categoria dela
    const withoutId = (draft.rows ?? []).filter(isWithoutIdentifier).length;
    const moved = Math.min(withoutId, counts.invalid);
    counts.invalid -= moved;
    counts.no_identifier = moved;
    return counts;
  }
  if (draft.rows?.length) {
    for (const row of draft.rows) {
      counts[rowKind(row)] += 1;
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
export function importableCount(counts: ImportCounts, keepAgenda: boolean) {
  return counts.new + counts.changed + (keepAgenda ? 0 : counts.newer_in_agenda);
}

/** Linhas que ficam de fora, somando todas as categorias. */
export function rejectedCount(counts: ImportCounts) {
  return counts.no_identifier + counts.no_match + counts.not_enrolled + counts.invalid + counts.duplicate;
}

/** Situação da linha no relatório e na etiqueta ("Sem identificação", "Sem aluno", "Nota inválida"). */
export function rowKindLabel(row: GradeImportRow) {
  return isWithoutIdentifier(row) ? "Sem identificação" : (gradeImportKindLabels[row.kind] ?? row.kind);
}

/**
 * Motivo da linha no relatório: a frase da API, menos a do aluno fora da turma, que a API escreve no masculino
 * ("O aluno não está ativo"); aqui ela sai neutra.
 */
export function rowReason(row: GradeImportRow) {
  if (row.kind === "not_enrolled") {
    return "Não está com matrícula ativa na turma (pedido pendente, matrícula inativa ou concluída).";
  }
  return row.message ?? "";
}

/** Valor anterior da linha: a nota da Agenda, "Falta" ou "Dispensa". */
function previousText(row: GradeImportRow) {
  if (row.previousStatus && row.previousStatus !== "graded") {
    return gradeStatusLabels[row.previousStatus];
  }
  return row.previousScoreText ?? "";
}

/** Motivo curto da linha que fica de fora ("11,5 passa de 10.", "Nota em branco."); senão a frase da API. */
function problemText(row: GradeImportRow, maxScore: number | null, maxScoreText: string | null) {
  const raw = (row.rawScore ?? "").trim();
  if (row.kind === "invalid" && row.identifier) {
    // "-" é como o Moodle marca quem ainda não tem nota
    if (!raw || /^[-–—]$/.test(raw)) return "Nota em branco. Esta linha fica de fora.";
    const value = parseScore(raw);
    if (value !== null && Number.isNaN(value)) {
      if (/^-/.test(raw)) return `${raw} é negativa.`;
      if (/^\d+[.,]\d{3,}$/.test(raw)) return `${raw} tem mais de duas casas depois da vírgula.`;
      return `${raw} não é uma nota. Use um número, como 7,5.`;
    }
    if (value !== null && maxScore !== null && value > maxScore && maxScoreText) {
      return `${raw} passa de ${maxScoreText}, o valor da avaliação.`;
    }
  }
  return rowReason(row) || rowKindLabel(row);
}

type Tone = "new" | "chg" | "same" | "keep" | "bad";

const toneIcons: Record<Tone, LucideIcon> = {
  new: CirclePlus,
  chg: PencilLine,
  same: Equal,
  keep: History,
  bad: CircleAlert,
};

const badIcons: Partial<Record<GradeImportRowKind, LucideIcon>> = {
  no_match: UserX,
  not_enrolled: UserX,
  duplicate: Copy,
};

/** Situação da linha na conferência: a etiqueta e a cor. */
function situationOf(row: GradeImportRow, keepAgenda: boolean): { label: string; tone: Tone } {
  switch (row.kind) {
    case "new":
      return { label: "Nova", tone: "new" };
    case "changed":
      return { label: "Muda", tone: "chg" };
    case "same":
      return { label: "Igual", tone: "same" };
    case "newer_in_agenda":
      return keepAgenda ? { label: "Fica a da Agenda", tone: "keep" } : { label: "Muda", tone: "chg" };
    default:
      return { label: rowKindLabel(row), tone: "bad" };
  }
}

/** A nota da linha: a nova, ou a de antes riscada e a nova; a que fica de fora aparece apagada. */
function RowValue({ keepAgenda, row }: { keepAgenda: boolean; row: GradeImportRow }) {
  const to = row.scoreText ?? "";
  const from = previousText(row);
  if (rejectedKinds.includes(row.kind)) {
    const raw = (row.rawScore ?? "").trim();
    return <p className="notas-docente-ck-val is-off">{raw && !/^[-–—]$/.test(raw) ? raw : "sem nota"}</p>;
  }
  if (row.kind === "same") {
    return <p className="notas-docente-ck-val is-same">{to}</p>;
  }
  if (row.kind === "newer_in_agenda" && keepAgenda) {
    return (
      <p className="notas-docente-ck-val">
        <span className="sr-only">{`fica ${from}, a da Agenda; a planilha trazia ${to}`}</span>
        <span aria-hidden>{from}</span>
      </p>
    );
  }
  if ((row.kind === "changed" || row.kind === "newer_in_agenda") && from) {
    return (
      <p className="notas-docente-ck-val">
        <span className="sr-only">{`de ${from} para ${to}`}</span>
        <span aria-hidden className="inline-flex items-center gap-1">
          <s>{from}</s>
          <ArrowRight className="h-3.5 w-3.5 text-muted" />
          {to}
        </span>
      </p>
    );
  }
  return <p className="notas-docente-ck-val">{to}</p>;
}

function CheckRow({
  keepAgenda,
  maxScore,
  maxScoreText,
  row,
}: {
  keepAgenda: boolean;
  maxScore: number | null;
  maxScoreText: string | null;
  row: GradeImportRow;
}) {
  const { label, tone } = situationOf(row, keepAgenda);
  const Icon = (tone === "bad" ? badIcons[row.kind] : null) ?? toneIcons[tone];
  const found = row.student?.fullName ?? null;
  // o que veio na planilha: o nome ou o e-mail (ou a matrícula) da linha
  const fromFile = row.identifier || row.nameHint || null;
  const named = found || row.nameHint || row.identifier;
  const who = named || (row.rowNumber ? `Linha ${row.rowNumber}` : "Linha sem dados");
  // sem nome, o título já é a linha
  const line = row.rowNumber && named ? `linha ${row.rowNumber}` : null;
  const sameAsFound = Boolean(found && fromFile && fromFile.toLocaleLowerCase("pt-BR") === found.toLocaleLowerCase("pt-BR"));
  const fileText = fromFile && fromFile !== who && !sameAsFound ? `na planilha: ${fromFile}` : null;
  return (
    <li className={cx("notas-docente-ck", tone === "bad" && "is-bad")}>
      <span className={`notas-docente-ck-ico is-${tone}`} aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="notas-docente-ck-body">
        <p className="notas-docente-ck-name">{who}</p>
        {tone === "bad" ? (
          <p className="notas-docente-ck-why">{problemText(row, maxScore, maxScoreText)}</p>
        ) : row.kind === "newer_in_agenda" && row.message ? (
          <p className="notas-docente-ck-why is-keep">{row.message}</p>
        ) : null}
        {line || fileText ? <p className="notas-docente-ck-sub">{[line, fileText].filter(Boolean).join(", ")}</p> : null}
      </div>
      <div className="notas-docente-ck-end">
        <RowValue keepAgenda={keepAgenda} row={row} />
        <span className={`notas-docente-tag is-${tone}`}>{label}</span>
      </div>
    </li>
  );
}

const FIRST_ROWS = 10;

type Filter = "all" | "bad";

export function GradeImportPreview({
  draft,
  keepAgenda,
  maxScore = null,
  maxScoreText = null,
  onDownloadRejected,
  onKeepAgenda,
  source,
}: {
  draft: GradeImport;
  keepAgenda: boolean;
  /** Quanto vale a avaliação, em centésimos e em texto ("10"), para o motivo "11,5 passa de 10". */
  maxScore?: number | null;
  maxScoreText?: string | null;
  onDownloadRejected: () => void;
  onKeepAgenda: (keep: boolean) => void;
  /** A linha da planilha usada (nome do arquivo, colunas, Ajustar colunas), logo abaixo dos números. */
  source?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const linesTitleRef = useRef<HTMLHeadingElement>(null);
  const rows = draft.rows ?? [];
  const counts = importKindCounts(draft);
  const toImport = importableCount(counts, keepAgenda);
  const bad = rows.filter((row) => rejectedKinds.includes(row.kind));
  const badTotal = bad.length || rejectedCount(counts);
  const newer = rows.filter((row) => row.kind === "newer_in_agenda");
  const visible = filter === "bad" ? bad : rows;
  // a planilha pode ser a turma inteira: uma página de FIRST_ROWS linhas por vez (nunca expande no lugar)
  const paged = usePaged(visible, FIRST_ROWS, `${draft.id}|${filter}`);
  const parts = [
    counts.new ? countText(counts.new, "nova", "novas") : null,
    counts.changed || (!keepAgenda && counts.newer_in_agenda)
      ? countText(counts.changed + (keepAgenda ? 0 : counts.newer_in_agenda), "muda", "mudam")
      : null,
  ].filter(Boolean);
  // as mudadas na Agenda depois da planilha, quando a docente mantém as da Agenda
  const kept = keepAgenda ? counts.newer_in_agenda : 0;

  return (
    <>
      <div className="notas-docente-stats" role="group" aria-label="Resumo da conferência">
        <div className={cx("notas-docente-stat", toImport > 0 && "is-go")}>
          <b>{toImport}</b>
          <span>{toImport === 1 ? "nota para importar" : "notas para importar"}</span>
          {parts.length ? (
            <small>{parts.join(" e ")}</small>
          ) : kept ? (
            <small>{kept === 1 ? "1 fica com a nota da Agenda" : `${kept} ficam com a nota da Agenda`}</small>
          ) : null}
        </div>
        <div className="notas-docente-stat">
          <b>{counts.same}</b>
          <span>{counts.same === 1 ? "igual à da Agenda" : "iguais às da Agenda"}</span>
          {counts.same ? <small>{counts.same === 1 ? "fica como está" : "ficam como estão"}</small> : null}
        </div>
        <div className={cx("notas-docente-stat", badTotal > 0 && "is-bad")}>
          <b>{badTotal}</b>
          <span>com problema</span>
          {badTotal ? <small>{badTotal === 1 ? "fica de fora" : "ficam de fora"}</small> : null}
        </div>
      </div>

      {source}

      {newer.length ? (
        <div className="notas-docente-ask" role="radiogroup" aria-labelledby={`notas-docente-pergunta-${draft.id}`}>
          <p className="notas-docente-ask-q">
            <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span id={`notas-docente-pergunta-${draft.id}`}>
              {newer.length === 1
                ? "1 nota foi alterada na Agenda depois desta planilha. Manter a da Agenda ou trocar pela da planilha?"
                : `${newer.length} notas foram alteradas na Agenda depois desta planilha. Manter as da Agenda ou trocar pelas da planilha?`}
            </span>
          </p>
          <label className={cx("opt", keepAgenda && "on")}>
            <input className="sr-only" checked={keepAgenda} name={`manter-${draft.id}`} onChange={() => onKeepAgenda(true)} type="radio" />
            <span className="radio" aria-hidden />
            <span>
              <span className="block text-sm font-bold text-ink">Manter as da Agenda</span>
              <span className="block text-sm text-muted">Quem mudou a nota na Agenda conferiu depois da planilha.</span>
            </span>
          </label>
          <label className={cx("opt", !keepAgenda && "on")}>
            <input className="sr-only" checked={!keepAgenda} name={`manter-${draft.id}`} onChange={() => onKeepAgenda(false)} type="radio" />
            <span className="radio" aria-hidden />
            <span>
              <span className="block text-sm font-bold text-ink">Trocar pelas da planilha</span>
              <span className="block text-sm text-muted">Vale o que está na planilha para estes alunos.</span>
            </span>
          </label>
        </div>
      ) : null}

      {rows.length ? (
        <section className="grid gap-3" aria-labelledby={`notas-docente-linhas-${draft.id}`}>
          <h4 ref={linesTitleRef} className="sr-only" id={`notas-docente-linhas-${draft.id}`}>
            Linhas da planilha
          </h4>
          <div className="notas-docente-ck-bar">
            <Segmented label="Quais linhas mostrar">
              <SegmentedButton
                active={filter === "all"}
                label={`Todas ${rows.length}`}
                onClick={() => setFilter("all")}
              />
              <SegmentedButton
                active={filter === "bad"}
                label={`Com problema ${bad.length}`}
                onClick={() => setFilter("bad")}
              />
            </Segmented>
            {bad.length ? (
              <button className="link min-h-6 text-[13.5px]" onClick={onDownloadRejected} type="button">
                <Download className="h-4 w-4" aria-hidden />
                Baixar as linhas com problema
              </button>
            ) : null}
          </div>
          {visible.length ? (
            <ul className="notas-docente-cks">
              {paged.items.map((row) => (
                <CheckRow key={row.id} keepAgenda={keepAgenda} maxScore={maxScore} maxScoreText={maxScoreText} row={row} />
              ))}
            </ul>
          ) : (
            <p className="notas-docente-ck-none">
              <span className="notas-docente-ck-ico is-ok" aria-hidden>
                <CircleCheck className="h-4 w-4" />
              </span>
              <span>
                <b>Nenhuma linha com problema.</b> Todas as linhas acharam o aluno na turma e têm uma nota válida.
              </span>
            </p>
          )}
          <Pager paged={paged} noun={["linha", "linhas"]} focusRef={linesTitleRef} />
        </section>
      ) : (
        <p className="callout past">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Nenhuma linha com dados nesta planilha. Ajuste as colunas ou envie outra planilha.</span>
        </p>
      )}
    </>
  );
}
