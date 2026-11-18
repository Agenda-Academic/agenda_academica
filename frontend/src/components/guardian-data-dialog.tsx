"use client";

import { ArrowLeft, Bell, CalendarDays, ClipboardCheck, MessageSquare, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type RefObject } from "react";
import { firstName, relationshipText } from "@/lib/format";
import type { LinkedStudent } from "@/lib/types";
import { Modal, secondaryButton } from "./ui";

/**
 * "Quais dados o responsável vê", em linguagem simples (desenho 5.6 e 6.1). Abre do cadastro (tela de entrada,
 * fora do app: não use useAppActions aqui), do perfil do aluno, do perfil do responsável, do card Vincular aluno e
 * do Painel do responsável ("O que você vê", com o aluno: a linha das notas diz se ele compartilha). Dona: área
 * Responsável.
 *
 * Nunca diálogo sobre painel (desenho 5.1): dentro do painel lateral "Acompanhar outro aluno" e do perfil (que já
 * é um diálogo), use GuardianDataView, que troca o conteúdo e mostra Voltar. O diálogo fica para quando nada está
 * aberto (cadastro, Painel e tela Notas). O texto é o mesmo nos dois (GuardianDataContent).
 */

/**
 * Responsável olhando o aluno que acompanha (Painel): o título vira "O que você vê" e a linha das notas diz se
 * o aluno compartilha. Sem ele, o texto vale para qualquer responsável.
 */
type SeenStudent = Pick<LinkedStudent, "fullName" | "relationship" | "shareGrades">;

export type GuardianDataDialogProps = {
  open: boolean;
  onClose: () => void;
  student?: SeenStudent | null;
  /**
   * Quem lê é o responsável logado, sem um aluno escolhido (card Vincular aluno, perfil, Notas): o texto fala com
   * ele ("você", decisão 10) e o título vira "O que você vê". Sem isso, vale para qualquer pessoa (cadastro, aluno).
   */
  forGuardian?: boolean;
};

/**
 * Texto do link que abre esta explicação: para o próprio responsável, "Ver detalhes do que você vê"; para o aluno,
 * a administração e o cadastro, "Quais dados o responsável vê".
 */
export function guardianDataLinkLabel(forGuardian?: boolean) {
  return forGuardian ? "Ver detalhes do que você vê" : "Quais dados o responsável vê";
}

type Answer = "yes" | "no" | "depends";

type Row = { icon: LucideIcon; label: string; detail: string; answer: Answer; answerText?: string };

const answerLook: Record<Answer, { pill: string; text: string }> = {
  yes: { pill: "stat stat-conc", text: "Sim" },
  no: { pill: "stat", text: "Não" },
  depends: { pill: "stat stat-alt", text: "Depende" },
};

/**
 * Os nomes de cada linha de "O que você vê", numa lista só: o card da tela Notas, este diálogo e o perfil usam os
 * mesmos rótulos, na mesma ordem. Com o nome do aluno, os lembretes viram "Lembretes de Diogo".
 */
export const GUARDIAN_SEES_ORDER = ["agenda", "dates", "grades", "reminders", "classmates", "messages"] as const;
export type GuardianSeesKey = (typeof GUARDIAN_SEES_ORDER)[number];
export function guardianSeesLabels(name?: string | null): Record<GuardianSeesKey, string> {
  return {
    agenda: "Agenda da turma",
    dates: "Datas da instituição",
    grades: "Notas publicadas",
    reminders: name ? `Lembretes de ${name}` : "Lembretes do aluno",
    classmates: "Colegas da turma",
    messages: "Mensagens",
  };
}

/** Título: "O que você vê" (com o aluno ou para o próprio responsável) ou "Quais dados o responsável vê". */
function dataTitle(student?: SeenStudent | null, forGuardian?: boolean) {
  return student || forGuardian ? "O que você vê" : "Quais dados o responsável vê";
}

