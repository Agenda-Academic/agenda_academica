"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { cx } from "@/lib/format";

/**
 * Paginação das listas longas (rodada de UX de 2026-11-17). Regra: nenhuma lista expande no próprio lugar até
 * virar uma rolagem sem fim ("Ver todos (115)"). Ela mostra uma página por vez, com "Mostrando 11 a 20 de 115"
 * e os números das páginas; trocar de página leva o topo da lista para a vista e o foco para o título dela.
 *
 * Uso:
 *   const paged = usePaged(items, 10, `${aba}|${busca}`);
 *   paged.items.map(...)
 *   <Pager paged={paged} noun={["data", "datas"]} focusRef={tituloRef} />
 */
export type Paged<T> = {
  /** Itens da página atual. */
  items: T[];
  /** Página atual, a partir de 1. */
  page: number;
  pageCount: number;
  total: number;
  /** Posição do primeiro e do último item da página (1 a total). */
  from: number;
  to: number;
  setPage: (page: number) => void;
};

/** Divide `all` em páginas de `size`. Quando `resetKey` muda (aba, filtro, busca), volta para a página 1. */
export function usePaged<T>(all: T[], size: number, resetKey = "", initialPage = 1): Paged<T> {
  const [state, setState] = useState({ key: resetKey, page: initialPage });
  let page = state.page;
  if (state.key !== resetKey) {
    page = 1;
    setState({ key: resetKey, page: 1 });
  }
  const pageCount = Math.max(1, Math.ceil(all.length / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;
  const items = all.slice(start, start + size);
  return {
    items,
    page: current,
    pageCount,
    total: all.length,
    from: all.length ? start + 1 : 0,
    to: start + items.length,
    setPage: (next) => setState({ key: resetKey, page: Math.min(Math.max(1, next), pageCount) }),
  };
}

/** Números que cabem: sempre a primeira, a última e as vizinhas da atual; o resto vira "...". */
function pageList(page: number, count: number): Array<number | "gap"> {
  if (count <= 7) {
    return Array.from({ length: count }, (_, index) => index + 1);
  }
  const set = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((value) => set.add(value));
  if (page >= count - 2) [count - 1, count - 2, count - 3].forEach((value) => set.add(value));
  const sorted = [...set].filter((value) => value >= 1 && value <= count).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  sorted.forEach((value, index) => {
    if (index && value - sorted[index - 1] > 1) result.push("gap");
    result.push(value);
  });
  return result;
}

export function Pager<T>({
  className,
  focusRef,
  noun,
  paged,
}: {
  paged: Paged<T>;
  /** Singular e plural do que a lista mostra: ["data", "datas"]. */
  noun: [string, string];
  /** Título (ou o primeiro item) da lista: recebe o foco e vai para a vista depois de trocar de página. */
  focusRef?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const { from, page, pageCount, setPage, to, total } = paged;
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const target = focusRef?.current;
    if (!target) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    // A lista pode estar na página ou dentro de um painel com rolagem própria (Drawer/Modal). Se o título
    // ficou fora da área visível do que rola (inclusive escondido sob o cabeçalho fixo do painel), traz de volta.
    const scroller = target.closest(".drawer-body, .modal-body, [data-scroll]") as HTMLElement | null;
    const top = target.getBoundingClientRect().top;
    const limit = scroller ? scroller.getBoundingClientRect().top : 0;
    if (top < limit + 8) {
      target.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }
  }, [page, focusRef]);

  if (pageCount <= 1) {
    return null;
  }

  function go(next: number) {
    if (next === page || next < 1 || next > pageCount) return;
    moved.current = true;
    setPage(next);
  }

  return (
    <nav className={cx("pager", className)} aria-label={`Páginas de ${noun[1]}`}>
      <p className="pager-info" aria-live="polite">
        Mostrando <b>{from}</b> a <b>{to}</b> de <b>{total}</b> {total === 1 ? noun[0] : noun[1]}
      </p>
      <div className="pager-btns">
        <button
          className="pager-b pager-arrow"
          aria-label="Página anterior"
          disabled={page === 1}
          onClick={() => go(page - 1)}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span className="pager-arrow-t">Anterior</span>
        </button>
        {pageList(page, pageCount).map((value, index) =>
          value === "gap" ? (
            <span key={`gap-${index}`} className="pager-gap" aria-hidden>
              ...
            </span>
          ) : (
            <button
              key={value}
              className={cx("pager-b", value === page && "on")}
              aria-current={value === page ? "page" : undefined}
              aria-label={`Página ${value}`}
              onClick={() => go(value)}
              type="button"
            >
              {value}
            </button>
          )
        )}
        <button
          className="pager-b pager-arrow"
          aria-label="Próxima página"
          disabled={page === pageCount}
          onClick={() => go(page + 1)}
          type="button"
        >
          <span className="pager-arrow-t">Próxima</span>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
