"use client";

import { Check, Copy, Printer } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx, formatDateBR } from "@/lib/format";
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
  | { kind: "class"; classId: number; draft?: ClassDraft; dirty?: boolean; showAll?: boolean }
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
  /** Troca este conteúdo por outro, sem Voltar para ele (ex.: depois de restaurar a turma arquivada). */
  replace: (view: PanelView) => void;
  /** Atualiza o rascunho deste conteúdo (fica guardado ao trocar de conteúdo e voltar). */
  setView: (view: PanelView) => void;
  /** Título do painel (ex.: o nome da turma, quando chega da API). */
  setTitle: (title: string) => void;
  /** Ocupado: Esc, clique fora e o X não fecham. */
  setBusy: (busy: boolean) => void;
  /** Algo mudou na turma, na disciplina ou no aluno: a tela recarrega as listas. */
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

export type Remote<T> = {
  data: T | null;
  error: unknown;
  /** Primeira carga desta chave, sem nada guardado: mostre o esqueleto. */
  loading: boolean;
  /** Busca de novo; devolve o dado novo (ou null se falhou). */
  reload: () => Promise<T | null>;
};

/**
 * Carrega `load` quando `key` muda (null: não carrega). A resposta de uma chave antiga é descartada. Erro com
 * dado já na tela: o dado continua, e o erro fica em `error`.
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
    loadRef.current().then(
      (data) => {
        if (alive) {
          remoteCache.set(key, data);
          setResult({ key, data, error: null });
        }
      },
      (error: unknown) => {
        if (alive) {
          setResult((prev) => ({ key, data: prev.key === key ? prev.data : null, error }));
        }
      }
    );
    return () => {
      alive = false;
    };
  }, [key]);

  async function reload() {
    const current = keyRef.current;
    if (!current) {
      return null;
    }
    try {
      const data = await loadRef.current();
      if (keyRef.current === current) {
        remoteCache.set(current, data);
        setResult({ key: current, data, error: null });
      }
      return data;
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

const dependentNames: Record<string, [string, string]> = {
  enrollments: ["matrícula", "matrículas"],
  invites: ["convite", "convites"],
  events: ["evento", "eventos"],
  offers: ["disciplina", "disciplinas"],
  teachingAssignments: ["vínculo de docente", "vínculos de docente"],
  classes: ["turma", "turmas"],
  activeClasses: ["turma ativa", "turmas ativas"],
  grades: ["nota", "notas"],
};

/** O que impede a exclusão (409 HAS_DEPENDENTS): "1 matrícula, 3 eventos e 4 disciplinas". Vazio: null. */
export function dependentsText(counts?: Record<string, number> | null) {
  if (!counts) {
    return null;
  }
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const names = dependentNames[key];
      return names ? plural(count, names[0], names[1]) : null;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length ? joinPt(parts) : null;
}

/** Iniciais do nome ("Diogo Queiroz da Silva" vira "DS"). */
export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "").replace(/^(profa?\.|prof\.)\s+/i, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return "?";
  }
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** Lista de e-mails colada (um por linha; vírgula, ponto e vírgula e espaço também separam), sem repetidos. */
export function parseEmails(text: string) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim().replace(/^<|>$/g, "");
    const key = email.toLowerCase();
    if (email && !seen.has(key)) {
      seen.add(key);
      list.push(email);
    }
  }
  return list;
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
