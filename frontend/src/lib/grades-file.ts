/**
 * Arquivo de notas da importação (desenho 5.7): o front lê a planilha e manda só as linhas para a API (api.md,
 * fase 3). Lê a planilha do Excel (.xlsx), que é o formato principal, e também o CSV que os sistemas exportam.
 * Também monta a planilha modelo da turma e o relatório das linhas rejeitadas, os dois em .xlsx, e guarda no
 * navegador as colunas escolhidas da última vez.
 * Dona: área Notas (docente).
 */
import type { SheetData } from "write-excel-file/browser";
import type { GradeEventInfo, GradeImportMapping, GradeImportRow, GradeImportRowInput } from "./types";

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

/** O arquivo lido: cabeçalho, linhas de dados e o formato (o separador e a codificação só existem no CSV). */
export type ParsedSheet = {
  headers: string[];
  rows: SheetRow[];
  format: "xlsx" | "csv";
  delimiter?: CsvDelimiter;
  encoding?: CsvEncoding;
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

/** Cabeçalho (a primeira linha com conteúdo) e linhas de dados de uma planilha já lida em células de texto. */
function sheetFromRecords(records: string[][]): Pick<ParsedSheet, "headers" | "rows"> {
  const headerIndex = records.findIndex((cells) => !isBlankRow(cells));
  if (headerIndex < 0) {
    throw new GradesFileError("A planilha está vazia. Escolha a planilha com as notas dos alunos.");
  }
  const dataRecords = records
    .map((cells, index) => ({ rowNumber: index + 1, cells }))
    .slice(headerIndex + 1)
    .filter((row) => !isBlankRow(row.cells));
  if (!dataRecords.length) {
    throw new GradesFileError("A planilha só tem o cabeçalho, sem linhas de alunos. Confira se escolheu a planilha certa.");
  }
  if (dataRecords.length > MAX_ROWS) {
    throw new GradesFileError(
      `A planilha tem ${dataRecords.length.toLocaleString("pt-BR")} linhas, e cada importação aceita até 2.000. Divida a planilha em duas partes.`
    );
  }
  const width = Math.max(records[headerIndex].length, ...dataRecords.map((row) => row.cells.length));
  const headers = uniqueHeaders(records[headerIndex], width);
  if (headers.length < 2) {
    throw new GradesFileError(
      "A planilha tem uma coluna só. Ela precisa de uma coluna para o aluno (nome, e-mail ou matrícula) e outra para a nota."
    );
  }
  return { headers, rows: dataRecords };
}

/** Lê o texto do CSV: separador, cabeçalho (a primeira linha com conteúdo) e as linhas de dados. */
export function parseSheet(text: string, encoding: CsvEncoding = "utf-8"): ParsedSheet {
  if (text.includes("\u0000")) {
    throw new GradesFileError("Não deu para ler este arquivo. Salve a planilha no Excel como .xlsx e escolha de novo.");
  }
  const delimiter = detectDelimiter(text);
  return { ...sheetFromRecords(parseCsv(text, delimiter)), format: "csv", delimiter, encoding };
}

/** Célula da planilha do Excel em texto, como a docente vê (7.5 continua 7.5; a API aceita ponto e vírgula). */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    // tira o ruído de ponto flutuante (8.300000000000001 vira 8.3)
    return Number.isFinite(value) ? String(Number.parseFloat(value.toPrecision(12))) : "";
  }
  if (typeof value === "boolean") return value ? "VERDADEIRO" : "FALSO";
  if (value instanceof Date) return value.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return String(value).trim();
}

