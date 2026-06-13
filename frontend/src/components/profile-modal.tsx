"use client";

import { Loader2, Mail, Save, Smartphone } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cx } from "@/lib/format";
import { reminderOptions, roleLabels } from "@/lib/meta";
import type { User } from "@/lib/types";
import { Field, Modal, primaryButton } from "./ui";

export type ProfileFormState = {
  fullName: string;
  defaultReminderMinutes: string;
  notificationChannel: "email" | "push";
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
    notificationChannel: user.notificationChannel,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <Modal onClose={onClose} title="Configurações do perfil">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-sm font-bold text-emerald-800 shadow-sm">
            {user.initials ?? (user.fullName ?? user.email).slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{user.email}</p>
            <p className="text-xs text-slate-500">
              {roleLabels[user.role]}
              {user.registration ? ` · ${user.registration}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="Nome completo">
            <input
              className="input"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              autoComplete="name"
              required
            />
          </Field>

          <Field label="Lembrete padrão" hint="usado ao ativar lembretes novos">
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

          <Field label="Canal de notificação">
            <div className="grid grid-cols-2 gap-2">
              <button
                className={cx(
                  "flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition",
                  form.notificationChannel === "email"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
                aria-pressed={form.notificationChannel === "email"}
                onClick={() => setForm({ ...form, notificationChannel: "email" })}
                type="button"
              >
                <Mail className="h-4 w-4" aria-hidden />
                E-mail
              </button>
              <button
                className={cx(
                  "flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition",
                  form.notificationChannel === "push"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
                aria-pressed={form.notificationChannel === "push"}
                onClick={() => setForm({ ...form, notificationChannel: "push" })}
                type="button"
              >
                <Smartphone className="h-4 w-4" aria-hidden />
                Push
              </button>
            </div>
          </Field>
        </div>

        <button className={cx(primaryButton, "mt-5 w-full")} disabled={saving} type="submit">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          Salvar preferências
        </button>
      </form>
    </Modal>
  );
}
