"use client";

import { Ban, Check, CircleAlert, Info, KeyRound, Link2, ShieldBan, Undo2, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  ApiError,
  approveGuardianLink,
  blockGuardianLink,
  cancelStudentGuardianCode,
  conflictOf,
  createStudentGuardianCode,
  getClass,
  getClassStudents,
  getStudentGuardians,
  linkGuardianByEmail,
  restoreGuardianLink,
  revokeGuardianLink,
  updateEnrollment,
  updateUserMinor,
} from "@/lib/api";
import {
  classLabel,
  cx,
  enrollmentSourceText,
  enrollmentStatusText,
  errorMessage,
  fieldErrors,
  firstName,
  formatDateBR,
  isIntegratedCourse,
  linkOriginText,
  linkStatusText,
  relationshipText,
} from "@/lib/format";
import { relationshipOptions } from "@/lib/meta";
import type {
  AdminGuardianLink,
  ClassStudent,
  EnrollmentStatus,
  GuardianCodeCreated,
  GuardianCodeInfo,
  GuardianRelationship,
  StudentGuardians,
} from "@/lib/types";
import { useAppActions } from "./app-actions";
import { PanelSubtitle, type PanelProps } from "./classes-class-panel";
import {
  CopyButton,
  PanelFooter,
  PrintButton,
  SkeletonRows,
  initialsOf,
  minorWarning,
  plural,
  printGuardianCode,
  undoEnrollments,
  useRemote,
} from "./classes-shared";
import { EmptyState, ErrorState, Field, primaryButton, secondaryButton } from "./ui";

const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

const linkPill: Record<string, string> = {
  pending: "st-alt",
  active: "st-conc",
  revoked: "st-ag",
  blocked: "st-canc",
};

const enrollmentPill: Record<string, string> = {
  pending: "st-alt",
  active: "st-conc",
  inactive: "st-ag",
  completed: "st-ag",
};

type Run = (key: string, task: () => Promise<void>) => Promise<void>;

type BlockProps = {
  headingId: string;
  /** Primeiro nome do aluno, para as frases ("Diogo vai confirmar"). */
  first: string;
  /** Ação em andamento (os botões ficam ocupados). */
  working: string | null;
  onRun: Run;
  onChanged: () => void;
};

