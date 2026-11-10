"use client";

import { Check, Copy, Printer } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getClassStudents, getStudentGuardians, searchUsers, updateEnrollment } from "@/lib/api";
import { cx, firstName, formatDateBR } from "@/lib/format";
import type { EnrollmentStatus } from "@/lib/types";
import { secondaryButton } from "./ui";

/**
 * Peças comuns da tela Turmas e disciplinas (área Admin): o que vai no painel lateral, o carregamento com
 * guarda (a resposta antiga não pisa na nova), o rodapé do painel e textos de contagem.
 */

/* ------------------------------------------------------------------ */
/* Painel lateral: o que está aberto e como trocar o conteúdo          */
/* ------------------------------------------------------------------ */

/** Campos do formulário da turma, como a pessoa digita (texto): o rascunho fica guardado ao trocar o painel. */
export type ClassDraft = {
  courseId: string;
  name: string;
  year: string;
  semester: string;
  shift: string;
  period: string;
};

export type SubjectDraft = {
  code: string;
  name: string;
  workloadHours: string;
};

/**
 * O que o painel mostra. Um painel por vez: "Adicionar disciplina", "Vincular docente", "Adicionar alunos",
 * "Nova disciplina" e o aluno trocam o conteúdo e o Voltar volta ao anterior, com o rascunho dele.
 */
export type PanelView =
  | { kind: "class"; classId: number; draft?: ClassDraft; dirty?: boolean; showAll?: boolean; showOthers?: boolean }
  | { kind: "newClass"; draft?: ClassDraft; dirty?: boolean }
  | { kind: "subject"; subjectId: number; draft?: SubjectDraft; dirty?: boolean }
  | { kind: "newSubject"; offerTo?: number; draft?: SubjectDraft; dirty?: boolean }
  | { kind: "addOffer"; classId: number; added?: number[] }
  | { kind: "offer"; classId: number; subjectId: number }
  | { kind: "addStudents"; classId: number; text?: string; dirty?: boolean }
  | { kind: "student"; classId: number | null; userId: number; name?: string };

/** O que cada conteúdo do painel recebe para trocar de conteúdo, fechar e avisar a tela. */
export type PanelApi = {
  /** Abre outro conteúdo por cima deste (Voltar volta). returnKey: o data-return do botão que abriu. */
  push: (view: PanelView, returnKey?: string) => void;
  /** Volta ao conteúdo anterior (ou fecha, se não houver). */
  back: () => void;
  /** Fecha o painel (sem perguntar). */
  close: () => void;
  /** Cancelar do rodapé: fecha o painel, perguntando antes se há rascunho (como o X e o Esc). */
  cancel: () => void;
  /**
   * Excluiu a turma ou a disciplina: fecha o painel e, quando a linha sai da lista, o foco vai para "Nova
   * turma" ou "Nova disciplina" (não cai no body).
   */
  removed: (kind: "class" | "subject") => void;
  /** Troca este conteúdo por outro, sem Voltar para ele (ex.: depois de restaurar a turma arquivada). */
  replace: (view: PanelView) => void;
  /** Atualiza o rascunho deste conteúdo (fica guardado ao trocar de conteúdo e voltar). */
  setView: (view: PanelView) => void;
  /** Título do painel (ex.: o nome da turma, quando chega da API). */
  setTitle: (title: string) => void;
  /** Ocupado: Esc, clique fora e o X não fecham. */
  setBusy: (busy: boolean) => void;
  /**
   * Algo mudou na turma, na disciplina ou no aluno (ou um Desfazer rodou): a tela recarrega as listas e tudo o
   * que o painel aberto mostra, mesmo quando quem chama é o Desfazer de um conteúdo que já saiu do painel.
   */
  changed: (options?: { catalog?: boolean }) => void;
  /** Salvou e fechou: a tela mostra a linha com "Salvo agora". */
  saved: (row: string) => void;
  /** Há conteúdo anterior (mostra Voltar). */
  canGoBack: boolean;
  /** Onde o rodapé do conteúdo entra (PanelFooter). */
  footer: HTMLElement | null;
};

/** Rodapé do conteúdo atual do painel (entra no pé fixo do Drawer). */
export function PanelFooter({ api, children }: { api: PanelApi; children: ReactNode }) {
  return api.footer ? createPortal(children, api.footer) : null;
}

