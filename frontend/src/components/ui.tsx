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
        {/* sem espaço para os dois numa linha (celular), a dica desce inteira e o rótulo não parte */}
        <span className={cx("lbl", hint && "flex-wrap gap-y-0.5")}>
          <span>{label}</span>
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

/**
 * Tipo da camada, que decide a ordem na pilha: "view" (o detalhe do evento e o menu do celular),
 * "form" (o painel de edição e as Preferências, onde a pessoa está mexendo) e "confirm" (a
 * confirmação, sempre por cima).
 */
export type LayerKind = "view" | "form" | "confirm";

const LAYER_RANK: Record<LayerKind, number> = { view: 0, form: 1, confirm: 2 };

type DialogLayer = {
  root: HTMLElement;
  panel: HTMLElement;
  rank: number;
  close: () => void;
  isBusy: () => boolean;
  returnTo: () => HTMLElement | null;
  /** Onde o foco vai quando a camada fica por cima pela primeira vez. */
  entry: () => HTMLElement | null;
  /** Já esteve por cima. A que entra por baixo de outra (ex.: o detalhe que vira modal com o painel aberto) ainda não. */
  entered: boolean;
  /** Para onde o foco volta ao fechar, em ordem de preferência. */
  origins: HTMLElement[];
};

const layers: DialogLayer[] = [];
const inertByUs = new Set<HTMLElement>();
let htmlBefore: { overflow: string; gutter: string } | null = null;

/**
 * Itens da página (fora das camadas e dos avisos) que tiveram o foco, do mais novo para o mais
 * velho. A camada que entra por baixo de outra (o detalhe que vira modal quando a tela gira com o
 * painel aberto) não tem quem a abriu: o foco volta ao último deles que ainda está na página.
 */
const recentFocus: HTMLElement[] = [];
const RECENT_FOCUS = 8;
let focusTracked = false;

function trackFocus() {
  if (focusTracked) {
    return;
  }
  focusTracked = true;
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target === document.body ||
      target.closest("[data-dialog-keep]") ||
      layers.some((layer) => layer.root.contains(target))
    ) {
      return;
    }
    const seen = recentFocus.indexOf(target);
    if (seen >= 0) {
      recentFocus.splice(seen, 1);
    }
    recentFocus.unshift(target);
    recentFocus.length = Math.min(recentFocus.length, RECENT_FOCUS);
  });
}

/**
 * Retrato de um item para onde o foco pode voltar: o tipo, o nome, os rótulos (aria-label) das
 * regiões em volta e o evento ou o dia dele. Se o item sair da página e um igual entrar no lugar
 * (a coluna do detalhe, que sai e volta quando a tela gira), o foco vai para o novo (ver twinOf).
 */
type Likeness = { tag: string; name: string; scope: string; item: string };

const likenesses = new WeakMap<HTMLElement, Likeness>();
const ITEM_KEYS = ["data-event-id", "data-opens-event", "data-day"];

function likenessOf(element: HTMLElement): Likeness {
  const scope: string[] = [];
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const label = node.getAttribute("aria-label");
    if (label) {
      scope.push(label);
    }
  }
  return {
    tag: element.tagName,
    name: (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim(),
    scope: scope.join("\n"),
    item: ITEM_KEYS.map((key) => element.getAttribute(key) ?? "").join("\n"),
  };
}

/** Guarda o retrato enquanto o item está na página (fora dela, as regiões em volta já se perderam). */
function remember(element: HTMLElement) {
  if (element.isConnected) {
    likenesses.set(element, likenessOf(element));
  }
}

/**
 * Quem ocupou o lugar de um item que saiu da página: do mesmo tipo, nas mesmas regiões, com o mesmo
 * evento ou dia (o texto da linha muda com "Salvo agora") ou, sem eles, o mesmo nome. Só se houver um.
 */
function twinOf(gone: HTMLElement, within: HTMLElement | null, leaving: HTMLElement) {
  const before = likenesses.get(gone);
  if (!before) {
    return null;
  }
  const byItem = before.item.replace(/\n/g, "") !== "";
  const alike = Array.from(document.querySelectorAll<HTMLElement>(before.tag))
    .filter((candidate) => !leaving.contains(candidate) && (!within || within.contains(candidate)))
    .map((candidate) => ({ candidate, now: likenessOf(candidate) }))
    .filter(
      ({ candidate, now }) =>
        now.scope === before.scope &&
        (byItem ? now.item === before.item : now.name === before.name) &&
        isFocusable(candidate)
    );
  // dois do mesmo evento na mesma região (os botões do destaque): desempata pelo nome
  const found = byItem && alike.length > 1 ? alike.filter(({ now }) => now.name === before.name) : alike;
  return found.length === 1 ? found[0].candidate : null;
}

