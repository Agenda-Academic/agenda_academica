"use client";

import {
  Award,
  Bell,
  BellOff,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  MapPin,
  PanelRightOpen,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx, dateParts, daysUntil, formatTime, isAllDay, normalizeText, relativeDue, startOfDay, yearSuffix } from "@/lib/format";
import { adminOnlyCategories, categoryMeta, reminderChips, reminderShortLabel, showsOfficialPill, sourceText, statusMeta } from "@/lib/meta";
import type { AcademicEvent } from "@/lib/types";
import { RowMenu, type RowMenuItem } from "./gestao-row-menu";
import { InfoLine, isOnTopLayer } from "./ui";

/* ------------------------------------------------------------------ */
/* Datas curtas do detalhe e das linhas                                */
/* ------------------------------------------------------------------ */

const shortWeekdays = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function clock(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "qui, 05/11"; fora do ano corrente, com o ano: "sex, 01/01/2027". */
export function shortDay(date: Date) {
  return `${shortWeekdays[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}${yearSuffix(date)}`;
}

/** "qua, 04/11, às 19:00" */
export function formatNoticeAt(date: Date) {
  return `${shortDay(date)}, às ${clock(date)}`;
}

const weekdayNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// sábado e domingo pedem "no"; os outros dias, "na"
function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

/** Em frase, o dia da semana por extenso e com o artigo certo: "na quarta, 04/11" ou "no sábado, 07/11" (com o ano fora do ano corrente). */
export function onDay(date: Date) {
  return `${isWeekend(date) ? "no" : "na"} ${weekdayNames[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}${yearSuffix(date)}`;
}

/**
 * "na quarta, 04/11, às 19:00" ou "no domingo, 08/11, às 19:00". À meia-noite (o aviso de um evento de dia todo,
 * que começa às 00:00), "na quinta, 31/12, logo no início do dia": "às 00:00" parecia um horário marcado.
 */
function onNotice(date: Date) {
  return atMidnight(date) ? `${onDay(date)}, logo no início do dia` : `${onDay(date)}, às ${clock(date)}`;
}

function atMidnight(date: Date) {
  return date.getHours() === 0 && date.getMinutes() === 0;
}

/** Último dia em que o evento acontece. Término às 00:00 não conta aquele dia. */
export function eventLastDay(event: Pick<AcademicEvent, "startsAt" | "endsAt">) {
  const first = startOfDay(new Date(event.startsAt));
  if (!event.endsAt) {
    return first;
  }
  const end = new Date(event.endsAt);
  const last = atMidnight(end) ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1) : startOfDay(end);
  return last < first ? first : last;
}

export function isMultiDay(event: AcademicEvent) {
  return eventLastDay(event).getTime() > startOfDay(new Date(event.startsAt)).getTime();
}

/** Começa às 00:00 e termina às 00:00 ou 23:59 (ou não tem término). */
function isWholeDay(event: AcademicEvent) {
  if (!isAllDay(event.startsAt)) {
    return false;
  }
  if (!event.endsAt) {
    return true;
  }
  const end = new Date(event.endsAt);
  return atMidnight(end) || (end.getHours() === 23 && end.getMinutes() === 59);
}

/** "seg, 16/11 a qua, 18/11, dia todo" ou "qui, 05/11, 19:00 até 21:00". */
export function formatEventWhen(event: AcademicEvent) {
  const start = new Date(event.startsAt);
  const last = eventLastDay(event);
  const multi = last.getTime() > startOfDay(start).getTime();
  if (isWholeDay(event)) {
    return multi ? `${shortDay(start)} a ${shortDay(last)}, dia todo` : `${shortDay(start)}, dia todo`;
  }
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (!end || end <= start) {
    return `${shortDay(start)}, ${clock(start)}`;
  }
  return multi
    ? `${shortDay(start)}, ${clock(start)} até ${shortDay(end)}, ${clock(end)}`
    : `${shortDay(start)}, ${clock(start)} até ${clock(end)}`;
}

/** "16 a 18/11" ou "30/11 a 02/12", na linha de evento de vários dias. */
export function formatDayRange(event: AcademicEvent) {
  const start = new Date(event.startsAt);
  const last = eventLastDay(event);
  const tail = `${pad(last.getDate())}/${pad(last.getMonth() + 1)}`;
  return start.getMonth() === last.getMonth() && start.getFullYear() === last.getFullYear()
    ? `${pad(start.getDate())} a ${tail}`
    : `${pad(start.getDate())}/${pad(start.getMonth() + 1)} a ${tail}`;
}

/** Evento de vários dias que já começou e ainda não acabou. */
function isOngoing(event: AcademicEvent) {
  return isMultiDay(event) && daysUntil(event.startsAt) < 0 && daysUntil(eventLastDay(event).toISOString()) >= 0;
}

/* ------------------------------------------------------------------ */
/* Dados do detalhe (ordem do Figma: início, término, local...)        */
/* ------------------------------------------------------------------ */

