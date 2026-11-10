"use client";

import { ArrowRight, Check, CircleAlert, Clock, Copy, Info, KeyRound, Loader2, ShieldAlert, TriangleAlert, Users } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  cancelMyGuardianCode,
  conflictOf,
  createMyGuardianCode,
  getMyGuardians,
  restoreGuardianLink,
  revokeGuardianLink,
  updateMyGuardianLink,
} from "@/lib/api";
import {
  cx,
  errorMessage,
  firstName,
  formatDateBR,
  formatShortDate,
  formatTime,
  linkSinceText,
  linkStatusText,
  relationshipText,
} from "@/lib/format";
import type { GuardianCodeCreated, GuardianCodeInfo, GuardianLink, MyGuardians, User } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { GuardianDataView } from "./guardian-data-dialog";
import { EmptyState, isOnTopLayer } from "./ui";

/**
 * Seção "Quem acompanha minha agenda" do perfil do aluno (desenho 5.5, amostra aluno-quem-acompanha), dentro do
 * ProfileModal, abaixo de Avisos. GET /me/guardians; "Gerar código para responsável" (código grande, prazo,
 * Copiar, "Entregue só a quem você quer que acompanhe sua agenda"); "Remover" quando canRemove (direto, com
 * toast e Desfazer: revokeGuardianLink e restoreGuardianLink); chave "Compartilhar minhas notas" quando
 * canShareGrades; aluno menor: "A secretaria confirma antes de liberar"; vínculo com needsReview (o aluno
 * deixou de ser menor): Confirmar ou Remover. "Quais dados o responsável vê" troca o conteúdo da seção, com
 * Voltar (o perfil já é um diálogo: nunca diálogo sobre diálogo). Dona: área Aluno.
 */
export type ProfileGuardiansProps = {
  user: User;
};

// enquanto envia, o botão continua focável, só fica apagado
const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/** Vínculo que ainda conta no limite de 4 (ativo ou pendente). */
function isOpenLink(link: GuardianLink) {
  return link.status === "active" || link.status === "pending";
}

/**
 * Quando o código foi gerado, para cada linha da lista ser diferente: "10/11/2026 às 09:27"; com os segundos se
 * outro código é do mesmo minuto e, se ainda assim empatar, com a posição na lista ("código 2").
 */
