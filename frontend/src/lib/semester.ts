import type { AcademicClass, AcademicContext } from "./types";

/**
 * Calendário letivo: a segunda-feira que abre a semana 1 e quantas semanas cada semestre tem.
 * A API não guarda essas datas, então elas ficam só aqui; a cada semestre novo, acrescente uma linha.
 * 2026/2 segue o Figma aprovado (Painel do aluno: "Semestre 2026/2, semana 13 de 20" na quinta,
 * 29/10/2026): começa na segunda, 03/08/2026, e tem 20 semanas.
 */
export const semesterCalendar: Record<string, { start: string; weeks: number }> = {
  "2026/2": { start: "2026-08-03", weeks: 20 },
};

const DAY = 24 * 60 * 60 * 1000;

/** Número do dia no calendário, sem horário nem fuso: a conta de dias não erra com horário de verão. */
function dayNumber(year: number, monthIndex: number, day: number) {
  return Date.UTC(year, monthIndex, day) / DAY;
}

export type SemesterWeek = {
  /** "2026/2" */
  term: string;
  week: number;
  weeks: number;
  /** Quanto do semestre já foi, contando a semana atual (semana 13 de 20 = 65). */
  percent: number;
  /** "Semestre 2026/2, semana 13 de 20" */
  label: string;
};

/** Turmas da pessoa: as matrículas do aluno e as turmas em que a docente leciona. */
export function personClasses(context?: AcademicContext | null): AcademicClass[] {
  if (!context) {
    return [];
  }
  const catalog = new Map(context.catalog.classes.map((item) => [item.id, item]));
  return [
    ...context.enrollments.map((item) => item.academicClass ?? catalog.get(item.academicClassId)),
    ...context.teachingAssignments.map((item) => item.academicClass ?? catalog.get(item.academicClassId)),
  ].filter((item): item is AcademicClass => Boolean(item));
}

/**
 * Semana do semestre no dia `today` (data local). Ano e semestre vêm das turmas da pessoa; sem
 * turma (administração), vale o semestre do calendário em que o dia cai. Fora do semestre, ou com
 * turmas de um semestre que o calendário não tem, devolve null: a barra não aparece.
 */
export function semesterWeek(
  today: Date,
  classes: Array<Pick<AcademicClass, "year" | "semester">> = []
): SemesterWeek | null {
  // a turma anual (curso integrado, semester 0) não define semestre: quem só tem turma anual usa o semestre do
  // calendário em que o dia cai, como a administração
  const semestral = classes.filter((item) => Boolean(item.semester));
  const terms = semestral.length
    ? [...new Set(semestral.map((item) => `${item.year}/${item.semester}`))]
    : Object.keys(semesterCalendar);
  const todayNumber = dayNumber(today.getFullYear(), today.getMonth(), today.getDate());
  for (const term of terms) {
    const entry = semesterCalendar[term];
    if (!entry) {
      continue;
    }
    const [year, month, day] = entry.start.split("-").map(Number);
    const days = todayNumber - dayNumber(year, month - 1, day);
    const week = Math.floor(days / 7) + 1;
    if (days >= 0 && week <= entry.weeks) {
      return {
        term,
        week,
        weeks: entry.weeks,
        percent: (week / entry.weeks) * 100,
        label: `Semestre ${term}, semana ${week} de ${entry.weeks}`,
      };
    }
  }
  return null;
}
