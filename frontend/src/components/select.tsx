"use client";

import { zonedNowMs } from "@/lib/zone";
import { Check, ChevronDown, CircleAlert, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Popover ancorado: portal, posição que respeita a borda, folha no celular */
/* ------------------------------------------------------------------ */

/** Abaixo desta largura o popover vira folha de baixo (alvos de 44 px, sem ficar preso ao botão). */
const SHEET_QUERY = "(max-width: 639px)";

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
}
const subscribeSheet = subscribeMedia(SHEET_QUERY);

/** Verdadeiro abaixo de 640 px: o popover abre como folha de baixo. */
export function useSheetMode() {
  return useSyncExternalStore(
    subscribeSheet,
    () => window.matchMedia(SHEET_QUERY).matches,
    () => false
  );
}

/**
 * Onde o popover entra: dentro do diálogo aberto (o painel do Drawer, o véu do Modal), para ficar na camada de
 * cima (fora dela a página está inerte) e no Tab do diálogo; fora de diálogo, no body.
 */
export function popoverHost(anchor: HTMLElement | null) {
  if (!anchor) {
    return null;
  }
  return anchor.closest<HTMLElement>('[aria-modal="true"]') ?? document.body;
}

type PlaceOptions = {
  /** Distância do botão. */
  gap?: number;
  /** Largura mínima; o popover acompanha a largura do botão quando ela é maior. */
  minWidth?: number;
  /** Largura fixa (ex.: 332 no seletor de mês), limitada à tela. */
  width?: number;
  /** Altura máxima no computador. */
  maxHeight?: number;
  /** Folha de baixo: a posição fica com o CSS. */
  sheet?: boolean;
};

/**
 * Posiciona um popover `position: fixed` junto do botão: abaixo dele quando a lista inteira cabe ali; senão acima,
 * quando cabe acima; senão do lado com mais espaço, com a altura limitada a ele (a lista rola por dentro). Fica
 * dentro da tela (8 px de folga nas bordas). Segue a rolagem de qualquer caixa (o corpo do Drawer) e a mudança de
 * tamanho, mas não a rolagem de dentro do próprio popover. `deps` repete a conta quando o conteúdo muda (ex.: a
 * busca filtrou a lista).
 */
export function useAnchoredPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  { gap = 6, maxHeight = 360, minWidth = 0, sheet = false, width }: PlaceOptions,
  deps: unknown = null
) {
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!open || !pop) {
      return;
    }
    if (sheet) {
      pop.style.removeProperty("left");
      pop.style.removeProperty("top");
      pop.style.removeProperty("width");
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
      const box = anchor.getBoundingClientRect();
      const viewW = document.documentElement.clientWidth;
      const viewH = window.innerHeight;
      const w = Math.min(viewW - margin * 2, width ?? Math.max(box.width, minWidth));
      pop.style.width = `${w}px`;
      // origem do posicionamento: um ancestral com transform (o painel durante a animação de entrada) muda o
      // ponto (0, 0) do fixed. Uma sonda fixed em 0,0 ao lado do popover mostra onde ele fica (o popover em si
      // não serve: a animação de entrada dele também desloca).
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none";
      pop.parentElement?.insertBefore(probe, pop);
      const origin = probe.getBoundingClientRect();
      probe.remove();
      // altura natural: sem o limite, a lista some com a rolagem e o navegador zera o scrollTop dela. Guarda e
      // devolve a rolagem das caixas de dentro (senão a lista volta para o topo a cada conta)
      const scrolled = Array.from(pop.querySelectorAll<HTMLElement>("*"))
        .filter((element) => element.scrollTop > 0)
        .map((element) => [element, element.scrollTop] as const);
      pop.style.maxHeight = "none";
      const natural = Math.min(pop.offsetHeight, maxHeight);
      const below = viewH - box.bottom - gap - margin;
      const above = box.top - gap - margin;
      // para baixo se a lista inteira cabe; senão para cima se cabe lá; senão o lado com mais espaço
      const down = below >= natural || (above < natural && below >= above);
      const room = Math.max(120, down ? below : above);
      const height = Math.min(natural, room);
      const top = down ? box.bottom + gap : box.top - gap - height;
      const left = Math.min(Math.max(margin, box.left), viewW - margin - w);
      pop.style.maxHeight = `${Math.min(maxHeight, room)}px`;
      pop.style.left = `${Math.round(left - origin.left)}px`;
      pop.style.top = `${Math.round(top - origin.top)}px`;
      pop.dataset.side = down ? "bottom" : "top";
      for (const [element, scrollTop] of scrolled) {
        element.scrollTop = scrollTop;
      }
    };
    const schedule = (event?: Event) => {
      // a rolagem da própria lista (roda, toque, barra, teclado) não muda a posição do popover
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
  }, [open, anchorRef, popRef, gap, maxHeight, minWidth, sheet, width, deps]);
}