/* ------------------------------------------------------------------ */
/* Carregamento                                                        */
/* ------------------------------------------------------------------ */

/**
 * Guarda das respostas por chave, fora do React: ao voltar para um conteúdo do painel, o que já veio aparece
 * na hora (sem esqueleto) enquanto a versão nova chega.
 */
const remoteCache = new Map<string, unknown>();

/**
 * Quem mostra cada chave agora (o painel e a lista podem mostrar a mesma, como os alunos da turma). Toda
 * resposta nova chega a todos eles: o Desfazer de um aviso antigo, que roda depois que o conteúdo dele saiu do
 * painel, atualiza o que está na tela agora.
 */
type RemoteWatcher = { load: () => Promise<unknown>; show: (data: unknown) => void };
const remoteWatchers = new Map<string, Set<RemoteWatcher>>();
/** Ordem das buscas: a resposta de uma busca mais velha que chega depois da mais nova é descartada. */
let remoteSeq = 0;
const remoteShown = new Map<string, number>();
/** Buscas da mesma chave pedidas no mesmo instante (recarregar a turma e a tela juntas) viram uma só. */
const remoteBatch = new Map<string, Promise<unknown>>();

function fetchRemote(key: string, load: () => Promise<unknown>) {
  const batched = remoteBatch.get(key);
  if (batched) {
    return batched;
  }
  remoteSeq += 1;
  const seq = remoteSeq;
  const promise = load().then((data) => {
    if ((remoteShown.get(key) ?? 0) < seq) {
      remoteShown.set(key, seq);
      remoteCache.set(key, data);
      remoteWatchers.get(key)?.forEach((watcher) => watcher.show(data));
    }
    return data;
  });
  if (!remoteBatch.size) {
    void Promise.resolve().then(() => remoteBatch.clear());
  }
  remoteBatch.set(key, promise);
  return promise;
}

/**
 * Busca de novo tudo o que está na tela com chave que começa com `prefix` (ex.: "admin:"): a lista, o painel
 * aberto e o card Pendências. Uma busca por chave.
 */
export function refreshRemotes(prefix: string) {
  const keys = Array.from(remoteWatchers.keys()).filter((key) => key.startsWith(prefix));
  return Promise.all(
    keys.map((key) => {
      const first = remoteWatchers.get(key)?.values().next().value;
      return first ? fetchRemote(key, first.load).catch(() => null) : null;
    })
  );
}

export type Remote<T> = {
  data: T | null;
  error: unknown;
  /** Primeira carga desta chave, sem nada guardado: mostre o esqueleto. */
  loading: boolean;
  /** Busca de novo; devolve o dado novo (ou null se falhou). */
  reload: () => Promise<T | null>;
};

/**
 * Carrega `load` quando `key` muda (null: não carrega). A resposta de uma chave antiga é descartada, e a de uma
 * busca mais velha que chega depois da mais nova também. Erro com dado já na tela: o dado continua, e o erro
 * fica em `error`.
 */
export function useRemote<T>(key: string | null, load: () => Promise<T>): Remote<T> {
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });
  const [result, setResult] = useState<{ key: string | null; data: T | null; error: unknown }>(() => ({
    key,
    data: key ? ((remoteCache.get(key) as T | undefined) ?? null) : null,
    error: null,
  }));
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    keyRef.current = key;
  });

  useEffect(() => {
    if (!key) {
      return;
    }
    let alive = true;
    const watcher: RemoteWatcher = {
      load: () => loadRef.current(),
      show: (data) => {
        if (alive) {
          setResult({ key, data: data as T, error: null });
        }
      },
    };
    const watchers = remoteWatchers.get(key) ?? new Set<RemoteWatcher>();
    watchers.add(watcher);
    remoteWatchers.set(key, watchers);
    fetchRemote(key, watcher.load).catch((error: unknown) => {
      if (alive) {
        setResult((prev) => ({ key, data: prev.key === key ? prev.data : null, error }));
      }
    });
    return () => {
      alive = false;
      watchers.delete(watcher);
      if (!watchers.size) {
        remoteWatchers.delete(key);
      }
    };
  }, [key]);

  async function reload() {
    const current = keyRef.current;
    if (!current) {
      return null;
    }
    try {
      return (await fetchRemote(current, () => loadRef.current())) as T;
    } catch (error) {
      if (keyRef.current === current) {
        setResult((prev) => ({ key: current, data: prev.key === current ? prev.data : null, error }));
      }
      return null;
    }
  }

  const same = result.key === key;
  const cached = key && !same ? ((remoteCache.get(key) as T | undefined) ?? null) : null;
  const data = same ? result.data : cached;
  return {
    data,
    error: same ? result.error : null,
    loading: Boolean(key) && data === null && !(same && result.error),
    reload,
  };
}

