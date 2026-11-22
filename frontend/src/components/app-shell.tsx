"use client";

import {
  ArrowRight,
  BellRing,
  CalendarArrowDown,
  CalendarCheck2,
  CalendarDays,
  ChevronsUpDown,
  GraduationCap,
  LayoutGrid,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  RefreshCw,
  School,
  Search,
  SquarePen,
  UserRoundCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx, firstName, formatTime } from "@/lib/format";
import { roleLabels } from "@/lib/meta";
import type { AcademicContext, LinkedStudent, User, UserRole } from "@/lib/types";
import { isOnTopLayer, useDialogLayer } from "./ui";

/** Telas do app. O endereço de cada uma (?tela=) fica em app/page.tsx (viewSlugs). */
export type View = "dashboard" | "calendar" | "grades" | "manage" | "classes" | "reminders" | "sync";

/** Cor do quadrado pastel do ícone de cada tela no trilho (--nv-* no globals.css). */
type NavTone = "painel" | "crono" | "notas" | "gestao" | "turmas" | "lemb" | "import";

// menu por papel (desenho, tabela 5.2), na ordem da tabela; o responsável vê o Cronograma só para leitura. O rótulo
// curto (short) é o que cabe embaixo do ícone no trilho e na barra de baixo; o nome inteiro fica no leitor de tela
const navItems: Array<{
  view: View;
  label: string;
  short?: string;
  icon: LucideIcon;
  tone: NavTone;
  roles: UserRole[];
}> = [
  { view: "dashboard", label: "Painel", icon: LayoutGrid, tone: "painel", roles: ["student", "teacher", "admin", "guardian"] },
  { view: "calendar", label: "Cronograma", icon: CalendarDays, tone: "crono", roles: ["student", "teacher", "admin", "guardian"] },
  { view: "grades", label: "Notas", icon: GraduationCap, tone: "notas", roles: ["student", "teacher", "admin", "guardian"] },
  { view: "manage", label: "Gestão", icon: SquarePen, tone: "gestao", roles: ["teacher", "admin"] },
  { view: "classes", label: "Turmas e disciplinas", short: "Turmas", icon: School, tone: "turmas", roles: ["admin"] },
  { view: "reminders", label: "Lembretes", icon: BellRing, tone: "lemb", roles: ["student", "teacher", "admin", "guardian"] },
  { view: "sync", label: "Importar calendário", short: "Importar", icon: CalendarArrowDown, tone: "import", roles: ["admin"] },
];

/** Na barra de baixo do celular cabem 5 itens; com mais (administração), 4 e "Mais". */
const BOTTOM_MAX = 5;

// texto que acompanha o número do item (lido como "Lembretes, 2 avisos novos")
const badgeText: Partial<Record<View, (count: number) => string>> = {
  reminders: (count) => (count === 1 ? "aviso novo" : "avisos novos"),
};
// itens em que o número vira só um ponto: em Lembretes ele conta avisos (o card "Avisos" da tela), e um "1"
// ao lado de "Lembretes" parecia um lembrete. O ponto diz "tem novidade"; o texto ("1 aviso novo") fica
// no title e no leitor de tela
const badgeAsDot = new Set<View>(["reminders"]);

// no cartão da conta, o papel curto ("Admin, ADM-001"), para caber com a matrícula. Os outros vêm de roleLabels
// ("Estudante" é neutro: a aluna não aparece como "Aluno")
const cardRoleLabels: Record<UserRole, string> = { ...roleLabels, admin: "Admin" };

/** "Estudante, ALU-001", "Docente, DOC-001", "Admin, ADM-001"; o responsável não tem matrícula: só "Responsável". */
function roleLine(user: User) {
  return [cardRoleLabels[user.role], user.role === "guardian" ? null : user.registration].filter(Boolean).join(", ");
}

