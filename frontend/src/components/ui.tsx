"use client";

import {
  Check,
  CircleAlert,
  Info,
  Loader2,
  RefreshCw,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Botões (classes do protótipo no Figma, ver globals.css)             */
/* ------------------------------------------------------------------ */

export const primaryButton = "btn btn-p";

export const secondaryButton = "btn btn-s";

export const dangerButton = "btn btn-danger";

export const iconButton = "ib sm";

// ocupado: o botão continua focável (aria-disabled), para o foco não cair no body
const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/* ------------------------------------------------------------------ */
/* Formulário                                                          */
/* ------------------------------------------------------------------ */

type ControlProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
};

const nativeControls = new Set(["input", "select", "textarea"]);

export function Field({
  children,
  className,
  error,
  errorId,
  hint,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Mensagem mostrada abaixo do campo, fora do rótulo. */
  error?: string;
  /** id da mensagem, para o aria-describedby do campo. */
  errorId?: string;
  hint?: string;
  label: string;
}) {
  const autoId = useId();
  const messageId = errorId ?? `${autoId}-erro`;

  // com erro, um campo nativo já sai marcado e ligado à mensagem
  let control = children;
  if (
    error &&
    isValidElement<ControlProps>(children) &&
    typeof children.type === "string" &&
    nativeControls.has(children.type)
  ) {
    const described = children.props["aria-describedby"];
    control = cloneElement(children, {
      "aria-invalid": children.props["aria-invalid"] ?? true,
      "aria-describedby": described?.split(" ").includes(messageId)
        ? described
        : [described, messageId].filter(Boolean).join(" "),
    });
  }

  return (
    <div className={cx("grid content-start", className)}>
      <label className="grid gap-2">
        <span className="lbl">
          {label}
          {hint ? <span className="hint">{hint}</span> : null}
        </span>
        {control}
      </label>
      {error ? (
        <p className="field-error" id={messageId}>
          <CircleAlert aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Camadas de diálogo (modal, painel lateral, menu do celular)          */
/* ------------------------------------------------------------------ */

type DialogLayer = {
  root: HTMLElement;
  panel: HTMLElement;
  close: () => void;
  isBusy: () => boolean;
  returnTo: () => HTMLElement | null;
  /** Para onde o foco volta ao fechar, em ordem de preferência. */
  origins: HTMLElement[];
};

const layers: DialogLayer[] = [];
const inertByUs = new Set<HTMLElement>();
let htmlBefore: { overflow: string; gutter: string } | null = null;

// O que abre por último fica por cima: o painel aberto a partir do detalhe cobre o detalhe, e a
// confirmação aberta no painel cobre o painel. O z-index vem da ordem na pilha (60, 62, 64...).
const LAYER_Z = 60;

function stackLayers() {
  layers.forEach((layer, index) => {
    layer.root.style.zIndex = String(LAYER_Z + index * 2);
  });
}

// quem precisa saber da camada de cima (os avisos, para não cobrir o diálogo)
const layerListeners = new Set<() => void>();
let panelWatcher: ResizeObserver | null = null;
let focusWatcher: MutationObserver | null = null;

// cabeçalho e rodapé dos diálogos: os avisos ficam junto deles
const DIALOG_HEADS = ".modal-head, .drawer-head";
const DIALOG_FEET = ".modal-foot, .drawer-foot";

function notifyLayers() {
  layerListeners.forEach((listener) => listener());
}

function watchTopPanel() {
  panelWatcher?.disconnect();
  panelWatcher = null;
  focusWatcher?.disconnect();
  focusWatcher = null;
  const top = layers[layers.length - 1];
  if (!top) {
    return;
  }
  if (typeof ResizeObserver !== "undefined") {
    const watcher = new ResizeObserver(notifyLayers);
    watcher.observe(top.panel);
    top.panel
      .querySelectorAll<HTMLElement>(`${DIALOG_HEADS}, ${DIALOG_FEET}`)
      .forEach((edge) => watcher.observe(edge));
    panelWatcher = watcher;
  }
  if (typeof MutationObserver !== "undefined") {
    focusWatcher = new MutationObserver((records) => keepFocusInside(top, records));
    focusWatcher.observe(top.panel, { childList: true, subtree: true });
  }
}

// O botão com o foco saiu da tela (ex.: "Concluir" virou "Reativar"): o foco vai para o que entrou
// no lugar ou, sem isso, para o próprio painel. Com o diálogo aberto, ele não cai no body.
function keepFocusInside(layer: DialogLayer, records: MutationRecord[]) {
  const active = document.activeElement;
  if (layers[layers.length - 1] !== layer || (active && active !== document.body)) {
    return;
  }
  for (const record of records) {
    for (const node of Array.from(record.addedNodes)) {
      if (!(node instanceof HTMLElement) || !layer.panel.contains(node)) {
        continue;
      }
      const target = isTabbable(node) ? node : tabbables(node)[0];
      if (target) {
        target.focus({ preventScroll: true });
        if (document.activeElement === target) {
          return;
        }
      }
    }
  }
  layer.panel.focus({ preventScroll: true });
}

function subscribeLayers(listener: () => void) {
  layerListeners.add(listener);
  window.addEventListener("resize", listener);
  return () => {
    layerListeners.delete(listener);
    window.removeEventListener("resize", listener);
  };
}

const TABBABLE =
  'a[href], button, input, select, textarea, summary, iframe, [contenteditable="true"], [tabindex]';
const FIELDS = 'input:not([type="hidden"]), select, textarea';

function isShown(element: HTMLElement) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function isTabbable(element: HTMLElement) {
  return (
    element.matches(TABBABLE) &&
    element.tabIndex >= 0 &&
    !element.matches(":disabled") &&
    element.getAttribute("type") !== "hidden" &&
    !element.closest("[inert]") &&
    isShown(element)
  );
}

function tabbables(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(isTabbable);
}

function firstField(container: HTMLElement) {
  return (
    Array.from(container.querySelectorAll<HTMLElement>(FIELDS)).find(
      (element) => !element.matches(":disabled") && isShown(element)
    ) ?? null
  );
}

function keepActive(element: Element) {
  const tag = element.tagName;
  return (
    tag === "SCRIPT" ||
    tag === "STYLE" ||
    tag === "LINK" ||
    tag === "TEMPLATE" ||
    tag === "NOSCRIPT" ||
    // anúncio de rota do Next e a sobreposição de desenvolvimento
    tag.includes("-") ||
    // avisos continuam sendo lidos e clicáveis
    element.hasAttribute("data-dialog-keep") ||
    element.hasAttribute("aria-live")
  );
}

// Só a camada de cima responde: o resto da página (e as camadas de baixo) fica inerte.
function syncInert() {
  const top = layers[layers.length - 1];
  const next = new Set<HTMLElement>();
  for (let node: HTMLElement | null = top?.root ?? null; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling !== node && sibling instanceof HTMLElement && !keepActive(sibling)) {
        next.add(sibling);
      }
    }
  }
  inertByUs.forEach((element) => {
    if (!next.has(element)) {
      element.inert = false;
      inertByUs.delete(element);
    }
  });
  next.forEach((element) => {
    if (!element.inert) {
      element.inert = true;
      inertByUs.add(element);
    }
  });
}

function lockPage() {
  const html = document.documentElement;
  htmlBefore = { overflow: html.style.overflow, gutter: html.style.getPropertyValue("scrollbar-gutter") };
  // reserva o espaço da barra de rolagem para a página não pular de lado
  if (window.innerWidth > html.clientWidth) {
    html.style.setProperty("scrollbar-gutter", "stable");
  }
  html.style.overflow = "hidden";
}

function unlockPage() {
  if (!htmlBefore) {
    return;
  }
  const html = document.documentElement;
  html.style.overflow = htmlBefore.overflow;
  if (htmlBefore.gutter) {
    html.style.setProperty("scrollbar-gutter", htmlBefore.gutter);
  } else {
    html.style.removeProperty("scrollbar-gutter");
  }
  htmlBefore = null;
}

function trapTab(event: KeyboardEvent, panel: HTMLElement) {
  const items = tabbables(panel);
  const active = document.activeElement;
  if (!items.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  if (!(active instanceof HTMLElement) || !panel.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    return;
  }
  // nas pontas, o Tab dá a volta dentro do diálogo
  const hasBefore = items.some(
    (item) => item !== active && item.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  const hasAfter = items.some(
    (item) => item !== active && active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  if (event.shiftKey && !hasBefore) {
    event.preventDefault();
    items[items.length - 1].focus();
  } else if (!event.shiftKey && !hasAfter) {
    event.preventDefault();
    items[0].focus();
  }
}

function onLayerKey(event: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top) {
    return;
  }
  if (event.key === "Escape") {
    // um campo que já tratou o Esc (ex.: limpar a busca) tem a vez
    if (event.defaultPrevented || event.isComposing) {
      return;
    }
    event.preventDefault();
    if (!top.isBusy()) {
      top.close();
    }
  } else if (event.key === "Tab") {
    trapTab(event, top.panel);
  }
}

function restoreFocus(layer: DialogLayer) {
  const active = document.activeElement;
  // se o foco já foi levado para outro lugar de propósito, fica onde está
  if (active && active !== document.body && !layer.root.contains(active)) {
    return;
  }
  const below = layers[layers.length - 1];
  for (const element of [layer.returnTo(), ...layer.origins]) {
    if (!element || !element.isConnected || element === document.body) {
      continue;
    }
    if (below && !below.panel.contains(element)) {
      continue;
    }
    element.focus({ preventScroll: true });
    if (document.activeElement === element) {
      return;
    }
  }
  // a origem sumiu: volta para a camada de baixo ou para o conteúdo da tela
  const fallback = below?.panel ?? document.getElementById("conteudo");
  fallback?.focus({ preventScroll: true });
}

function pushLayer(layer: DialogLayer) {
  if (!layers.length) {
    lockPage();
    window.addEventListener("keydown", onLayerKey);
  }
  layers.push(layer);
  stackLayers();
  syncInert();
  watchTopPanel();
  notifyLayers();
}

function popLayer(layer: DialogLayer) {
  const index = layers.indexOf(layer);
  if (index < 0) {
    return;
  }
  layers.splice(index, 1);
  layer.root.style.removeProperty("z-index");
  stackLayers();
  if (index < layers.length) {
    // saiu uma camada de baixo: a de cima herda para onde devolver o foco
    const inherited = [layer.returnTo(), ...layer.origins].filter((element): element is HTMLElement => !!element);
    layers[index].origins.push(...inherited);
    syncInert();
    notifyLayers();
    return;
  }
  syncInert();
  watchTopPanel();
  if (!layers.length) {
    window.removeEventListener("keydown", onLayerKey);
    unlockPage();
  }
  restoreFocus(layer);
  notifyLayers();
}

// posição na tela sem a animação de entrada (offsetTop/Left ignoram transform)
function layoutBox(element: HTMLElement) {
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft;
    top += node.offsetTop;
  }
  return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight, width: element.offsetWidth };
}

type Box = ReturnType<typeof layoutBox>;

function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Os avisos esperam o menu do celular fechar: ficam invisíveis e com o tempo parado. */
const TOAST_HOLD = "espera";
const TOAST_WIDTH = 390;
const TOAST_MIN_WIDTH = 260;

// altura provável da pilha: texto em até 4 linhas e, com ação, uma linha a mais para ela
function stackHeight(toasts: Array<Pick<ToastItem, "text" | "action">>, width: number) {
  const perLine = Math.max(12, Math.floor((width - 72) / 7.5));
  return toasts.reduce((sum, toast, index) => {
    const lines = Math.min(4, Math.ceil(toast.text.length / perLine));
    return sum + (index ? 10 : 0) + 24 + Math.max(36, lines * 20) + (toast.action ? 48 : 0);
  }, 0);
}

/** Medidas que decidem o lugar dos avisos (lidas da página em toastSpot). */
type SpotInput = {
  viewW: number;
  viewH: number;
  /** Painéis das camadas abertas, de baixo para cima. */
  boxes: Box[];
  /** Rodapé e cabeçalho do painel de cima, se ele tiver. */
  foot: Box | null;
  head: Box | null;
  toasts: Array<Pick<ToastItem, "text" | "action">>;
};

/**
 * Lugar dos avisos. Sem diálogo, embaixo: no celular, na largura toda; no computador, à direita.
 * Com um diálogo aberto, o primeiro lugar que não cobre o painel: o normal; embaixo, ao lado do
 * painel (à esquerda do painel lateral, no computador); no topo, acima da folha; logo acima do
 * rodapé do painel (o de tela cheia, no celular); logo abaixo do cabeçalho do diálogo. Nunca em
 * cima do X nem dos botões do rodapé. Com o menu do celular aberto, eles esperam o menu fechar.
 * Devolve "" (lugar normal), TOAST_HOLD ou "borda,distância,esquerda,largura".
 */
function pickToastSpot({ boxes, foot, head, toasts, viewH, viewW }: SpotInput) {
  const panel = boxes[boxes.length - 1];
  if (!panel || !toasts.length) {
    return "";
  }
  const narrow = viewW < 640;
  const gap = narrow ? 12 : 24;
  const full = narrow ? viewW - 2 * gap : Math.min(TOAST_WIDTH, viewW - 2 * gap);
  const height = stackHeight(toasts, full);
  // painel lateral (o de edição): o rodapé dele fica livre mesmo com uma confirmação por cima
  const sides = boxes.filter((box) => box.right >= viewW - 1 && box.top <= 1);
  const blockers = [panel, ...sides];
  const atBottom = (left: number, width: number): Box => ({
    left,
    top: viewH - gap - height,
    right: left + width,
    bottom: viewH - gap,
    width,
  });
  const spot = (edge: "top" | "bottom", offset: number, left: number, width: number) =>
    `${edge},${Math.round(offset)},${Math.round(left)},${Math.round(width)}`;

  // o lugar normal, se não cobre nenhum diálogo
  if (!boxes.some((box) => overlaps(atBottom(narrow ? gap : viewW - gap - full, full), box))) {
    return "";
  }
  // embaixo, ao lado: à esquerda do painel lateral, à direita ou à esquerda da caixa
  const leftOf = (box: Box) => {
    const width = Math.min(full, box.left - 2 * gap);
    return width >= TOAST_MIN_WIDTH ? { left: box.left - gap - width, width } : null;
  };
  const rightOf = (box: Box) => {
    const width = Math.min(full, viewW - box.right - 2 * gap);
    return width >= TOAST_MIN_WIDTH ? { left: viewW - gap - width, width } : null;
  };
  for (const place of [...sides.map(leftOf), rightOf(panel), leftOf(panel)]) {
    if (place && !blockers.some((box) => overlaps(atBottom(place.left, place.width), box))) {
      return spot("bottom", gap, place.left, place.width);
    }
  }
  // no topo, acima da folha (celular) ou da caixa
  if (panel.top >= height + 2 * gap) {
    const left = narrow ? gap : Math.min(Math.max(gap, panel.left + (panel.width - full) / 2), viewW - gap - full);
    return spot("top", gap, left, full);
  }
  // dentro do painel, na largura dele: logo acima do rodapé ou logo abaixo do cabeçalho
  const inner = Math.min(full, panel.width - 2 * gap);
  const innerLeft = panel.left + (panel.width - inner) / 2;
  if (foot) {
    return spot("bottom", viewH - foot.top + 8, innerLeft, inner);
  }
  if (head) {
    return spot("top", head.bottom + 8, innerLeft, inner);
  }
  // sem cabeçalho nem rodapé de diálogo: é o menu do celular
  return TOAST_HOLD;
}

function toastSpot(toasts: ToastItem[]) {
  // a camada que está saindo já não está na página
  const open = layers.filter((layer) => layer.root.isConnected);
  const top = open[open.length - 1];
  if (!top || !toasts.length) {
    return "";
  }
  const edge = (selector: string) => {
    const element = top.panel.querySelector<HTMLElement>(selector);
    return element && isShown(element) ? layoutBox(element) : null;
  };
  return pickToastSpot({
    viewW: document.documentElement.clientWidth,
    viewH: window.innerHeight,
    boxes: open.map((layer) => layoutBox(layer.panel)),
    foot: edge(DIALOG_FEET),
    head: edge(DIALOG_HEADS),
    toasts,
  });
}

/**
 * Liga um diálogo à pilha comum: Esc fecha só o de cima, o Tab fica preso no painel,
 * o resto da página fica inerte e sem rolagem, e ao fechar o foco volta para quem abriu.
 */
export function useDialogLayer({
  busy,
  initialFocusRef,
  onClose,
  open,
  panelRef,
  returnFocusRef,
  rootRef,
}: {
  open: boolean;
  /** Elemento de fora (véu), filho do body. */
  rootRef: RefObject<HTMLElement | null>;
  /** Onde o Tab fica preso. */
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Ocupado: Esc e clique fora não fecham. */
  busy?: boolean;
  /** Foco ao abrir; sem ele, vai para o primeiro campo ou para o próprio painel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Foco ao fechar; sem ele, volta para o elemento que tinha o foco ao abrir. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef(onClose);
  const busyRef = useRef(Boolean(busy));

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = Boolean(busy);
  });

  // antes da pintura: a camada já entra por cima, com o resto inerte e os avisos no lugar certo
  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!open || !root || !panel) {
      return;
    }
    const origin = document.activeElement;
    const layer: DialogLayer = {
      root,
      panel,
      close: () => closeRef.current(),
      isBusy: () => busyRef.current,
      returnTo: () => returnFocusRef?.current ?? null,
      origins: origin instanceof HTMLElement && origin !== document.body ? [origin] : [],
    };
    pushLayer(layer);
    if (!panel.contains(document.activeElement)) {
      (initialFocusRef?.current ?? firstField(panel) ?? panel).focus();
      if (!panel.contains(document.activeElement)) {
        panel.focus();
      }
    }
    return () => popLayer(layer);
  }, [open, rootRef, panelRef, initialFocusRef, returnFocusRef]);
}

/**
 * Verdadeiro se o elemento está no diálogo de cima, ou se não há diálogo aberto. Os diálogos de
 * baixo continuam montados (e com aria-modal), mas inertes: este é o teste de "posso focar aqui".
 */
export function isOnTopLayer(element: Element | null) {
  const top = layers[layers.length - 1];
  return Boolean(element?.isConnected) && (!top || top.root.contains(element));
}

const subscribeNothing = () => () => {};

/** Verdadeiro só no navegador, depois da hidratação (portais precisam do document). */
function usePortalReady() {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  );
}

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export type ToastTone = "success" | "danger" | "info";

export type ToastAction = { label: string; onClick: () => void };

export type ToastItem = {
  id: number;
  tone: ToastTone;
  text: string;
  /** Botão no aviso, como "Desfazer" ou "Ver no cronograma". */
  action?: ToastAction;
  /** Tempo na tela, em ms. 0 deixa o aviso até a pessoa fechar. */
  duration?: number;
};

const toastTone: Record<ToastTone, { className: string; icon: LucideIcon; action: string }> = {
  success: { className: "ok", icon: Check, action: "text-accent hover:bg-white/10" },
  danger: { className: "err", icon: TriangleAlert, action: "text-brand hover:bg-brand-50" },
  info: { className: "info", icon: Info, action: "text-brand hover:bg-brand-50" },
};

// sucesso e informação: 6 s; com ação (Desfazer, Ver no cronograma): 10 s; erro: fica até a pessoa fechar
function toastDuration(toast: ToastItem) {
  if (toast.duration !== undefined) {
    return toast.duration;
  }
  if (toast.tone === "danger") {
    return 0;
  }
  return toast.action ? 10000 : 6000;
}

function ToastView({
  onDismiss,
  paused,
  toast,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
  /** Aviso esperando o menu do celular fechar: o tempo não corre. */
  paused?: boolean;
}) {
  const tone = toastTone[toast.tone];
  const Icon = tone.icon;
  const total = toastDuration(toast);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const remaining = useRef(total);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  // o tempo só corre com o aviso livre: pausa com o mouse em cima, o foco dentro ou o menu aberto
  useEffect(() => {
    if (!total || hovered || focused || paused) {
      return;
    }
    const started = Date.now();
    const timer = window.setTimeout(() => dismissRef.current(toast.id), Math.max(remaining.current, 1500));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [focused, hovered, paused, toast.id, total]);

  function close(after?: () => void) {
    // fechar o aviso que tinha o foco devolve o foco para onde a pessoa estava
    if (boxRef.current?.contains(document.activeElement)) {
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : (layers[layers.length - 1]?.panel ?? document.getElementById("conteudo"));
      target?.focus({ preventScroll: true });
    }
    after?.();
    dismissRef.current(toast.id);
  }

  return (
    <div
      ref={boxRef}
      className={cx("toast", tone.className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      onFocus={(event) => {
        setFocused(true);
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
          returnFocus.current = from;
        }
      }}
      // só o mouse pausa: no toque, o "mouse em cima" ficaria preso depois de tocar no aviso
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          setHovered(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          setHovered(false);
        }
      }}
    >
      <span className="t-ico">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 grow basis-40 text-sm font-semibold leading-5">{toast.text}</span>
      {/* ação e fechar andam juntos: sem espaço ao lado do texto, descem para uma linha só deles */}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {toast.action ? (
          <button
            className={cx("t-act rounded-lg px-3 py-2 text-sm font-bold transition", tone.action)}
            onClick={() => close(toast.action?.onClick)}
            type="button"
          >
            {toast.action.label}
          </button>
        ) : null}
        <button
          className="t-close grid h-9 w-9 shrink-0 place-items-center rounded-lg opacity-70 transition hover:opacity-100"
          onClick={() => close()}
          aria-label="Fechar aviso"
          title="Fechar aviso"
          type="button"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </div>
  );
}

// folga entre os avisos e o item que fica acima deles (o focado ou o recém-salvo)
const TOAST_ROOM_GAP = 12;
// sem evento de rolagem por este tempo, a rolagem parou (inclusive a suave do scrollIntoView)
const SCROLL_SETTLE_MS = 160;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Edges = { top: number; bottom: number; left: number; right: number };

/**
 * Quanto a página sobe para o item sair de baixo dos avisos (0 se nenhum aviso o cobre). Para
 * antes de levar o topo do item para trás do cabeçalho grudado (headRoom, o scroll-margin-top).
 */
function liftOverToasts(item: Edges, toasts: Edges, headRoom: number) {
  const covered =
    item.bottom > toasts.top && item.top < toasts.bottom && item.right > toasts.left && item.left < toasts.right;
  if (!covered) {
    return 0;
  }
  return Math.max(0, Math.min(item.bottom - toasts.top + TOAST_ROOM_GAP, item.top - headRoom));
}

/**
 * Avisos no lugar normal (embaixo, sem diálogo aberto): o que recebe o foco fica acima deles.
 * No celular a pilha ocupa a largura toda, e a altura dela vira a folga de baixo da rolagem
 * (--toast-room, no scroll-margin-bottom do globals.css): o scrollIntoView das telas e o foco
 * pelo teclado já param acima dos avisos. Em qualquer largura, se o item focado ainda estiver
 * embaixo de um aviso quando a rolagem parar (a linha cresceu com "Salvo agora", ou, a partir
 * do tablet, o aviso do canto cobre a linha), a página sobe só o que falta.
 */
function useToastRoom(stackRef: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!active || !stack) {
      return;
    }
    const root = document.documentElement;
    const fullWidth = window.matchMedia("(max-width: 639px)");

    const measure = () => {
      const height = fullWidth.matches ? window.innerHeight - stack.getBoundingClientRect().top : 0;
      if (height > 0) {
        root.style.setProperty("--toast-room", `${Math.round(height) + TOAST_ROOM_GAP}px`);
      } else {
        root.style.removeProperty("--toast-room");
      }
    };

    let timer = 0;
    let pending = false;
    const lift = () => {
      pending = false;
      const target = document.activeElement;
      const content = document.getElementById("conteudo");
      if (layers.length || !(target instanceof HTMLElement) || target === content || !content?.contains(target)) {
        return;
      }
      const distance = liftOverToasts(
        target.getBoundingClientRect(),
        stack.getBoundingClientRect(),
        parseFloat(getComputedStyle(target).scrollMarginTop) || 0
      );
      if (distance > 0) {
        window.scrollBy({ top: distance, behavior: reducedMotion() ? "auto" : "smooth" });
      }
    };
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lift, SCROLL_SETTLE_MS);
    };
    const onFocus = () => {
      pending = true;
      settle();
    };
    const onScroll = () => {
      if (pending) {
        settle();
      }
    };
    // a pessoa rolou a página por conta própria: o item focado não é puxado de volta
    const onUserScroll = () => {
      pending = false;
      window.clearTimeout(timer);
    };

    measure();
    const watcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    watcher?.observe(stack);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", onFocus);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      watcher?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.clearTimeout(timer);
      root.style.removeProperty("--toast-room");
    };
  }, [active, stackRef]);
}