/** O texto em si: o resumo, o que vê e o que não vê, e as notas sobre o vínculo. */
export function GuardianDataContent({ student, forGuardian }: { student?: SeenStudent | null; forGuardian?: boolean }) {
  const name = student ? firstName(student.fullName ?? "o aluno") : null;
  // quem lê é o responsável (com ou sem o aluno escolhido): o texto usa "você"
  const you = Boolean(student) || Boolean(forGuardian);
  const labels = guardianSeesLabels(name);
  const rows: Row[] = [
    {
      icon: CalendarDays,
      label: labels.agenda,
      detail: "Provas, trabalhos e atividades da turma do aluno.",
      answer: "yes",
    },
    {
      icon: ShieldCheck,
      label: labels.dates,
      detail: "Feriados, recessos e semanas acadêmicas.",
      answer: "yes",
    },
    student && name
      ? {
          icon: ClipboardCheck,
          label: labels.grades,
          detail: student.shareGrades
            ? "Só depois que a docente publica."
            : `${name} é maior de idade e decide se você vê as notas. Por enquanto, não compartilha.`,
          answer: student.shareGrades ? "yes" : "depends",
          answerText: student.shareGrades ? undefined : `Se ${name} compartilhar`,
        }
      : {
          icon: ClipboardCheck,
          label: labels.grades,
          detail: "Só depois que a docente publica. De aluno maior de idade, só se ele compartilhar.",
          answer: "yes",
        },
    {
      icon: Bell,
      label: labels.reminders,
      // quem lê com o aluno é o responsável ("você"); sem ele, o texto vale para qualquer pessoa (o aluno no
      // perfil dele, o cadastro), na terceira pessoa, sem um "dele" que não diz de quem
      detail: name
        ? `Você não vê os lembretes que ${name} cria, e os seus ficam só com você.`
        : forGuardian
          ? "Você não vê os lembretes que o aluno cria, e os seus ficam só com você."
          : "O responsável não vê os lembretes que o aluno cria, e o aluno não vê os do responsável.",
      answer: "no",
    },
    {
      icon: Users,
      label: labels.classmates,
      detail: "Nem os nomes nem as notas de outros alunos.",
      answer: "no",
    },
    {
      icon: MessageSquare,
      label: labels.messages,
      detail: "A agenda não tem conversa entre aluno e responsável.",
      answer: "no",
    },
  ];

  return (
    <div className="grid gap-5 text-sm leading-6 text-ink-3">
      <p>
        {student && name
          ? `Você acompanha a agenda de ${name} como ${relationshipText(student.relationship).toLocaleLowerCase("pt-BR")}, só para leitura: não cria, não muda e não conclui nada.`
          : forGuardian
            ? "Você acompanha a agenda do aluno só para leitura: não cria, não muda e não conclui nada. O vínculo nasce do código que o aluno gera no perfil dele ou que a secretaria entrega."
            : "O responsável acompanha a agenda de um aluno só para leitura: não cria, não muda e não conclui nada. O vínculo nasce do código que o aluno gera no perfil dele ou que a secretaria entrega."}
      </p>

      <dl className="resp-sees">
        {rows.map((row) => {
          const Icon = row.icon;
          const look = answerLook[row.answer];
          return (
            <div key={row.label} className="resp-sees-row">
              <dt className="resp-sees-lab">
                <Icon className="resp-sees-ico" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{row.label}</span>
                  <span className="block text-[13px] leading-5 text-muted">{row.detail}</span>
                </span>
              </dt>
              <dd>
                <span className={`pill ${look.pill}`}>{row.answerText ?? look.text}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      <ul className="resp-sees-notes">
        <li>{you ? "De você, guardamos só o nome, o e-mail e o parentesco." : "Do responsável, guardamos só o nome, o e-mail e o parentesco."}</li>
        <li>O aluno vê no perfil quem acompanha a agenda dele e recebe um aviso a cada vínculo criado ou desfeito.</li>
        <li>Aluno menor de idade: a secretaria confirma o vínculo antes de liberar.</li>
        <li>
          {you
            ? "Você pode deixar de acompanhar quando quiser, no seu perfil."
            : "O responsável pode deixar de acompanhar quando quiser. O aluno maior de idade também pode desfazer o vínculo no perfil dele."}
        </li>
      </ul>
    </div>
  );
}

export function GuardianDataDialog({ open, onClose, student, forGuardian }: GuardianDataDialogProps) {
  if (!open) {
    return null;
  }
  return (
    <Modal
      title={dataTitle(student, forGuardian)}
      onClose={onClose}
      footer={
        <button className={secondaryButton} onClick={onClose} type="button">
          Fechar
        </button>
      }
    >
      <GuardianDataContent student={student} forGuardian={forGuardian} />
    </Modal>
  );
}

export type GuardianDataViewProps = {
  /** Volta ao conteúdo de antes; quem monta devolve o foco ao link que abriu. */
  onBack: () => void;
  student?: SeenStudent | null;
  /** Quem lê é o responsável logado (ver GuardianDataDialogProps.forGuardian). */
  forGuardian?: boolean;
  /** Nível do título: 3 no painel lateral (o título do painel é h2), 4 no perfil (dentro de uma seção h3). */
  level?: 3 | 4;
  className?: string;
  /**
   * O que sobe para o alto da área que rola ao abrir. Padrão: a própria seção (com o Voltar). No perfil, a seção
   * de fora, para o título dela ("Alunos que você acompanha") não ficar cortado embaixo do cabeçalho do diálogo.
   */
  scrollTargetRef?: RefObject<HTMLElement | null>;
};

/**
 * O mesmo texto no lugar do conteúdo de um painel ou do perfil (nunca diálogo sobre painel): Voltar em cima, o
 * título e o texto. Ao aparecer, o foco vai para o título, e a pessoa lê do começo.
 */
export function GuardianDataView({
  onBack,
  student,
  forGuardian,
  level = 3,
  className,
  scrollTargetRef,
}: GuardianDataViewProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const Heading = level === 4 ? "h4" : "h3";

  // a seção inteira sobe para o alto da área que rola (o diálogo ou o painel), com o Voltar à vista. Com
  // "nearest" nada rolava quando o título já aparecia um pouco atrás do rodapé fixo, e o toque parecia não fazer nada
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) {
      return;
    }
    heading.focus({ preventScroll: true });
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (scrollTargetRef?.current ?? sectionRef.current)?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    // só ao aparecer (o ref do alvo não muda enquanto a vista está aberta)
  }, [scrollTargetRef]);

  return (
    <section ref={sectionRef} className={className ? `resp-data-view ${className}` : "resp-data-view"} aria-labelledby={titleId}>
      <button className="btn btn-s btn-sm resp-data-back" onClick={onBack} type="button">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </button>
      <Heading ref={headingRef} id={titleId} className="resp-h3 resp-data-title drawer-h3" tabIndex={-1}>
        {dataTitle(student, forGuardian)}
      </Heading>
      <GuardianDataContent student={student} forGuardian={forGuardian} />
    </section>
  );
}