/** Painel do aluno (troca o conteúdo do painel da turma): matrícula, menor de idade e responsáveis. */
export function StudentPanel({ api, subtitle, view }: PanelProps<"student">) {
  const { token } = useAppActions();
  const userId = view.userId;
  const classId = view.classId;
  const guardians = useRemote(`admin:aluno:${userId}:responsaveis`, () => getStudentGuardians(token, userId));
  const roster = useRemote(classId ? `admin:turma:${classId}:alunos` : null, () => getClassStudents(token, classId ?? 0));
  const klass = useRemote(classId ? `admin:turma:${classId}` : null, () => getClass(token, classId ?? 0));
  const [working, setWorking] = useState<string | null>(null);
  const ids = useId();

  const student = guardians.data?.student ?? null;
  const enrollment: ClassStudent | null = roster.data?.find((item) => item.userId === userId) ?? null;
  const name = student?.fullName ?? view.name ?? enrollment?.fullName ?? student?.email ?? "Aluno";
  const first = firstName(name);

  // título do painel: o nome que veio da API (o pedido de fora traz só o id do aluno)
  const loadedName = student?.fullName ?? null;
  const setTitle = api.setTitle;
  useEffect(() => {
    if (loadedName && !view.name) {
      setTitle(loadedName);
    }
  }, [setTitle, loadedName, view.name]);

  async function run(key: string, task: () => Promise<void>) {
    if (working) {
      return;
    }
    setWorking(key);
    api.setBusy(true);
    try {
      await task();
    } finally {
      setWorking(null);
      api.setBusy(false);
    }
  }

  function refresh() {
    void guardians.reload();
    if (classId) {
      void roster.reload();
    }
    api.changed();
  }

  const common = { first, working, onRun: run, onChanged: refresh };
  const missing = guardians.error instanceof ApiError && guardians.error.status === 404 && !guardians.data;

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span className="basis-full wrap-anywhere">{student?.email ?? enrollment?.email ?? ""}</span>
        {klass.data ? <span className="pill st-ag">{classLabel(klass.data)}</span> : null}
        {student?.isMinor ? <span className="pill st-alt">Menor de idade</span> : null}
      </PanelSubtitle>

      <h3 className="sr-only" data-panel-start tabIndex={-1}>
        {name}
      </h3>

      {missing ? (
        <div className="admin-sec !pt-1">
          <EmptyState
            icon={Info}
            text="Aluno não encontrado"
            hint="A conta pode ter saído do sistema, ou não é de aluno. Volte e confira a lista."
          />
        </div>
      ) : null}

      {classId && !missing ? (
        <EnrollmentBlock
          {...common}
          className={klass.data?.name ?? "turma"}
          enrollment={enrollment}
          error={roster.error}
          headingId={`${ids}-matricula`}
          integrated={isIntegratedCourse(klass.data?.course)}
          isMinor={student ? student.isMinor : null}
          linksBack={
            guardians.data
              ? guardians.data.guardians.filter(
                  (link) => link.status === "active" && link.origin === "student_code" && !link.approvedAt
                ).length
              : null
          }
          loading={roster.data === null}
          onRetry={() => void roster.reload()}
        />
      ) : null}

      {missing ? null : guardians.data === null ? (
        <div className="admin-sec">
          {guardians.error ? (
            <ErrorState
              title="Não deu para carregar os responsáveis"
              text={errorMessage(guardians.error)}
              onRetry={() => void guardians.reload()}
            />
          ) : (
            <SkeletonRows rows={3} label="Carregando os responsáveis" />
          )}
        </div>
      ) : (
        <>
          <MinorBlock {...common} headingId={`${ids}-menor`} isMinor={Boolean(student?.isMinor)} userId={userId} />
          <GuardiansBlock {...common} data={guardians.data} headingId={`${ids}-resp`} studentId={userId} />
          <LinkByEmailBlock {...common} headingId={`${ids}-email`} studentId={userId} />
          <GuardianCodeBlock {...common} codes={guardians.data.codes} headingId={`${ids}-codigo`} name={name} studentId={userId} />
        </>
      )}

      <PanelFooter api={api}>
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.back()} type="button">
          {api.canGoBack ? "Voltar para a turma" : "Fechar"}
        </button>
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Matrícula na turma                                                  */
/* ------------------------------------------------------------------ */

