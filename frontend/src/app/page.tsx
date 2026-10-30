"use client";

import { GraduationCap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppShell, type View } from "@/components/app-shell";
import { CalendarView, type CalendarMode } from "@/components/calendar-view";
import { AdminDashboard } from "@/components/dashboard-admin";
import { StudentDashboard } from "@/components/dashboard-student";
import { TeacherDashboard } from "@/components/dashboard-teacher";
import { LoginScreen } from "@/components/login-screen";
import {
  ManageView,
  createInitialEventForm,
  type EventFormState,
} from "@/components/manage-view";
import { ProfileModal, type ProfileFormState } from "@/components/profile-modal";
import { RemindersView } from "@/components/reminders-view";
import { SyncView } from "@/components/sync-view";
import {
  ConfirmDialog,
  PageSkeleton,
  Spinner,
  ToastStack,
  type ConfirmState,
  type ToastItem,
  type ToastTone,
} from "@/components/ui";
import {
  ApiError,
  createEvent,
  deleteEvent,
  deleteReminder,
  getCalendarImports,
  getContext,
  getDashboard,
  getEvent,
  getEvents,
  getReminders,
  importCalendar,
  logout,
  saveReminder,
  updateEvent,
  updateProfile,
  type CalendarImportInput,
} from "@/lib/api";
import {
  addDays,
  errorMessage,
  firstName,
  startOfDay,
  toDateTimeLocal,
} from "@/lib/format";
import { allCategories } from "@/lib/meta";
import type {
  AcademicContext,
  AcademicEvent,
  CalendarImport,
  Category,
  Dashboard,
  Reminder,
  Session,
} from "@/lib/types";

const SESSION_KEY = "agenda-academica-session";