function initialsOf(user: User) {
  const name = user.fullName ?? user.email;
  return user.initials ?? name.slice(0, 2).toUpperCase();
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

type NavItem = (typeof navItems)[number];

/** "Lembretes, 1 aviso novo": o número do item para o leitor de tela e para a dica. */
function countWords(view: View, count?: number) {
  if (!count) {
    return "";
  }
  const extra = badgeText[view]?.(count);
  return extra ? `${count} ${extra}` : String(count);
}

/**
 * Item do trilho (e da barra de baixo do celular): ícone num quadrado pastel da cor da tela e o rótulo pequeno
 * embaixo. O ativo ganha o anel e a sombra da cor dele; o número vira uma bolinha no canto do ícone (em
 * Lembretes, só um ponto: o "1 aviso novo" fica na dica e no leitor de tela).
 */
function NavButton({
  active,
  count,
  item,
  onNavigate,
}: {
  active: boolean;
  count?: number;
  item: NavItem;
  onNavigate: (view: View) => void;
}) {
  const words = countWords(item.view, count);
  return (
    <button
      className={cx("rail-item", `nv-${item.tone}`, active && "on")}
      data-view={item.view}
      aria-current={active ? "page" : undefined}
      aria-label={words ? `${item.label}, ${words}` : item.label}
      // a dica sempre traz o nome: no trilho da administração em janela bem baixa, só os ícones ficam à vista
      title={words ? `${item.label}, ${words}` : item.label}
      onClick={() => onNavigate(item.view)}
      type="button"
    >
      <span className="rail-ic" aria-hidden>
        <item.icon />
        {count && badgeAsDot.has(item.view) ? (
          <i className="rail-dot" />
        ) : count ? (
          <i className="rail-count">{count > 99 ? "99+" : count}</i>
        ) : null}
      </span>
      <span className="rail-lbl" aria-hidden>
        {item.short ?? item.label}
      </span>
    </button>
  );
}

/** Logo do app: o calendário com o check num quadrado verde em gradiente. */
function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("logo-sq", className)} aria-hidden>
      <CalendarCheck2 />
    </span>
  );
}

/** A partir desta largura o trilho fica fixo ao lado; abaixo (celular e tablet), a barra do topo e a de baixo. */
const WIDE_MENU = "(min-width: 1024px)";

/** O que a busca do menu procura na tela de agora: o texto do campo, o rótulo e o nome do resultado. */
export type SearchScope = {
  /** "Buscar evento" */
  placeholder: string;
  /** "Buscar evento, disciplina ou docente" */
  label: string;
  /** ["evento", "eventos"] para "3 eventos encontrados" e "Ver 3 eventos". */
  noun: [string, string];
};

const eventSearch: SearchScope = {
  placeholder: "Buscar evento",
  label: "Buscar evento, disciplina ou docente",
  noun: ["evento", "eventos"],
};

/**
 * A busca geral (a mesma de antes, com o mesmo Ctrl K e os mesmos resultados): no computador, dentro da paleta que o
 * item "Buscar" do trilho abre; no celular, dentro da folha de busca. Nas duas, a contagem e o "Ver N eventos"
 * ficam logo embaixo do campo.
 */