/**
 * Avisos embaixo: no celular, na largura toda (12 px de cada lado), acima da área segura; no
 * computador, no canto direito. Com um diálogo aberto, eles desviam dele (ver toastSpot); sem
 * diálogo, o item focado ou recém-salvo fica acima deles (ver useToastRoom).
 * As duas regiões vivas ficam sempre montadas.
 */
export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const ready = usePortalReady();
  const stackRef = useRef<HTMLDivElement>(null);
  const spot = useSyncExternalStore(
    subscribeLayers,
    () => toastSpot(toasts),
    () => ""
  );
  useToastRoom(stackRef, ready && !spot && toasts.length > 0);
  if (!ready) {
    return null;
  }
  const held = spot === TOAST_HOLD;
  const [edge, offset, left, width] = spot && !held ? spot.split(",") : [];
  const fromTop = edge === "top";
  const style: CSSProperties | undefined = edge
    ? {
        top: fromTop ? Number(offset) : "auto",
        bottom: fromTop ? "auto" : Number(offset),
        left: Number(left),
        right: "auto",
        width: Number(width),
      }
    : undefined;
  // o mais novo fica perto da borda
  const nearEdge = (list: ToastItem[]) => (fromTop ? [...list].reverse() : list);
  const urgent = nearEdge(toasts.filter((toast) => toast.tone === "danger"));
  const calm = nearEdge(toasts.filter((toast) => toast.tone !== "danger"));

  return createPortal(
    <div
      ref={stackRef}
      data-dialog-keep=""
      className={cx("toast-stack", fromTop && "from-top", held && "held")}
      style={style}
    >
      <div className="flex flex-col gap-2.5" role="alert" aria-live="assertive">
        {urgent.map((toast) => (
          <ToastView key={toast.id} paused={held} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
      <div
        className={cx("flex flex-col gap-2.5", urgent.length && calm.length ? "mt-2.5" : undefined)}
        role="status"
        aria-live="polite"
      >
        {calm.map((toast) => (
          <ToastView key={toast.id} paused={held} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>,
    document.body
  );
}

export function EmptyState({
  action,
  compact,
  hint,
  icon: Icon,
  text,
}: {
  /** Botão para fazer o que a dica sugere. */
  action?: { label: string; onClick: () => void };
  /** Versão baixa, para cards pequenos. */
  compact?: boolean;
  hint?: string;
  icon?: LucideIcon;
  text: string;
}) {
  const button = action ? (
    <button className={cx(secondaryButton, compact ? "btn-sm mt-2.5" : "mt-3")} onClick={action.onClick} type="button">
      {action.label}
    </button>
  ) : null;

  // compacto: ícone ao lado do texto (layout do .empty-inline.compact); a ação fica embaixo do texto
  if (compact) {
    return (
      <div className="empty-inline compact">
        {Icon ? (
          <span className="empty-ico">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{text}</p>
          {hint ? <p className="mt-0.5 text-sm leading-5 text-muted">{hint}</p> : null}
          {button}
        </div>
      </div>
    );
  }

  return (
    <div className="empty-inline">
      {Icon ? (
        <span className="empty-ico">
          <Icon className="h-6 w-6" aria-hidden />
        </span>
      ) : null}
      <p className="mt-2 text-[15px] font-bold text-ink">{text}</p>
      {hint ? <p className="max-w-sm text-sm leading-5 text-muted">{hint}</p> : null}
      {button}
    </div>
  );
}

/** Leva o foco ao título da tela (ou ao conteúdo), se ele caiu no body. */
function focusScreenTitle() {
  const active = document.activeElement;
  if (active && active !== document.body) {
    return;
  }
  const content = document.getElementById("conteudo");
  const title = content?.querySelector<HTMLElement>("h1[tabindex]") ?? content;
  title?.focus({ preventScroll: true });
}

/**
 * "Tentar de novo" de uma carga que falhou (tela de erro, faixa "Sem conexão"). Enquanto tenta,
 * continua focável (aria-disabled): com disabled, o navegador tiraria o foco dele para o body.
 * Se a carga der certo e ele sair da tela levando o foco, o foco vai para o título da tela.
 */
export function RetryButton({
  className,
  icon,
  onRetry,
  retrying,
}: {
  className?: string;
  /** Ícone de recarregar ao lado do texto (vira o de carregando enquanto tenta). */
  icon?: boolean;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      if (button && button === document.activeElement) {
        window.setTimeout(focusScreenTitle);
      }
    };
  }, []);

  let glyph: ReactNode = null;
  if (icon) {
    glyph = retrying ? (
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    ) : (
      <RefreshCw className="h-4 w-4" aria-hidden />
    );
  }

  return (
    <button
      ref={buttonRef}
      className={cx(className, busyLook)}
      aria-busy={retrying || undefined}
      aria-disabled={retrying || undefined}
      onClick={() => {
        if (!retrying) {
          onRetry();
        }
      }}
      type="button"
    >
      {glyph}
      Tentar de novo
    </button>
  );
}

/** Falha ao carregar: explica e oferece tentar de novo. */
export function ErrorState({
  onRetry,
  retrying,
  text,
  title,
}: {
  title: string;
  text?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="empty-inline gap-2 border-solid border-[#f3c6d0] bg-white px-6 py-10" role="alert">
      <span className="empty-ico bg-[#ffe4e8] text-[#be123c]">
        <TriangleAlert className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-2 text-[17px] font-bold text-ink">{title}</p>
      {text ? <p className="max-w-md text-sm leading-6 text-muted">{text}</p> : null}
      {onRetry ? <RetryButton className={cx(primaryButton, "mt-3")} icon onRetry={onRetry} retrying={retrying} /> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-3">
      <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
      {label}
    </span>
  );
}

/** Esqueleto do painel (destaque, KPIs e dois cards) enquanto os dados chegam. */
export function PageSkeleton() {
  // no plano gratuito a API dorme; se demorar, explica a espera
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="pop grid gap-5" role="status">
      <span className="sr-only">Carregando dados da agenda...</span>
      {slow ? (
        <p className="callout blue pop">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          O servidor estava em repouso e está voltando. No primeiro acesso isso leva até um minuto.
        </p>
      ) : null}
      <div className="card pad grid gap-3">
        <span className="skel h-3 w-28" />
        <span className="skel h-8 w-2/3" />
        <span className="skel h-4 w-1/2" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="card pad flex items-center gap-3.5">
            <span className="skel h-11 w-11 shrink-0 !rounded-xl" />
            <span className="grid flex-1 gap-2">
              <span className="skel h-3 w-20" />
              <span className="skel h-6 w-14" />
            </span>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {[0, 1].map((card) => (
          <div key={card} className="card pad grid content-start gap-4">
            <span className="grid gap-2">
              <span className="skel h-3 w-24" />
              <span className="skel h-5 w-48" />
            </span>
            {[0, 1, 2, 3].map((row) => (
              <span key={row} className="flex items-center gap-3">
                <span className="skel h-12 w-12 shrink-0 !rounded-xl" />
                <span className="grid flex-1 gap-2">
                  <span className="skel h-3.5 w-3/4" />
                  <span className="skel h-3 w-1/2" />
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Seções                                                              */
/* ------------------------------------------------------------------ */

/** Cabeçalho de card: título, subtítulo opcional e, à direita, uma ação ("Ver tudo"). */
export function SectionTitle({
  action,
  id,
  subtitle,
  title,
}: {
  action?: ReactNode;
  /** id do h2, para a seção usar aria-labelledby. */
  id?: string;
  subtitle?: ReactNode;
  title: string;
}) {
  const heading = (
    <div className="min-w-0">
      <h2 className="h2" id={id}>
        {title}
      </h2>
      {subtitle ? <p className="sub">{subtitle}</p> : null}
    </div>
  );
  if (!action) {
    return heading;
  }
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2">
      {heading}
      <div className="flex shrink-0 items-center gap-2">{action}</div>
    </div>
  );
}

/** Grupo de botões segmentados (ex.: Agenda / Calendário). */
export function Segmented({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function SegmentedButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={cx(active && "on")} aria-pressed={active} onClick={onClick} type="button">
      {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
      {label}
    </button>
  );
}

export function InfoLine({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <>
      <dt>
        <Icon className="h-4 w-4" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0">{value}</dd>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Modal e confirmação                                                 */
/* ------------------------------------------------------------------ */

/**
 * Diálogo por cima de tudo (portal no body): no celular sobe como folha de baixo, a partir
 * de 640px fica no centro. Cabeçalho e rodapé ficam à vista; só o corpo rola.
 */
export function Modal({
  busy,
  children,
  describedBy,
  footer,
  initialFocusRef,
  onClose,
  role = "dialog",
  title,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  wide?: boolean;
  /** Ações fixas no pé da caixa. */
  footer?: ReactNode;
  role?: "dialog" | "alertdialog";
  /** Ocupado: Esc, clique fora e o X não fecham. */
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** id do texto que descreve o diálogo. */
  describedBy?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // âncora no lugar do modal: se esse lugar estiver escondido por CSS (ex.: xl:hidden), ele não abre
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const shown = useSyncExternalStore(
    subscribeResize,
    () => anchor !== null && anchor.getClientRects().length > 0,
    () => false
  );

  useDialogLayer({ open: shown, rootRef, panelRef, onClose, busy, initialFocusRef });

  function requestClose() {
    if (!busy) {
      onClose();
    }
  }

  return (
    <>
      <span ref={setAnchor} className="pointer-events-none fixed h-0 w-0" aria-hidden />
      {shown
        ? createPortal(
            <div
              ref={rootRef}
              className="modal-veil animate-fade-in"
              role={role}
              aria-busy={busy || undefined}
              aria-describedby={describedBy}
              aria-labelledby={titleId}
              aria-modal="true"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  // sem isso o clique no véu leva o foco para o body depois de fechar
                  event.preventDefault();
                  requestClose();
                }
              }}
            >
              <div ref={panelRef} tabIndex={-1} className={cx("modal-box animate-slide-up", wide && "wide")}>
                <div className="modal-head">
                  <h2 id={titleId} className="disp min-w-0 text-[22px] font-bold leading-tight">
                    {title}
                  </h2>
                  <button
                    className={cx(iconButton, busyLook)}
                    onClick={requestClose}
                    aria-disabled={busy || undefined}
                    aria-label="Fechar"
                    title="Fechar"
                    type="button"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <div className="modal-body">{children}</div>
                {footer ? <div className="modal-foot">{footer}</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Painel lateral (edição de evento)                                   */
/* ------------------------------------------------------------------ */

export type DrawerProps = {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  busy?: boolean;
  labelClose?: string;
};

/** Painel à direita, por cima da tela atual, que não muda nem rola por baixo. */
export function Drawer({
  busy,
  children,
  footer,
  initialFocusRef,
  labelClose = "Fechar painel",
  onClose,
  open,
  subtitle,
  title,
}: DrawerProps) {
  const ready = usePortalReady();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  const visible = open && ready;

  useDialogLayer({ open: visible, rootRef, panelRef, onClose, busy, initialFocusRef });

  function requestClose() {
    if (!busy) {
      onClose();
    }
  }

  if (!visible) {
    return null;
  }
  return createPortal(
    <div
      ref={rootRef}
      className="drawer-veil animate-fade-in overscroll-contain"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          requestClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className="drawer animate-drawer-right"
        role="dialog"
        aria-busy={busy || undefined}
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="drawer-head">
          <div className="min-w-0">
            <h2 id={titleId} className="disp text-[22px] font-bold leading-tight">
              {title}
            </h2>
            {subtitle ? (
              <div id={subtitleId} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                {subtitle}
              </div>
            ) : null}
          </div>
          <button
            className={cx(iconButton, "shrink-0", busyLook)}
            onClick={requestClose}
            aria-disabled={busy || undefined}
            aria-label={labelClose}
            title={labelClose}
            type="button"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

export type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  /** Botão de desistir; padrão "Voltar". */
  cancelLabel?: string;
  /** "danger" (padrão) para excluir e cancelar; "primary" para seguir adiante. */
  tone?: "danger" | "primary";
  action: () => void | Promise<void>;
};

export function ConfirmDialog({
  confirm,
  busy,
  onCancel,
  onConfirm,
}: {
  confirm: ConfirmState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  return (
    <Modal
      busy={busy}
      describedBy={messageId}
      initialFocusRef={cancelRef}
      onClose={onCancel}
      role="alertdialog"
      title={confirm.title}
      footer={
        <>
          <button
            ref={cancelRef}
            className={cx(secondaryButton, busyLook)}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) {
                onCancel();
              }
            }}
            type="button"
          >
            {confirm.cancelLabel ?? "Voltar"}
          </button>
          <button
            className={cx(confirm.tone === "primary" ? primaryButton : "btn btn-d", busyLook)}
            aria-busy={busy || undefined}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) {
                onConfirm();
              }
            }}
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {confirm.confirmLabel}
          </button>
        </>
      }
    >
      <p id={messageId} className="text-sm leading-6 text-ink-3">
        {confirm.message}
      </p>
    </Modal>
  );
}
