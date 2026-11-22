"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ApiError,
  archiveClass,
  cancelClassInvite,
  addClassStudentsByEmail,
  conflictOf,
  createClass,
  createCourse,
  createJoinCode,
  decideEnrollments,
  deleteClass,
  disableJoinCode,
  getClass,
  getClassInvites,
  getCourses,
  getClassStudents,
  restoreClass,
  restoreCourse,
  archiveCourse,
  updateClass,
  updateCourse,
  updateEnrollment,
  type ClassInput,
} from "@/lib/api";
import {
  classTermLabel,
  cx,
  errorMessage,
  fieldErrors,
  firstName,
  formatOnDayAt,
  isIntegratedCourse,
  normalizeCode,
  normalizeText,
} from "@/lib/format";
import { shiftLabels, shiftOptions, teachingRoleLabels } from "@/lib/meta";
import type { ClassDetail, ClassInvite, ClassStudent, ClassSummary, Course, CourseModality } from "@/lib/types";
import { useAppActions, type AppActions } from "./app-actions";
import type { ClassesData } from "./classes-view";
import { Pager, usePaged, type Paged } from "./pager";
import {
  CopyButton,
  PanelFooter,
  SkeletonRows,
  forgetRemote,
  initialsOf,
  joinPt,
  minorWarning,
  plural,
  readLastClass,
  suggestCourseCode,
  undoEnrollments,
  useRemote,
  writeLastClass,
  type ClassDraft,
  type ClassStep,
  type CourseDraft,
  type EnrollmentUndo,
  type PanelApi,
  type PanelView,
} from "./classes-shared";
import { Select } from "./select";
import { EmptyState, ErrorState, Field, primaryButton, secondaryButton } from "./ui";

/* ------------------------------------------------------------------ */
/* Formulário da turma (criar e editar)                                */
/* ------------------------------------------------------------------ */

type ClassErrors = Partial<Record<keyof ClassDraft | "form", string>>;

/** Alunos por página no painel da turma (rodada de UX de 2026-11-17: nada de "Ver todos" que despeja a turma). */
const STUDENT_PAGE = 8;
const INVITE_LIMIT = 5;

/**
 * Trocar de página numa lista do painel lateral: o rótulo da lista (ou o título Alunos) volta para a vista dentro do
 * corpo do painel, que rola sozinho. O Pager já leva o foco para ele, mas só rola a janela quando o rótulo sai pelo
 * alto da tela; aqui ele também volta quando ficou escondido em cima do corpo do painel ou embaixo dele.
 */
function useRevealOnPage<T>(paged: Paged<T>, target: RefObject<HTMLElement | null>): Paged<T> {
  const asked = useRef(false);
  const { page } = paged;
  useEffect(() => {
    if (!asked.current) return;
    asked.current = false;
    const element = target.current;
    if (!element) return;
    let box = element.parentElement;
    while (box && !/(auto|scroll)/.test(window.getComputedStyle(box).overflowY)) {
      box = box.parentElement;
    }
    const area = box?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const top = element.getBoundingClientRect().top;
    if (top < area.top || top > area.bottom - 96) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }
  }, [page, target]);
  return {
    ...paged,
    setPage: (value: number) => {
      asked.current = true;
      paged.setPage(value);
    },
  };
}

/** Restaurar a turma (e o Desfazer do arquivar) deixa o código desligado, por regra da API. */
const CODE_OFF_TEXT = "O código da turma ficou desligado. Gere um novo para voltar a aceitar pedidos.";

