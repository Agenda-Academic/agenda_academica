"use client";

import { CheckCircle2, Clock, Info, Link2, Loader2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { claimGuardianLink, conflictOf } from "@/lib/api";
import {
  cx,
  fieldErrors,
  firstName,
  formatDateBR,
  normalizeCode,
  relationshipText,
  retryAfterText,
} from "@/lib/format";
import { relationshipOptions } from "@/lib/meta";
import type { ClaimLinkResult, GuardianRelationship, LinkedStudent } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { delay } from "./dashboard-bits";
import { GuardianDataDialog, GuardianDataView } from "./guardian-data-dialog";
import { Field } from "./ui";

/**
 * Card "Vincular aluno" (desenho 5.6, amostra responsavel-vincular): é tudo o que o Painel do responsável sem
 * vínculo ativo mostra. Campo do código (focado), parentesco e o texto "Peça o código ao aluno, no perfil dele,
 * ou à secretaria do campus". POST /guardian-links/claim (claimGuardianLink):
 * - vínculo ativo: toast com a frase da API ("Agora você acompanha Diogo.");
 * - aluno menor: a frase da API fica no card ("Pedido enviado. A secretaria confirma...") e o pedido aparece em
 *   "Aguardando a secretaria";
 * - 422 (código ruim, sempre a mesma frase), 409 LINK_LIMIT e 429 (com o tempo de espera) abaixo do campo.
 * Depois, onLinked (a página recarrega) ou, sem ele, useAppActions().reload().
 *
 * variant "panel": o mesmo formulário dentro do painel lateral "Acompanhar outro aluno" do Painel (sem a casca do
 * card e sem o título, que ficam no Drawer). Dona: área Responsável.
 */
export type GuardianLinkCardProps = {
  /** Vínculos pendentes (aguardando a secretaria): aparecem com o nome do aluno. */
  pendingStudents: LinkedStudent[];
  /** Posição na animação de entrada do Painel (delay). */
  order?: number;
  /** Vinculou (ou pediu): quem monta recarrega. Sem ele, o card chama useAppActions().reload(). */
  onLinked?: (result: ClaimLinkResult) => void;
  /** "card" (padrão): o card do Painel. "panel": só o conteúdo, para o painel lateral. */
  variant?: "card" | "panel";
  /** Foca o campo do código ao aparecer (padrão: só no card). No painel, o Drawer já foca o primeiro campo. */
  autoFocus?: boolean;
};

const CODE_LENGTH = 8;

/** Só o que o código tem de verificável no navegador: o tamanho. A validade quem diz é a API, sempre com a mesma frase. */
function codeProblem(value: string) {
  const clean = normalizeCode(value);
  if (!clean) {
    return "Digite o código do aluno, com 8 letras e números.";
  }
  if (clean.length !== CODE_LENGTH) {
    return "O código tem 8 letras e números, como 7KQ4-9MZP. Confira se faltou ou sobrou algum.";
  }
  return null;
}

export function GuardianLinkCard({
  pendingStudents,
  order = 0,
  onLinked,
  variant = "card",
  autoFocus,
}: GuardianLinkCardProps) {
  const { token, student, toast, showError, reload, chooseStudent, openProfile } = useAppActions();
  const isCard = variant === "card";
  const focusOnShow = autoFocus ?? isCard;

  const [code, setCode] = useState("");
  const [relationship, setRelationship] = useState<GuardianRelationship | "">("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 429: até quando o botão espera (o aviso fica abaixo do campo do código)
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [waitMessage, setWaitMessage] = useState<string | null>(null);
  // frase da API quando o pedido fica com a secretaria (o card continua na tela)
  const [notice, setNotice] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const relationshipRef = useRef<HTMLSelectElement>(null);
  // "Quais dados o responsável vê": no painel, o Voltar devolve o foco a este link
  const dataLinkRef = useRef<HTMLButtonElement>(null);
  const focusDataLink = useRef(false);
  const titleId = useId();
  const helpId = useId();
  const stepsId = useId();
  const pendingId = useId();

  // primeiro acesso: o campo do código já vem focado, a menos que a pessoa já esteja em outro lugar
  useEffect(() => {
    if (!focusOnShow) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      const free =
        !active ||
        active === document.body ||
        (active instanceof HTMLElement && (active.id === "conteudo" || active.matches("#conteudo > h1")));
      if (free) {
        codeRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusOnShow]);

  // no Painel, o card sai quando o vínculo fica ativo: o foco que estava nele vai para o título da tela
  useLayoutEffect(() => {
    if (!isCard) {
      return;
    }
    const root = rootRef.current;
    return () => {
      if (root && root.contains(document.activeElement)) {
        window.setTimeout(() => {
          const active = document.activeElement;
          if (active && active !== document.body) {
            return;
          }
          document.querySelector<HTMLElement>("#conteudo > h1[tabindex]")?.focus({ preventScroll: true });
        });
      }
    };
  }, [isCard]);

  // voltou do "Quais dados o responsável vê" no painel: o foco volta ao link que abriu
  useEffect(() => {
    if (!dataOpen && focusDataLink.current) {
      focusDataLink.current = false;
      dataLinkRef.current?.focus();
    }
  }, [dataOpen]);

  function closeData() {
    focusDataLink.current = true;
    setDataOpen(false);
  }

  // terminou a espera do 429: o botão volta e o aviso sai
  useEffect(() => {
    if (waitUntil === null) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        setWaitUntil(null);
        setWaitMessage(null);
      },
      Math.max(0, waitUntil - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [waitUntil]);

  const waiting = waitUntil !== null;
  const shownCodeError = codeError ?? waitMessage;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) {
      return;
    }
    if (waiting) {
      codeRef.current?.focus();
      return;
    }
    const nextCodeError = codeProblem(code);
    const nextRelationshipError = relationship ? null : "Escolha o parentesco.";
    setCodeError(nextCodeError);
    setRelationshipError(nextRelationshipError);
    if (nextCodeError || nextRelationshipError || !relationship) {
      (nextCodeError ? codeRef : relationshipRef).current?.focus();
      return;
    }

    setSending(true);
    setNotice(null);
    try {
      const result = await claimGuardianLink(token, normalizeCode(code), relationship);
      setCode("");
      setRelationship("");
      if (result.link.status === "active") {
        const name = firstName(result.student.fullName ?? "o aluno");
        // acompanhando outro aluno (painel lateral do Painel): um toque leva à agenda do novo
        const switchTo = student && student.id !== result.student.id ? result.student.id : null;
        toast(result.message, {
          key: "vincular-aluno",
          tone: result.alreadyLinked ? "info" : "success",
          action: switchTo ? { label: `Ver agenda de ${name}`, onClick: () => chooseStudent(switchTo) } : undefined,
        });
      } else {
        setNotice(result.message);
      }
      if (onLinked) {
        onLinked(result);
      } else {
        void reload();
      }
    } catch (err) {
      const fields = fieldErrors(err);
      const limit = conflictOf(err, "LINK_LIMIT");
      const tooMany = conflictOf(err, "TOO_MANY_ATTEMPTS");
      if (fields.code || fields.relationship) {
        setCodeError(fields.code ?? null);
        setRelationshipError(fields.relationship ?? null);
        (fields.code ? codeRef : relationshipRef).current?.focus();
      } else if (limit) {
        setCodeError(limit.message);
        codeRef.current?.focus();
      } else if (tooMany) {
        const seconds = tooMany.retryAfter ?? 0;
        setCodeError(null);
        setWaitMessage(
          seconds > 0 ? `Muitas tentativas com código errado. ${retryAfterText(seconds)}` : tooMany.message
        );
        setWaitUntil(Date.now() + (seconds > 0 ? seconds : 60) * 1000);
        codeRef.current?.focus();
      } else {
        showError(err, "vincular-aluno");
      }
    } finally {
      setSending(false);
    }
  }

  const form = (
    <form className="resp-vinc-form" onSubmit={(event) => void submit(event)} noValidate>
      <Field
        className="resp-vinc-code"
        label="Código do aluno"
        hint="8 letras e números"
        error={shownCodeError ?? undefined}
      >
        <input
          ref={codeRef}
          className="input resp-code"
          value={code}
          // sem validar ao sair do campo: o erro entra entre o campo e o Vincular e, se aparecesse no blur, o botão
          // desceria entre apertar e soltar o mouse e o clique se perderia. Quem valida é o envio; digitar limpa o erro
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setCodeError(null);
          }}
          aria-describedby={helpId}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
          maxLength={20}
          placeholder="Ex.: 7KQ4-9MZP"
          spellCheck={false}
        />
      </Field>
      <Field className="resp-vinc-rel" label="Parentesco" error={relationshipError ?? undefined}>
        <select
          ref={relationshipRef}
          className={cx("input", !relationship && "resp-select-empty")}
          value={relationship}
          onChange={(event) => {
            setRelationship(event.target.value as GuardianRelationship | "");
            setRelationshipError(null);
          }}
        >
          <option value="">Escolha</option>
          {relationshipOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <p className="field-help resp-vinc-help" id={helpId}>
        Peça o código ao aluno, no perfil dele, ou à secretaria do campus.
      </p>
      <div className="resp-vinc-actions">
        <button
          className="btn btn-p aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
          aria-busy={sending || undefined}
          aria-disabled={sending || waiting || undefined}
          type="submit"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
          {sending ? "Vinculando" : "Vincular"}
        </button>
        <button ref={dataLinkRef} className="link resp-link" onClick={() => setDataOpen(true)} type="button">
          <Info className="h-4 w-4" aria-hidden />
          Quais dados o responsável vê
        </button>
      </div>
    </form>
  );

  const pending = pendingStudents.length ? (
    <div className="resp-pend" aria-labelledby={pendingId} role="group">
      <h3 id={pendingId} className="resp-h3">
        Aguardando a secretaria
      </h3>
      <ul className="mt-3 grid gap-2">
        {pendingStudents.map((item) => (
          <li key={item.linkId} className="mini">
            <span className="mini-ico">
              <Clock className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="mini-t block wrap-anywhere">{item.fullName ?? "Aluno"}</span>
              <span className="mini-s block">
                {relationshipText(item.relationship)}, pedido enviado em {formatDateBR(item.since)}. Você recebe um
                aviso aqui quando a secretaria confirmar.
              </span>
            </span>
          </li>
        ))}
      </ul>
      {isCard ? (
        <button className="link resp-link mt-2" onClick={openProfile} type="button">
          Cancelar um pedido no perfil
        </button>
      ) : null}
    </div>
  ) : null;

  // a frase da API fica numa região que já existe na tela, para o leitor de tela anunciar quando ela chega
  const status = (
    <div role="status">
      {notice ? (
        <p className="callout green mt-5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{notice}</span>
        </p>
      ) : null}
    </div>
  );

  const steps = (
    <aside className="resp-vinc-side" aria-labelledby={stepsId}>
      <h3 id={stepsId} className="resp-h3">
        Como conseguir o código
      </h3>
      <ol className="resp-steps">
        <li>
          <span className="resp-num" aria-hidden>
            1
          </span>
          <span>
            O aluno abre o <b>perfil</b> dele e toca em <b>Gerar código para responsável</b>. A secretaria também
            entrega um código impresso.
          </span>
        </li>
        <li>
          <span className="resp-num" aria-hidden>
            2
          </span>
          <span>Você digita o código aqui e escolhe o parentesco.</span>
        </li>
        <li>
          <span className="resp-num" aria-hidden>
            3
          </span>
          <span>A agenda do aluno aparece no seu Painel, só para leitura.</span>
        </li>
      </ol>
      <p className="callout blue resp-vinc-callout">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Aluno menor de idade: a secretaria confirma o vínculo antes de liberar.</span>
      </p>
    </aside>
  );

  if (!isCard) {
    // no painel lateral, nunca diálogo sobre painel: o texto entra no lugar do formulário, com Voltar. O que foi
    // digitado fica guardado (o estado é deste componente)
    return (
      <div ref={rootRef} className="resp-vinc is-panel">
        {dataOpen ? (
          <GuardianDataView onBack={closeData} />
        ) : (
          <>
            <p className="text-sm leading-6 text-ink-3">
              Com o código, a agenda do aluno também aparece no seu Painel. Você escolhe qual aluno ver no menu.
            </p>
            {form}
          </>
        )}
        {/* a região do status fica sempre montada, para o leitor de tela anunciar a frase da API */}
        <div hidden={dataOpen}>{status}</div>
        {dataOpen ? null : pending}
        {dataOpen ? null : steps}
      </div>
    );
  }

  // no Painel sem vínculo nada está aberto por baixo: aqui o texto abre no diálogo
  const dialog = <GuardianDataDialog open={dataOpen} onClose={() => setDataOpen(false)} />;

  return (
    <section ref={rootRef} className="card resp-vinc rise" style={delay(order)} aria-labelledby={titleId}>
      <div className="resp-vinc-in">
        <div className="resp-vinc-main">
          <span className="empty-ico" aria-hidden>
            <Link2 className="h-[22px] w-[22px]" />
          </span>
          <h2 id={titleId} className="resp-vinc-title">
            Vincular aluno
          </h2>
          <p className="sub resp-vinc-sub">
            Com o código, as provas, os trabalhos e as datas do campus do aluno aparecem aqui no seu Painel. Você
            acompanha sem alterar nada.
          </p>
          {form}
          {status}
          {pending}
        </div>
        {steps}
      </div>
      {dialog}
    </section>
  );
}
