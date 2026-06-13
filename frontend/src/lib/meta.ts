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
    accent: "bg-rose-500",
    pill: "border-rose-200 bg-rose-50 text-rose-700",
    tint: "bg-rose-50 text-rose-700",
    rail: "border-l-rose-500",
    chip: "bg-rose-100 text-rose-800 hover:bg-rose-200",
  },
  assignment: {
    label: "Trabalhos",
    short: "Trabalho",
    accent: "bg-indigo-500",
    pill: "border-indigo-200 bg-indigo-50 text-indigo-700",
    tint: "bg-indigo-50 text-indigo-700",
    rail: "border-l-indigo-500",
    chip: "bg-indigo-100 text-indigo-800 hover:bg-indigo-200",
  },
  activity: {
    label: "Atividades",
    short: "Atividade",
    accent: "bg-sky-500",
    pill: "border-sky-200 bg-sky-50 text-sky-700",
    tint: "bg-sky-50 text-sky-700",
    rail: "border-l-sky-500",
    chip: "bg-sky-100 text-sky-800 hover:bg-sky-200",
  },
  extracurricular: {
    label: "Extracurriculares",
    short: "Extra",
    accent: "bg-amber-500",
    pill: "border-amber-200 bg-amber-50 text-amber-800",
    tint: "bg-amber-50 text-amber-800",
    rail: "border-l-amber-500",
    chip: "bg-amber-100 text-amber-800 hover:bg-amber-200",
  },
  institutional: {
    label: "Institucionais",
    short: "Institucional",
    accent: "bg-blue-500",
    pill: "border-blue-200 bg-blue-50 text-blue-700",
    tint: "bg-blue-50 text-blue-700",
    rail: "border-l-blue-500",
    chip: "bg-blue-100 text-blue-800 hover:bg-blue-200",
  },
  holiday: {
    label: "Feriados",
    short: "Feriado",
    accent: "bg-emerald-500",
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
    tint: "bg-emerald-50 text-emerald-700",
    rail: "border-l-emerald-500",
    chip: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
  },
  recess: {
    label: "Recessos",
    short: "Recesso",
    accent: "bg-lime-500",
    pill: "border-lime-200 bg-lime-50 text-lime-800",
    tint: "bg-lime-50 text-lime-800",
    rail: "border-l-lime-500",
    chip: "bg-lime-100 text-lime-800 hover:bg-lime-200",
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
  scheduled: { label: "Agendado", pill: "border-slate-200 bg-slate-50 text-slate-600" },
  changed: { label: "Alterado", pill: "border-amber-200 bg-amber-50 text-amber-800" },
  cancelled: { label: "Cancelado", pill: "border-rose-200 bg-rose-50 text-rose-700" },
  completed: { label: "Concluído", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};

export const reminderOptions = [
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "180", label: "3 horas antes" },
  { value: "360", label: "6 horas antes" },
  { value: "720", label: "12 horas antes" },
  { value: "1440", label: "1 dia antes" },
  { value: "2880", label: "2 dias antes" },
  { value: "4320", label: "3 dias antes" },
  { value: "10080", label: "1 semana antes" },
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
