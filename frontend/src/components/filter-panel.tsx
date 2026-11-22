"use client";

import { Check, ChevronDown, Funnel } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";
import { popoverHost, useOutsidePress, useSheetMode } from "./select";

/* ------------------------------------------------------------------ */
/* Painel de filtro recolhível (Cronograma)                            */
/* ------------------------------------------------------------------ */

export type FilterOption = {
  value: string;
  label: string;
  /** Contagem à direita, em números tabulares. */
  count?: number;
  /** Segunda linha, menor ("Datas sem turma, para todos"). */
  description?: string;
  /** Ponto de cor (ou ícone) antes do nome. */
  mark?: ReactNode;
  /** Título de grupo logo acima desta opção (na primeira de cada grupo). */
  groupTitle?: string;
  selected: boolean;
};

export type FilterSection = {
  id: string;
  title: string;
  /** Valor atual, à direita do título ("Todas"). */
  summary: string;
  /** Contagem do valor atual ("127"). */
  summaryCount?: number;
  options: FilterOption[];
  /** Escolher aplica na hora (o painel continua aberto). */
  onPick: (value: string) => void;
  /** Aberta na primeira vez que o painel abre. */
  defaultOpen?: boolean;
};

type FilterPanelProps = {
  /** Nome do botão e do painel. */
  label?: string;
  /** Rótulo curto do que está escolhido ("Provas"); null sem filtro. */
  activeLabel: string | null;
  sections: FilterSection[];
  /** Texto do botão do pé ("Ver 124 eventos"): ele só fecha o painel. */
  doneLabel: string;
  /** "Limpar" no alto do painel, quando há algo escolhido nele. */
  onClear?: () => void;
  /** "Limpar" ao lado do botão (decide quem usa, por exemplo para não repetir a ação do estado vazio). */
  outsideClear?: { label: string; onClear: () => void } | null;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  className?: string;
};

/** Itens do painel que as setas percorrem, na ordem da tela. */
const NAV = "[data-fp-item]";

/**
 * Posição do painel (position: fixed) junto do botão: embaixo quando cabe (senão em cima, ou do lado com mais
 * espaço, com a altura limitada e o corpo rolando por dentro). Alinha pela direita do botão quando ele fica na
 * metade direita da tela, senão pela esquerda, sempre dentro da tela. Na folha de baixo, a posição é do CSS.
 */
