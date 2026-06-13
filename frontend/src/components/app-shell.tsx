"use client";

import {
  Bell,
  CalendarDays,
  Edit3,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/lib/format";
import { roleLabels } from "@/lib/meta";
import type { User, UserRole } from "@/lib/types";
import { iconButton, secondaryButton } from "./ui";

export type View = "dashboard" | "calendar" | "manage" | "reminders" | "sync";

const navItems: Array<{ view: View; label: string; icon: LucideIcon; roles: UserRole[] }> = [
  { view: "dashboard", label: "Painel", icon: LayoutDashboard, roles: ["student", "teacher", "admin"] },
  { view: "calendar", label: "Cronograma", icon: CalendarDays, roles: ["student", "teacher", "admin"] },
  { view: "manage", label: "Gestão", icon: Edit3, roles: ["teacher", "admin"] },
  { view: "reminders", label: "Lembretes", icon: Bell, roles: ["student", "teacher", "admin"] },
  { view: "sync", label: "Sincronização", icon: RefreshCw, roles: ["admin"] },
];

export function visibleNavItems(role: UserRole) {
  return navItems.filter((item) => item.roles.includes(role));
}

function NavButtons({
  activeView,
  role,
  onNavigate,
}: {
  activeView: View;
  role: UserRole;
  onNavigate: (view: View) => void;
}) {
  return (
    <nav className="grid gap-1">
      {visibleNavItems(role).map((item) => (
        <button
          key={item.view}
          className={cx(
            "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition",
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
  );
}

function UserCard({
  canWrite,
  user,
  onOpenProfile,
}: {
  canWrite: boolean;
  user: User;
  onOpenProfile: () => void;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-emerald-800 shadow-sm">
          {user.initials ?? (user.fullName ?? user.email).slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-950">{user.fullName ?? user.email}</p>
          <p className="truncate text-xs text-slate-500">{roleLabels[user.role]}</p>
        </div>
        <button
          className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-white hover:text-slate-700"
          onClick={onOpenProfile}
          title="Configurações do perfil"
          type="button"
        >
          <Settings className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-lg bg-white px-2 py-1 font-medium text-slate-600">
          {canWrite ? "Pode editar" : "Somente leitura"}
        </span>
        {user.registration ? (
          <span className="rounded-lg bg-white px-2 py-1 font-medium text-slate-600">
            {user.registration}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
        <GraduationCap className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-950">Agenda Acadêmica</p>
        <p className="text-xs text-slate-500">IFMS · Três Lagoas</p>
      </div>
    </div>
  );
}

export function AppShell({
  activeView,
  canWrite,
  children,
  refreshing,
  user,
  onLogout,
  onNavigate,
  onOpenProfile,
  onRefresh,
}: {
  activeView: View;
  canWrite: boolean;
  children: ReactNode;
  refreshing: boolean;
  user: User;
  onLogout: () => void;
  onNavigate: (view: View) => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function navigate(view: View) {
    onNavigate(view);
    setDrawerOpen(false);
  }

  return (
    <main className="min-h-screen bg-app text-slate-950">
      {/* Top bar (mobile) */}
      <header className="surface sticky top-0 z-40 mx-3 mt-3 flex items-center justify-between gap-3 px-3 py-2.5 md:hidden">
        <Brand />
        <div className="flex items-center gap-2">
          <button
            className={iconButton}
            onClick={onRefresh}
            disabled={refreshing}
            title="Atualizar dados"
            type="button"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
          </button>
          <button
            className={iconButton}
            onClick={() => setDrawerOpen(true)}
            title="Abrir menu"
            type="button"
          >
            <Menu className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {/* Drawer (mobile) */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm animate-fade-in md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDrawerOpen(false);
            }
          }}
        >
          <aside className="flex h-full w-[290px] max-w-[85vw] flex-col gap-4 overflow-y-auto bg-white p-4 shadow-2xl animate-drawer-in">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setDrawerOpen(false)}
                title="Fechar menu"
                type="button"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <NavButtons activeView={activeView} role={user.role} onNavigate={navigate} />
            <div className="mt-auto grid gap-3">
              <UserCard
                canWrite={canWrite}
                user={user}
                onOpenProfile={() => {
                  onOpenProfile();
                  setDrawerOpen(false);
                }}
              />
              <button className={cx(secondaryButton, "w-full")} onClick={onLogout} type="button">
                <LogOut className="h-4 w-4" aria-hidden />
                Sair da conta
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-[1500px] gap-4 px-3 py-3 sm:px-5 md:grid-cols-[260px_minmax(0,1fr)] md:px-6">
        {/* Sidebar fixa (tablet/desktop) */}
        <aside className="surface sticky top-3 z-30 hidden h-fit max-h-[calc(100vh-1.5rem)] flex-col gap-4 overflow-y-auto overflow-x-hidden p-3 md:flex">
          <div className="border-b border-slate-200/80 px-2 pb-4 pt-1">
            <Brand />
          </div>
          <NavButtons activeView={activeView} role={user.role} onNavigate={navigate} />
          <div className="mt-2 grid gap-3">
            <UserCard canWrite={canWrite} user={user} onOpenProfile={onOpenProfile} />
            <div className="flex gap-2">
              <button
                className={cx(secondaryButton, "flex-1")}
                onClick={onRefresh}
                disabled={refreshing}
                type="button"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
                Atualizar
              </button>
              <button className={iconButton} onClick={onLogout} title="Sair da conta" type="button">
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </aside>

        <section className="min-w-0">{children}</section>
      </div>
    </main>
  );
}
