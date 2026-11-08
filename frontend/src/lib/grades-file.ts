/**
 * Arquivo de notas da importação (desenho 5.7): o front lê o CSV e manda só as linhas, em JSON (api.md, fase 3).
 * Só CSV por enquanto (decisão do usuário): planilha do Excel (.xlsx ou .xls) volta com a orientação de salvar
 * como CSV. Também monta o "Modelo da Agenda" e o "Relatório das rejeitadas" (células que começam com
 * = + - @ neutralizadas) e guarda o mapeamento de colunas de cada origem no navegador.
 * Dona: área Notas (docente).
 */
import type { GradeImportMapping, GradeImportRow, GradeImportRowInput, GradeImportSource } from "./types";

/** Teto do corpo do POST /grade-imports (bodyparser da API: 1 MB). */
export const MAX_BODY_BYTES = 1_000_000;

/** Linhas por importação (api.md: 1 a 2.000). */
export const MAX_ROWS = 2000;

/** Tamanho do arquivo que o navegador aceita ler (um CSV de 2.000 alunos fica bem abaixo disso). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Os nomes de coluna vão no mapping (até 100 caracteres na API). */
const MAX_HEADER_LENGTH = 100;

export type CsvDelimiter = ";" | "," | "\t";

export type CsvEncoding = "utf-8" | "windows-1252" | "utf-16";

/** Uma linha de dados do arquivo: o número dela na planilha (o cabeçalho é a linha 1) e as células. */
export type SheetRow = { rowNumber: number; cells: string[] };

/** O arquivo lido: cabeçalho, linhas de dados e como ele foi lido. */
export type ParsedSheet = {
  headers: string[];
  rows: SheetRow[];
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
};

/** O arquivo escolhido, já lido. */
export type GradesFile = {
  name: string;
  size: number;
  /** ISO do lastModified (vai em fileModifiedAt), ou null se o navegador não deu. */
  modifiedAt: string | null;
  /** Hash do conteúdo (vai em checksum). */
  checksum: string;
  sheet: ParsedSheet;
};

/** Erro de leitura com a frase para mostrar abaixo do campo do arquivo. */
export class GradesFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradesFileError";
  }
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

