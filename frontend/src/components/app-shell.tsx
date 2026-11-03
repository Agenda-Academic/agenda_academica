"use client";

import {
  ArrowRight,
  Bell,
  CalendarArrowDown,
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
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx, formatTime } from "@/lib/format";
import { roleLabels } from "@/lib/meta";
import type { User, UserRole } from "@/lib/types";
import { primaryButton, useDialogLayer } from "./ui";

export type View = "dashboard" | "calendar" | "manage" | "reminders" | "sync";

const navItems: Array<{ view: View; label: string; icon: LucideIcon; roles: UserRole[] }> = [
  { view: "dashboard", label: "Painel", icon: LayoutDashboard, roles: ["student", "teacher", "admin"] },
  { view: "calendar", label: "Cronograma", icon: CalendarDays, roles: ["student", "teacher", "admin"] },
  { view: "manage", label: "Gestão", icon: Edit3, roles: ["teacher", "admin"] },
  { view: "reminders", label: "Lembretes", icon: Bell, roles: ["student", "teacher", "admin"] },
  { view: "sync", label: "Importar calendário", icon: CalendarArrowDown, roles: ["admin"] },
];

// texto oculto que acompanha o número do item (lido como "Lembretes, 2 avisos novos")
const badgeText: Partial<Record<View, (count: number) => string>> = {
  reminders: (count) => (count === 1 ? "aviso novo" : "avisos novos"),
};

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
          const extra = count ? badgeText[item.view]?.(count) : undefined;
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
              {count ? (
                <span className="count">
                  <span className="sr-only">, </span>
                  {count}
                  {extra ? <span className="sr-only"> {extra}</span> : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Brand({ onDark, subtitle = "IFMS, Campus Três Lagoas" }: { onDark?: boolean; subtitle?: string }) {
  return (
    <div className={cx("flex items-center gap-3", onDark && "brand")}>
      <span className="mark">
        <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className={cx("brand-name truncate", !onDark && "text-ink")}>Agenda Acadêmica</p>
        <p className={cx("brand-sub truncate", !onDark && "text-muted")}>{subtitle}</p>
      </div>
    </div>
  );
}

/** Busca geral e atalho de criação, logo abaixo da marca no menu. */
function SideTools({
  inPlace,
  newEventLabel,
  resultCount,
  search,
  onNewEvent,
  onSearchChange,
  onSubmit,
}: {
  /** O resultado já está na tela ao lado (Cronograma no computador): só a contagem, sem botão. */
  inPlace: boolean;
  newEventLabel: string | null;
  resultCount?: number;
  search: string;
  onNewEvent: () => void;
  onSearchChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const term = search.trim();
  const count = term ? resultCount : undefined;
  const status =
    count === undefined
      ? ""
      : count === 0
        ? "Nenhum evento encontrado."
        : `${count} ${count === 1 ? "evento encontrado" : "eventos encontrados"}.`;
  // botão que leva ao resultado: funciona no toque, onde o teclado não tem Enter (o Enter continua valendo)
  const showButton = count !== undefined && count > 0 && !inPlace;

  return (
    <div className="side-tools">
      <form
        className="side-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Search aria-hidden />
        <input
          ref={inputRef}
          className={search ? "pr-10 pointer-coarse:pr-12" : undefined}
          placeholder="Buscar evento"
          aria-label="Buscar evento, disciplina ou docente"
          enterKeyHint="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            // Esc limpa a busca antes de fechar o menu
            if (event.key === "Escape" && search) {
              event.preventDefault();
              onSearchChange("");
            }
          }}
        />
        {search ? (
          // no toque, alvo de 44px
          <button
            className="absolute right-1.5 grid h-8 w-8 place-items-center rounded-lg text-on-night transition hover:bg-white/10 hover:text-white pointer-coarse:right-0 pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => {
              onSearchChange("");
              inputRef.current?.focus();
            }}
            aria-label="Limpar busca"
            title="Limpar busca"
            type="button"
          >
            <X className="static h-4 w-4 text-inherit" aria-hidden />
          </button>
        ) : null}
      </form>
      {/* a contagem é sempre anunciada; com o botão à vista, ela fica só para leitores de tela */}
      <p
        className={cx("-mt-1 px-1 text-[13px] leading-5 text-on-night", (!status || showButton) && "sr-only")}
        role="status"
      >
        {status}
      </p>
      {showButton ? (
        <button className="nav nav-sm -mt-1 justify-between border border-white/15 pointer-coarse:h-11" onClick={onSubmit} type="button">
          Ver {count} {count === 1 ? "evento" : "eventos"}
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      ) : null}
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
  loadError,
  refreshing,
  updatedAt,
  user,
  onLogout,
  onOpenProfile,
  onRefresh,
}: {
  loadError?: string | null;
  refreshing: boolean;
  updatedAt?: Date | null;
  user: User;
  onLogout: () => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
}) {
  const name = user.fullName ?? user.email;
  const time = updatedAt ? formatTime(updatedAt.toISOString()) : null;
  const offline = Boolean(loadError) && !refreshing;
  const refreshLabel = refreshing
    ? "Atualizando dados"
    : offline
      ? "Atualizar dados, sem conexão"
      : time
        ? `Atualizar dados, atualizado às ${time}`
        : "Atualizar dados";

  return (
    <div className="side-foot">
      {/* o cartão inteiro abre as preferências */}
      <button
        className="ucard group"
        onClick={onOpenProfile}
        aria-label={`${name}, preferências`}
        title="Preferências"
        type="button"
      >
        <span className="avatar">{user.initials ?? name.slice(0, 2).toUpperCase()}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="uname">{name}</span>
          <span className="urole">{roleLabels[user.role]}</span>
        </span>
        <span
          className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-on-night-2 transition group-hover:text-white"
          aria-hidden
        >
          <Settings className="h-[18px] w-[18px]" />
        </span>
      </button>
      <button className="nav nav-sm" onClick={onLogout} type="button">
        <LogOut className="h-[18px] w-[18px]" aria-hidden />
        Sair da conta
      </button>
      <button
        className="sync w-full text-left hover:text-white"
        aria-busy={refreshing || undefined}
        aria-disabled={refreshing || undefined}
        aria-label={refreshLabel}
        onClick={() => {
          if (!refreshing) {
            onRefresh();
          }
        }}
        title="Atualizar dados"
        type="button"
      >
        {refreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <span className={cx("ok", offline && "bg-[#d97706]")} aria-hidden />
        )}
        {refreshing ? "Atualizando..." : offline ? "Sem conexão" : time ? `Atualizado às ${time}` : "Atualizar dados"}
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
  focusHeadingToken,
  loadError,
  menuOpen: drawerOpen,
  refreshing,
  search,
  searchInPlace = false,
  searchResultCount,
  updatedAt,
  user,
  onLogout,
  onMenuChange,
  onNavigate,
  onNewEvent,
  onOpenProfile,
  onRefresh,
  onSearchChange,
  onSearchSubmit,
}: {
  activeView: View;
  /** Número no item do menu; em Lembretes, os avisos que chegaram. */
  badges?: Partial<Record<View, number>>;
  canWrite?: boolean;
  children: ReactNode;
  /** Muda quando a tela troca: o título da tela recebe o foco. */
  focusHeadingToken?: number;
  /** Falha no último carregamento: o rodapé do menu mostra "Sem conexão". */
  loadError?: string | null;
  /** Menu do celular (gaveta) aberto. Quem usa a casca cuida do histórico: o Voltar fecha só o menu. */
  menuOpen: boolean;
  refreshing: boolean;
  search: string;
  /** O resultado da busca já está na tela (Cronograma): no computador, sem botão de ver. */
  searchInPlace?: boolean;
  /** Quantos eventos a busca do menu encontra. */
  searchResultCount?: number;
  updatedAt?: Date | null;
  user: User;
  onLogout: () => void;
  /** Abrir ou fechar o menu do celular. Navegar, abrir as Preferências ou o painel pelo menu já fecha. */
  onMenuChange: (open: boolean) => void;
  onNavigate: (view: View) => void;
  onNewEvent: () => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  /** Enter ou "Ver eventos" na busca do menu. */
  onSearchSubmit?: () => void;
}) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenuRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetPanelRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const newEventLabel = canWrite ? (user.role === "admin" ? "Evento oficial" : "Novo evento") : null;
  const pageTitle = visibleNavItems(user.role).find((item) => item.view === activeView)?.label ?? "Agenda Acadêmica";

  // gaveta do celular: foco em "Fechar menu", Tab preso dentro e, ao fechar, volta para "Abrir menu"
  useDialogLayer({
    open: drawerOpen,
    rootRef: sheetRef,
    panelRef: sheetPanelRef,
    onClose: () => onMenuChange(false),
    initialFocusRef: closeMenuRef,
    returnFocusRef: menuButtonRef,
  });

  useEffect(() => {
    const wanted = `${pageTitle} | Agenda Acadêmica`;
    document.title = wanted;
    // o <title> do metadata pode chegar depois e reescrever: volta para o nome da tela
    const observer = new MutationObserver(() => {
      if (document.title !== wanted) {
        document.title = wanted;
      }
    });
    observer.observe(document.head, { characterData: true, childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pageTitle]);

  useEffect(() => {
    return () => {
      document.title = "Agenda Acadêmica";
    };
  }, []);

  useEffect(() => {
    if (focusHeadingToken) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [focusHeadingToken]);

  // a gaveta é só do celular: se a janela alargar, ela fecha
  const closeOnWide = useRef(onMenuChange);
  useEffect(() => {
    closeOnWide.current = onMenuChange;
  });
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (wide.matches) {
        closeOnWide.current(false);
      }
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [drawerOpen]);

  function closeDrawer() {
    onMenuChange(false);
  }

  // navegar, abrir as Preferências ou o painel pelo menu: a página fecha o menu junto (a tela nova ocupa a entrada dele)
  const foot = (
    <SideFoot
      loadError={loadError}
      refreshing={refreshing}
      updatedAt={updatedAt}
      user={user}
      onLogout={onLogout}
      onOpenProfile={onOpenProfile}
      onRefresh={onRefresh}
    />
  );

  function tools(inDrawer: boolean) {
    return (
      <SideTools
        // na gaveta o resultado fica escondido atrás do menu: o botão aparece também no Cronograma
        inPlace={searchInPlace && !inDrawer}
        newEventLabel={newEventLabel}
        resultCount={searchResultCount}
        search={search}
        onNewEvent={onNewEvent}
        onSearchChange={onSearchChange}
        onSubmit={() => onSearchSubmit?.()}
      />
    );
  }

  return (
    <div className="bg-app min-h-screen text-ink">
      <a
        className="skip-link"
        href="#conteudo"
        onClick={(event) => {
          // sem mudar o endereço: só leva o foco ao conteúdo
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Pular para o conteúdo
      </a>

      {/* Barra do topo (celular): presa no topo, com uma faixa da cor do fundo atrás */}
      <header className="sticky top-0 z-40 bg-app px-3 pt-3 pb-2 md:hidden">
        <div className="card flex items-center justify-between gap-3 px-3 py-2.5">
          <Brand subtitle={pageTitle} />
          <button
            ref={menuButtonRef}
            className="ib h-11 w-11"
            onClick={() => onMenuChange(true)}
            aria-controls="menu-gaveta"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            aria-label="Abrir menu"
            title="Abrir menu"
            type="button"
          >
            <Menu className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </header>

      {/* Menu lateral (celular), por cima de tudo */}
      {drawerOpen
        ? createPortal(
            <div
              ref={sheetRef}
              className="fixed inset-0 z-50 bg-[rgb(15_30_58/0.48)] animate-fade-in md:hidden"
              role="dialog"
              aria-label="Menu de navegação"
              aria-modal="true"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  // sem isso o clique fora leva o foco para o body depois de fechar
                  event.preventDefault();
                  closeDrawer();
                }
              }}
            >
              <aside
                ref={sheetPanelRef}
                id="menu-gaveta"
                className="side animate-drawer-in static h-full w-[300px] max-w-[85vw] overscroll-contain rounded-l-none !outline-none"
                tabIndex={-1}
              >
                <div className="flex items-start justify-between gap-2">
                  <Brand onDark />
                  <button
                    ref={closeMenuRef}
                    className="ubtn ml-0 h-11 w-11"
                    onClick={closeDrawer}
                    aria-label="Fechar menu"
                    title="Fechar menu"
                    type="button"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                {tools(true)}
                <NavButtons activeView={activeView} badges={badges} role={user.role} onNavigate={onNavigate} />
                {foot}
              </aside>
            </div>,
            document.body
          )
        : null}

      <div className="app max-md:block max-md:px-3 max-md:pt-2">
        {/* Menu lateral fixo, da altura da tela (tablet/desktop) */}
        <aside className="side max-md:hidden" aria-label="Menu">
          <Brand onDark />
          {tools(false)}
          <NavButtons activeView={activeView} badges={badges} role={user.role} onNavigate={onNavigate} />
          {foot}
        </aside>

        <main id="conteudo" ref={mainRef} className="content" tabIndex={-1}>
          {/* sem cabeçalho visível: o título da tela fica para leitores de tela */}
          <h1 ref={headingRef} className="sr-only" tabIndex={-1}>
            {pageTitle}
          </h1>
          {children}
        </main>
      </div>
    </div>
  );
}