// A pilha ordena por tipo e, no mesmo tipo, pela ordem de abertura: o painel aberto a partir do
// detalhe cobre o detalhe, a confirmação cobre o painel, e um detalhe que monta depois (a tela girou
// e ele virou modal) entra por baixo do painel. O z-index vem da posição na pilha (60, 62, 64...).
const LAYER_Z = 60;

/** Posição de uma camada nova: acima das de tipo igual ou mais baixo, abaixo das de tipo mais alto. */
function layerSlot(ranks: number[], rank: number) {
  let index = ranks.length;
  while (index > 0 && ranks[index - 1] > rank) {
    index -= 1;
  }
  return index;
}

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
// título no corpo (o do detalhe do evento, abaixo da pílula): os avisos não ficam por cima dele
const DIALOG_TITLES = ".modal-body :is(h1, h2, h3), .drawer-body :is(h1, h2, h3)";
const DIALOG_BODIES = ".modal-body, .drawer-body";

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

/** Pode receber o foco, pelo Tab ou pelo código (como o título do detalhe, com tabindex -1). */
function isFocusable(element: HTMLElement) {
  return (
    element.matches(TABBABLE) &&
    !element.matches(":disabled") &&
    element.getAttribute("type") !== "hidden" &&
    !element.closest("[inert]") &&
    isShown(element)
  );
}

