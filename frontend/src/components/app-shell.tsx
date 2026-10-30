"use client";

import {
  Bell,
  CalendarDays,
  CalendarPlus,
  Edit3,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cx, formatTime } from "@/lib/format";
import { roleLabels } from "@/lib/meta";
import type { User, UserRole } from "@/lib/types";
import { primaryButton } from "./ui";

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
  badges,
  role,
  onNavigate,
}: {
  activeView: View;
  badges?: Partial<Record<View, number>>;
  role: UserRole;
  onNavigate: (view: View) => void;
}) {
  return (
    <nav aria-label="Navegação principal">
      <p className="nav-label">Menu</p>
      <div className="navlist">
        {visibleNavItems(role).map((item) => {
          const count = badges?.[item.view];
          return (
            <button
              key={item.view}
              className={cx("nav", activeView === item.view && "on")}
              aria-current={activeView === item.view ? "page" : undefined}
              onClick={() => onNavigate(item.view)}
              type="button"
            >
              <item.icon className="h-[18px] w-[18px]" aria-hidden />
              {item.label}
              {count ? <span className="count">{count}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Brand({ onDark }: { onDark?: boolean }) {
  return (
    <div className={cx("flex items-center gap-3", onDark && "brand")}>
      <span className="mark">
        <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className={cx("brand-name truncate", !onDark && "text-ink")}>Agenda Acadêmica</p>
        <p className={cx("brand-sub", !onDark && "text-muted")}>IFMS, Campus Três Lagoas</p>
      </div>
    </div>
  );
}

/** Busca geral e atalho de criação, logo abaixo da marca no menu. */
function SideTools({
  newEventLabel,
  search,
  onNewEvent,
  onSearchChange,
  onSubmit,
}: {
  newEventLabel: string | null;
  search: string;
  onNewEvent: () => void;
  onSearchChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <div className="side-tools">
      <form
        className="side-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <Search aria-hidden />
        <input
          placeholder="Buscar evento"
          aria-label="Buscar evento, disciplina ou professor"
          enterKeyHint="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </form>
      {newEventLabel ? (
        <button className={cx(primaryButton, "w-full")} onClick={onNewEvent} type="button">
          <CalendarPlus className="h-4 w-4" aria-hidden />
          {newEventLabel}
        </button>
      ) : null}
    </div>
  );
}

function SideFoot({
  refreshing,
  updatedAt,
  user,
  onLogout,
  onOpenProfile,
  onRefresh,
}: {
  refreshing: boolean;
  updatedAt?: Date | null;
  user: User;
  onLogout: () => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
}) {
  const role = [roleLabels[user.role], user.registration].filter(Boolean).join(", ");
  return (
    <div className="side-foot">
      <div className="ucard">
        <span className="avatar">
          {user.initials ?? (user.fullName ?? user.email).slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="uname">{user.fullName ?? user.email}</p>
          <p className="urole">{role}</p>
        </div>
        <button className="ubtn" onClick={onOpenProfile} title="Configurações do perfil" type="button">
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>
      <button className="nav nav-sm" onClick={onLogout} type="button">
        <LogOut className="h-[18px] w-[18px]" aria-hidden />
        Sair da conta
      </button>
      <button
        className="sync w-full text-left hover:text-white"
        disabled={refreshing}
        onClick={onRefresh}
        title="Atualizar dados"
        type="button"
      >
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <span className="ok" aria-hidden />
        )}
        {refreshing
          ? "Atualizando..."
          : updatedAt
            ? `Atualizado às ${formatTime(updatedAt.toISOString())}`
            : "Atualizar dados"}
        {!refreshing ? <RefreshCw className="ml-auto h-3.5 w-3.5" aria-hidden /> : null}
      </button>
    </div>
  );
}

export function AppShell({
  activeView,
  badges,
  canWrite,
  children,
  refreshing,
  search,
  updatedAt,
  user,
  onLogout,
  onNavigate,
  onNewEvent,
  onOpenProfile,
  onRefresh,
  onSearchChange,
}: {
  activeView: View;
  badges?: Partial<Record<View, number>>;
  canWrite?: boolean;
  children: ReactNode;
  refreshing: boolean;
  search: string;
  updatedAt?: Date | null;
  user: User;
  onLogout: () => void;
  onNavigate: (view: View) => void;
  onNewEvent: () => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const newEventLabel = canWrite ? (user.role === "admin" ? "Evento oficial" : "Novo evento") : null;
  const pageTitle = visibleNavItems(user.role).find((item) => item.view === activeView)?.label ?? "Agenda Acadêmica";

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

  const foot = (
    <SideFoot
      refreshing={refreshing}
      updatedAt={updatedAt}
      user={user}
      onLogout={onLogout}
      onOpenProfile={() => {
        onOpenProfile();
        setDrawerOpen(false);
      }}
      onRefresh={onRefresh}
    />
  );

  function tools(inDrawer: boolean) {
    return (
      <SideTools
        newEventLabel={newEventLabel}
        search={search}
        onNewEvent={() => {
          onNewEvent();
          setDrawerOpen(false);
        }}
        onSearchChange={onSearchChange}
        // no celular, o "buscar" do teclado fecha o menu e mostra o resultado
        onSubmit={inDrawer ? () => setDrawerOpen(false) : undefined}
      />
    );
  }

  return (
    <main className="bg-app min-h-screen text-ink">
      {/* Barra do topo (celular) */}
      <header className="card sticky top-3 z-40 mx-3 mt-3 flex items-center justify-between gap-3 px-3 py-2.5 md:hidden">
        <Brand />
        <button className="ib sm" onClick={() => setDrawerOpen(true)} title="Abrir menu" type="button">
          <Menu className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </header>

      {/* Menu lateral (celular) */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 bg-[rgb(15_30_58/0.48)] animate-fade-in md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDrawerOpen(false);
            }
          }}
        >
          <aside className="side animate-drawer-in static h-full w-[300px] max-w-[85vw] rounded-l-none">
            <div className="flex items-start justify-between gap-2">
              <Brand onDark />
              <button className="ubtn ml-0" onClick={() => setDrawerOpen(false)} title="Fechar menu" type="button">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {tools(true)}
            <NavButtons activeView={activeView} badges={badges} role={user.role} onNavigate={navigate} />
            {foot}
          </aside>
        </div>
      ) : null}

      <div className="app max-md:block max-md:px-3 max-md:pt-4">
        {/* Menu lateral fixo, da altura da tela (tablet/desktop) */}
        <aside className="side max-md:hidden">
          <Brand onDark />
          {tools(false)}
          <NavButtons activeView={activeView} badges={badges} role={user.role} onNavigate={navigate} />
          {foot}
        </aside>

        <section className="content">
          {/* sem cabeçalho visível: o título da tela fica para leitores de tela */}
          <h1 className="sr-only">{pageTitle}</h1>
          {children}
        </section>
      </div>
    </main>
  );
}