/** Texto do arquivo: UTF-8 quando é válido; senão Windows-1252 (o CSV do Excel em português). Tira o BOM. */
function decode(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  // "Texto Unicode" do Excel sai em UTF-16 com BOM
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    const label = bytes[0] === 0xff ? "utf-16le" : "utf-16be";
    return { text: new TextDecoder(label).decode(bytes).replace(/^﻿/, ""), encoding: "utf-16" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

/**
 * CSV (RFC 4180): aspas em volta da célula, aspas dobradas dentro dela, quebra de linha dentro das aspas,
 * fim de linha \n, \r\n ou \r. Devolve as linhas com as células sem espaço nas pontas.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    // aspas só abrem no começo da célula (espaços antes valem)
    if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      index += 1;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      index += 1;
      continue;
    }
    if (char === "\n" || char === "\r") {
      pushCell();
      rows.push(row);
      row = [];
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  if (cell !== "" || row.length) {
    pushCell();
    rows.push(row);
  }
  return rows;
}

const isBlankRow = (cells: string[]) => cells.every((cell) => cell === "");

/**
 * Separador do arquivo: o que dá o mesmo número de colunas (mais de uma) no maior número de linhas do começo.
 * No empate vale o ";" (o CSV do Excel em português, que deixa a vírgula para os decimais).
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 64 * 1024);
  const candidates: CsvDelimiter[] = [";", ",", "\t"];
  let best: CsvDelimiter = ";";
  let bestScore = -1;
  for (const delimiter of candidates) {
    const rows = parseCsv(sample, delimiter)
      .filter((cells) => !isBlankRow(cells))
      .slice(0, 30);
    if (!rows.length) {
      continue;
    }
    const counts = new Map<number, number>();
    for (const cells of rows) {
      counts.set(cells.length, (counts.get(cells.length) ?? 0) + 1);
    }
    let modeColumns = 1;
    let modeRows = 0;
    for (const [columns, total] of counts) {
      if (total > modeRows || (total === modeRows && columns > modeColumns)) {
        modeColumns = columns;
        modeRows = total;
      }
    }
    // a linha do cabeçalho conta em dobro: ela define as colunas
    const headerFits = rows[0].length === modeColumns ? 1 : 0;
    const score = modeColumns > 1 ? modeRows + headerFits : 0;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** Nomes de coluna únicos e não vazios ("Coluna 3" para o vazio; "Nota (2)" para o repetido), até 100 caracteres. */
function uniqueHeaders(cells: string[], width: number) {
  const used = new Set<string>();
  const headers: string[] = [];
  for (let index = 0; index < width; index += 1) {
    const base = (cells[index] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_HEADER_LENGTH - 6) || `Coluna ${index + 1}`;
    let name = base;
    let copy = 2;
    while (used.has(name.toLocaleLowerCase("pt-BR"))) {
      name = `${base} (${copy})`;
      copy += 1;
    }
    used.add(name.toLocaleLowerCase("pt-BR"));
    headers.push(name);
  }
  return headers;
}

/** Lê o texto do CSV: separador, cabeçalho (a primeira linha com conteúdo) e as linhas de dados. */
export function parseSheet(text: string, encoding: CsvEncoding = "utf-8"): ParsedSheet {
  if (text.includes("\u0000")) {
    throw new GradesFileError("Não deu para ler este arquivo como CSV. Salve a planilha como CSV e escolha de novo.");
  }
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  const headerIndex = records.findIndex((cells) => !isBlankRow(cells));
  if (headerIndex < 0) {
    throw new GradesFileError("O arquivo está vazio. Escolha o CSV com as notas dos alunos.");
  }
  const dataRecords = records
    .map((cells, index) => ({ rowNumber: index + 1, cells }))
    .slice(headerIndex + 1)
    .filter((row) => !isBlankRow(row.cells));
  if (!dataRecords.length) {
    throw new GradesFileError("O arquivo só tem o cabeçalho, sem linhas de alunos. Confira se escolheu o arquivo certo.");
  }
  if (dataRecords.length > MAX_ROWS) {
    throw new GradesFileError(
      `O arquivo tem ${dataRecords.length.toLocaleString("pt-BR")} linhas, e cada importação aceita até 2.000. Divida o arquivo em duas partes.`
    );
  }
  const width = Math.max(records[headerIndex].length, ...dataRecords.map((row) => row.cells.length));
  const headers = uniqueHeaders(records[headerIndex], width);
  if (headers.length < 2) {
    throw new GradesFileError(
      "O arquivo tem uma coluna só. Ele precisa de uma coluna para o aluno (e-mail ou matrícula) e outra para a nota, separadas por ponto e vírgula ou vírgula."
    );
  }
  return { headers, rows: dataRecords, delimiter, encoding };
}

/** Hash SHA-256 em hexadecimal (o checksum da importação). Sem crypto.subtle, um hash simples com o tamanho. */
async function checksumOf(bytes: Uint8Array) {
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
      return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // segue para o hash simples
  }
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}-${bytes.length}`;
}

/** Lê o arquivo escolhido. Erros (planilha do Excel, vazio, grande demais) saem como GradesFileError. */
export async function readGradesFile(file: File): Promise<GradesFile> {
  if (file.size === 0) {
    throw new GradesFileError("O arquivo está vazio. Escolha o CSV com as notas dos alunos.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new GradesFileError("O arquivo passa de 5 MB. Confira se é o CSV das notas desta avaliação.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // .xlsx e .ods são zip (PK); .xls antigo começa com D0 CF 11 E0
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new GradesFileError(
      "Este arquivo é uma planilha do Excel. Por enquanto a Agenda lê só CSV: no Excel, use Salvar como, escolha CSV (separado por ponto e vírgula) e selecione o arquivo de novo."
    );
  }
  const { text, encoding } = decode(bytes);
  const sheet = parseSheet(text, encoding);
  const modifiedAt = file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null;
  return { name: file.name, size: file.size, modifiedAt, checksum: await checksumOf(bytes), sheet };
}

/* ------------------------------------------------------------------ */
/* Colunas                                                             */
/* ------------------------------------------------------------------ */

/** Colunas escolhidas na tela (nameColumn vazio: sem coluna de nome). */
export type ColumnChoice = {
  identifierType: "email" | "registration";
  identifierColumn: string;
  scoreColumn: string;
  nameColumn: string;
};

/** "E-mail do aluno" vira "email do aluno" (sem acento, sem hífen, minúsculo), para comparar nomes de coluna. */
function headerKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_.:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const emailWords = ["email", "e mail", "correio"];
const registrationWords = ["matricula", "prontuario", "registro academico", "ra", "codigo do aluno", "id do aluno"];
const scoreWords = ["nota", "media", "pontuacao", "pontos", "score", "grade", "resultado", "total"];
const nameWords = ["nome", "aluno", "estudante", "name", "discente"];

function findHeader(headers: string[], words: string[], exclude: string[] = []) {
  const keys = headers.map(headerKey);
  // primeiro o nome exato, depois o que contém a palavra
  for (const word of words) {
    const index = keys.findIndex((key, position) => key === word && !exclude.includes(headers[position]));
    if (index >= 0) return headers[index];
  }
  for (const word of words) {
    const index = keys.findIndex(
      (key, position) => (word.length > 2 ? key.includes(word) : key.split(" ").includes(word)) && !exclude.includes(headers[position])
    );
    if (index >= 0) return headers[index];
  }
  return "";
}

/** Valores de uma coluna nas primeiras linhas com conteúdo. */
export function columnSamples(sheet: ParsedSheet, column: string, limit = 20) {
  const index = sheet.headers.indexOf(column);
  if (index < 0) return [];
  const values: string[] = [];
  for (const row of sheet.rows) {
    const value = row.cells[index] ?? "";
    if (value) values.push(value);
    if (values.length >= limit) break;
  }
  return values;
}

const looksLikeScore = (value: string) => /^\d{1,3}([.,]\d+)?$/.test(value.replace(/\s+/g, ""));

/** Palpite das colunas pelo nome do cabeçalho e pelo conteúdo (coluna com @ é e-mail; a última numérica é a nota). */
export function guessColumns(sheet: ParsedSheet, preferredType?: "email" | "registration"): ColumnChoice {
  const { headers } = sheet;
  let email = findHeader(headers, emailWords);
  if (!email) {
    email = headers.find((header) => {
      const values = columnSamples(sheet, header);
      return values.length > 0 && values.filter((value) => value.includes("@")).length >= values.length / 2;
    }) ?? "";
  }
  const registration = findHeader(headers, registrationWords, email ? [email] : []);
  const identifierType = preferredType ?? (email ? "email" : registration ? "registration" : "email");
  const identifierColumn = identifierType === "email" ? email || registration : registration || email;
  let scoreColumn = findHeader(headers, scoreWords, [identifierColumn]);
  if (!scoreColumn) {
    // a última coluna com números (diários do SUAP e do Moodle trazem a nota no fim)
    scoreColumn =
      [...headers].reverse().find((header) => {
        if (header === identifierColumn) return false;
        const values = columnSamples(sheet, header);
        return values.length > 0 && values.filter(looksLikeScore).length >= values.length / 2;
      }) ?? "";
  }
  const nameColumn = findHeader(headers, nameWords, [identifierColumn, scoreColumn]);
  return { identifierType, identifierColumn, scoreColumn, nameColumn };
}

/** Ajusta um mapeamento salvo às colunas deste arquivo: o que não existe nele vira o palpite. */
export function fitColumns(sheet: ParsedSheet, saved: GradeImportMapping | null): ColumnChoice {
  const guess = guessColumns(sheet, saved?.identifierType);
  if (!saved) return guess;
  const has = (column?: string | null) => Boolean(column) && sheet.headers.includes(column as string);
  return {
    identifierType: saved.identifierType,
    identifierColumn: has(saved.identifierColumn) ? saved.identifierColumn : guess.identifierColumn,
    scoreColumn: has(saved.scoreColumn) ? saved.scoreColumn : guess.scoreColumn,
    nameColumn: has(saved.nameColumn) ? (saved.nameColumn as string) : guess.nameColumn,
  };
}

/** O mapping que vai para a API. */
export function toMapping(choice: ColumnChoice): GradeImportMapping {
  return {
    identifierType: choice.identifierType,
    identifierColumn: choice.identifierColumn,
    scoreColumn: choice.scoreColumn,
    nameColumn: choice.nameColumn || null,
  };
}

/**
 * Linhas para o POST: identificador, nome e nota como vieram no arquivo (a API normaliza e aceita "7,5"). Linha
 * com as três células vazias fica de fora (a API também a ignora); célula de nota vazia nunca vira zero.
 */
export function buildImportRows(sheet: ParsedSheet, choice: ColumnChoice): GradeImportRowInput[] {
  const idIndex = sheet.headers.indexOf(choice.identifierColumn);
  const scoreIndex = sheet.headers.indexOf(choice.scoreColumn);
  const nameIndex = choice.nameColumn ? sheet.headers.indexOf(choice.nameColumn) : -1;
  const rows: GradeImportRowInput[] = [];
  for (const row of sheet.rows) {
    const identifier = row.cells[idIndex] ?? "";
    const score = row.cells[scoreIndex] ?? "";
    const name = nameIndex >= 0 ? (row.cells[nameIndex] ?? "") : "";
    if (!identifier && !score && !name) {
      continue;
    }
    rows.push({
      rowNumber: row.rowNumber,
      identifier: identifier || null,
      ...(nameIndex >= 0 ? { name: name || null } : {}),
      score: score || null,
    });
  }
  return rows;
}

/** Tamanho em bytes do corpo em JSON (o teto da API é 1 MB). */
export function jsonSize(body: unknown) {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/* ------------------------------------------------------------------ */
/* Mapeamento salvo por origem (localStorage)                          */
/* ------------------------------------------------------------------ */

const mappingKey = (source: GradeImportSource) => `agenda.notas.colunas.${source}`;
const SOURCE_KEY = "agenda.notas.origem";
const sources: GradeImportSource[] = ["modelo", "suap", "moodle", "classroom"];

/** O mapeamento usado da última vez com esta origem (ou null). */
export function loadSavedMapping(source: GradeImportSource): GradeImportMapping | null {
  try {
    const raw = window.localStorage.getItem(mappingKey(source));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GradeImportMapping>;
    if (
      (value.identifierType === "email" || value.identifierType === "registration") &&
      typeof value.identifierColumn === "string" &&
      typeof value.scoreColumn === "string"
    ) {
      return {
        identifierType: value.identifierType,
        identifierColumn: value.identifierColumn,
        scoreColumn: value.scoreColumn,
        nameColumn: typeof value.nameColumn === "string" ? value.nameColumn : null,
      };
    }
  } catch {
    // navegador sem localStorage (aba privada, bloqueio): segue sem o salvo
  }
  return null;
}

/** Guarda o mapeamento desta origem (e a origem, para a próxima importação começar nela). */
export function saveMapping(source: GradeImportSource, mapping: GradeImportMapping) {
  try {
    window.localStorage.setItem(mappingKey(source), JSON.stringify(mapping));
    window.localStorage.setItem(SOURCE_KEY, source);
  } catch {
    // sem localStorage: a próxima importação começa pelo palpite
  }
}

/** A origem da última importação (padrão: o modelo da Agenda). */
export function loadLastSource(): GradeImportSource {
  try {
    const value = window.localStorage.getItem(SOURCE_KEY);
    if (value && (sources as string[]).includes(value)) {
      return value as GradeImportSource;
    }
  } catch {
    // sem localStorage
  }
  return "modelo";
}

/* ------------------------------------------------------------------ */
/* Arquivos gerados: modelo e relatório                                */
/* ------------------------------------------------------------------ */

/**
 * Célula segura para abrir no Excel: texto que começa com = + - @ (ou tabulação e retorno) vira texto puro com
 * um apóstrofo na frente, para não virar fórmula (injeção de CSV).
 */
export function neutralizeCell(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Monta o CSV (separador ";", fim de linha do Windows), com as células neutralizadas e entre aspas quando precisa. */
export function toCsv(rows: Array<Array<string | number | null | undefined>>, delimiter: CsvDelimiter = ";") {
  return rows
    .map((cells) =>
      cells
        .map((cell) => {
          const text = neutralizeCell(cell === null || cell === undefined ? "" : String(cell));
          return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(delimiter)
    )
    .join("\r\n");
}

/** Baixa o texto como .csv em UTF-8 com BOM (o Excel abre os acentos certos). */
export function downloadCsv(fileName: string, content: string) {
  const blob = new Blob(["﻿", content, "\r\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Prova 2 de Matemática" vira "prova-2-de-matematica" (nome de arquivo). */
export function fileSlug(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "avaliacao"
  );
}

/** Colunas do Modelo da Agenda (a importação reconhece estes nomes sozinha). */
export const TEMPLATE_HEADERS = ["e-mail", "matrícula", "nome", "nota"];

/** Modelo da Agenda: e-mail, matrícula, nome e nota (vazia), um aluno por linha. */
export function templateCsv(students: Array<{ email: string; registration?: string | null; fullName: string | null }>) {
  return toCsv([TEMPLATE_HEADERS, ...students.map((student) => [student.email, student.registration ?? "", student.fullName ?? "", ""])]);
}

/** Relatório das linhas que ficaram de fora da importação, com o motivo de cada uma. */
export function rejectedCsv(rows: GradeImportRow[], kindLabel: (row: GradeImportRow) => string) {
  return toCsv([
    ["linha", "situação", "e-mail ou matrícula", "nome no arquivo", "nota no arquivo", "aluno encontrado", "motivo"],
    ...rows.map((row) => [
      row.rowNumber ?? "",
      kindLabel(row),
      row.identifier ?? "",
      row.nameHint ?? "",
      row.rawScore ?? "",
      row.student?.fullName ?? "",
      row.message ?? "",
    ]),
  ]);
}
