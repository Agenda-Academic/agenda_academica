import { Check, Clock, Pencil, X, type LucideIcon } from "lucide-react";
import type {
  AcademicEvent,
  Category,
  ClassShift,
  CourseModality,
  EnrollmentSource,
  EnrollmentStatus,
  EventSource,
  GradeImportRowKind,
  GradeImportSource,
  GradeStatus,
  GuardianLinkOrigin,
  GuardianLinkStatus,
  GuardianRelationship,
  NotificationKind,
  TeachingRole,
  UserRole,
} from "./types";

export type CategoryMeta = {
  label: string;
  short: string;
  accent: string;
  pill: string;
  tint: string;
  rail: string;
  chip: string;
};

export const categoryMeta: Record<Category, CategoryMeta> = {
  exam: {
    label: "Provas",
    short: "Prova",
    accent: "d-prova",
    pill: "border-transparent c-prova",
    tint: "c-prova",
    rail: "border-l-[#E11D48]",
    chip: "c-prova hover:brightness-95",
  },
  assignment: {
    label: "Trabalhos",
    short: "Trabalho",
    accent: "d-trab",
    pill: "border-transparent c-trab",
    tint: "c-trab",
    rail: "border-l-[#7C3AED]",
    chip: "c-trab hover:brightness-95",
  },
  activity: {
    label: "Atividades",
    short: "Atividade",
    accent: "d-ativ",
    pill: "border-transparent c-ativ",
    tint: "c-ativ",
    rail: "border-l-[#0284C7]",
    chip: "c-ativ hover:brightness-95",
  },
  extracurricular: {
    label: "Extracurriculares",
    short: "Extracurricular",
    accent: "d-extra",
    pill: "border-transparent c-extra",
    tint: "c-extra",
    rail: "border-l-[#D97706]",
    chip: "c-extra hover:brightness-95",
  },
  institutional: {
    label: "Institucionais",
    short: "Institucional",
    accent: "d-inst",
    pill: "border-transparent c-inst",
    tint: "c-inst",
    rail: "border-l-[#2563EB]",
    chip: "c-inst hover:brightness-95",
  },
  holiday: {
    label: "Feriados",
    short: "Feriado",
    accent: "d-fer",
    pill: "border-transparent c-fer",
    tint: "c-fer",
    rail: "border-l-[#059669]",
    chip: "c-fer hover:brightness-95",
  },
  recess: {
    label: "Recessos",
    short: "Recesso",
    accent: "d-rec",
    pill: "border-transparent c-rec",
    tint: "c-rec",
    rail: "border-l-[#65A30D]",
    chip: "c-rec hover:brightness-95",
  },
};

export const allCategories = Object.keys(categoryMeta) as Category[];

/** Categorias que apenas administradores podem usar ao criar eventos. */
export const adminOnlyCategories: Category[] = ["institutional", "holiday", "recess"];

/** A pílula "Oficial" só aparece quando a categoria ainda não diz que é data oficial. */
export function showsOfficialPill(event: AcademicEvent) {
  const official = event.officialPriority || event.source !== "teacher";
  return official && !adminOnlyCategories.includes(event.category);
}

/** Mesmos nomes de perfil no login, no menu e nas preferências. */
export const roleLabels: Record<UserRole, string> = {
  student: "Aluno",
  teacher: "Docente",
  admin: "Administração",
  guardian: "Responsável",
};

/** Papéis que o front conhece (sessão guardada com outro papel é descartada). */
export const knownRoles = Object.keys(roleLabels) as UserRole[];

// quem publica evento oficial é a administração (glossário); o importado vem do calendário oficial
export const sourceLabels: Record<EventSource, string> = {
  teacher: "Publicado por docente",
  official: "Publicado pela administração",
  imported: "Importado do calendário oficial",
};

/** "Publicado por Profa. Maraísa" ou "Publicado pela administração, para todas as turmas". */
export function sourceText(event: AcademicEvent) {
  if (event.source === "teacher") {
    return event.teacher?.fullName ? `Publicado por ${event.teacher.fullName}` : sourceLabels.teacher;
  }
  const scope = event.academicClass?.name ? `para ${event.academicClass.name}` : "para todas as turmas";
  return `${sourceLabels[event.source]}, ${scope}`;
}

export type EventStatus = "scheduled" | "changed" | "cancelled" | "completed";

/** Situação em pílula de contorno (.pill.stat), com ícone, para não se confundir com a cor da categoria. */
export const statusMeta: Record<EventStatus, { label: string; pill: string; icon: LucideIcon }> = {
  scheduled: { label: "Agendado", pill: "stat", icon: Clock },
  changed: { label: "Alterado", pill: "stat stat-alt", icon: Pencil },
  cancelled: { label: "Cancelado", pill: "stat stat-canc", icon: X },
  completed: { label: "Concluído", pill: "stat stat-conc", icon: Check },
};

export const reminderOptions = [
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "180", label: "3 horas antes" },
  { value: "360", label: "6 horas antes" },
  { value: "720", label: "12 horas antes" },
  { value: "1440", label: "1 dia antes" },
  { value: "2880", label: "2 dias antes" },
  { value: "4320", label: "3 dias antes" },
  { value: "10080", label: "7 dias antes" },
];