/** Lê a primeira aba da planilha do Excel (.xlsx). A biblioteca só carrega quando a docente escolhe uma planilha. */
async function parseXlsx(bytes: Uint8Array): Promise<ParsedSheet> {
  let data: unknown[][];
  try {
    const { readSheet } = await import("read-excel-file/browser");
    data = (await readSheet(new Blob([bytes as unknown as ArrayBuffer]))) as unknown[][];
  } catch {
    throw new GradesFileError(
      "Não deu para ler esta planilha. Abra no Excel, use Salvar como, escolha Pasta de Trabalho do Excel (.xlsx) e tente de novo."
    );
  }
  return { ...sheetFromRecords(data.map((row) => row.map(cellText))), format: "xlsx" };
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

/** Lê o arquivo escolhido (.xlsx ou CSV). Erros (vazio, grande demais, formato antigo) saem como GradesFileError. */
export async function readGradesFile(file: File): Promise<GradesFile> {
  if (file.size === 0) {
    throw new GradesFileError("A planilha está vazia. Escolha a planilha com as notas dos alunos.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new GradesFileError("A planilha passa de 5 MB. Confira se é a planilha das notas desta avaliação.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let sheet: ParsedSheet;
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    // .xls do Excel antigo
    throw new GradesFileError(
      "Esta planilha está no formato antigo do Excel (.xls). Abra no Excel, use Salvar como, escolha Pasta de Trabalho do Excel (.xlsx) e tente de novo."
    );
  } else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // .xlsx é um zip (começa com PK)
    sheet = await parseXlsx(bytes);
  } else {
    const { text, encoding } = decode(bytes);
    sheet = parseSheet(text, encoding);
  }
  const modifiedAt = file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null;
  return { name: file.name, size: file.size, modifiedAt, checksum: await checksumOf(bytes), sheet };
}

/* ------------------------------------------------------------------ */
/* Colunas                                                             */
/* ------------------------------------------------------------------ */

/** Como a importação acha o aluno: pelo e-mail da conta, pela matrícula ou pelo nome completo. */
export type IdentifierType = GradeImportMapping["identifierType"];

/** Colunas escolhidas na tela (nameColumn vazio: sem coluna de nome; no tipo "name" o nome já é o aluno). */
export type ColumnChoice = {
  identifierType: IdentifierType;
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
const nameWords = ["nome completo", "nome do aluno", "nome", "aluno", "estudante", "discente", "name"];

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

/** A coluna existe no arquivo e tem valor em alguma linha (a matrícula do Modelo baixado pela docente vem vazia). */
export function columnHasData(sheet: ParsedSheet, column: string | null | undefined) {
  return Boolean(column) && sheet.headers.includes(column as string) && columnSamples(sheet, column as string, 1).length > 0;
}

/** A maior parte dos valores da coluna tem @ (coluna de e-mail). */
function looksLikeEmails(sheet: ParsedSheet, column: string) {
  const values = columnSamples(sheet, column);
  return values.length > 0 && values.filter((value) => value.includes("@")).length >= values.length / 2;
}

/** Coluna que junta várias avaliações: o "Total do curso" do Moodle, a "Média" do diário. */
const aggregateWords = ["total", "media", "soma", "acumulad"];
const isAggregate = (header: string) => aggregateWords.some((word) => headerKey(header).includes(word));

/** "Tarefa:Prova 1 (Real)" do Moodle vira "prova 1": sem o tipo da atividade e sem o tipo da nota. */
function activityKey(header: string) {
  return headerKey(header.replace(/^[^:]{2,40}:/, "").replace(/\((real|porcentagem|letra)\)\s*$/i, ""));
}

/** Os valores da coluna parecem notas. */
function looksLikeScores(sheet: ParsedSheet, header: string) {
  const values = columnSamples(sheet, header).filter((value) => value.trim() !== "-");
  return values.length > 0 && values.filter(looksLikeScore).length >= values.length / 2;
}

/** A palavra aparece no nome da coluna (as curtas, como "ra", só como palavra inteira). */
const hasWord = (key: string, word: string) => (word.length > 2 ? key.includes(word) : key.split(" ").includes(word));

/**
 * Coluna com o nome dos alunos ("Aluno", "Nome", "Estudante", "Nome completo"), com dados neste arquivo. Fica de
 * fora a coluna de e-mail ou de matrícula ("E-mail do aluno", "Código do aluno"), o "Sobrenome" do Moodle e a que
 * tem e-mails ou notas.
 */
function findNameColumn(sheet: ParsedSheet, exclude: string[] = []) {
  const candidates = sheet.headers.filter((header) => {
    if (exclude.includes(header)) return false;
    const key = headerKey(header);
    if (key.includes("sobrenome")) return false;
    if (emailWords.some((word) => hasWord(key, word)) || registrationWords.some((word) => hasWord(key, word))) return false;
    return columnHasData(sheet, header) && !looksLikeEmails(sheet, header) && !looksLikeScores(sheet, header);
  });
  return findHeader(candidates, nameWords);
}

/**
 * A coluna da nota, nesta ordem:
 * 1. a que tem o nome da avaliação ("Tarefa:Prova 1 (Real)" para a "Prova 1 de Matemática");
 * 2. a que se chama nota, pontuação... sem ser total ou média;
 * 3. no Moodle, a primeira atividade com nota ("Tarefa:...(Real)"), antes do "Total do curso";
 * 4. total ou média pelo nome;
 * 5. a última coluna com números, de preferência sem ser total ou média.
 */
function guessScoreColumn(sheet: ParsedSheet, identifierColumn: string, titleHint?: string) {
  const { headers } = sheet;
  const candidates = headers.filter((header) => header && header !== identifierColumn);
  const title = titleHint ? ` ${headerKey(titleHint)} ` : "";
  if (title.trim().length >= 3) {
    const byTitle = candidates.find((header) => {
      const key = activityKey(header);
      return key.length >= 3 && !isAggregate(header) && title.includes(` ${key} `) && columnHasData(sheet, header);
    });
    if (byTitle) return byTitle;
  }
  const specific = findHeader(
    headers,
    scoreWords.filter((word) => !aggregateWords.includes(word)),
    [identifierColumn, ...headers.filter(isAggregate)]
  );
  if (specific) return specific;
  const activity = candidates.find(
    (header) => /:/.test(header) && /\(real\)\s*$/i.test(header) && !isAggregate(header) && columnHasData(sheet, header)
  );
  if (activity) return activity;
  const aggregate = findHeader(headers, scoreWords, [identifierColumn]);
  if (aggregate) return aggregate;
  const numeric = [...candidates].reverse().filter((header) => looksLikeScores(sheet, header));
  return numeric.find((header) => !isAggregate(header)) ?? numeric[0] ?? "";
}

/**
 * Palpite das colunas pelo nome do cabeçalho e pelo conteúdo (coluna com @ é e-mail; a nota pela regra de
 * guessScoreColumn). Sem `preferredType`, o aluno é achado pela coluna que tem dados no arquivo, nesta ordem: o
 * e-mail, a matrícula e, por último, o nome (a planilha de outro sistema que só traz o nome e a nota). Sem
 * nenhuma delas, o palpite é o nome (a planilha sem e-mail nem matrícula).
 * `titleHint` é o título da avaliação, para achar a coluna dela num arquivo com várias.
 */
export function guessColumns(sheet: ParsedSheet, preferredType?: IdentifierType, titleHint?: string): ColumnChoice {
  const { headers } = sheet;
  let email = findHeader(headers, emailWords);
  if (!email || !columnHasData(sheet, email)) {
    email = headers.find((header) => looksLikeEmails(sheet, header)) ?? email;
  }
  const registration = findHeader(headers, registrationWords, email ? [email] : []);
  const ids = [email, registration].filter(Boolean);
  const name = findNameColumn(sheet, ids) || findHeader(headers, nameWords, ids);
  const emailFilled = columnHasData(sheet, email);
  const registrationFilled = columnHasData(sheet, registration);
  const nameFilled = columnHasData(sheet, name);
  const identifierType: IdentifierType =
    preferredType ??
    (emailFilled
      ? "email"
      : registrationFilled
        ? "registration"
        : nameFilled
          ? "name"
          : email
            ? "email"
            : registration
              ? "registration"
              : "name");
  const identifierColumn =
    identifierType === "name" ? name : identifierType === "email" ? email || registration : registration || email;
  const scoreColumn = guessScoreColumn(sheet, identifierColumn, titleHint);
  // pelo nome, a coluna do nome já é a do aluno; nos outros, ela fica só para conferir
  const nameColumn = identifierType === "name" || name === scoreColumn ? "" : name;
  return { identifierType, identifierColumn, scoreColumn, nameColumn };
}

/**
 * O que falta para conferir as notas sem perguntar as colunas: "ok" (a coluna do aluno e a da nota têm dados),
 * "student" (não achou a coluna do aluno), "score" (não achou a da nota) ou "empty-score" (a coluna da nota está
 * vazia e nenhuma outra tem notas: a planilha da turma baixada e ainda não preenchida).
 */
export function columnsVerdict(sheet: ParsedSheet, choice: ColumnChoice): "ok" | "student" | "score" | "empty-score" {
  if (!columnHasData(sheet, choice.identifierColumn)) return "student";
  if (!choice.scoreColumn || choice.scoreColumn === choice.identifierColumn) return "score";
  if (!columnHasData(sheet, choice.scoreColumn)) {
    const other = sheet.headers.some(
      (header) => header !== choice.identifierColumn && header !== choice.scoreColumn && looksLikeScores(sheet, header)
    );
    return other ? "score" : "empty-score";
  }
  return "ok";
}

/**
 * Ajusta um mapeamento salvo às colunas deste arquivo. O salvo nunca escolhe uma coluna que não existe ou que está
 * vazia neste arquivo: no lugar dela vem a coluna com dados (a matrícula vazia do Modelo vira o e-mail).
 */
export function fitColumns(sheet: ParsedSheet, saved: GradeImportMapping | null, titleHint?: string): ColumnChoice {
  const auto = guessColumns(sheet, undefined, titleHint);
  if (!saved) return auto;
  const has = (column?: string | null) => Boolean(column) && sheet.headers.includes(column as string);
  const filled = (column?: string | null) => columnHasData(sheet, column);
  // a coluna serve para o tipo: a do e-mail tem @; a da matrícula e a do nome, não
  const fitsType = (column: string, type: IdentifierType) =>
    filled(column) && looksLikeEmails(sheet, column) === (type === "email");

  let identifierType = saved.identifierType;
  let identifierColumn = saved.identifierColumn;
  if (saved.identifierType === "name" && auto.identifierType !== "name") {
    // o nome foi a saída da última planilha; esta tem e-mail ou matrícula, que acham o aluno com mais certeza
    identifierType = auto.identifierType;
    identifierColumn = auto.identifierColumn;
  } else if (!filled(identifierColumn)) {
    const sameType = guessColumns(sheet, saved.identifierType).identifierColumn;
    if (sameType && fitsType(sameType, saved.identifierType)) {
      identifierColumn = sameType;
    } else {
      identifierType = auto.identifierType;
      identifierColumn = auto.identifierColumn;
    }
  }

  // a nota: a salva, se tem dados; senão a do palpite com dados; senão a salva que existe (vazia, o passo Colunas avisa)
  const guessScore = guessColumns(sheet, identifierType, titleHint).scoreColumn;
  const scoreOptions = [saved.scoreColumn, guessScore, auto.scoreColumn].filter(
    (column): column is string => Boolean(column) && column !== identifierColumn
  );
  const scoreColumn =
    scoreOptions.find((column) => filled(column)) ?? scoreOptions.find((column) => has(column)) ?? "";

  const nameColumn =
    identifierType === "name"
      ? undefined
      : [saved.nameColumn, auto.nameColumn, findNameColumn(sheet, [identifierColumn, scoreColumn])].find(
          (column): column is string => Boolean(column) && filled(column) && column !== identifierColumn && column !== scoreColumn
        );
  return { identifierType, identifierColumn, scoreColumn, nameColumn: nameColumn ?? "" };
}

/** O mapping que vai para a API. */
export function toMapping(choice: ColumnChoice): GradeImportMapping {
  return {
    identifierType: choice.identifierType,
    identifierColumn: choice.identifierColumn,
    scoreColumn: choice.scoreColumn,
    nameColumn: choice.identifierType === "name" ? null : choice.nameColumn || null,
  };
}

/**
 * Linhas para o POST: identificador, nome e nota como vieram no arquivo (a API normaliza e aceita "7,5"). Linha
 * com as três células vazias fica de fora (a API também a ignora); célula de nota vazia nunca vira zero.
 */
export function buildImportRows(sheet: ParsedSheet, choice: ColumnChoice): GradeImportRowInput[] {
  const idIndex = sheet.headers.indexOf(choice.identifierColumn);
  const scoreIndex = sheet.headers.indexOf(choice.scoreColumn);
  // pelo nome, a coluna do aluno já é o nome: não vai de novo como "name"
  const nameIndex =
    choice.nameColumn && choice.identifierType !== "name" && choice.nameColumn !== choice.identifierColumn
      ? sheet.headers.indexOf(choice.nameColumn)
      : -1;
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
/* Colunas salvas (localStorage)                                       */
/* ------------------------------------------------------------------ */

const MAPPING_KEY = "agenda.notas.colunas";

/** As colunas usadas na última importação (ou null). */
export function loadSavedMapping(): GradeImportMapping | null {
  try {
    const raw = window.localStorage.getItem(MAPPING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<GradeImportMapping>;
    if (
      (value.identifierType === "email" || value.identifierType === "registration" || value.identifierType === "name") &&
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

/** Guarda as colunas desta importação para a próxima começar por elas. */
export function saveMapping(mapping: GradeImportMapping) {
  try {
    window.localStorage.setItem(MAPPING_KEY, JSON.stringify(mapping));
  } catch {
    // sem localStorage: a próxima importação começa pelo palpite
  }
}

/* ------------------------------------------------------------------ */
/* Planilhas geradas: modelo da turma e linhas rejeitadas (.xlsx)      */
/* ------------------------------------------------------------------ */

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

type TemplateStudent = { email: string; registration?: string | null; fullName: string | null };

const HEADER_STYLE = {
  fontWeight: "bold" as const,
  textColor: "#FFFFFF",
  backgroundColor: "#1F6F43",
  alignVertical: "center" as const,
  height: 24,
};

/** Baixa a planilha montada (a biblioteca só carrega quando a docente pede o arquivo). */
type XlsxSheet = { sheet: string; data: SheetData; columns: { width: number }[]; stickyRowsCount?: number };

async function downloadXlsx(fileName: string, sheets: XlsxSheet[]) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(sheets).toBlob();
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

/** Nome da coluna da nota na planilha modelo ("Nota (0 a 10)"); a importação acha a coluna pela palavra "nota". */
export function templateScoreHeader(maxScoreText: string | null | undefined) {
  return maxScoreText ? `Nota (0 a ${maxScoreText})` : "Nota";
}

/** Colunas da planilha modelo, na ordem em que aparecem. */
export function templateHeaders(students: TemplateStudent[], maxScoreText?: string | null) {
  return [
    "Turma",
    "Aluno",
    "E-mail",
    ...(students.some((student) => student.registration) ? ["Matrícula"] : []),
    templateScoreHeader(maxScoreText),
  ];
}

/**
 * Planilha da turma: na primeira aba, a turma e os alunos ativos (em ordem alfabética) com a nota em branco para
 * preencher; na segunda, a avaliação e como preencher. A Agenda acha o aluno sozinha pelo e-mail que já vem
 * preenchido (a docente nunca digita e-mail), e a matrícula só entra quando a lista traz alguma (a administração).
 */
export async function downloadTemplate(info: GradeEventInfo, students: TemplateStudent[]) {
  const headers = templateHeaders(students, info.maxScoreText);
  const withRegistration = headers.includes("Matrícula");
  const className = info.academicClass?.name ?? "";
  const sorted = [...students].sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email, "pt-BR"));
  const fill = { backgroundColor: "#FFF8DB" };
  const headerRow = headers.map((title) => ({ value: title, ...HEADER_STYLE }));
  const rows: SheetData = sorted.map((student) => [
    className,
    student.fullName ?? "",
    student.email,
    ...(withRegistration ? [student.registration ?? ""] : []),
    // a nota fica em branco, com fundo amarelo, para a docente ver onde escrever
    { type: Number, ...fill },
  ]);
  const date = new Date(info.startsAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const label = { fontWeight: "bold" as const };
  const howTo: SheetData = [
    [{ value: `Notas de ${info.title}`, fontWeight: "bold" as const, fontSize: 14 }],
    [],
    [{ value: "Turma", ...label }, className || "Sem turma"],
    [{ value: "Disciplina", ...label }, info.subject?.name ?? ""],
    [{ value: "Avaliação", ...label }, info.title],
    [{ value: "Data", ...label }, date],
    [{ value: "Vale", ...label }, info.maxScoreText ? `${info.maxScoreText} pontos` : "Ainda sem pontuação"],
    [],
    [{ value: "Como preencher", fontWeight: "bold" as const, fontSize: 13 }],
    ["1. Na aba Notas, escreva a nota de cada aluno na coluna amarela. Vale vírgula ou ponto: 7,5."],
    ["2. Quem não fez a avaliação fica com a nota em branco."],
    ["3. Você só escreve as notas: a Agenda acha cada aluno sozinha, pelos dados que já vêm na planilha."],
    ["4. Salve a planilha e envie em Notas, na avaliação, com Importar notas. Antes de gravar, você confere tudo."],
  ];
  await downloadXlsx(`notas-${fileSlug(className || "turma")}-${fileSlug(info.title)}.xlsx`, [
    {
      sheet: "Notas",
      data: [headerRow, ...rows],
      columns: [{ width: 14 }, { width: 34 }, { width: 34 }, ...(withRegistration ? [{ width: 14 }] : []), { width: 16 }],
      stickyRowsCount: 1,
    },
    { sheet: "Como preencher", data: howTo, columns: [{ width: 14 }, { width: 60 }] },
  ]);
}

/**
 * Planilha das linhas que ficaram de fora da importação, com o motivo de cada uma. A situação e o motivo vêm da
 * prévia (`kindLabel` e `reason`), para a planilha dizer o mesmo que a etiqueta e o chip da tela.
 */
export async function downloadRejected(
  fileName: string,
  rows: GradeImportRow[],
  kindLabel: (row: GradeImportRow) => string,
  reason: (row: GradeImportRow) => string = (row) => row.message ?? ""
) {
  const headers = ["Linha", "Situação", "Aluno na planilha", "Nome na planilha", "Nota na planilha", "Aluno encontrado", "Motivo"];
  await downloadXlsx(fileName, [
    {
      sheet: "Rejeitadas",
      data: [
        headers.map((title) => ({ value: title, ...HEADER_STYLE })),
        ...rows.map((row) => [
          row.rowNumber ?? "",
          kindLabel(row),
          row.identifier ?? "",
          row.nameHint ?? "",
          row.rawScore ?? "",
          row.student?.fullName ?? "",
          reason(row),
        ]),
      ],
      columns: [{ width: 8 }, { width: 22 }, { width: 32 }, { width: 28 }, { width: 14 }, { width: 28 }, { width: 50 }],
      stickyRowsCount: 1,
    },
  ]);
}