function isTabbable(element: HTMLElement) {
  return element.tabIndex >= 0 && isFocusable(element);
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

/**
 * Botões dos avisos que entram no Tab do diálogo, depois dos do painel: os avisos ficam fora dele
 * (no pé do detalhe, acima do rodapé ou ao lado do painel), mas continuam clicáveis por cima. Na
 * confirmação o Tab fica só nela, e os avisos que esperam o menu fechar (invisíveis) ficam de fora.
 */
function toastTabbables(layer: DialogLayer) {
  const stack = document.querySelector<HTMLElement>(`.${TOAST_STACK}`);
  if (layer.rank >= LAYER_RANK.confirm || !stack || stack.classList.contains(TOAST_HELD)) {
    return [];
  }
  return tabbables(stack);
}

function trapTab(event: KeyboardEvent, layer: DialogLayer) {
  const { panel } = layer;
  const own = tabbables(panel);
  const toasts = toastTabbables(layer);
  const items = [...own, ...toasts];
  const active = document.activeElement;
  const move = (target: HTMLElement) => {
    event.preventDefault();
    target.focus();
  };
  if (!items.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  // num aviso: o Tab anda pelos botões dos avisos e, nas pontas, volta para o painel
  const inToast = active instanceof HTMLElement ? toasts.indexOf(active) : -1;
  if (inToast >= 0) {
    const next = own.length + inToast + (event.shiftKey ? -1 : 1);
    move(items[(next + items.length) % items.length]);
    return;
  }
  if (!(active instanceof HTMLElement) || !panel.contains(active)) {
    move(event.shiftKey ? items[items.length - 1] : items[0]);
    return;
  }
  // nas pontas do painel, o Tab segue para os avisos ou dá a volta dentro do diálogo
  const hasBefore = own.some(
    (item) => item !== active && item.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  const hasAfter = own.some(
    (item) => item !== active && active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  if (event.shiftKey && !hasBefore) {
    move(items[items.length - 1]);
  } else if (!event.shiftKey && !hasAfter) {
    move(toasts[0] ?? items[0]);
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
    trapTab(event, top);
  }
}

/** Foco de quando a camada abre: o pedido, o primeiro campo ou o próprio painel. */
function focusEntry(layer: DialogLayer) {
  (layer.entry() ?? firstField(layer.panel) ?? layer.panel).focus();
  if (!layer.panel.contains(document.activeElement)) {
    layer.panel.focus();
  }
}

function restoreFocus(layer: DialogLayer) {
  const active = document.activeElement;
  // se o foco já foi levado para outro lugar de propósito, fica onde está
  if (active && active !== document.body && !layer.root.contains(active)) {
    return;
  }
  const below = layers[layers.length - 1];
  for (const origin of [layer.returnTo(), ...layer.origins]) {
    if (!origin || origin === document.body) {
      continue;
    }
    // a origem saiu da página: vale a igual que entrou no lugar dela (o Editar da coluna do detalhe,
    // que sai e volta quando a tela gira com o painel aberto)
    const element = origin.isConnected ? origin : twinOf(origin, below?.panel ?? null, layer.root);
    if (!element || (below && !below.panel.contains(element))) {
      continue;
    }
    element.focus({ preventScroll: true });
    if (document.activeElement === element) {
      return;
    }
  }
  // a origem sumiu. A camada que entrou por baixo e nunca esteve por cima recebe o foco de quando
  // abre (o detalhe, no título); as outras, o próprio painel; sem camada, o conteúdo da tela
  if (below && !below.entered) {
    focusEntry(below);
    return;
  }
  const fallback = below?.panel ?? document.getElementById("conteudo");
  fallback?.focus({ preventScroll: true });
}

/** Põe a camada na pilha, na posição do tipo dela. Devolve se ela ficou por cima. */
function pushLayer(layer: DialogLayer) {
  if (!layers.length) {
    lockPage();
    window.addEventListener("keydown", onLayerKey);
  }
  const index = layerSlot(
    layers.map((item) => item.rank),
    layer.rank
  );
  layers.splice(index, 0, layer);
  const onTop = index === layers.length - 1;
  stackLayers();
  syncInert();
  if (onTop) {
    watchTopPanel();
  }
  notifyLayers();
  return onTop;
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
    inherited.forEach(remember);
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
    // o pé dos avisos cresceu com o diálogo aberto e a página de trás no fim: ela vai para o novo fim
    if (toastFootHeld) {
      window.requestAnimationFrame(followToastFoot);
    }
  }
  restoreFocus(layer);
  const top = layers[layers.length - 1];
  if (top) {
    top.entered = true;
  }
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
/** Classes da pilha de avisos e de quando ela espera (globals.css). */
const TOAST_STACK = "toast-stack";
const TOAST_HELD = "held";
const TOAST_WIDTH = 390;
const TOAST_MIN_WIDTH = 260;

/** Borda de onde a pilha de avisos é medida (ver pickToastSpot). */
type ToastEdge = "top" | "bottom" | "foot" | "dock";

/** Folga dos avisos até a borda da tela ou do diálogo: 12 px no celular, 24 px a partir de 640 px. */
function toastGap(viewW: number) {
  return viewW < 640 ? 12 : 24;
}

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
  /** Título no corpo do painel de cima (o do detalhe), na posição com o corpo rolado para o topo. */
  title?: Box | null;
  toasts: Array<Pick<ToastItem, "text" | "action">>;
};

/**
 * Lugar dos avisos. Sem diálogo, embaixo: no celular, na largura toda; no computador, à direita.
 * Com um diálogo aberto, o primeiro lugar que não cobre o painel: o normal; embaixo, ao lado do
 * painel (à esquerda do painel lateral, no computador); no topo, acima da folha; logo acima do
 * rodapé do painel (o de tela cheia, no celular); no pé do diálogo sem rodapé (o detalhe do
 * evento), que abre embaixo do conteúdo o espaço deles (ver useDialogDock). Nunca em cima do X,
 * dos botões do rodapé nem do cabeçalho, da pílula e do título do detalhe. Com o menu do celular
 * aberto, ou se o detalhe não tiver lugar para eles (tela muito baixa), eles esperam.
 * Devolve "" (lugar normal), TOAST_HOLD ou "borda,distância,esquerda,largura". A borda é "top"
 * (distância do alto da tela), "bottom" (de baixo, acima da área segura), "foot" (de baixo, logo
 * acima do rodapé do diálogo) ou "dock" (de baixo, no pé do diálogo, acima da área segura).
 */
function pickToastSpot({ boxes, foot, head, title, toasts, viewH, viewW }: SpotInput) {
  const panel = boxes[boxes.length - 1];
  if (!panel || !toasts.length) {
    return "";
  }
  const narrow = viewW < 640;
  const gap = toastGap(viewW);
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
  const spot = (edge: ToastEdge, offset: number, left: number, width: number) =>
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
  // dentro do painel, na largura dele: logo acima do rodapé
  const inner = Math.min(full, panel.width - 2 * gap);
  const innerLeft = panel.left + (panel.width - inner) / 2;
  if (foot) {
    return spot("foot", viewH - foot.top + 8, innerLeft, inner);
  }
  // sem rodapé (o detalhe do evento): no pé do diálogo, como embaixo na tela sem diálogo (no celular,
  // a folha vai até embaixo e o aviso fica a 12 px da borda). O cabeçalho, a pílula e o título
  // continuam à vista acima dele; se não couberem, os avisos esperam o detalhe fechar.
  if (head) {
    const offset = Math.max(0, viewH - panel.bottom) + gap;
    const lead = Math.max(head.bottom, title?.bottom ?? head.bottom);
    if (viewH - offset - height >= lead + 8) {
      return spot("dock", offset, innerLeft, inner);
    }
  }
  // sem cabeçalho nem rodapé de diálogo (o menu do celular) ou sem lugar no detalhe
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
    // offsetTop não conta a rolagem do corpo: é a posição do título com o corpo no topo
    title: edge(DIALOG_TITLES),
    toasts,
  });
}

/** A camada de cima que ainda está na página (a que está saindo já não está). */
function topOpenLayer() {
  const open = layers.filter((layer) => layer.root.isConnected);
  return open[open.length - 1] ?? null;
}

/**
 * Liga um diálogo à pilha comum: Esc fecha só o de cima, o Tab fica preso no painel,
 * o resto da página fica inerte e sem rolagem, e ao fechar o foco volta para quem abriu.
 * Um diálogo que monta com outro de tipo mais alto aberto (ex.: o detalhe que vira modal ao girar
 * a tela com o painel de edição aberto) entra por baixo dele, inerte, e o foco fica onde está; ao
 * fechar, ele devolve o foco ao último item da página que teve o foco (a linha do evento). Se quem
 * abriu saiu da página e um igual entrou no lugar, o foco vai para o igual (ver twinOf).
 */
export function useDialogLayer({
  busy,
  initialFocusRef,
  kind = "view",
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
  /** Tipo, para a ordem na pilha (padrão "view"). */
  kind?: LayerKind;
}) {
  const closeRef = useRef(onClose);
  const busyRef = useRef(Boolean(busy));

  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = Boolean(busy);
  });

  // o painel de edição monta junto com a página: dali em diante o foco da página fica anotado
  useEffect(() => {
    trackFocus();
  }, []);

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
      rank: LAYER_RANK[kind],
      close: () => closeRef.current(),
      isBusy: () => busyRef.current,
      returnTo: () => returnFocusRef?.current ?? null,
      entry: () => initialFocusRef?.current ?? null,
      entered: false,
      origins: origin instanceof HTMLElement && origin !== document.body ? [origin] : [],
    };
    if (pushLayer(layer)) {
      layer.entered = true;
      layer.origins.forEach(remember);
      if (!panel.contains(document.activeElement)) {
        focusEntry(layer);
      }
    } else {
      // entrou por baixo: o foco está na camada de cima, que não é a origem desta. Quem abriu esta é
      // o último item da página que teve o foco e continua nela (a linha do evento, quando a coluna
      // do detalhe saiu porque a tela girou)
      layer.origins = recentFocus.filter(
        (element) => element.isConnected && !layers.some((item) => item.root.contains(element))
      );
      layer.origins.forEach(remember);
    }
    return () => popLayer(layer);
  }, [open, rootRef, panelRef, initialFocusRef, returnFocusRef, kind]);
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
      // Esc com o foco no aviso fecha só ele (o diálogo aberto fica) e o foco volta para onde estava
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          close();
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
      {/* o texto traz o título do evento ou o nome da pessoa: uma palavra longa quebra dentro do aviso */}
      <span className="min-w-0 grow basis-40 text-sm font-semibold leading-5 wrap-anywhere">{toast.text}</span>
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