/** Antecedência curta, igual em todos os chips: "30 min", "1 hora", "2 dias". */
export function reminderShortLabel(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} dia${days > 1 ? "s" : ""}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hora${hours > 1 ? "s" : ""}`;
  }
  return `${minutes} min`;
}

/** Atalhos de antecedência no detalhe do evento (mesmos do Figma), em ordem crescente. */
export const reminderChips = [15, 60, 180, 1440, 2880, 10080].map((minutes) => ({
  value: String(minutes),
  label: reminderShortLabel(minutes),
}));

export function reminderOffsetLabel(minutes: number) {
  const match = reminderOptions.find((option) => Number(option.value) === minutes);
  if (match) {
    return match.label;
  }
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} dia${days > 1 ? "s" : ""} antes`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hora${hours > 1 ? "s" : ""} antes`;
  }
  return `${minutes} minutos antes`;
}

export const demoAccounts = [
  {
    label: roleLabels.student,
    description: "Visualiza eventos e configura lembretes",
    email: "diogo@agenda.test",
    password: "password123",
  },
  {
    label: roleLabels.teacher,
    description: "Cria e gerencia eventos das suas turmas",
    email: "maraisa@agenda.test",
    password: "password123",
  },
  {
    label: roleLabels.admin,
    description: "Importa o calendário oficial da reitoria",
    email: "admin@agenda.test",
    password: "password123",
  },
  {
    label: roleLabels.guardian,
    description: "Acompanha a agenda e as notas de um aluno",
    email: "maria@agenda.test",
    password: "password123",
  },
];

/* ------------------------------------------------------------------ */
/* Turmas, matrículas e ofertas                                        */
/* ------------------------------------------------------------------ */

/** Modalidade do curso. O integrado tem turma anual (sem semestre). */
export const modalityLabels: Record<CourseModality, string> = {
  superior: "Superior",
  integrado: "Integrado",
};

/** Turno, como aparece na tela. */
export const shiftLabels: Record<ClassShift, string> = {
  matutino: "Matutino",
  vespertino: "Vespertino",
  noturno: "Noturno",
  integral: "Integral",
};

export const shiftOptions = (Object.keys(shiftLabels) as ClassShift[]).map((value) => ({ value, label: shiftLabels[value] }));

/** Situação da matrícula na turma. */
export const enrollmentStatusLabels: Record<EnrollmentStatus, string> = {
  pending: "Pedido pendente",
  active: "Ativa",
  inactive: "Inativa",
  completed: "Concluída",
};

/** Como o aluno entrou na turma. */
export const enrollmentSourceLabels: Record<EnrollmentSource, string> = {
  admin: "Incluído pela secretaria",
  list: "Lista de e-mails",
  code: "Código da turma",
  invite: "Convite da turma",
};

/** Tipo do vínculo da docente com a oferta. */
export const teachingRoleLabels: Record<TeachingRole, string> = {
  titular: "Titular",
  substituto: "Substituto",
};

/* ------------------------------------------------------------------ */
/* Responsável                                                         */
/* ------------------------------------------------------------------ */

/** Parentesco (valores da API para o texto). */
export const relationshipLabels: Record<GuardianRelationship, string> = {
  mae: "Mãe",
  pai: "Pai",
  responsavel_legal: "Responsável legal",
  outro: "Outro",
};

/** Opções do select de parentesco, na ordem da tela. */
export const relationshipOptions = (Object.keys(relationshipLabels) as GuardianRelationship[]).map((value) => ({
  value,
  label: relationshipLabels[value],
}));

/** Situação do vínculo do responsável. */
export const linkStatusLabels: Record<GuardianLinkStatus, string> = {
  pending: "Aguardando a secretaria",
  active: "Ativo",
  revoked: "Desfeito",
  blocked: "Bloqueado",
};

/** De onde veio o vínculo. */
export const linkOriginLabels: Record<GuardianLinkOrigin, string> = {
  student_code: "Código do aluno",
  admin_code: "Código da secretaria",
  admin: "Vinculado pela secretaria",
};

/** Tipo do aviso do sistema (para um rótulo curto ou um ícone). */
export const notificationKindLabels: Record<NotificationKind, string> = {
  guardian_linked: "Novo responsável",
  guardian_unlinked: "Vínculo desfeito",
  guardian_pending: "Vínculo aguardando a secretaria",
  guardian_review: "Confira quem acompanha sua agenda",
  grades_published: "Nota publicada",
};

/* ------------------------------------------------------------------ */
/* Notas                                                               */
/* ------------------------------------------------------------------ */

/** Situação da nota. */
export const gradeStatusLabels: Record<GradeStatus, string> = {
  graded: "Com nota",
  absent: "Falta",
  excused: "Dispensa",
};

/** Origem do arquivo de notas ("Fonte: SUAP, importada em 04/11/2026"). */
export const gradeImportSourceLabels: Record<GradeImportSource, string> = {
  modelo: "Modelo da Agenda",
  suap: "SUAP",
  moodle: "Moodle",
  classroom: "Google Classroom",
};

/** Classificação de cada linha da prévia da importação. */
export const gradeImportKindLabels: Record<GradeImportRowKind, string> = {
  new: "Nova",
  changed: "Alterada",
  same: "Igual",
  no_match: "Sem aluno",
  not_enrolled: "Fora da turma",
  invalid: "Nota inválida",
  duplicate: "Repetida",
  newer_in_agenda: "Mudou na Agenda",
};

/** Categorias que recebem nota (prova e trabalho de turma). */
export const gradableCategories: Category[] = ["exam", "assignment"];

/** O evento recebe nota? Só prova e trabalho de turma. */
export function isGradable(event: Pick<AcademicEvent, "category" | "academicClassId">) {
  return gradableCategories.includes(event.category) && event.academicClassId !== null;
}
