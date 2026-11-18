"use client";

import {
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheckBig,
  Clock,
  Loader2,
  Settings2,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { countText, cx, formatShortDate, formatTime, isWholeDay, monthGroupLabel, relativeDue, startOfDay } from "@/lib/format";
import { categoryMeta, reminderOffsetLabel, reminderOptions, statusMeta } from "@/lib/meta";
import type { AcademicEvent, Category, Reminder } from "@/lib/types";
import { AvisosCard, InsightTile, delay } from "./dashboard-bits";
import { Pager, usePaged } from "./pager";
import { Drawer, InfoLine, secondaryButton } from "./ui";

/** Quantos lembretes cada lista mostra na página. O resto fica no painel "Todos os lembretes", com páginas. */
const PREVIEW = 3;
/** Sugestões embaixo de "Aguardando aviso" quando ele já mostra os PREVIEW lembretes (só para fechar as colunas). */
const FULL_SUGGESTIONS = 1;
/** Lembretes por página no painel "Todos os lembretes". */
const DRAWER_PAGE = 10;
/** Quantos meses o card "Avisos por mês" lista antes do "Ver todos os meses". */
const MONTHS_SHOWN = 6;
/** Relógio da tela: o "Aviso hoje, 19:00", as antecedências que já passaram e as sugestões. */
const CLOCK_TICK = 15000;
/**
 * A página confere os avisos a cada 30 s. A linha passa para "Já avisados" junto com o bloco Avisos
 * (o aviso que aparece lá já conta como avisado); se o aviso não vier, ela passa depois desta folga.
 */
const AVISO_GRACE = 40000;
/** Sem nova troca de antecedência por este tempo, a escolha é salva (as setas andam por várias opções antes). */
const OFFSET_SAVE_DELAY = 800;
/** Menor antecedência aceita, em minutos (15). */
const MIN_OFFSET = Math.min(...reminderOptions.map((option) => Number(option.value)));
/** A sugestão sai um pouco antes de o evento deixar de aceitar lembrete (o relógio da tela anda de 15 em 15 s). */
const SUGGEST_MARGIN = 60000;
/**
 * Colunas lado a lado: quanto a coluna mais baixa pode esticar para terminar junto da outra. É uma sobra que some
 * no padding do último card; acima disto nenhuma estica (decisão 5: sem card esticado com buraco dentro), as duas
 * ficam alinhadas no alto e a lateral fica do tamanho dela, parada no alto enquanto a página rola. O vão entre o pé
 * das colunas (até uns 80 px) é permitido; o buraco dentro do card, não.
 */
const STRETCH_MAX = 24;

type ListKey = "pending" | "past";
/** Abas do painel "Todos os lembretes": as duas listas e, quando houver, os eventos cancelados ou concluídos. */
type TabKey = ListKey | "void";
/** pending: o aviso ainda vai sair; past: a hora do aviso passou; void: evento cancelado ou concluído. */
type RowKind = "pending" | "past" | "void";
/** Onde a linha está: na página ou no painel "Todos os lembretes" (a mesma linha pode estar nos dois). */
type Scope = "page" | "drawer";

/** "seg, 23/11"; fora do ano corrente, com o ano: "seg, 15/03/2027" (o formatShortDate já põe o ano). */
function dayLabel(value: string | Date) {
  return formatShortDate(value);
}

/** "ter, 09/11, 19:00"; "dia todo" só quando o evento não tem horário (começa à meia-noite, sem hora de término). */
function eventWhen(event: AcademicEvent) {
  return isWholeDay(event.startsAt, event.endsAt)
    ? `${dayLabel(event.startsAt)}, dia todo`
    : `${dayLabel(event.startsAt)}, ${formatTime(event.startsAt)}`;
}

/**
 * Linha das próximas provas e trabalhos, ao lado do selo da data (SEG / 23 / NOV): só a hora e quanto falta,
 * "18:00, em 6 dias", como nas listas do Painel e do Cronograma. Fora do ano corrente, o dia vai com o ano
 * ("seg, 15/03/2027, 18:00"), que o selo não mostra.
 */
function suggestionWhen(event: AcademicEvent) {
  if (new Date(event.startsAt).getFullYear() !== new Date().getFullYear()) {
    return eventWhen(event);
  }
  const time = isWholeDay(event.startsAt, event.endsAt) ? "Dia todo" : formatTime(event.startsAt);
  return `${time}, ${relativeDue(event.startsAt)}`;
}

/** Quando o aviso sai (ou saiu), em rótulo curto: "hoje, 19:00", "amanhã, 07:30" ou "dom, 08/11, 19:00". */
function sendWhen(value: string, now: number) {
  const days = Math.round((startOfDay(new Date(value)).getTime() - startOfDay(new Date(now)).getTime()) / 86400000);
  if (days === 0) {
    return `hoje, ${formatTime(value)}`;
  }
  if (days === 1) {
    return `amanhã, ${formatTime(value)}`;
  }
  if (days === -1) {
    return `ontem, ${formatTime(value)}`;
  }
  return `${dayLabel(value)}, ${formatTime(value)}`;
}

/** Mês do aviso (ano * 12 + mês): as listas seguem a hora do aviso, e os grupos também. */
function monthOf(reminder: Reminder) {
  const date = new Date(reminder.sendAt);
  return date.getFullYear() * 12 + date.getMonth();
}

/** "Novembro"; fora do ano de agora, "Março de 2027". */
function monthName(key: number, now: number) {
  return monthGroupLabel(new Date(Math.floor(key / 12), key % 12, 1), new Date(now));
}

/** Meses de uma lista, na ordem dela, com quantos lembretes cada um tem. */
function monthsOf(list: Reminder[]) {
  const months: { key: number; count: number }[] = [];
  for (const reminder of list) {
    const key = monthOf(reminder);
    const last = months[months.length - 1];
    const found = last?.key === key ? last : months.find((item) => item.key === key);
    if (found) {
      found.count += 1;
    } else {
      months.push({ key, count: 1 });
    }
  }
  return months;
}

/** Evento cancelado ou concluído: o aviso do lembrete não sai mais (o mesmo texto do detalhe). */
function voidReason(reminder: Reminder) {
  const status = reminder.academicEvent?.status;
  if (status === "cancelled") {
    return "O evento foi cancelado. Seu lembrete não vale mais.";
  }
  if (status === "completed") {
    return "O evento foi concluído. Seu lembrete não vale mais.";
  }
  return null;
}

/** O aviso como a página o identifica: o lembrete e a hora dele (mudar a antecedência faz um aviso novo). */
function avisoKey(reminder: Reminder) {
  return `${reminder.id}@${reminder.sendAt}`;
}

/**
 * As listas da tela. Lembrete de evento cancelado ou concluído não avisa mais e fica fora das contas
 * (como no Painel). Os outros passam para "Já avisados" quando o aviso aparece na página
 * (reached: os avisos de agora e os que já apareceram com a tela aberta), assim a linha e os
 * indicadores mudam juntos; sem os avisos da página, vale o relógio da tela.
 */
function reminderLists(reminders: Reminder[], reached: Set<string> | null, now: number) {
  const byTime = (a: Reminder, b: Reminder) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime();
  const isPast = (reminder: Reminder) => {
    const sendAt = new Date(reminder.sendAt).getTime();
    return reached ? reached.has(avisoKey(reminder)) || sendAt <= now - AVISO_GRACE : sendAt <= now;
  };
  const live = reminders.filter((reminder) => voidReason(reminder) === null);
  return {
    voided: reminders.filter((reminder) => voidReason(reminder) !== null).sort(byTime),
    upcoming: live.filter((reminder) => !isPast(reminder)).sort(byTime),
    // já avisados: a hora do aviso passou (sentAt não é gravado hoje), os mais recentes primeiro
    past: live.filter(isPast).sort((a, b) => byTime(b, a)),
  };
}

/**
 * Antecedência do "Lembrar ..." (a mesma conta da página): a maior das opções, até o padrão, cujo aviso
 * ainda cai no futuro. Sem nenhuma, o evento não aceita mais lembrete.
 */
function quickOffset(event: AcademicEvent, defaultMinutes: number, now: number) {
  const start = new Date(event.startsAt).getTime();
  const valid = [...new Set([...reminderOptions.map((option) => Number(option.value)), defaultMinutes])]
    .filter((minutes) => minutes >= MIN_OFFSET && minutes <= defaultMinutes && start - minutes * 60000 > now)
    .sort((a, b) => b - a);
  return valid[0] ?? null;
}

/** Primeiro controle de uma linha: o título que abre o evento, a antecedência ou o Remover. */
function firstControl(root: Element | null | undefined) {
  return root?.querySelector<HTMLElement>("button, select, a[href]") ?? null;
}

/** Onde a linha está: a lista e a posição nela. A lista segue a hora do aviso, então salvar pode mudar isso. */
function rowPlace(rowNode: Element | null | undefined) {
  const list = rowNode?.parentElement;
  return list ? `${list.id}:${Array.prototype.indexOf.call(list.children, rowNode)}` : null;
}

/**
 * Colunas lado a lado (.tela-cols, a partir de 1200px). Se as duas têm quase a mesma altura (diferença até
 * STRETCH_MAX), a mais baixa estica e as duas terminam juntas: a sobra fica no espaçador do último card
 * (.tela-gap), que nunca passa de STRETCH_MAX. Se a diferença é maior, nenhuma estica (não sobra buraco dentro
 * de card) e a lateral fica do tamanho dela, parada no alto enquanto a página rola (.is-stuck); --side-h leva a
 * altura dela para o sticky. mainGapRef e sideGapRef: os espaçadores dos últimos cards de cada coluna.
 */
function useSideFit(mainRef: RefObject<HTMLElement | null>, deps: unknown) {
  const sideRef = useRef<HTMLDivElement>(null);
  const mainGapRef = useRef<HTMLDivElement>(null);
  const sideGapRef = useRef<HTMLDivElement>(null);
  // bloco opcional da lateral, junto do padrão: o curto (o caminho para lembrar de outro evento) ou o longo (os
  // passos de "Como funciona"). Entra o que deixa as colunas mais perto de terminar juntas (decisão 5: muda o que a
  // lateral mostra, nunca estica card). A conta usa a lateral sem ele, então ligar ou desligar não muda a decisão
  // (não fica piscando); data-extra diz qual está na tela, para guardar a altura dele
  const extraRef = useRef<HTMLDivElement>(null);
  const extraHeight = useRef<Record<SideExtra, number>>({ none: 0, short: 100, long: 230 });
  const [extraKind, setExtraKind] = useState<SideExtra>("none");
  const [stuck, setStuck] = useState(false);

  useLayoutEffect(() => {
    const main = mainRef.current;
    const side = sideRef.current;
    if (!main || !side || typeof ResizeObserver === "undefined") {
      return;
    }
    // a primeira medida vem do próprio ResizeObserver, antes da pintura
    const observer = new ResizeObserver(() => {
      // lado a lado só a partir de 1200px; uma embaixo da outra, nada estica nem gruda
      const beside = side.offsetLeft >= main.offsetLeft + main.offsetWidth;
      const mainContent = main.offsetHeight - (mainGapRef.current?.offsetHeight ?? 0);
      const sideContent = side.offsetHeight - (sideGapRef.current?.offsetHeight ?? 0);
      side.style.setProperty("--side-h", `${sideContent}px`);
      setStuck(beside && Math.abs(mainContent - sideContent) > STRETCH_MAX);
      const extra = extraRef.current;
      let extraNow = 0;
      if (extra) {
        extraNow = extra.getBoundingClientRect().height + parseFloat(getComputedStyle(extra).marginTop || "0");
        const kind = extra.dataset.extra;
        if (kind === "short" || kind === "long") {
          extraHeight.current[kind] = extraNow;
        }
      }
      const without = mainContent - (sideContent - extraNow);
      // empate (diferença parecida): fica o mais simples (sem bloco, depois o curto)
      let best: SideExtra = "none";
      let bestGap = Math.abs(without);
      for (const kind of ["short", "long"] as const) {
        const gap = Math.abs(without - extraHeight.current[kind]);
        if (gap + 24 < bestGap) {
          best = kind;
          bestGap = gap;
        }
      }
      setExtraKind(beside ? best : "none");
    });
    for (const node of [main, side, mainGapRef.current, sideGapRef.current]) {
      if (node) {
        observer.observe(node);
      }
    }
    return () => observer.disconnect();
  }, [mainRef, deps]);

  return { sideRef, mainGapRef, sideGapRef, extraRef, extraKind, stuck };
}

type SideExtra = "none" | "short" | "long";

/**
 * Linha de lembrete: o evento (categoria e título), quando ele acontece e quando o aviso sai; à direita, a
 * antecedência (enquanto o aviso não saiu) e Remover. Nos já avisados, o aviso que ainda está no Painel ganha a
 * etiqueta "Avisando agora" e o Dispensar.
 */
function ReminderRow({
  reminder,
  kind,
  now,
  busy,
  change,
  draft,
  live,
  registerRemove,
  onPickOffset,
  onCommitOffset,
  onDelete,
  onDismiss,
  onOpenEvent,
}: {
  reminder: Reminder;
  kind: RowKind;
  now: number;
  busy: boolean;
  /** Troca de antecedência salvando: { de, para }. */
  change?: { from: number; to: number };
  /** Antecedência escolhida no select que ainda não foi salva. */
  draft?: number;
  /** O aviso ainda está no Painel (não foi dispensado). */
  live?: boolean;
  /** Guarda o botão "Remover", para o foco ir ao próximo depois de remover. */
  registerRemove: (id: number, node: HTMLButtonElement | null) => void;
  onPickOffset?: (minutes: number) => void;
  /** Salva logo a escolha (ao sair do campo, com o próximo foco, ou com Enter). */
  onCommitOffset?: (next: Element | null) => void;
  onDelete: () => void;
  onDismiss?: () => void;
  onOpenEvent: (id: number) => void;
}) {
  const removeRef = useRef<HTMLButtonElement | null>(null);
  // a troca vale enquanto o lembrete ainda tem a antecedência de antes
  const changing = Boolean(change && change.from === reminder.offsetMinutes);
  // antecedência mostrada no select: a escolhida (ainda não salva ou salvando) ou a do lembrete
  const offset = draft ?? (changing && change ? change.to : reminder.offsetMinutes);
  const event = reminder.academicEvent ?? null;
  const meta = event ? categoryMeta[event.category] : null;
  const title = event?.title ?? `Evento #${reminder.academicEventId}`;
  const start = event ? new Date(event.startsAt).getTime() : null;
  const eventAhead = start !== null && start > now;
  const noLonger = voidReason(reminder);
  const status = event && noLonger ? statusMeta[event.status] : null;
  const StatusIcon = status?.icon;
  // evento cancelado ou concluído, ou aviso que já saiu: não há mais aviso para adiantar ou atrasar
  const canChange = kind === "pending" && Boolean(onPickOffset) && eventAhead && !noLonger;
  const RowIcon = kind === "past" ? Check : kind === "void" ? BellOff : Bell;
  const options = reminderOptions.some((option) => Number(option.value) === offset)
    ? reminderOptions
    : [...reminderOptions, { value: String(offset), label: reminderOffsetLabel(offset) }].sort((a, b) => Number(a.value) - Number(b.value));

  return (
    <li className={cx("rem-row", kind !== "pending" && kind)} data-reminder={reminder.id}>
      <span className="rem-ico" aria-hidden>
        <RowIcon className="h-[18px] w-[18px]" />
      </span>
      <div className="rem-body">
        <div className="rem-head">
          {meta ? <span className={cx("pill", meta.tint)}>{meta.short}</span> : null}
          {status && StatusIcon ? (
            <span className={cx("pill", status.pill)}>
              <StatusIcon className="h-3 w-3" aria-hidden />
              {status.label}
            </span>
          ) : null}
          {event ? (
            <button className="rem-title" data-part="title" data-opens-event={event.id} onClick={() => onOpenEvent(event.id)} type="button">
              <span className={cx("line-clamp-2 wrap-anywhere", event.status === "cancelled" && "text-muted line-through")}>{event.title}</span>
            </button>
          ) : (
            <span className="rem-title">{title}</span>
          )}
        </div>
        <div className="ev-meta">
          {event ? (
            <span className="rem-meta-i">
              <CalendarDays aria-hidden />
              {eventWhen(event)}
              {eventAhead ? ` (${relativeDue(event.startsAt)})` : ""}
            </span>
          ) : null}
          {noLonger ? (
            <span className="rem-meta-i">
              <BellOff aria-hidden />
              {noLonger}
            </span>
          ) : (
            <span className="rem-meta-i">
              <Bell aria-hidden />
              {kind === "past" ? "Avisado" : "Aviso"} {sendWhen(reminder.sendAt, now)}
              {/* a antecedência que já saiu fica só como texto */}
              {kind === "past" || !canChange ? `, ${reminderOffsetLabel(reminder.offsetMinutes)}` : ""}
            </span>
          )}
          {changing ? (
            <span role="status" className="rem-meta-i text-ink-3">
              <Loader2 className="animate-spin" aria-hidden />
              Salvando
            </span>
          ) : null}
        </div>
      </div>

      <div className="rem-acts">
        {live ? (
          <span className="pill stat rem-live">
            <BellRing className="h-3 w-3" aria-hidden />
            Avisando agora
          </span>
        ) : null}
        {canChange ? (
          // sem disabled enquanto salva: o foco fica no campo, e a escolha seguinte espera a vez
          <select
            className="rem-offset"
            data-part="offset"
            aria-label={`Antecedência do aviso de ${title}`}
            value={String(offset)}
            onChange={(pick) => onPickOffset?.(Number(pick.target.value))}
            onBlur={(blur) => onCommitOffset?.(blur.relatedTarget)}
            onKeyDown={(key) => {
              // Enter só confirma (salva logo a escolha). Sem o preventDefault, o Chrome do Windows e do
              // Linux também abriria a lista, que abre com espaço, Alt+seta para baixo ou clique.
              if (key.key === "Enter") {
                key.preventDefault();
                onCommitOffset?.(key.currentTarget);
              }
            }}
          >
            {options.map((option) => {
              const minutes = Number(option.value);
              // antecedência que já passou não serve para um aviso novo
              const late = start !== null && start - minutes * 60000 <= now && minutes !== offset;
              return (
                <option key={option.value} value={option.value} disabled={late}>
                  {option.label}
                </option>
              );
            })}
          </select>
        ) : null}
        {live && onDismiss ? (
          <button
            className="btn btn-g btn-sm"
            data-part="dismiss"
            aria-label={`Dispensar o aviso de ${title}`}
            onClick={() => {
              onDismiss();
              // o Dispensar sai com o aviso: o foco fica no Remover da mesma linha
              window.requestAnimationFrame(() => removeRef.current?.focus());
            }}
            type="button"
          >
            Dispensar
          </button>
        ) : null}
        <button
          ref={(node) => {
            removeRef.current = node;
            registerRemove(reminder.id, node);
          }}
          className="btn btn-danger btn-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
          data-part="remove"
          aria-label={`Remover lembrete de ${title}`}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) {
              onDelete();
            }
          }}
          type="button"
        >
          <BellOff className="h-3.5 w-3.5" aria-hidden />
          Remover
        </button>
      </div>
    </li>
  );
}

