"use client";

import { Info, Loader2, UserPlus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { restoreGuardianLink, revokeGuardianLink } from "@/lib/api";
import { classLabel, firstName, formatDateBR, linkSinceText, linkStatusText, relationshipText } from "@/lib/format";
import type { LinkedStudent } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { GuardianDataDialog } from "./guardian-data-dialog";
import { EmptyState } from "./ui";

/**
 * Seção "Alunos que você acompanha" do perfil do responsável (desenho 5.6), dentro do ProfileModal. Lista
 * useAppActions().linkedStudents (ativos e pendentes) com parentesco, desde quando, turma e status, e "Deixar de
 * acompanhar" (no pedido pendente, "Cancelar pedido"): direto, com toast e Desfazer (DELETE /guardian-links/:id e,
 * no Desfazer, POST /guardian-links/:id/restore, que devolve o vínculo ao status de antes); depois, reload.
 * Sem props: o usuário e os vínculos vêm de useAppActions(). Dona: área Responsável.
 */
export function ProfileStudents() {
  const { token, context, linkedStudents, toast, showError, reload, navigate } = useAppActions();
  // vínculos desfeitos agora: saem da lista na hora, antes de a recarga chegar (o Desfazer devolve)
  const [hidden, setHidden] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const visible = linkedStudents.filter((item) => !hidden.includes(item.linkId));

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

  async function stop(item: LinkedStudent) {
    if (busyId !== null) {
      return;
    }
    const name = firstName(item.fullName ?? "o aluno");
    const key = `vinculo-${item.linkId}`;
    setBusyId(item.linkId);
    try {
      await revokeGuardianLink(token, item.linkId);
      setHidden((list) => [...list, item.linkId]);
      // o botão some com a linha: o foco fica no título da seção, dentro do perfil
      headingRef.current?.focus({ preventScroll: true });
      toast(item.status === "pending" ? `Pedido para acompanhar ${name} cancelado.` : `Você deixou de acompanhar ${name}.`, {
        key,
        undo: () => restore(item),
      });
      void reload();
    } catch (err) {
      showError(err, key);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="grid gap-3 border-t border-line-2 pt-5" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 ref={headingRef} id={titleId} className="text-[17px] font-bold text-ink" tabIndex={-1}>
          Alunos que você acompanha
        </h3>
        <button className="link resp-link" onClick={() => setDataOpen(true)} type="button">
          <Info className="h-4 w-4" aria-hidden />
          Quais dados o responsável vê
        </button>
      </div>

      {!context ? (
        // o contexto ainda não chegou: esqueleto, nunca o "nenhum aluno"
        <div className="grid gap-2" role="status">
          <span className="sr-only">Carregando os alunos que você acompanha.</span>
          {[0, 1].map((row) => (
            <span key={row} className="resp-aluno" aria-hidden>
              <span className="skel h-10 w-10 shrink-0 !rounded-xl" />
              <span className="grid flex-1 gap-2">
                <span className="skel h-3.5 w-2/3" />
                <span className="skel h-3 w-1/2" />
              </span>
            </span>
          ))}
        </div>
      ) : visible.length ? (
        <ul className="grid gap-2">
          {visible.map((item) => {
            const pending = item.status === "pending";
            const busy = busyId === item.linkId;
            const fullName = item.fullName ?? "Aluno";
            return (
              <li key={item.linkId} className="resp-aluno">
                <span className="avatar" aria-hidden>
                  {item.initials}
                </span>
                <div className="resp-aluno-body">
                  <p className="text-[15px] font-bold text-ink wrap-anywhere">{fullName}</p>
                  <p className="text-sm text-muted">
                    {pending
                      ? `${relationshipText(item.relationship)}, pedido enviado em ${formatDateBR(item.since)}`
                      : linkSinceText(item.relationship, item.since)}
                  </p>
                  {item.classes.length ? (
                    <p className="text-sm text-muted">{item.classes.map((academicClass) => classLabel(academicClass)).join("; ")}</p>
                  ) : null}
                </div>
                <div className="resp-aluno-acts">
                  <span className={`pill ${pending ? "st-alt" : "st-conc"}`}>{linkStatusText(item.status)}</span>
                  <button
                    className="btn btn-s btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                    aria-busy={busy || undefined}
                    aria-disabled={busyId !== null || undefined}
                    aria-label={pending ? `Cancelar pedido para acompanhar ${fullName}` : `Deixar de acompanhar ${fullName}`}
                    onClick={() => void stop(item)}
                    type="button"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    {pending ? "Cancelar pedido" : "Deixar de acompanhar"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={UserPlus}
          text="Você ainda não acompanha nenhum aluno."
          hint="Peça o código ao aluno, no perfil dele, ou à secretaria do campus, e digite no Painel."
          action={{ label: "Ir para o Painel", onClick: () => navigate("dashboard") }}
        />
      )}

      {visible.length ? (
        <p className="field-help !mt-0">
          {visible.some((item) => item.status === "active")
            ? "Para acompanhar outro aluno, use o código dele em Acompanhar outro aluno, no Painel."
            : "Para acompanhar outro aluno, use o código dele no card Vincular aluno, no Painel."}{" "}
          O aluno vê no perfil dele quem acompanha a agenda.
        </p>
      ) : null}

      <GuardianDataDialog open={dataOpen} onClose={() => setDataOpen(false)} />
    </section>
  );
}