// a rolagem a até 4 px do fim ainda está no fim (arredondamentos da rolagem e do zoom)
const PAGE_END_SLACK = 4;

/**
 * Espaço no pé da página enquanto há aviso: --toast-foot, do alto da pilha ao pé da tela mais a
 * folga, que vira a margem de baixo do #conteudo (globals.css). No fim da rolagem, o fim do
 * conteúdo fica acima dos avisos, e o item que recebe o foco lá embaixo tem para onde subir (sem
 * isso, no fim da página não sobrava rolagem e ele ficava coberto). O espaço só cresce enquanto
 * houver aviso (a página não pula quando um sai e outro fica) e sai com o último aviso, suave
 * (--toast-foot-ease): o fim da página desce junto. Com um diálogo aberto, a página de trás fica
 * parada (ver toastFootHeld).
 */
let toastFoot = 0;

/**
 * Quanto o pé cresceu com um diálogo aberto e a página de trás no fim. Ela fica parada atrás do
 * diálogo e, quando o último fechar, vai para o novo fim (followToastFoot), como quando o aviso
 * chega sem diálogo. Sem isso, o aviso que chegou com o diálogo aberto cobria o fim do conteúdo.
 */
let toastFootHeld = 0;

/** A página está no fim, sem contar o que o pé cresceu com um diálogo aberto. */
function pageAtEnd() {
  const root = document.documentElement;
  return window.scrollY + window.innerHeight >= root.scrollHeight - toastFootHeld - PAGE_END_SLACK;
}

