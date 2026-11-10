"use client";

import { ArrowLeft, Bell, CalendarDays, ClipboardCheck, MessageSquare, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef } from "react";
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
};

type Answer = "yes" | "no" | "depends";

type Row = { icon: LucideIcon; label: string; detail: string; answer: Answer; answerText?: string };

const answerLook: Record<Answer, { pill: string; text: string }> = {
  yes: { pill: "st-conc", text: "Sim" },
  no: { pill: "st-ag", text: "Não" },
  depends: { pill: "st-alt", text: "Depende" },
};

/** Título: "O que você vê" (com o aluno) ou "Quais dados o responsável vê". */
function dataTitle(student?: SeenStudent | null) {
  return student ? "O que você vê" : "Quais dados o responsável vê";
}

/** O texto em si: o resumo, o que vê e o que não vê, e as notas sobre o vínculo. */
export function GuardianDataContent({ student }: { student?: SeenStudent | null }) {
  const name = student ? firstName(student.fullName ?? "o aluno") : null;
  const rows: Row[] = [
    {
      icon: CalendarDays,
      label: "Agenda da turma",
      detail: "Provas, trabalhos e atividades da turma do aluno.",
      answer: "yes",
    },
    {
      icon: ShieldCheck,
      label: "Datas do campus",
      detail: "Feriados, recessos e semanas acadêmicas.",
      answer: "yes",
    },
    student && name
      ? {
          icon: ClipboardCheck,
          label: "Notas publicadas",
          detail: student.shareGrades
            ? "Só depois que a docente publica."
            : `${name} é maior de idade e decide se você vê as notas. Por enquanto, não compartilha.`,
          answer: student.shareGrades ? "yes" : "depends",
          answerText: student.shareGrades ? undefined : `Se ${name} compartilhar`,
        }
      : {
          icon: ClipboardCheck,
          label: "Notas publicadas",
          detail: "Só depois que a docente publica. De aluno maior de idade, só se ele compartilhar.",
          answer: "yes",
        },
    {
      icon: Bell,
      label: name ? `Lembretes de ${name}` : "Lembretes do aluno",
      detail: "Os lembretes que o responsável cria são só dele.",
      answer: "no",
    },
    {
      icon: Users,
      label: "Colegas da turma",
      detail: "Nem os nomes nem as notas de outros alunos.",
      answer: "no",
    },
    {
      icon: MessageSquare,
      label: "Mensagens",
      detail: "A agenda não tem conversa entre aluno e responsável.",
      answer: "no",
    },
  ];

  return (
    <div className="grid gap-5 text-sm leading-6 text-ink-3">
      <p>
        {student && name
          ? `Você acompanha a agenda de ${name} como ${relationshipText(student.relationship).toLocaleLowerCase("pt-BR")}, só para leitura: não cria, não muda e não conclui nada.`
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
        <li>Do responsável, guardamos só o nome, o e-mail e o parentesco.</li>
        <li>O aluno vê no perfil quem acompanha a agenda dele e recebe um aviso a cada vínculo criado ou desfeito.</li>
        <li>Aluno menor de idade: a secretaria confirma o vínculo antes de liberar.</li>
        <li>
          {student
            ? "Você pode deixar de acompanhar quando quiser, no seu perfil."
            : "O responsável pode deixar de acompanhar quando quiser. O aluno maior de idade também pode desfazer o vínculo no perfil dele."}
        </li>
      </ul>
    </div>
  );
}

export function GuardianDataDialog({ open, onClose, student }: GuardianDataDialogProps) {
  if (!open) {
    return null;
  }
  return (
    <Modal
      title={dataTitle(student)}
      onClose={onClose}
      footer={
        <button className={secondaryButton} onClick={onClose} type="button">
          Fechar
        </button>
      }
    >
      <GuardianDataContent student={student} />
    </Modal>
  );
}

export type GuardianDataViewProps = {
  /** Volta ao conteúdo de antes; quem monta devolve o foco ao link que abriu. */
  onBack: () => void;
  student?: SeenStudent | null;
  /** Nível do título: 3 no painel lateral (o título do painel é h2), 4 no perfil (dentro de uma seção h3). */
  level?: 3 | 4;
  className?: string;
};

/**
 * O mesmo texto no lugar do conteúdo de um painel ou do perfil (nunca diálogo sobre painel): Voltar em cima, o
 * título e o texto. Ao aparecer, o foco vai para o título, e a pessoa lê do começo.
 */
export function GuardianDataView({ onBack, student, level = 3, className }: GuardianDataViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const Heading = level === 4 ? "h4" : "h3";

  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) {
      return;
    }
    heading.focus({ preventScroll: true });
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, []);

  return (
    <section className={className ? `resp-data-view ${className}` : "resp-data-view"} aria-labelledby={titleId}>
      <button className="btn btn-s btn-sm resp-data-back" onClick={onBack} type="button">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </button>
      <Heading ref={headingRef} id={titleId} className="resp-h3 resp-data-title" tabIndex={-1}>
        {dataTitle(student)}
      </Heading>
      <GuardianDataContent student={student} />
    </section>
  );
}
