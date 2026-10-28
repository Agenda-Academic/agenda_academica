import type { Category, EventSource, UserRole } from "./types";

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
    short: "Extra",
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

export const roleLabels: Record<UserRole, string> = {
  student: "Aluno",
  teacher: "Professor",
  admin: "Administração",
};

export const sourceLabels: Record<EventSource, string> = {
  teacher: "Evento docente",
  official: "Evento oficial",
  imported: "Calendário oficial",
};

export type EventStatus = "scheduled" | "changed" | "cancelled" | "completed";

export const statusMeta: Record<EventStatus, { label: string; pill: string }> = {
  scheduled: { label: "Agendado", pill: "border-transparent st-ag" },
  changed: { label: "Alterado", pill: "border-transparent st-alt" },
  cancelled: { label: "Cancelado", pill: "border-transparent st-canc" },
  completed: { label: "Concluído", pill: "border-transparent st-conc" },
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

/** Atalhos de antecedência no detalhe do evento (mesmos do Figma). */
export const reminderChips = [
  { value: "15", label: "15 min" },
  { value: "60", label: "1 hora" },
  { value: "180", label: "3 horas" },
  { value: "1440", label: "1 dia" },
  { value: "2880", label: "2 dias" },
  { value: "10080", label: "7 dias" },
];

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
    label: "Aluno",
    description: "Visualiza eventos e configura lembretes",
    email: "diogo@agenda.test",
    password: "password123",
  },
  {
    label: "Professor",
    description: "Cria e gerencia eventos das suas turmas",
    email: "apio@agenda.test",
    password: "password123",
  },
  {
    label: "Admin",
    description: "Importa o calendário oficial da reitoria",
    email: "admin@agenda.test",
    password: "password123",
  },
];