function scrollToPageEnd() {
  const end = document.documentElement.scrollHeight - window.innerHeight;
  if (end > window.scrollY + 1) {
    window.scrollTo({ top: end, behavior: reducedMotion() ? "auto" : "smooth" });
  }
}

/**
 * Aumenta o pé da página. Se a página estava no fim, ela continua no fim: o fim do conteúdo sobe
 * acima dos avisos, como o card lateral da Gestão sobe com o --toast-corner. Com um diálogo aberto,
 * ela só vai para o novo fim quando o último fechar.
 */
function growToastFoot(room: number) {
  if (room <= toastFoot) {
    return;
  }
  const root = document.documentElement;
  const atEnd = pageAtEnd();
  const grown = room - toastFoot;
  toastFoot = room;
  root.style.setProperty("--toast-foot", `${room}px`);
  // entra de uma vez; só a saída é suave
  root.style.setProperty("--toast-foot-ease", "0s");
  if (!atEnd) {
    return;
  }
  if (layers.length) {
    toastFootHeld += grown;
    return;
  }
  toastFootHeld = 0;
  scrollToPageEnd();
}

/**
 * O último diálogo fechou (popLayer, no quadro seguinte: a página já está destravada e a tela de
 * trás já mudou o que tinha de mudar). Se a página continua no fim de antes, ela vai para o novo fim.
 */
function followToastFoot() {
  if (!toastFootHeld || layers.length) {
    return;
  }
  const atEnd = pageAtEnd();
  toastFootHeld = 0;
  if (atEnd) {
    scrollToPageEnd();
  }
}

function releaseToastFoot() {
  toastFoot = 0;
  toastFootHeld = 0;
  const root = document.documentElement;
  root.style.removeProperty("--toast-foot");
  root.style.removeProperty("--toast-foot-ease");
}

/**
 * Avisos no lugar normal (embaixo, sem diálogo aberto): o que recebe o foco fica acima deles.
 * No celular a pilha ocupa a largura toda, e a altura dela vira a folga de baixo da rolagem
 * (--toast-room, no scroll-margin-bottom do globals.css): o scrollIntoView das telas e o foco
 * pelo teclado já param acima dos avisos. Em qualquer largura, se o item focado ainda estiver
 * embaixo de um aviso quando a rolagem parar (a linha cresceu com "Salvo agora", ou, a partir
 * do tablet, o aviso do canto cobre a linha), a página sobe só o que falta; no fim da página, ela
 * sobe para dentro do espaço que os avisos abrem no pé dela (ver growToastFoot). O aviso que chega
 * (ou cresce) por cima do item focado pelo teclado também o faz subir; o clicado com o mouse fica.
 * A partir de 640 px, a altura do canto ocupado pelos avisos fica em --toast-corner: rolar não tira
 * de baixo deles um card grudado na tela (o lateral da Gestão), e ele usa a medida para deixar o
 * espaço livre. `present`: há aviso, em qualquer lugar (o pé da página fica enquanto houver).
 */
