"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";
import { popoverHost } from "./select";

export type RowMenuItem<Id extends string = string> = {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** Segunda linha, menor ("TADS 5, Noturno"), no menu "Para qual disciplina?". */
  description?: string;
  /** "danger": Excluir, em vermelho e separado por uma linha. */
  tone?: "danger";
  /** Indisponível agora (ex.: salvando): fica na lista, apagado. */
  disabled?: boolean;
};

/** Distância entre o botão e o menu, e a margem mínima até a borda da tela. */
const GAP = 6;
const EDGE = 8;

type MenuButtonProps<Id extends string> = {
  /** Nome do botão: "Mais ações de Prova de Matemática". */
  label: string;
  items: RowMenuItem<Id>[];
  /** Opção escolhida (o menu já fechou e o foco já voltou ao botão). */
  onSelect: (id: Id) => void;
  /** Classe do botão (padrão: botão de ícone com borda, os três pontos). */
  triggerClassName?: string;
  /** Conteúdo do botão (padrão: os três pontos). */
  trigger?: ReactNode;
  /** Título no alto do menu ("Para qual disciplina?"). */
  heading?: string;
  /** Classe a mais no botão (ex.: "gx-more" para o lugar dele na linha). */
  className?: string;
  /** Largura mínima do menu. */
  minWidth?: number;
  /** Dica do botão (title). */
  title?: string;
  /** "end" (padrão): o menu termina na borda direita do botão; "start": começa na esquerda. */
  align?: "start" | "end";
};

/**
 * Botão que abre um menu pequeno: o "Mais ações" (três pontos) das linhas da Gestão e a seta do "Novo evento"
 * ("Para qual disciplina?"). Setas, Home e End andam pelas opções; Esc e Tab fecham e o foco volta para o botão;
 * clicar fora fecha. O menu vai para o body (o card corta o que passa da borda) e abre para cima quando não cabe
 * embaixo. Ao escolher, o menu fecha e o foco volta ao botão antes da ação: a confirmação de excluir devolve o
 * foco para ele.
 */
export function MenuButton<Id extends string>({
  label,
  items,
  onSelect,
  triggerClassName = "ib sm bd",
  trigger,
  heading,
  className,
  minWidth = 200,
  title = "Mais ações",
  align = "end",
}: MenuButtonProps<Id>) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const headingId = useId();
  // dentro de um diálogo (o painel do evento), o menu entra nele: fora dele a página está inerte
  const [host, setHost] = useState<HTMLElement | null>(null);

  // posição: embaixo do botão, alinhado à direita dele; sem espaço embaixo, por cima
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const update = () => {
      const button = triggerRef.current;
      const menu = menuRef.current;
      if (!button || !menu) {
        return;
      }
      const box = button.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const room = window.innerHeight - box.bottom;
      const up = room < height + GAP + EDGE && box.top > room;
      const viewW = document.documentElement.clientWidth;
      const left = Math.min(Math.max(EDGE, align === "start" ? box.left : box.right - width), viewW - width - EDGE);
      const top = up ? Math.max(EDGE, box.top - GAP - height) : box.bottom + GAP;
      // um ancestral com transform (o painel) muda o ponto (0, 0) do fixed: uma sonda mostra onde ele fica
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none";
      menu.parentElement?.insertBefore(probe, menu);
      const origin = probe.getBoundingClientRect();
      probe.remove();
      setPlace((current) =>
        current && current.top === top - origin.top && current.left === left - origin.left && current.up === up
          ? current
          : { top: top - origin.top, left: left - origin.left, up }
      );
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, align]);

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
      setPlace(null);
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
        className={cx(triggerClassName, "gx-menu-btn", open && "on", className)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
        onClick={(event) => {
          // a linha inteira também abre o editor: o clique do botão fica só com ele
          event.stopPropagation();
          if (open) {
            close(false);
          } else {
            setHost(popoverHost(triggerRef.current));
            setOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setHost(popoverHost(triggerRef.current));
            setOpen(true);
          }
        }}
        type="button"
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" aria-hidden />}
      </button>
      {open && host
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className={cx("gestao-menu", place?.up && "up")}
              role="menu"
              aria-label={heading ? undefined : label}
              aria-labelledby={heading ? headingId : undefined}
              style={{
                minWidth,
                ...(place ? { top: place.top, left: place.left } : { top: -9999, left: -9999, visibility: "hidden" }),
              }}
              onKeyDown={onMenuKey}
              onClick={(event) => event.stopPropagation()}
            >
              {heading ? (
                <p id={headingId} className="gestao-menu-h">
                  {heading}
                </p>
              ) : null}
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={cx(
                      "gestao-menu-item",
                      item.description && "two",
                      item.tone === "danger" && "danger"
                    )}
                    role="menuitem"
                    aria-disabled={item.disabled || undefined}
                    tabIndex={-1}
                    onClick={() => choose(item)}
                    type="button"
                  >
                    {item.description ? (
                      <span className="gestao-menu-ico" aria-hidden>
                        <Icon className="h-4 w-4" />
                      </span>
                    ) : (
                      <Icon className="h-4 w-4" aria-hidden />
                    )}
                    {item.description ? (
                      <span className="min-w-0">
                        <b>{item.label}</b>
                        <span>{item.description}</span>
                      </span>
                    ) : (
                      item.label
                    )}
                  </button>
                );
              })}
            </div>,
            host
          )
        : null}
    </>
  );
}

/** "Mais ações" de uma linha da Gestão: os três pontos com borda. */
export function RowMenu<Id extends string>({
  label,
  items,
  onSelect,
  className,
}: {
  label: string;
  items: RowMenuItem<Id>[];
  onSelect: (id: Id) => void;
  className?: string;
}) {
  return <MenuButton label={label} items={items} onSelect={onSelect} className={cx("gestao-more", className)} />;
}