/** A API respondeu 404: a turma não existe (ou saiu). */
function isNotFound(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

/**
 * "Gerar código" do aviso de turma restaurada: restaurar deixa o código desligado (regra da API), e o aviso já
 * oferece ligar de novo. O painel da turma tem o mesmo botão em Código da turma.
 */
function generateCodeAction(actions: Pick<AppActions, "token" | "toast" | "showError">, api: PanelApi, classId: number) {
  return {
    label: "Gerar código",
    onClick: () => {
      void (async () => {
        try {
          await createJoinCode(actions.token, classId);
          api.changed();
          actions.toast("Código da turma ligado. Mostre o código no painel da turma para passar aos alunos.", {
            key: `codigo-${classId}`,
          });
        } catch (error) {
          actions.showError(error, `codigo-${classId}`);
        }
      })();
    },
  };
}

/**
 * Leva o foco para `target` assim que der, depois de uma ação que tira da tela o botão que tinha o foco (o pedido
 * aprovado sai da lista, o Desligar vira Gerar código). Espera a confirmação aberta fechar e só mexe se o foco se
 * perdeu (no body ou no próprio painel) ou ainda está em `from`, o botão da ação. Para se a pessoa usar o teclado
 * ou o mouse antes.
 */
function focusSoon(target: HTMLElement, from: Element | null, limit = 120) {
  const attempt = () => {
    if (!target.isConnected) {
      return true;
    }
    if (document.querySelector('[role="alertdialog"]')) {
      return false;
    }
    const active = document.activeElement;
    if (active === target) {
      return true;
    }
    const lost =
      !active || active === document.body || active === from || (active instanceof HTMLElement && active.matches(".drawer, .modal-box"));
    if (!lost) {
      return true;
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest" });
    return document.activeElement === target;
  };
  if (attempt()) {
    return;
  }
  let frame = 0;
  let tries = 0;
  const stop = () => {
    window.cancelAnimationFrame(frame);
    document.removeEventListener("keydown", stop, true);
    document.removeEventListener("pointerdown", stop, true);
  };
  document.addEventListener("keydown", stop, true);
  document.addEventListener("pointerdown", stop, true);
  const run = () => {
    tries += 1;
    if (attempt() || tries >= limit) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(run);
  };
  frame = window.requestAnimationFrame(run);
}

export type PanelProps<V extends PanelView["kind"]> = {
  api: PanelApi;
  data: ClassesData | null;
  /** Onde o subtítulo do painel entra (curso e pílulas da turma). */
  subtitle: HTMLElement | null;
  view: Extract<PanelView, { kind: V }>;
};

/** Subtítulo do painel (fica no cabeçalho fixo do Drawer). */
export function PanelSubtitle({ node, children }: { node: HTMLElement | null; children: ReactNode }) {
  return node ? createPortal(children, node) : null;
}

function draftFromClass(item: ClassDetail): ClassDraft {
  return {
    courseId: String(item.courseId),
    name: item.name,
    year: String(item.year),
    semester: item.semester ? String(item.semester) : "",
    shift: item.shift ?? "",
    period: item.period ?? "",
  };
}

function sameDraft(a: ClassDraft, b: ClassDraft) {
  return (Object.keys(a) as Array<keyof ClassDraft>).every((key) => a[key].trim() === b[key].trim());
}

/** Cursos do formulário: os ativos, o da turma (mesmo arquivado) e os criados agora (antes de a lista recarregar). */
function mergeCourses(...lists: Array<Array<Course | null | undefined> | undefined>) {
  const byId = new Map<number, Course>();
  for (const list of lists) {
    for (const course of list ?? []) {
      if (course && !byId.has(course.id)) {
        byId.set(course.id, course);
      }
    }
  }
  return Array.from(byId.values());
}

function courseOf(courses: Course[], id: string, extra?: Course | null) {
  return courses.find((course) => String(course.id) === id) ?? (extra && String(extra.id) === id ? extra : null);
}

/** Erros do formulário da turma, com o que fazer. Só os campos pedidos (sair do campo) ou todos (salvar). */
function validateClass(draft: ClassDraft, integrated: boolean): ClassErrors {
  const errors: ClassErrors = {};
  const name = draft.name.trim();
  if (!draft.courseId) {
    errors.courseId = "Escolha o curso da turma.";
  }
  if (name.length < 2) {
    errors.name = "Escreva o nome da turma, com pelo menos 2 caracteres. Ex.: TADS 5.";
  } else if (name.length > 60) {
    errors.name = "Use até 60 caracteres no nome da turma.";
  }
  const year = Number(draft.year);
  if (!/^\d{4}$/.test(draft.year.trim()) || year < 2000 || year > 2100) {
    errors.year = "Digite o ano com 4 números, entre 2000 e 2100. Ex.: 2026.";
  }
  if (!integrated && !draft.semester) {
    errors.semester = "Escolha o semestre da turma: 1º ou 2º.";
  }
  if (!draft.shift) {
    errors.shift = "Escolha o turno da turma.";
  }
  const period = draft.period.trim();
  if (!period) {
    errors.period = integrated ? "Escreva o ano do curso. Ex.: 3º ano." : "Escreva o período do curso. Ex.: 5º período.";
  } else if (period.length > 40) {
    errors.period = "Use até 40 caracteres no período.";
  }
  return errors;
}

function toInput(draft: ClassDraft, integrated: boolean): ClassInput {
  const input: ClassInput = {
    courseId: Number(draft.courseId),
    name: draft.name.trim(),
    year: Number(draft.year),
    shift: draft.shift as ClassInput["shift"],
    period: draft.period.trim(),
  };
  if (!integrated) {
    input.semester = Number(draft.semester);
  }
  return input;
}

/** Erros da API no formulário: 422 abaixo de cada campo; 409 ARCHIVED_DUPLICATE no nome, com "Restaurar turma". */
function apiClassErrors(error: unknown, integrated: boolean): { errors: ClassErrors; archivedId: number | null } {
  const duplicate = conflictOf(error, "ARCHIVED_DUPLICATE");
  if (duplicate) {
    return { errors: { name: duplicate.message }, archivedId: duplicate.archivedId ?? null };
  }
  const byField = fieldErrors(error) as ClassErrors;
  if (Object.keys(byField).length) {
    // com o semestre escondido (curso integrado), o erro dele vai para o topo do formulário
    if (byField.semester && integrated) {
      byField.form = byField.semester;
      delete byField.semester;
    }
    return { errors: byField, archivedId: null };
  }
  return { errors: { form: errorMessage(error) }, archivedId: null };
}

/* ------------------------------------------------------------------ */
/* Peças do formulário da turma: curso, ano, semestre, período, turno  */
/* ------------------------------------------------------------------ */

/** Até este número de cursos, eles aparecem como cartões; acima, num Select com busca. */
const COURSE_CARDS_MAX = 6;

/** "Superior, por semestre" ou "Integrado, por ano": como as turmas do curso se organizam. */
function courseRhythm(course: Pick<Course, "modality"> | null | undefined) {
  return isIntegratedCourse(course) ? "Integrado, por ano" : "Superior, por semestre";
}

/** Períodos do curso em botões: 1º a 8º período (superior) ou 1º a 4º ano (integrado). */
function periodChoices(integrated: boolean) {
  return Array.from({ length: integrated ? 4 : 8 }, (_, index) => {
    const n = index + 1;
    return { n, value: integrated ? `${n}º ano` : `${n}º período` };
  });
}

/** O período escrito é um dos botões? ("5º período", "5º Período" e "5o periodo" valem como o 5º.) */
function periodChoiceOf(period: string, integrated: boolean) {
  const clean = normalizeText(period).replace(/\s+/g, " ").trim();
  return periodChoices(integrated).find((choice) => normalizeText(choice.value) === clean) ?? null;
}

/** "2026/2, 5º período, noturno" (a segunda linha da turma na lista). */
function classLine(draft: ClassDraft, integrated: boolean) {
  const term = integrated ? draft.year : draft.semester ? `${draft.year}/${draft.semester}` : draft.year;
  const shift = draft.shift ? shiftLabels[draft.shift as keyof typeof shiftLabels]?.toLowerCase() : "";
  return [term, draft.period.trim(), shift].filter(Boolean).join(", ");
}

/** Rótulo, conteúdo e erro de um bloco que não é um campo só (grupo de botões, ano com setas). */
function Block({
  children,
  error,
  hint,
  id,
  label,
}: {
  children: ReactNode;
  error?: string;
  hint?: string;
  id: string;
  label: string;
}) {
  return (
    <div className="admin-block">
      <span className="lbl" id={`${id}-l`}>
        <span>{label}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </span>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-e`}>
          <CircleAlert aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Cursos em cartões de escolha (até 6) ou num Select com busca, e "Cadastrar outro curso" por último. */
function CourseChoice({
  classes,
  courses,
  disabled,
  error,
  id,
  value,
  onChange,
  onNewCourse,
}: {
  /** Turmas ativas, para contar quantas cada curso tem. */
  classes: ClassSummary[];
  courses: Course[];
  disabled?: boolean;
  error?: string;
  id: string;
  value: string;
  onChange: (courseId: string) => void;
  onNewCourse?: () => void;
}) {
  const count = (course: Course) => classes.filter((item) => item.courseId === course.id).length;
  const meta = (course: Course) => {
    const total = count(course);
    return `${courseRhythm(course)}, ${total ? plural(total, "turma ativa", "turmas ativas") : "nenhuma turma ativa"}`;
  };
  const newButton = onNewCourse ? (
    <button className="admin-course-new" disabled={disabled} onClick={onNewCourse} type="button">
      <Plus className="h-4 w-4" aria-hidden />
      Cadastrar outro curso
    </button>
  ) : null;

  if (courses.length > COURSE_CARDS_MAX) {
    return (
      <div className="admin-block">
        <Select
          label="Curso"
          disabled={disabled}
          error={error}
          searchable
          searchPlaceholder="Buscar curso"
          placeholder="Escolha o curso"
          value={value}
          onChange={(next) => onChange(next)}
          options={courses.map((course) => ({
            value: String(course.id),
            label: course.name,
            description: `${course.code}, ${meta(course)}`,
            keywords: course.code,
          }))}
        />
        {newButton}
      </div>
    );
  }

  return (
    <div className="admin-block">
      <div
        className="admin-courses"
        role="radiogroup"
        aria-label="Curso"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined}
      >
        {courses.map((course) => {
          const on = String(course.id) === value;
          return (
            <label key={course.id} className={cx("admin-course", on && "on")}>
              <input
                className="sr-only"
                type="radio"
                name={`${id}-curso`}
                disabled={disabled}
                checked={on}
                onChange={() => onChange(String(course.id))}
              />
              <span className="admin-radio" aria-hidden />
              <span className="admin-course-main">
                <b>{course.name}</b>
                <span>
                  <span className="admin-code">{course.code}</span>
                  {meta(course)}
                </span>
              </span>
            </label>
          );
        })}
        {!courses.length ? <p className="admin-course-none">Nenhum curso cadastrado ainda.</p> : null}
      </div>
      {newButton}
      {error ? (
        <p className="field-error" id={`${id}-e`}>
          <CircleAlert aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Ano com as setas ‹ 2026 ›; dá para digitar o ano no meio. */
function YearField({
  disabled,
  error,
  id,
  value,
  onBlur,
  onChange,
}: {
  disabled?: boolean;
  error?: string;
  id: string;
  value: string;
  onBlur?: () => void;
  onChange: (year: string) => void;
}) {
  const base = /^\d{4}$/.test(value) ? Number(value) : new Date().getFullYear();
  return (
    <Block id={id} label="Ano" error={error}>
      <div className={cx("admin-year", error && "is-invalid")} role="group" aria-labelledby={`${id}-l`}>
        <button
          aria-label="Ano anterior"
          disabled={disabled || base <= 2000}
          onClick={() => onChange(String(base - 1))}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <input
          aria-labelledby={`${id}-l`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : undefined}
          disabled={disabled}
          inputMode="numeric"
          maxLength={4}
          value={value}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        />
        <button
          aria-label="Próximo ano"
          disabled={disabled || base >= 2100}
          onClick={() => onChange(String(base + 1))}
          type="button"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </Block>
  );
}

/** Escolha em botões (semestre, período do curso): rádios de verdade, com setas, no visual de segmentos ou chips. */
function ChoiceRow({
  disabled,
  error,
  id,
  look,
  options,
  value,
  onChange,
}: {
  disabled?: boolean;
  error?: string;
  id: string;
  look: "seg" | "chips";
  options: Array<{ value: string; label: string; aria?: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={look === "seg" ? "admin-segs" : "admin-chips"}
      role="radiogroup"
      aria-labelledby={`${id}-l`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-e` : undefined}
    >
      {options.map((option) => (
        <label key={option.value} className={cx(value === option.value && "on")}>
          <input
            className="sr-only"
            type="radio"
            name={`${id}-r`}
            disabled={disabled}
            checked={value === option.value}
            aria-label={option.aria}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** Período do curso: chips de 1º a 8º (ou 1º a 4º ano) e "Outro", que abre um campo de texto. */
function PeriodField({
  disabled,
  error,
  id,
  integrated,
  other,
  value,
  onBlur,
  onChange,
}: {
  disabled?: boolean;
  error?: string;
  id: string;
  integrated: boolean;
  /** "Outro" escolhido (o campo de texto aparece). */
  other: boolean;
  value: string;
  onBlur?: () => void;
  onChange: (period: string, other: boolean) => void;
}) {
  const choice = periodChoiceOf(value, integrated);
  const showOther = other || (!choice && Boolean(value.trim()));
  const otherRef = useRef<HTMLInputElement>(null);
  const options = [
    ...periodChoices(integrated).map((item) => ({
      value: item.value,
      label: `${item.n}º`,
      aria: item.value,
    })),
    { value: "__outro", label: "Outro", aria: integrated ? "Outro ano do curso" : "Outro período" },
  ];
  return (
    <Block id={id} label={integrated ? "Ano do curso" : "Período do curso"} error={error}>
      <ChoiceRow
        disabled={disabled}
        error={showOther ? undefined : error}
        id={id}
        look="chips"
        options={options}
        value={showOther ? "__outro" : (choice?.value ?? "")}
        onChange={(next) => {
          if (next === "__outro") {
            onChange(choice ? "" : value, true);
            window.requestAnimationFrame(() => otherRef.current?.focus());
            return;
          }
          onChange(next, false);
        }}
      />
      {showOther ? (
        <input
          ref={otherRef}
          className="input mt-2.5"
          aria-label={integrated ? "Ano do curso, escrito" : "Período do curso, escrito"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : undefined}
          autoComplete="off"
          disabled={disabled}
          maxLength={40}
          placeholder={integrated ? "Ex.: 3º ano" : "Ex.: Módulo 2"}
          value={value}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value, true)}
        />
      ) : null}
    </Block>
  );
}

/** Turno: o Select próprio, com aviso quando outra turma do mesmo curso, período e semestre já usa o turno. */
function ShiftField({
  busyNames,
  buttonRef,
  disabled,
  error,
  value,
  onChange,
}: {
  /** Turno: nomes das turmas que já usam (ex.: { noturno: ["TADS 5"] }). */
  busyNames?: Partial<Record<string, string[]>>;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
  error?: string;
  value: string;
  onChange: (shift: string) => void;
}) {
  return (
    <Select
      label="Turno"
      buttonRef={buttonRef}
      disabled={disabled}
      error={error}
      placeholder="Escolha o turno"
      value={value}
      onChange={(next) => onChange(next)}
      options={shiftOptions.map((option) => {
        const names = busyNames?.[option.value] ?? [];
        return {
          value: option.value,
          label: option.label,
          description: option.value === "integral" ? "manhã e tarde" : undefined,
          badge: names.length ? (
            <span className="stat amber">
              <TriangleAlert className="h-3 w-3" aria-hidden />
              {joinPt(names)} já usa este turno
            </span>
          ) : undefined,
        };
      })}
    />
  );
}

/**
 * Formulário dos dados da turma ("Editar dados" no painel da turma): as mesmas peças do cadastro em passos, sem os
 * passos. Nenhum select nativo.
 */
function ClassFields({
  classes,
  courses,
  disabled,
  draft,
  errors,
  extraCourse,
  periodOther,
  restoreLabel,
  onChange,
  onBlurField,
  onPeriodOther,
  onRestore,
}: {
  classes: ClassSummary[];
  courses: Course[];
  disabled?: boolean;
  draft: ClassDraft;
  errors: ClassErrors;
  /** Curso da turma que não está na lista (arquivado). */
  extraCourse?: Course | null;
  periodOther: boolean;
  restoreLabel?: string | null;
  onChange: (draft: ClassDraft) => void;
  onBlurField: (field: keyof ClassDraft) => void;
  onPeriodOther: (other: boolean) => void;
  /** 409 ARCHIVED_DUPLICATE: o botão abaixo do nome. */
  onRestore?: () => void;
}) {
  const id = useId().replace(/:/g, "");
  const course = courseOf(courses, draft.courseId, extraCourse);
  const integrated = isIntegratedCourse(course);
  const options = [...courses];
  if (extraCourse && !options.some((item) => item.id === extraCourse.id)) {
    options.push(extraCourse);
  }

  function changeCourse(value: string) {
    const next = courseOf(courses, value, extraCourse);
    const nextIntegrated = isIntegratedCourse(next);
    // turma anual: o semestre some; ao sair do integrado, ele volta vazio e obrigatório
    const semester = nextIntegrated || integrated ? "" : draft.semester;
    onChange({ ...draft, courseId: value, semester });
  }

  return (
    <div className="admin-form">
      <Select
        label="Curso"
        disabled={disabled}
        error={errors.courseId}
        searchable={options.length > 6}
        searchPlaceholder="Buscar curso"
        placeholder="Escolha o curso"
        value={draft.courseId}
        onChange={changeCourse}
        options={options.map((item) => ({
          value: String(item.id),
          label: item.name,
          description: `${item.code}, ${courseRhythm(item)}${item.archivedAt ? ", arquivado" : ""}`,
          keywords: item.code,
        }))}
      />
      <div>
        <Field label="Nome da turma" error={errors.name}>
          <input
            className="input"
            autoComplete="off"
            data-class-name=""
            disabled={disabled}
            maxLength={60}
            placeholder={integrated ? "Ex.: INF 3A" : "Ex.: TADS 5"}
            value={draft.name}
            onBlur={() => onBlurField("name")}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </Field>
        {restoreLabel && onRestore ? (
          <button className={cx(secondaryButton, "btn-sm mt-2")} onClick={onRestore} type="button">
            <ArchiveRestore className="h-4 w-4" aria-hidden />
            {restoreLabel}
          </button>
        ) : null}
      </div>
      <div className="admin-row2">
        <YearField
          id={`${id}-ano`}
          disabled={disabled}
          error={errors.year}
          value={draft.year}
          onBlur={() => onBlurField("year")}
          onChange={(year) => onChange({ ...draft, year })}
        />
        {integrated ? (
          <Block id={`${id}-sem`} label="Semestre">
            <p className="admin-annual">Turma anual: aparece só com o ano, {draft.year || "2026"}</p>
          </Block>
        ) : (
          <Block id={`${id}-sem`} label="Semestre" error={errors.semester}>
            <ChoiceRow
              disabled={disabled}
              error={errors.semester}
              id={`${id}-sem`}
              look="seg"
              options={[
                { value: "1", label: "1º semestre" },
                { value: "2", label: "2º semestre" },
              ]}
              value={draft.semester}
              onChange={(semester) => onChange({ ...draft, semester })}
            />
          </Block>
        )}
      </div>
      <PeriodField
        id={`${id}-per`}
        disabled={disabled}
        error={errors.period}
        integrated={integrated}
        other={periodOther}
        value={draft.period}
        onBlur={() => onBlurField("period")}
        onChange={(period, other) => {
          onPeriodOther(other);
          onChange({ ...draft, period });
        }}
      />
      <ShiftField
        busyNames={shiftClash(classes, draft, integrated)}
        disabled={disabled}
        error={errors.shift}
        value={draft.shift}
        onChange={(shift) => onChange({ ...draft, shift })}
      />
    </div>
  );
}

/** Turmas do mesmo curso, semestre e período, por turno (para o aviso "TADS 5 já usa este turno"). */
function shiftClash(classes: ClassSummary[], draft: ClassDraft, integrated: boolean, exceptId?: number) {
  const result: Partial<Record<string, string[]>> = {};
  const period = normalizeText(draft.period).trim();
  if (!draft.courseId || !period) {
    return result;
  }
  for (const item of classes) {
    if (
      item.id === exceptId ||
      String(item.courseId) !== draft.courseId ||
      String(item.year) !== draft.year ||
      (integrated ? Boolean(item.semester) : String(item.semester) !== draft.semester) ||
      normalizeText(item.period ?? "").trim() !== period ||
      !item.shift
    ) {
      continue;
    }
    (result[item.shift] ??= []).push(item.name);
  }
  return result;
}

/** Nomes já usados no curso e no semestre (turmas ativas e arquivadas), em minúsculas e sem acento. */
function takenNames(all: ClassSummary[], draft: ClassDraft, integrated: boolean) {
  const semester = integrated ? 0 : Number(draft.semester) || 0;
  return all.filter(
    (item) =>
      String(item.courseId) === draft.courseId && String(item.year) === draft.year && (item.semester || 0) === semester
  );
}

/**
 * Prefixo do nome das turmas do curso: o que as turmas que ele já tem usam antes do número ("INF" de "INF 3A", mesmo
 * com a sigla "INFO-INT"); sem turma, a sigla do curso.
 */
function classNamePrefix(course: Course | null, all: ClassSummary[]) {
  if (!course) {
    return "";
  }
  return (
    all
      .filter((item) => item.courseId === course.id)
      .map((item) => /^(.*?\D)\s*\d{1,2}[A-Za-z]?$/.exec(item.name.trim())?.[1]?.trim())
      .find(Boolean) ?? course.code
  );
}

/**
 * Nome sugerido: o prefixo das turmas do curso (ou a sigla) e o número do período ("TADS 5"); no integrado, com a
 * letra da turma ("INF 3A"). Se o nome já existe no curso e no semestre, a próxima letra livre ("TADS 5B").
 */
function suggestClassName(course: Course | null, draft: ClassDraft, integrated: boolean, all: ClassSummary[]) {
  const number = /^\s*(\d{1,2})/.exec(draft.period)?.[1];
  if (!course || !number) {
    return "";
  }
  const taken = new Set(takenNames(all, draft, integrated).map((item) => normalizeText(item.name).trim()));
  const base = `${classNamePrefix(course, all)} ${number}`;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  if (!integrated && !taken.has(normalizeText(base))) {
    return base;
  }
  const free = (integrated ? letters : letters.slice(1)).find((letter) => !taken.has(normalizeText(`${base}${letter}`)));
  return free ? `${base}${free}` : base;
}

/** Erros por campo do curso: a API fala em "código" no curso repetido, e o campo na tela é a Sigla. */
function courseFieldErrors(error: unknown) {
  const byField = fieldErrors(error);
  if (byField.code) {
    byField.code = byField.code
      .replace(/um curso com o código (\S+?)\. Escolha outro código\./, "um curso com a sigla $1. Escolha outra sigla.");
  }
  return byField;
}

/** Erros que dependem do curso: somem quando o curso muda (o nome repetido era "em 2026/2" do curso de antes). */
const COURSE_BOUND: Array<keyof ClassErrors> = ["courseId", "semester", "period", "form"];

/**
 * Rascunho, erros e validação ao sair do campo (só dos campos já mexidos).
 *
 * - A mensagem que veio da API (turma repetida, com "Restaurar turma") fica parada até a pessoa mudar o valor do
 *   campo: sair do campo não a troca, e o botão abaixo dela não sai do lugar antes do clique.
 * - O erro de sair do campo entra depois que o foco já chegou ao próximo campo: a mudança na tela não tira o foco
 *   do lugar.
 * - Trocar o curso limpa os erros que dependem dele e, se o período veio do curso anterior (a pessoa não o
 *   editou), limpa o período: "5º período" não serve para turma de curso integrado, nem "3º ano" para as outras.
 *   Na turma nova vale para qualquer troca de curso (`periodFollowsCourse`); na edição, só quando a modalidade muda.
 */
function useClassForm(
  draft: ClassDraft | null,
  courses: Course[],
  extraCourse?: Course | null,
  periodFollowsCourse = false
) {
  const [errors, setErrors] = useState<ClassErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof ClassDraft, boolean>>>({});
  const [fromApiFields, setFromApiFields] = useState<Array<keyof ClassErrors>>([]);
  const [periodEdited, setPeriodEdited] = useState(false);
  const [archivedId, setArchivedId] = useState<number | null>(null);
  const integrated = draft ? isIntegratedCourse(courseOf(courses, draft.courseId, extraCourse)) : false;

  function blur(field: keyof ClassDraft) {
    if (!draft || !touched[field] || fromApiFields.includes(field)) {
      return;
    }
    const found = validateClass(draft, integrated);
    window.setTimeout(() => {
      setErrors((current) => (current[field] === found[field] ? current : { ...current, [field]: found[field] }));
    }, 0);
  }

  /** O rascunho que vale depois da troca de curso: sem o período que veio do curso de antes. */
  function adjust(previous: ClassDraft, next: ClassDraft): ClassDraft {
    if (next.courseId === previous.courseId || periodEdited || !next.period) {
      return next;
    }
    const before = isIntegratedCourse(courseOf(courses, previous.courseId, extraCourse));
    const after = isIntegratedCourse(courseOf(courses, next.courseId, extraCourse));
    return periodFollowsCourse || before !== after ? { ...next, period: "" } : next;
  }

  /** A pessoa mexeu: o campo passa a ser conferido ao sair, e o erro dele some assim que fica certo. */
  function edited(previous: ClassDraft, next: ClassDraft) {
    const courseChanged = next.courseId !== previous.courseId;
    const nextIntegrated = isIntegratedCourse(courseOf(courses, next.courseId, extraCourse));
    const found = validateClass(next, nextIntegrated);
    const marks = { ...touched };
    const cleared = { ...errors };
    let apiKeys = fromApiFields;
    if (courseChanged) {
      for (const key of COURSE_BOUND) {
        delete cleared[key];
      }
      if (apiKeys.includes("name")) {
        delete cleared.name;
      }
      apiKeys = apiKeys.filter((key) => key !== "name" && !COURSE_BOUND.includes(key));
    }
    for (const key of Object.keys(next) as Array<keyof ClassDraft>) {
      if (next[key] === previous[key]) {
        continue;
      }
      // o período limpo pela troca de curso não conta como mexido pela pessoa
      const byPerson = !(key === "period" && courseChanged) && !(key === "semester" && courseChanged);
      if (byPerson) {
        marks[key] = true;
      }
      if (key === "period" && !courseChanged) {
        setPeriodEdited(true);
      }
      if (apiKeys.includes(key)) {
        delete cleared[key];
        apiKeys = apiKeys.filter((item) => item !== key);
      } else if (cleared[key] && !found[key]) {
        delete cleared[key];
      }
    }
    if (next.name !== previous.name || courseChanged) {
      setArchivedId(null);
    }
    setTouched(marks);
    setErrors(cleared);
    setFromApiFields(apiKeys);
  }

  function check(): boolean {
    if (!draft) {
      return false;
    }
    const found = validateClass(draft, integrated);
    setErrors(found);
    setFromApiFields([]);
    setArchivedId(null);
    return Object.keys(found).length === 0;
  }

  function fromApi(error: unknown) {
    const result = apiClassErrors(error, integrated);
    setErrors(result.errors);
    setFromApiFields(Object.keys(result.errors) as Array<keyof ClassErrors>);
    setArchivedId(result.archivedId);
  }

  return { errors, archivedId, integrated, blur, adjust, edited, check, fromApi, setErrors };
}

/** Leva o foco ao primeiro campo com erro (depois de salvar). */
function focusFirstError(root: HTMLElement | null) {
  window.requestAnimationFrame(() => {
    const field = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
    // grupo de botões (curso, semestre, período): o foco vai para o escolhido ou para o primeiro
    const target = field?.matches('[role="radiogroup"]')
      ? field.querySelector<HTMLElement>("input:checked:not(:disabled)") ?? field.querySelector<HTMLElement>("input:not(:disabled)")
      : field;
    target?.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Nova turma: três passos (Curso, Período e turno, Nome) e o resumo    */
/* ------------------------------------------------------------------ */

const STEP_TEXT: Record<ClassStep, { title: string; sub: string; head: string }> = {
  1: { title: "Curso", sub: "De qual curso é a turma", head: "curso" },
  2: { title: "Período e turno", sub: "Quando a turma acontece", head: "período e turno" },
  3: { title: "Nome e conferência", sub: "Confira antes de criar", head: "nome e conferência" },
};

/** Campos de cada passo: "Continuar" confere só os do passo. */
const STEP_FIELDS: Record<ClassStep, Array<keyof ClassDraft>> = {
  1: ["courseId"],
  2: ["year", "semester", "period", "shift"],
  3: ["name"],
};

function stepOfField(field: string): ClassStep {
  return field === "courseId" ? 1 : field === "name" || field === "form" ? 3 : 2;
}

/** Rascunho novo: nada de curso, período ou turno herdados de outra turma; o ano e o semestre de agora (ou os últimos usados). */
function freshClassDraft(courses: Course[]): ClassDraft {
  const last = readLastClass();
  const today = new Date();
  return {
    courseId: courses.length === 1 ? String(courses[0].id) : "",
    name: "",
    year: last?.year && /^\d{4}$/.test(last.year) ? last.year : String(today.getFullYear()),
    semester: last?.semester === "1" || last?.semester === "2" ? last.semester : String(today.getMonth() < 6 ? 1 : 2),
    shift: "",
    period: "",
  };
}

/** Linha de um passo concluído: o check verde, o que foi escolhido e "Alterar". */
function StepDone({ label, children, onEdit }: { label: string; children: ReactNode; onEdit: () => void }) {
  return (
    <div className="admin-step is-done">
      <span className="admin-step-ck" aria-hidden>
        <Check className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <small>{label}</small>
        {children}
      </div>
      <button className="btn btn-g admin-step-edit" onClick={onEdit} type="button" aria-label={`Alterar ${label.toLowerCase()}`}>
        Alterar
      </button>
    </div>
  );
}

/** Um passo que ainda vem: o número e o que vai ser pedido. */
function StepNext({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="admin-step is-next">
      <span className="admin-step-no" aria-hidden>
        {n}
      </span>
      <div className="min-w-0">
        <b>
          <span className="sr-only">Passo {n}, a seguir: </span>
          {title}
        </b>
        <span>{sub}</span>
      </div>
    </div>
  );
}

export function NewClassPanel({ api, data, subtitle, view }: PanelProps<"newClass">) {
  const actions = useAppActions();
  const { token, showError, toast } = actions;
  const courses = mergeCourses(data?.courses, view.newCourses);
  const allClasses = [...(data?.classes ?? []), ...(data?.archivedClasses ?? [])];
  const formId = useId();
  const id = formId.replace(/:/g, "");
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const [initial] = useState<ClassDraft>(() => freshClassDraft(courses));
  const draft = view.draft ?? initial;
  const step: ClassStep = view.step ?? 1;
  const [working, setWorking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const course = courseOf(courses, draft.courseId);
  const integrated = isIntegratedCourse(course);
  const suggestion = suggestClassName(course, draft, integrated, allClasses);
  const prefixFromClasses = Boolean(course) && classNamePrefix(course, allClasses) !== course?.code;
  const nameFollows = !view.nameEdited;
  const created = view.created ?? null;

  // o nome segue a sugestão até a pessoa mexer nele
  const shownName = nameFollows && suggestion ? suggestion : draft.name;
  const effective: ClassDraft = { ...draft, name: shownName };
  const form = useClassForm(effective, courses, null, true);

  // passo novo: o foco vai para o título dele (o leitor de tela anuncia "Período e turno"); turma criada: para
  // "Turma TADS 5B criada"
  const stepKey = created ? `feito-${created.id}` : String(step);
  const stepSeen = useRef(stepKey);
  useEffect(() => {
    if (stepSeen.current !== stepKey) {
      stepSeen.current = stepKey;
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.closest(".admin-step, .admin-done")?.scrollIntoView({ block: "nearest" });
    }
  }, [stepKey]);

  function update(patch: Partial<Extract<PanelView, { kind: "newClass" }>>) {
    const next = { ...view, ...patch };
    const nextDraft = next.draft ?? initial;
    api.setView({ ...next, dirty: Boolean(next.created) ? false : !sameDraft(nextDraft, initial) || (next.step ?? 1) > 1 });
  }

  function change(proposed: ClassDraft) {
    const next = form.adjust(effective, proposed);
    form.edited(effective, next);
    const nameEdited = view.nameEdited || next.name !== effective.name;
    update({ draft: { ...next, name: nameEdited ? next.name : "" }, nameEdited });
  }

  /** Confere os campos do passo; com erro, mostra e leva o foco ao primeiro. */
  function checkStep(target: ClassStep) {
    const found = validateClass(effective, integrated);
    const mine = STEP_FIELDS[target].filter((field) => found[field]);
    form.setErrors((current) => {
      const next = { ...current };
      for (const field of STEP_FIELDS[target]) {
        if (found[field]) {
          next[field] = found[field];
        } else {
          delete next[field];
        }
      }
      return next;
    });
    if (mine.length) {
      focusFirstError(formEl);
      return false;
    }
    return true;
  }

  function goTo(target: ClassStep) {
    update({ step: target });
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (working || created) {
      return;
    }
    if (step < 3) {
      if (checkStep(step)) {
        goTo((step + 1) as ClassStep);
      }
      return;
    }
    if (!form.check()) {
      const errors = validateClass(effective, integrated);
      const first = (Object.keys(errors)[0] ?? "name") as string;
      const target = stepOfField(first);
      if (target !== 3) {
        goTo(target);
      }
      focusFirstError(formEl);
      return;
    }
    setWorking(true);
    api.setBusy(true);
    try {
      const made = await createClass(token, toInput(effective, integrated));
      writeLastClass(effective);
      api.changed({ catalog: true });
      // a gaveta não fecha: o próximo passo (disciplinas, alunos, código) fica à vista
      api.setView({ ...view, draft: effective, created: { id: made.id, name: made.name }, dirty: false });
    } catch (error) {
      form.fromApi(error);
      const fields = Object.keys(fieldErrors(error));
      const target = fields.length ? stepOfField(fields[0]) : 3;
      if (target !== step) {
        goTo(target);
      }
      focusFirstError(formEl);
    } finally {
      setWorking(false);
      api.setBusy(false);
    }
  }

  async function restore(archivedId = form.archivedId) {
    if (!archivedId || working) {
      return;
    }
    setWorking(true);
    api.setBusy(true);
    try {
      const restored = await restoreClass(token, archivedId);
      api.changed({ catalog: true });
      toast(`Turma ${restored.name} restaurada. ${CODE_OFF_TEXT}`, {
        key: `turma-${archivedId}`,
        action: generateCodeAction(actions, api, archivedId),
      });
      api.replace({ kind: "class", classId: archivedId });
    } catch (error) {
      const archivedCourse = conflictOf(error, "COURSE_ARCHIVED");
      if (archivedCourse?.courseId) {
        const courseId = archivedCourse.courseId;
        toast(archivedCourse.message, {
          tone: "danger",
          key: `turma-${archivedId}`,
          action: {
            label: "Restaurar curso e turma",
            onClick: () => {
              void (async () => {
                try {
                  await restoreCourse(token, courseId);
                  await restoreClass(token, archivedId);
                  api.changed({ catalog: true });
                  toast(`Curso e turma restaurados. ${CODE_OFF_TEXT}`, {
                    key: `turma-${archivedId}`,
                    action: generateCodeAction(actions, api, archivedId),
                  });
                  api.replace({ kind: "class", classId: archivedId });
                } catch (inner) {
                  showError(inner, `turma-${archivedId}`);
                }
              })();
            },
          },
        });
      } else {
        showError(error, `turma-${archivedId}`);
      }
    } finally {
      setWorking(false);
      api.setBusy(false);
    }
  }

  /** Abre a turma criada e, por cima dela, o que se quer fazer (Voltar leva à turma). */
  function openCreated(next?: PanelView) {
    if (!created) {
      return;
    }
    api.replace({ kind: "class", classId: created.id });
    if (next) {
      api.push(next);
    }
  }

  /* ---------- Turma criada: o que fazer em seguida ---------- */
  if (created) {
    return (
      <>
        <PanelSubtitle node={subtitle}>
          <span>Turma criada</span>
        </PanelSubtitle>
        <div className="admin-done">
          <span className="admin-done-ico" aria-hidden>
            <Check className="h-6 w-6" />
          </span>
          <h3 ref={headingRef} className="admin-done-t" data-panel-start tabIndex={-1}>
            Turma {created.name} criada
          </h3>
          <p className="admin-done-s">
            {course?.name}
            {course ? ". " : ""}
            {classLine(effective, integrated)}
          </p>
          <p className="admin-done-next">Agora, para ela aparecer para alunos e docentes:</p>
          <div className="admin-next">
            <button
              className="admin-next-btn"
              onClick={() => openCreated({ kind: "addOffer", classId: created.id })}
              type="button"
            >
              <span className="admin-next-ico" aria-hidden>
                <BookOpen className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <b>Adicionar disciplinas</b>
                <span>e vincular as docentes de cada uma</span>
              </span>
              <ChevronRight className="admin-go" aria-hidden />
            </button>
            <button
              className="admin-next-btn"
              onClick={() => openCreated({ kind: "addStudents", classId: created.id })}
              type="button"
            >
              <span className="admin-next-ico" aria-hidden>
                <UserPlus className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <b>Adicionar alunos</b>
                <span>pela lista de e-mails</span>
              </span>
              <ChevronRight className="admin-go" aria-hidden />
            </button>
            <button
              className="admin-next-btn"
              onClick={() => api.replace({ kind: "class", classId: created.id, section: "codigo" })}
              type="button"
            >
              <span className="admin-next-ico" aria-hidden>
                <KeyRound className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <b>Ligar o código da turma</b>
                <span>para os alunos pedirem para entrar</span>
              </span>
              <ChevronRight className="admin-go" aria-hidden />
            </button>
          </div>
        </div>
        <PanelFooter api={api}>
          <button
            className={cx(secondaryButton, "admin-foot-left")}
            onClick={() => {
              // o mesmo curso e o mesmo período: só o nome muda (a próxima letra livre)
              form.setErrors({});
              api.setView({
                kind: "newClass",
                draft: { ...effective, name: "" },
                nameEdited: false,
                step: 3,
                newCourses: view.newCourses,
                dirty: true,
              });
            }}
            type="button"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Criar outra turma
          </button>
          <button className={secondaryButton} onClick={() => api.close()} type="button">
            Fechar
          </button>
          <button className={primaryButton} onClick={() => openCreated()} type="button">
            Abrir a turma
          </button>
        </PanelFooter>
      </>
    );
  }

  /* ---------- Os três passos ---------- */
  const duplicate = shownName.trim()
    ? (takenNames(allClasses, effective, integrated).find(
        (item) => normalizeText(item.name).trim() === normalizeText(shownName).trim()
      ) ?? null)
    : null;
  const termText = integrated ? effective.year : `${effective.year}/${effective.semester || "?"}`;

  function stepHead(n: ClassStep) {
    return (
      <div className="admin-step-h">
        <span className="admin-step-no is-on" aria-hidden>
          {n}
        </span>
        <div className="min-w-0">
          <h3 ref={headingRef} className="admin-step-t" data-panel-start tabIndex={-1}>
            <span className="sr-only">Passo {n} de 3: </span>
            {STEP_TEXT[n].title}
          </h3>
          <span className="admin-step-s">{STEP_TEXT[n].sub}</span>
        </div>
      </div>
    );
  }

  const stepOne = (
    <section className="admin-step is-cur" aria-labelledby={undefined}>
      {stepHead(1)}
      <div className="admin-step-body">
        <CourseChoice
          classes={data?.classes ?? []}
          courses={courses}
          error={form.errors.courseId}
          id={`${id}-curso`}
          value={draft.courseId}
          onChange={(courseId) => change({ ...effective, courseId })}
          onNewCourse={() => api.push({ kind: "newCourse", from: "newClass" })}
        />
      </div>
    </section>
  );

  const stepTwo = (
    <section className="admin-step is-cur">
      {stepHead(2)}
      <div className="admin-step-body admin-form">
        <div className="admin-row2">
          <YearField
            id={`${id}-ano`}
            error={form.errors.year}
            value={draft.year}
            onBlur={() => form.blur("year")}
            onChange={(year) => change({ ...effective, year })}
          />
          {integrated ? (
            <Block id={`${id}-sem`} label="Semestre">
              <p className="admin-annual">Turma anual: aparece só com o ano</p>
            </Block>
          ) : (
            <Block id={`${id}-sem`} label="Semestre" error={form.errors.semester}>
              <ChoiceRow
                error={form.errors.semester}
                id={`${id}-sem`}
                look="seg"
                options={[
                  { value: "1", label: "1º semestre" },
                  { value: "2", label: "2º semestre" },
                ]}
                value={draft.semester}
                onChange={(semester) => change({ ...effective, semester })}
              />
            </Block>
          )}
        </div>
        <PeriodField
          id={`${id}-per`}
          error={form.errors.period}
          integrated={integrated}
          other={Boolean(view.periodOther)}
          value={draft.period}
          onBlur={() => form.blur("period")}
          onChange={(period, other) => {
            const next = form.adjust(effective, { ...effective, period });
            form.edited(effective, next);
            update({ draft: { ...next, name: view.nameEdited ? next.name : "" }, periodOther: other });
          }}
        />
        <ShiftField
          busyNames={shiftClash(data?.classes ?? [], effective, integrated)}
          error={form.errors.shift}
          value={draft.shift}
          onChange={(shift) => change({ ...effective, shift })}
        />
      </div>
    </section>
  );

  const stepThree = (
    <section className="admin-step is-cur">
      {stepHead(3)}
      <div className="admin-step-body admin-form">
        <div>
          <Field label="Nome da turma" error={form.errors.name}>
            <input
              className="input"
              autoComplete="off"
              data-class-name=""
              maxLength={60}
              placeholder={integrated ? "Ex.: INF 3A" : "Ex.: TADS 5"}
              value={shownName}
              onBlur={() => form.blur("name")}
              onChange={(event) => change({ ...effective, name: event.target.value })}
            />
          </Field>
          {nameFollows && suggestion ? (
            <p className="admin-suggested">
              <span className="stat green">
                <Check className="h-3 w-3" aria-hidden />
                Sugerido
              </span>
              {prefixFromClasses
                ? `Como as outras turmas do curso, com o ${integrated ? "ano e a letra da turma" : "número do período"}.`
                : `Sigla do curso e ${integrated ? "ano, com a letra da turma" : "número do período"}.`}{" "}
              Pode mudar.
            </p>
          ) : null}
          {form.archivedId ? (
            <button className={cx(secondaryButton, "btn-sm mt-2")} onClick={() => void restore()} type="button">
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              Restaurar turma
            </button>
          ) : null}
        </div>
        {duplicate && !form.errors.name ? (
          <div className="callout amber" role="status">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p>
                {duplicate.name} já existe em {termText} neste curso
                {duplicate.archivedAt ? ", arquivada" : ""}.
                {suggestion && normalizeText(suggestion) !== normalizeText(shownName) ? ` Sugerimos ${suggestion}.` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestion && normalizeText(suggestion) !== normalizeText(shownName) ? (
                  <button
                    className={cx(secondaryButton, "btn-sm")}
                    onClick={() => {
                      update({ draft: { ...draft, name: "" }, nameEdited: false });
                      // o botão sai da tela com o aviso: o foco volta para o nome, já com a sugestão
                      window.requestAnimationFrame(() =>
                        formEl?.querySelector<HTMLInputElement>("[data-class-name]")?.focus()
                      );
                    }}
                    type="button"
                  >
                    Usar {suggestion}
                  </button>
                ) : null}
                {duplicate.archivedAt ? (
                  <button
                    className={cx(secondaryButton, "btn-sm")}
                    onClick={() => void restore(duplicate.id)}
                    type="button"
                  >
                    <ArchiveRestore className="h-4 w-4" aria-hidden />
                    Restaurar {duplicate.name}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        <p className="field-help !mt-0">Depois de criar: disciplinas, alunos e o código da turma.</p>
      </div>
    </section>
  );

  const nextSubs: Record<ClassStep, string> = {
    1: STEP_TEXT[1].sub,
    2: "Ano, semestre, período do curso e turno",
    3: suggestion ? `Nome sugerido ${suggestion}` : "O nome da turma e o resumo",
  };

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span className="basis-full">
          Passo {step} de 3: {STEP_TEXT[step].head}
        </span>
        <span className="admin-prog3" aria-hidden>
          {([1, 2, 3] as ClassStep[]).map((n) => (
            <i key={n} className={cx(n < step && "done", n === step && "cur")} />
          ))}
        </span>
      </PanelSubtitle>
      <form
        ref={setFormEl}
        id={formId}
        className="admin-steps"
        aria-busy={working || undefined}
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {form.errors.form ? (
          <p className="callout rose" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {form.errors.form}
          </p>
        ) : null}

        {step > 1 && course ? (
          <StepDone label="Curso" onEdit={() => goTo(1)}>
            <b>{course.name}</b>
            <span className="admin-step-meta">
              <span className="admin-code">{course.code}</span>
              {courseRhythm(course)}
            </span>
          </StepDone>
        ) : step === 1 ? (
          stepOne
        ) : null}

        {step > 2 ? (
          <StepDone label="Período e turno" onEdit={() => goTo(2)}>
            <b>{classLine(effective, integrated)}</b>
          </StepDone>
        ) : step === 2 ? (
          stepTwo
        ) : (
          <StepNext n={2} title={STEP_TEXT[2].title} sub={nextSubs[2]} />
        )}

        {step === 3 ? stepThree : <StepNext n={3} title={STEP_TEXT[3].title} sub={nextSubs[3]} />}

        {course ? (
          <div className="admin-preview">
            <small>Assim a turma vai aparecer na lista</small>
            <div className="admin-preview-row">
              <b className={cx(!shownName.trim() && "is-empty")}>{shownName.trim() || "Nome da turma"}</b>
              <span>{course.name}</span>
            </div>
            <div className="admin-preview-row">
              <span>{classLine(effective, integrated) || "Ano, período e turno"}</span>
            </div>
          </div>
        ) : null}
      </form>
      <PanelFooter api={api}>
        {step > 1 ? (
          <button className="btn btn-g admin-foot-left" onClick={() => goTo((step - 1) as ClassStep)} type="button">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Voltar
          </button>
        ) : (
          <span className="admin-foot-gap" />
        )}
        {/* com rascunho, pergunta antes de descartar, como o X e o Esc */}
        <button className={secondaryButton} onClick={() => api.cancel()} type="button">
          Cancelar
        </button>
        <button className={cx(primaryButton, busyLook)} aria-disabled={working || undefined} form={formId} type="submit">
          {step < 3 ? (
            <>
              Continuar
              <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" aria-hidden />
              Criar turma
            </>
          )}
        </button>
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Novo curso (a partir da Nova turma, com Voltar)                     */
/* ------------------------------------------------------------------ */

const EMPTY_COURSE: CourseDraft = { name: "", code: "", codeEdited: false, modality: "" };

export function NewCoursePanel({ api, subtitle, view }: PanelProps<"newCourse">) {
  const { token, toast } = useAppActions();
  const formId = useId();
  const id = formId.replace(/:/g, "");
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const draft = view.draft ?? EMPTY_COURSE;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [archivedId, setArchivedId] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const code = draft.codeEdited ? draft.code : suggestCourseCode(draft.name);

  function change(patch: Partial<CourseDraft>) {
    const next = { ...draft, ...patch };
    api.setView({ ...view, draft: next, dirty: Boolean(next.name.trim() || (next.codeEdited && next.code) || next.modality) });
    setErrors((current) => {
      const left = { ...current };
      for (const key of Object.keys(patch)) {
        delete left[key === "codeEdited" ? "code" : key];
      }
      // a sigla sugerida segue o nome: o erro dela sai junto
      if ("name" in patch && !next.codeEdited) {
        delete left.code;
      }
      delete left.form;
      return left;
    });
    if ("name" in patch || "code" in patch) {
      setArchivedId(null);
    }
  }

  function validate() {
    const next: Record<string, string> = {};
    if (draft.name.trim().length < 2) {
      next.name = "Escreva o nome do curso, com pelo menos 2 caracteres.";
    } else if (draft.name.trim().length > 80) {
      next.name = "Use até 80 caracteres no nome do curso.";
    }
    if (!/^[A-Z0-9-]{2,12}$/.test(code.trim().toUpperCase())) {
      next.code = "Use de 2 a 12 letras, números ou hífen na sigla. Ex.: TADS.";
    }
    if (!draft.modality) {
      next.modality = "Escolha como as turmas do curso são organizadas.";
    }
    return next;
  }

  /** O curso pronto: volta para a Nova turma com ele escolhido e o passo 2 aberto. */
  function backWithCourse(course: Course) {
    api.backWith((previous) =>
      previous.kind === "newClass"
        ? {
            ...previous,
            draft: { ...(previous.draft ?? freshClassDraft([])), courseId: String(course.id), period: "", semester: isIntegratedCourse(course) ? "" : (previous.draft?.semester ?? freshClassDraft([]).semester) },
            newCourses: [...(previous.newCourses ?? []), course],
            step: 2,
            dirty: true,
          }
        : previous
    );
  }

  async function create(event?: FormEvent) {
    event?.preventDefault();
    if (working) {
      return;
    }
    const found = validate();
    setErrors(found);
    setArchivedId(null);
    if (Object.keys(found).length) {
      focusFirstError(formEl);
      return;
    }
    setWorking(true);
    api.setBusy(true);
    try {
      const course = await createCourse(token, {
        name: draft.name.trim(),
        code: code.trim().toUpperCase(),
        modality: draft.modality as CourseModality,
      });
      api.changed({ catalog: true });
      toast(
        view.from === "courses" ? `Curso ${course.code} criado.` : `Curso ${course.code} criado. Agora o período da turma.`,
        { key: `curso-${course.id}` }
      );
      backWithCourse(course);
    } catch (error) {
      const duplicate = conflictOf(error, "ARCHIVED_DUPLICATE");
      if (duplicate) {
        setErrors({ code: duplicate.message });
        setArchivedId(duplicate.archivedId ?? null);
      } else {
        const byField = courseFieldErrors(error);
        setErrors(Object.keys(byField).length ? byField : { form: errorMessage(error) });
      }
      focusFirstError(formEl);
    } finally {
      setWorking(false);
      api.setBusy(false);
    }
  }

  async function restore() {
    if (!archivedId || working) {
      return;
    }
    setWorking(true);
    api.setBusy(true);
    try {
      const course = await restoreCourse(token, archivedId);
      api.changed({ catalog: true });
      toast(`Curso ${course.code} restaurado.`, { key: `curso-${course.id}` });
      backWithCourse(course);
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setWorking(false);
      api.setBusy(false);
    }
  }

  const modalities: Array<{ value: CourseModality; title: string; text: string }> = [
    { value: "superior", title: "Por semestre", text: "Curso superior. Ex.: TADS 5, 2026/2, 5º período" },
    { value: "integrado", title: "Por ano", text: "Integrado ao ensino médio. Ex.: INF 3A, 2026, 3º ano" },
  ];

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span>
          {view.from === "courses"
            ? "Nome, sigla e como as turmas do curso são organizadas."
            : "Ao criar, você volta para a Nova turma com o curso escolhido."}
        </span>
      </PanelSubtitle>
      <form
        ref={setFormEl}
        id={formId}
        className="admin-sec admin-form !pt-1"
        aria-busy={working || undefined}
        noValidate
        onSubmit={(event) => void create(event)}
      >
        <h3 className="sr-only" data-panel-start tabIndex={-1}>
          Dados do curso
        </h3>
        {errors.form ? (
          <p className="callout rose" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {errors.form}
          </p>
        ) : null}
        <Field label="Nome do curso" error={errors.name}>
          <input
            className="input"
            autoComplete="off"
            data-panel-focus=""
            maxLength={80}
            placeholder="Ex.: Tecnologia em Análise e Desenvolvimento de Sistemas"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </Field>
        <div>
          <Field label="Sigla" error={errors.code} hint="de 2 a 12 letras">
            <input
              className="input admin-code-input"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={12}
              placeholder="Ex.: TADS"
              value={code}
              onChange={(event) => change({ code: event.target.value.toUpperCase(), codeEdited: true })}
            />
          </Field>
          {!draft.codeEdited && code ? (
            <p className="admin-suggested">
              <span className="stat green">
                <Check className="h-3 w-3" aria-hidden />
                Sugerida
              </span>
              Pelas iniciais do nome. Pode mudar.
            </p>
          ) : null}
          {archivedId ? (
            <button className={cx(secondaryButton, "btn-sm mt-2")} onClick={() => void restore()} type="button">
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              Restaurar curso
            </button>
          ) : null}
        </div>
        <Block id={`${id}-mod`} label="Como as turmas são organizadas" error={errors.modality}>
          <div
            className="admin-modes"
            role="radiogroup"
            aria-labelledby={`${id}-mod-l`}
            aria-invalid={errors.modality ? true : undefined}
            aria-describedby={errors.modality ? `${id}-mod-e` : undefined}
          >
            {modalities.map((item) => (
              <label key={item.value} className={cx("admin-course", draft.modality === item.value && "on")}>
                <input
                  className="sr-only"
                  type="radio"
                  name={`${id}-mod-r`}
                  checked={draft.modality === item.value}
                  onChange={() => change({ modality: item.value })}
                />
                <span className="admin-radio" aria-hidden />
                <span className="admin-course-main">
                  <b>{item.title}</b>
                  <span>{item.text}</span>
                </span>
              </label>
            ))}
          </div>
        </Block>
      </form>
      <PanelFooter api={api}>
        <button className="btn btn-g admin-foot-left" onClick={() => api.back()} type="button">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Voltar
        </button>
        <button className={cx(primaryButton, busyLook)} aria-disabled={working || undefined} form={formId} type="submit">
          <Plus className="h-4 w-4" aria-hidden />
          Criar curso
        </button>
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cursos: lista, editar nome e sigla, arquivar e restaurar            */
/* ------------------------------------------------------------------ */

export function CoursesPanel({ api, data, subtitle }: PanelProps<"courses">) {
  const { token } = useAppActions();
  const archived = useRemote("admin:cursos-arquivados", () => getCourses(token, { archived: true }));
  const courses = data?.courses ?? [];
  const classes = data?.classes ?? [];

  function row(course: Course, isArchived: boolean) {
    const total = classes.filter((item) => item.courseId === course.id).length;
    return (
      <li key={course.id}>
        <button
          className="admin-srow"
          data-return={`curso-${course.id}`}
          onClick={() => api.push({ kind: "course", courseId: course.id }, `curso-${course.id}`)}
          type="button"
        >
          <span className="admin-s-main">
            <span className="admin-s-name">{course.name}</span>
            <span className="admin-course-line">
              <span className="admin-code">{course.code}</span>
              {isArchived
                ? "arquivado"
                : `${courseRhythm(course)}, ${total ? plural(total, "turma ativa", "turmas ativas") : "nenhuma turma ativa"}`}
            </span>
          </span>
          <ChevronRight className="admin-go" aria-hidden />
        </button>
      </li>
    );
  }

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span>{plural(courses.length, "curso ativo", "cursos ativos")}</span>
      </PanelSubtitle>
      <section className="admin-sec !pt-1" aria-labelledby="cursos-ativos">
        <div className="admin-sec-head">
          <h3 id="cursos-ativos" className="admin-sec-t drawer-h3" data-panel-start tabIndex={-1}>
            Cursos ativos
          </h3>
          <button
            className={cx(secondaryButton, "btn-sm")}
            data-return="novo-curso"
            onClick={() => api.push({ kind: "newCourse", from: "courses" }, "novo-curso")}
            type="button"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Novo curso
          </button>
        </div>
        {courses.length ? (
          <ul className="admin-people">{courses.map((course) => row(course, false))}</ul>
        ) : (
          <EmptyState compact icon={Info} text="Nenhum curso ativo" hint="Cadastre o curso para criar as turmas dele." />
        )}
      </section>
      {archived.data?.length ? (
        <section className="admin-sec" aria-labelledby="cursos-arquivados">
          <h3 id="cursos-arquivados" className="admin-sec-t drawer-h3">
            Arquivados
          </h3>
          <ul className="admin-people mt-2">{archived.data.map((course) => row(course, true))}</ul>
        </section>
      ) : null}
      <PanelFooter api={api}>
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.close()} type="button">
          Fechar
        </button>
      </PanelFooter>
    </>
  );
}

export function CoursePanel({ api, data, subtitle, view }: PanelProps<"course">) {
  const actions = useAppActions();
  const { token, toast, showError } = actions;
  const archivedList = useRemote("admin:cursos-arquivados", () => getCourses(token, { archived: true }));
  const course =
    (data?.courses ?? []).find((item) => item.id === view.courseId) ??
    (archivedList.data ?? []).find((item) => item.id === view.courseId) ??
    null;
  const isArchived = Boolean(course?.archivedAt) || !(data?.courses ?? []).some((item) => item.id === view.courseId);
  const original = course ? { name: course.name, code: course.code } : null;
  const draft = view.draft ?? original;
  const formId = useId();
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const total = (data?.classes ?? []).filter((item) => item.courseId === view.courseId).length;

  useEffect(() => {
    if (course) {
      api.setTitle(course.name);
    }
  }, [course, api]);

  function change(patch: Partial<{ name: string; code: string }>) {
    if (!draft || !original) {
      return;
    }
    const next = { ...draft, ...patch };
    api.setView({ ...view, draft: next, dirty: next.name !== original.name || next.code !== original.code });
    setErrors((current) => {
      const left = { ...current };
      for (const key of Object.keys(patch)) {
        delete left[key];
      }
      delete left.form;
      return left;
    });
  }

  async function run(task: () => Promise<void>) {
    if (working) {
      return;
    }
    setWorking(true);
    api.setBusy(true);
    try {
      await task();
    } finally {
      setWorking(false);
      api.setBusy(false);
    }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!draft || !original || !course) {
      return;
    }
    if (draft.name === original.name && draft.code === original.code) {
      api.back();
      return;
    }
    const found: Record<string, string> = {};
    if (draft.name.trim().length < 2) {
      found.name = "Escreva o nome do curso, com pelo menos 2 caracteres.";
    } else if (draft.name.trim().length > 80) {
      found.name = "Use até 80 caracteres no nome do curso.";
    }
    if (!/^[A-Z0-9-]{2,12}$/.test(draft.code.trim().toUpperCase())) {
      found.code = "Use de 2 a 12 letras, números ou hífen na sigla. Ex.: TADS.";
    }
    setErrors(found);
    if (Object.keys(found).length) {
      focusFirstError(formEl);
      return;
    }
    await run(async () => {
      try {
        const saved = await updateCourse(token, course.id, { name: draft.name.trim(), code: draft.code.trim().toUpperCase() });
        api.changed({ catalog: true });
        toast(`Curso ${saved.code} salvo.`, { key: `curso-${course.id}` });
        api.backWith((previous) => previous);
      } catch (error) {
        const byField = courseFieldErrors(error);
        setErrors(Object.keys(byField).length ? byField : { form: errorMessage(error) });
        focusFirstError(formEl);
      }
    });
  }

  async function archive() {
    if (!course) {
      return;
    }
    await run(async () => {
      try {
        await archiveCourse(token, course.id);
        api.changed({ catalog: true });
        void archivedList.reload();
        toast(`Curso ${course.code} arquivado. Ele sai da Nova turma e dos filtros.`, {
          key: `curso-${course.id}`,
          undo: async () => {
            await restoreCourse(token, course.id);
            api.changed({ catalog: true });
            void archivedList.reload();
          },
        });
        api.backWith((previous) => previous);
      } catch (error) {
        showError(error, `curso-${course.id}`);
      }
    });
  }

  async function restore() {
    if (!course) {
      return;
    }
    await run(async () => {
      try {
        await restoreCourse(token, course.id);
        api.changed({ catalog: true });
        void archivedList.reload();
        toast(`Curso ${course.code} restaurado.`, { key: `curso-${course.id}` });
        api.backWith((previous) => previous);
      } catch (error) {
        showError(error, `curso-${course.id}`);
      }
    });
  }

  if (!course || !draft) {
    return (
      <>
        <div className="admin-sec !pt-1" aria-busy={archivedList.loading || undefined}>
          <h3 className="sr-only" data-panel-start tabIndex={-1}>
            Curso
          </h3>
          {archivedList.loading ? (
            <SkeletonRows rows={2} label="Carregando o curso" />
          ) : (
            <EmptyState icon={Info} text="Curso não encontrado" hint="Ele pode ter sido excluído. Volte para a lista de cursos." />
          )}
        </div>
        <PanelFooter api={api}>
          <span className="admin-foot-gap" />
          <button className={secondaryButton} onClick={() => api.back()} type="button">
            Voltar
          </button>
        </PanelFooter>
      </>
    );
  }

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span className="admin-code">{course.code}</span>
        <span>{courseRhythm(course)}</span>
        {isArchived ? <span className="pill stat stat-canc">Arquivado</span> : null}
      </PanelSubtitle>
      <form
        ref={setFormEl}
        id={formId}
        className="admin-sec admin-form !pt-1"
        aria-busy={working || undefined}
        noValidate
        onSubmit={(event) => void save(event)}
      >
        <h3 className="sr-only" data-panel-start tabIndex={-1}>
          Dados do curso
        </h3>
        {isArchived ? (
          <p className="callout amber">
            <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Curso arquivado: fica só para consulta. Restaure o curso para editar e criar turmas nele.
          </p>
        ) : null}
        {errors.form ? (
          <p className="callout rose" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {errors.form}
          </p>
        ) : null}
        <Field label="Nome do curso" error={errors.name}>
          <input
            className="input"
            autoComplete="off"
            data-panel-focus={isArchived ? undefined : ""}
            disabled={isArchived}
            maxLength={80}
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </Field>
        <Field label="Sigla" error={errors.code} hint="de 2 a 12 letras">
          <input
            className="input admin-code-input"
            autoCapitalize="characters"
            autoComplete="off"
            disabled={isArchived}
            maxLength={12}
            value={draft.code}
            onChange={(event) => change({ code: event.target.value.toUpperCase() })}
          />
        </Field>
        <dl className="admin-facts">
          <div>
            <dt>Como as turmas são organizadas</dt>
            <dd>{isIntegratedCourse(course) ? "Por ano, integrado ao ensino médio" : "Por semestre, curso superior"}</dd>
          </div>
          <div>
            <dt>Turmas ativas</dt>
            <dd>{total ? plural(total, "turma", "turmas") : "Nenhuma"}</dd>
          </div>
        </dl>
        {!isArchived && total ? (
          <p id={`${formId}-arquivar`} className="field-help !mt-0">
            Para arquivar o curso, arquive antes {total === 1 ? "a turma ativa" : `as ${total} turmas ativas`} dele.
          </p>
        ) : null}
      </form>
      <PanelFooter api={api}>
        {isArchived ? (
          <button className={cx(secondaryButton, busyLook)} aria-disabled={working || undefined} onClick={() => void restore()} type="button">
            <ArchiveRestore className="h-4 w-4" aria-hidden />
            Restaurar curso
          </button>
        ) : (
          <button
            className={cx(secondaryButton, busyLook)}
            aria-describedby={total ? `${formId}-arquivar` : undefined}
            aria-disabled={working || total > 0 || undefined}
            onClick={() => {
              if (!total) {
                void archive();
              }
            }}
            title={total ? undefined : "O curso sai da Nova turma e dos filtros. Dá para desfazer."}
            type="button"
          >
            <Archive className="h-4 w-4" aria-hidden />
            Arquivar curso
          </button>
        )}
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.back()} type="button">
          {isArchived ? "Voltar" : "Cancelar"}
        </button>
        {isArchived ? null : (
          <button className={cx(primaryButton, busyLook)} aria-disabled={working || undefined} form={formId} type="submit">
            Salvar
          </button>
        )}
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Painel da turma                                                     */
/* ------------------------------------------------------------------ */

export function ClassPanel({ api, data, subtitle, view }: PanelProps<"class">) {
  const actions = useAppActions();
  const { token, toast, showError, confirm } = actions;
  const id = view.classId;
  const detail = useRemote(`admin:turma:${id}`, () => getClass(token, id));
  const students = useRemote(`admin:turma:${id}:alunos`, () => getClassStudents(token, id));
  const invites = useRemote(`admin:turma:${id}:convites`, () => getClassInvites(token, id));
  const formId = useId();
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [codeShown, setCodeShown] = useState(false);
  const item = detail.data;
  const courses = mergeCourses(data?.courses, [item?.course]);
  const [periodOther, setPeriodOther] = useState(false);
  const original = item ? draftFromClass(item) : null;
  const draft = view.draft ?? original;
  const form = useClassForm(draft, courses, item?.course);
  const archived = Boolean(item?.archivedAt);

  function refreshAll(catalog = false) {
    void detail.reload();
    void students.reload();
    void invites.reload();
    api.changed({ catalog });
  }

  async function run(key: string, task: () => Promise<void>) {
    if (working) {
      return;
    }
    setWorking(key);
    api.setBusy(true);
    try {
      await task();
    } finally {
      setWorking(null);
      api.setBusy(false);
    }
  }

  function change(proposed: ClassDraft) {
    if (!draft || !original) {
      return;
    }
    const next = form.adjust(draft, proposed);
    form.edited(draft, next);
    api.setView({ ...view, draft: next, dirty: !sameDraft(next, original) });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!item || !draft || !original) {
      return;
    }
    if (sameDraft(draft, original)) {
      api.close();
      return;
    }
    if (!form.check()) {
      focusFirstError(formEl);
      return;
    }
    await run("save", async () => {
      try {
        const saved = await updateClass(token, id, toInput(draft, form.integrated));
        void detail.reload();
        api.changed({ catalog: true });
        toast(`Turma ${saved.name} salva.`, { key: `turma-${id}` });
        api.saved(`class-${id}`);
      } catch (error) {
        if (conflictOf(error, "ARCHIVED")) {
          showError(error, `turma-${id}`);
          void detail.reload();
          return;
        }
        form.fromApi(error);
        focusFirstError(formEl);
      }
    });
  }

  async function restoreTo(classId: number) {
    try {
      const restored = await restoreClass(token, classId);
      // o código fica desligado depois de restaurar (regra da API): o aviso diz e oferece gerar um novo
      toast(`Turma ${restored.name} restaurada. ${CODE_OFF_TEXT}`, {
        key: `turma-${classId}`,
        action: generateCodeAction(actions, api, classId),
      });
      if (classId === id) {
        refreshAll(true);
      } else {
        api.changed({ catalog: true });
        api.replace({ kind: "class", classId });
      }
    } catch (error) {
      const archivedCourse = conflictOf(error, "COURSE_ARCHIVED");
      if (archivedCourse?.courseId) {
        const courseId = archivedCourse.courseId;
        toast(archivedCourse.message, {
          tone: "danger",
          key: `turma-${classId}`,
          action: {
            label: "Restaurar curso e turma",
            onClick: () => {
              void (async () => {
                try {
                  await restoreCourse(token, courseId);
                  await restoreTo(classId);
                } catch (inner) {
                  showError(inner, `turma-${classId}`);
                }
              })();
            },
          },
        });
        return;
      }
      showError(error, `turma-${classId}`);
    }
  }

  async function archive() {
    if (!item) {
      return;
    }
    await run("archive", async () => {
      try {
        const result = await archiveClass(token, id);
        api.setView({ ...view, draft: undefined, dirty: false });
        refreshAll(true);
        const future = result.futureEvents ?? item.futureEvents;
        toast(
          `${item.name} arquivada.${
            future
              ? ` ${plural(future, "evento futuro continua visível", "eventos futuros continuam visíveis")}, sem lembretes.`
              : ""
          }${item.joinCodeActive ? " O código da turma foi desligado, e o Desfazer não o liga de novo." : ""}`,
          { key: `turma-${id}`, undo: () => restoreTo(id) }
        );
      } catch (error) {
        showError(error, `turma-${id}`);
      }
    });
  }

  function remove() {
    if (!item) {
      return;
    }
    confirm({
      title: `Excluir a turma ${item.name}?`,
      message: "A turma está vazia e sai do sistema. Não dá para desfazer.",
      confirmLabel: "Excluir turma",
      cancelLabel: "Manter turma",
      action: async () => {
        try {
          await deleteClass(token, id);
          forgetRemote(`admin:turma:${id}`);
          // fecha o painel e só depois a tela recarrega (api.removed): nada da turma excluída é buscado de novo
          api.removed("class");
          toast(`Turma ${item.name} excluída.`, { key: `turma-${id}` });
        } catch (error) {
          const blocked = conflictOf(error, "HAS_DEPENDENTS");
          if (blocked) {
            // a frase da API já diz o que impede e o que fazer
            toast(blocked.message, { tone: "danger", key: `turma-${id}` });
            refreshAll();
            return;
          }
          showError(error, `turma-${id}`);
        }
      },
    });
  }

  if (!item || !draft) {
    const missing = isNotFound(detail.error);
    return (
      <>
        {missing ? (
          // ?tela=turmas&turma=999: a turma não existe (ou foi excluída). O endereço já perdeu o &turma=
          <div className="admin-sec !pt-1">
            <h3 className="sr-only" data-panel-start tabIndex={-1}>
              Turma não encontrada
            </h3>
            <EmptyState
              icon={Info}
              text="Turma não encontrada"
              hint="Ela pode ter sido excluída, ou o endereço está errado. Volte para a lista de turmas."
            />
          </div>
        ) : detail.error ? (
          <ErrorState title="Não deu para abrir a turma" text={errorMessage(detail.error)} onRetry={() => void detail.reload()} />
        ) : (
          <div className="admin-sec !pt-1" aria-busy="true">
            <h3 className="sr-only" data-panel-start tabIndex={-1}>
              Carregando a turma
            </h3>
            <SkeletonRows rows={4} label="Carregando a turma" />
          </div>
        )}
        <PanelFooter api={api}>
          <span className="admin-foot-gap" />
          {missing ? (
            <button className={primaryButton} onClick={() => api.close()} type="button">
              Voltar para Turmas
            </button>
          ) : (
            <button className={secondaryButton} onClick={() => api.back()} type="button">
              {api.canGoBack ? "Voltar" : "Fechar"}
            </button>
          )}
        </PanelFooter>
      </>
    );
  }

  const studentList = students.data ?? [];
  const inviteList = invites.data ?? [];
  const isEmpty =
    !item.counts.activeStudents &&
    !item.counts.pendingStudents &&
    !item.counts.pendingInvites &&
    !item.offers.length &&
    students.data !== null &&
    !studentList.length &&
    invites.data !== null &&
    !inviteList.length;
  const dirty = Boolean(view.dirty) && !archived;
  const future = item.futureEvents;
  const busy = working !== null;

  const editing = !archived && (Boolean(view.editing) || dirty || Object.keys(form.errors).length > 0);

  function openEditing() {
    api.setView({ ...view, editing: true });
    // o foco vai para o nome da turma (o campo que mais muda), e o formulário entra na vista
    window.requestAnimationFrame(() => {
      const field = formEl?.querySelector<HTMLElement>("[data-class-name]");
      field?.focus({ preventScroll: true });
      formEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function closeEditing() {
    form.setErrors({});
    api.setView({ ...view, editing: false, draft: undefined, dirty: false });
    window.requestAnimationFrame(() => document.getElementById(`${formId}-editar`)?.focus({ preventScroll: true }));
  }

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span className="basis-full admin-sub-course">{item.course?.name}</span>
        <span className="pill st-ag">{classTermLabel(item)}</span>
        {item.period ? <span className="pill st-ag">{item.period}</span> : null}
        {item.shift ? <span className="pill st-ag">{shiftLabels[item.shift as keyof typeof shiftLabels] ?? item.shift}</span> : null}
        {archived ? <span className="pill stat stat-canc">Arquivada</span> : <span className="pill stat stat-conc">Ativa</span>}
      </PanelSubtitle>

      {archived ? (
        <p className="callout amber mt-1">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Turma arquivada: fica só para consulta, e os eventos dela continuam no histórico. Restaure a turma para editar,
          ofertar disciplinas ou incluir alunos.
        </p>
      ) : null}

      {/* 1. Alunos (com os pedidos de entrada no alto): é o que mais se vem fazer no painel da turma */}
      <StudentsSection
        api={api}
        archived={archived}
        invites={invites.data}
        item={item}
        loadingError={students.error ?? invites.error}
        filter={view.studentFilter ?? ""}
        page={view.studentPage ?? 1}
        showOthers={Boolean(view.showOthers)}
        students={students.data}
        onChanged={() => refreshAll()}
        onRetry={() => {
          void students.reload();
          void invites.reload();
        }}
        onFilter={(value) => api.setView({ ...view, studentFilter: value, studentPage: 1 })}
        onPage={(value) => api.setView({ ...view, studentPage: value })}
        onShowOthers={(value) => api.setView({ ...view, showOthers: value })}
        onShowCode={() => {
          setCodeShown(true);
          window.requestAnimationFrame(() => {
            const target = document.getElementById(`${formId}-codigo`);
            target?.scrollIntoView({ block: "nearest" });
            target?.focus({ preventScroll: true });
          });
        }}
      />

      {/* 2. Disciplinas e docentes */}
      <OffersSection api={api} archived={archived} item={item} />

      {/* 3. Código da turma */}
      <CodeSection
        archived={archived}
        focusFirst={view.section === "codigo"}
        headingId={`${formId}-codigo`}
        item={item}
        shown={codeShown || view.section === "codigo"}
        onFocused={() => {
          // o painel já pôs o foco no título do código: a seção fica aberta e o pedido sai da vista
          setCodeShown(true);
          api.setView({ ...view, section: undefined });
        }}
        working={working}
        onRun={run}
        onShown={setCodeShown}
        onUpdated={() => {
          void detail.reload();
          api.changed();
        }}
      />

      {/* 4. Dados: um resumo; o formulário abre em "Editar dados" (muda pouco, e não pode mudar sem querer) */}
      <form ref={setFormEl} id={formId} className="admin-sec" aria-labelledby={`${formId}-t`} noValidate onSubmit={(event) => void save(event)}>
        <div className="admin-sec-head">
          <div className="min-w-0">
            <h3 id={`${formId}-t`} className="admin-sec-t drawer-h3" tabIndex={-1}>
              Dados da turma
            </h3>
            <p className="admin-sec-s">
              {editing ? "Mude o que precisar e salve no rodapé." : "Curso, nome, período, ano e turno."}
            </p>
          </div>
          {archived ? null : editing ? (
            dirty ? null : (
              <button className={cx(secondaryButton, "btn-sm")} onClick={closeEditing} type="button">
                Fechar edição
              </button>
            )
          ) : (
            <button
              id={`${formId}-editar`}
              className={cx(secondaryButton, "btn-sm")}
              onClick={openEditing}
              type="button"
            >
              <Pencil className="h-4 w-4" aria-hidden />
              Editar dados
            </button>
          )}
        </div>
        {form.errors.form ? (
          <p className="callout rose mb-4" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {form.errors.form}
          </p>
        ) : null}
        {editing ? (
          <ClassFields
            classes={(data?.classes ?? []).filter((other) => other.id !== id)}
            courses={courses}
            draft={draft}
            errors={form.errors}
            extraCourse={item.course}
            restoreLabel={form.archivedId ? "Restaurar turma" : null}
            onBlurField={form.blur}
            onChange={change}
            periodOther={periodOther}
            onPeriodOther={setPeriodOther}
            onRestore={() => {
              const target = form.archivedId;
              if (target) {
                void run("restore-other", () => restoreTo(target));
              }
            }}
          />
        ) : (
          <dl className="admin-facts">
            <div>
              <dt>Curso</dt>
              <dd>{item.course?.name ?? "Sem curso"}</dd>
            </div>
            <div>
              <dt>Nome da turma</dt>
              <dd>{item.name}</dd>
            </div>
            <div>
              <dt>{isIntegratedCourse(item.course) ? "Ano do curso" : "Período do curso"}</dt>
              <dd>{item.period || "Não informado"}</dd>
            </div>
            <div>
              <dt>{item.semester ? "Ano e semestre" : "Ano"}</dt>
              <dd>{item.semester ? `${item.year}, ${item.semester}º semestre` : `${item.year}, turma anual`}</dd>
            </div>
            <div>
              <dt>Turno</dt>
              <dd>{item.shift ? (shiftLabels[item.shift as keyof typeof shiftLabels] ?? item.shift) : "Não informado"}</dd>
            </div>
          </dl>
        )}
      </form>

      <PanelFooter api={api}>
        {archived ? (
          <button
            className={cx(secondaryButton, busyLook)}
            aria-disabled={busy || undefined}
            onClick={() => void run("restore", () => restoreTo(id))}
            title="Restaurar devolve a turma aos seletores. O código continua desligado até você gerar um novo."
            type="button"
          >
            <ArchiveRestore className="h-4 w-4" aria-hidden />
            Restaurar turma
          </button>
        ) : (
          <button
            className={cx(secondaryButton, busyLook)}
            aria-disabled={busy || undefined}
            onClick={() => void archive()}
            title={
              future
                ? `Ao arquivar, ${future === 1 ? "o evento futuro continua visível" : `os ${future} eventos futuros continuam visíveis`}, sem lembretes. Dá para desfazer.`
                : "Ao arquivar, a turma sai dos seletores e o código é desligado. Dá para desfazer."
            }
            type="button"
          >
            <Archive className="h-4 w-4" aria-hidden />
            Arquivar turma
          </button>
        )}
        {isEmpty ? (
          <button className={cx("btn btn-danger", busyLook)} aria-disabled={busy || undefined} onClick={remove} type="button">
            <Trash2 className="h-4 w-4" aria-hidden />
            Excluir turma
          </button>
        ) : null}
        <span className="admin-foot-gap" />
        {api.canGoBack ? (
          <button className={secondaryButton} onClick={() => api.back()} type="button">
            Voltar
          </button>
        ) : null}
        {dirty ? (
          <>
            {!api.canGoBack ? (
              // com rascunho, pergunta antes de descartar, como o X e o Esc
              <button className={secondaryButton} onClick={() => api.cancel()} type="button">
                Cancelar
              </button>
            ) : null}
            <button className={cx(primaryButton, busyLook)} aria-disabled={busy || undefined} form={formId} type="submit">
              Salvar alterações
            </button>
          </>
        ) : !api.canGoBack ? (
          <button className={secondaryButton} onClick={() => api.close()} type="button">
            Fechar
          </button>
        ) : null}
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Disciplinas e docentes                                              */
/* ------------------------------------------------------------------ */

function OffersSection({ api, archived, item }: { api: PanelApi; archived: boolean; item: ClassDetail }) {
  const headingId = useId();
  const offers = item.offers
    .filter((offer) => !offer.archivedAt)
    .sort((a, b) => Number(b.withoutTeacher) - Number(a.withoutTeacher) || a.subject.name.localeCompare(b.subject.name, "pt-BR"));
  const without = offers.filter((offer) => offer.withoutTeacher).length;

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-sec-t drawer-h3">
            Disciplinas e docentes
          </h3>
          <p className="admin-sec-s">
            {offers.length
              ? `${plural(offers.length, "disciplina", "disciplinas")}${without ? `, ${without} sem docente` : ", todas com docente"}`
              : "Nenhuma disciplina ofertada ainda"}
          </p>
        </div>
        {!archived ? (
          <button
            className={cx(secondaryButton, "btn-sm")}
            data-return="add-offer"
            onClick={() => api.push({ kind: "addOffer", classId: item.id }, "add-offer")}
            type="button"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Adicionar disciplina
          </button>
        ) : null}
      </div>
      {offers.length ? (
        <ul className="admin-offers">
          {offers.map((offer) => {
            const returnKey = `offer-${offer.subjectId}`;
            const open = () => api.push({ kind: "offer", classId: item.id, subjectId: offer.subjectId }, returnKey);
            return (
              <li key={offer.id} className={cx("admin-offer", offer.withoutTeacher && "warn")}>
                <div className="admin-of-top">
                  <div className="admin-of-name">
                    <b>{offer.subject.name}</b>
                    <span className="admin-code wt">{offer.subject.code}</span>
                  </div>
                  {archived ? null : offer.withoutTeacher ? (
                    <button className={cx(primaryButton, "btn-sm")} data-return={returnKey} onClick={open} type="button">
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Vincular docente
                    </button>
                  ) : (
                    <button
                      className="ib sm"
                      aria-label={`Docentes de ${offer.subject.name}`}
                      data-return={returnKey}
                      title="Vincular ou trocar docente"
                      onClick={open}
                      type="button"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
                {offer.withoutTeacher ? (
                  <div className="admin-docs warn">
                    <span className="pill stat stat-alt">
                      <CircleAlert className="h-3 w-3" aria-hidden />
                      Sem docente
                    </span>
                    <span>Nenhuma docente publica eventos dela ainda.</span>
                  </div>
                ) : (
                  <div className="admin-docs">
                    {offer.teachers.map((teacher) => (
                      <span key={teacher.assignmentId} className="admin-doc">
                        <span className="admin-av-xs" aria-hidden>
                          {initialsOf(teacher.fullName)}
                        </span>
                        {teacher.fullName}
                        <span className="pill stat">{teachingRoleLabels[teacher.role] ?? teacher.role}</span>
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-inline compact">
          <span className="empty-ico">
            <BookOpen aria-hidden />
          </span>
          <div className="empty-body">
            <p className="empty-t">Turma sem disciplinas</p>
            <p className="empty-s">
              {archived ? "A turma arquivada não recebe disciplinas." : "Adicione as disciplinas e vincule a docente de cada uma."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Alunos                                                              */
/* ------------------------------------------------------------------ */

/** Pedidos decididos agora e a ordem dos pedidos na hora: o foco vai para o mesmo botão do pedido ao lado. */
type DecisionFocus = {
  action: "approve" | "reject";
  decided: number[];
  /** Os pedidos pendentes (enrollmentId), na ordem da lista, na hora da decisão. */
  order: number[];
  /** O botão que decidiu (Aprovar, Recusar ou o do lote). */
  from: Element | null;
};

function sourceLine(student: ClassStudent) {
  const when = formatOnDayAt(student.createdAt);
  switch (student.source) {
    case "code":
      return `Pediu pelo código ${when}`;
    case "invite":
      return `Entrou pelo convite ${when}`;
    case "list":
      return `Entrou pela lista de e-mails ${when}`;
    default:
      return `Incluído pela secretaria ${when}`;
  }
}

function StudentsSection({
  api,
  archived,
  filter,
  invites,
  item,
  loadingError,
  page,
  showOthers,
  students,
  onChanged,
  onFilter,
  onPage,
  onRetry,
  onShowOthers,
  onShowCode,
}: {
  api: PanelApi;
  archived: boolean;
  /** Filtro da lista de alunos (aparece com mais de STUDENT_PAGE alunos). */
  filter: string;
  invites: ClassInvite[] | null;
  item: ClassDetail;
  loadingError: unknown;
  /** Página dos alunos ativos. */
  page: number;
  /** Mostra quem não está na turma (recusados, removidos e concluídos). */
  showOthers: boolean;
  students: ClassStudent[] | null;
  onChanged: () => void;
  onFilter: (value: string) => void;
  onPage: (value: number) => void;
  onRetry: () => void;
  onShowOthers: (value: boolean) => void;
  onShowCode: () => void;
}) {
  const { token, toast, showError, confirm } = useAppActions();
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  // para onde o foco vai quando o pedido decidido sair da lista (ver o efeito abaixo)
  const decisionFocus = useRef<DecisionFocus | null>(null);
  // curso integrado: quem fica ativo na turma passa a contar como menor de idade (regra da API)
  const integrated = isIntegratedCourse(item.course);

  const list = students ?? [];
  const pending = list.filter((student) => student.status === "pending");
  const active = list.filter((student) => student.status === "active");
  const others = list.filter((student) => student.status === "inactive" || student.status === "completed");
  const inviteList = invites ?? [];
  // Nada de "Ver todos (N)" que despeja a turma inteira: os alunos ativos vêm em páginas de 8, com um filtro por
  // nome, e-mail ou matrícula quando a turma passa de uma página. Pedidos, convites e quem saiu também paginam
  const filterWords = normalizeText(filter).split(/\s+/).filter(Boolean);
  const matches = (student: ClassStudent) =>
    !filterWords.length ||
    filterWords.every((word) =>
      normalizeText(`${student.fullName ?? ""} ${student.email} ${student.registration ?? ""}`).includes(word)
    );
  const filteredActive = active.filter(matches);
  const activePaged = usePaged(filteredActive, STUDENT_PAGE, filter, page);
  const pendingPaged = usePaged(pending, pending.length <= STUDENT_PAGE + 2 ? Math.max(pending.length, 1) : STUDENT_PAGE);
  const invitePaged = usePaged(inviteList, inviteList.length <= INVITE_LIMIT + 1 ? Math.max(inviteList.length, 1) : INVITE_LIMIT);
  const othersPaged = usePaged(others, STUDENT_PAGE);
  const shownPending = pendingPaged.items;
  const shownActive = activePaged.items;
  const shownInvites = invitePaged.items;
  // rótulo de grupo ("Pedidos de entrada 2") só quando a lista tem mais de um grupo; com um só, o subtítulo basta
  const groups = [pending.length, active.length, inviteList.length, showOthers ? others.length : 0].filter(Boolean).length;
  const labeled = groups > 1;
  const activeListRef = useRef<HTMLParagraphElement>(null);
  const pendingLabelRef = useRef<HTMLParagraphElement>(null);
  const inviteLabelRef = useRef<HTMLParagraphElement>(null);
  const othersLabelRef = useRef<HTMLParagraphElement>(null);
  // trocar de página leva o foco para o rótulo da lista (sem rótulo, a lista é a única: o título Alunos) e traz a
  // página nova para a vista dentro do painel
  const activeTarget = labeled ? activeListRef : headingRef;
  const pendingTarget = labeled ? pendingLabelRef : headingRef;
  const inviteTarget = labeled ? inviteLabelRef : headingRef;
  const othersTarget = labeled ? othersLabelRef : headingRef;
  const activeRevealed = useRevealOnPage(activePaged, activeTarget);
  const activePager = {
    ...activeRevealed,
    setPage: (value: number) => {
      activeRevealed.setPage(value);
      onPage(value);
    },
  };
  const pendingPager = useRevealOnPage(pendingPaged, pendingTarget);
  const invitePager = useRevealOnPage(invitePaged, inviteTarget);
  const othersPager = useRevealOnPage(othersPaged, othersTarget);
  const selectedPending = selected.filter((id) => pending.some((student) => student.enrollmentId === id));
  const allSelected = shownPending.length > 0 && shownPending.every((student) => selected.includes(student.enrollmentId));

  // Depois de aprovar ou recusar (um ou em lote), quando a lista volta da API sem os pedidos decididos: o foco vai
  // para o mesmo botão do pedido seguinte; sem ele, do anterior; sem pedido nenhum, para o título Alunos. Roda
  // antes da pintura, e o foco não passa pelo painel
  useLayoutEffect(() => {
    const plan = decisionFocus.current;
    const section = sectionRef.current;
    if (!plan || !section || !students) {
      return;
    }
    // a lista ainda é a de antes da decisão: espera a próxima
    if (students.some((student) => student.status === "pending" && plan.decided.includes(student.enrollmentId))) {
      return;
    }
    decisionFocus.current = null;
    const firstButton = (ids: number[]) => {
      for (const id of ids) {
        const found = section.querySelector<HTMLElement>(`[data-decide="${plan.action}-${id}"]`);
        if (found) {
          return found;
        }
      }
      return null;
    };
    const places = plan.decided.map((id) => plan.order.indexOf(id)).filter((index) => index >= 0);
    const after = places.length ? plan.order.slice(Math.max(...places) + 1) : plan.order;
    const before = places.length ? plan.order.slice(0, Math.min(...places)).reverse() : [];
    const target =
      firstButton(after) ??
      firstButton(before) ??
      // um pedido que chegou depois (não estava na lista na hora da decisão)
      section.querySelector<HTMLElement>(`[data-decide^="${plan.action}-"]`) ??
      headingRef.current;
    if (target) {
      focusSoon(target, plan.from);
    }
  }, [students]);

  async function run(key: string, task: () => Promise<void>) {
    if (working) {
      return;
    }
    setWorking(key);
    api.setBusy(true);
    try {
      await task();
    } finally {
      setWorking(null);
      api.setBusy(false);
    }
  }

  /**
   * Desfazer de aprovar ou recusar: só volta o pedido que continua como a ação deixou (uma ação mais nova não é
   * desfeita por um aviso antigo). Depois, a lista e o painel aberto recarregam.
   */
  async function undoDecision(changes: EnrollmentUndo[], label: string, key: string) {
    try {
      const result = await undoEnrollments(token, item.id, changes);
      if (!result.undone) {
        toast(`Nada para desfazer: ${label} mudou depois desta ação e ficou como está.`, { tone: "info", key });
      } else if (result.skipped) {
        toast(
          `${plural(result.undone, "pedido voltou", "pedidos voltaram")} a pendente. ${plural(
            result.skipped,
            "matrícula mudou",
            "matrículas mudaram"
          )} depois e ficou como está.`,
          { tone: "info", key }
        );
      }
    } catch (error) {
      showError(error, key);
    } finally {
      onChanged();
    }
  }

  /** Antes de aprovar adulto na turma do curso integrado: ele passa a contar como menor de idade. */
  function confirmMinor(adults: ClassStudent[], go: () => Promise<void>) {
    if (!integrated || !adults.length) {
      void go();
      return;
    }
    const warning = minorWarning(
      adults.map((student) => ({ name: student.fullName ?? student.email, links: null })),
      item.name,
      "aprovar"
    );
    confirm({
      title: warning.title,
      message: warning.message,
      confirmLabel: "Aprovar mesmo assim",
      cancelLabel: adults.length === 1 ? "Deixar o pedido pendente" : "Deixar os pedidos pendentes",
      tone: "primary",
      action: go,
    });
  }

  function decide(student: ClassStudent, status: "active" | "inactive") {
    const name = student.fullName ?? student.email;
    const key = `matricula-${student.enrollmentId}`;
    const becomesMinor = status === "active" && integrated && student.isMinor === false;
    const from = document.activeElement;
    const order = pending.map((request) => request.enrollmentId);
    const go = () =>
      run(`decide-${student.enrollmentId}`, async () => {
        try {
          await updateEnrollment(token, student.enrollmentId, { status });
          decisionFocus.current = {
            action: status === "active" ? "approve" : "reject",
            decided: [student.enrollmentId],
            order,
            from,
          };
          setSelected((current) => current.filter((id) => id !== student.enrollmentId));
          onChanged();
          toast(
            status === "active"
              ? `${name} entrou na ${item.name}.${becomesMinor ? ` ${firstName(name)} passou a contar como menor de idade.` : ""}`
              : `Pedido de ${name} recusado.`,
            {
              key,
              undo: () =>
                undoDecision([{ enrollmentId: student.enrollmentId, now: status, before: "pending" }], `o pedido de ${name}`, key),
            }
          );
        } catch (error) {
          showError(error, key);
        }
      });
    confirmMinor(becomesMinor ? [student] : [], go);
  }

  function approveSelected() {
    const ids = selectedPending;
    if (!ids.length) {
      return;
    }
    const key = `turma-${item.id}-lote`;
    const adults = pending.filter((student) => ids.includes(student.enrollmentId) && student.isMinor === false);
    const from = document.activeElement;
    const order = pending.map((student) => student.enrollmentId);
    const go = () =>
      run("bulk", async () => {
        try {
          const result = await decideEnrollments(token, item.id, ids, "active");
          const approved = ids.filter((id) => !result.skipped.includes(id));
          // os que já tinham sido decididos também saem dos pendentes
          decisionFocus.current = { action: "approve", decided: ids, order, from };
          setSelected([]);
          onChanged();
          toast(
            `${plural(result.updated, "pedido aprovado", "pedidos aprovados")}${
              result.skipped.length ? `; ${plural(result.skipped.length, "já tinha sido decidido", "já tinham sido decididos")}` : ""
            }.${integrated && adults.length ? ` ${plural(adults.length, "aluno passou", "alunos passaram")} a contar como menor de idade.` : ""}`,
            {
              key,
              undo: approved.length
                ? () =>
                    undoDecision(
                      approved.map((id) => ({ enrollmentId: id, now: "active", before: "pending" })),
                      approved.length === 1 ? "o pedido" : "os pedidos",
                      key
                    )
                : undefined,
            }
          );
        } catch (error) {
          showError(error, key);
        }
      });
    confirmMinor(integrated ? adults : [], go);
  }

  function cancelInvite(invite: ClassInvite) {
    void run(`invite-${invite.id}`, async () => {
      try {
        await cancelClassInvite(token, invite.id);
        onChanged();
        toast(`Convite de ${invite.email} cancelado.`, {
          key: `convite-${invite.id}`,
          undo: async () => {
            try {
              await addClassStudentsByEmail(token, item.id, [invite.email]);
            } catch (error) {
              showError(error, `convite-${invite.id}`);
            } finally {
              onChanged();
            }
          },
        });
      } catch (error) {
        showError(error, `convite-${invite.id}`);
      }
    });
  }

  const summary = [
    active.length || (!pending.length && !inviteList.length) ? plural(active.length, "ativo", "ativos") : null,
    pending.length ? plural(pending.length, "pedido de entrada", "pedidos de entrada") : null,
    inviteList.length ? plural(inviteList.length, "convite", "convites") : null,
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]*)$/, " e $1");

  const busyAttr = working !== null || undefined;

  return (
    <section ref={sectionRef} className="admin-sec" aria-labelledby={headingId} aria-busy={students === null || undefined}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          {/* recebe o foco ao abrir a turma e quando o último pedido de entrada é decidido */}
          <h3 ref={headingRef} id={headingId} className="admin-sec-t drawer-h3" data-panel-start tabIndex={-1}>
            Alunos
          </h3>
          <p className="admin-sec-s">{students === null ? "Carregando alunos" : summary}</p>
        </div>
        {!archived ? (
          <button
            className={cx(secondaryButton, "btn-sm")}
            data-return="add-students"
            onClick={() => api.push({ kind: "addStudents", classId: item.id }, "add-students")}
            type="button"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Adicionar alunos
          </button>
        ) : null}
      </div>

      {students === null ? (
        loadingError ? (
          <ErrorState title="Não deu para carregar os alunos" text={errorMessage(loadingError)} onRetry={onRetry} />
        ) : (
          <SkeletonRows rows={3} label="Carregando os alunos" />
        )
      ) : (
        <>
          {!pending.length && !active.length && !inviteList.length ? (
            <div className="empty-inline compact">
              <span className="empty-ico">
                <Users className="h-5 w-5" aria-hidden />
              </span>
              <div className="empty-body">
                <p className="empty-t">Turma sem alunos</p>
                <p className="empty-s">
                  {archived
                    ? "A turma arquivada não recebe alunos."
                    : "Cole a lista de e-mails da turma ou passe o código para os alunos pedirem para entrar."}
                </p>
                {/* uma ação só: "Adicionar alunos" já está no cabeçalho da seção */}
                {!archived ? (
                  <button className={cx(secondaryButton, "btn-sm")} onClick={onShowCode} type="button">
                    Mostrar código
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {shownPending.length ? (
            <>
              {labeled ? (
                <p ref={pendingLabelRef} className="admin-group">
                  Pedidos de entrada <span className="admin-n">{pending.length}</span>
                </p>
              ) : null}
              <div className="admin-pend-box">
                {!archived ? (
                  <div className="admin-bulk">
                    <label className="admin-ck">
                      <input
                        checked={allSelected}
                        type="checkbox"
                        onChange={(event) =>
                          setSelected(event.target.checked ? shownPending.map((student) => student.enrollmentId) : [])
                        }
                      />
                      {shownPending.length === 1 ? "Selecionar o pedido" : `Selecionar os ${shownPending.length}`}
                    </label>
                    <button
                      className={cx(secondaryButton, "btn-sm", busyLook)}
                      aria-disabled={!selectedPending.length || busyAttr}
                      onClick={() => {
                        if (selectedPending.length && !working) {
                          approveSelected();
                        }
                      }}
                      type="button"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      {selectedPending.length > 1 ? `Aprovar os ${selectedPending.length}` : "Aprovar selecionados"}
                    </button>
                  </div>
                ) : null}
                {shownPending.map((student) => {
                  const name = student.fullName ?? student.email;
                  return (
                    <div key={student.enrollmentId} className="admin-prow">
                      {!archived ? (
                        // a caixa de 18 px ganha uma área de toque maior (o rótulo em volta dela)
                        <label className="admin-ck-hit">
                          <input
                            aria-label={`Selecionar ${name}`}
                            checked={selected.includes(student.enrollmentId)}
                            type="checkbox"
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, student.enrollmentId]
                                  : current.filter((id) => id !== student.enrollmentId)
                              )
                            }
                          />
                        </label>
                      ) : null}
                      <div className="admin-p-main">
                        <p className="admin-p-name">{name}</p>
                        <p className="admin-p-sub">{student.email}</p>
                        <p className="admin-p-sub">{sourceLine(student)}</p>
                      </div>
                      {!archived ? (
                        <div className="admin-p-acts">
                          <button
                            className={cx(primaryButton, "btn-sm", busyLook)}
                            aria-disabled={busyAttr}
                            aria-label={`Aprovar ${name}`}
                            data-decide={`approve-${student.enrollmentId}`}
                            onClick={() => decide(student, "active")}
                            type="button"
                          >
                            Aprovar
                          </button>
                          <button
                            className={cx(secondaryButton, "btn-sm", busyLook)}
                            aria-disabled={busyAttr}
                            aria-label={`Recusar ${name}`}
                            data-decide={`reject-${student.enrollmentId}`}
                            onClick={() => decide(student, "inactive")}
                            type="button"
                          >
                            Recusar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {shownPending.length && pendingPaged.pageCount > 1 ? (
            <Pager paged={pendingPager} noun={["pedido", "pedidos"]} focusRef={pendingTarget} />
          ) : null}

          {active.length ? (
            <>
              {labeled ? (
                <p ref={activeListRef} className="admin-group">
                  Alunos ativos <span className="admin-n">{active.length}</span>
                </p>
              ) : null}
              {active.length > STUDENT_PAGE ? (
                <div className="admin-stu-filter">
                  <Field label="Filtrar alunos">
                    <input
                      className="input"
                      autoComplete="off"
                      placeholder="Nome, e-mail ou matrícula"
                      type="search"
                      value={filter}
                      onChange={(event) => onFilter(event.target.value)}
                    />
                  </Field>
                </div>
              ) : null}
              {shownActive.length ? (
                <ul className="admin-people">
                  {shownActive.map((student) => (
                    <li key={student.enrollmentId}>
                      <StudentRow api={api} classId={item.id} student={student} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  compact
                  icon={Users}
                  text={`Nenhum aluno com "${filter.trim()}"`}
                  hint="Confira o nome, o e-mail ou a matrícula."
                  action={{ label: "Limpar filtro", onClick: () => onFilter("") }}
                />
              )}
              <Pager paged={activePager} noun={["aluno", "alunos"]} focusRef={activeTarget} />
            </>
          ) : null}

          {shownInvites.length ? (
            <>
              {labeled ? (
                <p ref={inviteLabelRef} className="admin-group">
                  Convites pendentes <span className="admin-n">{inviteList.length}</span>
                </p>
              ) : null}
              <ul className="admin-people">
                {shownInvites.map((invite) => (
                  <li key={invite.id} className="admin-irow">
                    <span className="admin-av-sm" aria-hidden>
                      @
                    </span>
                    <span className="admin-s-main">
                      <span className="admin-s-name">{invite.email}</span>
                      <span className="admin-s-mail">Entra na turma quando criar a conta</span>
                    </span>
                    {!archived ? (
                      <button
                        className={cx("ib sm", busyLook)}
                        aria-disabled={busyAttr}
                        aria-label={`Cancelar o convite de ${invite.email}`}
                        title="Cancelar convite"
                        onClick={() => cancelInvite(invite)}
                        type="button"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {shownInvites.length && invitePaged.pageCount > 1 ? <Pager paged={invitePager} noun={["convite", "convites"]} focusRef={inviteTarget} /> : null}

          {showOthers && others.length ? (
            <>
              {labeled ? (
                <p ref={othersLabelRef} className="admin-group">
                  Fora da turma <span className="admin-n">{others.length}</span>
                </p>
              ) : null}
              <ul className="admin-people">
                {othersPaged.items.map((student) => (
                  <li key={student.enrollmentId}>
                    <StudentRow api={api} classId={item.id} student={student} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {showOthers && othersPaged.pageCount > 1 ? <Pager paged={othersPager} noun={["aluno", "alunos"]} focusRef={othersTarget} /> : null}

          {others.length ? (
            <div className="admin-list-foot">
              <button
                className="link admin-link-muted"
                aria-expanded={showOthers}
                onClick={() => onShowOthers(!showOthers)}
                type="button"
              >
                {showOthers ? "Esconder quem não está na turma" : `Ver quem não está na turma (${others.length})`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const enrollmentNote: Partial<Record<ClassStudent["status"], string>> = {
  inactive: "fora da turma",
  completed: "concluiu",
};

function StudentRow({ api, classId, student }: { api: PanelApi; classId: number; student: ClassStudent }) {
  const returnKey = `aluno-${student.userId}`;
  return (
    <button
      className="admin-srow"
      data-return={returnKey}
      onClick={() =>
        api.push({ kind: "student", classId, userId: student.userId, name: student.fullName ?? student.email }, returnKey)
      }
      type="button"
    >
      <span className="admin-av-sm" aria-hidden>
        {initialsOf(student.fullName ?? student.email)}
      </span>
      <span className="admin-s-main">
        <span className="admin-s-name">{student.fullName ?? student.email}</span>
        <span className="admin-s-mail">
          {student.email}
          {enrollmentNote[student.status] ? `, ${enrollmentNote[student.status]}` : ""}
        </span>
      </span>
      {student.isMinor ? <span className="pill st-ag">Menor de idade</span> : null}
      {student.registration ? <span className="admin-s-reg">{student.registration}</span> : null}
      <ChevronRight className="admin-go" aria-hidden />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Código da turma                                                     */
/* ------------------------------------------------------------------ */

function CodeSection({
  archived,
  focusFirst = false,
  headingId,
  item,
  shown,
  working,
  onRun,
  onFocused,
  onShown,
  onUpdated,
}: {
  archived: boolean;
  /** O painel abriu pedindo esta seção: o título recebe o foco (data-panel-focus) quando a turma carrega. */
  focusFirst?: boolean;
  headingId: string;
  item: ClassDetail;
  shown: boolean;
  working: string | null;
  onRun: (key: string, task: () => Promise<void>) => Promise<void>;
  onFocused?: () => void;
  onShown: (value: boolean) => void;
  onUpdated: () => void;
}) {
  const { token, toast, showError, confirm } = useAppActions();
  const on = item.joinCodeActive && !archived;
  const code = item.joinCodeFormatted ?? (item.joinCode ? normalizeCode(item.joinCode) : null);
  const busy = working !== null || undefined;
  const generateRef = useRef<HTMLButtonElement>(null);
  // desligou: o botão que pediu (o Desligar) sai quando a turma recarrega, e o foco vai para o Gerar código
  const focusGenerate = useRef<{ from: Element | null } | null>(null);

  useLayoutEffect(() => {
    const pending = focusGenerate.current;
    const target = generateRef.current;
    if (!pending || on || !target) {
      return;
    }
    focusGenerate.current = null;
    focusSoon(target, pending.from);
  }, [on]);

  function generateNow(replacing: boolean) {
    return onRun("code-new", async () => {
      try {
        await createJoinCode(token, item.id);
        onUpdated();
        onShown(true);
        toast(replacing ? "Código novo gerado. O código antigo parou de valer." : "Código da turma ligado.", {
          key: `codigo-${item.id}`,
        });
      } catch (error) {
        showError(error, `codigo-${item.id}`);
      }
    });
  }

  /** Com o código ligado, o novo tira o de agora de uso na hora: pergunta antes (o foco começa em manter). */
  function generate() {
    if (!on) {
      void generateNow(false);
      return;
    }
    confirm({
      title: "Gerar um código novo?",
      message: `O código de agora${shown && code ? ` (${code})` : ""} deixa de funcionar na hora. Quem ainda não pediu para entrar vai precisar do código novo.`,
      confirmLabel: "Gerar código novo",
      cancelLabel: "Manter o código de agora",
      tone: "primary",
      action: () => generateNow(true),
    });
  }

  function disableNow(from: Element | null) {
    return onRun("code-off", async () => {
      try {
        await disableJoinCode(token, item.id);
        focusGenerate.current = { from };
        onUpdated();
        onShown(false);
        toast("Código da turma desligado. Ninguém pede para entrar com ele até você gerar um novo.", { key: `codigo-${item.id}` });
      } catch (error) {
        showError(error, `codigo-${item.id}`);
      }
    });
  }

  /** Desligar não tem volta (o código de agora não liga de novo): pergunta antes, com o foco em manter. */
  function disable() {
    const from = document.activeElement;
    confirm({
      title: "Desligar o código da turma?",
      message:
        "O código de agora deixa de funcionar na hora, e ninguém pede para entrar com ele. Para aceitar pedidos de novo, gere um código novo: o de agora não volta.",
      confirmLabel: "Desligar o código",
      cancelLabel: "Manter o código ligado",
      action: () => disableNow(from),
    });
  }

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3
            id={headingId}
            className="admin-sec-t drawer-h3"
            data-panel-focus={focusFirst ? "" : undefined}
            tabIndex={-1}
            onFocus={focusFirst ? onFocused : undefined}
          >
            Código da turma
          </h3>
          <p className="admin-sec-s">Quem tem o código pede para entrar, e o pedido aparece em Alunos.</p>
        </div>
        <span className={cx("pill stat", on && "stat-conc")}>{on ? "Ligado" : "Desligado"}</span>
      </div>
      <div className="admin-codebox">
        <span className="mini-ico">
          <KeyRound className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {on && shown && code ? (
            <>
              <p className="admin-code-big" aria-label={`Código da turma: ${code.split("").join(" ")}`}>
                {code}
              </p>
              <p className="admin-p-sub">Maiúsculas, minúsculas e hífen tanto faz na hora de digitar.</p>
            </>
          ) : (
            <>
              <p className="admin-p-name">{on ? "Código escondido" : archived ? "Código desligado na turma arquivada" : "Código desligado"}</p>
              <p className="admin-p-sub">
                {on
                  ? "Mostre só quando for passar para a turma."
                  : archived
                    ? "Restaure a turma para gerar um código novo."
                    : item.joinCode
                      ? CODE_OFF_TEXT
                      : "Gere um código para os alunos pedirem para entrar."}
              </p>
            </>
          )}
        </div>
      </div>
      {!archived ? (
        <>
          <div className="admin-code-acts">
            {on ? (
              <button className={cx(secondaryButton, "btn-sm")} aria-pressed={shown} onClick={() => onShown(!shown)} type="button">
                {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                {shown ? "Esconder código" : "Mostrar código"}
              </button>
            ) : null}
            {on && shown && code ? <CopyButton text={code} /> : null}
            <button
              ref={generateRef}
              className={cx(secondaryButton, "btn-sm", busyLook)}
              aria-disabled={busy}
              onClick={generate}
              type="button"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              {on ? "Gerar novo" : "Gerar código"}
            </button>
            {on ? (
              <button className={cx(secondaryButton, "btn-sm", busyLook)} aria-disabled={busy} onClick={disable} type="button">
                <Power className="h-4 w-4" aria-hidden />
                Desligar
              </button>
            ) : null}
          </div>
          {on ? <p className="field-help">Gerar novo faz o código antigo parar de valer.</p> : null}
        </>
      ) : null}
    </section>
  );
}