function usePanelPlacement(
  open: boolean,
  sheet: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  deps: unknown
) {
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!open || !pop) {
      return;
    }
    if (sheet) {
      pop.style.removeProperty("left");
      pop.style.removeProperty("top");
      pop.style.removeProperty("max-height");
      pop.dataset.side = "sheet";
      return;
    }
    let frame = 0;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor || !pop.isConnected) {
        return;
      }
      const margin = 8;
      const gap = 8;
      const box = anchor.getBoundingClientRect();
      const viewW = document.documentElement.clientWidth;
      const viewH = window.innerHeight;
      // altura natural sem o limite (guardando a rolagem do corpo, que voltaria ao topo)
      const body = pop.querySelector<HTMLElement>(".fp-body");
      const scrolled = body?.scrollTop ?? 0;
      pop.style.maxHeight = "none";
      const natural = pop.offsetHeight;
      const width = pop.offsetWidth;
      const below = viewH - box.bottom - gap - margin;
      const above = box.top - gap - margin;
      const down = below >= natural || below >= above;
      const room = Math.max(200, down ? below : above);
      const height = Math.min(natural, room);
      const alignEnd = box.left + box.width / 2 > viewW / 2;
      const left = Math.min(Math.max(margin, alignEnd ? box.right - width : box.left), viewW - margin - width);
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(down ? box.bottom + gap : box.top - gap - height)}px`;
      pop.style.maxHeight = `${Math.round(room)}px`;
      pop.dataset.side = down ? "bottom" : "top";
      if (body) {
        body.scrollTop = scrolled;
      }
    };
    const schedule = (event?: Event) => {
      // a rolagem de dentro do painel não muda a posição dele
      if (event?.type === "scroll" && event.target instanceof Node && pop.contains(event.target)) {
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [open, sheet, anchorRef, popRef, deps]);
}

/**
 * Botão de filtro (funil) que abre um painel flutuante não modal com seções recolhíveis. Cada opção é um botão com
 * aria-pressed e aplica na hora; o botão do pé só fecha. Teclado: as setas andam pelos itens (Home e End vão às
 * pontas; à direita e à esquerda abrem e recolhem a seção), Tab segue dentro do painel e, nas pontas, fecha e
 * continua a partir do botão; Esc fecha. Fechar devolve o foco ao botão. Abaixo de 640 px o painel vira folha de
 * baixo, como o Select.
 */
export function FilterPanel({
  activeLabel,
  buttonRef: externalButtonRef,
  className,
  doneLabel,
  label = "Filtros",
  onClear,
  outsideClear,
  sections,
}: FilterPanelProps) {
  const baseId = `fp${useId().replace(/:/g, "")}`;
  const panelId = `${baseId}-panel`;
  const titleId = `${baseId}-title`;
  const ownButtonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const sheet = useSheetMode();
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  // seções abertas: a escolha da pessoa fica enquanto a tela está montada
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((section) => [section.id, Boolean(section.defaultOpen)]))
  );
  const isExpanded = (section: FilterSection) => expanded[section.id] ?? Boolean(section.defaultOpen);

  const setButton = useCallback(
    (element: HTMLButtonElement | null) => {
      ownButtonRef.current = element;
      if (externalButtonRef) {
        externalButtonRef.current = element;
      }
    },
    [externalButtonRef]
  );

  const close = useCallback((returnFocus = true) => {
    if (returnFocus) {
      // o foco volta antes de o painel sair: assim ele não cai no body
      ownButtonRef.current?.focus({ preventScroll: true });
    }
    setOpen(false);
  }, []);

  function openPanel() {
    setHost(popoverHost(ownButtonRef.current));
    setOpen(true);
  }

  // ao abrir, o foco vai para a opção escolhida da primeira seção aberta (senão, para o primeiro item)
  useEffect(() => {
    const pop = popRef.current;
    if (!open || !pop) {
      return;
    }
    const target =
      pop.querySelector<HTMLElement>('.fp-sec.is-open [data-fp-item][aria-pressed="true"]') ??
      pop.querySelector<HTMLElement>(NAV);
    target?.focus({ preventScroll: true });
  }, [open, host]);

  const openKey = sections.map((section) => `${section.id}:${isExpanded(section) ? 1 : 0}:${section.options.length}`).join("|");
  usePanelPlacement(open, sheet, ownButtonRef, popRef, `${openKey}-${host ? 1 : 0}`);
  useOutsidePress(open && !sheet, [ownButtonRef, popRef], () => close(false));

  // o foco que sai para outro lugar da página (atalho de busca, clique) fecha o painel, sem puxar o foco de volta
  useEffect(() => {
    const pop = popRef.current;
    if (!open || !pop) {
      return;
    }
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !pop.contains(next) && !ownButtonRef.current?.contains(next)) {
        setOpen(false);
      }
    };
    pop.addEventListener("focusout", onFocusOut);
    return () => pop.removeEventListener("focusout", onFocusOut);
  }, [open, host]);

  function navItems() {
    return Array.from(popRef.current?.querySelectorAll<HTMLElement>(NAV) ?? []).filter(
      (element) => !element.closest("[hidden]")
    );
  }

  function toggleSection(section: FilterSection, value?: boolean) {
    setExpanded((current) => ({ ...current, [section.id]: value ?? !isExpanded(section) }));
  }

  function onPanelKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const { key } = event;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const items = navItems();
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (key === "Tab") {
      // nas pontas, o Tab sai do painel: fecha e segue a partir do botão (para a frente, o próximo controle da
      // barra; para trás, o próprio botão)
      if (!event.shiftKey && index === items.length - 1) {
        close();
      } else if (event.shiftKey && index <= 0) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      const next =
        key === "Home"
          ? 0
          : key === "End"
            ? items.length - 1
            : Math.min(items.length - 1, Math.max(0, index + (key === "ArrowDown" ? 1 : -1)));
      items[next]?.focus();
    }
  }

  function clearInPanel() {
    if (!onClear) {
      return;
    }
    // o "Limpar" some junto com o filtro: o foco vai antes para a primeira opção da primeira seção aberta
    const first = popRef.current?.querySelector<HTMLElement>(".fp-sec.is-open .fp-opt") ?? popRef.current?.querySelector<HTMLElement>(NAV);
    first?.focus({ preventScroll: true });
    onClear();
  }

  const pop =
    open && host
      ? createPortal(
          <>
            {sheet ? <div className="select-scrim" aria-hidden onPointerDown={() => close(false)} /> : null}
            <div
              ref={popRef}
              id={panelId}
              role="dialog"
              aria-labelledby={titleId}
              className={cx("fp-pop", sheet && "is-sheet")}
              data-side="bottom"
              onKeyDown={onPanelKey}
            >
              <div className="fp-head">
                <h2 id={titleId} className="fp-title">
                  {label}
                </h2>
                {onClear && activeLabel ? (
                  <button className="link fp-head-clear" data-fp-item onClick={clearInPanel} type="button" aria-label={`Limpar ${label.toLowerCase()}`}>
                    Limpar
                  </button>
                ) : null}
              </div>
              <div className="fp-body">
                {sections.map((section) => {
                  const sectionOpen = isExpanded(section);
                  const bodyId = `${baseId}-${section.id}`;
                  const headId = `${bodyId}-h`;
                  return (
                    <section key={section.id} className={cx("fp-sec", sectionOpen && "is-open")}>
                      <h3 className="fp-sec-title">
                        <button
                          aria-controls={bodyId}
                          aria-expanded={sectionOpen}
                          className="fp-sec-h"
                          data-fp-item
                          onClick={() => toggleSection(section)}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                              event.preventDefault();
                              toggleSection(section, event.key === "ArrowRight");
                            }
                          }}
                          type="button"
                        >
                          <span id={headId} className="fp-sec-t">
                            {section.title}
                          </span>
                          <span className="fp-sec-v">
                            <span className="fp-sec-val">{section.summary}</span>
                            {section.summaryCount !== undefined ? (
                              <>
                                <span className="sr-only">, </span>
                                <span className="fp-sec-n">{section.summaryCount}</span>
                              </>
                            ) : null}
                          </span>
                          <ChevronDown className="fp-chev" aria-hidden />
                        </button>
                      </h3>
                      <div id={bodyId} className="fp-opts" role="group" aria-labelledby={headId} hidden={!sectionOpen}>
                        {section.options.map((option) => (
                          <Fragment key={option.value}>
                            {option.groupTitle ? (
                              <div className="fp-group" aria-hidden>
                                {option.groupTitle}
                              </div>
                            ) : null}
                            <button
                              aria-pressed={option.selected}
                              className={cx("fp-opt", option.selected && "is-on")}
                              data-fp-item
                              onClick={() => section.onPick(option.value)}
                              type="button"
                            >
                              {option.mark ? <span className="fp-mark">{option.mark}</span> : null}
                              <span className="fp-txt">
                                <b>{option.label}</b>
                                {option.description ? <span>{option.description}</span> : null}
                              </span>
                              {option.count !== undefined ? <span className="fp-n">{option.count}</span> : null}
                              <span className="fp-ck" aria-hidden>
                                {option.selected ? <Check strokeWidth={2.5} /> : null}
                              </span>
                            </button>
                          </Fragment>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="fp-foot">
                <button className="btn btn-p fp-done" data-fp-item onClick={() => close()} type="button">
                  {doneLabel}
                </button>
              </div>
            </div>
          </>,
          host
        )
      : null;

  return (
    <div className={cx("fp", className)}>
      <button
        ref={setButton}
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx("btn btn-s fp-btn", activeLabel && "is-on", open && "is-open")}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={(event) => {
          if (!open && event.key === "ArrowDown") {
            event.preventDefault();
            openPanel();
          }
        }}
        type="button"
      >
        <span className={cx("fp-ico", activeLabel && "has-dot")} aria-hidden>
          <Funnel />
        </span>
        {label}
        {activeLabel ? <span className="fp-tag">{activeLabel}</span> : null}
      </button>
      {outsideClear ? (
        <button className="link fp-clear" aria-label={outsideClear.label} onClick={outsideClear.onClear} type="button">
          Limpar
        </button>
      ) : null}
      {pop}
    </div>
  );
}