/** Esquece o guardado de uma chave (ex.: depois de excluir). */
export function forgetRemote(prefix: string) {
  for (const key of Array.from(remoteCache.keys())) {
    if (key.startsWith(prefix)) {
      remoteCache.delete(key);
    }
  }
}

/** O valor depois de `ms` sem mudar (busca enquanto digita). */
export function useDebounced<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/* ------------------------------------------------------------------ */
/* Textos                                                              */
/* ------------------------------------------------------------------ */

/** "a", "a e b", "a, b e c". */
export function joinPt(parts: string[]) {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** "1 aluno", "2 alunos". */
export function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Iniciais do avatar, como na amostra: a primeira letra do primeiro e do último nome ("Prof. Rafael Lima" vira
 * "RL"); com um nome só, as duas primeiras letras dele ("Profa. Maraísa" vira "MA"). O "Prof." e o "Profa." não
 * contam.
 */
export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "")
    .replace(/^(profa?\.|prof\.)\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part.replace(/[^\p{L}\p{N}]/gu, "")))
    .filter((letters) => letters.length);
  if (!parts.length) {
    return "?";
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  const pair = parts.length > 1 ? `${first[0]}${last[0]}` : first.slice(0, 2).join("");
  return pair.toLocaleUpperCase("pt-BR");
}

/** E-mail com cara de e-mail (a API confere de novo): algo@algo.algo, sem espaço. */
const EMAIL_SHAPE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export type EmailLines = {
  /** Os e-mails, sem repetidos (sem diferença de maiúsculas), na ordem em que vieram. */
  emails: string[];
  /** Linhas que não são um e-mail: o número da linha (a partir de 1) e o texto dela. */
  invalid: Array<{ line: number; text: string }>;
};

/**
 * Lista de e-mails colada, um por linha: cada linha é um item (uma linha "sem arroba" é um item só, e
 * inválido). Linhas em branco não contam. "Ana Rocha <ana@agenda.test>" vale como ana@agenda.test.
 */
export function parseEmailLines(text: string): EmailLines {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: EmailLines["invalid"] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      return;
    }
    const inside = /<([^<>]+)>\s*$/.exec(line)?.[1]?.trim();
    const email = inside ?? line;
    if (!EMAIL_SHAPE.test(email)) {
      invalid.push({ line: index + 1, text: line });
      return;
    }
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      emails.push(email);
    }
  });
  return { emails, invalid };
}

/** Erro do campo de e-mails: a linha e o texto dela ("A linha 3 não é um e-mail: "sem arroba"."). */
export function invalidLinesText(invalid: EmailLines["invalid"]) {
  if (!invalid.length) {
    return null;
  }
  const shown = invalid.slice(0, 3).map((item) => `linha ${item.line}, "${item.text}"`);
  const more = invalid.length > 3 ? ` e mais ${plural(invalid.length - 3, "linha", "linhas")}` : "";
  if (invalid.length === 1) {
    return `A linha ${invalid[0].line} não é um e-mail: "${invalid[0].text}". Corrija ou apague a linha e tente de novo.`;
  }
  return `Estas linhas não são e-mails: ${joinPt(shown)}${more}. Corrija ou apague as linhas e tente de novo.`;
}

/* ------------------------------------------------------------------ */
/* Desfazer da matrícula                                               */
/* ------------------------------------------------------------------ */

export type EnrollmentUndo = {
  enrollmentId: number;
  /** O status que a ação deixou (o Desfazer só vale se a matrícula ainda estiver nele). */
  now: EnrollmentStatus;
  /** O status de antes, para onde o Desfazer volta. */
  before: EnrollmentStatus;
};

