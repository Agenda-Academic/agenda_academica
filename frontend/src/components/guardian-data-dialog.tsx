"use client";

import { Bell, CalendarDays, ClipboardCheck, MessageSquare, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { firstName, relationshipText } from "@/lib/format";
import type { LinkedStudent } from "@/lib/types";
import { Modal, secondaryButton } from "./ui";

/**
 * "Quais dados o responsável vê", em linguagem simples (desenho 5.6 e 6.1). Abre do cadastro (tela de entrada,
 * fora do app: não use useAppActions aqui), do perfil do aluno, do perfil do responsável, do card Vincular aluno e
 * do Painel do responsável ("O que você vê", com o aluno: a linha das notas diz se ele compartilha). Dona: área
 * Responsável.
 *
 * Mantenha o footer: o Modal com rodapé entra na pilha como formulário e fica por cima das Configurações do
 * perfil e do painel lateral (sem rodapé ele entraria por baixo deles).
 */
export type GuardianDataDialogProps = {
  open: boolean;
  onClose: () => void;
  /**
   * Responsável olhando o aluno que acompanha (Painel): o título vira "O que você vê" e a linha das notas diz se
   * o aluno compartilha. Sem ele, o texto vale para qualquer responsável.
   */
  student?: Pick<LinkedStudent, "fullName" | "relationship" | "shareGrades"> | null;
};

type Answer = "yes" | "no" | "depends";

type Row = { icon: LucideIcon; label: string; detail: string; answer: Answer; answerText?: string };

const answerLook: Record<Answer, { pill: string; text: string }> = {
  yes: { pill: "st-conc", text: "Sim" },
  no: { pill: "st-ag", text: "Não" },
  depends: { pill: "st-alt", text: "Depende" },
};

export function GuardianDataDialog({ open, onClose, student }: GuardianDataDialogProps) {
  if (!open) {
    return null;
  }

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
    <Modal
      title={student ? "O que você vê" : "Quais dados o responsável vê"}
      onClose={onClose}
      footer={
        <button className={secondaryButton} onClick={onClose} type="button">
          Fechar
        </button>
      }
    >
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
    </Modal>
  );
}