export default function Home() {
  /* ---------------------------------------------------------------- */
  /* Estado                                                            */
  /* ---------------------------------------------------------------- */
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);

  const [activeView, setActiveView] = useState<View>("dashboard");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("list");

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [context, setContext] = useState<AcademicContext | null>(null);
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [imports, setImports] = useState<CalendarImport[]>([]);

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState<AcademicEvent | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Category[]>(allCategories);
  const [search, setSearch] = useState("");

  const [eventForm, setEventForm] = useState<EventFormState>(createInitialEventForm);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [reminderOffset, setReminderOffset] = useState("1440");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [referenceNow, setReferenceNow] = useState(0);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const user = session?.user ?? null;
  const canWrite = user?.role === "teacher" || user?.role === "admin";
  const isAdmin = user?.role === "admin";

  // Referência estável da sessão para guards de respostas em voo.
  // (sincronizada antes dos demais efeitos por ordem de declaração)
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /* ---------------------------------------------------------------- */
  /* Feedback                                                          */
  /* ---------------------------------------------------------------- */
  const pushToast = useCallback((tone: ToastTone, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-3), { id, tone, text }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Carregamento de dados                                             */
  /* ---------------------------------------------------------------- */
  const loadAll = useCallback(
    async (activeSession: Session) => {
      setLoading(true);
      try {
        const [dashboardData, contextData, eventsData, remindersData, importsData] =
          await Promise.all([
            getDashboard(activeSession.token),
            getContext(activeSession.token),
            getEvents(activeSession.token),
            getReminders(activeSession.token),
            activeSession.user.role === "admin"
              ? getCalendarImports(activeSession.token)
              : Promise.resolve<CalendarImport[]>([]),
          ]);
        if (sessionRef.current?.token !== activeSession.token) {
          // Resposta de uma sessão antiga (logout/troca de usuário no meio do voo).
          return;
        }
        setDashboard(dashboardData);
        setContext(contextData);
        setEvents(eventsData);
        setReminders(remindersData);
        setImports(importsData);
        const loadedAt = new Date();
        setLastLoadedAt(loadedAt);
        setReferenceNow(loadedAt.getTime());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          // Token revogado ou expirado: volta para a tela de login.
          setSession(null);
          localStorage.removeItem(SESSION_KEY);
          pushToast("info", "Sua sessão expirou. Entre novamente.");
        } else {
          pushToast("danger", errorMessage(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(async () => {
        const stored = localStorage.getItem(SESSION_KEY);
        if (!stored) {
          return;
        }
        const parsed = JSON.parse(stored) as Session;
        if (active) {
          setSession(parsed);
          // com a sessão salva já mostra a casca e o esqueleto enquanto os dados chegam
          setBooting(false);
        }
        await loadAll(parsed);
      })
      .catch(() => {
        localStorage.removeItem(SESSION_KEY);
      })
      .finally(() => {
        if (active) {
          setBooting(false);
        }
      });

    return () => {
      active = false;
    };
  }, [loadAll]);

  useEffect(() => {
    const activeSession = sessionRef.current;
    if (!activeSession || !selectedEventId) {
      return;
    }

    let active = true;
    void getEvent(activeSession.token, selectedEventId)
      .then((event) => {
        if (active) {
          setSelectedEventDetail(event);
          setReminderOffset(
            String(event.reminder?.offsetMinutes ?? activeSession.user.defaultReminderMinutes)
          );
        }
      })
      .catch((err) => {
        if (active) {
          pushToast("danger", errorMessage(err));
        }
      });

    return () => {
      active = false;
    };
    // Depende só do id selecionado: mudanças de perfil não devem refazer o
    // fetch nem descartar o offset escolhido no select.
  }, [selectedEventId, pushToast]);

  /* ---------------------------------------------------------------- */
  /* Derivações                                                        */
  /* ---------------------------------------------------------------- */
  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events
      .filter((event) => {
        const matchesCategory = selectedCategories.includes(event.category);
        const haystack = [
          event.title,
          event.description,
          event.subject?.name,
          event.teacher?.fullName,
          event.academicClass?.name,
          event.location,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return matchesCategory && (!term || haystack.includes(term));
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, search, selectedCategories]);

  const upcomingEvents = useMemo(() => {
    return events
      .filter(
        (event) =>
          new Date(event.startsAt).getTime() >= referenceNow &&
          event.status !== "cancelled" &&
          event.status !== "completed"
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, referenceNow]);

  const officialUpcoming = useMemo(
    () =>
      upcomingEvents.filter(
        (event) =>
          event.officialPriority || event.source === "official" || event.source === "imported"
      ),
    [upcomingEvents]
  );

  const canManageEvent = useCallback(
    (event: AcademicEvent) => {
      if (!user) {
        return false;
      }
      if (user.role === "admin") {
        return true;
      }
      if (user.role !== "teacher" || event.source !== "teacher") {
        return false;
      }
      if (event.teacherId === user.id) {
        return true;
      }
      if (!event.academicClassId) {
        return false;
      }
      return (context?.teachingAssignments ?? []).some(
        (assignment) =>
          assignment.academicClassId === event.academicClassId &&
          (!event.subjectId || assignment.subjectId === event.subjectId)
      );
    },
    [context, user]
  );

  const manageableEvents = useMemo(
    () =>
      events
        .filter(canManageEvent)
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [events, canManageEvent]
  );

  const selectedEvent =
    selectedEventId === null
      ? null
      : selectedEventDetail?.id === selectedEventId
        ? selectedEventDetail
        : (events.find((event) => event.id === selectedEventId) ?? null);

  /* ---------------------------------------------------------------- */
  /* Sessão                                                            */
  /* ---------------------------------------------------------------- */
  async function handleSession(nextSession: Session) {
    setSession(nextSession);
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    setActiveView("dashboard");
    await loadAll(nextSession);
    pushToast("success", `Boas-vindas, ${firstName(nextSession.user.fullName ?? nextSession.user.email)}!`);
  }

  function handleLogout() {
    if (session) {
      void logout(session.token).catch(() => undefined);
    }
    setSession(null);
    setDashboard(null);
    setContext(null);
    setEvents([]);
    setReminders([]);
    setImports([]);
    setSelectedEventId(null);
    setSelectedEventDetail(null);
    setEditingEventId(null);
    setEventForm(createInitialEventForm());
    setReferenceNow(0);
    setProfileOpen(false);
    localStorage.removeItem(SESSION_KEY);
  }

  async function refresh() {
    if (!session) {
      return;
    }
    await loadAll(session);
    pushToast("info", "Dados atualizados.");
  }

  /* ---------------------------------------------------------------- */
  /* Eventos                                                           */
  /* ---------------------------------------------------------------- */
  function toggleCategory(category: Category) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    );
  }

  function selectEvent(id: number | null) {
    setSelectedEventId(id);
    if (id === null) {
      setSelectedEventDetail(null);
    } else {
      setActiveView("calendar");
    }
  }

  function beginEdit(event: AcademicEvent) {
    setEditingEventId(event.id);
    setEventForm({
      title: event.title,
      description: event.description ?? "",
      category: event.category,
      startsAt: toDateTimeLocal(new Date(event.startsAt)),
      endsAt: event.endsAt ? toDateTimeLocal(new Date(event.endsAt)) : "",
      points: event.points === null ? "" : String(event.points),
      location: event.location ?? "",
      academicClassId: event.academicClassId ? String(event.academicClassId) : "",
      subjectId: event.subjectId ? String(event.subjectId) : "",
    });
    setActiveView("manage");
  }

  function resetEventForm() {
    setEditingEventId(null);
    setEventForm(createInitialEventForm());
  }

  function openNewEvent() {
    resetEventForm();
    setActiveView("manage");
  }

  function openNewEventFor(academicClassId: number, subjectId: number) {
    setEditingEventId(null);
    setEventForm({
      ...createInitialEventForm(),
      academicClassId: String(academicClassId),
      subjectId: String(subjectId),
    });
    setActiveView("manage");
  }

  async function saveEvent(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!session) {
      return;
    }

    if (eventForm.endsAt && eventForm.endsAt < eventForm.startsAt) {
      pushToast("danger", "O término precisa ser depois do início do evento.");
      return;
    }

    setSaving(true);
    try {
      const body = {
        title: eventForm.title.trim(),
        description: eventForm.description.trim() || null,
        category: eventForm.category,
        // datetime-local não carrega offset; envia ISO UTC para o backend
        // interpretar o instante correto independente do fuso do navegador
        startsAt: new Date(eventForm.startsAt).toISOString(),
        endsAt: eventForm.endsAt ? new Date(eventForm.endsAt).toISOString() : null,
        points: eventForm.points ? Number(eventForm.points) : null,
        location: eventForm.location.trim() || null,
        academicClassId: eventForm.academicClassId ? Number(eventForm.academicClassId) : null,
        subjectId: eventForm.subjectId ? Number(eventForm.subjectId) : null,
      };

      if (editingEventId) {
        await updateEvent(session.token, editingEventId, body);
        pushToast("success", "Evento atualizado com sucesso.");
        if (editingEventId === selectedEventId) {
          // O painel de detalhes prioriza o cache do detalhe; sincroniza.
          const detail = await getEvent(session.token, editingEventId);
          setSelectedEventDetail(detail);
        }
      } else {
        await createEvent(session.token, body);
        pushToast("success", "Evento criado e publicado para a turma.");
      }

      resetEventForm();
      await loadAll(session);
    } catch (err) {
      pushToast("danger", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function requestDeleteEvent(event: AcademicEvent) {
    setConfirm({
      title: "Excluir evento",
      message: `"${event.title}" será removido para todos os usuários da turma. Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir evento",
      action: async () => {
        if (!session) {
          return;
        }
        try {
          await deleteEvent(session.token, event.id);
          if (selectedEventId === event.id) {
            setSelectedEventId(null);
            setSelectedEventDetail(null);
          }
          if (editingEventId === event.id) {
            resetEventForm();
          }
          pushToast("success", "Evento removido.");
          await loadAll(session);
        } catch (err) {
          pushToast("danger", errorMessage(err));
        }
      },
    });
  }

  async function setEventStatus(
    event: AcademicEvent,
    status: "scheduled" | "completed" | "cancelled"
  ) {
    if (!session) {
      return;
    }
    setSaving(true);
    try {
      await updateEvent(session.token, event.id, { status });
      const labels = {
        scheduled: "Evento reativado na agenda.",
        completed: "Evento marcado como concluído.",
        cancelled: "Evento cancelado para a turma.",
      } as const;
      pushToast("success", labels[status]);
      await loadAll(session);
      const detail = await getEvent(session.token, event.id);
      setSelectedEventDetail(detail);
    } catch (err) {
      pushToast("danger", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Lembretes                                                         */
  /* ---------------------------------------------------------------- */
  async function handleSaveReminder() {
    if (!session || !selectedEvent) {
      return;
    }

    setSaving(true);
    try {
      await saveReminder(session.token, {
        academicEventId: selectedEvent.id,
        channel: "email",
        offsetMinutes: Number(reminderOffset),
        enabled: true,
      });
      pushToast("success", "Lembrete salvo. Você será avisado antes do evento.");
      await loadAll(session);
      const detail = await getEvent(session.token, selectedEvent.id);
      setSelectedEventDetail(detail);
    } catch (err) {
      pushToast("danger", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeReminderById(reminderId: number, eventId?: number) {
    if (!session) {
      return;
    }
    setSaving(true);
    try {
      await deleteReminder(session.token, reminderId);
      pushToast("success", "Lembrete removido.");
      await loadAll(session);
      if (eventId && selectedEventId === eventId) {
        const detail = await getEvent(session.token, eventId);
        setSelectedEventDetail(detail);
      }
    } catch (err) {
      pushToast("danger", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function removeReminderFromEvent(event: AcademicEvent) {
    if (event.reminder) {
      void removeReminderById(event.reminder.id, event.id);
    }
  }

  function removeReminder(reminder: Reminder) {
    void removeReminderById(reminder.id, reminder.academicEventId);
  }

  /* ---------------------------------------------------------------- */
  /* Sincronização                                                     */
  /* ---------------------------------------------------------------- */
  async function runImport(payload: CalendarImportInput, successText: string) {
    if (!session) {
      return;
    }
    setSaving(true);
    try {
      const result = await importCalendar(session.token, payload);
      pushToast(
        "success",
        `${successText} ${result.events.length} evento${result.events.length === 1 ? "" : "s"} adicionado${result.events.length === 1 ? "" : "s"}.`
      );
      await loadAll(session);
    } catch (err) {
      pushToast("danger", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function importOfficialDemo() {
    const base = new Date();
    void runImport(
      {
        sourceName: "Calendário oficial importado",
        sourceUrl: "https://www.ifms.edu.br/",
        checksum: `manual-${Date.now()}`,
        events: [
          {
            title: "Semana acadêmica",
            description: "Evento institucional integrado ao calendário.",
            category: "institutional",
            startsAt: addDays(startOfDay(base), 14).toISOString(),
            endsAt: addDays(startOfDay(base), 16).toISOString(),
            color: "#2563eb",
          },
          {
            title: "Prazo final de ajuste de matrícula",
            description: "Data oficial da secretaria acadêmica.",
            category: "institutional",
            startsAt: addDays(startOfDay(base), 18).toISOString(),
            color: "#0f766e",
          },
        ],
      },
      "Calendário oficial importado."
    );
  }

  function importJson(payload: CalendarImportInput) {
    void runImport(payload, "Importação concluída.");
  }

  /* ---------------------------------------------------------------- */
  /* Perfil                                                            */
  /* ---------------------------------------------------------------- */
  async function saveProfile(form: ProfileFormState) {
    if (!session) {
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProfile(session.token, {
        fullName: form.fullName.trim() || null,
        defaultReminderMinutes: Number(form.defaultReminderMinutes),
      });
      const nextSession = { ...session, user: updated };
      setSession(nextSession);
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setProfileOpen(false);
      pushToast("success", "Preferências salvas.");
    } catch (err) {
      pushToast("danger", errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */
  if (booting) {
    return (
      <main className="grid min-h-screen place-items-center bg-app text-ink">
        <div className="pop flex flex-col items-center gap-4" role="status">
          <span className="mark">
            <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
          </span>
          <Spinner label="Carregando agenda..." />
        </div>
      </main>
    );
  }

  if (!session || !user) {
    return (
      <>
        <LoginScreen onSession={(next) => void handleSession(next)} />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <>
      <AppShell
        activeView={activeView}
        badges={{ reminders: reminders.filter((reminder) => reminder.enabled && !reminder.sentAt).length }}
        canWrite={canWrite}
        refreshing={loading}
        search={search}
        updatedAt={lastLoadedAt}
        user={user}
        onLogout={handleLogout}
        onNavigate={setActiveView}
        onNewEvent={openNewEvent}
        onOpenProfile={() => setProfileOpen(true)}
        onRefresh={() => void refresh()}
        onSearchChange={(value) => {
          setSearch(value);
          // ao digitar, leva para o cronograma, onde a busca filtra a lista
          if (value.trim()) {
            setActiveView("calendar");
          }
        }}
      >
        {/* a chave reinicia a animação a cada troca de tela */}
        <div key={activeView} className="pop">
          {loading && !lastLoadedAt ? (
            <PageSkeleton />
          ) : (
            <>
          {activeView === "dashboard" && user.role === "student" ? (
            <StudentDashboard
              context={context}
              dashboard={dashboard}
              events={events}
              reminders={reminders}
              upcomingEvents={upcomingEvents}
              onOpenCalendar={() => setActiveView("calendar")}
              onOpenReminders={() => setActiveView("reminders")}
              onSelect={selectEvent}
            />
          ) : null}

          {activeView === "dashboard" && user.role === "teacher" ? (
            <TeacherDashboard
              context={context}
              manageableEvents={manageableEvents}
              officialUpcoming={officialUpcoming}
              referenceNow={referenceNow}
              upcomingEvents={upcomingEvents}
              onNewEvent={openNewEvent}
              onNewEventFor={openNewEventFor}
              onOpenManage={() => setActiveView("manage")}
              onSelect={selectEvent}
            />
          ) : null}

          {activeView === "dashboard" && user.role === "admin" ? (
            <AdminDashboard
              context={context}
              events={events}
              imports={imports}
              officialUpcoming={officialUpcoming}
              upcomingEvents={upcomingEvents}
              onNewEvent={openNewEvent}
              onOpenSync={() => setActiveView("sync")}
              onSelect={selectEvent}
            />
          ) : null}

          {activeView === "calendar" ? (
            <CalendarView
              allEvents={events}
              calendarMode={calendarMode}
              canManageEvent={canManageEvent}
              classes={context?.catalog.classes ?? []}
              role={user.role}
              events={filteredEvents}
              reminderOffset={reminderOffset}
              saving={saving}
              search={search}
              selectedCategories={selectedCategories}
              selectedEvent={selectedEvent}
              selectedEventId={selectedEventId}
              setCalendarMode={setCalendarMode}
              setCategories={setSelectedCategories}
              setReminderOffset={setReminderOffset}
              setSearch={setSearch}
              toggleCategory={toggleCategory}
              onDelete={requestDeleteEvent}
              onEdit={beginEdit}
              onRemoveReminder={removeReminderFromEvent}
              onSaveReminder={() => void handleSaveReminder()}
              onSelect={selectEvent}
              onSetStatus={(event, status) => void setEventStatus(event, status)}
            />
          ) : null}

          {activeView === "manage" ? (
            <ManageView
              canWrite={canWrite}
              context={context}
              editingEventId={editingEventId}
              eventForm={eventForm}
              isAdmin={isAdmin}
              manageableEvents={manageableEvents}
              saving={saving}
              setEventForm={setEventForm}
              onCancel={resetEventForm}
              onDelete={requestDeleteEvent}
              onEdit={beginEdit}
              onSave={(event) => void saveEvent(event)}
            />
          ) : null}

          {activeView === "reminders" ? (
            <RemindersView
              reminders={reminders}
              saving={saving}
              onDelete={removeReminder}
              onOpenEvent={selectEvent}
              onOpenProfile={() => setProfileOpen(true)}
            />
          ) : null}

          {activeView === "sync" ? (
            <SyncView
              events={events}
              imports={imports}
              isAdmin={isAdmin}
              saving={saving}
              onImportDemo={importOfficialDemo}
              onImportJson={importJson}
            />
          ) : null}
            </>
          )}
        </div>
      </AppShell>

      {profileOpen ? (
        <ProfileModal
          saving={saving}
          user={user}
          onClose={() => setProfileOpen(false)}
          onSave={(form) => void saveProfile(form)}
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          confirm={confirm}
          busy={confirmBusy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirmBusy(true);
            void Promise.resolve(confirm.action()).finally(() => {
              setConfirmBusy(false);
              setConfirm(null);
            });
          }}
        />
      ) : null}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
