"use client";

import { Bell, Loader2, Save } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { reminderOptions, roleLabels } from "@/lib/meta";
import type { User } from "@/lib/types";
import { ProfileGuardians } from "./profile-guardians";
import { ProfileStudents } from "./profile-students";
import { ConfirmDialog, Field, Modal } from "./ui";

export type ProfileFormState = {
  fullName: string;
  defaultReminderMinutes: string;
};

// enquanto salva, os botões continuam focáveis, só ficam apagados
const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/** Nome com pelo menos 3 letras, sem espaços sobrando. */
function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function ProfileModal({
  saving,
  user,
  onClose,
  onSave,
}: {
  saving: boolean;
  user: User;
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
  const formId = useId();
  const nameErrorId = useId();

  const dirty =
    cleanName(form.fullName) !== cleanName(initial.fullName) || form.defaultReminderMinutes !== initial.defaultReminderMinutes;
  const options = reminderOptions.some((option) => option.value === initial.defaultReminderMinutes)
    ? reminderOptions
    : [...reminderOptions, { value: initial.defaultReminderMinutes, label: `${initial.defaultReminderMinutes} minutos antes` }];

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
      nameRef.current?.focus();
      return;
    }
    onSave({ ...form, fullName });
  }

  return (
    <>
      <Modal
        busy={saving}
        initialFocusRef={nameRef}
        onClose={requestClose}
        title="Configurações do perfil"
        footer={
          <>
            <button className={`btn btn-s ${busyLook}`} aria-disabled={saving || undefined} onClick={requestClose} type="button">
              Cancelar
            </button>
            <button className={`btn btn-p ${busyLook}`} aria-disabled={saving || undefined} form={formId} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {saving ? "Salvando" : "Salvar preferências"}
            </button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} noValidate>
          <div className="flex items-center gap-3.5 rounded-2xl border border-line-2 bg-surface-2 p-4">
            <span className="disp flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-night text-[15px] font-bold text-accent">
              {user.initials ?? (user.fullName ?? user.email).slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold">{user.fullName ?? user.email}</p>
              <p className="truncate text-sm text-muted">{user.email}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="pill st-ag">{roleLabels[user.role]}</span>
                {user.registration && user.role !== "guardian" ? (
                  // matrícula comprida e sem espaço: corta com reticência na largura do cartão, inteira no title
                  <span className="pill st-ag min-w-0 max-w-full" title={user.registration}>
                    <span className="truncate">{user.registration}</span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
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

            <Field label="Lembrete padrão" hint="usado ao ativar novos lembretes">
              <select
                className="input"
                value={form.defaultReminderMinutes}
                onChange={(event) => setForm({ ...form, defaultReminderMinutes: event.target.value })}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            {/* o canal num quadro e a observação embaixo, como no Figma; o aviso é no próprio sistema */}
            <div className="grid gap-2">
              <span className="lbl">Avisos</span>
              <div className="flex items-start gap-3 rounded-2xl border border-line-2 bg-surface-2 px-4 py-3">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 text-sm leading-5">
                  <span className="block font-bold text-ink">No sistema</span>
                  <span className="block text-muted">Na hora marcada, o aviso aparece no Painel e em Lembretes.</span>
                </span>
              </div>
              <p className="field-help !mt-1">O envio por e-mail é o próximo passo.</p>
            </div>
          </div>
        </form>

        {/* fora do formulário: as ações dessas seções valem na hora, sem o Salvar preferências */}
        {user.role === "student" ? (
          <div className="mt-5">
            <ProfileGuardians user={user} />
          </div>
        ) : null}
        {user.role === "guardian" ? (
          <div className="mt-5">
            <ProfileStudents />
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
