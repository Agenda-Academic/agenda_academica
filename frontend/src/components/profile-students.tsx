"use client";

import { ArrowLeft, ArrowRight, Loader2, UserPlus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { restoreGuardianLink, revokeGuardianLink } from "@/lib/api";
import { classLabel, cx, firstName, formatDateBR, linkSinceText, linkStatusText, relationshipText } from "@/lib/format";
import type { LinkedStudent } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { GuardianDataView, guardianDataLinkLabel } from "./guardian-data-dialog";
import { GuardianLinkCard } from "./guardian-link-card";
import { focusWhenOnTop } from "./profile-guardians";
import { EmptyState } from "./ui";

// enquanto envia, o botão continua focável, só fica apagado
const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/**
 * Seção "Alunos que você acompanha" do perfil do responsável (desenho 5.6), na aba "Alunos" do ProfileModal. O
 * mesmo desenho da seção "Quem acompanha minha agenda" do aluno (título, texto, link "Ver detalhes do que você
 * vê" e um quadro por pessoa com a situação e a ação no alto à direita). Lista useAppActions().linkedStudents
 * (ativos e pendentes) com parentesco, desde quando e turma, e "Deixar de acompanhar" (no pedido pendente,
 * "Cancelar pedido"): pede confirmação e depois traz toast com Desfazer (DELETE /guardian-links/:id e, no
 * Desfazer, POST /guardian-links/:id/restore). "Acompanhar outro aluno" abre o formulário do código ali mesmo
 * (GuardianLinkCard, variante do painel), com Voltar. "Ver detalhes do que você vê" também troca o conteúdo da
 * seção, com Voltar (o perfil já é um diálogo: nunca diálogo sobre diálogo). Dona: área Responsável.
 */
export function ProfileStudents() {
  const { token, context, linkedStudents, toast, showError, reload, confirm } = useAppActions();
  // vínculos desfeitos agora: saem da lista na hora, antes de a recarga chegar (o Desfazer devolve)
  const [hidden, setHidden] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  // o que a seção mostra: a lista, o texto "Quais dados..." ou o formulário do código
  const [view, setView] = useState<"list" | "data" | "link">("list");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const linkHeadingRef = useRef<HTMLHeadingElement>(null);
  const linkSectionRef = useRef<HTMLDivElement>(null);
  // o Voltar devolve o foco a quem abriu ("Quais dados..." ou "Acompanhar outro aluno")
  const dataLinkRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<"data" | "link" | null>(null);
  const titleId = useId();
  const linkTitleId = useId();

  useEffect(() => {
    if (view === "list" && returnTo.current) {
      const target = returnTo.current === "data" ? dataLinkRef.current : addRef.current;
      returnTo.current = null;
      (target ?? headingRef.current)?.focus();
    }
    if (view === "link") {
      // o formulário entra no alto da área que rola, com o foco no título dele
      linkHeadingRef.current?.focus({ preventScroll: true });
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      linkSectionRef.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }
  }, [view]);

  function back(from: "data" | "link") {
    returnTo.current = from;
    setView("list");
  }

  const visible = linkedStudents.filter((item) => !hidden.includes(item.linkId));
  const pendingStudents = linkedStudents.filter((item) => item.status === "pending");

  async function restore(item: LinkedStudent) {
    const name = firstName(item.fullName ?? "o aluno");
    const key = `vinculo-${item.linkId}`;
    try {
      const result = await restoreGuardianLink(token, item.linkId);
      setHidden((list) => list.filter((id) => id !== item.linkId));
      toast(
        result.status === "pending"
          ? `Pedido para acompanhar ${name} de volta. A secretaria confirma antes de liberar.`
          : `Você voltou a acompanhar ${name}.`,
        { key }
      );
    } catch (err) {
      // 409 UNDO_EXPIRED e LINK_LIMIT vêm com a frase da API
      showError(err, key);
    }
    void reload();
  }

  /** Deixar de acompanhar (ou cancelar o pedido): pergunta antes; depois, o toast traz o Desfazer. */
  function stop(item: LinkedStudent) {
    if (busyId !== null) {
      return;
    }
    const name = firstName(item.fullName ?? "o aluno");
    const isPending = item.status === "pending";
    const key = `vinculo-${item.linkId}`;
    confirm({
      title: isPending ? `Cancelar o pedido para acompanhar ${name}?` : `Deixar de acompanhar ${name}?`,
      message: isPending
        ? "A secretaria deixa de analisar o pedido. Para acompanhar depois, você vai precisar de um código novo."
        : `Você deixa de ver a agenda de ${name} na hora, e ${name} recebe um aviso. Dá para desfazer logo depois.`,
      confirmLabel: isPending ? "Cancelar pedido" : "Deixar de acompanhar",
      cancelLabel: "Manter",
      action: async () => {
        setBusyId(item.linkId);
        try {
          await revokeGuardianLink(token, item.linkId);
          setHidden((list) => [...list, item.linkId]);
          toast(isPending ? `Pedido para acompanhar ${name} cancelado.` : `Você deixou de acompanhar ${name}.`, {
            key,
            undo: () => restore(item),
          });
          void reload();
        } catch (err) {
          showError(err, key);
        } finally {
          setBusyId(null);
          // o botão some com a linha: quando a confirmação fechar, o foco fica no título da seção
          focusWhenOnTop(() => headingRef.current);
        }
      },
    });
  }

  if (view === "link") {
    return (
      <div ref={linkSectionRef} className="grid gap-3" aria-labelledby={linkTitleId} role="group">
        <button className="btn btn-s btn-sm justify-self-start" onClick={() => back("link")} type="button">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar
        </button>
        <h3 ref={linkHeadingRef} id={linkTitleId} className="drawer-h3 outline-none" tabIndex={-1}>
          Acompanhar outro aluno
        </h3>
        <GuardianLinkCard
          variant="panel"
          pendingStudents={pendingStudents}
          onLinked={(result) => {
            void reload();
            // ativo: volta para a lista, já com o aluno novo (o aviso traz "Ver agenda de ..."); pendente: o
            // formulário mostra o pedido e a frase da secretaria
            if (result.link.status === "active") {
              back("link");
            }
          }}
        />
      </div>
    );
  }

  return (
    <section ref={sectionRef} className="aluno-sec" aria-labelledby={titleId}>
      <h3 ref={headingRef} id={titleId} className="aluno-sec-t drawer-h3" tabIndex={-1}>
        Alunos que você acompanha
      </h3>

      {view === "data" ? (
        // o perfil já é um diálogo: o texto entra no lugar da lista, com Voltar
        // a seção inteira sobe (com o título dela à vista, e não cortado embaixo do cabeçalho do diálogo)
        <GuardianDataView
          className="mt-3.5"
          forGuardian
          level={4}
          scrollTargetRef={sectionRef}
          onBack={() => back("data")}
        />
      ) : (
        <>
          <p className="aluno-sec-s">
            Você vê a agenda da turma, as datas da instituição e as notas publicadas de cada aluno, só para leitura. O que
            você muda aqui vale na hora.
          </p>
          <button ref={dataLinkRef} className="link aluno-sec-link" onClick={() => setView("data")} type="button">
            {guardianDataLinkLabel(true)}
            <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
          </button>

          {!context ? (
            // o contexto ainda não chegou: esqueleto, nunca o "nenhum aluno"
            <div className="aluno-guard mt-3.5" role="status">
              <span className="sr-only">Carregando os alunos que você acompanha.</span>
              <div className="aluno-g-row" aria-hidden>
                <span className="skel h-10 w-10 shrink-0 !rounded-xl" />
                <span className="grid flex-1 gap-2">
                  <span className="skel h-3.5 w-40 max-w-full" />
                  <span className="skel h-3 w-28 max-w-full" />
                </span>
              </div>
            </div>
          ) : visible.length ? (
            <ul className="aluno-guards">
              {visible.map((item) => {
                const pending = item.status === "pending";
                const busy = busyId === item.linkId;
                const fullName = item.fullName ?? "Aluno";
                return (
                  <li key={item.linkId} className="aluno-guard">
                    <div className="aluno-g-row">
                      <span className="aluno-g-av" aria-hidden>
                        {item.initials}
                      </span>
                      <div className="aluno-g-main">
                        <p className="aluno-g-name wrap-anywhere">{fullName}</p>
                        <p className="aluno-g-meta">
                          {pending
                            ? `${relationshipText(item.relationship)}, pedido enviado em ${formatDateBR(item.since)}`
                            : linkSinceText(item.relationship, item.since)}
                        </p>
                        {item.classes.length ? (
                          <p className="aluno-g-meta">{item.classes.map((academicClass) => classLabel(academicClass)).join("; ")}</p>
                        ) : null}
                      </div>
                      <div className="aluno-g-acts">
                        <span className={cx("pill stat", pending ? "stat-alt" : "stat-conc")}>{linkStatusText(item.status)}</span>
                        <button
                          className={cx("btn btn-danger btn-sm", busyLook)}
                          aria-busy={busy || undefined}
                          aria-disabled={busyId !== null || undefined}
                          aria-label={pending ? `Cancelar pedido para acompanhar ${fullName}` : `Deixar de acompanhar ${fullName}`}
                          onClick={() => stop(item)}
                          type="button"
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                          {pending ? "Cancelar pedido" : "Deixar de acompanhar"}
                        </button>
                      </div>
                    </div>
                    {pending ? (
                      <p className="aluno-g-note">A secretaria confirma antes de liberar. Você recebe um aviso quando ela confirmar.</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-3.5">
              <EmptyState
                compact
                icon={UserPlus}
                text="Você ainda não acompanha nenhum aluno"
                hint="Peça o código ao aluno, no perfil dele, ou à secretaria do campus."
              />
            </div>
          )}

          {context ? (
            <button ref={addRef} className="btn btn-s aluno-gen" onClick={() => setView("link")} type="button">
              <UserPlus className="h-4 w-4" aria-hidden />
              {visible.length ? "Acompanhar outro aluno" : "Acompanhar um aluno"}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