/** Depois de "até": "a quarta, 18/11" ou "o sábado, 21/11". */
function toDay(date: Date) {
  return `${isWeekend(date) ? "o" : "a"} ${weekdayNames[date.getDay()]}, ${pad(date.getDate())}/${pad(date.getMonth() + 1)}${yearSuffix(date)}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "faltam 1 dia e 11 horas", "faltam 3 horas e 20 min" ou "falta 1 hora" (o número e a unidade juntos). */
function timeLeft(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days ? `${days}\u00a0${days === 1 ? "dia" : "dias"}` : null,
    hours ? `${hours}\u00a0${hours === 1 ? "hora" : "horas"}` : null,
    !days && rest ? `${rest}\u00a0min` : null,
  ].filter((part): part is string => part !== null);
  const single = parts.length === 1 && parts[0].startsWith("1\u00a0");
  return `${single ? "falta" : "faltam"} ${parts.join(" e ")}`;
}

export type EventWhenSummary = { tone: "green" | "past"; head: string; tail: string | null };

/**
 * Quando é o evento em relação a agora, no bloco do alto do detalhe (Figma): "Amanhã às 19:00,
 * faltam 1 dia e 11 horas", "Em andamento, até a quarta, 18/11" ou "Já passou, ontem".
 * Cancelado e concluído não têm o bloco: a pílula e o aviso já dizem a situação.
 */
export function eventWhenSummary(event: AcademicEvent, now: number): EventWhenSummary | null {
  if (event.status === "cancelled" || event.status === "completed") {
    return null;
  }
  const start = new Date(event.startsAt);
  const startMs = start.getTime();
  const wholeDay = isWholeDay(event);
  const last = eventLastDay(event);
  const multi = last.getTime() > startOfDay(start).getTime();
  const endDate = event.endsAt ? new Date(event.endsAt) : null;
  const end = endDate && endDate.getTime() > startMs ? endDate : null;
  // fim: no dia todo, a meia-noite depois do último dia; senão o término ou, sem ele, o próprio início
  const endMs = wholeDay
    ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime()
    : (end?.getTime() ?? startMs);
  const days = Math.round((startOfDay(start).getTime() - startOfDay(new Date(now)).getTime()) / 86400000);
  const day = days === 0 ? "Hoje" : days === 1 ? "Amanhã" : capitalize(onDay(start));

  if (startMs > now) {
    if (wholeDay) {
      return {
        tone: "green",
        head: multi ? `${day}, até ${toDay(last)}` : `${day}, dia todo`,
        tail: days > 1 ? relativeDue(event.startsAt) : null,
      };
    }
    // "Amanhã às 19:00, faltam 20 horas" e "Na quarta, 04/11, às 19:00, em 6 dias": a partir de 2 dias, a
    // mesma redação da lista (dias corridos); hoje e amanhã, as horas que faltam
    return {
      tone: "green",
      head: `${day}${days > 1 ? "," : ""} às ${clock(start)}`,
      tail: days > 1 ? relativeDue(event.startsAt) : timeLeft(startMs - now),
    };
  }
  if (now < endMs) {
    if (multi) {
      return { tone: "green", head: "Em andamento", tail: `até ${toDay(last)}${!wholeDay && end ? `, às ${clock(end)}` : ""}` };
    }
    return wholeDay
      ? { tone: "green", head: "Hoje, dia todo", tail: null }
      : { tone: "green", head: "Acontecendo agora", tail: `até ${clock(end ?? start)}` };
  }
  return {
    tone: "past",
    head: "Já passou",
    tail: days === 0 ? (wholeDay ? "hoje" : `hoje às ${clock(start)}`) : relativeDue(event.startsAt),
  };
}

/** Início no rótulo curto do glossário: "qui, 05/11, 19:00", "seg, 02/11, dia todo" ou "seg, 16/11". */
export function eventStartLabel(event: AcademicEvent) {
  const start = new Date(event.startsAt);
  if (isWholeDay(event)) {
    return isMultiDay(event) ? shortDay(start) : `${shortDay(start)}, dia todo`;
  }
  return `${shortDay(start)}, ${clock(start)}`;
}

/** Término no mesmo formato ("qui, 05/11, 21:00"); no dia todo de vários dias, o último dia. Sem término, null. */
export function eventEndLabel(event: AcademicEvent) {
  if (isWholeDay(event)) {
    return isMultiDay(event) ? shortDay(eventLastDay(event)) : null;
  }
  const end = event.endsAt ? new Date(event.endsAt) : null;
  if (!end || end.getTime() <= new Date(event.startsAt).getTime()) {
    return null;
  }
  return `${shortDay(end)}, ${clock(end)}`;
}

/** Situação que os botões pedem. "changed" é a volta de um evento cancelado. */
export type EventStatusChange = "scheduled" | "changed" | "completed" | "cancelled";

/** Reativar: o cancelado volta como Alterado, para a turma ver que ele voltou; o concluído volta a Agendado. */
export function reactivatedStatus(event: AcademicEvent): EventStatusChange {
  return event.status === "cancelled" ? "changed" : "scheduled";
}

/**
 * Situação em pílula cheia, como no Figma (Guia visual): Agendado, Alterado, Concluído e Cancelado.
 * Nas linhas, "Agendado" não aparece; no detalhe (showScheduled), aparece como no Figma.
 */
export function StatusPill({ event, showScheduled = false }: { event: AcademicEvent; showScheduled?: boolean }) {
  if (event.status === "scheduled" && !showScheduled) {
    return null;
  }
  const status = statusMeta[event.status];
  return <span className={cx("pill", status.pill)}>{status.label}</span>;
}

function OfficialPill() {
  return (
    <span className="pill prio">
      <ShieldCheck className="h-3 w-3" aria-hidden />
      Oficial
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Linha de evento                                                     */
/* ------------------------------------------------------------------ */

const monthNamesLong = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * Marca no texto as palavras da busca (sem diferenciar acento nem maiúscula), como a busca compara
 * (normalizeText). Sem termo, devolve o texto como veio.
 */
export function highlightMatches(text: string, term?: string | null): ReactNode {
  const words = normalizeText(term).split(/\s+/).filter((word) => word.length > 1);
  if (!words.length || !text) {
    return text;
  }
  // texto normalizado letra a letra, com a posição de cada letra no original
  const { flat, at } = flatten(text);
  const marks: Array<[number, number]> = [];
  for (const word of words) {
    let from = flat.indexOf(word);
    while (from >= 0) {
      const start = at[from];
      const lastIndex = from + word.length - 1;
      const end = lastIndex + 1 < at.length ? at[lastIndex + 1] : text.length;
      marks.push([start, end]);
      from = flat.indexOf(word, from + word.length);
    }
  }
  if (!marks.length) {
    return text;
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const mark of marks) {
    const last = merged[merged.length - 1];
    if (last && mark[0] <= last[1]) {
      last[1] = Math.max(last[1], mark[1]);
    } else {
      merged.push([...mark]);
    }
  }
  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], index) => {
    if (start > cursor) {
      parts.push(text.slice(cursor, start));
    }
    parts.push(
      <mark key={index} className="ev-mark">
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  });
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts;
}

/** Texto normalizado letra a letra (como a busca compara), com a posição de cada letra no texto original. */
function flatten(text: string) {
  let flat = "";
  const at: number[] = [];
  Array.from(text).reduce((offset, char) => {
    const plain = normalizeText(char) || (char.trim() ? "" : " ");
    for (let index = 0; index < plain.length; index += 1) {
      flat += plain[index];
      at.push(offset);
    }
    return offset + char.length;
  }, 0);
  return { flat, at };
}

/**
 * Busca que acertou só na descrição (que a linha não mostra): um trecho curto dela, em volta da palavra, para a
 * pessoa ver por que o evento apareceu ("... funções, matrizes e revisão"). Null quando todas as palavras da
 * busca já aparecem na linha (título, categoria, disciplina, turma, local) ou nenhuma está na descrição.
 */
export function descriptionSnippet(description: string | null | undefined, term: string | null | undefined, visible: string) {
  const words = normalizeText(term).split(/\s+/).filter((word) => word.length > 1);
  if (!description || !words.length) {
    return null;
  }
  const seen = normalizeText(visible);
  const text = description.replace(/\s+/g, " ").trim();
  const { flat, at } = flatten(text);
  const word = words.find((item) => !seen.includes(item) && flat.includes(item));
  if (!word) {
    return null;
  }
  const from = flat.indexOf(word);
  const hitStart = at[from];
  const hitEnd = from + word.length < at.length ? at[from + word.length] : text.length;
  let start = Math.max(0, hitStart - 36);
  let end = Math.min(text.length, hitEnd + 56);
  // corta entre palavras
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space >= 0 && space < hitStart ? space + 1 : start;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    end = space > hitEnd ? space : end;
  }
  const cut = end < text.length;
  const piece = text.slice(start, end);
  return `${start > 0 ? "... " : ""}${cut ? piece.replace(/[\s,;:.]+$/, "") : piece}${cut ? " ..." : ""}`;
}

export function EventRow({
  event,
  hideClass,
  hideDate,
  highlight,
  refYear,
  saved,
  selected,
  showMonth,
  showTeacher,
  onClick,
}: {
  /** Mantido por compatibilidade: a linha sempre mostra a data relativa. */
  compact?: boolean;
  event: AcademicEvent;
  /** Oculta o nome da turma (visão de aluno, que só tem uma). */
  hideClass?: boolean;
  /** Sem o bloco de data (lista de um dia só, em que a data já está no título). */
  hideDate?: boolean;
  /** Termo da busca: as palavras dele ficam marcadas no título e no complemento. */
  highlight?: string | null;
  /** Mantido por compatibilidade: os eventos da própria pessoa não ganham mais pílula. */
  mine?: boolean;
  /**
   * Ano do cabeçalho da lista ("Junho de 2027"): o selo com o mês só mostra o ano quando ele é outro. Sem
   * cabeçalho, vale o ano corrente.
   */
  refYear?: number;
  /** Salvo há pouco pelo painel lateral: pílula "Salvo agora" (a mesma da Gestão). */
  saved?: boolean;
  selected?: boolean;
  separated?: boolean;
  /** Mostra o mês no bloco de data, para listas que atravessam meses sem cabeçalho de mês (com o ano, fora do ano corrente). */
  showMonth?: boolean;
  /** Mostra quem publicou (eventos de colegas na visão docente). */
  showTeacher?: boolean;
  onClick: () => void;
}) {
  const meta = categoryMeta[event.category];
  const cancelled = event.status === "cancelled";
  const parts = dateParts(event.startsAt);
  const days = daysUntil(event.startsAt);
  const multi = isMultiDay(event);
  const ongoing = isOngoing(event);
  const hasReminder = Boolean(event.reminder && event.reminder.enabled !== false);
  const time = multi ? formatDayRange(event) : isWholeDay(event) ? "Dia todo" : formatTime(event.startsAt);
  const rel = ongoing ? "em andamento" : relativeDue(event.startsAt);
  const soon = ongoing || (days >= 0 && days <= 1);
  const details = [
    event.subject?.name,
    !hideClass ? event.academicClass?.name : null,
    showTeacher ? event.teacher?.fullName : null,
    event.location,
    event.points !== null ? `${event.points} pts` : null,
  ]
    .filter(Boolean)
    .join(", ");
  // busca que só acertou na descrição: um trecho dela, com a palavra marcada
  const snippet = highlight
    ? descriptionSnippet(event.description, highlight, [event.title, details, event.academicClass?.name, meta.label, meta.short].join(" "))
    : null;
  const start = new Date(event.startsAt);
  // nome acessível com pausas e o mês: "Prova de Matemática, Prova, segunda, 23 de novembro, 18:00, em 6 dias"
  const status = event.status !== "scheduled" ? statusMeta[event.status].label : null;
  const name = [
    event.title,
    meta.short,
    status,
    showsOfficialPill(event) ? "oficial" : null,
    `${weekdayNames[start.getDay()]}, ${start.getDate()} de ${monthNamesLong[start.getMonth()]}${
      parts.otherYear ? ` de ${parts.year}` : ""
    }`,
    time === "Dia todo" ? "dia todo" : time,
    rel,
    details || null,
    hasReminder ? "lembrete ativo" : null,
    saved ? "salvo agora" : null,
    snippet ? `na descrição: ${snippet}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      aria-current={selected ? "true" : undefined}
      aria-label={name}
      className={cx("ev", selected && "sel", showMonth && !hideDate && "with-month")}
      data-event-id={event.id}
      // abre o detalhe: ao fechá-lo, o foco volta para cá (contrato com o page.tsx)
      data-opens-event={event.id}
      onClick={onClick}
      type="button"
    >
      {hideDate ? null : (
        <span className="ev-date">
          <span className="dw">{parts.weekday}</span>
          <span className="dn">{parts.day}</span>
          {showMonth ? (
            <span className="ev-mo">
              {parts.month}
              {parts.year !== (refYear ?? new Date().getFullYear()) ? <span className="ev-yr">{parts.year}</span> : null}
            </span>
          ) : null}
        </span>
      )}
      <span className="ev-body">
        {/* o título como veio (importado do PDF também, decisão 12): sem "block", o .ev-title corta só no fim, na
            2ª linha, com reticências, e o nome inteiro fica na dica; palavra longa quebra */}
        <span className={cx("ev-title", cancelled && "text-muted line-through")} title={event.title}>
          {highlightMatches(event.title, highlight)}
        </span>
        <span className="ev-meta">
          <span className={cx("pill", meta.tint)}>{meta.short}</span>
          <StatusPill event={event} />
          {saved ? (
            <span className="pill bg-brand text-white">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              Salvo agora
            </span>
          ) : null}
          {showsOfficialPill(event) ? <OfficialPill /> : null}
          {/* coluna estreita (celular): a hora vem para junto das pílulas, como no Figma, e o
              título usa a largura toda; a coluna da direita (.ev-when) some. Fora dela, o contrário. */}
          <span className="ev-at">
            {time === "Dia todo" ? "dia todo" : time}, <span className={soon ? "soon" : undefined}>{rel}</span>
          </span>
          {hasReminder ? (
            <span className="inline-flex items-center text-brand" title="Lembrete ativo">
              <Bell className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">lembrete ativo</span>
            </span>
          ) : null}
          {details ? <span className="det min-w-0 truncate">{details}</span> : null}
        </span>
        {snippet ? <span className="ev-snip">{highlightMatches(snippet, highlight)}</span> : null}
      </span>
      <span className="ev-when">
        <span className="ev-time block">{time}</span>
        <span className={cx("ev-rel block", soon && "soon")}>{rel}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Detalhe do evento                                                   */
/* ------------------------------------------------------------------ */

type BusyKey = "save" | "remove" | EventStatusChange;

// botão indisponível sem "disabled", para o foco não cair no body durante o envio
const softOff = "aria-disabled:cursor-not-allowed! aria-disabled:opacity-60";

/** Foca o alvo assim que nenhum outro diálogo estiver por cima (ex.: a confirmação de cancelar). */
function focusWhenFree(getTarget: () => HTMLElement | null, tries = 40) {
  const target = getTarget();
  if (target?.isConnected) {
    // vale só a camada de cima da pilha (as de baixo continuam montadas, com aria-modal, mas inertes)
    const blocked = !isOnTopLayer(target);
    if (!blocked) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  if (tries > 0) {
    window.setTimeout(() => focusWhenFree(getTarget, tries - 1), 100);
  }
}

/**
 * Vão (px) entre o fim da lista e o do painel ao lado a partir do qual o lembrete vem aberto. Aberto, ele
 * soma uns 220 px: acima da metade disso, aberto deixa as colunas mais perto de terminar juntas.
 */
const REMINDER_OPEN_GAP = 110;

/** Opções do "Mais ações" do rodapé do detalhe (Modal): Concluir ou Reativar, Cancelar evento e Excluir. */
type MoreAction = "status" | "cancelled" | "delete";

export function EventDetailContent({
  canManage,
  cornerSpace,
  event,
  footerSlot,
  panelGap,
  reminderOffset,
  saving,
  setReminderOffset,
  titleRef,
  onDelete,
  onEdit,
  onRemoveReminder,
  onSaveReminder,
  onSetStatus,
}: {
  canManage: boolean;
  /** Deixa espaço no canto de cima à direita para o botão de fechar do painel. */
  cornerSpace?: boolean;
  event: AcademicEvent;
  /**
   * Rodapé fixo do Modal (celular, tablet e Calendário). Com ele (mesmo ainda null, antes de o Modal montar),
   * a ação principal sai do corpo e vai para o rodapé, sempre à vista sem rolar: "Editar" e o "Mais ações"
   * (Concluir, Cancelar evento, Excluir) para quem gerencia; o botão do lembrete para quem só lê.
   */
  footerSlot?: HTMLElement | null;
  /**
   * Painel ao lado: quanto a lista ao lado passa do fim do painel, em px (negativo, o painel é que passa).
   * Com a lista bem mais alta, o lembrete já vem aberto (a antecedência à vista) e as colunas terminam juntas.
   */
  panelGap?: (panel: HTMLElement) => number | null;
  reminderOffset: string;
  saving: boolean;
  setReminderOffset: (value: string) => void;
  /** Título do detalhe (tabIndex -1), para o Cronograma levar o foco até ele. */
  titleRef?: RefObject<HTMLHeadingElement | null>;
  onDelete: (event: AcademicEvent) => void;
  onEdit: (event: AcademicEvent) => void;
  onRemoveReminder: (event: AcademicEvent) => void;
  onSaveReminder: () => void;
  onSetStatus: (event: AcademicEvent, status: EventStatusChange) => void;
}) {
  const meta = categoryMeta[event.category];
  const cancelled = event.status === "cancelled";
  const active = event.status === "scheduled" || event.status === "changed";
  const official = event.source !== "teacher";
  const ids = useId();

  // horário de referência (render precisa ser puro); atualiza a cada 30 s
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // botão que disparou o envio em andamento (spinner e aria-busy só nele)
  const [busyKey, setBusyKey] = useState<BusyKey | null>(null);
  if (!saving && busyKey !== null) {
    setBusyKey(null);
  }
  const busy = saving ? busyKey : null;

  const reminderButtonRef = useRef<HTMLButtonElement>(null);
  const removeButtonRef = useRef<HTMLButtonElement>(null);
  // ações no rodapé do Modal (a prop veio, mesmo que o rodapé ainda não tenha montado)
  const inFooter = footerSlot !== undefined;
  // painel ao lado (Agenda no computador): ações numa linha e o lembrete recolhido, para o painel não ficar
  // muito mais alto que a lista num mês curto
  const side = Boolean(cornerSpace) && !inFooter;
  // lembrete do painel ao lado: a antecedência só abre depois do "Ativar lembrete" ou do "Alterar"
  const [reminderOpen, setReminderOpen] = useState(false);
  // lista ao lado bem mais alta que o painel (as datas da instituição, sem local nem disciplina, deixavam um
  // vão de 170 a 230 px): o lembrete vem aberto, o que soma uns 220 px. Medido uma vez, antes de pintar
  // (o detalhe é montado de novo a cada evento)
  const [roomy, setRoomy] = useState(false);
  const measureRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !side || !panelGap) {
        return;
      }
      const gap = panelGap(node);
      if (gap !== null && gap > REMINDER_OPEN_GAP) {
        setRoomy(true);
      }
    },
    [side, panelGap]
  );
  const offsetsRef = useRef<HTMLDivElement>(null);
  const focusOffsets = useRef(false);
  useEffect(() => {
    if (reminderOpen && focusOffsets.current) {
      focusOffsets.current = false;
      // o botão clicado some: o foco vai para a antecedência escolhida
      offsetsRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    }
  }, [reminderOpen]);
  // pedido de foco feito no clique (timeStamp do evento, na mesma base de performance.now)
  const focusRequest = useRef<{ kind: "reminder"; at: number } | null>(null);

  /* ---------------- lembrete ---------------- */
  const startsAt = new Date(event.startsAt).getTime();
  const ended = new Date(event.endsAt ?? event.startsAt).getTime() <= now;
  const saved = event.reminder && event.reminder.enabled !== false ? event.reminder : null;
  const closed = startsAt <= now || cancelled || event.status === "completed";
  const draft = Number(reminderOffset);
  const isValid = (minutes: number) => startsAt - minutes * 60000 > now;
  const offsets = Array.from(
    new Set([...reminderChips.map((chip) => Number(chip.value)), ...(saved ? [saved.offsetMinutes] : []), draft])
  )
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 15)
    .sort((a, b) => a - b);
  const validOffsets = offsets.filter(isValid);
  const largestValid = validOffsets.length ? validOffsets[validOffsets.length - 1] : null;
  // sem lembrete salvo, uma antecedência que já passou vira a maior que ainda dá tempo
  const autoPick = !saved && !closed && !isValid(draft) && largestValid !== null;
  const chosen = autoPick ? largestValid : draft;
  const dirty = saved !== null && chosen !== saved.offsetMinutes;
  const chosenAt = new Date(startsAt - chosen * 60000);
  const savedAt = saved ? new Date(startsAt - saved.offsetMinutes * 60000) : null;
  const minutesToStart = Math.max(1, Math.round((startsAt - now) / 60000));

  useEffect(() => {
    if (autoPick && largestValid !== null) {
      setReminderOffset(String(largestValid));
    }
  }, [autoPick, largestValid, setReminderOffset]);

  const savedId = saved?.id ?? null;
  useEffect(() => {
    const request = focusRequest.current;
    if (request?.kind === "reminder" && performance.now() - request.at < 20000) {
      focusRequest.current = null;
      focusWhenFree(() => reminderButtonRef.current ?? removeButtonRef.current ?? titleRef?.current ?? null);
    }
  }, [savedId, titleRef]);

  function changeStatus(status: EventStatusChange) {
    if (saving) {
      return;
    }
    setBusyKey(status);
    onSetStatus(event, status);
  }

  function saveReminder() {
    if (saving || (saved && !dirty)) {
      return;
    }
    setBusyKey("save");
    onSaveReminder();
  }

  function removeReminder(at: number) {
    if (saving) {
      return;
    }
    setBusyKey("remove");
    focusRequest.current = { kind: "reminder", at };
    onRemoveReminder(event);
  }

  function discardChange() {
    if (!saved) {
      return;
    }
    setReminderOffset(String(saved.offsetMinutes));
    window.requestAnimationFrame(() => reminderButtonRef.current?.focus());
  }

  // dados na ordem do Figma; evento oficial sem local não ganha "Não informado" (feriado não tem sala)
  const when = eventWhenSummary(event, now);
  const endLabel = eventEndLabel(event);
  const location = event.location ?? (official ? null : "Não informado");

  // no rodapé, o mesmo tamanho dos outros botões dele (contornado); no corpo, o botão discreto
  const removeButton = (
    <button
      key="remove"
      ref={removeButtonRef}
      aria-busy={busy === "remove" || undefined}
      aria-disabled={saving || undefined}
      className={cx(
        inFooter && !canManage ? "btn btn-s text-[var(--danger)]" : "btn btn-sm text-[var(--danger)] hover:bg-surface-2",
        softOff
      )}
      onClick={(click) => removeReminder(click.timeStamp)}
      type="button"
    >
      {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BellOff className="h-4 w-4" aria-hidden />}
      Remover lembrete
    </button>
  );

  // quem só lê: o botão do lembrete vai para o rodapé do Modal (quem gerencia tem o "Editar" lá)
  const reminderFooter = inFooter && !canManage;
  const noReminderTime = validOffsets.length === 0;

  /**
   * Botões do lembrete. No corpo, o principal vem primeiro e ocupa a linha; no rodapé, a ordem do rodapé
   * (o secundário antes, o principal no fim) e, com o lembrete já salvo e sem mudança, só o "Remover".
   */
  function reminderActions(footer = false) {
    // quem gerencia (no Modal e no painel ao lado): o "Editar" é o único azul; o lembrete pessoal fica secundário
    const reminderTone = canManage ? "btn btn-s" : "btn btn-p";
    const primary =
      !saved || dirty ? (
        <button
          key="primary"
          ref={reminderButtonRef}
          aria-busy={busy === "save" || undefined}
          aria-disabled={saving || undefined}
          className={cx(reminderTone, !footer && "flex-1", softOff)}
          onClick={saveReminder}
          type="button"
        >
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
          {saved ? "Salvar alteração" : "Ativar lembrete"}
        </button>
      ) : footer ? null : (
        <button
          key="primary"
          ref={reminderButtonRef}
          aria-disabled="true"
          className={cx(reminderTone, "flex-1", softOff)}
          onClick={saveReminder}
          title="Escolha outra antecedência para atualizar"
          type="button"
        >
          <Bell className="h-4 w-4" aria-hidden />
          Atualizar lembrete
        </button>
      );
    const discard =
      saved && dirty ? (
        <button key="discard" className="btn btn-s" onClick={discardChange} type="button">
          Descartar
        </button>
      ) : null;
    const remove = saved && !dirty ? removeButton : null;
    return footer ? (
      <>
        {discard}
        {remove}
        {primary}
      </>
    ) : (
      <>
        {primary}
        {discard}
        {remove}
      </>
    );
  }

  /**
   * Ações de quem gerencia: "Editar" e o "Mais ações" (Concluir ou Reativar, Cancelar evento, Excluir).
   * No rodapé do Modal, o menu vem antes do "Editar"; no painel ao lado, o "Editar" ocupa a linha e o menu fica no fim.
   */
  function managerActions() {
    // Data da instituição (feriado, recesso, institucional) não se "conclui": passa sozinha (igual à Gestão).
    const campusDate = adminOnlyCategories.includes(event.category);
    const items: RowMenuItem<MoreAction>[] = [
      ...(active
        ? campusDate
          ? []
          : [{ id: "status" as const, label: "Concluir", icon: CheckCircle2, disabled: saving }]
        : [{ id: "status" as const, label: "Reativar", icon: RotateCcw, disabled: saving }]),
      ...(active ? [{ id: "cancelled" as const, label: "Cancelar evento", icon: X, disabled: saving }] : []),
      { id: "delete", label: "Excluir", icon: Trash2, tone: "danger", disabled: saving },
    ];
    const menu = (
      // Concluir, Cancelar e Excluir num menu: o Cancelar e o Excluir pedem confirmação (page.tsx)
      <RowMenu
        key="more"
        className="ev-more"
        label={`Mais ações de ${event.title}`}
        items={items}
        onSelect={(id) => {
          if (saving) {
            return;
          }
          if (id === "delete") {
            onDelete(event);
          } else {
            changeStatus(id === "cancelled" ? "cancelled" : active ? "completed" : reactivatedStatus(event));
          }
        }}
      />
    );
    const edit = (
      <button key="edit" className="btn btn-p" onClick={() => onEdit(event)} type="button">
        <Edit3 className="h-4 w-4" aria-hidden />
        Editar
      </button>
    );
    return side ? [edit, menu] : [menu, edit];
  }

  /** Rodapé fixo do Modal: a ação principal à vista sem rolar. Vazio, o rodapé some (cronograma.css). */
  function footerActions() {
    if (canManage) {
      return managerActions();
    }
    if (closed || (noReminderTime && !saved)) {
      return null;
    }
    return reminderActions(true);
  }

  function reminderBox() {
    if (closed) {
      if (!saved) {
        return null;
      }
      return (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
          <p className="min-w-0 flex-1 text-sm leading-5 text-ink-3">
            {cancelled
              ? "O evento foi cancelado. Seu lembrete não vale mais."
              : event.status === "completed"
                ? "O evento foi concluído. Seu lembrete não vale mais."
                : ended
                  ? "O evento já passou. Seu lembrete não vale mais."
                  : "O evento já começou. Seu lembrete não vale mais."}
          </p>
          {removeButton}
        </div>
      );
    }

    const noTime = noReminderTime;
    // sem lembrete e com o "Ativar lembrete" à vista (no corpo ou no rodapé do Modal), o selo "Sem lembrete"
    // repetia o botão: ele fica só quando já não dá para agendar
    const statePill = !saved ? (
      noTime ? (
        <span className="pill stat">
          <BellOff className="h-3 w-3" aria-hidden />
          Sem lembrete
        </span>
      ) : null
    ) : dirty ? (
      <span className="pill stat stat-alt">
        <Pencil className="h-3 w-3" aria-hidden />
        Alteração não salva
      </span>
    ) : (
      <span className="pill stat stat-conc">
        <Check className="h-3 w-3" aria-hidden />
        Ativo
      </span>
    );

    let stateText: string;
    if (!saved || !savedAt) {
      stateText = noTime
        ? `Começa em ${minutesToStart} min. Não dá mais para agendar aviso.`
        : `O aviso apareceria ${onNotice(chosenAt)}.`;
    } else if (dirty) {
      stateText = `Com ${reminderShortLabel(chosen)} de antecedência, o aviso passa a ser ${onNotice(chosenAt)}.`;
    } else {
      stateText =
        savedAt.getTime() > now
          ? `Lembrete ativo: aviso ${onNotice(savedAt)}, aqui no sistema.`
          : `Lembrete ativo: o aviso já apareceu ${onNotice(savedAt)}.`;
    }

    // painel ao lado: recolhido numa linha (título, selo do ativo e o botão que abre a antecedência).
    // Sem lembrete, o próprio botão diz isso ("Ativar lembrete") e o selo "Sem lembrete" sairia repetido
    if (side && !roomy && !reminderOpen && !noTime && !dirty) {
      // quem gerencia tem o "Editar" azul logo acima; para quem só lê, o lembrete é a ação principal
      const openTone = canManage || saved ? "btn btn-s btn-sm" : "btn btn-p btn-sm";
      return (
        <section className="ev-remind mt-5 rounded-2xl bg-surface-2 p-4" aria-labelledby={`${ids}-lembrete`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${ids}-lembrete`} className="drawer-h3 mr-auto">
              Lembrete pessoal
            </h3>
            {saved ? statePill : null}
            <button
              className={openTone}
              aria-expanded={false}
              onClick={() => {
                focusOffsets.current = true;
                setReminderOpen(true);
              }}
              type="button"
            >
              {saved ? <Pencil className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
              {saved ? "Alterar" : "Ativar lembrete"}
            </button>
          </div>
          {/* sem lembrete, uma linha diz o que o botão faz (e o painel não fica muito mais curto que a lista) */}
          <p className="field-help mt-2" role="status">
            {saved ? stateText : "O aviso chega aqui no sistema e no seu e-mail, com a antecedência que você escolher."}
          </p>
        </section>
      );
    }

    return (
      <section className="ev-remind mt-5 rounded-2xl bg-surface-2 p-4" aria-labelledby={`${ids}-lembrete`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${ids}-lembrete`} className="drawer-h3">
            Lembrete pessoal
          </h3>
          {statePill}
        </div>

        {noTime ? null : (
          <>
            <p id={`${ids}-antecedencia`} className="lbl mt-4 mb-2">
              Antecedência
            </p>
            <div ref={offsetsRef} className="chips ev-offsets" role="group" aria-labelledby={`${ids}-antecedencia`}>
              {offsets.map((minutes) => {
                const valid = isValid(minutes);
                const on = chosen === minutes;
                return (
                  <button
                    key={minutes}
                    aria-disabled={!valid || undefined}
                    aria-pressed={on}
                    className={cx("chip", on && "all", !valid && !on && "lock")}
                    onClick={() => {
                      if (valid && !saving) {
                        setReminderOffset(String(minutes));
                      }
                    }}
                    title={valid ? undefined : "Já passou"}
                    type="button"
                  >
                    {reminderShortLabel(minutes)}
                    {valid ? null : <span className="sr-only">, já passou</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <p className="field-help mt-3" role="status">
          {stateText}
        </p>

        {noTime && !saved ? null : reminderFooter ? null : (
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">{reminderActions()}</div>
        )}

        <p className="field-help mt-3">
          O aviso aparece aqui no sistema e também chega no seu <span className="whitespace-nowrap">e-mail</span>.
        </p>
      </section>
    );
  }

  const foot = footerSlot ? footerActions() : null;

  // ordem do Figma (Cronograma, agenda e detalhe; Mobile, detalhe): situação, quando, os dados,
  // a descrição e, por último, o lembrete. As ações de quem gerencia ficam entre os dados e o lembrete.
  return (
    <div ref={measureRef}>
      <div className={cx("flex flex-wrap items-center gap-2", cornerSpace && "min-h-[38px] pr-12")}>
        <span className={cx("pill", meta.tint)}>{meta.short}</span>
        <StatusPill event={event} showScheduled />
        {showsOfficialPill(event) ? <OfficialPill /> : null}
      </div>
      {/* wrap-anywhere: palavra ou link sem espaço quebra na largura do detalhe, sem alargar o painel */}
      <h2
        ref={titleRef}
        tabIndex={-1}
        className={cx(
          "disp mt-3 font-bold wrap-anywhere",
          // nomes longos do calendário oficial: a fonte diminui para a data e o "quando" aparecerem logo
          event.title.length > 70
            ? "text-[21px] leading-snug"
            : event.title.length > 40
              ? "text-[23px] leading-snug"
              : "text-[26px] leading-tight",
          cancelled && "text-muted line-through"
        )}
      >
        {event.title}
      </h2>
      <p className="sub wrap-anywhere">{sourceText(event)}</p>

      {cancelled ? (
        <p className="callout rose mt-4">
          <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Evento cancelado. Ele continua aqui só para consulta.
        </p>
      ) : null}
      {event.status === "changed" ? (
        <p className="callout amber mt-4">
          <Pencil className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Evento alterado depois de publicado. Confira a data, o horário e o local.
        </p>
      ) : null}
      {when ? (
        <p className={cx("callout mt-4 items-center", when.tone)}>
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b className="font-bold">{when.head}</b>
            {when.tail ? `, ${when.tail}` : null}
          </span>
        </p>
      ) : null}

      <dl className="info mt-5">
        <InfoLine icon={CalendarDays} label="Início" value={eventStartLabel(event)} />
        {endLabel ? <InfoLine icon={Clock} label="Término" value={endLabel} /> : null}
        {/* o dd do InfoLine (ui.tsx) já quebra palavra longa; o span do Local repete, sem break-words, que o anularia */}
        {location ? <InfoLine icon={MapPin} label="Local" value={<span className="wrap-anywhere">{location}</span>} /> : null}
        {event.subject?.name ? <InfoLine icon={BookOpen} label="Disciplina" value={event.subject.name} /> : null}
        <InfoLine icon={Users} label="Turma" value={event.academicClass?.name ?? "Toda a instituição"} />
        {/* quem publicou fica só no subtítulo ("Publicado por Profa. Maraísa"): a linha "Responsável" repetia isso
            e, na conta do responsável pelo aluno, parecia dizer que outra pessoa era a responsável */}
        {event.points !== null ? (
          <InfoLine icon={Award} label="Pontuação" value={`${event.points.toLocaleString("pt-BR")} pts (informativa)`} />
        ) : null}
      </dl>

      {event.description ? <p className="callout past mt-5 whitespace-pre-line wrap-anywhere">{event.description}</p> : null}

      {/* painel ao lado: as mesmas ações do rodapé do Modal, numa linha ("Editar" e o "Mais ações"), no lugar
          da grade de 4 botões */}
      {canManage && !inFooter ? (
        <div className="ev-foot-in ev-side-act mt-5" role="group" aria-label="Ações do evento">
          {managerActions()}
        </div>
      ) : null}

      {reminderBox()}

      {footerSlot && foot ? createPortal(<div className="ev-foot-in" role="group" aria-label="Ações do evento">{foot}</div>, footerSlot) : null}
    </div>
  );
}

export function EmptyDetail() {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="empty-ico">
        <PanelRightOpen className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[15px] font-bold">Selecione um evento</p>
      <p className="max-w-[240px] text-[13px] leading-5 text-muted">
        Os detalhes, o lembrete pessoal e as ações aparecem aqui.
      </p>
    </div>
  );
}

export function eventDetailSavingSpinner(saving: boolean) {
  return saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null;
}
