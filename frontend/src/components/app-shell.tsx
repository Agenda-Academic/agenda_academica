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
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx, formatTime, startOfDay } from "@/lib/format";
import { roleLabels } from "@/lib/meta";
import { personClasses, semesterWeek, type SemesterWeek } from "@/lib/semester";
import type { AcademicContext, User, UserRole } from "@/lib/types";
import { isOnTopLayer, primaryButton, useDialogLayer } from "./ui";

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

// no cartão do menu, o papel curto do Figma ("Admin, ADM-001"), para caber com a matrícula
const cardRoleLabels: Record<UserRole, string> = { ...roleLabels, admin: "Admin" };

// partículas do nome: não ficam sozinhas no fim da linha ("Diogo Queiroz da" vira "Diogo Queiroz")
const nameParticles = new Set(["da", "das", "de", "do", "dos", "e"]);
// espaço que não quebra a linha
const nbsp = String.fromCharCode(0xa0);

/**
 * Nome do cartão do menu. Ele ocupa uma linha só, e o que não cabe sai por palavras inteiras, como
 * no Figma ("Diogo Queiroz", "Coordenação"). A partícula e a abreviação ("Profa.") ficam presas à
 * palavra seguinte por um espaço que não quebra.
 */
function cardName(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .reduce((text, word, index, words) => {
      if (!index) {
        return word;
      }
      const previous = words[index - 1];
      const glued = nameParticles.has(previous.toLocaleLowerCase("pt-BR")) || previous.endsWith(".");
      return `${text}${glued ? nbsp : " "}${word}`;
    }, "");
}

export function visibleNavItems(role: UserRole) {
  return navItems.filter((item) => item.roles.includes(role));
}

type Shortcut = { mac: boolean; chip: string; aria: string };

const subscribeNothing = () => () => {};

// Mac (e iPad com teclado): Cmd+K; nos outros, Ctrl+K
const isMacLike = () => /Macintosh|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Atalho da busca do menu: o texto do chip e o do leitor de tela. */
function useSearchShortcut(): Shortcut {
  const mac = useSyncExternalStore(subscribeNothing, isMacLike, () => false);
  return mac ? { mac, chip: "⌘ K", aria: "Meta+K" } : { mac, chip: "Ctrl K", aria: "Control+K" };
}

/** Ctrl+K (Cmd+K no Mac), sem outra tecla junto. */
function isSearchShortcut(event: KeyboardEvent, mac: boolean) {
  return (
    (event.key ?? "").toLowerCase() === "k" &&
    !event.altKey &&
    !event.shiftKey &&
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
  );
}

/** Hoje (à meia-noite). Com a página aberta, vira sozinho na meia-noite seguinte. */
function useToday() {
  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timer = window.setTimeout(() => setToday(startOfDay(new Date())), next.getTime() - now.getTime() + 1000);
    return () => window.clearTimeout(timer);
  }, [today]);
  return today;
}

/**
 * A barra do semestre só fica no menu fixo quando ele cabe inteiro na altura da janela com ela. Em
 * tela baixa (o CSS já apertou os espaços) ela sai antes de o menu rolar por dentro e cortar "Sair
 * da conta". A conta vale para os três perfis e para a busca com resultado, que deixa o menu mais alto.
 */
