"use client";

import { ArrowRight, Bell, BellOff, CalendarClock, CheckCircle2, Clock, Mail, Send } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { cx, formatDate, relativeDue } from "@/lib/format";
import { categoryMeta, reminderOffsetLabel } from "@/lib/meta";
import type { Reminder } from "@/lib/types";
import { InsightTile, delay } from "./dashboard-bits";
import { EmptyState, SectionTitle, Segmented, SegmentedButton } from "./ui";

type Tab = "pending" | "sent" | "all";

function ReminderRow({
  reminder,
  saving,
  onDelete,
  onOpenEvent,
}: {
  reminder: Reminder;
  saving: boolean;
  onDelete: (reminder: Reminder) => void;
  onOpenEvent: (id: number) => void;
}) {
  const event = reminder.academicEvent ?? null;
  const meta = event ? categoryMeta[event.category] : null;
  const sent = Boolean(reminder.sentAt);

  return (
    <article className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-line-2 bg-white p-3.5 transition hover:border-brand-200 hover:bg-brand-50/40 sm:flex-nowrap">
      <span className={cx("kpi-ico shrink-0", sent ? "c-fer" : meta?.tint)}>
        {sent ? <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden /> : <Bell className="h-[18px] w-[18px]" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {meta ? <span className={cx("pill", meta.tint)}>{meta.short}</span> : null}
          {event ? (
            <button
              className="truncate text-left text-[15px] font-bold underline-offset-4 hover:text-brand-ink hover:underline"
              onClick={() => onOpenEvent(event.id)}
              type="button"
            >
              {event.title}
            </button>
          ) : (
            <span className="truncate text-[15px] font-bold">Evento #{reminder.academicEventId}</span>
          )}
        </div>
        <div className="ev-meta">
          {event ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Evento {formatDate(event.startsAt)} ({relativeDue(event.startsAt)})
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {reminderOffsetLabel(reminder.offsetMinutes)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" aria-hidden />
            E-mail
          </span>
        </div>
      </div>
      <span className={cx("pill shrink-0", sent ? "st-conc" : "st-ag")}>
        {sent ? `Enviado ${reminder.sentAt ? formatDate(reminder.sentAt) : ""}` : `Envio ${formatDate(reminder.sendAt)}`}
      </span>
      <button
        className="btn btn-danger btn-sm shrink-0"
        disabled={saving}
        onClick={() => onDelete(reminder)}
        title="Remover lembrete"
        type="button"
      >
        <BellOff className="h-3.5 w-3.5" aria-hidden />
        Remover
      </button>
    </article>
  );
}

const steps = [
  { title: "Abra um evento", text: "No cronograma ou no painel, toque na prova, entrega ou data oficial que importa para você." },
  { title: "Escolha a antecedência", text: "De 15 minutos a 7 dias antes. O canal segue o padrão do seu perfil." },
  { title: "Receba o aviso", text: "No horário do aviso, o sistema registra o lembrete como enviado. O disparo por e-mail está previsto." },
];

export function RemindersView({
  reminders,
  saving,
  onDelete,
  onOpenEvent,
  onOpenProfile,
}: {
  reminders: Reminder[];
  saving: boolean;
  onDelete: (reminder: Reminder) => void;
  onOpenEvent: (id: number) => void;
  onOpenProfile?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("pending");
  const pending = reminders
    .filter((reminder) => !reminder.sentAt)
    .sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime());
  const sent = reminders.filter((reminder) => reminder.sentAt);
  const next = pending.find((reminder) => reminder.enabled) ?? null;
  const visible = tab === "pending" ? pending : tab === "sent" ? sent : [...pending, ...sent];

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <InsightTile icon={Bell} label="Aguardando envio" value={String(pending.length)} hint="um lembrete por evento" order={0} />
        <InsightTile icon={CheckCircle2} label="Já enviados" value={String(sent.length)} tone="c-ativ" hint="registrados no horário do aviso" order={1} />
        <InsightTile
          icon={Send}
          label="Próximo envio"
          value={next ? formatDate(next.sendAt) : "—"}
          tone="c-extra"
          hint={next ? (next.academicEvent?.title ?? `Evento #${next.academicEventId}`) : "nenhum agendado"}
          order={2}
        />
      </div>

      <div className="board" style={{ "--row": "520px" } as CSSProperties}>
        <section className="card pad rise" style={delay(3)} aria-label="Meus lembretes">
          <div className="head">
            <SectionTitle
              eyebrow="Central de alertas"
              title={tab === "sent" ? "Lembretes enviados" : tab === "all" ? "Todos os lembretes" : "Aguardando envio"}
            />
            <Segmented label="Mostrar">
              <SegmentedButton active={tab === "pending"} label={`Pendentes · ${pending.length}`} onClick={() => setTab("pending")} />
              <SegmentedButton active={tab === "sent"} label={`Enviados · ${sent.length}`} onClick={() => setTab("sent")} />
              <SegmentedButton active={tab === "all"} label="Todos" onClick={() => setTab("all")} />
            </Segmented>
          </div>
          <div key={tab} className="scroll pop mt-4 flex flex-col gap-2.5">
            {visible.map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} saving={saving} onDelete={onDelete} onOpenEvent={onOpenEvent} />
            ))}
            {!visible.length ? (
              <EmptyState
                icon={Bell}
                text={tab === "sent" ? "Nenhum lembrete enviado ainda." : "Nenhum lembrete pendente."}
                hint="Abra um evento no cronograma e ative um lembrete pessoal."
              />
            ) : null}
          </div>
        </section>

        <section className="card pad rise" style={delay(4)} aria-label="Como funciona">
          <SectionTitle eyebrow="Como funciona" title="Três passos" subtitle="Os lembretes são pessoais: só você recebe." />
          <ol className="scroll mt-5 flex flex-col gap-4">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3.5">
                <span className="disp flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-night text-[15px] font-bold text-accent">
                  {index + 1}
                </span>
                <div>
                  <p className="text-[14.5px] font-bold">{step.title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-muted">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          {onOpenProfile ? (
            <button className="link mt-4" onClick={onOpenProfile} type="button">
              Alterar antecedência e canal padrão
              <ArrowRight className="h-[15px] w-[15px]" aria-hidden />
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
