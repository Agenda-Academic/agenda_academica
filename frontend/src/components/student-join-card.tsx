"use client";

import { CircleAlert, Hourglass, Loader2, LogIn, Users } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { conflictOf, joinClass } from "@/lib/api";
import { cx, errorMessage, fieldErrors, formatDateBR, formatTime, normalizeCode, retryAfterText } from "@/lib/format";
import type { AcademicClass, Enrollment, JoinClassResult } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { delay } from "./dashboard-bits";

/**
 * Card "Entrar em uma turma" do Painel do aluno sem matrícula ativa (desenho 5.5, amostra aluno-entrar-turma):
 * campo do código já focado, POST /enrollments/join (joinClass), "Você entrou em TADS 5" (aviso embaixo, e o
 * Painel passa a mostrar a turma) ou "Pedido enviado para TADS 5. A docente ou a secretaria confirma." (o status
 * do pedido fica visível no card). Código ruim: a frase única da API abaixo do campo; 429: o tempo de espera.
 * Depois de entrar, useAppActions().reload(). Dona: área Aluno (renderiza em dashboard-student.tsx).
 *
 * O mesmo campo (JoinCodeField com useJoinClass) serve ao painel lateral "Entrar em outra turma", que o Painel
 * de quem já tem turma abre por um link discreto.
 */