function useSemesterFits(sideRef: RefObject<HTMLElement | null>, active: boolean) {
  const [fits, setFits] = useState(true);
  // altura da barra mais o vão até o cartão, medida com ela à vista (ela começa à vista)
  const barSpace = useRef(0);
  useEffect(() => {
    const side = sideRef.current;
    if (!active || !side) {
      return;
    }
    const check = () => {
      // menu fora da tela (janela estreita): nada a medir
      if (!side.clientHeight) {
        return;
      }
      // os blocos do menu não encolhem: a soma deles é a altura de que o menu precisa
      const style = getComputedStyle(side);
      const blocks = Array.from(side.children);
      let needed =
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        (parseFloat(style.rowGap) || 0) * Math.max(0, blocks.length - 1);
      for (const block of blocks) {
        needed += block.getBoundingClientRect().height;
      }
      const bar = side.querySelector<HTMLElement>(".semestre");
      if (bar?.parentElement) {
        barSpace.current =
          bar.getBoundingClientRect().height + (parseFloat(getComputedStyle(bar.parentElement).rowGap) || 0);
        needed -= barSpace.current;
      }
      if (barSpace.current) {
        setFits(needed + barSpace.current <= side.clientHeight + 0.5);
      }
    };
    const observer = new ResizeObserver(check);
    observer.observe(side);
    for (const block of Array.from(side.children)) {
      observer.observe(block);
    }
    return () => observer.disconnect();
  }, [active, sideRef]);
  return fits;
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

function Brand({
  action,
  inDrawer,
  onDark,
  subtitle = "IFMS, Campus Três Lagoas",
}: {
  /** Botão no fim da faixa da marca (o X da gaveta), dentro da linha de baixo dela. */
  action?: ReactNode;
  /** Gaveta do celular: marca de 40 e nome de 16 px, como no Figma, para o nome caber ao lado do X. */
  inDrawer?: boolean;
  onDark?: boolean;
  subtitle?: string;
}) {
  return (
    <div className={cx("flex items-center gap-3", onDark && "brand", inDrawer && "in-drawer")}>
      <span className="mark">
        <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <div className={cx("min-w-0", action ? "flex-1" : null)}>
        <p className={cx("brand-name truncate", !onDark && "text-ink")}>Agenda Acadêmica</p>
        <p className={cx("brand-sub truncate", !onDark && "text-muted")}>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

/** Busca geral e atalho de criação, logo abaixo da marca no menu. */
function SideTools({
  inPlace,
  inputRef,
  newEventLabel,
  resultCount,
  search,
  shortcut,
  onNewEvent,
  onSearchChange,
  onSubmit,
}: {
  /** O resultado já está na tela ao lado (Cronograma no computador): só a contagem, sem botão. */
  inPlace: boolean;
  /** Campo da busca: o Ctrl+K leva o foco até ele. */
  inputRef: RefObject<HTMLInputElement | null>;
  newEventLabel: string | null;
  resultCount?: number;
  search: string;
  /** "Ctrl K" no chip do campo e "Control+K" para o leitor de tela (Cmd no Mac). */
  shortcut: Shortcut;
  onNewEvent: () => void;
  onSearchChange: (value: string) => void;
  onSubmit: () => void;
}) {
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
          // vazio, o texto não passa por baixo do chip do atalho (que some no toque)
          className={search ? "pr-10 pointer-coarse:pr-12" : "pr-[66px] pointer-coarse:pr-3.5"}
          placeholder="Buscar evento"
          aria-label="Buscar evento, disciplina ou docente"
          aria-keyshortcuts={shortcut.aria}
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
        ) : (
          <span className="kbd" aria-hidden>
            {shortcut.chip}
          </span>
        )}
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

/** "Semestre 2026/2" e "semana 13 de 20", com a barra do quanto já foi (Figma, pé do menu). */
function SemesterBar({ semester }: { semester: SemesterWeek }) {
  return (
    // role="img": o leitor de tela lê o texto inteiro uma vez, pelo aria-label
    <div className="semestre" role="img" aria-label={semester.label}>
      <div className="row1">
        <span>Semestre {semester.term}</span>
        <b>
          semana {semester.week} de {semester.weeks}
        </b>
      </div>
      <div className="bar">
        <span style={{ width: `${semester.percent}%` }} />
      </div>
    </div>
  );
}

function SideFoot({
  loadError,
  refreshing,
  semester,
  updatedAt,
  user,
  onLogout,
  onOpenProfile,
  onRefresh,
}: {
  loadError?: string | null;
  refreshing: boolean;
  /** Barra do semestre, só no menu fixo (no celular ela não entra, como no Figma). */
  semester?: SemesterWeek | null;
  updatedAt?: Date | null;
  user: User;
  onLogout: () => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
}) {
  const name = user.fullName ?? user.email;
  // "Aluno, ALU-001", "Docente, DOC-001", "Admin, ADM-001"
  const role = [cardRoleLabels[user.role], user.registration].filter(Boolean).join(", ");
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
      {semester ? <SemesterBar semester={semester} /> : null}
      {/* o cartão inteiro abre as configurações do perfil */}
      <button
        className="ucard group"
        onClick={onOpenProfile}
        aria-label={`${name}, configurações do perfil`}
        title="Configurações do perfil"
        type="button"
      >
        <span className="avatar">{user.initials ?? name.slice(0, 2).toUpperCase()}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          {/* numa linha só: o que não cabe sai por palavras inteiras, e o nome inteiro aparece ao passar o mouse */}
          <span className="uname" title={name}>
            {cardName(name)}
          </span>
          <span className="urole" title={role}>
            {role}
          </span>
        </span>
        <span
          className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-on-night-2 transition group-hover:text-white"
          aria-hidden
        >
          <Settings2 className="h-[18px] w-[18px]" />
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
  context,
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
  /** Turmas da pessoa: o ano e o semestre da barra do semestre vêm delas (sem elas, vale o calendário de lib/semester). */
  context?: AcademicContext | null;
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
  /** Abrir ou fechar o menu do celular. Navegar, abrir as configurações do perfil ou o painel pelo menu já fecha. */
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
  const sideRef = useRef<HTMLElement>(null);
  const sideSearchRef = useRef<HTMLInputElement>(null);
  const drawerSearchRef = useRef<HTMLInputElement>(null);
  // a gaveta abre com o foco em "Fechar menu"; aberta pelo Ctrl+K, já na busca
  const [drawerStart, setDrawerStart] = useState<"close" | "search">("close");
  const shortcut = useSearchShortcut();
  const today = useToday();
  const semester = semesterWeek(today, personClasses(context));
  const semesterFits = useSemesterFits(sideRef, Boolean(semester));
  const newEventLabel = canWrite ? (user.role === "admin" ? "Evento oficial" : "Novo evento") : null;
  const pageTitle = visibleNavItems(user.role).find((item) => item.view === activeView)?.label ?? "Agenda Acadêmica";

  // gaveta do celular: foco em "Fechar menu", Tab preso dentro e, ao fechar, volta para "Abrir menu".
  // Aberta pelo Ctrl+K: começa na busca e, ao fechar, o foco volta para onde estava.
  useDialogLayer({
    open: drawerOpen,
    rootRef: sheetRef,
    panelRef: sheetPanelRef,
    onClose: () => onMenuChange(false),
    initialFocusRef: drawerStart === "search" ? drawerSearchRef : closeMenuRef,
    returnFocusRef: drawerStart === "search" ? undefined : menuButtonRef,
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

  // os ouvintes da janela usam sempre o estado e a função mais novos do pai
  const latest = useRef({ drawerOpen, onMenuChange });
  useEffect(() => {
    latest.current = { drawerOpen, onMenuChange };
  });

  // a gaveta é só do celular: se a janela alargar, ela fecha
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (wide.matches) {
        latest.current.onMenuChange(false);
      }
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [drawerOpen]);

  // Ctrl+K (Cmd+K no Mac) leva à busca do menu. Com um diálogo por cima, o menu fica inerte e o
  // atalho fica com o navegador.
  useEffect(() => {
    function focusSearch(event: KeyboardEvent, input: HTMLInputElement | null) {
      if (input && isOnTopLayer(input)) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || !isSearchShortcut(event, shortcut.mac)) {
        return;
      }
      if (window.matchMedia("(min-width: 768px)").matches) {
        focusSearch(event, sideSearchRef.current);
      } else if (latest.current.drawerOpen) {
        focusSearch(event, drawerSearchRef.current);
      } else if (isOnTopLayer(menuButtonRef.current)) {
        // janela estreita: abre o menu já com o foco na busca
        event.preventDefault();
        setDrawerStart("search");
        latest.current.onMenuChange(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut.mac]);

  function closeDrawer() {
    onMenuChange(false);
  }

  // navegar, abrir as configurações do perfil ou o painel pelo menu: a página fecha o menu junto
  // (a tela nova ocupa a entrada dele)
  function foot(inDrawer: boolean) {
    return (
      <SideFoot
        loadError={loadError}
        refreshing={refreshing}
        semester={inDrawer || !semesterFits ? null : semester}
        updatedAt={updatedAt}
        user={user}
        onLogout={onLogout}
        onOpenProfile={onOpenProfile}
        onRefresh={onRefresh}
      />
    );
  }

  function tools(inDrawer: boolean) {
    return (
      <SideTools
        // na gaveta o resultado fica escondido atrás do menu: o botão aparece também no Cronograma
        inPlace={searchInPlace && !inDrawer}
        inputRef={inDrawer ? drawerSearchRef : sideSearchRef}
        newEventLabel={newEventLabel}
        resultCount={searchResultCount}
        search={search}
        shortcut={shortcut}
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
            onClick={() => {
              setDrawerStart("close");
              onMenuChange(true);
            }}
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
                {/* o X fica dentro da faixa da marca: a linha de baixo atravessa a gaveta (Figma 18) */}
                <Brand
                  inDrawer
                  onDark
                  action={
                    // alvo de 44 px; as margens negativas deixam o lugar do X de 40 px do Figma
                    <button
                      ref={closeMenuRef}
                      className="ubtn -mr-1 -ml-1 h-11 w-11"
                      onClick={closeDrawer}
                      aria-label="Fechar menu"
                      title="Fechar menu"
                      type="button"
                    >
                      <X className="h-5 w-5" aria-hidden />
                    </button>
                  }
                />
                {tools(true)}
                <NavButtons activeView={activeView} badges={badges} role={user.role} onNavigate={onNavigate} />
                {foot(true)}
              </aside>
            </div>,
            document.body
          )
        : null}

      <div className="app max-md:block max-md:px-3 max-md:pt-2">
        {/* Menu lateral fixo, da altura da tela (tablet/desktop) */}
        <aside ref={sideRef} className="side max-md:hidden" aria-label="Menu">
          <Brand onDark />
          {tools(false)}
          <NavButtons activeView={activeView} badges={badges} role={user.role} onNavigate={onNavigate} />
          {foot(false)}
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
