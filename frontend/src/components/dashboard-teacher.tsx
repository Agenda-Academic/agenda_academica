"use client";

import { BookOpen, CalendarDays, CalendarPlus, LayoutGrid, Megaphone, Plus, ShieldCheck, Users } from "lucide-react";
import type { CSSProperties } from "react";
import type { AcademicContext, AcademicEvent } from "@/lib/types";
import { EventList, InsightTile, NextEventHero, delay } from "./dashboard-bits";
import { EmptyState, SectionTitle } from "./ui";

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
  const classes = [
    ...new Map(
      assignments
        .filter((assignment) => assignment.academicClass)
        .map((assignment) => [assignment.academicClassId, assignment.academicClass!] as const)
    ).values(),
  ];
  const term = classes[0] ? `${classes[0].year}/${classes[0].semester}` : null;

  function upcomingCountFor(academicClassId: number, subjectId: number) {
    return myUpcoming.filter((event) => event.academicClassId === academicClassId && event.subjectId === subjectId)
      .length;
  }

  return (
    <div className="grid gap-5">
      <div className="rise" style={delay(0)}>
      <NextEventHero
        event={nextMine}
        kicker={nextMine?.category === "exam" ? "Sua próxima avaliação" : "Sua próxima publicação"}
        primaryLabel="Ver e editar"
        secondary={{ label: "Abrir gestão", icon: LayoutGrid, onClick: onOpenManage }}
        emptyTitle="Nenhum prazo publicado à frente"
        emptyText="Publique provas, trabalhos e atividades para as turmas que você ministra."
        onOpen={onSelect}
        onEmptyAction={{ label: "Novo evento", onClick: onNewEvent }}
      />
      </div>

      <div className="kpis">
        <InsightTile icon={Megaphone} label="Publicações futuras" order={2} value={String(myUpcoming.length)} hint="nas suas disciplinas" />
        <InsightTile
          icon={Users}
          label="Turmas" order={3}
          value={String(classes.length)}
          tone="c-ativ"
          hint={classes.map((academicClass) => academicClass.name).join(" · ") || "sem vínculo"}
        />
        <InsightTile
          icon={BookOpen}
          label="Disciplinas" order={4}
          value={String(assignments.length)}
          tone="c-trab"
          hint={term ? `no semestre ${term}` : "sem vínculo"}
        />
        <InsightTile
          icon={ShieldCheck}
          label="Datas oficiais à frente" order={5}
          value={String(officialUpcoming.length)}
          tone="c-inst"
          hint="evite marcar provas nelas"
        />
      </div>

      {/* Pares de cards na mesma linha, com rolagem interna */}
      <div className="board" style={{ "--row": "390px" } as CSSProperties}>
        <section className="card pad rise" style={delay(6)} aria-label="Minhas turmas e disciplinas">
          <SectionTitle eyebrow="Docência" title="Minhas turmas e disciplinas" subtitle="Crie eventos direto na disciplina certa" />
          <div className="scroll mt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {assignments.map((assignment) => {
                const count = upcomingCountFor(assignment.academicClassId, assignment.subjectId);
                return (
                  <div key={assignment.id} className="flex flex-col gap-3.5 rounded-2xl border border-line-2 bg-surface-2 p-4 transition hover:border-brand-200 hover:bg-brand-50">
                    <div className="min-w-0">
                      <p className="truncate text-[15.5px] font-bold">{assignment.subject?.name ?? "Disciplina"}</p>
                      <p className="sub !mt-1">
                        {[assignment.academicClass?.name, assignment.academicClass?.shift, assignment.subject?.code]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-3">
                      <span className={count ? "dot d-prova" : "dot bg-line-strong"} aria-hidden />
                      {count ? `${count} evento${count === 1 ? "" : "s"} à frente` : "Sem eventos futuros"}
                    </p>
                    <button
                      className="btn btn-s btn-sm w-fit"
                      onClick={() => onNewEventFor(assignment.academicClassId, assignment.subjectId)}
                      type="button"
                    >
                      <Plus className="h-[15px] w-[15px]" aria-hidden />
                      Evento
                    </button>
                  </div>
                );
              })}
              {!assignments.length ? (
                <div className="sm:col-span-2">
                  <EmptyState icon={Users} text="Sem vínculos docentes." hint="Solicite à administração o vínculo com suas turmas." />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card pad rise" style={delay(7)} aria-label="Datas oficiais à frente">
          <SectionTitle eyebrow="Instituição" title="Datas oficiais à frente" subtitle="Feriados e prazos que afetam suas aulas" />
          <div className="scroll mt-3.5">
            <EventList events={officialUpcoming} emptyIcon={CalendarDays} emptyText="Nenhuma data oficial próxima." onSelect={onSelect} />
          </div>
        </section>

        <section className="card pad rise" style={delay(8)} aria-label="Meus próximos eventos">
          <div className="head">
            <SectionTitle eyebrow="Publicações" title="Meus próximos eventos" subtitle="O que suas turmas vão encontrar na agenda" />
            <button className="btn btn-s btn-sm" onClick={onOpenManage} type="button">
              Ver todos na gestão
            </button>
          </div>
          <div className="scroll mt-3.5">
            <EventList
              events={myUpcoming}
              emptyIcon={CalendarPlus}
              emptyText="Nenhum evento publicado ainda."
              emptyHint="Use os atalhos das disciplinas para publicar o primeiro."
              onSelect={onSelect}
            />
          </div>
        </section>

        <section className="card pad rise" style={delay(9)} aria-label="Agenda geral das turmas">
          <SectionTitle eyebrow="Turmas" title="Agenda geral das turmas" subtitle="Inclui eventos de outros professores" />
          <div className="scroll mt-3.5">
            <EventList events={upcomingEvents} emptyIcon={CalendarDays} emptyText="Sem eventos futuros nas suas turmas." onSelect={onSelect} />
          </div>
        </section>
      </div>
    </div>
  );
}
