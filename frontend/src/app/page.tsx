"use client";

import {
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit3,
  Filter,
  GraduationCap,
  ListChecks,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  apiFetch,
  getContext,
  getDashboard,
  getEvent,
  getEvents,
  getReminders,
  login,
} from "@/lib/api";
import type {
  AcademicContext,
  AcademicEvent,
  Category,
  Dashboard,
  Reminder,
  Session,
} from "@/lib/types";

const categoryMeta: Record<
  Category,
  { label: string; short: string; color: string; dot: string }
> = {
  exam: {
    label: "Provas",
    short: "Prova",
    color: "border-red-200 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
  assignment: {
    label: "Trabalhos",
    short: "Trabalho",
    color: "border-violet-200 bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
  },
  activity: {
    label: "Atividades",
    short: "Atividade",
    color: "border-cyan-200 bg-cyan-50 text-cyan-700",
    dot: "bg-cyan-500",
  },
  extracurricular: {
    label: "Extras",
    short: "Extra",
    color: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  institutional: {
    label: "Institucional",
    short: "Institucional",
    color: "border-blue-200 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
  },
  holiday: {
    label: "Feriados",
    short: "Feriado",
    color: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  recess: {
    label: "Recessos",
    short: "Recesso",
    color: "border-lime-200 bg-lime-50 text-lime-800",
    dot: "bg-lime-500",
  },
};

const allCategories = Object.keys(categoryMeta) as Category[];

const roleLabels = {
  student: "Aluno",
  teacher: "Professor",
  admin: "Admin",
};

const demoAccounts = [
  { label: "Aluno", email: "diogo@agenda.test", password: "password123" },
  { label: "Professor", email: "apio@agenda.test", password: "password123" },
  { label: "Admin", email: "admin@agenda.test", password: "password123" },
];

type View = "dashboard" | "calendar" | "manage" | "reminders" | "sync";
type CalendarMode = "list" | "calendar";

type EventFormState = {
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

const createInitialEventForm = (): EventFormState => ({
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

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loginForm, setLoginForm] = useState({
    email: demoAccounts[0].email,
    password: demoAccounts[0].password,
  });
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("list");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [context, setContext] = useState<AcademicContext | null>(null);
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState<AcademicEvent | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Category[]>(allCategories);
  const [search, setSearch] = useState("");
  const [eventForm, setEventForm] = useState<EventFormState>(createInitialEventForm);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [reminderOffset, setReminderOffset] = useState("1440");
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAll = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const [dashboardData, contextData, eventsData, remindersData] = await Promise.all([
        getDashboard(token),
        getContext(token),
        getEvents(token),
        getReminders(token),
      ]);
      setDashboard(dashboardData);
      setContext(contextData);
      setEvents(eventsData);
      setReminders(remindersData);
      setSelectedEventId((current) => current ?? eventsData[0]?.id ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(async () => {
        const stored = localStorage.getItem("agenda-academica-session");
        if (!stored) {
          return;
        }

        const parsed = JSON.parse(stored) as Session;
        if (active) {
          setSession(parsed);
        }
        await loadAll(parsed.token);
      })
      .catch(() => {
        localStorage.removeItem("agenda-academica-session");
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
    if (!session || !selectedEventId) {
      return;
    }

    let active = true;
    void getEvent(session.token, selectedEventId)
      .then((event) => {
        if (active) {
          setSelectedEventDetail(event);
          setReminderOffset(String(event.reminder?.offsetMinutes ?? session.user.defaultReminderMinutes));
        }
      })
      .catch((err) => {
        if (active) {
          setError(errorMessage(err));
        }
      });

    return () => {
      active = false;
    };
  }, [selectedEventId, session]);

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((event) => {
      const matchesCategory = selectedCategories.includes(event.category);
      const haystack = [event.title, event.description, event.subject?.name, event.teacher?.fullName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesCategory && (!term || haystack.includes(term));
    });
  }, [events, search, selectedCategories]);

  const groupedEvents = useMemo(() => {
    return filteredEvents.reduce<Record<string, AcademicEvent[]>>((acc, event) => {
      const key = new Date(event.startsAt).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      });
      acc[key] = [...(acc[key] ?? []), event];
      return acc;
    }, {});
  }, [filteredEvents]);

  const selectedEvent =
    selectedEventId === null
      ? null
      : (selectedEventDetail ?? events.find((event) => event.id === selectedEventId) ?? null);
  const user = session?.user ?? null;
  const canWrite = user?.role === "teacher" || user?.role === "admin";

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const nextSession = await login(loginForm.email, loginForm.password);
      setSession(nextSession);
      localStorage.setItem("agenda-academica-session", JSON.stringify(nextSession));
      await loadAll(nextSession.token);
      setNotice("Sessao iniciada.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    setSession(null);
    setDashboard(null);
    setContext(null);
    setEvents([]);
    setReminders([]);
    setSelectedEventId(null);
    setSelectedEventDetail(null);
    localStorage.removeItem("agenda-academica-session");
  }

  function selectDemo(email: string, password: string) {
    setLoginForm({ email, password });
  }

  async function refresh() {
    if (!session) {
      return;
    }
    await loadAll(session.token);
    setNotice("Dados atualizados.");
  }

  function toggleCategory(category: Category) {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
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

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    if (!session) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = {
        title: eventForm.title,
        description: eventForm.description || null,
        category: eventForm.category,
        startsAt: eventForm.startsAt,
        endsAt: eventForm.endsAt || null,
        points: eventForm.points ? Number(eventForm.points) : null,
        location: eventForm.location || null,
        academicClassId: eventForm.academicClassId ? Number(eventForm.academicClassId) : null,
        subjectId: eventForm.subjectId ? Number(eventForm.subjectId) : null,
      };

      if (editingEventId) {
        await apiFetch(`/events/${editingEventId}`, session.token, {
          method: "PUT",
          body,
        });
        setNotice("Evento atualizado.");
      } else {
        await apiFetch("/events", session.token, {
          method: "POST",
          body,
        });
        setNotice("Evento criado.");
      }

      resetEventForm();
      await loadAll(session.token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(id: number) {
    if (!session) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/events/${id}`, session.token, { method: "DELETE" });
      setSelectedEventId(null);
      setSelectedEventDetail(null);
      setNotice("Evento removido.");
      await loadAll(session.token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveReminder() {
    if (!session || !selectedEvent) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch("/reminders", session.token, {
        method: "POST",
        body: {
          academicEventId: selectedEvent.id,
          channel: session.user.notificationChannel,
          offsetMinutes: Number(reminderOffset),
          enabled: true,
        },
      });
      setNotice("Lembrete salvo.");
      await loadAll(session.token);
      const detail = await getEvent(session.token, selectedEvent.id);
      setSelectedEventDetail(detail);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function importOfficialDemo() {
    if (!session) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const base = new Date();
      await apiFetch("/calendar-imports", session.token, {
        method: "POST",
        body: {
          sourceName: "Calendario oficial importado",
          sourceUrl: "https://www.ifms.edu.br/",
          checksum: `manual-${Date.now()}`,
          events: [
            {
              title: "Semana academica",
              description: "Evento institucional integrado ao calendario.",
              category: "institutional",
              startsAt: toDateTimeLocal(addDays(base, 14)),
              endsAt: toDateTimeLocal(addDays(base, 16)),
              color: "#2563eb",
            },
            {
              title: "Prazo final de ajuste de matricula",
              description: "Data oficial de secretaria academica.",
              category: "institutional",
              startsAt: toDateTimeLocal(addDays(base, 18)),
              color: "#0f766e",
            },
          ],
        },
      });
      setNotice("Calendario oficial importado.");
      await loadAll(session.token);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (booting) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-100 text-zinc-700">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      </main>
    );
  }

  if (!session || !user) {
    return (
      <main className="min-h-screen bg-zinc-100 px-4 py-6 text-zinc-950 sm:px-6 lg:px-8">
        <section className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl grid-cols-1 overflow-hidden border border-zinc-200 bg-white shadow-sm lg:grid-cols-[0.95fr_1.05fr]">
          <div className="flex flex-col justify-between border-b border-zinc-200 bg-emerald-950 p-6 text-white lg:border-b-0 lg:border-r">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-emerald-900">
                  <GraduationCap className="h-6 w-6" aria-hidden />
                </span>
                <div>
                  <p className="text-sm text-emerald-100">Agenda Academica</p>
                  <h1 className="text-2xl font-semibold tracking-normal">Organizacao letiva</h1>
                </div>
              </div>
              <div className="mt-12 grid gap-3 text-sm text-emerald-50">
                <StatusLine icon={CalendarDays} text="Cronograma por provas, trabalhos e datas oficiais" />
                <StatusLine icon={Bell} text="Lembretes configuraveis por usuario" />
                <StatusLine icon={Users} text="Gestao docente por turma e disciplina" />
              </div>
            </div>
            <div className="mt-12 border-t border-emerald-800 pt-5 text-sm text-emerald-100">
              <p>Fonte unica para prazos academicos, sem notas ou controle de frequencia.</p>
            </div>
          </div>

          <div className="flex items-center justify-center p-6 sm:p-10">
            <form className="w-full max-w-md" onSubmit={handleLogin}>
              <div className="mb-7">
                <p className="text-sm font-medium text-emerald-700">Login academico</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-normal">Entrar na agenda</h2>
              </div>

              <div className="grid gap-3">
                <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                  E-mail
                  <input
                    className="h-11 rounded-md border border-zinc-300 px-3 text-zinc-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    value={loginForm.email}
                    onChange={(event) => setLoginForm((form) => ({ ...form, email: event.target.value }))}
                    type="email"
                    autoComplete="email"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                  Senha
                  <input
                    className="h-11 rounded-md border border-zinc-300 px-3 text-zinc-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                    value={loginForm.password}
                    onChange={(event) =>
                      setLoginForm((form) => ({ ...form, password: event.target.value }))
                    }
                    type="password"
                    autoComplete="current-password"
                  />
                </label>
              </div>

              {error ? <Alert tone="danger" text={error} /> : null}

              <button
                className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                type="submit"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserRound className="h-4 w-4" aria-hidden />}
                Entrar
              </button>

              <div className="mt-6 grid grid-cols-3 gap-2">
                {demoAccounts.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    title={`Usar conta ${account.label}`}
                    onClick={() => selectDemo(account.email, account.password)}
                    className="h-10 rounded-md border border-zinc-200 text-sm font-medium text-zinc-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    {account.label}
                  </button>
                ))}
              </div>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
              <GraduationCap className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-emerald-700">
                Agenda Academica
              </p>
              <h1 className="text-lg font-semibold tracking-normal sm:text-xl">
                Ola, {firstName(user.fullName ?? user.email)}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
              <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden />
              {roleLabels[user.role]}
            </span>
            <IconButton title="Atualizar dados" onClick={refresh} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </IconButton>
            <IconButton title="Sair" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8">
        <aside className="h-fit border border-zinc-200 bg-white p-2 shadow-sm lg:sticky lg:top-20">
          <nav className="grid gap-1">
            <NavButton active={activeView === "dashboard"} icon={CalendarClock} label="Dashboard" onClick={() => setActiveView("dashboard")} />
            <NavButton active={activeView === "calendar"} icon={CalendarDays} label="Cronograma" onClick={() => setActiveView("calendar")} />
            <NavButton active={activeView === "manage"} icon={Edit3} label="Gestao" onClick={() => setActiveView("manage")} />
            <NavButton active={activeView === "reminders"} icon={Bell} label="Lembretes" onClick={() => setActiveView("reminders")} />
            <NavButton active={activeView === "sync"} icon={RefreshCw} label="Sincronizacao" onClick={() => setActiveView("sync")} />
          </nav>
        </aside>

        <section className="min-w-0">
          {notice ? <Alert tone="success" text={notice} onClose={() => setNotice(null)} /> : null}
          {error ? <Alert tone="danger" text={error} onClose={() => setError(null)} /> : null}

          {activeView === "dashboard" ? (
            <DashboardView dashboard={dashboard} events={events} onSelect={(id) => { setSelectedEventId(id); setActiveView("calendar"); }} />
          ) : null}

          {activeView === "calendar" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-700">Cronograma</p>
                    <h2 className="text-xl font-semibold tracking-normal">Eventos academicos</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <SegmentedButton active={calendarMode === "list"} onClick={() => setCalendarMode("list")} icon={ListChecks} label="Lista" />
                    <SegmentedButton active={calendarMode === "calendar"} onClick={() => setCalendarMode("calendar")} icon={CalendarDays} label="Calendario" />
                  </div>
                </div>

                <Filters
                  search={search}
                  setSearch={setSearch}
                  selectedCategories={selectedCategories}
                  toggleCategory={toggleCategory}
                />

                {calendarMode === "list" ? (
                  <div className="grid gap-2">
                    {filteredEvents.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        selected={selectedEventId === event.id}
                        onClick={() => setSelectedEventId(event.id)}
                      />
                    ))}
                    {!filteredEvents.length ? <EmptyState text="Nenhum evento encontrado." /> : null}
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(groupedEvents).map(([day, dayEvents]) => (
                      <div key={day} className="min-h-36 border border-zinc-200 bg-zinc-50 p-3">
                        <p className="text-sm font-semibold text-zinc-800">{day}</p>
                        <div className="mt-3 grid gap-2">
                          {dayEvents.map((event) => (
                            <button
                              key={event.id}
                              className="w-full rounded-md border border-zinc-200 bg-white p-2 text-left text-sm transition hover:border-emerald-300"
                              onClick={() => setSelectedEventId(event.id)}
                              type="button"
                            >
                              <span className={`mr-2 inline-block h-2 w-2 rounded-full ${categoryMeta[event.category].dot}`} />
                              {event.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {!filteredEvents.length ? <EmptyState text="Nenhum evento encontrado." /> : null}
                  </div>
                )}
              </section>

              <EventDetail
                event={selectedEvent}
                canWrite={canWrite}
                saving={saving}
                reminderOffset={reminderOffset}
                setReminderOffset={setReminderOffset}
                onReminder={saveReminder}
                onEdit={beginEdit}
                onDelete={deleteEvent}
              />
            </div>
          ) : null}

          {activeView === "manage" ? (
            <ManageView
              canWrite={canWrite}
              context={context}
              eventForm={eventForm}
              editingEventId={editingEventId}
              saving={saving}
              setEventForm={setEventForm}
              onCancel={resetEventForm}
              onSave={saveEvent}
            />
          ) : null}

          {activeView === "reminders" ? <RemindersView reminders={reminders} /> : null}

          {activeView === "sync" ? (
            <SyncView
              isAdmin={user.role === "admin"}
              saving={saving}
              events={events}
              onImport={importOfficialDemo}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function DashboardView({
  dashboard,
  events,
  onSelect,
}: {
  dashboard: Dashboard | null;
  events: AcademicEvent[];
  onSelect: (id: number) => void;
}) {
  const upcoming = dashboard?.upcoming ?? events.slice(0, 5);
  const important = dashboard?.important ?? upcoming.slice(0, 3);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard icon={CalendarDays} label="Proximos 30 dias" value={String(dashboard?.metrics.upcomingCount ?? upcoming.length)} />
        <MetricCard icon={Bell} label="Lembretes ativos" value={String(dashboard?.metrics.remindersCount ?? 0)} />
        <MetricCard icon={CheckCircle2} label="Categorias visiveis" value={String(Object.keys(dashboard?.metrics.categories ?? {}).length || allCategories.length)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
            <div>
              <p className="text-sm font-medium text-emerald-700">Importante</p>
              <h2 className="text-xl font-semibold tracking-normal">Prazos iminentes</h2>
            </div>
            <Clock className="h-5 w-5 text-zinc-500" aria-hidden />
          </div>
          <div className="mt-4 grid gap-2">
            {important.map((event) => (
              <EventRow key={event.id} event={event} compact onClick={() => onSelect(event.id)} />
            ))}
            {!important.length ? <EmptyState text="Sem prazos iminentes." /> : null}
          </div>
        </section>

        <section className="border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
            <div>
              <p className="text-sm font-medium text-emerald-700">Agenda</p>
              <h2 className="text-xl font-semibold tracking-normal">Linha do tempo</h2>
            </div>
            <CalendarClock className="h-5 w-5 text-zinc-500" aria-hidden />
          </div>
          <div className="mt-4 grid gap-2">
            {upcoming.map((event) => (
              <EventRow key={event.id} event={event} compact onClick={() => onSelect(event.id)} />
            ))}
            {!upcoming.length ? <EmptyState text="Nenhum evento futuro." /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function ManageView({
  canWrite,
  context,
  eventForm,
  editingEventId,
  saving,
  setEventForm,
  onCancel,
  onSave,
}: {
  canWrite: boolean;
  context: AcademicContext | null;
  eventForm: EventFormState;
  editingEventId: number | null;
  saving: boolean;
  setEventForm: (updater: (form: EventFormState) => EventFormState) => void;
  onCancel: () => void;
  onSave: (event: FormEvent) => void;
}) {
  if (!canWrite) {
    return (
      <section className="border border-zinc-200 bg-white p-6 shadow-sm">
        <ShieldCheck className="h-8 w-8 text-emerald-700" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold tracking-normal">Gestao docente</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-600">
          Seu perfil visualiza eventos e configura lembretes. A criacao e alteracao de datas fica com
          professores e administradores.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form className="border border-zinc-200 bg-white p-4 shadow-sm" onSubmit={onSave}>
        <div className="flex flex-col gap-2 border-b border-zinc-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">Gestao docente</p>
            <h2 className="text-xl font-semibold tracking-normal">
              {editingEventId ? "Editar evento" : "Novo evento"}
            </h2>
          </div>
          {editingEventId ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              <X className="h-4 w-4" aria-hidden />
              Novo
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Titulo" className="md:col-span-2">
            <input
              className="input"
              value={eventForm.title}
              onChange={(event) => setEventForm((form) => ({ ...form, title: event.target.value }))}
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
              {allCategories.map((category) => (
                <option key={category} value={category}>
                  {categoryMeta[category].short}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pontuacao informativa">
            <input
              className="input"
              value={eventForm.points}
              onChange={(event) => setEventForm((form) => ({ ...form, points: event.target.value }))}
              min="0"
              step="0.5"
              type="number"
            />
          </Field>
          <Field label="Inicio">
            <input
              className="input"
              value={eventForm.startsAt}
              onChange={(event) => setEventForm((form) => ({ ...form, startsAt: event.target.value }))}
              required
              type="datetime-local"
            />
          </Field>
          <Field label="Fim">
            <input
              className="input"
              value={eventForm.endsAt}
              onChange={(event) => setEventForm((form) => ({ ...form, endsAt: event.target.value }))}
              type="datetime-local"
            />
          </Field>
          <Field label="Turma">
            <select
              className="input"
              value={eventForm.academicClassId}
              onChange={(event) =>
                setEventForm((form) => ({ ...form, academicClassId: event.target.value }))
              }
              required
            >
              <option value="">Selecione</option>
              {(context?.catalog.classes ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} - {item.course?.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Disciplina">
            <select
              className="input"
              value={eventForm.subjectId}
              onChange={(event) =>
                setEventForm((form) => ({ ...form, subjectId: event.target.value }))
              }
              required
            >
              <option value="">Selecione</option>
              {(context?.catalog.subjects ?? []).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Local" className="md:col-span-2">
            <input
              className="input"
              value={eventForm.location}
              onChange={(event) => setEventForm((form) => ({ ...form, location: event.target.value }))}
            />
          </Field>
          <Field label="Descricao" className="md:col-span-2">
            <textarea
              className="input min-h-28 resize-y py-3"
              value={eventForm.description}
              onChange={(event) =>
                setEventForm((form) => ({ ...form, description: event.target.value }))
              }
            />
          </Field>
        </div>

        <button
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar evento
        </button>
      </form>

      <aside className="border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-emerald-700">Vinculos</p>
        <h3 className="mt-1 text-lg font-semibold tracking-normal">Turmas ministradas</h3>
        <div className="mt-4 grid gap-2">
          {(context?.teachingAssignments ?? []).map((assignment) => (
            <div key={assignment.id} className="border border-zinc-200 bg-zinc-50 p-3 text-sm">
              <p className="font-semibold text-zinc-900">{assignment.subject?.name}</p>
              <p className="mt-1 text-zinc-600">{assignment.academicClass?.name}</p>
            </div>
          ))}
          {!context?.teachingAssignments.length ? <EmptyState text="Sem vinculos docentes." /> : null}
        </div>
      </aside>
    </section>
  );
}

function EventDetail({
  event,
  canWrite,
  saving,
  reminderOffset,
  setReminderOffset,
  onReminder,
  onEdit,
  onDelete,
}: {
  event: AcademicEvent | null;
  canWrite: boolean;
  saving: boolean;
  reminderOffset: string;
  setReminderOffset: (value: string) => void;
  onReminder: () => void;
  onEdit: (event: AcademicEvent) => void;
  onDelete: (id: number) => void;
}) {
  if (!event) {
    return <EmptyState text="Selecione um evento." />;
  }

  return (
    <aside className="border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={`inline-flex border px-2 py-1 text-xs font-semibold ${categoryMeta[event.category].color}`}>
            {categoryMeta[event.category].short}
          </span>
          <h2 className="mt-3 text-xl font-semibold tracking-normal">{event.title}</h2>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
      </div>

      <dl className="mt-5 grid gap-3 text-sm">
        <InfoLine icon={CalendarDays} label="Data" value={formatDate(event.startsAt)} />
        <InfoLine icon={BookOpen} label="Disciplina" value={event.subject?.name ?? "Evento oficial"} />
        <InfoLine icon={Users} label="Turma" value={event.academicClass?.name ?? "Todos"} />
        <InfoLine icon={UserRound} label="Responsavel" value={event.teacher?.fullName ?? "Institucional"} />
        <InfoLine icon={ListChecks} label="Pontuacao" value={event.points === null ? "Nao informada" : `${event.points} pts`} />
      </dl>

      <div className="mt-5 border-t border-zinc-200 pt-4">
        <p className="text-sm leading-6 text-zinc-700">
          {event.description ?? "Sem descricao complementar."}
        </p>
      </div>

      <div className="mt-5 border-t border-zinc-200 pt-4">
        <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
          Lembrete
          <select
            className="input"
            value={reminderOffset}
            onChange={(event) => setReminderOffset(event.target.value)}
          >
            <option value="60">1 hora antes</option>
            <option value="360">6 horas antes</option>
            <option value="1440">1 dia antes</option>
            <option value="2880">2 dias antes</option>
            <option value="10080">1 semana antes</option>
          </select>
        </label>
        <button
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60"
          disabled={saving}
          onClick={onReminder}
          type="button"
        >
          <Bell className="h-4 w-4" aria-hidden />
          Salvar lembrete
        </button>
      </div>

      {canWrite ? (
        <div className="mt-5 flex gap-2 border-t border-zinc-200 pt-4">
          <button
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            onClick={() => onEdit(event)}
            type="button"
          >
            <Edit3 className="h-4 w-4" aria-hidden />
            Editar
          </button>
          <button
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 transition hover:bg-red-50"
            onClick={() => onDelete(event.id)}
            type="button"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Excluir
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function RemindersView({ reminders }: { reminders: Reminder[] }) {
  return (
    <section className="border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
        <div>
          <p className="text-sm font-medium text-emerald-700">Lembretes</p>
          <h2 className="text-xl font-semibold tracking-normal">Alertas configurados</h2>
        </div>
        <Mail className="h-5 w-5 text-zinc-500" aria-hidden />
      </div>
      <div className="mt-4 grid gap-2">
        {reminders.map((reminder) => (
          <div key={reminder.id} className="grid gap-2 border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="font-semibold text-zinc-900">{reminder.academicEvent?.title ?? `Evento #${reminder.academicEventId}`}</p>
              <p className="mt-1 text-sm text-zinc-600">{formatDate(reminder.sendAt)} por {reminder.channel}</p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Ativo
            </span>
          </div>
        ))}
        {!reminders.length ? <EmptyState text="Nenhum lembrete configurado." /> : null}
      </div>
    </section>
  );
}

function SyncView({
  isAdmin,
  saving,
  events,
  onImport,
}: {
  isAdmin: boolean;
  saving: boolean;
  events: AcademicEvent[];
  onImport: () => void;
}) {
  const officialCount = events.filter((event) => event.source === "imported" || event.officialPriority).length;

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-emerald-700">Sincronizacao institucional</p>
        <h2 className="mt-1 text-xl font-semibold tracking-normal">Calendario da reitoria</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
          Datas oficiais entram como eventos prioritarios e aparecem para todos os usuarios.
        </p>
        <button
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!isAdmin || saving}
          onClick={onImport}
          type="button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Importar calendario
        </button>
      </div>
      <div className="border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-zinc-500">Eventos oficiais</p>
        <p className="mt-2 text-4xl font-semibold tracking-normal">{officialCount}</p>
        <p className="mt-2 text-sm text-zinc-600">
          {isAdmin ? "Acesso de importacao habilitado." : "Importacao restrita a administradores."}
        </p>
      </div>
    </section>
  );
}