/**
 * Desfazer de aprovar, recusar, remover, concluir ou reativar: só volta a matrícula que continua como a ação
 * deixou. Se ela mudou depois (outra ação mais nova), fica como está e conta em `skipped`.
 */
export async function undoEnrollments(token: string, classId: number, changes: EnrollmentUndo[]) {
  const roster = await getClassStudents(token, classId);
  const still = changes.filter(
    (change) => roster.find((student) => student.enrollmentId === change.enrollmentId)?.status === change.now
  );
  await Promise.all(still.map((change) => updateEnrollment(token, change.enrollmentId, { status: change.before })));
  return { undone: still.length, skipped: changes.length - still.length };
}

/* ------------------------------------------------------------------ */
/* Curso integrado: quem entra passa a contar como menor de idade       */
/* ------------------------------------------------------------------ */

export type AdultInfo = {
  name: string;
  email?: string;
  /**
   * Vínculos de responsável que voltam a esperar a aprovação (ativos, do código do aluno e nunca aprovados pela
   * secretaria). null quando não deu para saber.
   */
  links: number | null;
};

/** Os vínculos que voltam a pendente quando o aluno passa a ser menor (regra da API, "Aluno que passa a ser menor"). */
export async function linksBackToPending(token: string, studentId: number) {
  const data = await getStudentGuardians(token, studentId);
  return {
    isMinor: data.student.isMinor,
    links: data.guardians.filter((link) => link.status === "active" && link.origin === "student_code" && !link.approvedAt)
      .length,
  };
}

/**
 * Antes de incluir uma lista de e-mails numa turma do curso integrado: quem já tem conta de aluno e hoje conta
 * como adulto (GET /users?role=student e GET /students/:id/guardians). Uma conta que não deu para conferir entra
 * na lista com `links: null`; uma falha geral devolve null (a tela avisa sem os nomes).
 */
export async function findAdultStudents(token: string, emails: string[]): Promise<AdultInfo[] | null> {
  const found: AdultInfo[] = [];
  let failed = false;
  const queue = [...emails];
  async function worker() {
    for (let email = queue.shift(); email !== undefined; email = queue.shift()) {
      try {
        const people = await searchUsers(token, { role: "student", q: email });
        const person = people.find((item) => item.email.toLowerCase() === email.toLowerCase());
        if (!person) {
          continue;
        }
        try {
          const state = await linksBackToPending(token, person.id);
          if (!state.isMinor) {
            found.push({ name: person.fullName ?? person.email, email: person.email, links: state.links });
          }
        } catch {
          found.push({ name: person.fullName ?? person.email, email: person.email, links: null });
        }
      } catch {
        failed = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, emails.length) }, worker));
  return failed && !found.length ? null : found;
}

/**
 * Aviso antes de deixar alunos adultos ativos numa turma do curso integrado: eles passam a contar como menores
 * de idade, e os vínculos de responsável sem aprovação voltam a esperar a secretaria.
 */
export function minorWarning(adults: AdultInfo[] | null, className: string, verb: "incluir" | "aprovar" | "reativar") {
  const known = adults ?? [];
  const links = known.every((item) => item.links !== null)
    ? known.reduce((sum, item) => sum + (item.links ?? 0), 0)
    : null;
  const intro = `A ${className} é do curso integrado: quem fica ativo nela passa a contar como menor de idade.`;
  const linksText =
    links === null
      ? "Os vínculos de responsável que a secretaria ainda não aprovou voltam a esperar a aprovação, e esses responsáveis deixam de ver a agenda até lá."
      : links > 0
        ? `${plural(links, "vínculo de responsável volta", "vínculos de responsável voltam")} a esperar a aprovação da secretaria, e ${links === 1 ? "o responsável deixa" : "os responsáveis deixam"} de ver a agenda até lá.`
        : "Daqui para a frente, cada responsável novo só vê a agenda depois da aprovação da secretaria.";
  const action = verb === "incluir" ? "Incluir" : verb === "aprovar" ? "Aprovar" : "Reativar";
  if (!adults) {
    return {
      title: `${action} na turma do curso integrado?`,
      message: `${intro} Quem hoje conta como adulto muda. ${linksText}`,
    };
  }
  const names = known.map((item) => item.name);
  const title =
    known.length === 1
      ? `${action} ${firstName(names[0])} como menor de idade?`
      : `${action} ${known.length} alunos adultos como menores de idade?`;
  const who =
    known.length === 1 ? `${names[0]} hoje conta como adulto.` : `${joinPt(names)} hoje contam como adultos.`;
  return { title, message: `${intro} ${who} ${linksText}` };
}