function SearchBox({
  inputRef,
  resultCount,
  scope = eventSearch,
  search,
  shortcut,
  variant,
  onSearchChange,
  onSubmit,
}: {
  /** Campo da busca: o Ctrl+K leva o foco até ele. */
  inputRef: RefObject<HTMLInputElement | null>;
  resultCount?: number;
  /** O que a busca procura nesta tela (padrão: eventos). */
  scope?: SearchScope;
  search: string;
  /** "Ctrl K" no chip do campo e "Control+K" para o leitor de tela (Cmd no Mac). */
  shortcut: Shortcut;
  /** Folha do celular ou paleta do computador: o resultado fica embaixo do campo, sem caixinha flutuante. */
  variant: "sheet" | "palette";
  onSearchChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const palette = variant === "palette";
  const term = search.trim();
  const count = term ? resultCount : undefined;
  const [one, many] = scope.noun;
  // sem ponto final, como os outros subtítulos. A conta vem da tela inteira, sem filtro de categoria nem de origem
  // (decisão 14): quando um filtro esconde o que a busca achou, a própria tela diz "N escondidos pelo filtro", e
  // aqui continua "N eventos encontrados", nunca "Nenhum"
  const status =
    count === undefined
      ? ""
      : count === 0
        ? `Nenhum ${one} encontrado`
        : `${count} ${count === 1 ? `${one} encontrado` : `${many} encontrados`}`;
  // botão que leva ao resultado (e fecha a folha ou a paleta, que cobrem a tela): funciona no toque, onde o teclado
  // não tem Enter (o Enter continua valendo)
  const showButton = count !== undefined && count > 0;
  // a caixinha só aparece com algo a mostrar (a contagem sem o botão, ou o botão)
  const showPop = Boolean(status);

  return (
    <div className={cx("tsearch-wrap", palette ? "in-palette" : "in-sheet")}>
      <form
        className="tsearch"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Search className="tsearch-ic" aria-hidden />
        <input
          ref={inputRef}
          className={search ? "has-value" : undefined}
          // na paleta cabe o rótulo inteiro ("Buscar evento, disciplina ou docente")
          placeholder={palette ? scope.label : scope.placeholder}
          aria-label={scope.label}
          aria-keyshortcuts={shortcut.aria}
          enterKeyHint="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            // na folha do celular, o Esc limpa a busca antes de fechar a folha. Na paleta o Esc fecha direto e o
            // termo fica: a tela continua filtrada, e o "x" do campo ou o "Limpar busca" da tela limpam
            if (event.key === "Escape" && search && !palette) {
              event.preventDefault();
              event.stopPropagation();
              onSearchChange("");
            }
          }}
        />
        {search ? (
          <button
            className="tsearch-clear"
            onClick={() => {
              onSearchChange("");
              inputRef.current?.focus();
            }}
            aria-label="Limpar busca"
            title="Limpar busca"
            type="button"
          >
            <X aria-hidden />
          </button>
        ) : palette ? null : (
          <span className="kbd tsearch-kbd" aria-hidden>
            {shortcut.chip}
          </span>
        )}
      </form>
      <div className={cx("tsearch-pop", !showPop && "is-empty")}>
        {/* a contagem é sempre anunciada; com o botão à vista, ela fica só para leitores de tela */}
        <p className={cx("tsearch-status", (!status || showButton) && "sr-only")} role="status">
          {status}
        </p>
        {showButton ? (
          <button className="tsearch-go" onClick={onSubmit} type="button">
            Ver {count} {count === 1 ? one : many}
            <ArrowRight aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** "TADS 5" (ou "TADS 5 e INF 3A"): as turmas ativas do aluno acompanhado. */
function studentClassesText(student: LinkedStudent) {
  const names = student.classes.map((item) => item.name);
  if (!names.length) {
    return "Sem turma ativa";
  }
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/**
 * Responsável: o bloco "Estudante: Diogo, TADS 5". No celular, na folha da conta; no computador, no trilho, logo
 * abaixo do logo (o avatar do aluno com o nome e a turma embaixo, como os itens do trilho).
 * Com mais de um aluno ativo, vira seletor: um select nativo por cima do bloco, que funciona no toque, no
 * teclado e no leitor de tela. A escolha vai para o endereço (?aluno=) e para o histórico.
 */
function StudentPick({
  rail,
  student,
  students,
  onChoose,
}: {
  /** No trilho do computador: em coluna, com o primeiro nome e a turma embaixo do avatar. */
  rail?: boolean;
  student: LinkedStudent;
  /** Só os vínculos ativos (o pendente não dá acesso). */
  students: LinkedStudent[];
  onChoose?: (studentId: number) => void;
}) {
  const selectId = useId();
  const name = firstName(student.fullName ?? "Aluno");
  const classes = studentClassesText(student);
  const many = students.length > 1 && Boolean(onChoose);
  const whole = `Estudante: ${name}, ${classes}`;

  const body = rail ? (
    <>
      <span className="avatar" aria-hidden>
        {student.initials}
      </span>
      <span className="pick-t">{name}</span>
      <span className="pick-s">{classes}</span>
      {many ? <ChevronsUpDown className="rail-kid-chev" aria-hidden /> : null}
    </>
  ) : (
    <>
      <span className="avatar" aria-hidden>
        {student.initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="pick-t block truncate">Estudante: {name}</span>
        <span className="pick-s block truncate">{classes}</span>
      </span>
      {many ? <ChevronsUpDown className="h-[18px] w-[18px] shrink-0" aria-hidden /> : null}
    </>
  );

  if (!many) {
    return rail ? (
      <div className="student-pick rail-kid" title={whole}>
        {/* no trilho só cabe o primeiro nome: o leitor de tela lê a frase inteira */}
        <span className="sr-only">{whole}</span>
        <span className="contents" aria-hidden>
          {body}
        </span>
      </div>
    ) : (
      <div className="student-pick">{body}</div>
    );
  }

  return (
    <div className={cx("student-pick is-select", rail && "rail-kid")}>
      {/* o texto à vista repete o select: o leitor de tela lê só o select */}
      <span className="contents" aria-hidden>
        {body}
      </span>
      <label htmlFor={selectId} className="sr-only">
        Estudante acompanhado
      </label>
      <select
        id={selectId}
        value={student.id}
        onChange={(event) => onChoose?.(Number(event.target.value))}
        title="Trocar estudante"
      >
        {students.map((item) => (
          <option key={item.id} value={item.id}>
            {item.fullName ?? "Aluno"}, {studentClassesText(item)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** O estado do "Atualizado às": o texto à vista (na folha da conta), o do leitor de tela e se está sem conexão. */
function syncState({
  loadError,
  refreshing,
  updatedAt,
}: {
  loadError?: string | null;
  refreshing: boolean;
  updatedAt?: Date | null;
}) {
  const time = updatedAt ? formatTime(updatedAt.toISOString()) : null;
  const offline = Boolean(loadError) && !refreshing;
  const text = refreshing ? "Atualizando..." : offline ? "Sem conexão" : time ? `Atualizado às ${time}` : "Atualizar dados";
  const label = refreshing
    ? "Atualizando dados"
    : offline
      ? "Atualizar dados, sem conexão"
      : time
        ? `Atualizar dados, atualizado às ${time}`
        : "Atualizar dados";
  return { offline, text, label };
}

/**
 * "Atualizado às 14:37" no trilho: um ponto (verde; âmbar sem conexão; girando enquanto atualiza) com o texto na
 * dica. Um clique atualiza os dados, como antes.
 */
function SyncButton({
  className,
  loadError,
  refreshing,
  showText,
  updatedAt,
  onRefresh,
}: {
  className?: string;
  loadError?: string | null;
  refreshing: boolean;
  /** Com o texto à vista ao lado do ponto (folha da conta no celular). */
  showText?: boolean;
  updatedAt?: Date | null;
  onRefresh: () => void;
}) {
  const state = syncState({ loadError, refreshing, updatedAt });
  return (
    <button
      className={cx("sync-dot", showText && "with-text", className)}
      aria-busy={refreshing || undefined}
      aria-disabled={refreshing || undefined}
      aria-label={state.label}
      onClick={() => {
        if (!refreshing) {
          onRefresh();
        }
      }}
      title={`${state.text}. Atualizar dados`}
      type="button"
    >
      {refreshing ? (
        <Loader2 className="sync-spin animate-spin" aria-hidden />
      ) : (
        <span className={cx("sync-ok", state.offline && "is-off")} aria-hidden />
      )}
      {showText ? (
        <>
          <span className="sync-text" aria-hidden>
            {state.text}
          </span>
          {!refreshing ? <RefreshCw className="sync-re" aria-hidden /> : null}
        </>
      ) : null}
    </button>
  );
}

/**
 * Pé do trilho: o avatar (com o primeiro nome embaixo) abre uma caixinha com o nome, o papel, "Configurações do
 * perfil" e "Sair da conta". Esc ou um clique fora fecham, e o foco volta para o avatar.
 * A caixinha vai para o body (portal): dentro do trilho ela ficava no contexto de empilhamento dele (sticky e com
 * animação), e os cards da tela, que vêm depois e também animam, eram pintados por cima dela.
 */
function AccountMenu({
  user,
  onLogout,
  onOpenProfile,
}: {
  user: User;
  onLogout: () => void;
  onOpenProfile: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const name = user.fullName ?? user.email;

  useEffect(() => {
    if (!open) {
      return;
    }
    firstRef.current?.focus();
    const close = (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) {
        buttonRef.current?.focus();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close(false);
      }
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!popRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close(false);
      }
    };
    const onResize = () => close(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("focusin", onFocus);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        className="rail-me"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={`${name}, conta e perfil`}
        title={name}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            setSpot({ left: rect.right + 14, bottom: Math.max(12, window.innerHeight - rect.bottom) });
          }
          setOpen((value) => !value);
        }}
        type="button"
      >
        <span className="avatar">{initialsOf(user)}</span>
        <span className="rail-lbl" aria-hidden>
          {firstName(name)}
        </span>
      </button>
      {open && spot ? createPortal(
        <div
          ref={popRef}
          id={popId}
          className="acct-pop"
          style={{ left: spot.left, bottom: spot.bottom }}
          role="group"
          aria-label="Conta"
          onKeyDown={(event) => {
            // fora do trilho no DOM, o Tab nas pontas da caixinha volta para o avatar (e ela fecha), em vez de
            // seguir para o fim da página
            if (event.key !== "Tab") {
              return;
            }
            const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
            const edge = event.shiftKey ? options[0] : options[options.length - 1];
            if (document.activeElement === edge) {
              event.preventDefault();
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
        >
          <div className="acct-who">
            <span className="avatar" aria-hidden>
              {initialsOf(user)}
            </span>
            <span className="min-w-0">
              <span className="acct-name">{name}</span>
              <span className="acct-role">{roleLine(user)}</span>
            </span>
          </div>
          <button
            ref={firstRef}
            className="acct-opt"
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
            type="button"
          >
            <UserRoundCog aria-hidden />
            Configurações do perfil
          </button>
          <button
            className="acct-opt is-out"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            type="button"
          >
            <LogOut aria-hidden />
            Sair da conta
          </button>
        </div>,
        document.body
      ) : null}
    </>
  );
}

/** Folha do celular aberta: a busca, a conta ou os itens que não couberam na barra de baixo ("Mais"). */
type SheetKind = "busca" | "conta" | "mais";

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
  searchScope,
  student,
  students,
  updatedAt,
  user,
  onChooseStudent,
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
  /** Turmas da pessoa. A barra do semestre saiu do trilho na rodada 10; a prop continua para não mudar a página. */
  context?: AcademicContext | null;
  /** Muda quando a tela troca: o título da tela recebe o foco. */
  focusHeadingToken?: number;
  /** Falha no último carregamento: o rodapé do menu mostra "Sem conexão". */
  loadError?: string | null;
  /** Folha do celular aberta (busca, conta ou "Mais"). Quem usa a casca cuida do histórico: o Voltar fecha só ela. */
  menuOpen: boolean;
  refreshing: boolean;
  search: string;
  /** A busca filtra a própria tela (Cronograma, Notas, Gestão, Turmas): a dica da paleta diz "ver na tela". */
  searchInPlace?: boolean;
  /** Quantos resultados a busca do menu encontra (eventos, ou o que searchScope disser). */
  searchResultCount?: number;
  /** O que a busca procura na tela de agora (padrão: eventos). Em Turmas e disciplinas: turmas, disciplinas e alunos. */
  searchScope?: SearchScope;
  /** Responsável: o aluno escolhido (bloco "Estudante: Diogo, TADS 5" acima dos itens do menu). */
  student?: LinkedStudent | null;
  /** Responsável: os alunos com vínculo ativo; com mais de um, o bloco vira seletor. */
  students?: LinkedStudent[];
  updatedAt?: Date | null;
  user: User;
  /** Responsável: trocou de aluno no seletor do menu. */
  onChooseStudent?: (studentId: number) => void;
  onLogout: () => void;
  /** Abrir ou fechar a folha do celular. Navegar, abrir as configurações do perfil ou o painel por ela já fecha. */
  onMenuChange: (open: boolean) => void;
  onNavigate: (view: View) => void;
  onNewEvent: () => void;
  onOpenProfile: () => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  /** Enter ou "Ver eventos" na busca do menu. */
  onSearchSubmit?: () => void;
}) {
  const closeMenuRef = useRef<HTMLButtonElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const meButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetPanelRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sheetSearchRef = useRef<HTMLInputElement>(null);
  // paleta de busca do computador: o item "Buscar" do trilho, o véu, o painel, o campo e para onde o foco volta
  const railSearchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const palettePanelRef = useRef<HTMLElement>(null);
  const paletteSearchRef = useRef<HTMLInputElement>(null);
  const paletteReturnRef = useRef<HTMLElement | null>(null);
  // qual folha do celular está aberta e se ela veio do Ctrl+K (aí o foco volta para onde estava)
  const [sheet, setSheet] = useState<SheetKind>("conta");
  const [sheetByKey, setSheetByKey] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shortcut = useSearchShortcut();
  const searchTerm = search.trim();
  // o item "Buscar" (trilho e topo do celular) diz quando há busca ativa: a tela continua filtrada pelo termo
  const searchLabel = searchTerm ? `Buscar, busca ativa: ${searchTerm}` : "Buscar";
  const guardian = user.role === "guardian";
  // o responsável só lê: nunca cria evento. O rótulo é o mesmo do botão da página.
  const newEventLabel = canWrite && !guardian ? (user.role === "admin" ? "Novo evento oficial" : "Novo evento") : null;
  const items = visibleNavItems(user.role);
  const pageTitle = items.find((item) => item.view === activeView)?.label ?? "Agenda Acadêmica";
  // barra de baixo do celular: até 5 itens; com mais, os 4 primeiros e "Mais"
  const bottomItems = items.length > BOTTOM_MAX ? items.slice(0, BOTTOM_MAX - 1) : items;
  const moreItems = items.length > BOTTOM_MAX ? items.slice(BOTTOM_MAX - 1) : [];
  const moreActive = moreItems.some((item) => item.view === activeView);
  const moreCount = moreItems.reduce((sum, item) => sum + (badges?.[item.view] ?? 0), 0);
  const name = user.fullName ?? user.email;
  const returnRef = sheet === "busca" ? searchButtonRef : sheet === "mais" ? moreButtonRef : meButtonRef;

  // folha do celular: foco no campo (busca) ou em "Fechar", Tab preso dentro e, ao fechar, volta para o botão que
  // abriu. Aberta pelo Ctrl+K: começa na busca e, ao fechar, o foco volta para onde estava.
  useDialogLayer({
    open: drawerOpen,
    rootRef: sheetRef,
    panelRef: sheetPanelRef,
    onClose: () => onMenuChange(false),
    initialFocusRef: sheet === "busca" ? sheetSearchRef : closeMenuRef,
    returnFocusRef: sheetByKey ? undefined : returnRef,
  });

  // Aberta pela busca, a folha já entra com o foco no campo, e o que se digita filtra
  useEffect(() => {
    if (drawerOpen && sheet === "busca") {
      const input = sheetSearchRef.current;
      if (input && document.activeElement !== input) {
        input.focus();
        input.select();
      }
    }
  }, [drawerOpen, sheet]);

  function openSheet(kind: SheetKind, byKey = false) {
    setSheet(kind);
    setSheetByKey(byKey);
    onMenuChange(true);
  }

  // paleta de busca (computador): campo com o foco, Tab preso dentro, Esc ou um clique fora fecham. O foco volta ao
  // item "Buscar"; aberta pelo Ctrl+K, volta para onde estava (ou para o item, se não estava em lugar nenhum)
  useDialogLayer({
    open: paletteOpen,
    rootRef: paletteRef,
    panelRef: palettePanelRef,
    onClose: () => setPaletteOpen(false),
    initialFocusRef: paletteSearchRef,
    returnFocusRef: paletteReturnRef,
  });

  // o campo da paleta já entra com o foco e o termo selecionado (também num computador com tela de toque)
  useEffect(() => {
    if (paletteOpen) {
      const input = paletteSearchRef.current;
      if (input && document.activeElement !== input) {
        input.focus();
      }
      input?.select();
    }
  }, [paletteOpen]);

  function openPalette(byKey: boolean) {
    const from = document.activeElement;
    paletteReturnRef.current =
      byKey && from instanceof HTMLElement && from !== document.body && from !== mainRef.current
        ? from
        : railSearchRef.current;
    setPaletteOpen(true);
  }

  // a paleta é só do computador: se a janela estreitar, ela fecha (no celular a busca fica na folha de cima)
  useEffect(() => {
    if (!paletteOpen) {
      return;
    }
    const wide = window.matchMedia(WIDE_MENU);
    const onChange = () => {
      if (!wide.matches) {
        setPaletteOpen(false);
      }
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [paletteOpen]);

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
  const latest = useRef({ drawerOpen, onMenuChange, paletteOpen, openPalette });
  useEffect(() => {
    latest.current = { drawerOpen, onMenuChange, paletteOpen, openPalette };
  });

  // a folha é só do celular: se a janela alargar, ela fecha
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const wide = window.matchMedia(WIDE_MENU);
    const onChange = () => {
      if (wide.matches) {
        latest.current.onMenuChange(false);
      }
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [drawerOpen]);

  // Ctrl+K (Cmd+K no Mac) leva à busca. Com um diálogo por cima, a casca fica inerte e o atalho fica com o navegador.
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
      if (window.matchMedia(WIDE_MENU).matches) {
        if (latest.current.paletteOpen) {
          focusSearch(event, paletteSearchRef.current);
        } else if (isOnTopLayer(railSearchRef.current)) {
          // computador: abre a paleta de busca já com o foco no campo
          event.preventDefault();
          latest.current.openPalette(true);
        }
      } else if (latest.current.drawerOpen) {
        focusSearch(event, sheetSearchRef.current);
      } else if (isOnTopLayer(searchButtonRef.current)) {
        // janela estreita: abre a folha de busca já com o foco no campo
        event.preventDefault();
        setSheet("busca");
        setSheetByKey(true);
        latest.current.onMenuChange(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut.mac]);

  function closeSheet() {
    onMenuChange(false);
  }

  function pick(rail = false) {
    return guardian && student ? (
      <StudentPick rail={rail} student={student} students={students ?? [student]} onChoose={onChooseStudent} />
    ) : null;
  }

  function searchBox(variant: "sheet" | "palette") {
    return (
      <SearchBox
        inputRef={variant === "sheet" ? sheetSearchRef : paletteSearchRef}
        resultCount={searchResultCount}
        scope={searchScope}
        search={search}
        shortcut={shortcut}
        variant={variant}
        onSearchChange={onSearchChange}
        onSubmit={() => {
          // a paleta cobre a tela: Enter ou "Ver N eventos" fecham e mostram o resultado (na própria tela ou no
          // Cronograma, como antes)
          setPaletteOpen(false);
          onSearchSubmit?.();
        }}
      />
    );
  }

  const sheetTitle = sheet === "busca" ? "Buscar" : sheet === "mais" ? "Mais telas" : "Sua conta";

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

      {/* Barra do topo (celular e tablet): o logo e "Agenda Acadêmica"; à direita, o "+" de novo evento (docente e
          administração), a busca (abre a folha de busca) e o avatar (abre a folha da conta) */}
      <header className="mtop lg:hidden">
        <Logo className="mtop-logo" />
        <span className="mtop-name">Agenda Acadêmica</span>
        {newEventLabel ? (
          <button className="ib mtop-new" onClick={onNewEvent} aria-label={newEventLabel} title={newEventLabel} type="button">
            <Plus aria-hidden />
          </button>
        ) : null}
        <button
          ref={searchButtonRef}
          className="ib mtop-ib mtop-search"
          onClick={() => openSheet("busca")}
          aria-expanded={drawerOpen && sheet === "busca"}
          aria-haspopup="dialog"
          aria-label={searchLabel}
          title={searchLabel}
          type="button"
        >
          <Search aria-hidden />
          {searchTerm ? <i className="mtop-dot" aria-hidden /> : null}
        </button>
        <button
          ref={meButtonRef}
          className="mtop-me"
          onClick={() => openSheet("conta")}
          aria-expanded={drawerOpen && sheet === "conta"}
          aria-haspopup="dialog"
          aria-label={`${name}, conta e perfil`}
          title={name}
          type="button"
        >
          <span className="avatar">{initialsOf(user)}</span>
        </button>
      </header>

      {/* Barra de baixo do celular: pílula branca flutuante com os itens do trilho (ícone pastel e rótulo) */}
      <nav className="bnav lg:hidden" aria-label="Navegação principal">
        {bottomItems.map((item) => (
          <NavButton
            key={item.view}
            active={activeView === item.view}
            count={badges?.[item.view]}
            item={item}
            onNavigate={onNavigate}
          />
        ))}
        {moreItems.length ? (
          <button
            ref={moreButtonRef}
            className={cx("rail-item nv-more", moreActive && "on")}
            aria-current={moreActive ? "page" : undefined}
            aria-expanded={drawerOpen && sheet === "mais"}
            aria-haspopup="dialog"
            aria-label={moreActive ? `Mais telas, ${pageTitle}` : "Mais telas"}
            onClick={() => openSheet("mais")}
            type="button"
          >
            <span className="rail-ic" aria-hidden>
              <MoreHorizontal />
              {moreCount ? <i className="rail-dot" /> : null}
            </span>
            <span className="rail-lbl" aria-hidden>
              Mais
            </span>
          </button>
        ) : null}
      </nav>

      {/* Folha do celular (busca, conta ou "Mais"), por cima de tudo */}
      {drawerOpen
        ? createPortal(
            <div
              ref={sheetRef}
              className={cx("msheet-veil animate-fade-in lg:hidden", sheet === "busca" && "is-top")}
              role="dialog"
              aria-label={sheetTitle}
              aria-modal="true"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  // sem isso o clique fora leva o foco para o body depois de fechar
                  event.preventDefault();
                  closeSheet();
                }
              }}
            >
              <section ref={sheetPanelRef} id="menu-gaveta" className="msheet !outline-none" tabIndex={-1}>
                <div className="msheet-head">
                  <p className="msheet-t">{sheetTitle}</p>
                  <button
                    ref={closeMenuRef}
                    className="ib"
                    onClick={closeSheet}
                    aria-label="Fechar"
                    title="Fechar"
                    type="button"
                  >
                    <X aria-hidden />
                  </button>
                </div>
                {sheet === "busca" ? searchBox("sheet") : null}
                {sheet === "mais" ? (
                  <nav className="msheet-nav" aria-label="Mais telas">
                    {moreItems.map((item) => (
                      <NavButton
                        key={item.view}
                        active={activeView === item.view}
                        count={badges?.[item.view]}
                        item={item}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </nav>
                ) : null}
                {sheet === "conta" ? (
                  <div className="msheet-acct">
                    <div className="acct-who">
                      <span className="avatar" aria-hidden>
                        {initialsOf(user)}
                      </span>
                      <span className="min-w-0">
                        <span className="acct-name">{name}</span>
                        <span className="acct-role">{roleLine(user)}</span>
                      </span>
                    </div>
                    {pick()}
                    <button className="acct-opt" onClick={onOpenProfile} type="button">
                      <UserRoundCog aria-hidden />
                      Configurações do perfil
                    </button>
                    <SyncButton
                      className="acct-opt"
                      loadError={loadError}
                      refreshing={refreshing}
                      showText
                      updatedAt={updatedAt}
                      onRefresh={onRefresh}
                    />
                    <button className="acct-opt is-out" onClick={onLogout} type="button">
                      <LogOut aria-hidden />
                      Sair da conta
                    </button>
                  </div>
                ) : null}
              </section>
            </div>,
            document.body
          )
        : null}

      {/* Paleta de busca do computador: o mesmo campo, a mesma contagem e o mesmo "Ver N eventos", num painel
          centralizado por cima da tela. O que se digita filtra a tela de trás como antes */}
      {paletteOpen
        ? createPortal(
            <div
              ref={paletteRef}
              className="cmdk-veil max-lg:hidden"
              role="dialog"
              aria-label="Buscar"
              aria-modal="true"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  // sem isso o clique fora leva o foco para o body depois de fechar
                  event.preventDefault();
                  setPaletteOpen(false);
                }
              }}
            >
              <section ref={palettePanelRef} className="cmdk !outline-none" tabIndex={-1}>
                {searchBox("palette")}
                <p className="cmdk-keys" aria-hidden>
                  <span>
                    <kbd className="kbd">Enter</kbd>
                    {searchInPlace ? "ver na tela" : "ver no Cronograma"}
                  </span>
                  <span>
                    <kbd className="kbd">Esc</kbd>
                    fechar
                  </span>
                </p>
              </section>
            </div>,
            document.body
          )
        : null}

      <div className="app">
        {/* Trilho lateral flutuante, preso à altura da tela (a partir de 1024 px) */}
        {/* is-long: o trilho comprido da administração aperta antes em janela baixa (visual-novo.css) */}
        <aside className={cx("rail max-lg:hidden", items.length > BOTTOM_MAX && "is-long")} aria-label="Menu">
          <Logo className="rail-logo" />
          {/* responsável: o estudante acompanhado (e o seletor, com mais de um) */}
          {pick(true)}
          {newEventLabel ? (
            <button className="rail-new" onClick={onNewEvent} aria-label={newEventLabel} title={newEventLabel} type="button">
              <span className="rail-new-ic" aria-hidden>
                <Plus />
              </span>
              <span className="rail-lbl" aria-hidden>
                {newEventLabel}
              </span>
            </button>
          ) : null}
          {/* busca: abre a paleta (Ctrl K também). Com termo ativo, o ponto verde diz que a tela está filtrada */}
          <button
            ref={railSearchRef}
            className="rail-item nv-busca"
            onClick={() => openPalette(false)}
            aria-expanded={paletteOpen}
            aria-haspopup="dialog"
            aria-keyshortcuts={shortcut.aria}
            aria-label={searchLabel}
            title={searchTerm ? `${searchLabel}. ${shortcut.chip}` : `Buscar, ${shortcut.chip}`}
            type="button"
          >
            <span className="rail-ic" aria-hidden>
              <Search />
              {searchTerm ? <i className="rail-dot is-term" /> : null}
            </span>
            <span className="rail-lbl" aria-hidden>
              Buscar
            </span>
          </button>
          <span className="rail-sep" aria-hidden />
          <nav className="rail-nav" aria-label="Navegação principal">
            {items.map((item) => (
              <NavButton
                key={item.view}
                active={activeView === item.view}
                count={badges?.[item.view]}
                item={item}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
          <div className="rail-foot">
            <SyncButton loadError={loadError} refreshing={refreshing} updatedAt={updatedAt} onRefresh={onRefresh} />
            <AccountMenu user={user} onLogout={onLogout} onOpenProfile={onOpenProfile} />
          </div>
        </aside>

        <div className="main-col">
          {/* sem barra no topo do conteúdo: a busca foi para o trilho (item "Buscar") e o sino saiu (os avisos novos
              ficam no ponto do item Lembretes). Cada tela começa no topo da página */}
          <main id="conteudo" ref={mainRef} className="content" tabIndex={-1}>
            {/* sem cabeçalho visível: o título da tela fica para leitores de tela */}
            <h1 ref={headingRef} className="sr-only" tabIndex={-1}>
              {pageTitle}
            </h1>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