function Filters({
  search,
  setSearch,
  selectedCategories,
  toggleCategory,
}: {
  search: string;
  setSearch: (value: string) => void;
  selectedCategories: Category[];
  toggleCategory: (category: Category) => void;
}) {
  return (
    <div className="my-4 grid gap-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          className="h-10 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          placeholder="Buscar por titulo, disciplina ou professor"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex h-8 items-center gap-2 text-sm font-medium text-zinc-600">
          <Filter className="h-4 w-4" aria-hidden />
          Filtros
        </span>
        {allCategories.map((category) => {
          const active = selectedCategories.includes(category);
          return (
            <button
              key={category}
              className={`h-8 rounded-md border px-3 text-sm font-medium transition ${
                active ? categoryMeta[category].color : "border-zinc-200 bg-white text-zinc-600"
              }`}
              onClick={() => toggleCategory(category)}
              type="button"
            >
              {categoryMeta[category].label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventRow({
  event,
  selected,
  compact,
  onClick,
}: {
  event: AcademicEvent;
  selected?: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`grid w-full gap-3 border p-3 text-left transition sm:grid-cols-[auto_1fr_auto] sm:items-center ${
        selected ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 bg-white hover:border-emerald-300"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className={`h-10 w-10 rounded-md ${categoryMeta[event.category].dot}`} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-zinc-900">{event.title}</span>
        <span className="mt-1 block truncate text-sm text-zinc-600">
          {event.subject?.name ?? "Institucional"} {event.academicClass ? `- ${event.academicClass.name}` : ""}
        </span>
      </span>
      <span className="flex items-center gap-2 text-sm font-medium text-zinc-700 sm:justify-end">
        <Clock className="h-4 w-4 text-zinc-400" aria-hidden />
        {compact ? formatShortDate(event.startsAt) : formatDate(event.startsAt)}
      </span>
    </button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-600">{label}</p>
        <Icon className="h-5 w-5 text-emerald-700" aria-hidden />
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof CalendarDays;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition ${
        active ? "bg-emerald-700 text-white" : "text-zinc-700 hover:bg-zinc-100"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

function SegmentedButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof ListChecks;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
        active
          ? "border-emerald-700 bg-emerald-700 text-white"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

function IconButton({
  title,
  disabled,
  children,
  onClick,
}: {
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium text-zinc-700 ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

function InfoLine({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[24px_92px_1fr] items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden />
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-zinc-900">{value}</dd>
    </div>
  );
}

function StatusLine({ icon: Icon, text }: { icon: typeof CalendarDays; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-5 w-5 text-emerald-200" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

function Alert({
  tone,
  text,
  onClose,
}: {
  tone: "success" | "danger";
  text: string;
  onClose?: () => void;
}) {
  return (
    <div
      className={`mb-4 flex items-center justify-between gap-3 border px-3 py-2 text-sm ${
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      <span>{text}</span>
      {onClose ? (
        <button className="rounded-md p-1 hover:bg-white/70" onClick={onClose} title="Fechar" type="button">
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-500">
      {text}
    </div>
  );
}

function firstName(value: string) {
  return value.split(" ")[0] ?? value;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function toDateTimeLocal(value: Date) {
  const offset = value.getTimezoneOffset();
  const local = new Date(value.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Algo saiu fora do esperado.";
}
