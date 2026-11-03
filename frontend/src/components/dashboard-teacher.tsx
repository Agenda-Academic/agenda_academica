"use client";

import { BookOpen, CalendarDays, CalendarPlus, Eye, LayoutGrid, Megaphone, Pencil, Plus, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { cx } from "@/lib/format";
import type { AcademicContext, AcademicEvent, Reminder } from "@/lib/types";
import {
  AvisosCard,
  EventList,
  InsightTile,
  NextEventHero,
  calendarUpcomingCount,
  delay,
  isOfficialDate,
  officialCategories,
  useSavedReveal,
  type CalendarFilter,
} from "./dashboard-bits";
import { EmptyState, SectionTitle, Segmented, SegmentedButton } from "./ui";

export function TeacherDashboard({
  avisos,
  context,
  events,
  lastSavedId,
  manageableEvents,
  officialUpcoming,
  referenceNow,
  savedTick,
  upcomingEvents,
  onDismissAviso,
  onEdit,
  onNewEvent,
  onNewEventFor,
  onOpenCalendar,
  onOpenManage,
  onSelect,
}: {
  /** Lembretes cuja hora chegou (aviso no sistema). */
  avisos?: Reminder[];
  context: AcademicContext | null;
  /** Todos os eventos que a docente vê (os mesmos do Cronograma), para o "Ver todos (N)" contar igual. */
  events?: AcademicEvent[];
  /** Último evento salvo pelo painel lateral; com savedTick, o Painel mostra e marca esse evento. */
  lastSavedId?: number | null;
  manageableEvents: AcademicEvent[];
  officialUpcoming: AcademicEvent[];
  referenceNow: number;
  /** Muda a cada salvamento pelo painel lateral. */
  savedTick?: number;
  upcomingEvents: AcademicEvent[];
  onDismissAviso?: (reminderId: number) => void;
  /** Abre o evento no painel de edição. */
  onEdit?: (event: AcademicEvent) => void;
  onNewEvent: () => void;
  onNewEventFor: (academicClassId: number, subjectId: number) => void;
  onOpenCalendar?: (filter?: CalendarFilter) => void;
  onOpenManage: () => void;
  onSelect: (id: number) => void;
}) {
  const [tab, setTab] = useState<"todas" | "minhas">("todas");
  const { rootRef, savedId } = useSavedReveal<HTMLDivElement>(lastSavedId, savedTick, upcomingEvents);
  const assignments = context?.teachingAssignments ?? [];
  // os da docente que a Gestão mostra em "Próximos": abertos e que ainda não terminaram
  const myOpen = manageableEvents.filter(
    (event) =>
      event.status !== "cancelled" &&
      event.status !== "completed" &&
      new Date(event.endsAt ?? event.startsAt).getTime() >= referenceNow
  );
  const myUpcoming = myOpen.filter((event) => new Date(event.startsAt).getTime() >= referenceNow);
  const mineIds = new Set(manageableEvents.map((event) => event.id));
  const nextMine = myUpcoming[0] ?? null;
  // datas oficiais: mesma regra do filtro do Cronograma que o card abre
  const officialDates = officialUpcoming.filter(isOfficialDate);
  const allEvents = events ?? upcomingEvents;
  const classes = [
    ...new Map(
      assignments
        .filter((assignment) => assignment.academicClass)
        .map((assignment) => [assignment.academicClassId, assignment.academicClass!] as const)
    ).values(),
  ];
  const term = classes[0] ? `${classes[0].year}/${classes[0].semester}` : null;
  const agenda = tab === "todas" ? upcomingEvents : myOpen;
  const openOfficial = onOpenCalendar ? () => onOpenCalendar({ categories: officialCategories }) : undefined;

  function upcomingCountFor(academicClassId: number, subjectId: number) {
    return myOpen.filter((event) => event.academicClassId === academicClassId && event.subjectId === subjectId).length;
  }

  return (
    <div ref={rootRef} className="grid gap-5">
      {avisos?.length ? (
        <AvisosCard avisos={avisos} events={upcomingEvents} onDismiss={onDismissAviso} onOpen={onSelect} />
      ) : null}

      <div className="rise" style={delay(0)}>
        <NextEventHero
          event={nextMine}
          kicker={nextMine?.category === "exam" ? "Sua próxima avaliação" : "Seu próximo evento"}
          hideTeacher
          primaryAction={nextMine && onEdit ? { label: "Editar", icon: Pencil, onClick: () => onEdit(nextMine) } : undefined}
          saved={nextMine !== null && savedId === nextMine.id}
          secondary={
            nextMine && onEdit
              ? { label: "Ver detalhes", icon: Eye, onClick: () => onSelect(nextMine.id) }
              : { label: "Abrir gestão", icon: LayoutGrid, onClick: onOpenManage }
          }
          emptyTitle="Nenhum prazo publicado à frente"
          emptyText="Publique provas, trabalhos e atividades para as turmas que você ministra."
          onOpen={onSelect}
          onEmptyAction={{ label: "Novo evento", onClick: onNewEvent }}
        />
      </div>

      <div className="kpis">
        <InsightTile
          icon={Megaphone}
          label="Publicações futuras"
          order={2}
          value={String(myOpen.length)}
          hint="nas suas disciplinas"
          actionLabel="Abrir a Gestão"
          onClick={onOpenManage}
        />
        <InsightTile
          icon={Users}
          label="Turmas"
          order={3}
          value={String(classes.length)}
          tone="c-ativ"
          hint={classes.map((academicClass) => academicClass.name).join(", ") || "sem vínculo"}
        />
        <InsightTile
          icon={BookOpen}
          label="Disciplinas"
          order={4}
          value={String(assignments.length)}
          tone="c-trab"
          hint={term ? `no semestre ${term}` : "sem vínculo"}
        />
        <InsightTile
          icon={ShieldCheck}
          label="Datas oficiais à frente"
          order={5}
          value={String(officialDates.length)}
          tone="c-inst"
          hint="evite marcar provas nelas"
          actionLabel="Ver no cronograma"
          onClick={openOfficial}
        />
      </div>

      {/* Agenda à esquerda (duas linhas) e apoio à direita: os cards crescem com o conteúdo */}
      <div className="board">
        <section className="card pad tall rise" style={delay(6)} aria-label="Agenda das turmas">
          <div className="head">
            <SectionTitle
              title="Agenda das turmas"
              subtitle={tab === "todas" ? "Inclui eventos de outros docentes" : "Só os seus eventos"}
            />
            <Segmented label="Mostrar eventos">
              <SegmentedButton
                active={tab === "todas"}
                label={`Todas (${upcomingEvents.length})`}
                onClick={() => setTab("todas")}
              />
              <SegmentedButton
                active={tab === "minhas"}
                label={`Minhas (${myOpen.length})`}
                onClick={() => setTab("minhas")}
              />
            </Segmented>
          </div>
          <EventList
            key={tab}
            className="pop mt-3.5"
            events={agenda}
            limit={6}
            isMine={tab === "todas" ? (event) => mineIds.has(event.id) : undefined}
            savedId={savedId}
            emptyIcon={tab === "todas" ? CalendarDays : CalendarPlus}
            emptyText={tab === "todas" ? "Sem eventos futuros nas suas turmas." : "Nenhum evento publicado ainda."}
            emptyHint={tab === "todas" ? undefined : "Use os atalhos das disciplinas para publicar o primeiro."}
            showAll={
              tab === "todas"
                ? onOpenCalendar
                  ? {
                      label: "Ver todos no cronograma",
                      // o Cronograma conta também os cancelados, os concluídos e os de hoje
                      count: calendarUpcomingCount(allEvents, referenceNow),
                      onClick: () => onOpenCalendar(),
                    }
                  : undefined
                : { label: "Ver todos na Gestão", onClick: onOpenManage }
            }
            onSelect={onSelect}
          />
        </section>

        <section className="card pad rise" style={delay(7)} aria-label="Minhas turmas e disciplinas">
          <SectionTitle title="Minhas turmas e disciplinas" />
          {assignments.length ? (
            <ul className="mt-4 grid gap-3">
              {assignments.map((assignment) => {
                const count = upcomingCountFor(assignment.academicClassId, assignment.subjectId);
                const subjectName = assignment.subject?.name ?? "Disciplina";
                const className = assignment.academicClass?.name ?? "turma";
                return (
                  <li
                    key={assignment.id}
                    className="flex flex-col items-start gap-3 rounded-2xl border border-line-2 bg-surface-2 p-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[15.5px] font-bold">{subjectName}</p>
                      <p className="sub !mt-0.5">
                        {[assignment.academicClass?.name, assignment.academicClass?.shift].filter(Boolean).join(", ")}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-ink-3">
                        <span className={cx("dot", count ? "bg-muted" : "bg-line-strong")} aria-hidden />
                        {count ? `${count} evento${count === 1 ? "" : "s"} à frente` : "Sem eventos futuros"}
                      </p>
                    </div>
                    <button
                      className="btn btn-s btn-sm"
                      aria-label={`Novo evento de ${subjectName} para ${className}`}
                      onClick={() => onNewEventFor(assignment.academicClassId, assignment.subjectId)}
                      type="button"
                    >
                      <Plus className="h-[15px] w-[15px]" aria-hidden />
                      Novo evento
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-4">
              <EmptyState
                compact
                icon={Users}
                text="Sem turmas vinculadas."
                hint="Peça à administração para vincular suas disciplinas e turmas."
              />
            </div>
          )}
        </section>

        <section className="card pad rise" style={delay(8)} aria-label="Datas oficiais à frente">
          <SectionTitle title="Datas oficiais à frente" subtitle="Valem para todas as turmas" />
          <EventList
            className="mt-3.5"
            events={officialDates}
            limit={4}
            savedId={savedId}
            emptyCompact
            emptyIcon={CalendarDays}
            emptyText="Nenhuma data oficial próxima."
            showAll={
              openOfficial
                ? {
                    label: "Ver todas no cronograma",
                    count: calendarUpcomingCount(events ?? officialDates, referenceNow, officialCategories),
                    onClick: openOfficial,
                  }
                : undefined
            }
            onSelect={onSelect}
          />
        </section>
      </div>
    </div>
  );
}