export function RemindersView({
  reminders,
  saving,
  avisos,
  defaultReminderMinutes,
  upcomingEvents,
  onChangeOffset,
  onDelete,
  onDismissAviso,
  onOpenCalendar,
  onOpenEvent,
  onOpenProfile,
  onQuickReminder,
}: {
  reminders: Reminder[];
  saving: boolean;
  /** Lembretes cuja hora chegou e ainda não foram dispensados. */
  avisos?: Reminder[];
  /** Antecedência padrão do usuário (card "Padrão para novos lembretes" e o "Lembrar 1 dia antes"). */
  defaultReminderMinutes?: number;
  upcomingEvents?: AcademicEvent[];
  onChangeOffset?: (reminder: Reminder, minutes: number) => void | Promise<unknown>;
  onDelete: (reminder: Reminder) => void;
  onDismissAviso?: (reminderId: number) => void;
  onOpenCalendar?: (filter?: { categories?: Category[] }) => void;
  onOpenEvent: (id: number) => void;
  onOpenProfile?: () => void;
  onQuickReminder?: (event: AcademicEvent) => void | Promise<unknown>;
}) {
  const baseId = useId();
  const pendId = `${baseId}-aguardando`;
  const pastId = `${baseId}-avisados`;
  const startId = `${baseId}-comeco`;
  const pendListId = `${baseId}-aguardando-lista`;
  const pastListId = `${baseId}-avisados-lista`;
  const drawerListId = `${baseId}-todos-lista`;
  const prefId = `${baseId}-padrao`;
  const monthsId = `${baseId}-meses`;
  const howId = `${baseId}-como`;
  const tabIds: Record<TabKey, string> = {
    pending: `${baseId}-aba-aguardando`,
    past: `${baseId}-aba-avisados`,
    void: `${baseId}-aba-cancelados`,
  };
  const panelId = `${baseId}-aba-painel`;
  const shownAvisos = avisos ?? [];
  const avisoKeys = shownAvisos.map(avisoKey);
  const liveKeys = new Set(avisoKeys);

  const [now, setNow] = useState(() => Date.now());
  // antecedência salvando: { de, para }
  const [pending, setPending] = useState<Record<number, { from: number; to: number }>>({});
  // antecedência escolhida e ainda não salva (o select já mostra): vai para a página depois de
  // OFFSET_SAVE_DELAY sem nova troca, ao sair do campo ou com Enter, uma de cada vez
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  const [quickId, setQuickId] = useState<number | null>(null);
  // painel "Todos os lembretes": a aba e o mês escolhidos (null: todos os meses); opened conta as aberturas,
  // para o painel sempre abrir na página 1
  const [drawer, setDrawer] = useState<{ open: boolean; tab: TabKey; month: number | null; opened: number }>({
    open: false,
    tab: "pending",
    month: null,
    opened: 0,
  });
  // avisos que já apareceram com a tela aberta: dispensado, o lembrete continua em "Já avisados"
  const [seenAvisos, setSeenAvisos] = useState(avisoKeys);
  const unseen = avisoKeys.filter((key) => !seenAvisos.includes(key));
  if (unseen.length) {
    setSeenAvisos([...seenAvisos, ...unseen]);
  }
  // quando a página termina de salvar, some o "Salvando" (mesmo se a troca falhou)
  const [wasSaving, setWasSaving] = useState(saving);
  if (wasSaving !== saving) {
    setWasSaving(saving);
    if (!saving) {
      setPending({});
      setQuickId(null);
    }
  }
  // antecedência que a página está salvando ({ lembrete, antecedência nova, controle com o foco }), até o
  // lembrete voltar salvo
  const [landing, setLanding] = useState<{ id: number; to: number; part: string | null } | null>(null);
  // no painel "Todos os lembretes": a linha que mudou de lugar ao salvar, para a página dela abrir e o foco ir junto
  const [follow, setFollow] = useState<{ id: number; part: string | null } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const pendRef = useRef<HTMLElement>(null);
  const pendTitleRef = useRef<HTMLHeadingElement>(null);
  const pastTitleRef = useRef<HTMLHeadingElement>(null);
  const startTitleRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef(new Map<TabKey, HTMLButtonElement>());
  // a aba escolhida: o foco entra nela quando o painel abre
  const drawerFocusRef = useRef<HTMLButtonElement | null>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const removing = useRef<{ id: number; order: number[]; list: TabKey; scope: Scope } | null>(null);
  // controle de linha com o foco quando uma antecedência foi salva (saved: o lembrete salvo; place: onde a
  // linha estava, para saber se ela mudou de lugar; scrolled: a pessoa rolou a página por conta própria)
  const restore = useRef<{ saved: number; id: number; part: string; place: string | null; scrolled: boolean } | null>(null);
  // evento cujo lembrete a sugestão está criando
  const createdFor = useRef<number | null>(null);
  const commitRef = useRef<(only?: number, next?: Element | null) => void>(() => undefined);
  const mainColRef = useRef<HTMLDivElement>(null);
  const lastPage = useRef(1);

  // o "Aviso hoje", as opções que já passaram e as sugestões andam com o relógio
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK);
    return () => window.clearInterval(timer);
  }, []);

  const { voided, upcoming, past } = reminderLists(reminders, avisos ? new Set([...seenAvisos, ...avisoKeys]) : null, now);
  const next = upcoming.find((reminder) => reminder.enabled) ?? null;
  const hasAny = reminders.length > 0;
  const upcomingMonths = monthsOf(upcoming);

  // painel "Todos os lembretes": a lista da aba, filtrada pelo mês, uma página por vez. A aba dos cancelados
  // some quando fica vazia (todos removidos): o painel volta para "Aguardando aviso"
  const tab: TabKey = drawer.tab === "void" && !voided.length ? "pending" : drawer.tab;
  const tabList = tab === "past" ? past : tab === "void" ? voided : upcoming;
  const tabMonths = monthsOf(tabList);
  // short: o nome curto, para as três abas caberem numa linha no celular
  const tabs: { key: TabKey; label: string; short: string; count: number }[] = [
    { key: "pending", label: "Aguardando aviso", short: "Aguardando", count: upcoming.length },
    { key: "past", label: "Já avisados", short: "Avisados", count: past.length },
    ...(voided.length ? [{ key: "void" as const, label: "Cancelados", short: "Cancelados", count: voided.length }] : []),
  ];
  // o mês escolhido pode ter ficado vazio (lembretes removidos): volta para todos os meses
  const month = drawer.month !== null && tabMonths.some((item) => item.key === drawer.month) ? drawer.month : null;
  const drawerItems = month === null ? tabList : tabList.filter((reminder) => monthOf(reminder) === month);
  const paged = usePaged(drawerItems, DRAWER_PAGE, `${drawer.opened}|${tab}|${month ?? "todos"}`);

  const { sideRef, mainGapRef, sideGapRef, extraRef, extraKind, stuck } = useSideFit(
    mainColRef,
    `${hasAny}|${upcoming.length}|${past.length > 0}|${upcomingMonths.length}`
  );

  // o lembrete voltou salvo. No painel, se a linha mudou de aba, de mês ou de página, o painel vai atrás dela
  if (landing) {
    const saved = reminders.find((reminder) => reminder.id === landing.id);
    if (saved?.offsetMinutes === landing.to) {
      setLanding(null);
      if (drawer.open) {
        const list: ListKey = past.includes(saved) ? "past" : "pending";
        const savedMonth = monthOf(saved);
        setDrawer({ ...drawer, tab: list, month: drawer.month === null || drawer.month === savedMonth ? drawer.month : savedMonth });
        setFollow({ id: saved.id, part: landing.part });
      }
    } else if (wasSaving && !saving) {
      setLanding(null);
    }
  }

  // a linha que o painel segue: a página dela abre (ela pode ter ido para outra página ao salvar)
  if (follow && drawer.open) {
    const at = drawerItems.findIndex((reminder) => reminder.id === follow.id);
    if (at < 0) {
      setFollow(null);
    } else if (Math.floor(at / DRAWER_PAGE) + 1 !== paged.page) {
      paged.setPage(Math.floor(at / DRAWER_PAGE) + 1);
    }
  }

  const upcomingShown = upcoming.slice(0, PREVIEW);
  const pastShown = past.slice(0, PREVIEW);

  // como o "Próxima avaliação" de Notas ("seg, 23/11"): o dia da semana em minúscula, igual às linhas
  const nextLabel = next ? sendWhen(next.sendAt, now) : null;
  const nextTitle = next ? (next.academicEvent?.title ?? `Evento #${next.academicEventId}`) : null;
  const liveCount = past.filter((reminder) => liveKeys.has(avisoKey(reminder))).length;

  // sugestão só de evento que ainda aceita lembrete: o aviso de 15 minutos antes ainda cai no futuro (com folga)
  const soon = now + SUGGEST_MARGIN;
  const reminderEventIds = new Set(reminders.map((reminder) => reminder.academicEventId));
  const suggestions = (upcomingEvents ?? [])
    .filter(
      (event) =>
        (event.category === "exam" || event.category === "assignment") &&
        event.status !== "cancelled" &&
        event.status !== "completed" &&
        !reminderEventIds.has(event.id) &&
        !event.reminder &&
        new Date(event.startsAt).getTime() - MIN_OFFSET * 60000 > soon
    )
    .slice(0, 3);

  // depois de remover, o foco vai para o próximo "Remover" da mesma lista (ou para o título dela, ou para a aba)
  useEffect(() => {
    const target = removing.current;
    if (!target || reminders.some((reminder) => reminder.id === target.id)) {
      return;
    }
    removing.current = null;
    const at = target.order.indexOf(target.id);
    const rest = target.order.filter((id) => id !== target.id && removeButtons.current.has(`${target.scope}:${id}`));
    const nextId = rest[Math.min(at, rest.length - 1)];
    const fallback =
      target.scope === "drawer"
        ? tabRefs.current.get(target.list)
        : ((target.list === "past" ? pastTitleRef.current : pendTitleRef.current) ?? pendTitleRef.current ?? startTitleRef.current);
    // a aba dos cancelados some quando o último sai: o foco vai para a primeira aba
    const fallbackTarget = fallback ?? (target.scope === "drawer" ? tabRefs.current.get("pending") : undefined);
    (nextId !== undefined ? removeButtons.current.get(`${target.scope}:${nextId}`) : fallbackTarget)?.focus();
  }, [reminders]);

  // terminou de salvar e o lembrete continua na lista: a remoção falhou, o foco fica onde está
  useEffect(() => {
    if (!saving) {
      removing.current = null;
    }
  }, [saving]);

  // antecedência salva: a lista segue a hora do aviso, e a linha pode mudar de lugar ou de lista.
  // Se o foco se perdeu no caminho, ele volta para o mesmo controle da linha (ou para o título da lista
  // em que ela ficou), e não para o início da página. Se a linha mudou de lugar com o foco nela, o React
  // devolve o foco ao controle, mas deixa a página onde estava: aí a página rola até a linha.
  useEffect(() => {
    const target = restore.current;
    if (!target) {
      return;
    }
    const root = drawer.open ? drawerRef.current : rootRef.current;
    const rowNode = root?.querySelector(`[data-reminder="${target.id}"]`);
    const active = document.activeElement;
    if (!active || active === document.body) {
      const control = rowNode?.querySelector<HTMLElement>(`[data-part="${target.part}"]`) ?? firstControl(rowNode);
      const moved = reminders.find((reminder) => reminder.id === target.id);
      const list: ListKey = moved && new Date(moved.sendAt).getTime() <= now ? "past" : "pending";
      const title = drawer.open ? tabRefs.current.get(list) : list === "past" ? pastTitleRef.current : pendTitleRef.current;
      (control ?? title)?.focus({ preventScroll: target.scrolled });
    } else if (rowNode?.contains(active)) {
      const place = rowPlace(rowNode);
      if (place !== target.place) {
        target.place = place;
        if (!target.scrolled) {
          // a linha inteira à vista e, por fim, o controle com o foco (as folgas dele no globals.css)
          rowNode.scrollIntoView({ block: "nearest" });
          active.scrollIntoView({ block: "nearest" });
        }
      }
    }
    if (!pending[target.saved]) {
      restore.current = null;
    }
  }, [reminders, pending, now, drawer.open]);

  // no painel: a linha salva está à vista (a página dela já abriu): o foco vai para o mesmo controle dela
  useEffect(() => {
    if (!follow || !drawer.open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const rowNode = drawerRef.current?.querySelector(`[data-reminder="${follow.id}"]`);
      if (!rowNode) {
        return;
      }
      const control =
        (follow.part ? rowNode.querySelector<HTMLElement>(`[data-part="${follow.part}"]`) : null) ?? firstControl(rowNode);
      if (control && control !== document.activeElement) {
        control.focus({ preventScroll: true });
        rowNode.scrollIntoView({ block: "nearest" });
      }
      setFollow(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [follow, drawer.open, paged.page]);

  // trocou de página no painel: a lista volta ao alto (o Pager leva o foco para o começo dela)
  useEffect(() => {
    if (paged.page !== lastPage.current) {
      lastPage.current = paged.page;
      drawerPanelRef.current?.closest(".drawer-body")?.scrollTo({ top: 0 });
    }
  }, [paged.page]);

  // um clique ou toque da pessoa enquanto salva vale mais que a volta do foco; se ela rolou a página
  // com a roda do mouse, o foco ainda volta, mas a página não é puxada de volta até a linha
  useEffect(() => {
    const cancel = () => {
      restore.current = null;
    };
    const scrolled = () => {
      if (restore.current) {
        restore.current.scrolled = true;
      }
    };
    document.addEventListener("pointerdown", cancel, true);
    window.addEventListener("wheel", scrolled, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("wheel", scrolled);
    };
  }, []);

  // lembrete criado pela sugestão: o bloco das sugestões sai da tela e o foco vai para a linha nova
  useEffect(() => {
    const eventId = createdFor.current;
    if (eventId === null) {
      return;
    }
    const created = reminders.find((reminder) => reminder.academicEventId === eventId);
    if (created) {
      createdFor.current = null;
      const rowNode = pendRef.current?.querySelector(`[data-reminder="${created.id}"]`);
      (firstControl(rowNode) ?? pendTitleRef.current)?.focus();
    } else if (quickId === null) {
      // terminou sem lembrete novo (erro): o foco segue no botão da sugestão
      createdFor.current = null;
    }
  }, [reminders, quickId]);

  // a escolha sem nova troca vai para a página; enquanto ela salva outra coisa, a escolha espera a vez
  useEffect(() => {
    if (saving || !Object.keys(drafts).length) {
      return;
    }
    const timer = window.setTimeout(() => commitRef.current(), OFFSET_SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [drafts, saving]);

  // o temporizador usa a função do render de agora (lembretes e escolhas atuais)
  useLayoutEffect(() => {
    commitRef.current = commitDraft;
  });

  function clearPending(id: number, minutes: number) {
    setPending((current) => {
      if (current[id]?.to !== minutes) {
        return current;
      }
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
  }

  async function changeOffset(reminder: Reminder, minutes: number) {
    if (!onChangeOffset || minutes === reminder.offsetMinutes) {
      return;
    }
    setPending((current) => ({ ...current, [reminder.id]: { from: reminder.offsetMinutes, to: minutes } }));
    const result = onChangeOffset(reminder, minutes);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      try {
        await result;
      } finally {
        clearPending(reminder.id, minutes);
      }
    } else {
      // sem promessa: o "Salvando" some quando a página termina de salvar ou, no máximo, em 10 s
      window.setTimeout(() => clearPending(reminder.id, minutes), 10000);
    }
  }

  function pickOffset(reminder: Reminder, minutes: number) {
    setDrafts((current) => ({ ...current, [reminder.id]: minutes }));
  }

  /**
   * Salva a escolha de um lembrete (only) ou a primeira que espera. next: o controle que vai receber o
   * foco (ao sair do campo); sem ele, vale o foco de agora. A página salva uma coisa por vez.
   */
  function commitDraft(only?: number, next?: Element | null) {
    const id = only ?? Number(Object.keys(drafts)[0]);
    const minutes = drafts[id];
    if (saving || minutes === undefined) {
      return;
    }
    setDrafts((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    const reminder = reminders.find((item) => item.id === id);
    if (!reminder || minutes === reminder.offsetMinutes) {
      return;
    }
    // controle de linha com o foco (o select ou o próximo): ele volta se a linha mudar de lugar
    const focused = (next ?? document.activeElement) as HTMLElement | null;
    const focusedRow = focused?.closest?.("[data-reminder]");
    restore.current =
      focusedRow && focused?.dataset.part
        ? {
            saved: id,
            id: Number(focusedRow.getAttribute("data-reminder")),
            part: focused.dataset.part,
            place: rowPlace(focusedRow),
            scrolled: false,
          }
        : null;
    setLanding({ id, to: minutes, part: focusedRow && Number(focusedRow.getAttribute("data-reminder")) === id ? (focused?.dataset.part ?? null) : null });
    void changeOffset(reminder, minutes);
  }

  async function quickRemind(event: AcademicEvent) {
    if (!onQuickReminder || quickId !== null || saving) {
      return;
    }
    setQuickId(event.id);
    createdFor.current = event.id;
    const result = onQuickReminder(event);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      try {
        await result;
      } finally {
        setQuickId(null);
      }
    } else {
      window.setTimeout(() => setQuickId((current) => (current === event.id ? null : current)), 10000);
    }
  }

  function registerRemove(scope: Scope, id: number, node: HTMLButtonElement | null) {
    if (node) {
      removeButtons.current.set(`${scope}:${id}`, node);
    } else {
      removeButtons.current.delete(`${scope}:${id}`);
    }
  }

  /** Remove e guarda a ordem da lista à vista, para o foco ir ao próximo "Remover" dela. */
  function removeReminder(reminder: Reminder, list: TabKey, scope: Scope) {
    const shown = scope === "drawer" ? paged.items : list === "past" ? pastShown : upcomingShown;
    removing.current = { id: reminder.id, order: shown.map((item) => item.id), list, scope };
    onDelete(reminder);
  }

  function openDrawer(tabKey: TabKey, monthKey: number | null = null) {
    setDrawer((current) => ({ open: true, tab: tabKey, month: monthKey, opened: current.opened + 1 }));
  }

  function closeDrawer() {
    setDrawer((current) => ({ ...current, open: false }));
  }

  function chooseTab(tabKey: TabKey) {
    setDrawer((current) => ({ ...current, tab: tabKey, month: null }));
  }

  // abas com as setas, Home e End (o foco anda junto com a escolha)
  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const order = tabs.map((item) => item.key);
    const at = order.indexOf(tab);
    let target: TabKey | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      target = order[(at + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
    } else if (event.key === "Home") {
      target = order[0];
    } else if (event.key === "End") {
      target = order[order.length - 1];
    }
    if (target) {
      event.preventDefault();
      chooseTab(target);
      tabRefs.current.get(target)?.focus();
    }
  }

  function row(reminder: Reminder, kind: RowKind, list: TabKey, scope: Scope) {
    const changeable = kind === "pending" && onChangeOffset;
    const live = kind === "past" && liveKeys.has(avisoKey(reminder));
    return (
      <ReminderRow
        key={reminder.id}
        reminder={reminder}
        kind={kind}
        now={now}
        busy={saving}
        change={pending[reminder.id]}
        draft={drafts[reminder.id]}
        live={live}
        registerRemove={(id, node) => registerRemove(scope, id, node)}
        onPickOffset={changeable ? (minutes) => pickOffset(reminder, minutes) : undefined}
        onCommitOffset={changeable ? (nextFocus) => commitDraft(reminder.id, nextFocus) : undefined}
        onDelete={() => removeReminder(reminder, list, scope)}
        onDismiss={live && onDismissAviso ? () => onDismissAviso(reminder.id) : undefined}
        onOpenEvent={onOpenEvent}
      />
    );
  }

  /** "Ver todos (22)": abre o painel "Todos os lembretes" na aba da lista. */
  function moreButton(list: ListKey, count: number) {
    if (count <= PREVIEW) {
      return null;
    }
    return (
      <div className="rem-foot">
        <button className="btn btn-s btn-sm" aria-haspopup="dialog" onClick={() => openDrawer(list)} type="button">
          Ver todos ({count})
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  // as próximas provas e trabalhos, cada uma com o botão de lembrar na ponta da linha
  const suggestionsOf = (list: AcademicEvent[]) =>
    list.length && onQuickReminder ? (
      <div className="rem-sugg">
        <p className="rem-sugg-t">Próximas provas e trabalhos</p>
        <ul className="rem-sugg-list">
          {list.map((event) => {
            const minutes = defaultReminderMinutes ? quickOffset(event, defaultReminderMinutes, soon) : null;
            const label = minutes ? `Lembrar ${reminderOffsetLabel(minutes)}` : "Ativar lembrete";
            const meta = categoryMeta[event.category];
            const start = new Date(event.startsAt);
            return (
              <li key={event.id} className="rem-sugg-row">
                <span className="rem-sugg-date" aria-hidden>
                  <span className="dw">{start.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span>
                  <span className="dn">{String(start.getDate()).padStart(2, "0")}</span>
                  <span className="dm">{start.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="rem-sugg-title wrap-anywhere">{event.title}</p>
                  <p className="rem-sugg-meta">
                    <span className={cx("pill", meta.tint)}>{meta.short}</span>
                    {suggestionWhen(event)}
                  </p>
                </div>
                <button
                  className="btn btn-s btn-sm shrink-0"
                  aria-label={`${label}: ${event.title}`}
                  aria-busy={quickId === event.id || undefined}
                  aria-disabled={quickId !== null || saving || undefined}
                  onClick={() => void quickRemind(event)}
                  type="button"
                >
                  {quickId === event.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Bell className="h-3.5 w-3.5" aria-hidden />}
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    ) : null;
  const suggestionBlock = suggestionsOf(suggestions);

  // índice por mês só quando há lembretes fora da tela: com todos à vista em "Aguardando aviso", ele só repetiria
  // os mesmos itens ao lado (decisão 13)
  const showMonths = hasAny && upcoming.length > PREVIEW;
  // "Aguardando aviso" cheio (os PREVIEW lembretes, nenhum fora da tela): ganha uma sugestão, a lista não fica
  // longa. Com menos lembretes, as sugestões vão todas
  const pendSuggestions =
    upcoming.length < PREVIEW
      ? suggestionBlock
      : upcoming.length === PREVIEW
        ? suggestionsOf(suggestions.slice(0, FULL_SUGGESTIONS))
        : null;
  // "Como funciona" no card próprio da coluna lateral (sem lembrete nenhum e com avaliações a sugerir)
  const howBeside = !hasAny && suggestionBlock !== null;
  // com lembretes, a lateral só com o "Padrão" pode ficar bem mais baixa que "Aguardando aviso" (sugestões, mais
  // linhas ou "Já avisados" embaixo). Aí entra no mesmo card do padrão o bloco que deixa as colunas mais perto de
  // terminar juntas (useSideFit mede): o curto, com o caminho para lembrar de outro evento (uns 100 px), ou os
  // passos de "Como funciona" (uns 230 px). Nunca estica card (decisão 5)
  const sideExtra: SideExtra = hasAny && !showMonths ? extraKind : "none";

  // os três passos de "Como funciona"; "rem-steps-row" põe os três lado a lado (dentro do card de começo)
  const howSteps = (row: boolean) => (
    <ol className={cx("rem-steps", row && "rem-steps-row")}>
      <li>
        <span className="rem-step-n" aria-hidden>
          1
        </span>
        <span>
          Abra um evento no cronograma e use <b>Ativar lembrete</b>.
        </span>
      </li>
      <li>
        <span className="rem-step-n" aria-hidden>
          2
        </span>
        <span>Escolha a antecedência, de 15 minutos a 7 dias.</span>
      </li>
      <li>
        <span className="rem-step-n" aria-hidden>
          3
        </span>
        <span>
          Na hora marcada, o aviso aparece no Painel e aqui, e chega no seu <span className="whitespace-nowrap">e-mail</span>.
        </span>
      </li>
    </ol>
  );

  // o padrão (antecedência e canal) e o botão do perfil: no card próprio, ou no fim do "Como funciona" ao lado
  const prefLines = (
    <>
      <dl className="info mt-[18px]">
        <InfoLine icon={Clock} label={howBeside ? "Padrão" : "Antecedência"} value={reminderOffsetLabel(defaultReminderMinutes ?? 1440)} />
        <InfoLine icon={Bell} label="Canal" value="No sistema e no e-mail" />
      </dl>
      {onOpenProfile ? (
        <button className="btn btn-s mt-[18px] w-full" onClick={onOpenProfile} type="button">
          <Settings2 className="h-4 w-4" aria-hidden />
          Alterar no perfil
        </button>
      ) : null}
    </>
  );

  const prefCard = howBeside ? null : (
    <section className="card pad rise rem-grow" style={delay(6)} aria-labelledby={prefId}>
      <h2 className="h2" id={prefId}>
        Padrão para novos lembretes
      </h2>
      {prefLines}
      {sideExtra === "long" ? (
        <div ref={extraRef} data-extra="long" className="rem-how">
          <h3 className="rem-how-t">Como funciona</h3>
          {howSteps(false)}
        </div>
      ) : sideExtra === "short" ? (
        <div ref={extraRef} data-extra="short" className="rem-how">
          <p className="rem-how-s">
            <b>Outro evento?</b> Abra no cronograma e use <b>Ativar lembrete</b>.
          </p>
          {onOpenCalendar ? (
            <button className="btn btn-s btn-sm mt-3" onClick={() => onOpenCalendar()} type="button">
              <CalendarDays className="h-4 w-4" aria-hidden />
              Ver cronograma
            </button>
          ) : null}
        </div>
      ) : null}
      {/* fica com a sobra (no máximo STRETCH_MAX) quando a coluna estica para terminar junto da principal */}
      {showMonths ? null : <div ref={sideGapRef} className="tela-gap" aria-hidden />}
    </section>
  );

  // sem nenhum lembrete e com as próximas avaliações no card de começo: os passos vão para a coluna lateral, um
  // embaixo do outro, num card só com o padrão (antecedência, canal e "Alterar no perfil"). Dois cards na lateral
  // passavam uns 100 px do card de começo, que esticava com um buraco embaixo da lista (decisão 5).
  // Sem avaliações, o card de começo é baixo: os passos ficam nele, lado a lado, e a lateral só tem o "Padrão"
  const howCard = howBeside ? (
    <section className="card pad rise rem-grow rem-how-card" style={delay(6)} aria-labelledby={howId}>
      <h2 className="h2" id={howId}>
        Como funciona
      </h2>
      {howSteps(false)}
      <div className="rem-how-pref">{prefLines}</div>
      <div ref={sideGapRef} className="tela-gap" aria-hidden />
    </section>
  ) : null;

  // índice por mês dos próximos avisos: cada mês abre o painel "Todos os lembretes" já nele
  const monthsCard = showMonths ? (
      <section className="card pad rise rem-grow" style={delay(7)} aria-labelledby={monthsId}>
        <h2 className="h2" id={monthsId}>
          Avisos por mês
        </h2>
        <p className="sub">Os que ainda vão sair, pela data do aviso.</p>
        <ul className="rem-months">
          {upcomingMonths.slice(0, MONTHS_SHOWN).map((item) => {
            const name = monthName(item.key, now);
            const count = countText(item.count, "aviso", "avisos");
            return (
              <li key={item.key}>
                <button
                  className="rem-mrow"
                  aria-haspopup="dialog"
                  aria-label={`${name}: ${count}. Ver no painel de todos os lembretes`}
                  onClick={() => openDrawer("pending", item.key)}
                  type="button"
                >
                  <CalendarDays className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="c">{count}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        {upcomingMonths.length > MONTHS_SHOWN ? (
          <button className="btn btn-g btn-sm mt-2 self-start" aria-haspopup="dialog" onClick={() => openDrawer("pending")} type="button">
            Mais {countText(upcomingMonths.length - MONTHS_SHOWN, "mês", "meses")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <div ref={sideGapRef} className="tela-gap" aria-hidden />
      </section>
    ) : null;

  // sem nenhum lembrete: o card de começo (o que fazer e as próximas avaliações); o "Como funciona" fica ao lado
  const startCard = (
    <section className="card pad rise rem-grow rem-start" style={delay(1)} aria-labelledby={startId}>
      <div className="rem-start-head">
        <span className="empty-ico" aria-hidden>
          <Bell className="h-6 w-6" />
        </span>
        <div className="rem-start-txt">
          <h2 ref={startTitleRef} id={startId} tabIndex={-1} className="h2 outline-none">
            Nenhum lembrete ativo
          </h2>
          <p className="sub">
            {suggestionBlock
              ? "Ative um lembrete nas próximas avaliações ou em qualquer evento do cronograma."
              : "Abra um evento no cronograma e ative um lembrete pessoal."}
          </p>
        </div>
        {!suggestionBlock && onOpenCalendar ? (
          <button className="btn btn-p rem-start-btn" onClick={() => onOpenCalendar()} type="button">
            Ver cronograma
          </button>
        ) : null}
      </div>
      {suggestionBlock ? <div className="mt-5">{suggestionBlock}</div> : null}
      {howBeside ? null : (
        <div className="rem-how">
          <h3 className="rem-how-t">Como funciona</h3>
          {howSteps(true)}
        </div>
      )}
      <div ref={mainGapRef} className="tela-gap" aria-hidden />
    </section>
  );

  const pendCard = (
    <section ref={pendRef} className={cx("card pad rise rem-pend", !past.length && "rem-grow")} style={delay(4)} aria-labelledby={pendId}>
      <h2 ref={pendTitleRef} id={pendId} tabIndex={-1} className="h2 outline-none">
        Aguardando aviso
      </h2>
      {upcoming.length > PREVIEW ? <p className="sub">Os {PREVIEW} mais próximos, de {upcoming.length}.</p> : null}
      <div className="rem-pend-body mt-4">
        {upcomingShown.length ? (
          <>
            <ul id={pendListId} className="rem-list">
              {upcomingShown.map((reminder) => row(reminder, "pending", "pending", "page"))}
            </ul>
            {/* poucos lembretes: as avaliações que ainda estão sem lembrete, logo embaixo, a um toque */}
            {pendSuggestions}
          </>
        ) : (
          <div className="rem-empty">
            <div className="rem-empty-head">
              <span className="empty-ico" aria-hidden>
                <Bell className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="rem-empty-t">Nenhum aviso por vir</p>
                <p className="rem-empty-s">
                  {suggestionBlock
                    ? "Ative um lembrete nas próximas avaliações ou abra um evento no cronograma."
                    : "Abra um evento no cronograma e ative um lembrete pessoal."}
                </p>
              </div>
              {!suggestionBlock && onOpenCalendar ? (
                <button className="btn btn-s btn-sm shrink-0" onClick={() => onOpenCalendar()} type="button">
                  Ver cronograma
                </button>
              ) : null}
            </div>
            {suggestionBlock}
          </div>
        )}
      </div>
      {moreButton("pending", upcoming.length)}
        {/* lembretes de eventos cancelados ou concluídos: uma linha só, com quantos são; a lista fica no painel */}
        {voided.length ? (
          <div className="rem-void-sum">
            <span className="rem-ico" aria-hidden>
              <BellOff className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="rem-void-t">
                {countText(voided.length, "lembrete de evento cancelado ou concluído", "lembretes de eventos cancelados ou concluídos")}
              </p>
              <p className="rem-void-s">{voided.length === 1 ? "O aviso dele não sai mais." : "Os avisos deles não saem mais."}</p>
            </div>
            <button className="btn btn-s btn-sm shrink-0" aria-haspopup="dialog" onClick={() => openDrawer("void")} type="button">
              {voided.length === 1 ? "Ver e remover" : `Ver todos (${voided.length})`}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : null}
      {!past.length ? <div ref={mainGapRef} className="tela-gap" aria-hidden /> : null}
    </section>
  );

  const pastCard = past.length ? (
    <section className="card pad rise rem-grow rem-past" style={delay(5)} aria-labelledby={pastId}>
      <h2 ref={pastTitleRef} id={pastId} tabIndex={-1} className="h2 outline-none">
        Já avisados
      </h2>
      <p className="sub">O aviso fica no Painel até o evento começar ou até você dispensar.</p>
      <ul id={pastListId} className="rem-list mt-4">
        {pastShown.map((reminder) => row(reminder, "past", "past", "page"))}
      </ul>
      {moreButton("past", past.length)}
      <div ref={mainGapRef} className="tela-gap" aria-hidden />
    </section>
  ) : null;

  // os itens da página do painel em grupos por mês, cada um com o nome do mês e quantos lembretes ele tem
  const drawerGroups: { key: number; items: Reminder[] }[] = [];
  for (const reminder of paged.items) {
    const key = monthOf(reminder);
    const last = drawerGroups[drawerGroups.length - 1];
    if (last?.key === key) {
      last.items.push(reminder);
    } else {
      drawerGroups.push({ key, items: [reminder] });
    }
  }


  return (
    <div ref={rootRef} className="grid gap-5">
      {/* os avisos do sistema (os dos lembretes ficam na própria linha, em "Já avisados", com Dispensar) */}
      <AvisosCard avisos={[]} events={upcomingEvents} fallbackFocus={() => pendTitleRef.current ?? startTitleRef.current} onOpen={onOpenEvent} />

      {hasAny ? (
        <div className="kpis rem-kpis">
          <InsightTile icon={Clock} label="Aguardando aviso" value={String(upcoming.length)} tone="c-ativ" hint="um lembrete por evento" order={1} />
          <InsightTile
            icon={CircleCheckBig}
            label="Já avisados"
            value={String(past.length)}
            hint={
              liveCount
                ? countText(liveCount, "ainda no Painel", "ainda no Painel")
                : past.length
                  ? "a hora do aviso já passou"
                  : "nenhum aviso saiu ainda"
            }
            order={2}
          />
          <div className="card kpi rise rem-next" style={delay(3)}>
            <div className="kpi-top">
              <p className="kpi-label">Próximo aviso</p>
              <span className="kpi-ico">
                <Bell className="h-[18px] w-[18px]" aria-hidden />
              </span>
            </div>
            {nextLabel ? (
              <>
                <p className={cx("kpi-val", nextLabel.length > 12 && "long")}>{nextLabel}</p>
                <p className="kpi-hint wrap-anywhere">{nextTitle}</p>
              </>
            ) : (
              <>
                <p className="rem-next-none">Nenhum agendado</p>
                <p className="kpi-hint">ative um lembrete num evento do cronograma</p>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* as duas colunas terminam juntas quando têm quase a mesma altura; se não, a lateral fica do tamanho
          dela e parada no alto (nenhum card estica com buraco no pé) */}
      <div className={cx("tela-cols rem-cols", stuck && "is-stuck")}>
        <div ref={mainColRef} className="tela-main">
          {hasAny ? (
            <>
              {pendCard}
              {pastCard}
            </>
          ) : (
            startCard
          )}
        </div>

        <div ref={sideRef} className="tela-side">
          {prefCard}
          {monthsCard}
          {howCard}
        </div>
      </div>

      <Drawer
        open={drawer.open}
        title="Todos os lembretes"
        subtitle={`${countText(upcoming.length, "aguardando aviso", "aguardando aviso")}, ${countText(past.length, "já avisado", "já avisados")}${
          voided.length ? `, ${countText(voided.length, "cancelado ou concluído", "cancelados ou concluídos")}` : ""
        }`}
        size="wide"
        initialFocusRef={drawerFocusRef}
        onClose={closeDrawer}
        footer={
          <button className={secondaryButton} onClick={closeDrawer} type="button">
            Fechar
          </button>
        }
      >
        <div ref={drawerRef} className="rem-dr">
          <div className="rem-dr-top">
            <div className={cx("seg rem-tabs", tabs.length > 2 && "three")} role="tablist" aria-label="Lembretes">
              {tabs.map((item) => {
                const selected = tab === item.key;
                return (
                  <button
                    key={item.key}
                    ref={(node) => {
                      if (node) {
                        tabRefs.current.set(item.key, node);
                      } else {
                        tabRefs.current.delete(item.key);
                      }
                      if (selected) {
                        drawerFocusRef.current = node;
                      }
                    }}
                    id={tabIds[item.key]}
                    className={cx(selected && "on")}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={panelId}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => chooseTab(item.key)}
                    onKeyDown={tabKeyDown}
                    type="button"
                  >
                    {item.short === item.label ? (
                      item.label
                    ) : (
                      <>
                        <span className="rem-tab-full">{item.label}</span>
                        <span className="rem-tab-short">{item.short}</span>
                      </>
                    )}
                    <span className="n">{item.count}</span>
                  </button>
                );
              })}
            </div>
            {tabMonths.length > 1 ? (
              <label className="rem-dr-month">
                <span>Mês</span>
                <select
                  className="input"
                  value={month === null ? "" : String(month)}
                  onChange={(change) => setDrawer({ ...drawer, month: change.target.value === "" ? null : Number(change.target.value) })}
                >
                  <option value="">Todos os meses ({tabList.length})</option>
                  {tabMonths.map((item) => (
                    <option key={item.key} value={String(item.key)}>
                      {monthName(item.key, now)} ({item.count})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div ref={drawerPanelRef} id={panelId} role="tabpanel" aria-labelledby={tabIds[tab]} className="rem-dr-panel outline-none">
            {tab === "void" && paged.items.length ? (
              <p className="sub rem-dr-note">O evento foi cancelado ou concluído, então o aviso não sai mais. Remova o que não precisa.</p>
            ) : null}
            {paged.items.length ? (
              drawerGroups.map((group) => {
                // o mês pode se dividir entre páginas: a conta é a desta página, com o total do mês ao lado
                const monthTotal = tabMonths.find((item) => item.key === group.key)?.count ?? group.items.length;
                return (
                  <div key={group.key} className="rem-month">
                    <h3 className="rem-month-h drawer-h3">
                      {monthName(group.key, now)}
                      <span className="n">
                        {monthTotal > group.items.length
                          ? `${group.items.length} de ${countText(monthTotal, "lembrete", "lembretes")} nesta página`
                          : countText(monthTotal, "lembrete", "lembretes")}
                      </span>
                    </h3>
                    <ul id={`${drawerListId}-${group.key}`} className="rem-list">
                      {group.items.map((reminder) => row(reminder, tab, tab, "drawer"))}
                    </ul>
                  </div>
                );
              })
            ) : (
              <p className="empty-inline rem-dr-empty">
                {tab === "past" ? "Nenhum aviso saiu ainda" : "Nenhum aviso por vir"}
              </p>
            )}
            <Pager className="mt-4" paged={paged} noun={["lembrete", "lembretes"]} focusRef={drawerPanelRef} />
          </div>
        </div>
      </Drawer>
    </div>
  );
}