/** Fecha ao tocar fora do botão e do popover. */
export function useOutsidePress(open: boolean, refs: RefObject<HTMLElement | null>[], onOutside: () => void) {
  const handler = useRef(onOutside);
  useEffect(() => {
    handler.current = onOutside;
  });
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && refs.some((ref) => ref.current?.contains(target))) {
        return;
      }
      handler.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
    // refs são objetos estáveis (useRef)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

export type SelectOption<V extends string = string> = {
  value: V;
  label: string;
  /** Segunda linha, menor ("manhã e tarde"). */
  description?: string;
  /** Contagem à direita ("12"), em números tabulares. */
  count?: number | string;
  /** Título do grupo. Opções do mesmo grupo ficam juntas, na ordem em que o grupo aparece primeiro. */
  group?: string;
  disabled?: boolean;
  /** Ícone ou ponto de cor antes do nome. */
  icon?: ReactNode;
  /** Etiqueta à direita (ex.: um aviso "TADS 5 já usa este turno"). */
  badge?: ReactNode;
  /** Texto extra para a busca (sigla, código). */
  keywords?: string;
};

export type SelectProps<V extends string = string> = {
  value: V | null | undefined;
  onChange: (value: V, option: SelectOption<V>) => void;
  options: SelectOption<V>[];
  /** Rótulo visível acima do botão. Sem ele, passe `ariaLabel`. */
  label?: ReactNode;
  /** Nome para o leitor de tela quando não há rótulo visível (ex.: filtros). */
  ariaLabel?: string;
  /** Texto do botão sem valor. Padrão "Escolha". */
  placeholder?: string;
  /** Prefixo dentro do botão ("Turma:"), para filtros. */
  prefix?: string;
  /** "md" (44 px) ou "sm" (36 px; 44 px no toque). */
  size?: "md" | "sm";
  /**
   * "field" (campo de formulário), "filter" (botão de filtro, como "Curso: Todos") ou "bare" (botão sem aparência
   * própria, transparente e do tamanho do bloco que o contém: o bloco do aluno acompanhado no menu, que só ganha a lista).
   */
  variant?: "field" | "filter" | "bare";
  /** Filtro aplicado: botão em azul. */
  active?: boolean;
  /**
   * Limpa o filtro. Com `active`, o botão mostra um X de 24 px (no lugar da seta) com aria-label
   * "Limpar <rótulo>"; ao limpar, o foco volta para o botão do Select.
   */
  onClear?: () => void;
  /** "full" ocupa a largura toda (padrão do field); "auto" fica do tamanho do conteúdo (padrão do filter). */
  width?: "full" | "auto";
  invalid?: boolean;
  /** Mensagem de erro abaixo do botão (também marca como inválido). */
  error?: string;
  /** Dica abaixo do botão. */
  hint?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** Busca no topo da lista. Padrão: só com mais de 8 opções. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Texto quando a busca não acha nada. */
  emptyText?: string;
  /** Largura mínima da lista, quando o botão é estreito. */
  menuMinWidth?: number;
  /** Nome do campo num formulário: grava um input hidden com o valor. */
  name?: string;
  id?: string;
  className?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
};

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Opções na ordem em que aparecem na lista: agrupadas, cada grupo na ordem em que aparece primeiro. */
function groupedOrder<V extends string>(options: SelectOption<V>[]) {
  const order: (string | undefined)[] = [];
  const byGroup = new Map<string | undefined, SelectOption<V>[]>();
  for (const option of options) {
    if (!byGroup.has(option.group)) {
      byGroup.set(option.group, []);
      order.push(option.group);
    }
    byGroup.get(option.group)!.push(option);
  }
  return order.flatMap((group) => byGroup.get(group)!);
}