/* ------------------------------------------------------------------ */
/* Código: copiar e imprimir                                           */
/* ------------------------------------------------------------------ */

/** Copia o texto e mostra "Copiado" por 2 s (o leitor de tela ouve pelo role="status"). */
export function CopyButton({ text, label = "Copiar", small = true }: { text: string; label?: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied && !failed) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [copied, failed]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <button className={cx(secondaryButton, small && "btn-sm")} onClick={() => void copy()} type="button">
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? "Copiado" : label}
      </button>
      <span className="sr-only" role="status">
        {copied ? "Código copiado." : failed ? "Não deu para copiar. Selecione o código e copie." : ""}
      </span>
    </>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Imprime só o código (num quadro escondido, sem abrir janela nova): o nome do aluno, o código, o prazo e o
 * que fazer com ele.
 */
export function printGuardianCode(input: { studentName: string; code: string; expiresAt: string }) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.right = "0";
  frame.style.bottom = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Código para responsável</title>
<style>
body{font-family:"Open Sans",system-ui,sans-serif;color:#101828;margin:48px}
h1{font-size:22px;margin:0 0 8px}
p{font-size:15px;line-height:1.6;margin:0 0 12px}
.code{font-family:ui-monospace,monospace;font-size:40px;font-weight:700;letter-spacing:.12em;border:2px dashed #17803f;border-radius:16px;padding:20px 28px;display:inline-block;margin:16px 0}
</style></head><body>
<h1>Agenda Acadêmica: código para responsável</h1>
<p>Aluno: <strong>${escapeHtml(input.studentName)}</strong></p>
<div class="code">${escapeHtml(input.code)}</div>
<p>Vale até ${escapeHtml(formatDateBR(input.expiresAt))} e uma vez só.</p>
<p>Crie sua conta de responsável na Agenda Acadêmica, entre e digite este código no card Vincular aluno.</p>
<p>Entregue este papel só ao responsável do aluno.</p>
</body></html>`);
  doc.close();
  const cleanup = () => window.setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(() => {
    win.focus();
    win.print();
    // navegadores que não disparam afterprint: o quadro sai depois de um tempo
    window.setTimeout(() => frame.remove(), 60_000);
  }, 50);
}

/** Botão Imprimir do código. */
export function PrintButton({ onPrint }: { onPrint: () => void }) {
  return (
    <button className={cx(secondaryButton, "btn-sm")} onClick={onPrint} type="button">
      <Printer className="h-4 w-4" aria-hidden />
      Imprimir
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Esqueleto de linhas                                                 */
/* ------------------------------------------------------------------ */

export function SkeletonRows({ rows = 3, label = "Carregando" }: { rows?: number; label?: string }) {
  return (
    <div className="admin-skel" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="admin-skel-row">
          <span className="skel h-9 w-9 shrink-0 !rounded-xl" />
          <span className="grid flex-1 gap-2">
            <span className="skel h-3.5 w-2/3" />
            <span className="skel h-3 w-1/2" />
          </span>
        </span>
      ))}
    </div>
  );
}

/** Lembra o último curso e o último período usados ao criar turma (WCAG 3.3.7). Sem armazenamento, nada. */
const LAST_CLASS_KEY = "agenda.admin.ultimaTurma";

export function readLastClass(): Partial<ClassDraft> | null {
  try {
    const raw = window.localStorage.getItem(LAST_CLASS_KEY);
    return raw ? (JSON.parse(raw) as Partial<ClassDraft>) : null;
  } catch {
    return null;
  }
}

export function writeLastClass(draft: ClassDraft) {
  try {
    const { courseId, year, semester, shift, period } = draft;
    window.localStorage.setItem(LAST_CLASS_KEY, JSON.stringify({ courseId, year, semester, shift, period }));
  } catch {
    // sem armazenamento (janela anônima): na próxima vez, vale a turma mais nova da lista
  }
}
