"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";

export type RowMenuItem<Id extends string = string> = {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** "danger": Excluir, em vermelho e separado por uma linha. */
  tone?: "danger";
  /** Indisponível agora (ex.: salvando): fica na lista, apagado. */
  disabled?: boolean;
};

/** Distância entre o botão e o menu, e a margem mínima até a borda da tela. */
const GAP = 6;
const EDGE = 8;

/**
 * "Mais ações" de uma linha da Gestão: o botão de três pontos abre um menu pequeno (Notas, Concluir,
 * Excluir). Setas, Home e End andam pelas opções; Esc e Tab fecham e o foco volta para o botão; clicar
 * fora fecha. O menu vai para o body (o card corta o que passa da borda) e abre para cima quando não
 * cabe embaixo. Ao escolher, o menu fecha e o foco volta ao botão antes da ação: a confirmação de
 * excluir devolve o foco para ele.
 */
export function RowMenu<Id extends string>({
  label,
  items,
  onSelect,
  className,
}: {
  /** Nome do botão: "Mais ações de Prova de Matemática". */
  label: string;
  items: RowMenuItem<Id>[];
  /** Opção escolhida (o menu já fechou e o foco já voltou ao botão). */
  onSelect: (id: Id) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // posição: embaixo do botão, alinhado à direita dele; sem espaço embaixo, por cima
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) {
        return;
      }
      const box = trigger.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const room = window.innerHeight - box.bottom;
      const up = room < height + GAP + EDGE && box.top > room;
      const left = Math.min(Math.max(EDGE, box.right - width), window.innerWidth - width - EDGE);
      const top = up ? Math.max(EDGE, box.top - GAP - height) : box.bottom + GAP;
      setPlace((current) =>
        current && current.top === top && current.left === left && current.up === up ? current : { top, left, up }
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // abriu (e já tem lugar): o foco vai para a primeira opção disponível, uma vez só
  const placed = Boolean(place);
  useEffect(() => {
    if (open && placed) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    }
  }, [open, placed]);

  // clique ou toque fora fecha (sem tirar o foco de onde a pessoa clicou)
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open]);

  function close(focusTrigger: boolean) {
    setOpen(false);
    setPlace(null);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  }

  function choose(item: RowMenuItem<Id>) {
    if (item.disabled) {
      return;
    }
    close(true);
    onSelect(item.id);
  }

  function onMenuKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    const options = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === "ArrowDown") {
      next = options[(index + 1) % options.length];
    } else if (event.key === "ArrowUp") {
      next = options[(index - 1 + options.length) % options.length];
    } else if (event.key === "Home") {
      next = options[0];
    } else if (event.key === "End") {
      next = options[options.length - 1];
    } else if (event.key === "Escape") {
      // o Esc é do menu: o painel aberto embaixo dele (se houver) não fecha junto
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    } else if (event.key === "Tab") {
      event.preventDefault();
      close(true);
      return;
    }
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={cx("ib sm gestao-more", open && "on", className)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Mais ações"
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        type="button"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className={cx("gestao-menu", place?.up && "up")}
              role="menu"
              aria-label={label}
              style={place ? { top: place.top, left: place.left } : { top: -9999, left: -9999, visibility: "hidden" }}
              onKeyDown={onMenuKey}
            >
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={cx("gestao-menu-item", item.tone === "danger" && "danger")}
                    role="menuitem"
                    aria-disabled={item.disabled || undefined}
                    tabIndex={-1}
                    onClick={() => choose(item)}
                    type="button"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
