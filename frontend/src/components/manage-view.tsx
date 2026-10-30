"use client";

import { CalendarPlus, Eye, Loader2, Lock, Pencil, Plus, Save, ShieldCheck, Trash2, Users } from "lucide-react";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { cx, formatDate, toDateTimeLocal } from "@/lib/format";
import { adminOnlyCategories, allCategories, categoryMeta, statusMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Category } from "@/lib/types";
import { delay } from "./dashboard-bits";
import { EventRow } from "./event-bits";
import { EmptyState, Field, SectionTitle, Segmented, SegmentedButton } from "./ui";

export type EventFormState = {
  title: string;
  description: string;
  category: Category;
  startsAt: string;
  endsAt: string;
  points: string;
  location: string;
  academicClassId: string;
  subjectId: string;
};

export const createInitialEventForm = (): EventFormState => ({
  title: "",
  description: "",
  category: "exam",
  startsAt: toDateTimeLocal(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)),
  endsAt: "",
  points: "",
  location: "",
  academicClassId: "",
  subjectId: "",
});

type StatusTab = "all" | "upcoming" | "completed" | "cancelled";

export function ManageView({
  canWrite,
  context,
  editingEventId,
  eventForm,
  isAdmin,
  manageableEvents,
  saving,
  setEventForm,
  onCancel,
  onDelete,
  onEdit,
  onSave,
}: {
  canWrite: boolean;
  context: AcademicContext | null;
  editingEventId: number | null;
  eventForm: EventFormState;
  isAdmin: boolean;
  manageableEvents: AcademicEvent[];
  saving: boolean;
  setEventForm: (updater: (form: EventFormState) => EventFormState) => void;
  onCancel: () => void;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  onSave: (event: FormEvent) => void;
}) {
  const [tab, setTab] = useState<StatusTab>("all");
  const [now] = useState(() => Date.now());
  const assignments = useMemo(() => context?.teachingAssignments ?? [], [context]);

  const classOptions = useMemo(() => {
    if (isAdmin) {
      return context?.catalog.classes ?? [];
    }
    const seen = new Set<number>();
    return assignments
      .map((assignment) => assignment.academicClass)
      .filter((academicClass): academicClass is NonNullable<typeof academicClass> => {
        if (!academicClass || seen.has(academicClass.id)) {
          return false;
        }
        seen.add(academicClass.id);
        return true;
      });
  }, [assignments, context, isAdmin]);

  const subjectOptions = useMemo(() => {
    if (isAdmin) {
      return context?.catalog.subjects ?? [];
    }
    const classId = Number(eventForm.academicClassId);
    const seen = new Set<number>();
    return assignments
      .filter((assignment) => !classId || assignment.academicClassId === classId)
      .map((assignment) => assignment.subject)
      .filter((subject): subject is NonNullable<typeof subject> => {
        if (!subject || seen.has(subject.id)) {
          return false;
        }
        seen.add(subject.id);
        return true;
      });
  }, [assignments, context, eventForm.academicClassId, isAdmin]);

  // Prévia: o evento como a turma vai ver na agenda.
  const preview: AcademicEvent = useMemo(() => {
    const academicClass = classOptions.find((item) => item.id === Number(eventForm.academicClassId)) ?? null;
    const subject = subjectOptions.find((item) => item.id === Number(eventForm.subjectId)) ?? null;
    const startsAt = eventForm.startsAt ? new Date(eventForm.startsAt) : new Date(now);
    return {
      id: -1,
      title: eventForm.title.trim() || "Título do evento",
      description: eventForm.description || null,
      category: eventForm.category,
      source: isAdmin ? "official" : "teacher",
      status: "scheduled",
      startsAt: (Number.isNaN(startsAt.getTime()) ? new Date(now) : startsAt).toISOString(),
      endsAt: null,
      points: eventForm.points ? Number(eventForm.points) : null,
      location: eventForm.location || null,
      color: null,
      academicClassId: academicClass?.id ?? null,
      subjectId: subject?.id ?? null,
      teacherId: null,
      officialPriority: isAdmin,
      academicClass,
      subject,
    };
  }, [classOptions, subjectOptions, eventForm, isAdmin, now]);

  const counts = {
    all: manageableEvents.length,
    upcoming: manageableEvents.filter(
      (event) => new Date(event.startsAt).getTime() >= now && event.status !== "cancelled" && event.status !== "completed"
    ).length,
    completed: manageableEvents.filter((event) => event.status === "completed").length,
    cancelled: manageableEvents.filter((event) => event.status === "cancelled").length,
  };
  const visible = manageableEvents.filter((event) =>
    tab === "all"
      ? true
      : tab === "completed"
        ? event.status === "completed"
        : tab === "cancelled"
          ? event.status === "cancelled"
          : new Date(event.startsAt).getTime() >= now && event.status !== "cancelled" && event.status !== "completed"
  );

  if (!canWrite) {
    return (
      <section className="card pad rise flex flex-col items-start">
        <span className="empty-ico">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="h2 mt-4">Gestão docente</h2>
        <p className="sub max-w-xl">
          Seu perfil pode visualizar eventos e configurar lembretes. A criação e a alteração de datas ficam com
          professores e administradores.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="board" style={{ "--row": "380px" } as CSSProperties}>
        {/* Formulário */}
        <form className="card pad tall rise" style={delay(0)} onSubmit={onSave} aria-label="Formulário do evento">
          <div className="head">
            <SectionTitle
              title={editingEventId ? "Editar evento" : isAdmin ? "Publicar data oficial" : "Publicar para a turma"}
              subtitle={
                isAdmin
                  ? "Eventos sem turma ficam visíveis para toda a instituição."
                  : "Eventos docentes aparecem imediatamente para os alunos da turma."
              }
            />
            {editingEventId ? (
              <button type="button" onClick={onCancel} className="btn btn-s btn-sm">
                <Plus className="h-[15px] w-[15px]" aria-hidden />
                Criar novo
              </button>
            ) : null}
          </div>

          <div className="scroll free mt-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Título" className="md:col-span-2" hint="mín. 3 caracteres">
                <input
                  className="input"
                  value={eventForm.title}
                  onChange={(event) => setEventForm((form) => ({ ...form, title: event.target.value }))}
                  minLength={3}
                  maxLength={140}
                  required
                  placeholder="Ex.: Prova de Matemática (P2)"
                />
              </Field>

              <div className="grid gap-2 md:col-span-2">
                <span className="lbl">Categoria</span>
                <div className="chips" role="radiogroup" aria-label="Categoria">
                  {allCategories.map((category) => {
                    const meta = categoryMeta[category];
                    const locked = !isAdmin && adminOnlyCategories.includes(category);
                    const picked = eventForm.category === category;
                    return locked ? (
                      <span key={category} className="chip lock" title="Exclusiva da administração">
                        <Lock className="h-3.5 w-3.5" aria-hidden />
                        {meta.short}
                      </span>
                    ) : (
                      <button
                        key={category}
                        className={cx("chip", picked && cx("picked", meta.tint))}
                        role="radio"
                        aria-checked={picked}
                        onClick={() => setEventForm((form) => ({ ...form, category }))}
                        type="button"
                      >
                        <span className={cx("dot", meta.accent)} aria-hidden />
                        {meta.short}
                      </button>
                    );
                  })}
                </div>
                {!isAdmin ? (
                  <p className="field-help !mt-0">Institucional, feriado e recesso são exclusivas da administração.</p>
                ) : null}
              </div>

              <Field label="Início">
                <input
                  className="input"
                  value={eventForm.startsAt}
                  onChange={(event) => setEventForm((form) => ({ ...form, startsAt: event.target.value }))}
                  required
                  type="datetime-local"
                />
              </Field>
              <Field label="Término" hint="opcional">
                <input
                  className="input"
                  value={eventForm.endsAt}
                  min={eventForm.startsAt || undefined}
                  onChange={(event) => setEventForm((form) => ({ ...form, endsAt: event.target.value }))}
                  type="datetime-local"
                />
              </Field>
              <Field label="Turma" hint={isAdmin ? "opcional para datas institucionais" : undefined}>
                <select
                  className="input"
                  value={eventForm.academicClassId}
                  onChange={(event) =>
                    setEventForm((form) => ({
                      ...form,
                      academicClassId: event.target.value,
                      subjectId: isAdmin ? form.subjectId : "",
                    }))
                  }
                  required={!isAdmin}
                >
                  <option value="">{isAdmin ? "Todas as turmas" : "Selecione a turma"}</option>
                  {classOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.course?.code ? ` (${item.course.code})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Disciplina" hint={isAdmin ? "opcional" : undefined}>
                <select
                  className="input"
                  value={eventForm.subjectId}
                  onChange={(event) => setEventForm((form) => ({ ...form, subjectId: event.target.value }))}
                  required={!isAdmin}
                >
                  <option value="">{isAdmin ? "Sem disciplina" : "Selecione a disciplina"}</option>
                  {subjectOptions.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Local" hint="opcional">
                <input
                  className="input"
                  value={eventForm.location}
                  onChange={(event) => setEventForm((form) => ({ ...form, location: event.target.value }))}
                  placeholder="Sala, laboratório ou link"
                />
              </Field>
              <Field label="Pontuação informativa" hint="opcional">
                <input
                  className="input"
                  value={eventForm.points}
                  onChange={(event) => setEventForm((form) => ({ ...form, points: event.target.value }))}
                  min="0"
                  step="0.5"
                  type="number"
                  placeholder="0"
                />
              </Field>
              <Field label="Descrição" className="md:col-span-2" hint="opcional">
                <textarea
                  className="input min-h-24"
                  value={eventForm.description}
                  onChange={(event) => setEventForm((form) => ({ ...form, description: event.target.value }))}
                  placeholder="Conteúdo, critérios e orientações para a turma"
                />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5 border-t border-line-2 pt-4">
            <button className="btn btn-p" disabled={saving} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {editingEventId ? "Salvar alterações" : "Criar evento"}
            </button>
            {editingEventId ? (
              <button className="btn btn-s" onClick={onCancel} type="button">
                Descartar edição
              </button>
            ) : null}
          </div>
        </form>

        {/* Prévia */}
        <section className="card pad rise" style={delay(1)} aria-label="Prévia">
          <SectionTitle title="Como a turma vai ver" subtitle="Atualiza enquanto você preenche." />
          <div className="scroll mt-4">
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-1.5">
              <EventRow event={preview} onClick={() => undefined} />
            </div>
            <p className="callout green mt-3">
              <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {isAdmin
                ? "Datas da administração entram como oficiais e têm prioridade sobre eventos docentes."
                : "Quem tem lembrete ativo é avisado conforme a antecedência que escolheu."}
            </p>
          </div>
        </section>

        {/* Vínculos */}
        <section className="card pad rise" style={delay(2)} aria-label="Vínculos">
          <SectionTitle
            title={isAdmin ? "Visão institucional" : "Turmas ministradas"}
            subtitle={isAdmin ? "Você publica para qualquer turma" : "Onde você pode publicar"}
          />
          <div className="scroll mt-4 flex flex-col gap-2">
            {isAdmin ? (
              (context?.catalog.classes ?? []).map((academicClass) => (
                <div key={academicClass.id} className="mini">
                  <span className="mini-ico">
                    <Users className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="mini-t block">{academicClass.name}</span>
                    <span className="mini-s block">
                      {[academicClass.course?.code, academicClass.period, academicClass.shift].filter(Boolean).join(", ")}
                    </span>
                  </span>
                </div>
              ))
            ) : assignments.length ? (
              assignments.map((assignment) => (
                <div key={assignment.id} className="mini">
                  <span className="mini-ico">
                    <Users className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="mini-t block truncate">{assignment.subject?.name}</span>
                    <span className="mini-s block">
                      {[assignment.academicClass?.name, assignment.academicClass?.course?.code].filter(Boolean).join(", ")}
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <EmptyState icon={Users} text="Sem vínculos docentes." hint="Solicite à administração o vínculo com suas turmas." />
            )}
          </div>
        </section>
      </div>

      {/* Tabela de eventos */}
      <section className="card pad rise flex flex-col" style={delay(3)} aria-label="Eventos que você gerencia">
        <div className="head">
          <SectionTitle
            title={isAdmin ? "Eventos da instituição" : "Eventos que você gerencia"}
            subtitle={`${manageableEvents.length} evento${manageableEvents.length === 1 ? "" : "s"} sob sua responsabilidade`}
          />
          <Segmented label="Situação">
            <SegmentedButton active={tab === "all"} label={`Todos (${counts.all})`} onClick={() => setTab("all")} />
            <SegmentedButton active={tab === "upcoming"} label={`Futuros (${counts.upcoming})`} onClick={() => setTab("upcoming")} />
            <SegmentedButton active={tab === "completed"} label={`Concluídos (${counts.completed})`} onClick={() => setTab("completed")} />
            <SegmentedButton active={tab === "cancelled"} label={`Cancelados (${counts.cancelled})`} onClick={() => setTab("cancelled")} />
          </Segmented>
        </div>
        {visible.length ? (
          <div key={tab} className="scroll pop mt-4 max-h-[520px] overflow-x-auto rounded-2xl border border-line">
            <table className="tbl min-w-[720px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Evento</th>
                  <th>Categoria</th>
                  <th>Data</th>
                  <th>Situação</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((event) => (
                  <tr key={event.id} className={cx("transition hover:bg-surface-2", editingEventId === event.id && "bg-brand-50")}>
                    <td>
                      <p className={cx("t", event.status === "cancelled" && "text-faint line-through")}>{event.title}</p>
                      <p className="s">
                        {[event.subject?.name, event.academicClass?.name ?? "Toda a instituição"].filter(Boolean).join(", ")}
                      </p>
                    </td>
                    <td>
                      <span className={cx("pill", categoryMeta[event.category].tint)}>{categoryMeta[event.category].short}</span>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(event.startsAt)}</td>
                    <td>
                      <span className={cx("pill", statusMeta[event.status].pill)}>{statusMeta[event.status].label}</span>
                    </td>
                    <td>
                      <div className="acts">
                        <button className="ib sm" onClick={() => onEdit(event)} title="Editar" aria-label="Editar" type="button">
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          className="ib sm text-[#B4234A] hover:bg-[#FFF1F3]"
                          onClick={() => onDelete(event)}
                          title="Excluir"
                          aria-label="Excluir"
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              icon={CalendarPlus}
              text={manageableEvents.length ? "Nenhum evento nesta situação." : "Nenhum evento criado ainda."}
              hint={manageableEvents.length ? "Escolha outra aba acima." : "Use o formulário acima para publicar o primeiro prazo."}
            />
          </div>
        )}
      </section>
    </div>
  );
}