function EnrollmentBlock({
  className,
  enrollment,
  error,
  first,
  headingId,
  integrated,
  isMinor,
  linksBack,
  loading,
  working,
  onChanged,
  onRetry,
  onRun,
}: BlockProps & {
  className: string;
  enrollment: ClassStudent | null;
  error: unknown;
  /** A turma é do curso integrado: quem fica ativo nela passa a contar como menor de idade. */
  integrated: boolean;
  /** O aluno já conta como menor de idade (null: ainda não se sabe). */
  isMinor: boolean | null;
  /** Vínculos de responsável que voltam a pendente se o aluno passar a ser menor (null: ainda não se sabe). */
  linksBack: number | null;
  loading: boolean;
  onRetry: () => void;
}) {
  const { token, toast, showError, confirm } = useAppActions();
  const [registration, setRegistration] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const busy = working !== null || undefined;
  const fieldId = useId();

  if (loading) {
    return (
      <section className="admin-sec" aria-labelledby={headingId}>
        <div className="admin-sec-head">
          <h3 id={headingId} className="admin-sec-t">
            Matrícula na {className}
          </h3>
        </div>
        {error ? (
          <ErrorState title="Não deu para carregar a matrícula" text={errorMessage(error)} onRetry={onRetry} />
        ) : (
          <SkeletonRows rows={1} label="Carregando a matrícula" />
        )}
      </section>
    );
  }

  if (!enrollment) {
    return (
      <section className="admin-sec" aria-labelledby={headingId}>
        <div className="admin-sec-head">
          <h3 id={headingId} className="admin-sec-t">
            Matrícula na {className}
          </h3>
        </div>
        <p className="callout past">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {first} não está na lista desta turma. Para incluir, use Adicionar alunos na turma.
        </p>
      </section>
    );
  }

  const item = enrollment;
  const value = registration ?? item.registration ?? "";
  const changed = value.trim() !== (item.registration ?? "");

  async function setStatus(status: EnrollmentStatus) {
    await updateEnrollment(token, item.enrollmentId, { status });
  }

  function decide(status: EnrollmentStatus, text: string, undoTo: EnrollmentStatus) {
    const key = `matricula-${item.enrollmentId}`;
    // curso integrado: o adulto que fica ativo na turma passa a contar como menor de idade (regra da API)
    const becomesMinor = status === "active" && integrated && isMinor === false;
    const go = () =>
      onRun(`status-${status}`, async () => {
        try {
          await setStatus(status);
          onChanged();
          toast(`${text}${becomesMinor ? ` ${first} passou a contar como menor de idade.` : ""}`, {
            key,
            // o Desfazer só volta a matrícula que continua como esta ação deixou; depois, tudo recarrega
            undo: async () => {
              try {
                const result = await undoEnrollments(token, item.academicClassId, [
                  { enrollmentId: item.enrollmentId, now: status, before: undoTo },
                ]);
                if (!result.undone) {
                  toast(`Nada para desfazer: a matrícula de ${first} mudou depois desta ação e ficou como está.`, {
                    tone: "info",
                    key,
                  });
                }
              } catch (failure) {
                showError(failure, key);
              } finally {
                onChanged();
              }
            },
          });
        } catch (failure) {
          showError(failure, key);
        }
      });
    if (!becomesMinor) {
      void go();
      return;
    }
    const reactivating = item.status !== "pending";
    const warning = minorWarning(
      [{ name: item.fullName ?? first, links: linksBack }],
      className,
      reactivating ? "reativar" : "aprovar"
    );
    confirm({
      title: warning.title,
      message: warning.message,
      confirmLabel: reactivating ? "Reativar mesmo assim" : "Aprovar mesmo assim",
      cancelLabel: reactivating ? "Manter fora da turma" : "Deixar o pedido pendente",
      tone: "primary",
      action: go,
    });
  }

  function saveRegistration(event: FormEvent) {
    event.preventDefault();
    if (!changed) {
      return;
    }
    const next = value.trim();
    if (next.length > 40) {
      setRegError("Use até 40 caracteres na matrícula escolar.");
      return;
    }
    void onRun("registration", async () => {
      try {
        await updateEnrollment(token, item.enrollmentId, { registration: next || null });
        setRegistration(null);
        setRegError(null);
        onChanged();
        toast(next ? `Matrícula escolar de ${first} salva.` : `Matrícula escolar de ${first} apagada.`, {
          key: `matricula-${item.enrollmentId}-registro`,
        });
      } catch (failure) {
        const byField = fieldErrors(failure);
        if (byField.registration) {
          setRegError(byField.registration);
          return;
        }
        showError(failure, `matricula-${item.enrollmentId}-registro`);
      }
    });
  }

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-sec-t">
            Matrícula na {className}
          </h3>
          <p className="admin-sec-s">
            {enrollmentSourceText(item.source)}, desde {formatDateBR(item.createdAt)}
          </p>
        </div>
        <span className={cx("pill", enrollmentPill[item.status] ?? "st-ag")}>{enrollmentStatusText(item.status)}</span>
      </div>

      <form className="admin-inline-form" noValidate onSubmit={saveRegistration}>
        <div className="min-w-0 flex-1">
          <Field label="Matrícula escolar" hint="é a que casa as notas importadas" error={regError ?? undefined}>
            <input
              id={fieldId}
              className="input admin-mono"
              autoComplete="off"
              maxLength={40}
              placeholder="Ex.: 2026TADS0012"
              value={value}
              onChange={(event) => {
                setRegistration(event.target.value);
                setRegError(null);
              }}
            />
          </Field>
        </div>
        <button className={cx(secondaryButton, busyLook)} aria-disabled={!changed || busy} type="submit">
          <Check className="h-4 w-4" aria-hidden />
          Salvar matrícula
        </button>
      </form>

      <div className="admin-code-acts">
        {item.status === "pending" ? (
          <>
            <button
              className={cx(primaryButton, "btn-sm", busyLook)}
              aria-disabled={busy}
              onClick={() => decide("active", `${first} entrou na ${className}.`, "pending")}
              type="button"
            >
              <UserCheck className="h-4 w-4" aria-hidden />
              Aprovar pedido
            </button>
            <button
              className={cx(secondaryButton, "btn-sm", busyLook)}
              aria-disabled={busy}
              onClick={() => decide("inactive", `Pedido de ${first} recusado.`, "pending")}
              type="button"
            >
              Recusar pedido
            </button>
          </>
        ) : item.status === "active" ? (
          <>
            <button
              className={cx(secondaryButton, "btn-sm", busyLook)}
              aria-disabled={busy}
              onClick={() => decide("inactive", `${first} saiu da ${className}. A matrícula fica no histórico.`, "active")}
              type="button"
            >
              <UserMinus className="h-4 w-4" aria-hidden />
              Remover da turma
            </button>
            <button
              className={cx(secondaryButton, "btn-sm", busyLook)}
              aria-disabled={busy}
              onClick={() => decide("completed", `Matrícula de ${first} na ${className} concluída.`, "active")}
              type="button"
            >
              <Check className="h-4 w-4" aria-hidden />
              Concluir matrícula
            </button>
          </>
        ) : (
          <button
            className={cx(secondaryButton, "btn-sm", busyLook)}
            aria-disabled={busy}
            onClick={() => decide("active", `${first} voltou para a ${className}.`, item.status as EnrollmentStatus)}
            type="button"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Reativar na turma
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Menor de idade                                                      */
/* ------------------------------------------------------------------ */

function MinorBlock({
  first,
  headingId,
  isMinor,
  userId,
  working,
  onChanged,
  onRun,
}: BlockProps & { isMinor: boolean; userId: number }) {
  const { token, toast, showError } = useAppActions();
  const hintId = useId();

  function toggle(next: boolean) {
    void onRun("minor", async () => {
      try {
        const result = await updateUserMinor(token, userId, next);
        onChanged();
        const extra = next
          ? result.linksToApprove
            ? ` ${plural(result.linksToApprove, "vínculo voltou", "vínculos voltaram")} a esperar a sua aprovação.`
            : ""
          : result.linksToReview
            ? ` ${first} vai confirmar ou encerrar ${plural(result.linksToReview, "vínculo", "vínculos")} no perfil.`
            : "";
        toast(`${first} ${next ? "agora conta como menor de idade" : "não conta mais como menor de idade"}.${extra}`, {
          key: `menor-${userId}`,
        });
      } catch (failure) {
        showError(failure, `menor-${userId}`);
      }
    });
  }

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <h3 id={headingId} className="admin-sec-t">
          Idade
        </h3>
      </div>
      <label className="admin-switch">
        <input
          aria-describedby={hintId}
          checked={isMinor}
          disabled={working !== null}
          role="switch"
          type="checkbox"
          onChange={(event) => toggle(event.target.checked)}
        />
        <span className="admin-switch-track" aria-hidden />
        <span className="admin-switch-label">Menor de idade</span>
      </label>
      <p id={hintId} className="field-help">
        {isMinor
          ? `Cada responsável de ${first} só passa a ver a agenda depois da aprovação da secretaria, e ${first} não desfaz os vínculos feitos por ela.`
          : `${first} gera o próprio código e decide quem acompanha a agenda. Ao marcar, os vínculos que a secretaria ainda não aprovou voltam a esperar a aprovação.`}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Responsáveis                                                        */
/* ------------------------------------------------------------------ */

const linkOrder: Record<string, number> = { pending: 0, active: 1, blocked: 2, revoked: 3 };

function GuardiansBlock({
  data,
  first,
  headingId,
  studentId,
  working,
  onChanged,
  onRun,
}: BlockProps & { data: StudentGuardians; studentId: number }) {
  const { token, toast, showError, confirm } = useAppActions();
  const [blocking, setBlocking] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const busy = working !== null || undefined;
  const links = [...data.guardians].sort(
    (a, b) => (linkOrder[a.status] ?? 9) - (linkOrder[b.status] ?? 9) || (a.fullName ?? "").localeCompare(b.fullName ?? "", "pt-BR")
  );
  const open = links.filter((link) => link.status === "active" || link.status === "pending").length;

  /**
   * Aprovar o pedido pendente. A API não tem como voltar um vínculo aprovado para pendente: o Desfazer encerra o
   * vínculo (o responsável deixa de ver a agenda) e o aviso diz isso. Depois, tudo recarrega.
   */
  function approve(link: AdminGuardianLink) {
    const name = link.fullName ?? link.email;
    const key = `vinculo-${link.id}`;
    void onRun(`approve-${link.id}`, async () => {
      try {
        await approveGuardianLink(token, link.id);
        onChanged();
        toast(`Pedido de ${name} aprovado. ${name} já vê a agenda de ${first}.`, {
          key,
          undo: async () => {
            try {
              await revokeGuardianLink(token, link.id);
              toast(
                `Aprovação desfeita: ${name} não vê mais a agenda de ${first}, e o pedido ficou encerrado. Para liberar de novo, use Vincular de novo.`,
                { tone: "info", key }
              );
            } catch (failure) {
              showError(failure, key);
            } finally {
              onChanged();
            }
          },
        });
      } catch (failure) {
        showError(failure, key);
      }
    });
  }

  /**
   * Desfazer o vínculo ativo ou recusar o pedido pendente (a mesma rota, DELETE /guardian-links/:id). O Desfazer
   * do aviso restaura o que era (ativo ou pendente). Depois, tudo recarrega.
   */
  function revoke(link: AdminGuardianLink) {
    const name = link.fullName ?? link.email;
    const key = `vinculo-${link.id}`;
    const wasPending = link.status === "pending";
    void onRun(`revoke-${link.id}`, async () => {
      try {
        await revokeGuardianLink(token, link.id);
        onChanged();
        toast(
          wasPending
            ? `Pedido de ${name} recusado. ${name} não vai acompanhar a agenda de ${first}.`
            : `${name} deixou de acompanhar a agenda de ${first}.`,
          {
            key,
            undo: async () => {
              try {
                await restoreGuardianLink(token, link.id);
              } catch (failure) {
                showError(failure, key);
              } finally {
                onChanged();
              }
            },
          }
        );
      } catch (failure) {
        showError(failure, key);
      }
    });
  }

  function block(event: FormEvent, link: AdminGuardianLink) {
    event.preventDefault();
    const text = reason.trim();
    if (text.length < 3) {
      setReasonError("Escreva o motivo do bloqueio, com pelo menos 3 caracteres. Ex.: pedido da família com documento.");
      return;
    }
    void onRun(`block-${link.id}`, async () => {
      try {
        await blockGuardianLink(token, link.id, text);
        setBlocking(null);
        setReason("");
        setReasonError(null);
        onChanged();
        toast(`${link.fullName ?? "O responsável"} foi bloqueado para ${first}. Nenhum código passa por cima do bloqueio.`, {
          key: `vinculo-${link.id}`,
        });
      } catch (failure) {
        const byField = fieldErrors(failure);
        if (byField.reason) {
          setReasonError(byField.reason);
          return;
        }
        showError(failure, `vinculo-${link.id}`);
      }
    });
  }

  function relink(link: AdminGuardianLink) {
    const send = (unblock: boolean) =>
      onRun(`relink-${link.id}`, async () => {
        try {
          await linkGuardianByEmail(token, studentId, {
            email: link.email,
            relationship: link.relationship,
            unblock: unblock || undefined,
          });
          onChanged();
          toast(`${link.fullName ?? "O responsável"} voltou a acompanhar a agenda de ${first}.`, { key: `vinculo-${link.id}` });
        } catch (failure) {
          showError(failure, `vinculo-${link.id}`);
        }
      });
    if (link.status === "blocked") {
      confirm({
        title: `Desbloquear ${link.fullName ?? "o responsável"}?`,
        message: `O bloqueio deixa de valer e ${link.fullName ?? "o responsável"} volta a ver a agenda de ${first}. Confira o motivo do bloqueio antes${
          link.revokeReason ? `: "${link.revokeReason}"` : ""
        }.`,
        confirmLabel: "Desbloquear e vincular",
        cancelLabel: "Manter bloqueio",
        tone: "primary",
        action: () => send(true),
      });
      return;
    }
    void send(false);
  }

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-sec-t">
            Responsáveis
          </h3>
          <p className="admin-sec-s">
            {open
              ? `${plural(open, "vínculo ativo ou pendente", "vínculos ativos ou pendentes")}, de no máximo ${data.limits.maxLinks}`
              : `Ninguém acompanha a agenda de ${first}`}
          </p>
        </div>
      </div>
      {links.length ? (
        <ul className="admin-glist">
          {links.map((link) => {
            const label = link.fullName ?? link.email;
            const muted = link.status === "revoked";
            return (
              <li key={link.id} className={cx("admin-guard", link.status === "pending" && "warn", muted && "muted")}>
                <div className="admin-guard-top">
                  <span className="admin-av-xs" aria-hidden>
                    {initialsOf(label)}
                  </span>
                  <div className="admin-s-main">
                    <p className="admin-s-name">{label}</p>
                    <p className="admin-s-mail wrap-anywhere">{link.email}</p>
                  </div>
                  <span className={cx("pill", linkPill[link.status] ?? "st-ag")}>{linkStatusText(link.status)}</span>
                </div>
                <p className="admin-guard-meta">
                  {relationshipText(link.relationship)}, {linkOriginText(link.origin).toLowerCase()}
                  {link.status === "active" || link.status === "pending" ? `, desde ${formatDateBR(link.since)}` : ""}
                  {link.revokedAt && (link.status === "revoked" || link.status === "blocked")
                    ? `, ${link.status === "blocked" ? "bloqueado" : "desfeito"} em ${formatDateBR(link.revokedAt)}`
                    : ""}
                  {link.needsReview ? `. ${first} ainda vai confirmar este vínculo` : ""}
                </p>
                {link.status === "blocked" && link.revokeReason ? (
                  <p className="admin-guard-meta">Motivo: {link.revokeReason}</p>
                ) : null}

                {blocking === link.id ? (
                  <form className="admin-inline-form mt-3" noValidate onSubmit={(event) => block(event, link)}>
                    <div className="min-w-0 flex-1">
                      <Field label="Motivo do bloqueio" hint="o responsável não vê o motivo" error={reasonError ?? undefined}>
                        <input
                          className="input"
                          autoComplete="off"
                          autoFocus
                          maxLength={200}
                          placeholder="Ex.: pedido da família com documento"
                          value={reason}
                          onChange={(event) => {
                            setReason(event.target.value);
                            setReasonError(null);
                          }}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className={cx("btn btn-d btn-sm", busyLook)} aria-disabled={busy} type="submit">
                        <ShieldBan className="h-4 w-4" aria-hidden />
                        Bloquear
                      </button>
                      <button
                        className={cx(secondaryButton, "btn-sm")}
                        onClick={() => {
                          setBlocking(null);
                          setReasonError(null);
                        }}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="admin-guard-acts">
                    {link.status === "pending" ? (
                      <button
                        className={cx(primaryButton, "btn-sm", busyLook)}
                        aria-disabled={busy}
                        aria-label={`Aprovar o pedido de ${label}`}
                        onClick={() => approve(link)}
                        type="button"
                      >
                        <Check className="h-4 w-4" aria-hidden />
                        Aprovar
                      </button>
                    ) : null}
                    {link.status === "pending" ? (
                      <button
                        className={cx(secondaryButton, "btn-sm", busyLook)}
                        aria-disabled={busy}
                        aria-label={`Recusar o pedido de ${label}`}
                        onClick={() => revoke(link)}
                        type="button"
                      >
                        <X className="h-4 w-4" aria-hidden />
                        Recusar
                      </button>
                    ) : null}
                    {link.status === "active" || link.status === "pending" ? (
                      <>
                        {link.status === "active" ? (
                          <button
                            className={cx(secondaryButton, "btn-sm", busyLook)}
                            aria-disabled={busy}
                            aria-label={`Desfazer o vínculo de ${label}`}
                            onClick={() => revoke(link)}
                            type="button"
                          >
                            <UserMinus className="h-4 w-4" aria-hidden />
                            Desfazer vínculo
                          </button>
                        ) : null}
                        <button
                          className={cx(secondaryButton, "btn-sm", busyLook)}
                          aria-disabled={busy}
                          aria-label={`Bloquear ${label}`}
                          onClick={() => {
                            setBlocking(link.id);
                            setReason("");
                            setReasonError(null);
                          }}
                          type="button"
                        >
                          <Ban className="h-4 w-4" aria-hidden />
                          Bloquear
                        </button>
                      </>
                    ) : (
                      <button
                        className={cx(secondaryButton, "btn-sm", busyLook)}
                        aria-disabled={busy}
                        aria-label={`${link.status === "blocked" ? "Desbloquear" : "Vincular de novo"} ${label}`}
                        onClick={() => relink(link)}
                        type="button"
                      >
                        <Link2 className="h-4 w-4" aria-hidden />
                        {link.status === "blocked" ? "Desbloquear" : "Vincular de novo"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="callout past">
          <UserPlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Vincule o responsável pelo e-mail da conta dele ou gere um código para entregar impresso.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Vincular responsável por e-mail                                     */
/* ------------------------------------------------------------------ */

function LinkByEmailBlock({ first, headingId, studentId, working, onChanged, onRun }: BlockProps & { studentId: number }) {
  const { token, toast, showError, confirm } = useAppActions();
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState<GuardianRelationship | "">("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [blocked, setBlocked] = useState<string | null>(null);
  const busy = working !== null || undefined;

  function validate() {
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Digite o e-mail da conta do responsável. Ex.: maria@agenda.test.";
    }
    if (!relationship) {
      next.relationship = "Escolha o parentesco.";
    }
    return next;
  }

  async function send(unblock: boolean) {
    if (!relationship) {
      return;
    }
    try {
      const link = await linkGuardianByEmail(token, studentId, { email: email.trim(), relationship, unblock: unblock || undefined });
      setEmail("");
      setRelationship("");
      setErrors({});
      setBlocked(null);
      onChanged();
      toast(`${link.fullName ?? link.email} agora acompanha a agenda de ${first}.`, {
        key: `vinculo-${link.id}`,
        undo: async () => {
          try {
            await revokeGuardianLink(token, link.id);
          } catch (failure) {
            showError(failure, `vinculo-${link.id}`);
          } finally {
            onChanged();
          }
        },
      });
    } catch (failure) {
      const isBlocked = conflictOf(failure, "BLOCKED");
      if (isBlocked) {
        setBlocked(isBlocked.message);
        return;
      }
      const limit = conflictOf(failure, "LINK_LIMIT");
      if (limit) {
        setErrors({ form: limit.message });
        return;
      }
      const byField = fieldErrors(failure);
      if (Object.keys(byField).length) {
        setErrors(byField);
        return;
      }
      showError(failure, `vincular-${studentId}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setBlocked(null);
    if (Object.keys(found).length) {
      return;
    }
    void onRun("link-email", () => send(false));
  }

  function unblock() {
    confirm({
      title: "Desbloquear e vincular?",
      message: `Este responsável foi bloqueado para ${first} (por exemplo, por ordem judicial). Ao vincular, o bloqueio deixa de valer e ele volta a ver a agenda.`,
      confirmLabel: "Desbloquear e vincular",
      cancelLabel: "Manter bloqueio",
      tone: "primary",
      action: () => onRun("link-email", () => send(true)),
    });
  }

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-sec-t">
            Vincular responsável por e-mail
          </h3>
          <p className="admin-sec-s">A pessoa precisa já ter uma conta de responsável na Agenda.</p>
        </div>
      </div>
      <form className="grid gap-3" noValidate onSubmit={submit}>
        {errors.form ? (
          <p className="callout rose" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {errors.form}
          </p>
        ) : null}
        <div className="admin-grid">
          <div className="admin-span4">
            <Field label="E-mail do responsável" error={errors.email}>
              <input
                className="input"
                autoComplete="off"
                inputMode="email"
                placeholder="Ex.: maria@agenda.test"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setBlocked(null);
                  setErrors((current) => ({ ...current, email: "", form: "" }));
                }}
              />
            </Field>
          </div>
          <div className="admin-span2">
            <Field label="Parentesco" error={errors.relationship}>
              <select
                className="input"
                value={relationship}
                onChange={(event) => {
                  setRelationship(event.target.value as GuardianRelationship);
                  setErrors((current) => ({ ...current, relationship: "" }));
                }}
              >
                <option value="" disabled>
                  Escolha
                </option>
                {relationshipOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        {blocked ? (
          <div className="callout rose" role="alert">
            <ShieldBan className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p>{blocked}</p>
              <button className={cx(secondaryButton, "btn-sm mt-2", busyLook)} aria-disabled={busy} onClick={unblock} type="button">
                Desbloquear e vincular
              </button>
            </div>
          </div>
        ) : null}
        <div>
          <button className={cx(secondaryButton, busyLook)} aria-disabled={busy} type="submit">
            <UserPlus className="h-4 w-4" aria-hidden />
            Vincular
          </button>
        </div>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Código para responsável                                             */
/* ------------------------------------------------------------------ */

function GuardianCodeBlock({
  codes,
  first,
  headingId,
  name,
  studentId,
  working,
  onChanged,
  onRun,
}: BlockProps & { codes: GuardianCodeInfo[]; name: string; studentId: number }) {
  const { token, toast, showError, confirm } = useAppActions();
  // o código em claro aparece uma vez só: some ao sair deste painel
  const [created, setCreated] = useState<GuardianCodeCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = working !== null || undefined;

  function generate() {
    setError(null);
    void onRun("code", async () => {
      try {
        const code = await createStudentGuardianCode(token, studentId);
        setCreated(code);
        onChanged();
      } catch (failure) {
        const limit = conflictOf(failure, "CODE_LIMIT") ?? conflictOf(failure, "LINK_LIMIT");
        if (limit) {
          setError(limit.message);
          return;
        }
        showError(failure, `codigo-resp-${studentId}`);
      }
    });
  }

  function cancel(code: GuardianCodeInfo) {
    confirm({
      title: "Cancelar este código?",
      message: `Quem tiver o código não consegue mais usar para acompanhar a agenda de ${first}. Não dá para desfazer; se precisar, gere outro.`,
      confirmLabel: "Cancelar código",
      cancelLabel: "Manter código",
      action: async () => {
        try {
          const result = await cancelStudentGuardianCode(token, studentId, code.id);
          if (created?.id === code.id) {
            setCreated(null);
          }
          setError(null);
          onChanged();
          toast(result.message || "Código cancelado.", { key: `codigo-resp-${code.id}` });
        } catch (failure) {
          showError(failure, `codigo-resp-${code.id}`);
          onChanged();
        }
      },
    });
  }

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-sec-t">
            Código para responsável
          </h3>
          <p className="admin-sec-s">Vale 30 dias e uma vez só. Bom para entregar impresso na secretaria.</p>
        </div>
      </div>

      {created ? (
        <div className="admin-codebox admin-codebox-new" role="status">
          <span className="mini-ico">
            <KeyRound className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="admin-code-big" aria-label={`Código: ${created.codeFormatted.split("").join(" ")}`}>
              {created.codeFormatted}
            </p>
            <p className="admin-p-sub">Vale até {formatDateBR(created.expiresAt)}. {created.message}</p>
            <p className="admin-p-sub font-semibold text-ink-3">Este código aparece só agora: copie ou imprima antes de sair.</p>
            <div className="admin-code-acts">
              <CopyButton text={created.codeFormatted} />
              <PrintButton
                onPrint={() => printGuardianCode({ studentName: name, code: created.codeFormatted, expiresAt: created.expiresAt })}
              />
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="field-error" role="alert">
          <CircleAlert aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}

      <div className="admin-code-acts">
        <button className={cx(secondaryButton, "btn-sm", busyLook)} aria-disabled={busy} onClick={generate} type="button">
          <KeyRound className="h-4 w-4" aria-hidden />
          {created ? "Gerar outro código" : "Gerar código para responsável"}
        </button>
      </div>

      {codes.length ? (
        <>
          <p className="admin-group mt-4">Códigos válidos ({codes.length})</p>
          <ul className="admin-people">
            {codes.map((code) => (
              <li key={code.id} className="admin-irow">
                <span className="admin-s-main">
                  <span className="admin-s-name">{code.kind === "admin" ? "Código da secretaria" : `Código gerado por ${first}`}</span>
                  <span className="admin-s-mail">
                    Gerado em {formatDateBR(code.createdAt)}, vale até {formatDateBR(code.expiresAt)}
                    {created?.id === code.id ? ", o que está acima" : ""}
                  </span>
                </span>
                <button
                  className={cx(secondaryButton, "btn-sm", busyLook)}
                  aria-disabled={busy}
                  aria-label={`Cancelar o código gerado em ${formatDateBR(code.createdAt)}`}
                  onClick={() => cancel(code)}
                  type="button"
                >
                  Cancelar código
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