function useToastRoom(stackRef: RefObject<HTMLElement | null>, active: boolean, present: boolean) {
  useLayoutEffect(() => {
    if (!present) {
      return;
    }
    return releaseToastFoot;
  }, [present]);

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!active || !stack) {
      return;
    }
    const root = document.documentElement;
    const fullWidth = window.matchMedia("(max-width: 639px)");

    // no celular, --toast-room (a pilha na largura toda); a partir de 640 px, --toast-corner (a altura
    // do canto de baixo à direita ocupado por ela), para um card grudado na tela deixar o espaço dela.
    // Devolve a mesma altura, em px (0 sem ela)
    const measure = () => {
      const height = window.innerHeight - stack.getBoundingClientRect().top;
      const room = height > 0 ? Math.round(height) + TOAST_ROOM_GAP : 0;
      const [own, other] = fullWidth.matches ? ["--toast-room", "--toast-corner"] : ["--toast-corner", "--toast-room"];
      root.style.removeProperty(other);
      if (room) {
        root.style.setProperty(own, `${room}px`);
      } else {
        root.style.removeProperty(own);
      }
      return room;
    };

    let timer = 0;
    let pending = false;
    // subida pedida pela chegada de um aviso, e não por um foco novo: só vale para o foco do teclado
    let keysOnly = false;
    const lift = () => {
      pending = false;
      const keys = keysOnly;
      keysOnly = false;
      const target = document.activeElement;
      const content = document.getElementById("conteudo");
      if (layers.length || !(target instanceof HTMLElement) || target === content || !content?.contains(target)) {
        return;
      }
      if (keys && !target.matches(":focus-visible")) {
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
      keysOnly = false;
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
      keysOnly = false;
      window.clearTimeout(timer);
    };
    // chegou, cresceu ou voltou ao canto um aviso: o pé da página acompanha e, quando a rolagem parar,
    // o item focado pelo teclado que ficou embaixo dele sobe (um foco novo à espera vale como foco)
    const update = () => {
      growToastFoot(measure());
      if (!pending) {
        keysOnly = true;
      }
      pending = true;
      settle();
    };

    document.addEventListener("focusin", onFocus);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onUserScroll, { passive: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true });
    update();
    const watcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    watcher?.observe(stack);
    window.addEventListener("resize", update);
    return () => {
      watcher?.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.clearTimeout(timer);
      root.style.removeProperty("--toast-room");
      root.style.removeProperty("--toast-corner");
    };
  }, [active, stackRef]);
}

/** O item com o foco no corpo do diálogo, se ficou embaixo do fim da área que rola, sobe até ficar à vista. */
function revealFocusIn(panel: HTMLElement) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !panel.contains(active)) {
    return;
  }
  const body = active.closest<HTMLElement>(DIALOG_BODIES);
  if (!body || active === body) {
    return;
  }
  const view = body.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  const below = item.bottom + TOAST_ROOM_GAP - view.bottom;
  if (below > 0) {
    // sem levar o começo do item para cima do topo da área que rola
    const distance = Math.min(below, Math.max(0, item.top - view.top - TOAST_ROOM_GAP));
    body.scrollBy({ top: distance, behavior: reducedMotion() ? "auto" : "smooth" });
  }
}

/**
 * Avisos no pé do diálogo sem rodapé (o detalhe do evento): a caixa abre embaixo o espaço deles
 * (--toast-dock, no padding-bottom da .modal-box no globals.css) e o corpo passa a rolar só acima
 * deles. Assim nenhum conteúdo do detalhe fica por baixo do aviso, o Tab já para acima dele e o item
 * com o foco (ex.: "Atualizar lembrete", no fim do detalhe) sobe se tiver ficado embaixo.
 */
function useDialogDock(stackRef: RefObject<HTMLElement | null>, dock: string) {
  useLayoutEffect(() => {
    const stack = stackRef.current;
    const top = topOpenLayer();
    if (!dock || !stack || !top) {
      return;
    }
    const panel = top.panel;
    const apply = () => {
      // a pilha fica a uma folga do pé da caixa, acima da área segura (ver o style em ToastStack). A
      // conta não depende de onde a caixa está: a caixa centrada que cresce não muda o espaço
      const room = stack.offsetHeight + toastGap(document.documentElement.clientWidth);
      panel.style.setProperty("--toast-dock", `calc(${room}px + env(safe-area-inset-bottom))`);
    };
    const update = () => {
      apply();
      revealFocusIn(panel);
    };
    update();
    // chegou ou saiu um aviso: o espaço acompanha a altura da pilha
    const watcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    watcher?.observe(stack);
    return () => {
      watcher?.disconnect();
      panel.style.removeProperty("--toast-dock");
    };
  }, [dock, stackRef]);
}

