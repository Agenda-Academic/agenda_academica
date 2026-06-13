"use client";

import {
  CalendarPlus,
  Edit3,
  Loader2,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, type FormEvent } from "react";
import { cx, formatDate, toDateTimeLocal } from "@/lib/format";
import { adminOnlyCategories, allCategories, categoryMeta, statusMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent, Category } from "@/lib/types";
import { EmptyState, Field, SectionTitle, dangerButton, primaryButton, secondaryButton } from "./ui";

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

  const categoryOptions = useMemo(
    () => (isAdmin ? allCategories : allCategories.filter((item) => !adminOnlyCategories.includes(item))),
    [isAdmin]
  );

  if (!canWrite) {
    return (
      <section className="surface p-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Gestão docente</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
          Seu perfil pode visualizar eventos e configurar lembretes. A criação e a alteração de
          datas ficam com professores e administradores.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form className="surface p-4" onSubmit={onSave}>
          <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
            <SectionTitle
              eyebrow="Gestão docente"
              icon={editingEventId ? Pencil : CalendarPlus}
              title={editingEventId ? "Editar evento" : "Novo evento"}
              subtitle={
                isAdmin
                  ? "Eventos sem turma ficam visíveis para toda a instituição"
                  : "Eventos docentes aparecem imediatamente para os alunos da turma"
              }
            />
            {editingEventId ? (
              <button type="button" onClick={onCancel} className={cx(secondaryButton, "w-fit")}>
                <Plus className="h-4 w-4" aria-hidden />
                Criar novo
              </button>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Título" className="md:col-span-2" hint="mínimo de 3 caracteres">
              <input
                className="input"
                value={eventForm.title}
                onChange={(event) => setEventForm((form) => ({ ...form, title: event.target.value }))}
                minLength={3}
                maxLength={140}
                required
              />
            </Field>
            <Field label="Categoria">
              <select
                className="input"
                value={eventForm.category}
                onChange={(event) =>
                  setEventForm((form) => ({ ...form, category: event.target.value as Category }))
                }
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {categoryMeta[category].short}
                  </option>
                ))}
              </select>
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
                    {item.course?.code ? ` · ${item.course.code}` : ""}
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
            <Field label="Local" className="md:col-span-2" hint="opcional">
              <input
                className="input"
                value={eventForm.location}
                onChange={(event) => setEventForm((form) => ({ ...form, location: event.target.value }))}
                placeholder="Sala, laboratório ou link da reunião"
              />
            </Field>
            <Field label="Descrição" className="md:col-span-2" hint="opcional">
              <textarea
                className="input min-h-28 resize-y py-3"
                value={eventForm.description}
                onChange={(event) =>
                  setEventForm((form) => ({ ...form, description: event.target.value }))
                }
                placeholder="Conteúdo, critérios e orientações para a turma"
              />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button className={primaryButton} disabled={saving} type="submit">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {editingEventId ? "Salvar alterações" : "Criar evento"}
            </button>
            {editingEventId ? (
              <button className={secondaryButton} onClick={onCancel} type="button">
                Descartar edição
              </button>
            ) : null}
          </div>
        </form>

        <aside className="surface h-fit p-4">
          <SectionTitle
            eyebrow="Vínculos"
            icon={Users}
            title={isAdmin ? "Visão institucional" : "Turmas ministradas"}
            subtitle={
              isAdmin
                ? "Administradores criam eventos para qualquer turma"
                : "Escopo permitido para criação de eventos"
            }
          />
          <div className="mt-4 grid gap-2">
            {isAdmin ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
                Eventos criados pela administração entram como <strong>oficiais</strong> e têm
                prioridade sobre os eventos docentes.
              </div>
            ) : (
              <>
                {assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
                  >
                    <p className="font-semibold text-slate-950">{assignment.subject?.name}</p>
                    <p className="mt-1 text-slate-600">
                      {assignment.academicClass?.name}
                      {assignment.academicClass?.course?.code
                        ? ` · ${assignment.academicClass.course.code}`
                        : ""}
                    </p>
                  </div>
                ))}
                {!assignments.length ? (
                  <EmptyState
                    icon={Users}
                    text="Sem vínculos docentes."
                    hint="Solicite à administração o vínculo com suas turmas."
                  />
                ) : null}
              </>
            )}
          </div>
        </aside>
      </section>

      <section className="surface p-4">
        <SectionTitle
          eyebrow="Meus eventos"
          icon={Edit3}
          title={isAdmin ? "Eventos da instituição" : "Eventos que você gerencia"}
          subtitle={`${manageableEvents.length} evento${manageableEvents.length === 1 ? "" : "s"} sob sua responsabilidade`}
        />
        {manageableEvents.length ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {manageableEvents.map((event, index) => (
              <div
                key={event.id}
                className={cx(
                  "grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                  index < manageableEvents.length - 1 ? "border-b border-slate-200" : ""
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cx(
                        "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                        categoryMeta[event.category].pill
                      )}
                    >
                      {categoryMeta[event.category].short}
                    </span>
                    {event.status !== "scheduled" ? (
                      <span
                        className={cx(
                          "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                          statusMeta[event.status].pill
                        )}
                      >
                        {statusMeta[event.status].label}
                      </span>
                    ) : null}
                    <p
                      className={cx(
                        "truncate font-semibold",
                        event.status === "cancelled" ? "text-slate-400 line-through" : "text-slate-950"
                      )}
                    >
                      {event.title}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatDate(event.startsAt)}
                    {event.academicClass ? ` · ${event.academicClass.name}` : " · Toda a instituição"}
                    {event.subject ? ` · ${event.subject.name}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={cx(secondaryButton, "h-9 min-h-0 px-3")}
                    onClick={() => onEdit(event)}
                    type="button"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    Editar
                  </button>
                  <button
                    className={cx(dangerButton, "h-9 min-h-0 px-3")}
                    onClick={() => onDelete(event)}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              icon={CalendarPlus}
              text="Nenhum evento criado ainda."
              hint="Use o formulário acima para publicar o primeiro prazo."
            />
          </div>
        )}
      </section>
    </div>
  );
}
