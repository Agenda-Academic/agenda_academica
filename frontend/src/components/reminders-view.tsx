"use client";

import { Bell, BellOff, CalendarClock, CheckCircle2, Clock, Mail, Smartphone } from "lucide-react";
import { cx, formatDate, relativeDue } from "@/lib/format";
import { categoryMeta, reminderOffsetLabel } from "@/lib/meta";
import type { Reminder } from "@/lib/types";
import { EmptyState, SectionTitle, secondaryButton } from "./ui";

function ReminderCard({
  isSent,
  reminder,
  saving,
  onDelete,
  onOpenEvent,
}: {
  isSent: boolean;
  reminder: Reminder;
  saving: boolean;
  onDelete: (reminder: Reminder) => void;
  onOpenEvent: (id: number) => void;
}) {
  const event = reminder.academicEvent ?? null;
  const meta = event ? categoryMeta[event.category] : null;

  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {meta ? (
            <span className={cx("inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold", meta.pill)}>
              {meta.short}
            </span>
          ) : null}
          {event ? (
            <button
              className="truncate text-left font-semibold text-slate-950 underline-offset-4 transition hover:text-emerald-800 hover:underline"
              onClick={() => onOpenEvent(event.id)}
              type="button"
            >
              {event.title}
            </button>
          ) : (
            <span className="truncate font-semibold text-slate-950">
              Evento #{reminder.academicEventId}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          {event ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-slate-400" aria-hidden />
              Evento {relativeDue(event.startsAt)} · {formatDate(event.startsAt)}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-slate-400" aria-hidden />
            {reminderOffsetLabel(reminder.offsetMinutes)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {reminder.channel === "email" ? (
              <Mail className="h-4 w-4 text-slate-400" aria-hidden />
            ) : (
              <Smartphone className="h-4 w-4 text-slate-400" aria-hidden />
            )}
            {reminder.channel === "email" ? "E-mail" : "Push"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isSent ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Enviado {reminder.sentAt ? formatDate(reminder.sentAt) : ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-800">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            Envio {formatDate(reminder.sendAt)}
          </span>
        )}
        <button
          className={cx(secondaryButton, "h-9 min-h-0 px-3 text-rose-600 hover:text-rose-700")}
          disabled={saving}
          onClick={() => onDelete(reminder)}
          title="Remover lembrete"
          type="button"
        >
          <BellOff className="h-3.5 w-3.5" aria-hidden />
          Remover
        </button>
      </div>
    </div>
  );
}

export function RemindersView({
  reminders,
  saving,
  onDelete,
  onOpenEvent,
}: {
  reminders: Reminder[];
  saving: boolean;
  onDelete: (reminder: Reminder) => void;
  onOpenEvent: (id: number) => void;
}) {
  const pending = reminders.filter((reminder) => !reminder.sentAt);
  const sent = reminders.filter((reminder) => reminder.sentAt);

  return (
    <div className="grid gap-4">
      <section className="surface p-4">
        <SectionTitle
          eyebrow="Lembretes"
          icon={Bell}
          title="Central de alertas"
          subtitle={`${pending.length} aguardando envio · ${sent.length} já enviado${sent.length === 1 ? "" : "s"}`}
        />
        <div className="mt-5 grid gap-2">
          {pending.map((reminder) => (
            <ReminderCard
              key={reminder.id}
              reminder={reminder}
              isSent={false}
              saving={saving}
              onDelete={onDelete}
              onOpenEvent={onOpenEvent}
            />
          ))}
          {!pending.length ? (
            <EmptyState
              icon={Bell}
              text="Nenhum lembrete pendente."
              hint="Abra um evento no cronograma e ative um lembrete pessoal."
            />
          ) : null}
        </div>
      </section>

      {sent.length ? (
        <section className="surface p-4">
          <SectionTitle
            eyebrow="Histórico"
            icon={CheckCircle2}
            title="Lembretes enviados"
            subtitle="Notificações que já chegaram até você"
          />
          <div className="mt-5 grid gap-2">
            {sent.map((reminder) => (
              <ReminderCard
                key={reminder.id}
                reminder={reminder}
                isSent
                saving={saving}
                onDelete={onDelete}
                onOpenEvent={onOpenEvent}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