/**
 * Avisos embaixo: no celular, na largura toda (12 px de cada lado), acima da área segura; no
 * computador, no canto direito. Com um diálogo aberto, eles desviam dele (ver toastSpot); no
 * detalhe sem rodapé, ficam no pé dele, no espaço que ele abre (ver useDialogDock); sem diálogo,
 * o item focado ou recém-salvo e o fim da página ficam acima deles (ver useToastRoom).
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
  const held = spot === TOAST_HOLD;
  const [edge, offset, left, width] = spot && !held ? spot.split(",") : [];
  useToastRoom(stackRef, ready && !spot && toasts.length > 0, ready && toasts.length > 0);
  useDialogDock(stackRef, ready && edge === "dock" ? spot : "");
  if (!ready) {
    return null;
  }
  const fromTop = edge === "top";
  // "foot" já é medido do alto do rodapé, que tem a área segura dentro dele
  const bottom = edge === "foot" ? `${offset}px` : `calc(${offset}px + env(safe-area-inset-bottom))`;
  const style: CSSProperties | undefined = edge
    ? {
        top: fromTop ? Number(offset) : "auto",
        bottom: fromTop ? "auto" : bottom,
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
      className={cx(TOAST_STACK, fromTop && "from-top", held && TOAST_HELD)}
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
          <p className="text-sm font-bold text-ink wrap-anywhere">{text}</p>
          {/* a dica pode trazer o título de um evento ("Próxima prova: ...") */}
          {hint ? <p className="mt-0.5 text-sm leading-5 text-muted wrap-anywhere">{hint}</p> : null}
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
      <p className="mt-2 text-[15px] font-bold text-ink wrap-anywhere">{text}</p>
      {hint ? <p className="max-w-sm text-sm leading-5 text-muted wrap-anywhere">{hint}</p> : null}
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
      {/* disciplina, turma e responsável vêm de quem cadastrou: uma palavra longa quebra na coluna */}
      <dd className="min-w-0 wrap-anywhere">{value}</dd>
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
  // na pilha: a confirmação fica por cima de tudo; com rodapé (as Preferências) é formulário, como o
  // painel de edição; sem rodapé (o detalhe do evento) fica por baixo deles
  const kind: LayerKind = role === "alertdialog" ? "confirm" : footer ? "form" : "view";

  useDialogLayer({ open: shown, rootRef, panelRef, onClose, busy, initialFocusRef, kind });

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
                  {/* o título da confirmação pode trazer o do evento: uma palavra longa quebra, sem rolar de lado */}
                  <h2 id={titleId} className="disp min-w-0 text-[22px] font-bold leading-tight wrap-anywhere">
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

  useDialogLayer({ open: visible, rootRef, panelRef, onClose, busy, initialFocusRef, kind: "form" });

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
            {/* o subtítulo traz o título do evento ou a disciplina e a turma: os itens encolhem (o título
                cortado com reticências cabe no painel) e uma palavra longa quebra */}
            {subtitle ? (
              <div
                id={subtitleId}
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted wrap-anywhere *:min-w-0"
              >
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

  // Quem abriu a confirmação (o X do painel, o Cancelar, o campo em edição). Ao fechar, se o foco caiu no body
  // ou no próprio painel de baixo, e não num item, ele volta para quem abriu (ex.: Esc no "Descartar as
  // alterações?" aberto pelo X volta ao X). Roda antes de a caixa abrir, com o foco ainda em quem abriu.
  useLayoutEffect(() => {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    if (!opener) {
      return;
    }
    return () => {
      const fix = () => {
        const now = document.activeElement;
        const lost = !now || now === document.body || (now instanceof HTMLElement && now.matches(".drawer, .modal-box"));
        if (lost && opener.isConnected && isOnTopLayer(opener)) {
          opener.focus({ preventScroll: true });
        }
      };
      window.requestAnimationFrame(fix);
      window.setTimeout(fix, 250);
    };
  }, []);

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
      {/* a mensagem traz o título do evento ou o nome da fonte importada */}
      <p id={messageId} className="text-sm leading-6 text-ink-3 wrap-anywhere">
        {confirm.message}
      </p>
    </Modal>
  );
}