export type StudentJoinCardProps = {
  /** Pedidos de entrada ainda sem decisão (context.pendingEnrollments): mostre o status no card. */
  pendingEnrollments?: Enrollment[];
  /** Foca o campo do código ao montar (padrão: sim, quando o card é o principal do Painel). */
  autoFocus?: boolean;
  /** Posição na animação de entrada do Painel (delay). */
  order?: number;
  /** Entrou ou pediu para entrar (a página já recarrega pelo reload do card). */
  onJoined?: (result: JoinClassResult) => void;
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDayTime(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "hoje, 14:20", "ontem, 14:20" ou "em 04/11/2026, 14:20". */
function sentWhen(value: string, now: number) {
  const day = startOfDayTime(new Date(value).getTime());
  const today = startOfDayTime(now);
  if (day === today) {
    return `hoje, ${formatTime(value)}`;
  }
  if (day === today - DAY) {
    return `ontem, ${formatTime(value)}`;
  }
  return `em ${formatDateBR(value)}, ${formatTime(value)}`;
}

/** Frase do 429: o tempo de espera vem do retryAfter do corpo (o CORS não expõe o cabeçalho). */
function tooManyText(seconds: number) {
  return `Muitas tentativas com código errado. ${retryAfterText(seconds)}`;
}

/* ------------------------------------------------------------------ */
/* Estado do campo do código (card e painel lateral)                   */
/* ------------------------------------------------------------------ */

export type JoinClassState = {
  code: string;
  setCode: (value: string) => void;
  /** Erro para mostrar abaixo do campo (validação, a frase da API ou o tempo de espera do 429). */
  error: string | null;
  busy: boolean;
  /** Envia o código. Devolve o resultado (já com a página recarregada) ou null, com o erro no campo. */
  submit: () => Promise<JoinClassResult | null>;
};

/**
 * Envia o código da turma (POST /enrollments/join). O que foi digitado nunca é apagado num erro. Depois de um
 * 429, novas tentativas esperam o tempo que a API pediu sem gastar outra tentativa.
 */
export function useJoinClass(): JoinClassState {
  const { token, reload } = useAppActions();
  const [code, setCodeValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blockedUntil = useRef(0);

  function setCode(value: string) {
    setCodeValue(value);
    setError(null);
  }

  async function submit() {
    if (busy) {
      return null;
    }
    const clean = normalizeCode(code);
    if (!clean) {
      setError("Digite o código da turma. Ele tem 8 letras e números, como H4TR-92QK.");
      return null;
    }
    if (!/^[0-9A-Z]{8}$/.test(clean)) {
      setError("O código tem 8 letras e números, como H4TR-92QK. Confira o que a docente ou a secretaria passou.");
      return null;
    }
    const wait = blockedUntil.current - Date.now();
    if (wait > 0) {
      setError(tooManyText(wait / 1000));
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await joinClass(token, clean);
      setCodeValue("");
      // a turma nova (ou o pedido) aparece no Painel: contexto, eventos e avisos de novo
      await reload();
      return result;
    } catch (err) {
      const limit = conflictOf(err, "TOO_MANY_ATTEMPTS");
      if (limit) {
        const seconds = limit.retryAfter ?? 900;
        blockedUntil.current = Date.now() + seconds * 1000;
        setError(tooManyText(seconds));
      } else {
        // 422 do código: sempre a mesma frase da API ("Código inválido ou expirado. Confira com quem passou o código.")
        setError(fieldErrors(err).code ?? errorMessage(err));
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { code, setCode, error, busy, submit };
}

/**
 * Rótulo, campo do código, ajuda e erro (abaixo do campo). Com `inline`, o botão Entrar fica ao lado do campo
 * (card do Painel); sem ele, o botão é o do rodapé do painel lateral (form do mesmo id).
 */
export function JoinCodeField({
  inline,
  inputRef,
  join,
}: {
  inline?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  join: JoinClassState;
}) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  return (
    <div className="aluno-join-field">
      <label className="lbl" htmlFor={inputId}>
        Código da turma
      </label>
      <div className="aluno-join-row">
        <input
          ref={inputRef}
          id={inputId}
          className="input aluno-code-input"
          value={join.code}
          onChange={(event) => join.setCode(event.target.value)}
          placeholder="Ex.: H4TR-92QK"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={16}
          aria-invalid={join.error ? true : undefined}
          aria-describedby={join.error ? `${errorId} ${helpId}` : helpId}
        />
        {inline ? <JoinSubmitButton busy={join.busy} /> : null}
      </div>
      {join.error ? (
        <p className="field-error" id={errorId}>
          <CircleAlert aria-hidden />
          <span>{join.error}</span>
        </p>
      ) : null}
      <p className="field-help" id={helpId}>
        Peça o código à docente ou à secretaria.
      </p>
    </div>
  );
}

/** Botão Entrar: enquanto envia, continua focável (aria-disabled) e mostra o giro. */
export function JoinSubmitButton({ busy, form }: { busy: boolean; form?: string }) {
  return (
    <button
      className="btn btn-p shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
      aria-disabled={busy || undefined}
      form={form}
      type="submit"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
      {busy ? "Entrando" : "Entrar"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Status do pedido                                                    */
/* ------------------------------------------------------------------ */

/** Pedido de entrada ainda sem decisão: "Pedido enviado para TADS 5. A docente ou a secretaria confirma." */
export function PendingEnrollmentNotice({
  academicClass,
  className,
  compact,
  now,
  sentAt,
}: {
  academicClass: Pick<AcademicClass, "name">;
  className?: string;
  /** Versão do card da turma (coluna estreita): sem a pílula e com a data só. */
  compact?: boolean;
  /** "Agora" fixado por quem renderiza (para dizer "hoje" ou "ontem"). */
  now: number;
  sentAt?: string | null;
}) {
  const when = [
    sentAt ? `Enviado ${sentWhen(sentAt, now)}.` : null,
    compact ? null : "A turma aparece aqui no Painel quando confirmarem.",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cx("callout blue aluno-pending", compact && "compact", className)}>
      <span className="aluno-pending-ico" aria-hidden>
        <Hourglass className="h-[18px] w-[18px]" />
      </span>
      <p className="aluno-pending-tx">
        <b>Pedido enviado para {academicClass.name}.</b> A docente ou a secretaria confirma.
        {when ? <span className="aluno-pending-when">{when}</span> : null}
      </p>
      {compact ? null : <span className="pill st-alt">Aguardando</span>}
    </div>
  );
}

/** Pedidos do contexto mais o que acabou de ser enviado (até o contexto recarregado trazê-lo). */
export function pendingList(
  pendingEnrollments: Enrollment[],
  sent: { result: JoinClassResult; at: string } | null
) {
  const items = pendingEnrollments
    .filter((enrollment) => enrollment.academicClass)
    .map((enrollment) => ({
      id: enrollment.id,
      academicClass: enrollment.academicClass as AcademicClass,
      sentAt: enrollment.createdAt ?? null,
    }));
  if (
    sent &&
    sent.result.enrollment.status === "pending" &&
    !items.some((item) => item.id === sent.result.enrollment.id || item.academicClass.id === sent.result.academicClass.id)
  ) {
    items.unshift({ id: sent.result.enrollment.id, academicClass: sent.result.academicClass, sentAt: sent.at });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Card do Painel                                                      */
/* ------------------------------------------------------------------ */

export function StudentJoinCard({ autoFocus = true, order = 0, pendingEnrollments = [], onJoined }: StudentJoinCardProps) {
  const { toast } = useAppActions();
  const join = useJoinClass();
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  // "agora" fixado na montagem (render precisa ser puro): serve para o "Enviado hoje, 14:20"
  const [now] = useState(() => Date.now());
  const [sent, setSent] = useState<{ result: JoinClassResult; at: string } | null>(null);
  // frase do último envio para o leitor de tela (a região fica sempre montada)
  const [announce, setAnnounce] = useState("");

  // o campo já vem focado (desenho 5.5); não tira o foco de um diálogo aberto nem de algo que a pessoa focou
  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      const free = !active || active === document.body || active.tagName === "H1";
      if (free && !document.querySelector('[aria-modal="true"]')) {
        inputRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = await join.submit();
    if (!result) {
      inputRef.current?.focus();
      return;
    }
    onJoined?.(result);
    const name = result.academicClass?.name ?? "a turma";
    if (result.enrollment.status === "active") {
      // o card sai do Painel (a turma aparece no lugar dele): o aviso embaixo diz o que houve
      toast(result.message || `Você entrou em ${name}.`, { key: "entrar-turma" });
      return;
    }
    setSent({ result, at: new Date().toISOString() });
    setAnnounce(result.message || `Pedido enviado para ${name}. A docente ou a secretaria confirma.`);
  }

  const pending = pendingList(pendingEnrollments, sent);

  return (
    <section className="hero aluno-join rise" style={delay(order)} aria-labelledby={titleId}>
      <span className="aluno-join-ico" aria-hidden>
        <Users />
      </span>
      <div className="aluno-join-body">
        <h2 className="hero-title" id={titleId}>
          Entrar em uma turma
        </h2>
        <p className="aluno-join-sub">Com o código, as provas, os trabalhos e as aulas da turma aparecem aqui no Painel.</p>
        <form className="aluno-join-form" onSubmit={handleSubmit} noValidate>
          <JoinCodeField inline inputRef={inputRef} join={join} />
        </form>
      </div>
      {pending.length ? (
        <div className="aluno-join-status">
          {pending.map((item) => (
            <PendingEnrollmentNotice key={item.id} academicClass={item.academicClass} now={now} sentAt={item.sentAt} />
          ))}
        </div>
      ) : null}
      <p className="sr-only" role="status">
        {announce}
      </p>
    </section>
  );
}
