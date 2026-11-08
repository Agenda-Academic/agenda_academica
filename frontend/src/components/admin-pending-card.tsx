"use client";

import { ArrowRight, BookOpen, ChevronRight, CircleCheck, TriangleAlert, UserPlus, Users } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { getClasses, getGuardianLinks } from "@/lib/api";
import { classLabel, cx, errorMessage, firstName, formatDateBR, relationshipText } from "@/lib/format";
import type { AdminGuardianLink, ClassSummary } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { plural, useRemote } from "./classes-shared";
import { delay, showAllText } from "./dashboard-bits";
import { EmptyState, RetryButton, SectionTitle } from "./ui";

/**
 * Card "Pendências" do Painel da administração (desenho 5.3): pedidos de entrada (counts.pendingStudents de
 * GET /classes), vínculos de responsável pendentes (GET /guardian-links?status=pending) e disciplinas sem
 * docente (counts.subjectsWithoutTeacher). Cada item leva ao painel certo com
 * useAppActions().openClasses({ classId, memberId }). Dona: área Admin (renderiza em dashboard-admin.tsx).
 */
export type AdminPendingCardProps = {
  /** Posição na animação de entrada do Painel (delay). */
  order?: number;
  /**
   * Muda quando a altura do card muda (dados chegaram, "Ver todos"): o Painel refaz a conta das colunas que
   * terminam juntas (useColumnFill).
   */
  onLayoutChange?: (key: string) => void;
};

type PendingItem = {
  key: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  detail: string;
  classId: number | null;
  memberId: number | null;
};

const LIMIT = 4;

function buildItems(classes: ClassSummary[], links: AdminGuardianLink[]): PendingItem[] {
  const requests = classes
    .filter((item) => item.counts.pendingStudents > 0)
    .map<PendingItem>((item) => ({
      key: `pedidos-${item.id}`,
      icon: Users,
      title: `${plural(item.counts.pendingStudents, "pedido de entrada", "pedidos de entrada")} na ${item.name}`,
      detail: `${classLabel(item)}. Aprove ou recuse no painel da turma.`,
      classId: item.id,
      memberId: null,
    }));
  const pendingLinks = links.map<PendingItem>((link) => {
    const studentName = link.student?.fullName ?? "aluno";
    return {
      key: `vinculo-${link.id}`,
      icon: UserPlus,
      title: `${link.fullName ?? link.email} quer acompanhar ${firstName(studentName)}`,
      detail: `${relationshipText(link.relationship)} de ${studentName}, pedido em ${formatDateBR(link.createdAt)}${
        link.student?.isMinor ? ". Aluno menor: a secretaria aprova" : ""
      }.`,
      classId: null,
      memberId: link.studentId,
    };
  });
  const withoutTeacher = classes
    .filter((item) => item.counts.subjectsWithoutTeacher > 0)
    .map<PendingItem>((item) => ({
      key: `docente-${item.id}`,
      icon: BookOpen,
      title: `${plural(item.counts.subjectsWithoutTeacher, "disciplina sem docente", "disciplinas sem docente")} na ${item.name}`,
      detail: `${classLabel(item)}. Vincule a docente de cada disciplina.`,
      classId: item.id,
      memberId: null,
    }));
  return [...requests, ...pendingLinks, ...withoutTeacher];
}

export function AdminPendingCard({ order = 0, onLayoutChange }: AdminPendingCardProps) {
  const { token, user, openClasses } = useAppActions();
  const remote = useRemote(`admin:${user.id}:pendencias`, async () => {
    const [classes, links] = await Promise.all([getClasses(token), getGuardianLinks(token, "pending")]);
    return { classes, links };
  });
  const [expanded, setExpanded] = useState(false);
  const items = remote.data ? buildItems(remote.data.classes, remote.data.links) : [];
  const shown = expanded ? items : items.slice(0, LIMIT);
  const state = remote.data ? "ok" : remote.error ? "erro" : "carregando";

  useEffect(() => {
    onLayoutChange?.(`${state}:${shown.length}:${items.length}`);
  }, [onLayoutChange, state, shown.length, items.length]);

  const subtitle = remote.data
    ? items.length
      ? plural(items.length, "item para resolver", "itens para resolver")
      : "Tudo em dia"
    : remote.error
      ? "Não deu para carregar"
      : "Carregando";

  return (
    <section className="card pad rise" style={delay(order)} aria-labelledby="pendencias-titulo" aria-busy={state === "carregando" || undefined}>
      <SectionTitle id="pendencias-titulo" title="Pendências" subtitle={subtitle} />
      {state === "carregando" ? (
        <div className="admin-pend-list" role="status">
          <span className="sr-only">Carregando as pendências</span>
          {[0, 1, 2].map((row) => (
            <span key={row} className="admin-skel-row">
              <span className="skel h-9 w-9 shrink-0 !rounded-xl" />
              <span className="grid flex-1 gap-2">
                <span className="skel h-3.5 w-3/4" />
                <span className="skel h-3 w-1/2" />
              </span>
            </span>
          ))}
        </div>
      ) : state === "erro" ? (
        <div className="empty-inline compact mt-3.5" role="alert">
          <span className="empty-ico bg-[#ffe4e8] text-[#be123c]">
            <TriangleAlert className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Não deu para carregar as pendências</p>
            <p className="mt-0.5 text-sm leading-5 text-muted">{errorMessage(remote.error)}</p>
            <RetryButton className="btn btn-s btn-sm mt-2.5" onRetry={() => void remote.reload()} />
          </div>
        </div>
      ) : items.length ? (
        <ul className="admin-pend-list">
          {shown.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <button
                  className={cx("mini admin-mini", item.key.startsWith("vinculo") ? "admin-mini-blue" : "admin-mini-warn")}
                  onClick={() => openClasses({ classId: item.classId, memberId: item.memberId })}
                  type="button"
                >
                  <span className="mini-ico">
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mini-t block wrap-anywhere">{item.title}</span>
                    <span className="mini-s block">{item.detail}</span>
                  </span>
                  <ChevronRight className="admin-go mt-2" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-3.5">
          <EmptyState
            compact
            icon={CircleCheck}
            text="Tudo em dia"
            hint="Nenhum pedido de entrada, vínculo pendente ou disciplina sem docente."
            action={{ label: "Abrir Turmas e disciplinas", onClick: () => openClasses() }}
          />
        </div>
      )}
      {items.length > LIMIT ? (
        <div className="card-foot">
          <button className="link" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} type="button">
            {expanded ? "Mostrar menos" : showAllText("Ver todos", items.length)}
            <ArrowRight className={cx("h-[15px] w-[15px]", expanded && "-rotate-90")} aria-hidden />
          </button>
        </div>
      ) : null}
    </section>
  );
}