type Section<V extends string> = { group?: string; items: { option: SelectOption<V>; index: number }[] };

/**
 * Select próprio (padrão combobox + listbox da WAI-ARIA), no lugar do select nativo.
 *
 * Teclado: setas, Home, End, PageUp e PageDown andam; letras pulam para a opção; Enter ou espaço escolhem; Esc
 * fecha e devolve o foco ao botão (sem fechar o Drawer/Modal em volta); Tab fecha. Com mais de 8 opções aparece
 * a busca. O popover vai num portal (dentro do diálogo aberto, quando há um) e respeita as bordas da tela;
 * abaixo de 640 px abre como folha de baixo.
 *
 *   <Select label="Turno" value={turno} onChange={setTurno}
 *     options={[{ value: "manha", label: "Matutino" }, { value: "integral", label: "Integral", description: "manhã e tarde" }]} />
 */
export function Select<V extends string = string>({
  active: filterActive,
  ariaLabel,
  buttonRef: externalButtonRef,
  className,
  disabled,
  emptyText = "Nada encontrado",
  error,
  hint,
  id,
  invalid,
  label,
  menuMinWidth,
  name,
  onChange,
  onClear,
  options,
  placeholder = "Escolha",
  prefix,
  required,
  searchable,
  searchPlaceholder = "Buscar",
  size = "md",
  value,
  variant = "field",
  width,
}: SelectProps<V>) {
  const autoId = useId();
  const baseId = id ?? `sel${autoId.replace(/:/g, "")}`;
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const valueId = `${baseId}-value`;
  const helpId = `${baseId}-help`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const ownButtonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // opção ativa (a do realce) pelo valor: a busca muda a lista sem perder a conta
  const [activeValue, setActiveValue] = useState<V | null>(null);
  const sheet = useSheetMode();
  const [host, setHost] = useState<HTMLElement | null>(null);

  const withSearch = searchable ?? options.length > 8;
  const isInvalid = Boolean(invalid || error);
  const selected = options.find((option) => option.value === value) ?? null;
  const fullWidth = (width ?? (variant === "filter" ? "auto" : "full")) === "full";
  const showClear = Boolean(onClear && filterActive && !disabled);
  // "Limpar disciplina": o rótulo visível, o nome do filtro ou o prefixo sem os dois-pontos
  const clearName = (typeof label === "string" ? label : (ariaLabel ?? prefix?.replace(/:\s*$/, "") ?? "filtro")).trim();
  const clearLabel = `Limpar ${clearName.charAt(0).toLowerCase()}${clearName.slice(1)}`;

  const setButton = useCallback(
    (element: HTMLButtonElement | null) => {
      ownButtonRef.current = element;
      if (externalButtonRef) {
        externalButtonRef.current = element;
      }
    },
    [externalButtonRef]
  );

  // opções visíveis (busca), na ordem dos grupos
  const { sections, visible } = useMemo(() => {
    const needle = normalize(query);
    const filtered = needle
      ? options.filter((option) =>
          normalize(`${option.label} ${option.description ?? ""} ${option.group ?? ""} ${option.keywords ?? ""}`).includes(needle)
        )
      : options;
    const order: (string | undefined)[] = [];
    const byGroup = new Map<string | undefined, SelectOption<V>[]>();
    for (const option of filtered) {
      if (!byGroup.has(option.group)) {
        byGroup.set(option.group, []);
        order.push(option.group);
      }
      byGroup.get(option.group)!.push(option);
    }
    const flat: SelectOption<V>[] = [];
    const list: Section<V>[] = order.map((group) => ({
      group,
      items: byGroup.get(group)!.map((option) => {
        flat.push(option);
        return { option, index: flat.length - 1 };
      }),
    }));
    return { sections: list, visible: flat };
  }, [options, query]);

  const enabledIndex = useCallback(
    (from: number, step: 1 | -1) => {
      for (let index = from; index >= 0 && index < visible.length; index += step) {
        if (!visible[index].disabled) {
          return index;
        }
      }
      return -1;
    },
    [visible]
  );

  const pickedIndex = activeValue === null ? -1 : visible.findIndex((option) => option.value === activeValue);
  const activeIndex = open ? (pickedIndex >= 0 && !visible[pickedIndex].disabled ? pickedIndex : enabledIndex(0, 1)) : -1;
  const setActiveIndex = (index: number) => setActiveValue(index >= 0 && visible[index] ? visible[index].value : null);

  function openList(target: "selected" | "first" | "last" | { value: V } = "selected") {
    if (disabled) {
      return;
    }
    // ao abrir, a lista é a completa (a busca começa vazia), na ordem dos grupos
    const full = groupedOrder(options);
    const enabled = full.filter((option) => !option.disabled);
    let start: V | null = null;
    if (target === "first") {
      start = enabled[0]?.value ?? null;
    } else if (target === "last") {
      start = enabled[enabled.length - 1]?.value ?? null;
    } else {
      const wanted = typeof target === "object" ? target.value : value;
      start = enabled.find((option) => option.value === wanted)?.value ?? enabled[0]?.value ?? null;
    }
    setActiveValue(start);
    setQuery("");
    setHost(popoverHost(ownButtonRef.current));
    setOpen(true);
  }

  function closeList(returnFocus = true) {
    if (returnFocus) {
      // o foco volta antes de a lista sair: assim ele não cai no body (o Drawer puxaria para o painel)
      ownButtonRef.current?.focus({ preventScroll: true });
    }
    setOpen(false);
    setQuery("");
  }

  function choose(index: number) {
    const option = visible[index];
    if (!option || option.disabled) {
      return;
    }
    closeList();
    if (option.value !== value) {
      onChange(option.value, option);
    }
  }

  // a busca recebe o foco ao abrir (no toque, não: o teclado da tela cobriria a folha)
  useLayoutEffect(() => {
    const input = searchRef.current;
    if (open && withSearch && input && !window.matchMedia("(pointer: coarse)").matches) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [open, withSearch]);

  useAnchoredPosition(
    open,
    ownButtonRef,
    popRef,
    { minWidth: Math.max(menuMinWidth ?? 0, variant === "filter" ? 280 : 0), sheet, maxHeight: 420 },
    `${visible.length}-${host ? 1 : 0}`
  );

  // a opção ativa fica à vista dentro da lista: ao abrir, no meio (com vizinhas dos dois lados); andando pelo
  // teclado, só o necessário. Rola só a lista (scrollIntoView rolaria também a página por baixo). Vem depois do
  // useAnchoredPosition: a altura da lista já está limitada quando a conta é feita.
  const scrolledOpen = useRef(false);
  useLayoutEffect(() => {
    if (!open) {
      scrolledOpen.current = false;
      return;
    }
    const list = listRef.current;
    const element = activeIndex >= 0 ? document.getElementById(optionId(activeIndex)) : null;
    if (!list || !element) {
      return;
    }
    const first = !scrolledOpen.current;
    scrolledOpen.current = true;
    if (list.scrollHeight <= list.clientHeight) {
      return;
    }
    const box = list.getBoundingClientRect();
    const item = element.getBoundingClientRect();
    const pad = 4;
    if (first) {
      list.scrollTop += item.top + item.height / 2 - (box.top + box.height / 2);
    } else if (item.top < box.top + pad) {
      list.scrollTop -= box.top + pad - item.top;
    } else if (item.bottom > box.bottom - pad) {
      list.scrollTop += item.bottom - (box.bottom - pad);
    }
    // optionId depende só do baseId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex, host]);
  useOutsidePress(open && !sheet, [ownButtonRef, popRef], () => closeList(false));

  function typeAhead(key: string) {
    const now = zonedNowMs();
    const state = typed.current;
    state.text = now - state.at > 600 ? key : state.text + key;
    state.at = now;
    const needle = normalize(state.text);
    // a mesma letra repetida anda entre as opções que começam com ela
    const repeated = needle.length > 1 && needle.split("").every((char) => char === needle[0]);
    const search = repeated ? needle[0] : needle;
    const list = open ? visible : options;
    const from = open ? activeIndex : list.findIndex((option) => option.value === value);
    const startAt = repeated || search.length === 1 ? from + 1 : Math.max(from, 0);
    for (let step = 0; step < list.length; step += 1) {
      const index = (startAt + step) % list.length;
      const option = list[index];
      if (!option.disabled && normalize(option.label).startsWith(search)) {
        return index;
      }
    }
    return -1;
  }

  function onListKey(event: ReactKeyboardEvent<HTMLElement>, fromSearch: boolean) {
    const { key } = event;
    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }
    if (key === "Tab") {
      // fecha e deixa o Tab seguir a partir do botão
      closeList();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (event.altKey && key === "ArrowUp") {
        choose(activeIndex);
        return;
      }
      const step = key === "ArrowDown" ? 1 : -1;
      const next = enabledIndex(activeIndex + step, step);
      if (next >= 0) {
        setActiveIndex(next);
      }
      return;
    }
    if ((key === "Home" || key === "End") && !fromSearch) {
      event.preventDefault();
      setActiveIndex(key === "Home" ? enabledIndex(0, 1) : enabledIndex(visible.length - 1, -1));
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      event.preventDefault();
      const step = key === "PageDown" ? 1 : -1;
      const target = Math.min(visible.length - 1, Math.max(0, activeIndex + step * 8));
      const next = enabledIndex(target, step) >= 0 ? enabledIndex(target, step) : enabledIndex(target, step === 1 ? -1 : 1);
      if (next >= 0) {
        setActiveIndex(next);
      }
      return;
    }
    if (key === "Enter" || (key === " " && !fromSearch)) {
      event.preventDefault();
      if (activeIndex >= 0) {
        choose(activeIndex);
      }
      return;
    }
    if (!fromSearch && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const found = typeAhead(key);
      if (found >= 0) {
        setActiveIndex(found);
      }
    }
  }

  function onButtonKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (open) {
      if (withSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // a busca está aberta mas o foco ficou no botão (toque): a letra vai para a busca
        searchRef.current?.focus();
        return;
      }
      onListKey(event, false);
      return;
    }
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
      event.preventDefault();
      openList(key === "ArrowUp" && !event.altKey && !selected ? "last" : "selected");
      return;
    }
    if (key === "Home" || key === "End") {
      event.preventDefault();
      openList(key === "Home" ? "first" : "last");
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (withSearch) {
        openList();
        setQuery(key);
        return;
      }
      const found = typeAhead(key);
      openList(found >= 0 ? { value: options[found].value } : "selected");
    }
  }

  const activeId = open && activeIndex >= 0 && visible[activeIndex] ? optionId(activeIndex) : undefined;
  const describedBy = error || hint ? helpId : undefined;
  const nameProps = label ? { "aria-labelledby": labelId } : { "aria-label": ariaLabel };

  const pop =
    open && host
      ? createPortal(
          <>
            {sheet ? <div className="select-scrim" aria-hidden onPointerDown={() => closeList(false)} /> : null}
            <div
              ref={popRef}
              className={cx("select-pop", sheet && "is-sheet", size === "sm" && "sm")}
              data-side="bottom"
              // o foco fica no botão (ou na busca): clicar numa opção não tira o foco
              onMouseDown={(event) => {
                if (event.target !== searchRef.current) {
                  event.preventDefault();
                }
              }}
            >
              {sheet && (label || ariaLabel) ? (
                <div className="select-sheet-head" aria-hidden>
                  {label ?? ariaLabel}
                </div>
              ) : null}
              {withSearch ? (
                <div className="select-search">
                  <Search className="select-search-ico" aria-hidden />
                  <input
                    ref={searchRef}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    aria-label={`${searchPlaceholder}${ariaLabel ? ` em ${ariaLabel}` : ""}`}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={searchPlaceholder}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveValue(null);
                    }}
                    onKeyDown={(event) => onListKey(event, true)}
                  />
                </div>
              ) : null}
              <div
                ref={listRef}
                id={listId}
                role="listbox"
                className="select-list"
                aria-labelledby={label ? labelId : undefined}
                aria-label={label ? undefined : ariaLabel}
              >
                {visible.length === 0 ? (
                  <div className="select-empty" role="presentation">
                    {emptyText}
                  </div>
                ) : (
                  sections.map((section, sectionIndex) => {
                    const items = section.items.map(({ option, index }) => {
                      const isSelected = option.value === value;
                      return (
                        <div
                          key={option.value}
                          id={optionId(index)}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={option.disabled || undefined}
                          className={cx("select-opt", isSelected && "is-selected", index === activeIndex && "is-active")}
                          onMouseMove={() => {
                            if (!option.disabled && index !== activeIndex) {
                              setActiveIndex(index);
                            }
                          }}
                          onClick={() => choose(index)}
                        >
                          <span className="select-ck" aria-hidden>
                            {isSelected ? <Check className="h-4 w-4" strokeWidth={2.25} /> : null}
                          </span>
                          {option.icon ? <span className="select-ico">{option.icon}</span> : null}
                          <span className="select-txt">
                            <b>{option.label}</b>
                            {option.description ? <span>{option.description}</span> : null}
                          </span>
                          {option.badge ? <span className="select-badge">{option.badge}</span> : null}
                          {option.count !== undefined ? <span className="select-count">{option.count}</span> : null}
                        </div>
                      );
                    });
                    if (!section.group) {
                      return <div key={`s${sectionIndex}`} role="presentation">{items}</div>;
                    }
                    const groupId = `${baseId}-g${sectionIndex}`;
                    return (
                      <div key={`g${sectionIndex}`} role="group" aria-labelledby={groupId} className="select-group">
                        <div id={groupId} className="select-group-title" role="presentation">
                          {section.group}
                        </div>
                        {items}
                      </div>
                    );
                  })
                )}
              </div>
              {!sheet ? (
                // cada tecla fica junto da sua ação: o par não quebra, a linha quebra entre os pares
                <div className="select-foot" aria-hidden>
                  <span className="select-key">
                    <span className="kbd">↑↓</span>
                    navega
                  </span>
                  <span className="select-key">
                    <span className="kbd">Enter</span>
                    escolhe
                  </span>
                  <span className="select-key">
                    <span className="kbd">Esc</span>
                    fecha
                  </span>
                </div>
              ) : null}
            </div>
          </>,
          host
        )
      : null;

  return (
    <div className={cx("select", fullWidth ? "is-full" : "is-auto", className)}>
      {label ? (
        <span id={labelId} className="select-label" onClick={() => ownButtonRef.current?.focus()}>
          {label}
          {required ? <span className="select-req" aria-hidden> *</span> : null}
        </span>
      ) : null}
      <span className={cx("select-ctl", showClear && "has-clear")}>
        <button
          ref={setButton}
          id={baseId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && !withSearch ? activeId : undefined}
          aria-invalid={isInvalid || undefined}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          {...nameProps}
          disabled={disabled}
          className={cx(
            "select-btn",
            variant === "filter" && "is-filter",
            variant === "bare" && "is-bare",
            filterActive && "is-on",
            size === "sm" && "sm",
            open && "is-open",
            isInvalid && "is-invalid"
          )}
          onClick={() => (open ? closeList() : openList())}
          onKeyDown={onButtonKey}
        >
          {prefix ? <span className="select-prefix">{prefix}</span> : null}
          <span id={valueId} className={cx("select-value", !selected && "is-placeholder")}>
            {selected ? selected.label : placeholder}
          </span>
          {showClear ? null : <ChevronDown className="select-chev" aria-hidden />}
        </button>
        {showClear ? (
          // fora do botão do Select (botão dentro de botão não vale), no lugar da seta
          <button
            type="button"
            className="select-clear"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => {
              onClear?.();
              // o X some junto com o filtro: o foco volta para o Select, e não para o body
              requestAnimationFrame(() => ownButtonRef.current?.focus({ preventScroll: true }));
            }}
          >
            <X aria-hidden />
          </button>
        ) : null}
      </span>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      {error ? (
        <p id={helpId} className="field-error select-error">
          <CircleAlert aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <span id={helpId} className="select-hint">
          {hint}
        </span>
      ) : null}
      {pop}
    </div>
  );
}
