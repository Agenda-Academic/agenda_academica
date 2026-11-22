"use client";

import { Loader2, Save } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { cx } from "@/lib/format";
import { roleLabels } from "@/lib/meta";
import type { User } from "@/lib/types";
import { ProfileGuardians } from "./profile-guardians";
import { ProfileStudents } from "./profile-students";
import { DefaultReminderSelect, ReminderChannels } from "./reminders-view";
import { ConfirmDialog, Field, Modal } from "./ui";

export type ProfileFormState = {
  fullName: string;
  defaultReminderMinutes: string;
};

// enquanto salva, os botões continuam focáveis, só ficam apagados
const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/** Aba do perfil: "prefs" (Preferências) ou "links" (Responsáveis, para o aluno; Alunos, para o responsável). */
export type ProfileTab = "prefs" | "links";

/** Nome com pelo menos 3 letras, sem espaços sobrando. */
function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function ProfileModal({
  saving,
  user,
  initialTab = "prefs",
  onClose,
  onSave,
}: {
  saving: boolean;
  user: User;
  /** Aba de quando o perfil abre (o aviso de responsável vinculado abre direto na aba dos vínculos). */
  initialTab?: ProfileTab;
  onClose: () => void;
  onSave: (form: ProfileFormState) => void;
}) {
  // valores de quando o diálogo abriu, para saber se algo mudou
  const [initial] = useState<ProfileFormState>(() => ({
    fullName: user.fullName ?? "",
    defaultReminderMinutes: String(user.defaultReminderMinutes),
  }));
  const [form, setForm] = useState<ProfileFormState>(initial);
  const [nameError, setNameError] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const prefsTabRef = useRef<HTMLButtonElement>(null);
  const linksTabRef = useRef<HTMLButtonElement>(null);
  const reminderRef = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const nameErrorId = useId();
  const tabsId = useId();
  // aluno e responsável: duas abas. "Preferências" (nome e lembrete padrão, com Salvar) e a dos vínculos
  // ("Responsáveis" ou "Alunos"), cujas ações valem na hora e por isso ficam longe do Salvar
  const linksLabel = user.role === "student" ? "Responsáveis" : user.role === "guardian" ? "Alunos" : null;
  // a aba pedida só vale para quem tem a dos vínculos (aluno e responsável)
  const [tab, setTab] = useState<ProfileTab>(() => (linksLabel ? initialTab : "prefs"));
  // ao abrir, o foco nunca vai para o campo do nome (no celular o teclado subiria cobrindo a folha, e o anel azul no
  // nome parecia pedir para trocá-lo): fica na aba aberta (a pessoa vê onde está e anda com as setas) ou, sem abas,
  // no primeiro controle que não abre teclado, a antecedência padrão
  const [openedOnLinks] = useState(() => Boolean(linksLabel) && initialTab === "links");
  const initialFocusRef = openedOnLinks ? linksTabRef : linksLabel ? prefsTabRef : reminderRef;

  const dirty =
    cleanName(form.fullName) !== cleanName(initial.fullName) || form.defaultReminderMinutes !== initial.defaultReminderMinutes;

  function requestClose() {
    if (saving) {
      return;
    }
    if (dirty) {
      setAskDiscard(true);
      return;
    }
    onClose();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) {
      return;
    }
    const fullName = cleanName(form.fullName);
    if ((fullName.match(/\p{L}/gu) ?? []).length < 3) {
      setNameError("Digite seu nome completo.");
      setTab("prefs");
      nameRef.current?.focus();
      return;
    }
    onSave({ ...form, fullName });
  }

  // abas com as setas, Home e End (o foco anda junto com a escolha)
  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const next: ProfileTab =
      event.key === "Home" ? "prefs" : event.key === "End" ? "links" : tab === "prefs" ? "links" : "prefs";
    setTab(next);
    (next === "prefs" ? prefsTabRef : linksTabRef).current?.focus();
  }

  const onPrefs = tab === "prefs" || !linksLabel;

  return (
    <>
      <Modal
        busy={saving}
        initialFocusRef={initialFocusRef}
        onClose={requestClose}
        title="Configurações do perfil"
        footer={
          onPrefs ? (
            <>
              <button className={`btn btn-s ${busyLook}`} aria-disabled={saving || undefined} onClick={requestClose} type="button">
                Cancelar
              </button>
              <button className={`btn btn-p ${busyLook}`} aria-disabled={saving || undefined} form={formId} type="submit">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                {saving ? "Salvando" : "Salvar preferências"}
              </button>
            </>
          ) : (
            // na aba dos vínculos nada espera o Salvar: só consulta e ações que valem na hora
            <button className={`btn btn-s ${busyLook}`} aria-disabled={saving || undefined} onClick={requestClose} type="button">
              Fechar
            </button>
          )
        }
      >
        {/* quem é: o avatar no quadrado verde (como o logo), o nome em Sora e o papel e a matrícula em pílulas */}
        <div className="prof-head">
          <span className="prof-av" aria-hidden>
            {user.initials ?? (user.fullName ?? user.email).slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="prof-name truncate">{user.fullName ?? user.email}</p>
            <p className="prof-mail truncate">{user.email}</p>
            <div className="prof-chips">
              <span className="prof-chip">{roleLabels[user.role]}</span>
              {user.registration && user.role !== "guardian" ? (
                // matrícula comprida e sem espaço: corta com reticência na largura do cartão, inteira no title
                <span className="prof-chip min-w-0 max-w-full" title={user.registration}>
                  <span className="truncate">{user.registration}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {linksLabel ? (
          <div className="seg prof-tabs" role="tablist" aria-label="Partes do perfil">
            <button
              ref={prefsTabRef}
              id={`${tabsId}-prefs`}
              className={cx(tab === "prefs" && "on")}
              role="tab"
              aria-selected={tab === "prefs"}
              aria-controls={`${tabsId}-prefs-painel`}
              tabIndex={tab === "prefs" ? 0 : -1}
              onClick={() => setTab("prefs")}
              onKeyDown={tabKeyDown}
              type="button"
            >
              Preferências
            </button>
            <button
              ref={linksTabRef}
              id={`${tabsId}-links`}
              className={cx(tab === "links" && "on")}
              role="tab"
              aria-selected={tab === "links"}
              aria-controls={`${tabsId}-links-painel`}
              tabIndex={tab === "links" ? 0 : -1}
              onClick={() => setTab("links")}
              onKeyDown={tabKeyDown}
              type="button"
            >
              {linksLabel}
            </button>
          </div>
        ) : null}

        <div
          id={`${tabsId}-prefs-painel`}
          role={linksLabel ? "tabpanel" : undefined}
          aria-labelledby={linksLabel ? `${tabsId}-prefs` : undefined}
          hidden={!onPrefs}
          className={linksLabel ? "prof-panel" : "mt-5"}
        >
          <form id={formId} onSubmit={handleSubmit} noValidate>
            <div className="grid gap-4">
              <Field label="Nome completo" error={nameError ?? undefined} errorId={nameErrorId}>
                <input
                  ref={nameRef}
                  className="input"
                  value={form.fullName}
                  onChange={(event) => {
                    setForm({ ...form, fullName: event.target.value });
                    setNameError(null);
                  }}
                  autoComplete="name"
                  maxLength={120}
                />
              </Field>

              {/* o mesmo controle, as mesmas opções e os mesmos textos da tela Lembretes */}
              <DefaultReminderSelect
                value={Number(form.defaultReminderMinutes)}
                keep={Number(initial.defaultReminderMinutes)}
                buttonRef={reminderRef}
                onChange={(minutes) => setForm({ ...form, defaultReminderMinutes: String(minutes) })}
              />

              <div className="prof-ch">
                <span className="lbl">Onde o aviso chega</span>
                <ReminderChannels email={user.email} />
              </div>
            </div>
          </form>
        </div>

        {/* a aba dos vínculos fica montada (o código recém-gerado continua lá ao voltar de Preferências) */}
        {linksLabel ? (
          <div
            id={`${tabsId}-links-painel`}
            role="tabpanel"
            aria-labelledby={`${tabsId}-links`}
            hidden={onPrefs}
            className="prof-panel"
          >
            {user.role === "student" ? <ProfileGuardians user={user} /> : <ProfileStudents />}
          </div>
        ) : null}
      </Modal>

      {askDiscard ? (
        <ConfirmDialog
          busy={false}
          confirm={{
            title: "Descartar alterações?",
            message: "As mudanças nas suas preferências ainda não foram salvas.",
            confirmLabel: "Descartar",
            cancelLabel: "Continuar editando",
            action: onClose,
          }}
          onCancel={() => setAskDiscard(false)}
          onConfirm={() => {
            setAskDiscard(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}
