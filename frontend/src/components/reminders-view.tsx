"use client";

import { Bell, BellOff, CalendarDays, Check, ChevronDown, CircleCheckBig, Clock, Loader2, Settings2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cx, formatShortDate, formatShortDateTime, formatTime, isWholeDay, relativeDue, startOfDay } from "@/lib/format";
import { categoryMeta, reminderOffsetLabel, reminderOptions, statusMeta } from "@/lib/meta";
import type { AcademicEvent, Category, Reminder } from "@/lib/types";
import { AvisosCard, InsightTile, delay } from "./dashboard-bits";
import { EmptyState, InfoLine } from "./ui";

/** Quantos lembretes cada lista mostra antes do "Ver todos (N)". */
const PREVIEW = 3;
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
/** Card principal mais alto que a coluna lateral por mais que isto: a lateral para de esticar e fica parada no alto. */
const SIDE_STRETCH_MAX = 200;

type ListKey = "pending" | "past";
/** pending: o aviso ainda vai sair; past: a hora do aviso passou; void: evento cancelado ou concluído. */
type RowKind = "pending" | "past" | "void";

/** "ter, 09/11, 19:00"; "dia todo" só quando o evento não tem horário (começa à meia-noite, sem hora de término). */
function eventWhen(event: AcademicEvent) {
  return isWholeDay(event.startsAt, event.endsAt)
    ? `${formatShortDate(event.startsAt)}, dia todo`
    : formatShortDateTime(event.startsAt);
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
  return formatShortDateTime(value);
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
 * (como no Painel). Os outros passam para "Já avisados" quando o aviso aparece no bloco Avisos
 * (reached: os avisos de agora e os que já apareceram com a tela aberta), assim o bloco, a linha e os
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

/** Decisão da coluna lateral: altura do conteúdo dela e se ela fica parada no alto em vez de esticar. */
function sideFit(mainHeight: number, sideHeight: number, gapHeight: number, beside: boolean) {
  const content = sideHeight - gapHeight;
  return { content, stuck: beside && mainHeight - content > SIDE_STRETCH_MAX };
}

/**
 * Card principal e coluna lateral lado a lado (.tela-cols) terminam juntos (decisão 2): no CSS, o mais
 * baixo estica. Quando o principal passa da lateral por mais de SIDE_STRETCH_MAX ("Ver todos" aberto,
 * prévia aberta), a lateral deixa de esticar e fica do tamanho do conteúdo, parada no alto enquanto a
 * página rola (.is-stuck), como o card da Gestão; --side-h leva a altura dela para o sticky.
 * main: o card (ou a coluna) com que a lateral termina junto. gapRef: o espaçador do último card da
 * lateral, que fica com a sobra quando ela estica (sem ele, a altura da lateral é a do conteúdo).
 */
export function useSideFit(main: RefObject<HTMLElement | null>, ready = true) {
  const sideRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useLayoutEffect(() => {
    const mainNode = main.current;
    const side = sideRef.current;
    if (!ready || !mainNode || !side || typeof ResizeObserver === "undefined") {
      return;
    }
    // a primeira medida vem do próprio ResizeObserver, antes da pintura
    const observer = new ResizeObserver(() => {
      // lado a lado só a partir de 1200px; uma embaixo da outra, nada estica nem gruda
      const beside = side.offsetLeft >= mainNode.offsetLeft + mainNode.offsetWidth;
      const fit = sideFit(mainNode.offsetHeight, side.offsetHeight, gapRef.current?.offsetHeight ?? 0, beside);
      side.style.setProperty("--side-h", `${fit.content}px`);
      setStuck(fit.stuck);
    });
    for (const node of [mainNode, side, gapRef.current]) {
      if (node) {
        observer.observe(node);
      }
    }
    return () => observer.disconnect();
  }, [main, ready]);

  return { sideRef, gapRef, stuck };
}

/** Linha de lembrete do Figma: ícone, evento, quando avisa e Remover. A antecedência muda na própria linha. */
function ReminderRow({
  reminder,
  kind,
  now,
  busy,
  change,
  draft,
  registerRemove,
  onPickOffset,
  onCommitOffset,
  onDelete,
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
  /** Guarda o botão "Remover", para o foco ir ao próximo depois de remover. */
  registerRemove: (id: number, node: HTMLButtonElement | null) => void;
  onPickOffset?: (minutes: number) => void;
  /** Salva logo a escolha (ao sair do campo, com o próximo foco, ou com Enter). */
  onCommitOffset?: (next: Element | null) => void;
  onDelete: () => void;
  onOpenEvent: (id: number) => void;
}) {
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
  // evento cancelado ou concluído: não há mais aviso para adiantar ou atrasar
  const canChange = Boolean(onPickOffset) && eventAhead && !noLonger;
  const RowIcon = kind === "past" ? Check : kind === "void" ? BellOff : Bell;
  // nos já avisados, os dados vão sem ícone, como no Figma
  const withIcons = kind !== "past";
  const options = reminderOptions.some((option) => Number(option.value) === offset)
    ? reminderOptions
    : [...reminderOptions, { value: String(offset), label: reminderOffsetLabel(offset) }].sort((a, b) => Number(a.value) - Number(b.value));

  return (
    <li className={cx("rem-row", kind !== "pending" && kind)} data-reminder={reminder.id}>
      <span className="rem-ico" aria-hidden>
        <RowIcon className="h-5 w-5" />
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
              {withIcons ? <CalendarDays aria-hidden /> : null}
              Evento {eventWhen(event)}
              {eventAhead ? ` (${relativeDue(event.startsAt)})` : ""}
            </span>
          ) : null}
          {noLonger ? (
            <span className="rem-meta-i">
              <BellOff aria-hidden />
              {noLonger}
            </span>
          ) : canChange ? (
            <label className="rem-meta-i">
              {withIcons ? <Clock aria-hidden /> : null}
              {/* sem disabled enquanto salva: o foco fica no campo, e a escolha seguinte espera a vez */}
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
            </label>
          ) : (
            <span className="rem-meta-i">
              {withIcons ? <Clock aria-hidden /> : null}
              {reminderOffsetLabel(reminder.offsetMinutes)}
            </span>
          )}
          {!noLonger ? (
            <span className="rem-meta-i">
              {withIcons ? <Bell aria-hidden /> : null}
              No sistema
            </span>
          ) : null}
          {changing ? (
            <span role="status" className="rem-meta-i text-ink-3">
              <Loader2 className="animate-spin" aria-hidden />
              Salvando
            </span>
          ) : null}
        </div>
      </div>

      <div className="rem-acts">
        {!noLonger ? (
          <span className="pill rem-when">
            {kind === "past" ? "Avisado" : "Aviso"} {sendWhen(reminder.sendAt, now)}
          </span>
        ) : null}
        <button
          ref={(node) => registerRemove(reminder.id, node)}
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
  const pendListId = `${baseId}-aguardando-lista`;
  const pastListId = `${baseId}-avisados-lista`;
  const prefId = `${baseId}-padrao`;
  const stepsId = `${baseId}-passos`;
  const shownAvisos = avisos ?? [];
  const avisoKeys = shownAvisos.map(avisoKey);

  const [now, setNow] = useState(() => Date.now());
  // antecedência salvando: { de, para }
  const [pending, setPending] = useState<Record<number, { from: number; to: number }>>({});
  // antecedência escolhida e ainda não salva (o select já mostra): vai para a página depois de
  // OFFSET_SAVE_DELAY sem nova troca, ao sair do campo ou com Enter, uma de cada vez
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  const [quickId, setQuickId] = useState<number | null>(null);
  // "Ver todos (N)": cada lista abre no próprio card, sem rolagem por dentro
  const [showAll, setShowAll] = useState<Record<ListKey, boolean>>({ pending: false, past: false });
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
  // antecedência que a página está salvando ({ lembrete, antecedência nova }), até o lembrete voltar salvo
  const [landing, setLanding] = useState<{ id: number; to: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const pendRef = useRef<HTMLElement>(null);
  const pastRef = useRef<HTMLElement>(null);
  const pendTitleRef = useRef<HTMLHeadingElement>(null);
  const pastTitleRef = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  const moreButtons = useRef(new Map<ListKey, HTMLButtonElement>());
  const removing = useRef<{ id: number; order: number[]; list: ListKey } | null>(null);
  // controle de linha com o foco quando uma antecedência foi salva (saved: o lembrete salvo; place: onde a
  // linha estava, para saber se ela mudou de lugar; scrolled: a pessoa rolou a página por conta própria)
  const restore = useRef<{ saved: number; id: number; part: string; place: string | null; scrolled: boolean } | null>(null);
  // evento cujo lembrete a sugestão está criando
  const createdFor = useRef<number | null>(null);
  // lista que acabou de abrir ou fechar, e o primeiro lembrete que apareceu
  const toggled = useRef<{ list: ListKey; firstNew: number | null } | null>(null);
  const commitRef = useRef<(only?: number, next?: Element | null) => void>(() => undefined);
  const { sideRef, gapRef, stuck } = useSideFit(pendRef);

  // o "Aviso hoje", as opções que já passaram e as sugestões andam com o relógio
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK);
    return () => window.clearInterval(timer);
  }, []);

  const { voided, upcoming, past } = reminderLists(reminders, avisos ? new Set([...seenAvisos, ...avisoKeys]) : null, now);
  const next = upcoming.find((reminder) => reminder.enabled) ?? null;

  // o lembrete voltou salvo: se a lista nova deixou a linha depois dos primeiros de uma lista fechada, ela
  // abre no mesmo render, e a linha aparece no lugar novo (com o foco, se ele estava nela). Se o salvar
  // falhou, nada abre.
  if (landing) {
    const saved = reminders.find((reminder) => reminder.id === landing.id);
    if (saved?.offsetMinutes === landing.to) {
      setLanding(null);
      const list: ListKey | null = upcoming.indexOf(saved) >= PREVIEW ? "pending" : past.indexOf(saved) >= PREVIEW ? "past" : null;
      if (list && !showAll[list]) {
        setShowAll({ ...showAll, [list]: true });
      }
    } else if (wasSaving && !saving) {
      setLanding(null);
    }
  }

  // os primeiros de cada lista; o "Ver todos (N)" conta o mesmo que o indicador do alto.
  // Os de evento cancelado ou concluído (raros) ficam inteiros no fim de Aguardando aviso, para poder remover.
  const upcomingShown = showAll.pending ? upcoming : upcoming.slice(0, PREVIEW);
  const pastShown = showAll.past ? past : past.slice(0, PREVIEW);

  const nextLabel = next ? capitalize(sendWhen(next.sendAt, now)) : "Nenhum";
  const nextTitle = next ? (next.academicEvent?.title ?? `Evento #${next.academicEventId}`) : null;

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

  // depois de remover, o foco vai para o próximo "Remover" da mesma lista (ou para o título dela)
  useEffect(() => {
    const target = removing.current;
    if (!target || reminders.some((reminder) => reminder.id === target.id)) {
      return;
    }
    removing.current = null;
    const at = target.order.indexOf(target.id);
    const rest = target.order.filter((id) => id !== target.id && removeButtons.current.has(id));
    const nextId = rest[Math.min(at, rest.length - 1)];
    const title = target.list === "past" ? pastTitleRef.current : pendTitleRef.current;
    (nextId !== undefined ? removeButtons.current.get(nextId) : title)?.focus();
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
    const rowNode = rootRef.current?.querySelector(`[data-reminder="${target.id}"]`);
    const active = document.activeElement;
    if (!active || active === document.body) {
      const control = rowNode?.querySelector<HTMLElement>(`[data-part="${target.part}"]`) ?? firstControl(rowNode);
      const moved = reminders.find((reminder) => reminder.id === target.id);
      const title = moved && new Date(moved.sendAt).getTime() <= now ? pastTitleRef.current : pendTitleRef.current;
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
  }, [reminders, pending, now]);

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

  // "Ver todos": o foco vai para o primeiro lembrete que apareceu; "Mostrar menos": o botão continua à vista
  useEffect(() => {
    const target = toggled.current;
    if (!target) {
      return;
    }
    toggled.current = null;
    const root = target.list === "past" ? pastRef.current : pendRef.current;
    const rowNode = target.firstNew !== null ? root?.querySelector(`[data-reminder="${target.firstNew}"]`) : null;
    const control = firstControl(rowNode);
    if (control) {
      control.focus();
    } else {
      moreButtons.current.get(target.list)?.scrollIntoView({ block: "nearest" });
    }
  }, [showAll]);

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
    setLanding({ id, to: minutes });
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

  function registerRemove(id: number, node: HTMLButtonElement | null) {
    if (node) {
      removeButtons.current.set(id, node);
    } else {
      removeButtons.current.delete(id);
    }
  }

  /** Remove e guarda a ordem da lista, para o foco ir ao próximo "Remover" dela. */
  function removeReminder(reminder: Reminder, list: ListKey) {
    const order = (list === "past" ? past : [...upcoming, ...voided]).map((item) => item.id);
    removing.current = { id: reminder.id, order, list };
    onDelete(reminder);
  }

  function toggleList(list: ListKey, items: Reminder[]) {
    const open = !showAll[list];
    toggled.current = { list, firstNew: open ? (items[PREVIEW]?.id ?? null) : null };
    setShowAll((current) => ({ ...current, [list]: open }));
  }

  /**
   * "Ver todos (N)": a lista abre ali mesmo; "Mostrar menos" volta aos primeiros. No pé do card, ou logo
   * embaixo da lista (inline) quando o grupo dos cancelados vem depois dela.
   */
  function moreButton(list: ListKey, items: Reminder[], controls: string, inline = false) {
    if (items.length <= PREVIEW) {
      return null;
    }
    const open = showAll[list];
    return (
      <div className={inline ? "rem-more" : "card-foot"}>
        <button
          ref={(node) => {
            if (node) {
              moreButtons.current.set(list, node);
            } else {
              moreButtons.current.delete(list);
            }
          }}
          className="link"
          aria-controls={controls}
          aria-expanded={open}
          onClick={() => toggleList(list, items)}
          type="button"
        >
          {open ? "Mostrar menos" : `Ver todos (${items.length})`}
          <ChevronDown className={cx("h-[15px] w-[15px] transition", open && "rotate-180")} aria-hidden />
        </button>
      </div>
    );
  }

  function row(reminder: Reminder, kind: RowKind, list: ListKey) {
    const changeable = kind !== "void" && onChangeOffset;
    return (
      <ReminderRow
        key={reminder.id}
        reminder={reminder}
        kind={kind}
        now={now}
        busy={saving}
        change={pending[reminder.id]}
        draft={drafts[reminder.id]}
        registerRemove={registerRemove}
        onPickOffset={changeable ? (minutes) => pickOffset(reminder, minutes) : undefined}
        onCommitOffset={changeable ? (nextFocus) => commitDraft(reminder.id, nextFocus) : undefined}
        onDelete={() => removeReminder(reminder, list)}
        onOpenEvent={onOpenEvent}
      />
    );
  }

  const suggestionBlock =
    suggestions.length && onQuickReminder ? (
      <div className="mt-4 w-full max-w-xl text-left">
        <p className="text-sm font-bold text-ink-2">Próximas provas e trabalhos</p>
        <ul className="mt-2 grid grid-cols-1 gap-2">
          {suggestions.map((event) => {
            const minutes = defaultReminderMinutes ? quickOffset(event, defaultReminderMinutes, soon) : null;
            const label = minutes ? `Lembrar ${reminderOffsetLabel(minutes)}` : "Ativar lembrete";
            const meta = categoryMeta[event.category];
            return (
              <li key={event.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line-2 bg-white p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-[15px] font-bold leading-snug wrap-anywhere">{event.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span className={cx("pill", meta.tint)}>{meta.short}</span>
                    {eventWhen(event)}
                  </p>
                </div>
                <button
                  className="btn btn-s btn-sm"
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
    ) : onOpenCalendar ? (
      <button className="btn btn-s btn-sm mt-2" onClick={() => onOpenCalendar()} type="button">
        Abrir cronograma
      </button>
    ) : null;

  return (
    <div ref={rootRef} className="grid gap-5">
      {/* o mesmo bloco de avisos do Painel */}
      <AvisosCard
        avisos={shownAvisos}
        events={upcomingEvents}
        fallbackFocus={() => pendTitleRef.current}
        onDismiss={onDismissAviso}
        onOpen={onOpenEvent}
      />

      <div className="kpis rem-kpis">
        <InsightTile icon={Clock} label="Aguardando aviso" value={String(upcoming.length)} tone="c-ativ" hint="um lembrete por evento" order={1} />
        <InsightTile icon={CircleCheckBig} label="Já avisados" value={String(past.length)} hint="a hora do aviso já passou" order={2} />
        <div className="card kpi rise rem-next" style={delay(3)}>
          <div className="kpi-top">
            <p className="kpi-label">Próximo aviso</p>
            <span className="kpi-ico">
              <Bell className="h-[18px] w-[18px]" aria-hidden />
            </span>
          </div>
          <p className={cx("kpi-val", nextLabel.length > 12 && "long")}>{nextLabel}</p>
          <p className="kpi-hint wrap-anywhere">{nextTitle ? `${nextTitle}, no sistema` : "nenhum lembrete agendado"}</p>
        </div>
      </div>

      {/* "Aguardando aviso" e a coluna lateral terminam juntos (Figma); "Já avisados" fica embaixo, na coluna larga */}
      <div className={cx("tela-cols rem-cols", stuck && "is-stuck")}>
        <div className="tela-main">
          <section ref={pendRef} className="card pad rise rem-pend" style={delay(4)} aria-labelledby={pendId}>
            <h2 ref={pendTitleRef} id={pendId} tabIndex={-1} className="h2 outline-none">
              Aguardando aviso
            </h2>
            <div className="rem-pend-body mt-[18px]">
              {upcomingShown.length ? (
                <ul id={pendListId} className="rem-list">
                  {upcomingShown.map((reminder) => row(reminder, "pending", "pending"))}
                </ul>
              ) : (
                <div className="empty-inline">
                  <span className="empty-ico">
                    <Bell className="h-6 w-6" aria-hidden />
                  </span>
                  <p className="mt-1.5 text-[15px] font-bold text-ink">Tudo em dia por aqui</p>
                  <p className="max-w-md text-sm leading-5 text-muted">Abra um evento no cronograma e ative um lembrete pessoal.</p>
                  {suggestionBlock}
                </div>
              )}
              {voided.length ? (
                <>
                  {/* o "Ver todos" fica junto da lista que ele abre, antes dos cancelados */}
                  {moreButton("pending", upcoming, pendListId, true)}
                  <div>
                    <h3 className="ev-group">Eventos cancelados ou concluídos</h3>
                    <ul className="rem-list">{voided.map((reminder) => row(reminder, "void", "pending"))}</ul>
                  </div>
                </>
              ) : null}
            </div>
            {voided.length ? null : moreButton("pending", upcoming, pendListId)}
          </section>

          <section ref={pastRef} className="card pad rise rem-past" style={delay(5)} aria-labelledby={pastId}>
            <h2 ref={pastTitleRef} id={pastId} tabIndex={-1} className="h2 outline-none">
              Já avisados
            </h2>
            <p className="sub">O aviso fica no Painel e aqui em Lembretes até o evento começar ou até você dispensar.</p>
            {past.length ? (
              <ul id={pastListId} className="rem-list mt-[18px]">
                {pastShown.map((reminder) => row(reminder, "past", "past"))}
              </ul>
            ) : (
              <div className="mt-[18px]">
                <EmptyState
                  compact
                  icon={CircleCheckBig}
                  text="Nenhum aviso chegou ainda."
                  hint="Depois da hora marcada, o lembrete passa para esta lista."
                />
              </div>
            )}
            {moreButton("past", past, pastListId)}
          </section>
        </div>

        <div ref={sideRef} className="tela-side">
          <section className="card pad rise" style={delay(6)} aria-labelledby={prefId}>
            <h2 className="h2" id={prefId}>
              Padrão para novos lembretes
            </h2>
            <dl className="info mt-[18px]">
              <InfoLine icon={Clock} label="Antecedência" value={reminderOffsetLabel(defaultReminderMinutes ?? 1440)} />
              <InfoLine icon={Bell} label="Canal" value="No sistema" />
            </dl>
            {onOpenProfile ? (
              <button className="btn btn-s mt-[18px] w-full" onClick={onOpenProfile} type="button">
                <Settings2 className="h-4 w-4" aria-hidden />
                Alterar no perfil
              </button>
            ) : null}
          </section>

          <section className="card pad rise" style={delay(7)} aria-labelledby={stepsId}>
            <h2 className="h2" id={stepsId}>
              Três passos
            </h2>
            <ol className="rem-steps">
              <li>
                <span className="rem-step-n" aria-hidden>
                  1
                </span>
                <span>
                  Abra um evento no cronograma e toque em <b>Ativar lembrete</b>.
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
                  Na hora marcada, o aviso aparece no Painel e aqui em Lembretes.
                  {/* a mesma frase já está no bloco de avisos quando há algum */}
                  {shownAvisos.length ? null : " O envio por e-mail é o próximo passo."}
                </span>
              </li>
            </ol>
            {/* fica com a sobra quando a coluna estica para terminar junto de "Aguardando aviso" */}
            <div ref={gapRef} className="tela-gap" aria-hidden />
          </section>
        </div>
      </div>
    </div>
  );
}
