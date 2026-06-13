"use client";

import {
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  GraduationCap,
  Megaphone,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { cx, formatDate, formatFullDate, relativeDue } from "@/lib/format";
import { categoryMeta } from "@/lib/meta";
import type { AcademicContext, AcademicEvent } from "@/lib/types";
import { EventList, InsightTile } from "./dashboard-bits";
import { EmptyState, SectionTitle, primaryButton, secondaryButton } from "./ui";

export function TeacherDashboard({
  context,
  manageableEvents,
  officialUpcoming,
  referenceNow,
  upcomingEvents,
  onNewEvent,
  onNewEventFor,
  onOpenManage,
  onSelect,
}: {
  context: AcademicContext | null;
  manageableEvents: AcademicEvent[];
  officialUpcoming: AcademicEvent[];
  referenceNow: number;
  upcomingEvents: AcademicEvent[];
  onNewEvent: () => void;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
  onOpenManage: () => void;
  onSelect: (id: number) => void;
}) {
  const assignments = context?.teachingAssignments ?? [];
  const myUpcoming = manageableEvents.filter(
    (event) =>
      new Date(event.startsAt).getTime() >= referenceNow &&
      event.status !== "cancelled" &&
      event.status !== "completed"
  );
  const nextMine = myUpcoming[0] ?? null;
  const classCount = new Set(assignments.map((assignment) => assignment.academicClassId)).size;

  function upcomingCountFor(academicClassId: number, subjectId: number) {
    return myUpcoming.filter(
      (event) => event.academicClassId === academicClassId && event.subjectId === subjectId
    ).length;
  }

  return (
    <div className="grid gap-4">
      <section className="surface overflow-hidden">
        <div className="border-b border-slate-200/80 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                <Sparkles className="h-4 w-4" aria-hidden />
                {formatFullDate(new Date())}
              </span>
              <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-slate-950">
                {nextMine
                  ? `Próxima publicação: ${nextMine.title}`
                  : "Nenhum prazo publicado à frente"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {nextMine
                  ? `${categoryMeta[nextMine.category].short} · ${relativeDue(nextMine.startsAt)} · ${formatDate(nextMine.startsAt)} · ${nextMine.academicClass?.name ?? ""}`
                  : "Publique provas, trabalhos e atividades para as turmas que você ministra."}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button className={primaryButton} type="button" onClick={onNewEvent}>
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Novo evento
              </button>
              <button className={secondaryButton} type="button" onClick={onOpenManage}>
                Gestão
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-slate-200/80 sm:grid-cols-2 md:grid-cols-4">
          <InsightTile
            icon={Megaphone}
            label="Publicações futuras"
            value={String(myUpcoming.length)}
          />
          <InsightTile icon={Users} label="Turmas" value={String(classCount)} />
          <InsightTile icon={BookOpen} label="Disciplinas" value={String(assignments.length)} />
          <InsightTile
            icon={ShieldCheck}
            label="Datas oficiais à frente"
            value={String(officialUpcoming.length)}
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-4">
          <div className="surface p-4">
            <SectionTitle
              eyebrow="Docência"
              icon={GraduationCap}
              title="Minhas turmas e disciplinas"
              subtitle="Crie eventos direto na disciplina certa"
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {assignments.map((assignment) => {
                const count = upcomingCountFor(assignment.academicClassId, assignment.subjectId);
                return (
                  <div
                    key={assignment.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">
                        {assignment.subject?.name ?? "Disciplina"}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {assignment.academicClass?.name}
                        {assignment.academicClass?.shift
                          ? ` · ${assignment.academicClass.shift}`
                          : ""}
                      </p>
                      <p className="mt-2 text-xs font-semibold text-slate-500">
                        {count
                          ? `${count} evento${count === 1 ? "" : "s"} à frente`
                          : "Sem eventos futuros"}
                      </p>
                    </div>
                    <button
                      className={cx(secondaryButton, "h-9 min-h-0 w-fit px-3")}
                      onClick={() =>
                        onNewEventFor(assignment.academicClassId, assignment.subjectId)
                      }
                      type="button"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Evento
                    </button>
                  </div>
                );
              })}
              {!assignments.length ? (
                <div className="sm:col-span-2">
                  <EmptyState
                    icon={Users}
                    text="Sem vínculos docentes."
                    hint="Solicite à administração o vínculo com suas turmas."
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="surface p-4">
            <SectionTitle
              eyebrow="Publicações"
              icon={CalendarClock}
              title="Meus próximos eventos"
              subtitle="O que suas turmas vão encontrar na agenda"
            />
            <div className="mt-4">
              <EventList
                events={myUpcoming}
                limit={6}
                emptyIcon={CalendarPlus}
                emptyText="Nenhum evento publicado ainda."
                emptyHint="Use os atalhos das disciplinas acima para publicar o primeiro."
                onSelect={onSelect}
              />
            </div>
          </div>
        </div>

        <div className="grid content-start gap-4">
          <div className="surface p-4">
            <SectionTitle
              eyebrow="Instituição"
              icon={ShieldCheck}
              title="Datas oficiais à frente"
              subtitle="Feriados e prazos da reitoria que afetam suas aulas"
            />
            <div className="mt-4">
              <EventList
                events={officialUpcoming}
                limit={5}
                emptyIcon={CalendarDays}
                emptyText="Nenhuma data oficial próxima."
                onSelect={onSelect}
              />
            </div>
          </div>

          <div className="surface p-4">
            <SectionTitle
              eyebrow="Turmas"
              icon={CalendarDays}
              title="Agenda geral das turmas"
              subtitle="Inclui eventos de outros professores"
            />
            <div className="mt-4">
              <EventList
                events={upcomingEvents}
                limit={5}
                emptyIcon={CalendarDays}
                emptyText="Sem eventos futuros nas suas turmas."
                onSelect={onSelect}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
