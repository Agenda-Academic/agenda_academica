"use client";

import { Loader2, Mail, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { reminderOptions, roleLabels } from "@/lib/meta";
import type { User } from "@/lib/types";
import { Field, Modal } from "./ui";

export type ProfileFormState = {
  fullName: string;
  defaultReminderMinutes: string;
};

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
  const [form, setForm] = useState<ProfileFormState>({
    fullName: user.fullName ?? "",
    defaultReminderMinutes: String(user.defaultReminderMinutes),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <Modal onClose={onClose} title="Configurações do perfil">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-3.5 rounded-2xl border border-line-2 bg-surface-2 p-4">
          <span className="disp flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-night text-[15px] font-bold text-accent">
            {user.initials ?? (user.fullName ?? user.email).slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold">{user.fullName ?? user.email}</p>
            <p className="truncate text-[13px] text-muted">{user.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="pill st-ag">{roleLabels[user.role]}</span>
              {user.registration ? <span className="pill st-ag">{user.registration}</span> : null}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <Field label="Nome completo">
            <input
              className="input"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              autoComplete="name"
              required
            />
          </Field>

          <Field label="Lembrete padrão" hint="usado ao ativar novos lembretes">
            <select
              className="input"
              value={form.defaultReminderMinutes}
              onChange={(event) => setForm({ ...form, defaultReminderMinutes: event.target.value })}
            >
              {reminderOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-2">
            <span className="lbl">Avisos</span>
            <div className="flex items-center gap-3 rounded-2xl border border-line-2 bg-surface-2 px-4 py-3">
              <Mail className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-bold">Por e-mail</span>
                <span className="block truncate text-xs text-muted">{user.email}</span>
              </span>
            </div>
            <p className="field-help !mt-1">
              O envio por e-mail está previsto. Hoje o sistema registra o lembrete no horário do aviso.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2.5 border-t border-line-2 pt-5">
          <button className="btn btn-s" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn btn-p" disabled={saving} type="submit">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Salvar preferências
          </button>
        </div>
      </form>
    </Modal>
  );
}
