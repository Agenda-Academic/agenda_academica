"use client";

import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Edit3,
  Filter,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Mail,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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

type View = "dashboard" | "calendar" | "manage" | "reminders" | "sync";
type CalendarMode = "list" | "calendar";

type CategoryMeta = {
  label: string;
  short: string;
  accent: string;
  pill: string;
  tint: string;
  rail: string;
};

const categoryMeta: Record<Category, CategoryMeta> = {
  exam: {
    label: "Provas",
    short: "Prova",
    accent: "bg-rose-500",
    pill: "border-rose-200 bg-rose-50 text-rose-700",
    tint: "bg-rose-50 text-rose-700",
    rail: "border-l-rose-500",
  },
  assignment: {
    label: "Trabalhos",
    short: "Trabalho",
    accent: "bg-indigo-500",
    pill: "border-indigo-200 bg-indigo-50 text-indigo-700",
    tint: "bg-indigo-50 text-indigo-700",
    rail: "border-l-indigo-500",
  },
  activity: {
    label: "Atividades",
    short: "Atividade",
    accent: "bg-sky-500",
    pill: "border-sky-200 bg-sky-50 text-sky-700",
    tint: "bg-sky-50 text-sky-700",
    rail: "border-l-sky-500",
  },
  extracurricular: {
    label: "Extras",
    short: "Extra",
    accent: "bg-amber-500",
    pill: "border-amber-200 bg-amber-50 text-amber-800",
    tint: "bg-amber-50 text-amber-800",
    rail: "border-l-amber-500",
  },
  institutional: {
    label: "Institucional",
    short: "Institucional",
    accent: "bg-blue-500",
    pill: "border-blue-200 bg-blue-50 text-blue-700",
    tint: "bg-blue-50 text-blue-700",
    rail: "border-l-blue-500",
  },
  holiday: {
    label: "Feriados",
    short: "Feriado",
    accent: "bg-emerald-500",
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
    tint: "bg-emerald-50 text-emerald-700",
    rail: "border-l-emerald-500",
  },
  recess: {
    label: "Recessos",
    short: "Recesso",
    accent: "bg-lime-500",
    pill: "border-lime-200 bg-lime-50 text-lime-800",
    tint: "bg-lime-50 text-lime-800",
    rail: "border-l-lime-500",
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

const navItems: Array<{ view: View; label: string; icon: LucideIcon }> = [
  { view: "dashboard", label: "Painel", icon: LayoutDashboard },
  { view: "calendar", label: "Cronograma", icon: CalendarDays },
  { view: "manage", label: "Gestao", icon: Edit3 },
  { view: "reminders", label: "Lembretes", icon: Bell },
  { view: "sync", label: "Sincronizacao", icon: RefreshCw },
];

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
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [referenceNow, setReferenceNow] = useState(0);

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
      const loadedAt = new Date();
      setLastLoadedAt(loadedAt);
      setReferenceNow(loadedAt.getTime());
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
    return events
      .filter((event) => {
        const matchesCategory = selectedCategories.includes(event.category);
        const haystack = [
          event.title,
          event.description,
          event.subject?.name,
          event.teacher?.fullName,
          event.academicClass?.name,
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
      .filter((event) => new Date(event.startsAt).getTime() >= referenceNow && event.status === "scheduled")
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events, referenceNow]);

  const attentionEvents = useMemo(() => {
    const source = dashboard?.important?.length ? dashboard.important : upcomingEvents.slice(0, 3);
    return source.slice(0, 4);
  }, [dashboard, upcomingEvents]);

  const selectedEvent =
    selectedEventId === null
      ? null
      : (selectedEventDetail?.id === selectedEventId
          ? selectedEventDetail
          : events.find((event) => event.id === selectedEventId) ?? null);
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
    setReferenceNow(0);
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
        : [...current, category]
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
      <main className="grid min-h-screen place-items-center bg-[#f5f7fb] text-slate-700">
        <div className="surface flex items-center gap-3 px-5 py-4">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-700" aria-hidden />
          <span className="text-sm font-medium">Carregando agenda</span>
        </div>
      </main>
    );
  }

  if (!session || !user) {
    return (
      <LoginScreen
        error={error}
        loading={loading}
        loginForm={loginForm}
        onSubmit={handleLogin}
        onPickDemo={selectDemo}
        setLoginForm={setLoginForm}
      />
    );
  }

  return (
    <main className="min-h-screen bg-app text-slate-950">
      <div className="mx-auto grid max-w-[1500px] gap-4 px-3 py-3 sm:px-5 lg:grid-cols-[250px_minmax(0,1fr)] lg:px-6">
        <Sidebar
          activeView={activeView}
          canWrite={canWrite}
          lastLoadedAt={lastLoadedAt}
          onLogout={handleLogout}
          onNavigate={setActiveView}
          onRefresh={refresh}
          refreshing={loading}
          user={user}
        />

        <section className="min-w-0">
          <CommandBar
            activeView={activeView}
            lastLoadedAt={lastLoadedAt}
            search={search}
            setSearch={setSearch}
            userName={user.fullName ?? user.email}
          />

          <div className="mt-4">
            {notice ? <Alert tone="success" text={notice} onClose={() => setNotice(null)} /> : null}
            {error ? <Alert tone="danger" text={error} onClose={() => setError(null)} /> : null}

            {activeView === "dashboard" ? (
              <DashboardView
                attentionEvents={attentionEvents}
                context={context}
                dashboard={dashboard}
                events={events}
                lastLoadedAt={lastLoadedAt}
                reminders={reminders}
                upcomingEvents={upcomingEvents}
                onOpenCalendar={() => setActiveView("calendar")}
                onSelect={(id) => {
                  setSelectedEventId(id);
                  setActiveView("calendar");
                }}
              />
            ) : null}

            {activeView === "calendar" ? (
              <CalendarView
                calendarMode={calendarMode}
                canWrite={canWrite}
                events={filteredEvents}
                reminderOffset={reminderOffset}
                saving={saving}
                search={search}
                selectedCategories={selectedCategories}
                selectedEvent={selectedEvent}
                selectedEventId={selectedEventId}
                setCalendarMode={setCalendarMode}
                setReminderOffset={setReminderOffset}
                setSearch={setSearch}
                toggleCategory={toggleCategory}
                onDelete={deleteEvent}
                onEdit={beginEdit}
                onReminder={saveReminder}
                onSelect={setSelectedEventId}
              />
            ) : null}

            {activeView === "manage" ? (
              <ManageView
                canWrite={canWrite}
                context={context}
                editingEventId={editingEventId}
                eventForm={eventForm}
                saving={saving}
                setEventForm={setEventForm}
                onCancel={resetEventForm}
                onSave={saveEvent}
              />
            ) : null}

            {activeView === "reminders" ? <RemindersView reminders={reminders} /> : null}

            {activeView === "sync" ? (
              <SyncView
                events={events}
                isAdmin={user.role === "admin"}
                saving={saving}
                onImport={importOfficialDemo}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function LoginScreen({
  error,
  loading,
  loginForm,
  setLoginForm,
  onSubmit,
  onPickDemo,
}: {
  error: string | null;
  loading: boolean;
  loginForm: { email: string; password: string };
  setLoginForm: (value: { email: string; password: string }) => void;
  onSubmit: (event: FormEvent) => void;
  onPickDemo: (email: string, password: string) => void;
}) {
  return (
    <main className="min-h-screen bg-login px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-6xl overflow-hidden rounded-lg border border-white/70 bg-white/82 shadow-2xl shadow-slate-900/10 backdrop-blur xl:grid-cols-[1.08fr_0.92fr]">
        <div className="relative flex min-h-[520px] flex-col justify-between overflow-hidden bg-slate-950 p-6 text-white sm:p-8">
          <div className="absolute inset-0 opacity-80 [background:linear-gradient(135deg,#0f172a_0%,#064e3b_42%,#312e81_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.96))]" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-emerald-800 shadow-lg shadow-emerald-950/20">
                <GraduationCap className="h-6 w-6" aria-hidden />
              </span>
              <div>
                <p className="text-sm text-emerald-100">Agenda Academica</p>
                <h1 className="text-2xl font-semibold tracking-normal">Painel de prazos do semestre</h1>
              </div>
            </div>

            <div className="mt-12 max-w-xl">
              <p className="text-sm font-medium uppercase tracking-normal text-emerald-100">
                Fonte unica de verdade
              </p>
              <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-normal sm:text-5xl">
                Veja o que importa hoje, esta semana e no calendario oficial.
              </h2>
            </div>
          </div>

          <div className="relative mt-10 grid gap-3 rounded-lg border border-white/15 bg-white/10 p-3 backdrop-blur md:grid-cols-3">
            <PreviewMetric label="Proximos" value="5" />
            <PreviewMetric label="Lembretes" value="3" />
            <PreviewMetric label="Oficiais" value="2" />
          </div>
        </div>

        <div className="flex items-center justify-center p-5 sm:p-8">
          <form className="w-full max-w-md" onSubmit={onSubmit}>
            <div className="mb-7">
              <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Acesso academico
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-normal">Entrar na agenda</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Use uma conta de teste para navegar como aluno, professor ou administrador.
              </p>
            </div>

            <div className="grid gap-3">
              <Field label="E-mail">
                <input
                  className="input"
                  value={loginForm.email}
                  onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                  type="email"
                  autoComplete="email"
                />
              </Field>
              <Field label="Senha">
                <input
                  className="input"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                  type="password"
                  autoComplete="current-password"
                />
              </Field>
            </div>

            {error ? <Alert tone="danger" text={error} /> : null}

            <button className="btn-primary mt-5 w-full" disabled={loading} type="submit">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserRound className="h-4 w-4" aria-hidden />}
              Entrar
            </button>

            <div className="mt-6 grid grid-cols-3 gap-2">
              {demoAccounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  title={`Usar conta ${account.label}`}
                  onClick={() => onPickDemo(account.email, account.password)}
                  className={cx(
                    "h-11 rounded-md border text-sm font-semibold transition",
                    loginForm.email === account.email
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  )}
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

function Sidebar({
  activeView,
  canWrite,
  lastLoadedAt,
  refreshing,
  user,
  onLogout,
  onNavigate,
  onRefresh,
}: {
  activeView: View;
  canWrite: boolean;
  lastLoadedAt: Date | null;
  refreshing: boolean;
  user: Session["user"];
  onLogout: () => void;
  onNavigate: (view: View) => void;
  onRefresh: () => void;
}) {
  return (
    <aside className="surface sticky top-3 z-30 h-fit p-3">
      <div className="flex items-center gap-3 border-b border-slate-200/80 px-2 pb-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white">
          <GraduationCap className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">Agenda Academica</p>
          <p className="text-xs text-slate-500">IFMS Tres Lagoas</p>
        </div>
      </div>

      <nav className="mt-3 grid gap-1">
        {navItems.map((item) => (
          <button
            key={item.view}
            className={cx(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition",
              activeView === item.view
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            )}
            onClick={() => onNavigate(item.view)}
            type="button"
          >
            <item.icon className="h-4 w-4" aria-hidden />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-sm font-bold text-slate-900 shadow-sm">
            {user.initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">{user.fullName ?? user.email}</p>
            <p className="text-xs text-slate-500">{roleLabels[user.role]}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <span className="rounded-md bg-white px-2 py-1 font-medium text-slate-600">
            {canWrite ? "Pode editar" : "Somente leitura"}
          </span>
          <span className="rounded-md bg-white px-2 py-1 font-medium text-slate-600">
            {lastLoadedAt ? formatTime(lastLoadedAt.toISOString()) : "Aguardando"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button className="btn-secondary flex-1" onClick={onRefresh} disabled={refreshing} type="button">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </button>
        <button className="icon-button" onClick={onLogout} title="Sair" type="button">
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}

function CommandBar({
  activeView,
  lastLoadedAt,
  search,
  setSearch,
  userName,
}: {
  activeView: View;
  lastLoadedAt: Date | null;
  search: string;
  setSearch: (value: string) => void;
  userName: string;
}) {
  return (
    <header className="surface flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-medium text-emerald-700">{viewEyebrow(activeView)}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
          Ola, {firstName(userName)}
        </h1>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
            placeholder="Buscar evento, disciplina ou professor"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <span className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
          {lastLoadedAt ? `Sync ${formatTime(lastLoadedAt.toISOString())}` : "Sem sync"}
        </span>
      </div>
    </header>
  );
}

function DashboardView({
  attentionEvents,
  context,
  dashboard,
  events,
  lastLoadedAt,
  reminders,
  upcomingEvents,
  onOpenCalendar,
  onSelect,
}: {
  attentionEvents: AcademicEvent[];
  context: AcademicContext | null;
  dashboard: Dashboard | null;
  events: AcademicEvent[];
  lastLoadedAt: Date | null;
  reminders: Reminder[];
  upcomingEvents: AcademicEvent[];
  onOpenCalendar: () => void;
  onSelect: (id: number) => void;
}) {
  const nextEvent = upcomingEvents[0] ?? null;
  const officialCount = events.filter((event) => event.source === "imported" || event.officialPriority).length;
  const categories = dashboard?.metrics.categories ?? {};

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="surface overflow-hidden">
          <div className="border-b border-slate-200/80 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <span className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Central de foco
                </span>
                <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-normal text-slate-950">
                  {nextEvent ? nextEvent.title : "Sem prazos urgentes no momento"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {nextEvent
                    ? `${categoryMeta[nextEvent.category].short} em ${relativeDue(nextEvent.startsAt)}`
                    : "Quando a agenda receber novos eventos, o proximo compromisso aparece aqui."}
                </p>
              </div>
              <button className="btn-primary w-fit" type="button" onClick={onOpenCalendar}>
                <CalendarDays className="h-4 w-4" aria-hidden />
                Abrir cronograma
              </button>
            </div>
          </div>

          <div className="grid gap-px bg-slate-200/80 md:grid-cols-4">
            <InsightTile icon={Target} label="Proximos 30 dias" value={String(dashboard?.metrics.upcomingCount ?? upcomingEvents.length)} />
            <InsightTile icon={Bell} label="Lembretes ativos" value={String(dashboard?.metrics.remindersCount ?? reminders.length)} />
            <InsightTile icon={ShieldCheck} label="Eventos oficiais" value={String(officialCount)} />
            <InsightTile icon={BookOpen} label="Turmas visiveis" value={String(context?.catalog.classes.length ?? 0)} />
          </div>
        </div>

        <div className="surface p-4">
          <SectionTitle
            eyebrow="Agora"
            icon={AlertTriangle}
            title="Fila de atencao"
            subtitle={lastLoadedAt ? `Atualizado ${formatTime(lastLoadedAt.toISOString())}` : "Aguardando dados"}
          />
          <div className="mt-4 grid gap-2">
            {attentionEvents.map((event) => (
              <EventRow key={event.id} event={event} compact onClick={() => onSelect(event.id)} />
            ))}
            {!attentionEvents.length ? <EmptyState text="Sem alertas importantes." /> : null}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface p-4">
          <SectionTitle
            eyebrow="Semana"
            icon={CalendarClock}
            title="Agenda dos proximos dias"
            subtitle="Prazos, provas e eventos oficiais em ordem de chegada"
          />
          <WeekStrip events={upcomingEvents.slice(0, 10)} onSelect={onSelect} />
        </div>

        <div className="surface p-4">
          <SectionTitle
            eyebrow="Categorias"
            icon={Filter}
            title="Distribuicao"
            subtitle="Leitura rapida do tipo de demanda"
          />
          <div className="mt-4 grid gap-2">
            {allCategories.map((category) => (
              <CategoryBar
                key={category}
                category={category}
                count={categories[category] ?? events.filter((event) => event.category === category).length}
                total={Math.max(events.length, 1)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CalendarView({
  calendarMode,
  canWrite,
  events,
  reminderOffset,
  saving,
  search,
  selectedCategories,
  selectedEvent,
  selectedEventId,
  setCalendarMode,
  setReminderOffset,
  setSearch,
  toggleCategory,
  onDelete,
  onEdit,
  onReminder,
  onSelect,
}: {
  calendarMode: CalendarMode;
  canWrite: boolean;
  events: AcademicEvent[];
  reminderOffset: string;
  saving: boolean;
  search: string;
  selectedCategories: Category[];
  selectedEvent: AcademicEvent | null;
  selectedEventId: number | null;
  setCalendarMode: (mode: CalendarMode) => void;
  setReminderOffset: (value: string) => void;
  setSearch: (value: string) => void;
  toggleCategory: (category: Category) => void;
  onDelete: (id: number) => void;
  onEdit: (event: AcademicEvent) => void;
  onReminder: () => void;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="surface min-w-0 p-4">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <SectionTitle
            eyebrow="Cronograma"
            icon={CalendarDays}
            title="Linha do tempo academica"
            subtitle={`${events.length} eventos dentro dos filtros atuais`}
          />
          <div className="flex gap-2">
            <SegmentedButton active={calendarMode === "list"} onClick={() => setCalendarMode("list")} icon={ListChecks} label="Agenda" />
            <SegmentedButton active={calendarMode === "calendar"} onClick={() => setCalendarMode("calendar")} icon={CalendarDays} label="Grade" />
          </div>
        </div>

        <Filters
          search={search}
          selectedCategories={selectedCategories}
          setSearch={setSearch}
          toggleCategory={toggleCategory}
        />

        {calendarMode === "list" ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {events.map((event, index) => (
              <EventRow
                key={event.id}
                event={event}
                selected={selectedEventId === event.id}
                separated={index < events.length - 1}
                onClick={() => onSelect(event.id)}
              />
            ))}
            {!events.length ? <EmptyState text="Nenhum evento encontrado." /> : null}
          </div>
        ) : (
          <CalendarGrid events={events} selectedEventId={selectedEventId} onSelect={onSelect} />
        )}
      </section>

      <EventDetail
        canWrite={canWrite}
        event={selectedEvent}
        reminderOffset={reminderOffset}
        saving={saving}
        setReminderOffset={setReminderOffset}
        onDelete={onDelete}
        onEdit={onEdit}
        onReminder={onReminder}
      />
    </div>
  );
}

function ManageView({
  canWrite,
  context,
  editingEventId,
  eventForm,
  saving,
  setEventForm,
  onCancel,
  onSave,
}: {
  canWrite: boolean;
  context: AcademicContext | null;
  editingEventId: number | null;
  eventForm: EventFormState;
  saving: boolean;
  setEventForm: (updater: (form: EventFormState) => EventFormState) => void;
  onCancel: () => void;
  onSave: (event: FormEvent) => void;
}) {
  if (!canWrite) {
    return (
      <section className="surface p-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-2xl font-semibold tracking-normal">Gestao docente</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
          Seu perfil pode visualizar eventos e configurar lembretes. A criacao e alteracao de datas
          fica com professores e administradores.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form className="surface p-4" onSubmit={onSave}>
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <SectionTitle
            eyebrow="Gestao docente"
            icon={Edit3}
            title={editingEventId ? "Editar evento" : "Novo evento"}
            subtitle="Eventos docentes aparecem imediatamente para alunos da turma"
          />
          {editingEventId ? (
            <button type="button" onClick={onCancel} className="btn-secondary w-fit">
              <Plus className="h-4 w-4" aria-hidden />
              Novo
            </button>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
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
              className="input min-h-32 resize-y py-3"
              value={eventForm.description}
              onChange={(event) =>
                setEventForm((form) => ({ ...form, description: event.target.value }))
              }
            />
          </Field>
        </div>

        <button className="btn-primary mt-5" disabled={saving} type="submit">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar evento
        </button>
      </form>

      <aside className="surface p-4">
        <SectionTitle
          eyebrow="Vinculos"
          icon={Users}
          title="Turmas ministradas"
          subtitle="Escopo permitido para criacao de eventos"
        />
        <div className="mt-4 grid gap-2">
          {(context?.teachingAssignments ?? []).map((assignment) => (
            <div key={assignment.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-950">{assignment.subject?.name}</p>
              <p className="mt-1 text-slate-600">{assignment.academicClass?.name}</p>
            </div>
          ))}
          {!context?.teachingAssignments.length ? <EmptyState text="Sem vinculos docentes." /> : null}
        </div>
      </aside>
    </section>
  );
}

function EventDetail({
  canWrite,
  event,
  reminderOffset,
  saving,
  setReminderOffset,
  onDelete,
  onEdit,
  onReminder,
}: {
  canWrite: boolean;
  event: AcademicEvent | null;
  reminderOffset: string;
  saving: boolean;
  setReminderOffset: (value: string) => void;
  onDelete: (id: number) => void;
  onEdit: (event: AcademicEvent) => void;
  onReminder: () => void;
}) {
  if (!event) {
    return (
      <aside className="surface grid min-h-80 place-items-center p-6 text-center">
        <div>
          <PanelRightOpen className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
          <p className="mt-3 text-sm font-medium text-slate-600">Selecione um evento para ver os detalhes.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="surface h-fit p-4 xl:sticky xl:top-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold ${categoryMeta[event.category].pill}`}>
            {categoryMeta[event.category].short}
          </span>
          <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-normal text-slate-950">
            {event.title}
          </h2>
          <p className="mt-2 text-sm text-slate-500">{event.source === "teacher" ? "Evento docente" : "Evento oficial"}</p>
        </div>
        <span className={`mt-1 h-3 w-3 rounded-full ${categoryMeta[event.category].accent}`} aria-hidden />
      </div>

      <dl className="mt-6 grid gap-3 text-sm">
        <InfoLine icon={CalendarDays} label="Data" value={formatDate(event.startsAt)} />
        <InfoLine icon={BookOpen} label="Disciplina" value={event.subject?.name ?? "Institucional"} />
        <InfoLine icon={Users} label="Turma" value={event.academicClass?.name ?? "Todos"} />
        <InfoLine icon={UserRound} label="Responsavel" value={event.teacher?.fullName ?? "Institucional"} />
        <InfoLine icon={ListChecks} label="Pontuacao" value={event.points === null ? "Nao informada" : `${event.points} pts`} />
      </dl>

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm leading-6 text-slate-700">
          {event.description ?? "Sem descricao complementar."}
        </p>
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <Field label="Lembrete">
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
        </Field>
        <button className="btn-secondary mt-3 w-full justify-center" disabled={saving} onClick={onReminder} type="button">
          <Bell className="h-4 w-4" aria-hidden />
          Salvar lembrete
        </button>
      </div>

      {canWrite ? (
        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
          <button className="btn-secondary justify-center" onClick={() => onEdit(event)} type="button">
            <Edit3 className="h-4 w-4" aria-hidden />
            Editar
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
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
    <section className="surface p-4">
      <SectionTitle
        eyebrow="Lembretes"
        icon={Mail}
        title="Central de alertas"
        subtitle="Notificacoes configuradas para prazos proximos"
      />
      <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {reminders.map((reminder, index) => (
          <div
            key={reminder.id}
            className={cx(
              "grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center",
              index < reminders.length - 1 ? "border-b border-slate-200" : ""
            )}
          >
            <div>
              <p className="font-semibold text-slate-950">
                {reminder.academicEvent?.title ?? `Evento #${reminder.academicEventId}`}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {formatDate(reminder.sendAt)} por {reminder.channel}
              </p>
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
  events,
  isAdmin,
  saving,
  onImport,
}: {
  events: AcademicEvent[];
  isAdmin: boolean;
  saving: boolean;
  onImport: () => void;
}) {
  const officialCount = events.filter((event) => event.source === "imported" || event.officialPriority).length;

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="surface p-5">
        <SectionTitle
          eyebrow="Sincronizacao"
          icon={RefreshCw}
          title="Calendario oficial da reitoria"
          subtitle="Datas institucionais entram como prioridade e aparecem para todos os usuarios"
        />
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <StatusTile label="Fonte" value="IFMS" />
            <StatusTile label="Prioridade" value="Oficial" />
            <StatusTile label="Eventos" value={String(officialCount)} />
          </div>
        </div>
        <button className="btn-primary mt-5" disabled={!isAdmin || saving} onClick={onImport} type="button">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Importar calendario
        </button>
      </div>

      <div className="surface p-4">
        <SectionTitle
          eyebrow="Permissao"
          icon={ShieldCheck}
          title={isAdmin ? "Acesso liberado" : "Restrito ao admin"}
          subtitle={isAdmin ? "Voce pode importar datas oficiais." : "Use uma conta admin para sincronizar."}
        />
        <div className="mt-5 rounded-lg bg-slate-950 p-4 text-white">
          <p className="text-sm text-slate-300">Eventos oficiais atuais</p>
          <p className="mt-3 text-5xl font-semibold tracking-normal">{officialCount}</p>
        </div>
      </div>
    </section>
  );
}

function Filters({
  search,
  selectedCategories,
  setSearch,
  toggleCategory,
}: {
  search: string;
  selectedCategories: Category[];
  setSearch: (value: string) => void;
  toggleCategory: (category: Category) => void;
}) {
  return (
    <div className="mt-4 grid gap-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          placeholder="Filtrar por titulo, disciplina, turma ou professor"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {allCategories.map((category) => {
          const active = selectedCategories.includes(category);
          return (
            <button
              key={category}
              className={cx(
                "h-8 rounded-md border px-3 text-sm font-semibold transition",
                active ? categoryMeta[category].pill : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
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
  compact,
  event,
  selected,
  separated,
  onClick,
}: {
  compact?: boolean;
  event: AcademicEvent;
  selected?: boolean;
  separated?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cx(
        "grid w-full gap-3 border-l-4 bg-white p-3 text-left transition sm:grid-cols-[auto_1fr_auto] sm:items-center",
        categoryMeta[event.category].rail,
        selected ? "bg-emerald-50/70" : "hover:bg-slate-50",
        separated ? "border-b border-b-slate-200" : ""
      )}
      onClick={onClick}
      type="button"
    >
      <span className={`h-10 w-10 rounded-md ${categoryMeta[event.category].tint} flex items-center justify-center`}>
        <CalendarClock className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-slate-950">{event.title}</span>
        <span className="mt-1 block truncate text-sm text-slate-600">
          {event.subject?.name ?? "Institucional"}
          {event.academicClass ? ` - ${event.academicClass.name}` : ""}
        </span>
      </span>
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:justify-end">
        <Clock className="h-4 w-4 text-slate-400" aria-hidden />
        {compact ? relativeDue(event.startsAt) : formatDate(event.startsAt)}
      </span>
    </button>
  );
}

function CalendarGrid({
  events,
  selectedEventId,
  onSelect,
}: {
  events: AcademicEvent[];
  selectedEventId: number | null;
  onSelect: (id: number) => void;
}) {
  const days = buildCalendarDays(events);

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {days.map((day) => (
        <div key={day.key} className="min-h-40 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">{day.label}</p>
              <p className="text-xs text-slate-500">{day.events.length} eventos</p>
            </div>
            <span className="text-xs font-semibold text-slate-400">{day.weekday}</span>
          </div>
          <div className="mt-3 grid gap-2">
            {day.events.slice(0, 4).map((event) => (
              <button
                key={event.id}
                className={cx(
                  "rounded-md border px-2 py-2 text-left text-sm transition",
                  selectedEventId === event.id
                    ? "border-emerald-300 bg-emerald-50"
                    : "border-slate-200 bg-slate-50 hover:border-slate-300"
                )}
                onClick={() => onSelect(event.id)}
                type="button"
              >
                <span className={`mr-2 inline-block h-2 w-2 rounded-full ${categoryMeta[event.category].accent}`} />
                {event.title}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WeekStrip({ events, onSelect }: { events: AcademicEvent[]; onSelect: (id: number) => void }) {
  if (!events.length) {
    return <EmptyState text="Sem eventos futuros." />;
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {events.map((event, index) => (
        <EventRow
          key={event.id}
          compact
          event={event}
          separated={index < events.length - 1}
          onClick={() => onSelect(event.id)}
        />
      ))}
    </div>
  );
}

function InsightTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <Icon className="h-5 w-5 text-slate-400" aria-hidden />
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-normal text-slate-950">{value}</p>
    </div>
  );
}

function CategoryBar({ category, count, total }: { category: Category; count: number; total: number }) {
  const width = Math.max((count / total) * 100, count ? 12 : 2);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{categoryMeta[category].label}</span>
        <span className="font-semibold text-slate-950">{count}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${categoryMeta[category].accent}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  icon: Icon,
  subtitle,
  title,
}: {
  eyebrow: string;
  icon: LucideIcon;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-normal text-emerald-700">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-normal text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function SegmentedButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cx(
        "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
        active
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

function Field({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-semibold text-slate-700 ${className ?? ""}`}>
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
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[24px_92px_1fr] items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden />
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-900">{value}</dd>
    </div>
  );
}

function Alert({
  onClose,
  text,
  tone,
}: {
  onClose?: () => void;
  text: string;
  tone: "success" | "danger";
}) {
  return (
    <div
      className={cx(
        "mb-4 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-700"
      )}
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
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
      {text}
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/10 p-3">
      <p className="text-xs text-emerald-100">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function viewEyebrow(view: View) {
  const labels: Record<View, string> = {
    dashboard: "Painel central",
    calendar: "Cronograma unificado",
    manage: "Operacao docente",
    reminders: "Alertas pessoais",
    sync: "Fonte institucional",
  };
  return labels[view];
}

function buildCalendarDays(events: AcademicEvent[]) {
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = startOfDay(addDays(new Date(), index));
    const key = date.toISOString().slice(0, 10);
    const dayEvents = events.filter((event) => event.startsAt.slice(0, 10) === key);
    return {
      key,
      events: dayEvents,
      label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      weekday: date.toLocaleDateString("pt-BR", { weekday: "short" }),
    };
  });

  const extraDays = events
    .filter((event) => !days.some((day) => day.key === event.startsAt.slice(0, 10)))
    .slice(0, 6)
    .map((event) => {
      const date = new Date(event.startsAt);
      return {
        key: event.startsAt.slice(0, 10),
        events: events.filter((item) => item.startsAt.slice(0, 10) === event.startsAt.slice(0, 10)),
        label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
        weekday: date.toLocaleDateString("pt-BR", { weekday: "short" }),
      };
    });

  return [...days, ...extraDays].filter(
    (day, index, source) => source.findIndex((item) => item.key === day.key) === index
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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeDue(value: string) {
  const diff = startOfDay(new Date(value)).getTime() - startOfDay(new Date()).getTime();
  const days = Math.round(diff / (24 * 60 * 60 * 1000));

  if (days < 0) {
    return `${Math.abs(days)}d atrasado`;
  }
  if (days === 0) {
    return "hoje";
  }
  if (days === 1) {
    return "amanha";
  }
  return `em ${days} dias`;
}

function toDateTimeLocal(value: Date) {
  const offset = value.getTimezoneOffset();
  const local = new Date(value.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Algo saiu fora do esperado.";
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