function generatedAt(code: GuardianCodeInfo, codes: GuardianCodeInfo[]) {
  const byMinute = (value: string) => `${formatDateBR(value)} às ${formatTime(value)}`;
  const bySecond = (value: string) =>
    `${formatDateBR(value)} às ${new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  const minute = byMinute(code.createdAt);
  if (!codes.some((other) => other.id !== code.id && byMinute(other.createdAt) === minute)) {
    return minute;
  }
  const second = bySecond(code.createdAt);
  if (!codes.some((other) => other.id !== code.id && bySecond(other.createdAt) === second)) {
    return second;
  }
  return `${second}, código ${codes.findIndex((other) => other.id === code.id) + 1}`;
}

/** Foco no alvo assim que ele estiver na camada de cima (a confirmação fechou), por até uns 3 segundos. */
function focusWhenOnTop(getTarget: () => HTMLElement | null) {
  let tries = 0;
  const step = () => {
    const target = getTarget();
    if (target && isOnTopLayer(target)) {
      target.focus();
      return;
    }
    tries += 1;
    if (tries < 180) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

/** "K7QM-3XPD" lido caractere por caractere: "K 7 Q M, 3 X P D". */
function spelled(code: string) {
  return code
    .split("-")
    .map((part) => part.split("").join(" "))
    .join(", ");
}

export function ProfileGuardians({ user }: ProfileGuardiansProps) {
  const { token, toast, showError, confirm, reload } = useAppActions();
  const [data, setData] = useState<MyGuardians | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  // ação em andamento: "gerar", "remover-1", "notas-1", "confirmar-1", "cancelar-2"
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<GuardianCodeCreated | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // frase para o leitor de tela (a região fica sempre montada)
  const [announce, setAnnounce] = useState("");
  const [dataOpen, setDataOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const generateRef = useRef<HTMLButtonElement>(null);
  // "Quais dados o responsável vê": o Voltar devolve o foco a este link
  const dataLinkRef = useRef<HTMLButtonElement>(null);
  const focusDataLink = useRef(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const codeRef = useRef<HTMLElement>(null);
  const focusHeadingOnLoad = useRef(false);
  const titleId = useId();
  const idBase = useId();
  const generateHelpId = useId();
  const generateErrorId = useId();

  useEffect(() => {
    let alive = true;
    getMyGuardians(token).then(
      (result) => {
        if (alive) {
          setData(result);
          setLoadError(null);
          setRetrying(false);
        }
      },
      (error: unknown) => {
        if (alive) {
          setLoadError(error);
          setRetrying(false);
        }
      }
    );
    return () => {
      alive = false;
    };
  }, [token, loadKey]);

  // depois de "Tentar de novo" dar certo, o botão some: o foco vai para o título da seção
  useEffect(() => {
    if (data && focusHeadingOnLoad.current) {
      focusHeadingOnLoad.current = false;
      headingRef.current?.focus();
    }
  }, [data]);

  // código novo: o foco vai para o Copiar, dentro do quadro do código
  useEffect(() => {
    if (created) {
      copyRef.current?.focus();
    }
  }, [created]);

  // voltou de "Quais dados o responsável vê": o foco volta ao link que abriu
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

  // "Copiado" volta a "Copiar" depois de alguns segundos
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 3000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function retryLoad() {
    if (retrying) {
      return;
    }
    focusHeadingOnLoad.current = true;
    setRetrying(true);
    setLoadKey((key) => key + 1);
  }

  /** Lista atualizada depois de uma ação (sem esqueleto: a lista de agora fica até a nova chegar). */
  async function refresh() {
    try {
      const result = await getMyGuardians(token);
      setData(result);
      // o código do quadro saiu da lista (usado ou vencido): o quadro sai junto, sem "Cancelar código"
      setCreated((current) => (current && !result.codes.some((code) => code.id === current.id) ? null : current));
    } catch {
      // a ação já deu certo; a lista se acerta na próxima abertura do perfil
    }
  }

  function replaceLink(link: GuardianLink) {
    setData((current) =>
      current ? { ...current, guardians: current.guardians.map((item) => (item.id === link.id ? link : item)) } : current
    );
  }

  const isMinor = data?.isMinor ?? Boolean(user.isMinor);
  const guardians = data?.guardians ?? [];
  const codes = data?.codes ?? [];
  const limits = data?.limits ?? { maxLinks: 4, maxCodes: 3 };
  const openLinks = guardians.filter(isOpenLink).length;
  const toReview = guardians.filter((link) => link.needsReview && isOpenLink(link));
  const otherCodes = codes.filter((code) => code.id !== created?.id);

  let limitText: string | null = null;
  if (data && openLinks >= limits.maxLinks) {
    limitText = `Você já tem ${limits.maxLinks} responsáveis. Para incluir outro, remova um antes.`;
  } else if (data && codes.length >= limits.maxCodes) {
    limitText = `Você já tem ${limits.maxCodes} códigos válidos. Cancele um para gerar outro.`;
  }

  async function removeLink(link: GuardianLink) {
    if (busy) {
      return;
    }
    const name = link.fullName ?? "O responsável";
    setBusy(`remover-${link.id}`);
    try {
      await revokeGuardianLink(token, link.id);
      setData((current) =>
        current ? { ...current, guardians: current.guardians.filter((item) => item.id !== link.id) } : current
      );
      // um lugar livre no limite de 4: o erro antigo do "Gerar código" deixa de valer
      setGenerateError(null);
      // o botão saiu com a linha: o foco fica no título da seção, logo acima da lista
      headingRef.current?.focus();
      toast(
        link.status === "pending" ? `O pedido de ${name} para acompanhar sua agenda foi encerrado.` : `${name} deixou de acompanhar sua agenda.`,
        { undo: () => restoreLink(link), key: `vinculo-${link.id}` }
      );
      // o aviso do sistema sobre o vínculo desfeito e o aviso fixo do Painel
      void reload();
    } catch (error) {
      showError(error, `vinculo-${link.id}`);
    } finally {
      setBusy(null);
    }
  }

  /** Desfazer do toast: o vínculo volta ao status de antes (ativo ou pendente), até 10 minutos depois. */
  async function restoreLink(link: GuardianLink) {
    try {
      const summary = await restoreGuardianLink(token, link.id);
      toast(summary.message || "Vínculo restaurado.", { key: `vinculo-${link.id}` });
      await refresh();
      void reload();
    } catch (error) {
      // depois de 10 minutos: 409 UNDO_EXPIRED; com 4 vínculos: 409 LINK_LIMIT (a frase da API diz o que fazer)
      showError(error, `vinculo-${link.id}`);
    }
  }

  async function toggleShare(link: GuardianLink) {
    if (busy) {
      return;
    }
    const next = !link.shareGrades;
    const name = firstName(link.fullName ?? "O responsável");
    setBusy(`notas-${link.id}`);
    // a chave muda na hora; se a API recusar, volta
    replaceLink({ ...link, shareGrades: next });
    try {
      replaceLink(await updateMyGuardianLink(token, link.id, { shareGrades: next }));
      toast(next ? `${name} passa a ver as notas que a docente publicar.` : `${name} deixa de ver suas notas.`, {
        key: `notas-${link.id}`,
      });
    } catch (error) {
      replaceLink(link);
      showError(error, `notas-${link.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function confirmLink(link: GuardianLink) {
    if (busy) {
      return;
    }
    const name = link.fullName ?? "O responsável";
    setBusy(`confirmar-${link.id}`);
    try {
      replaceLink(await updateMyGuardianLink(token, link.id, { confirm: true }));
      toast(`Vínculo confirmado. ${name} continua acompanhando sua agenda.`, { key: `vinculo-${link.id}` });
      // o aviso fixo do Painel sai quando não sobra vínculo para conferir
      void reload();
    } catch (error) {
      showError(error, `vinculo-${link.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function generateCode() {
    if (busy || limitText) {
      return;
    }
    setBusy("gerar");
    setGenerateError(null);
    try {
      const code = await createMyGuardianCode(token);
      setCreated(code);
      setCopied(false);
      setAnnounce(`Código gerado. Vale até ${formatShortDate(code.expiresAt)}.`);
      await refresh();
    } catch (error) {
      // 409 CODE_LIMIT e LINK_LIMIT: a frase da API, logo abaixo do botão
      setGenerateError(errorMessage(error));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function copyCode(code: GuardianCodeCreated) {
    try {
      await navigator.clipboard.writeText(code.codeFormatted);
      setCopied(true);
      setAnnounce("Código copiado.");
    } catch {
      // sem acesso à área de transferência: o código fica selecionado para copiar à mão
      const element = codeRef.current;
      const selection = window.getSelection();
      if (element && selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      toast("Não deu para copiar sozinho. O código ficou selecionado: copie com Ctrl C ou toque e segure.", {
        tone: "info",
        key: "copiar-codigo",
      });
    }
  }

  function cancelCode(code: Pick<GuardianCodeInfo, "id" | "createdAt">) {
    confirm({
      title: "Cancelar este código?",
      message: "Quem recebeu o código não vai conseguir usar. Para outra pessoa, gere um código novo.",
      confirmLabel: "Cancelar código",
      cancelLabel: "Manter código",
      action: async () => {
        setBusy(`cancelar-${code.id}`);
        try {
          const result = await cancelMyGuardianCode(token, code.id);
          setCreated((current) => (current?.id === code.id ? null : current));
          setGenerateError(null);
          toast(result.message || "Código cancelado.", { key: `codigo-${code.id}` });
        } catch (error) {
          if (conflictOf(error, "CODE_USED")) {
            // já usado: o quadro do código sai (não dá mais para cancelar) e o responsável novo entra na lista
            setCreated((current) => (current?.id === code.id ? null : current));
            setCopied(false);
            void reload();
          }
          showError(error, `codigo-${code.id}`);
        } finally {
          setBusy(null);
          await refresh();
          // o botão que abriu a confirmação saiu da tela: o foco vai para "Gerar código" (ou o título da seção)
          // quando a confirmação fechar, nunca para o começo do perfil
          focusWhenOnTop(() => generateRef.current ?? headingRef.current);
        }
      },
    });
  }

  function renderLink(link: GuardianLink) {
    const name = link.fullName ?? "Responsável";
    const first = firstName(name);
    const shareId = `${idBase}-notas-${link.id}`;
    const shareHintId = `${idBase}-notas-dica-${link.id}`;
    const meta =
      link.status === "pending"
        ? `${relationshipText(link.relationship)}, pedido em ${formatDateBR(link.createdAt)}`
        : linkSinceText(link.relationship, link.since);
    const removing = busy === `remover-${link.id}`;
    const confirming = busy === `confirmar-${link.id}`;
    const sharing = busy === `notas-${link.id}`;
    return (
      <li key={link.id} className={cx("aluno-guard", link.needsReview && "review")}>
        <div className="aluno-g-row">
          <span className="aluno-g-av" aria-hidden>
            {link.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="aluno-g-name wrap-anywhere">{name}</p>
            <p className="aluno-g-meta">{meta}</p>
          </div>
          <div className="aluno-g-acts">
            <span className={cx("pill", link.status === "active" ? "st-conc" : "st-alt")}>{linkStatusText(link.status)}</span>
            {link.needsReview ? (
              <button
                className={cx("btn btn-p btn-sm", busyLook)}
                aria-disabled={Boolean(busy) || undefined}
                aria-label={`Confirmar ${name}`}
                onClick={() => void confirmLink(link)}
                type="button"
              >
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Confirmar
              </button>
            ) : null}
            {link.canRemove ? (
              <button
                className={cx("btn btn-s btn-sm", busyLook)}
                aria-disabled={Boolean(busy) || undefined}
                aria-label={`Remover ${name}`}
                onClick={() => void removeLink(link)}
                type="button"
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Remover
              </button>
            ) : null}
          </div>
        </div>
        {link.status === "pending" ? (
          <p className="aluno-g-note">A secretaria confirma antes de liberar. Até lá, {first} não vê sua agenda.</p>
        ) : null}
        {!link.canRemove ? (
          <p className="aluno-g-note">Vínculo feito pela secretaria. Para encerrar, fale com a secretaria.</p>
        ) : null}
        {link.canShareGrades && link.status === "active" ? (
          <div className="aluno-g-share">
            <div className="min-w-0 flex-1">
              <p className="aluno-g-share-t" id={shareId}>
                Compartilhar minhas notas
              </p>
              <p className="aluno-g-share-s" id={shareHintId}>
                {link.shareGrades ? `${first} vê as notas que a docente publicar.` : `${first} não vê suas notas.`}
              </p>
            </div>
            <button
              className={cx("aluno-switch", busyLook)}
              role="switch"
              aria-checked={link.shareGrades}
              aria-disabled={Boolean(busy) || undefined}
              aria-busy={sharing || undefined}
              aria-labelledby={shareId}
              aria-describedby={shareHintId}
              onClick={() => void toggleShare(link)}
              type="button"
            />
          </div>
        ) : null}
        {!link.canShareGrades && isMinor && link.status === "active" ? (
          <p className="aluno-g-note">{first} vê as notas que a docente publicar.</p>
        ) : null}
      </li>
    );
  }

  let body: ReactNode;
  if (loadError && !data) {
    body = (
      <div className="callout rose mt-3.5" role="alert">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>Não foi possível carregar quem acompanha sua agenda. {errorMessage(loadError)}</p>
          <button
            className={cx("btn btn-s btn-sm mt-2.5", busyLook)}
            aria-disabled={retrying || undefined}
            aria-busy={retrying || undefined}
            onClick={retryLoad}
            type="button"
          >
            {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Tentar de novo
          </button>
        </div>
      </div>
    );
  } else if (!data) {
    // carregando: esqueleto da linha do responsável, nunca o vazio
    body = (
      <div className="aluno-guard mt-3.5" role="status">
        <span className="sr-only">Carregando quem acompanha sua agenda</span>
        <div className="aluno-g-row" aria-hidden>
          <span className="skel h-10 w-10 shrink-0 !rounded-xl" />
          <span className="grid flex-1 gap-2">
            <span className="skel h-3.5 w-40 max-w-full" />
            <span className="skel h-3 w-28 max-w-full" />
          </span>
          <span className="skel h-9 w-20 !rounded-[10px]" />
        </div>
      </div>
    );
  } else if (!guardians.length) {
    body = (
      <div className="mt-3.5">
        <EmptyState
          compact
          icon={Users}
          text="Ninguém acompanha sua agenda"
          hint="Para alguém acompanhar, gere um código logo abaixo e entregue só a essa pessoa."
        />
      </div>
    );
  } else {
    body = <ul className="aluno-guards">{guardians.map(renderLink)}</ul>;
  }

  const generating = busy === "gerar";
  const createdCancelable = created ? (codes.find((code) => code.id === created.id)?.canCancel ?? true) : false;

  return (
    <section className="aluno-sec" aria-labelledby={titleId}>
      <h3 ref={headingRef} id={titleId} className="aluno-sec-t" tabIndex={-1}>
        Quem acompanha minha agenda
      </h3>
      {dataOpen ? (
        // o perfil já é um diálogo: o texto entra no lugar da seção, com Voltar (o código gerado volta junto)
        <GuardianDataView className="mt-3.5" level={4} onBack={closeData} />
      ) : (
        <>
          <p className="aluno-sec-s">
            Quem você autoriza vê a agenda da turma e as datas do campus, nunca os seus lembretes. O que você muda aqui vale
            na hora.
            {isMinor ? " Como você é menor de idade, a secretaria confirma cada vínculo antes de liberar." : null}
          </p>
          <button ref={dataLinkRef} className="link aluno-sec-link" onClick={() => setDataOpen(true)} type="button">
            Quais dados o responsável vê
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>

          {toReview.length ? (
            <div className="callout amber mt-3.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="min-w-0">
                <b>Confira cada vínculo.</b> A secretaria atualizou seu cadastro e você não é mais menor de idade. Confirme
                quem continua acompanhando sua agenda ou remova. Até você decidir, ninguém vê suas notas.
              </p>
            </div>
          ) : null}

          {body}

          {data ? (
            <>
              <button
                ref={generateRef}
                className={cx("btn btn-s aluno-gen", busyLook)}
                aria-disabled={generating || Boolean(limitText) || undefined}
                aria-busy={generating || undefined}
                aria-describedby={
                  [generateError ? generateErrorId : null, limitText || isMinor ? generateHelpId : null].filter(Boolean).join(" ") ||
                  undefined
                }
                onClick={() => void generateCode()}
                type="button"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
                {generating ? "Gerando código" : "Gerar código para responsável"}
              </button>
              {generateError ? (
                <p className="field-error" id={generateErrorId} role="alert">
                  <CircleAlert aria-hidden />
                  <span>{generateError}</span>
                </p>
              ) : null}
              {limitText || isMinor ? (
                <p className="field-help" id={generateHelpId}>
                  {limitText ?? "A secretaria confirma antes de liberar."}
                </p>
              ) : null}
            </>
          ) : null}

          {created ? (
            <div className="aluno-codebox">
              <div className="aluno-cb-top">
                <b>Código para responsável</b>
                <span>
                  <Clock className="h-4 w-4" aria-hidden />
                  vale até {formatShortDate(created.expiresAt)}
                </span>
              </div>
              <div className="aluno-cb-code">
                <code ref={codeRef} aria-hidden>
                  {created.codeFormatted}
                </code>
                <span className="sr-only">Código: {spelled(created.codeFormatted)}</span>
                <button ref={copyRef} className="btn btn-s btn-sm" onClick={() => void copyCode(created)} type="button">
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <p className="aluno-cb-note">Entregue só a quem você quer que acompanhe sua agenda. Vale uma vez só.</p>
              {created.linkWillBePending ? (
                <p className="aluno-cb-note aluno-cb-minor">
                  <Info className="h-4 w-4 shrink-0" aria-hidden />A secretaria confirma antes de liberar.
                </p>
              ) : null}
              <div className="aluno-cb-foot">
                <span>O código aparece só agora. Depois, fica só o prazo.</span>
                {createdCancelable ? (
                  <button className="aluno-cb-cancel" onClick={() => cancelCode(created)} type="button">
                    Cancelar código
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {otherCodes.length ? (
            <div className="aluno-codes">
              <p className="aluno-codes-t">
                {otherCodes.length === 1 ? "Código ainda válido" : "Códigos ainda válidos"} ({codes.length} de {limits.maxCodes})
              </p>
              <ul className="aluno-codes-list">
                {otherCodes.map((code) => {
                  const when = `gerado em ${generatedAt(code, codes)}`;
                  return (
                    <li key={code.id} className="aluno-code-row">
                      <span className="aluno-code-ico" aria-hidden>
                        <KeyRound className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink">
                          {code.kind === "admin" ? "Código da secretaria" : "Código gerado por você"}
                        </span>
                        <span className="block text-muted">
                          {when.charAt(0).toUpperCase() + when.slice(1)}, vale até {formatShortDate(code.expiresAt)}
                        </span>
                      </span>
                      {code.canCancel === false ? (
                        <span className="aluno-code-note">Só a secretaria cancela</span>
                      ) : (
                        <button
                          className={cx("btn btn-g btn-sm aluno-code-cancel", busyLook)}
                          aria-disabled={busy === `cancelar-${code.id}` || undefined}
                          aria-label={`Cancelar código ${when}`}
                          onClick={() => cancelCode(code)}
                          type="button"
                        >
                          Cancelar
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="field-help">O código não aparece de novo. Se ninguém usou, cancele e gere outro.</p>
            </div>
          ) : null}
        </>
      )}

      <p className="sr-only" role="status">
        {announce}
      </p>
    </section>
  );
}
