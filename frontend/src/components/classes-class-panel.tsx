"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
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
  getClassStudents,
  restoreClass,
  restoreCourse,
  updateClass,
  updateEnrollment,
  type ClassInput,
} from "@/lib/api";
import {
  classTermLabel,
  cx,
  errorMessage,
  fieldErrors,
  formatOnDayAt,
  isIntegratedCourse,
  normalizeCode,
} from "@/lib/format";
import { modalityLabels, shiftLabels, shiftOptions, teachingRoleLabels } from "@/lib/meta";
import type { ClassDetail, ClassInvite, ClassStudent, Course, CourseModality } from "@/lib/types";
import { useAppActions } from "./app-actions";
import type { ClassesData } from "./classes-view";
import {
  CopyButton,
  PanelFooter,
  SkeletonRows,
  dependentsText,
  forgetRemote,
  initialsOf,
  plural,
  readLastClass,
  useRemote,
  writeLastClass,
  type ClassDraft,
  type PanelApi,
  type PanelView,
} from "./classes-shared";
import { ErrorState, Field, primaryButton, secondaryButton } from "./ui";

/* ------------------------------------------------------------------ */
/* Formulário da turma (criar e editar)                                */
/* ------------------------------------------------------------------ */

type ClassErrors = Partial<Record<keyof ClassDraft | "form", string>>;

const NEW_COURSE = "__novo";
const STUDENT_LIMIT = 8;
const INVITE_LIMIT = 3;

const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

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

/** Sugestões do campo Período do curso (a pessoa pode escrever outro). */
function periodSuggestions(integrated: boolean) {
  return integrated
    ? ["1º ano", "2º ano", "3º ano", "4º ano"]
    : Array.from({ length: 10 }, (_, index) => `${index + 1}º período`);
}

function ClassFields({
  courses,
  disabled,
  draft,
  errors,
  extraCourse,
  focusName,
  restoreLabel,
  onChange,
  onBlurField,
  onCourseCreated,
  onRestore,
}: {
  courses: Course[];
  disabled?: boolean;
  draft: ClassDraft;
  errors: ClassErrors;
  /** Curso da turma que não está na lista (arquivado). */
  extraCourse?: Course | null;
  /** Nova turma: o foco começa no nome (curso e período já vêm preenchidos). */
  focusName?: boolean;
  restoreLabel?: string | null;
  onChange: (draft: ClassDraft) => void;
  onBlurField: (field: keyof ClassDraft) => void;
  onCourseCreated: (course: Course) => void;
  /** 409 ARCHIVED_DUPLICATE: o botão abaixo do nome. */
  onRestore?: () => void;
}) {
  const [creatingCourse, setCreatingCourse] = useState(false);
  const listId = useId();
  const course = courseOf(courses, draft.courseId, extraCourse);
  const integrated = isIntegratedCourse(course);

  function changeCourse(value: string) {
    if (value === NEW_COURSE) {
      setCreatingCourse(true);
      return;
    }
    setCreatingCourse(false);
    const next = courseOf(courses, value, extraCourse);
    const nextIntegrated = isIntegratedCourse(next);
    // turma anual: o semestre some; ao sair do integrado, ele volta vazio e obrigatório
    const semester = nextIntegrated || integrated ? "" : draft.semester;
    onChange({ ...draft, courseId: value, semester });
  }

  const options = [...courses];
  if (extraCourse && !options.some((item) => item.id === extraCourse.id)) {
    options.push(extraCourse);
  }

  return (
    <div className="admin-grid">
      <div className="admin-span6">
        <Field label="Curso" error={errors.courseId}>
          <select
            className="input"
            data-panel-focus={focusName || disabled ? undefined : ""}
            disabled={disabled}
            value={creatingCourse ? NEW_COURSE : draft.courseId}
            onBlur={() => onBlurField("courseId")}
            onChange={(event) => changeCourse(event.target.value)}
          >
            <option value="" disabled>
              Escolha o curso
            </option>
            {options.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
                {item.archivedAt ? " (arquivado)" : ""}
              </option>
            ))}
            <option value={NEW_COURSE}>Novo curso</option>
          </select>
        </Field>
        {creatingCourse ? (
          <NewCourseFields
            onCancel={() => setCreatingCourse(false)}
            onCreated={(created) => {
              setCreatingCourse(false);
              onCourseCreated(created);
              const nextIntegrated = isIntegratedCourse(created);
              onChange({ ...draft, courseId: String(created.id), semester: nextIntegrated || integrated ? "" : draft.semester });
            }}
          />
        ) : null}
      </div>
      <div className="admin-span3">
        <Field label="Nome da turma" error={errors.name}>
          <input
            className="input"
            autoComplete="off"
            data-panel-focus={focusName && !disabled ? "" : undefined}
            disabled={disabled}
            maxLength={60}
            placeholder="Ex.: TADS 5"
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
      <div className="admin-span3">
        <Field label={integrated ? "Ano do curso" : "Período do curso"} error={errors.period}>
          <input
            className="input"
            autoComplete="off"
            disabled={disabled}
            list={listId}
            maxLength={40}
            placeholder={integrated ? "Ex.: 3º ano" : "Ex.: 5º período"}
            value={draft.period}
            onBlur={() => onBlurField("period")}
            onChange={(event) => onChange({ ...draft, period: event.target.value })}
          />
        </Field>
        <datalist id={listId}>
          {periodSuggestions(integrated).map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </div>
      <div className="admin-span2">
        <Field label="Ano" error={errors.year}>
          <input
            className="input"
            disabled={disabled}
            inputMode="numeric"
            maxLength={4}
            value={draft.year}
            onBlur={() => onBlurField("year")}
            onChange={(event) => onChange({ ...draft, year: event.target.value.replace(/\D/g, "") })}
          />
        </Field>
      </div>
      <div className="admin-span2">
        {integrated ? (
          <div className="grid content-start gap-2">
            <span className="lbl">Semestre</span>
            <p className="admin-annual">Turma anual, sem semestre</p>
          </div>
        ) : (
          <Field label="Semestre" error={errors.semester}>
            <select
              className="input"
              disabled={disabled}
              value={draft.semester}
              onBlur={() => onBlurField("semester")}
              onChange={(event) => onChange({ ...draft, semester: event.target.value })}
            >
              <option value="" disabled>
                Escolha
              </option>
              <option value="1">1º semestre</option>
              <option value="2">2º semestre</option>
            </select>
          </Field>
        )}
      </div>
      <div className="admin-span2">
        <Field label="Turno" error={errors.shift}>
          <select
            className="input"
            disabled={disabled}
            value={draft.shift}
            onBlur={() => onBlurField("shift")}
            onChange={(event) => onChange({ ...draft, shift: event.target.value })}
          >
            <option value="" disabled>
              Escolha
            </option>
            {shiftOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {integrated ? (
        <p className="admin-span6 field-help !mt-0">
          Curso integrado: a turma é anual e aparece só com o ano, por exemplo {draft.year || "2026"}.
        </p>
      ) : null}
    </div>
  );
}

/** "Novo curso" dentro do campo Curso: nome, código e modalidade, sem tela à parte. */
function NewCourseFields({ onCancel, onCreated }: { onCancel: () => void; onCreated: (course: Course) => void }) {
  const { token, toast } = useAppActions();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [modality, setModality] = useState<CourseModality>("superior");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [archivedId, setArchivedId] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // o bloco abre com o foco no nome do curso
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function validate() {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) {
      next.name = "Escreva o nome do curso, com pelo menos 2 caracteres.";
    } else if (name.trim().length > 80) {
      next.name = "Use até 80 caracteres no nome do curso.";
    }
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,12}$/.test(clean)) {
      next.code = "Use de 2 a 12 letras, números ou hífen no código. Ex.: TADS.";
    }
    return next;
  }

  async function create() {
    if (working) {
      return;
    }
    const next = validate();
    setErrors(next);
    setArchivedId(null);
    if (Object.keys(next).length) {
      return;
    }
    setWorking(true);
    try {
      const course = await createCourse(token, { name: name.trim(), code: code.trim().toUpperCase(), modality });
      toast(`Curso ${course.code} criado.`);
      onCreated(course);
    } catch (error) {
      const duplicate = conflictOf(error, "ARCHIVED_DUPLICATE");
      if (duplicate) {
        setErrors({ code: duplicate.message });
        setArchivedId(duplicate.archivedId ?? null);
      } else {
        const byField = fieldErrors(error);
        setErrors(Object.keys(byField).length ? byField : { form: errorMessage(error) });
      }
    } finally {
      setWorking(false);
    }
  }

  async function restore() {
    if (!archivedId || working) {
      return;
    }
    setWorking(true);
    try {
      const course = await restoreCourse(token, archivedId);
      toast(`Curso ${course.code} restaurado.`);
      onCreated(course);
    } catch (error) {
      setErrors({ form: errorMessage(error) });
    } finally {
      setWorking(false);
    }
  }

  function enterCreates(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void create();
    }
  }

  return (
    <fieldset className="admin-subform" aria-busy={working || undefined}>
      <legend className="admin-subform-t">Novo curso</legend>
      {errors.form ? (
        <p className="field-error !mt-0" role="alert">
          <CircleAlert aria-hidden />
          <span>{errors.form}</span>
        </p>
      ) : null}
      <Field label="Nome do curso" error={errors.name}>
        <input
          className="input"
          ref={nameRef}
          autoComplete="off"
          maxLength={80}
          placeholder="Ex.: Tecnologia em Análise e Desenvolvimento de Sistemas"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={enterCreates}
        />
      </Field>
      <div className="admin-subform-row">
        <div className="min-w-0 flex-1">
          <Field label="Código" error={errors.code}>
            <input
              className="input"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={12}
              placeholder="Ex.: TADS"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              onKeyDown={enterCreates}
            />
          </Field>
          {archivedId ? (
            <button className={cx(secondaryButton, "btn-sm mt-2")} onClick={() => void restore()} type="button">
              <ArchiveRestore className="h-4 w-4" aria-hidden />
              Restaurar curso
            </button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <Field label="Modalidade" hint={modality === "integrado" ? "turma anual" : "turma por semestre"}>
            <select className="input" value={modality} onChange={(event) => setModality(event.target.value as CourseModality)}>
              {(Object.keys(modalityLabels) as CourseModality[]).map((value) => (
                <option key={value} value={value}>
                  {modalityLabels[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={cx(primaryButton, "btn-sm", busyLook)}
          aria-disabled={working || undefined}
          onClick={() => void create()}
          type="button"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Criar curso
        </button>
        <button className={cx(secondaryButton, "btn-sm")} onClick={onCancel} type="button">
          Cancelar
        </button>
      </div>
    </fieldset>
  );
}

/** Rascunho, erros e validação ao sair do campo (só dos campos já mexidos). */
function useClassForm(draft: ClassDraft | null, courses: Course[], extraCourse?: Course | null) {
  const [errors, setErrors] = useState<ClassErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof ClassDraft, boolean>>>({});
  const [archivedId, setArchivedId] = useState<number | null>(null);
  const integrated = draft ? isIntegratedCourse(courseOf(courses, draft.courseId, extraCourse)) : false;

  function blur(field: keyof ClassDraft) {
    if (!draft || !touched[field]) {
      return;
    }
    const found = validateClass(draft, integrated);
    setErrors((current) => ({ ...current, [field]: found[field] }));
  }

  /** A pessoa mexeu: o campo passa a ser conferido ao sair, e o erro dele some assim que fica certo. */
  function edited(previous: ClassDraft, next: ClassDraft) {
    const nextIntegrated = isIntegratedCourse(courseOf(courses, next.courseId, extraCourse));
    const found = validateClass(next, nextIntegrated);
    const marks = { ...touched };
    const cleared = { ...errors };
    for (const key of Object.keys(next) as Array<keyof ClassDraft>) {
      if (next[key] !== previous[key]) {
        marks[key] = true;
        if (cleared[key] && !found[key]) {
          delete cleared[key];
        }
      }
    }
    if (next.name !== previous.name || next.courseId !== previous.courseId) {
      setArchivedId(null);
    }
    setTouched(marks);
    setErrors(cleared);
  }

  function check(): boolean {
    if (!draft) {
      return false;
    }
    const found = validateClass(draft, integrated);
    setErrors(found);
    setArchivedId(null);
    return Object.keys(found).length === 0;
  }

  function fromApi(error: unknown) {
    const result = apiClassErrors(error, integrated);
    setErrors(result.errors);
    setArchivedId(result.archivedId);
  }

  return { errors, archivedId, integrated, blur, edited, check, fromApi, setErrors };
}

/** Leva o foco ao primeiro campo com erro (depois de salvar). */
function focusFirstError(root: HTMLElement | null) {
  window.requestAnimationFrame(() => {
    const field = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Nova turma                                                          */
/* ------------------------------------------------------------------ */

export function NewClassPanel({ api, data, view }: PanelProps<"newClass">) {
  const { token, toast, showError } = useAppActions();
  const [createdCourses, setCreatedCourses] = useState<Course[]>([]);
  const courses = mergeCourses(data?.courses, createdCourses);
  const formId = useId();
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  // o último curso e o último período usados (ou os da turma mais nova da lista)
  const [initial] = useState<ClassDraft>(() => {
    const last = readLastClass();
    const newest = [...(data?.classes ?? [])].sort((a, b) => b.id - a.id)[0];
    const today = new Date();
    const base: ClassDraft = {
      courseId: newest ? String(newest.courseId) : courses.length === 1 ? String(courses[0].id) : "",
      name: "",
      year: String(newest?.year ?? today.getFullYear()),
      semester: newest?.semester ? String(newest.semester) : newest ? "" : String(today.getMonth() < 6 ? 1 : 2),
      shift: newest?.shift ?? "",
      period: newest?.period ?? "",
    };
    const merged = { ...base, ...(last ?? {}), name: "" };
    // curso que não existe mais (arquivado): fica vazio
    if (data && merged.courseId && !courses.some((course) => String(course.id) === merged.courseId)) {
      merged.courseId = "";
    }
    return merged;
  });
  const draft = view.draft ?? initial;
  const form = useClassForm(draft, courses);
  const [working, setWorking] = useState(false);

  function change(next: ClassDraft) {
    form.edited(draft, next);
    api.setView({ ...view, draft: next, dirty: !sameDraft(next, initial) });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (working) {
      return;
    }
    if (!form.check()) {
      focusFirstError(formEl);
      return;
    }
    setWorking(true);
    api.setBusy(true);
    try {
      const created = await createClass(token, toInput(draft, form.integrated));
      writeLastClass(draft);
      api.changed({ catalog: true });
      api.setBusy(false);
      api.saved(`class-${created.id}`);
      toast(`Turma ${created.name} criada. Agora adicione as disciplinas e os alunos.`, {
        key: `turma-${created.id}`,
        action: { label: "Abrir turma", onClick: () => api.push({ kind: "class", classId: created.id }) },
      });
    } catch (error) {
      form.fromApi(error);
      focusFirstError(formEl);
    } finally {
      setWorking(false);
      api.setBusy(false);
    }
  }

  async function restore() {
    if (!form.archivedId) {
      return;
    }
    const id = form.archivedId;
    setWorking(true);
    api.setBusy(true);
    try {
      const restored = await restoreClass(token, id);
      api.changed({ catalog: true });
      toast(`Turma ${restored.name} restaurada. O código da turma continua desligado.`, { key: `turma-${id}` });
      api.replace({ kind: "class", classId: id });
    } catch (error) {
      handleRestoreError(error, id);
    } finally {
      setWorking(false);
      api.setBusy(false);
    }
  }

  function handleRestoreError(error: unknown, id: number) {
    const archivedCourse = conflictOf(error, "COURSE_ARCHIVED");
    if (archivedCourse?.courseId) {
      const courseId = archivedCourse.courseId;
      toast(archivedCourse.message, {
        tone: "danger",
        key: `turma-${id}`,
        action: {
          label: "Restaurar curso e turma",
          onClick: () => {
            void (async () => {
              try {
                await restoreCourse(token, courseId);
                await restoreClass(token, id);
                api.changed({ catalog: true });
                toast("Curso e turma restaurados.", { key: `turma-${id}` });
                api.replace({ kind: "class", classId: id });
              } catch (inner) {
                showError(inner, `turma-${id}`);
              }
            })();
          },
        },
      });
      return;
    }
    showError(error, `turma-${id}`);
  }

  return (
    <>
      <form ref={setFormEl} id={formId} className="admin-sec !pt-1" noValidate onSubmit={(event) => void save(event)}>
        <h3 className="sr-only" data-panel-start tabIndex={-1}>
          Dados da turma
        </h3>
        {form.errors.form ? (
          <p className="callout rose mb-4" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {form.errors.form}
          </p>
        ) : null}
        <ClassFields
          courses={courses}
          draft={draft}
          errors={form.errors}
          focusName={Boolean(draft.courseId)}
          restoreLabel={form.archivedId ? "Restaurar turma" : null}
          onBlurField={form.blur}
          onChange={change}
          onCourseCreated={(course) => {
            setCreatedCourses((current) => [...current, course]);
            api.changed({ catalog: true });
          }}
          onRestore={() => void restore()}
        />
        <p className="field-help mt-4">
          Depois de criar, abra a turma para adicionar as disciplinas, as docentes e os alunos.
        </p>
      </form>
      <PanelFooter api={api}>
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.close()} type="button">
          Cancelar
        </button>
        <button className={cx(primaryButton, busyLook)} aria-disabled={working || undefined} form={formId} type="submit">
          <Plus className="h-4 w-4" aria-hidden />
          Criar turma
        </button>
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
  const [createdCourses, setCreatedCourses] = useState<Course[]>([]);
  const courses = mergeCourses(data?.courses, createdCourses, [item?.course]);
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

  function change(next: ClassDraft) {
    if (!draft || !original) {
      return;
    }
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
      toast(`Turma ${restored.name} restaurada. O código da turma continua desligado; use Gerar novo para ligar.`, {
        key: `turma-${classId}`,
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
          }`,
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
          api.changed({ catalog: true });
          api.close();
          toast(`Turma ${item.name} excluída.`, { key: `turma-${id}` });
        } catch (error) {
          const blocked = conflictOf(error, "HAS_DEPENDENTS");
          if (blocked) {
            const what = dependentsText(blocked.counts);
            toast(
              what
                ? `Não dá para excluir: a turma tem ${what}. Arquive a turma em vez de excluir.`
                : blocked.message,
              { tone: "danger", key: `turma-${id}` }
            );
            refreshAll();
            return;
          }
          showError(error, `turma-${id}`);
        }
      },
    });
  }

  if (!item || !draft) {
    return (
      <>
        {detail.error ? (
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
          <button className={secondaryButton} onClick={() => api.back()} type="button">
            {api.canGoBack ? "Voltar" : "Fechar"}
          </button>
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

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span className="basis-full">{item.course?.name}</span>
        <span className="pill st-ag">{classTermLabel(item)}</span>
        {item.period ? <span className="pill st-ag">{item.period}</span> : null}
        {item.shift ? <span className="pill st-ag">{shiftLabels[item.shift as keyof typeof shiftLabels] ?? item.shift}</span> : null}
        {archived ? <span className="pill st-canc">Arquivada</span> : <span className="pill st-conc">Ativa</span>}
      </PanelSubtitle>

      {archived ? (
        <p className="callout amber mt-1">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Turma arquivada: fica só para consulta, e os eventos dela continuam no histórico. Restaure a turma para editar,
          ofertar disciplinas ou incluir alunos.
        </p>
      ) : null}

      {/* 1. Dados */}
      <form ref={setFormEl} id={formId} className="admin-sec" aria-labelledby={`${formId}-t`} noValidate onSubmit={(event) => void save(event)}>
        <div className="admin-sec-head">
          <h3 id={`${formId}-t`} className="admin-sec-t" data-panel-start tabIndex={-1}>
            Dados
          </h3>
        </div>
        {form.errors.form ? (
          <p className="callout rose mb-4" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {form.errors.form}
          </p>
        ) : null}
        <ClassFields
          courses={courses}
          disabled={archived}
          draft={draft}
          errors={form.errors}
          extraCourse={item.course}
          restoreLabel={form.archivedId ? "Restaurar turma" : null}
          onBlurField={form.blur}
          onChange={change}
          onCourseCreated={(course) => {
            setCreatedCourses((current) => [...current, course]);
            api.changed({ catalog: true });
          }}
          onRestore={() => {
            const target = form.archivedId;
            if (target) {
              void run("restore-other", () => restoreTo(target));
            }
          }}
        />
      </form>

      {/* 2. Disciplinas e docentes */}
      <OffersSection api={api} archived={archived} item={item} />

      {/* 3. Alunos */}
      <StudentsSection
        api={api}
        archived={archived}
        invites={invites.data}
        item={item}
        loadingError={students.error ?? invites.error}
        showAll={Boolean(view.showAll)}
        students={students.data}
        onChanged={() => refreshAll()}
        onRetry={() => {
          void students.reload();
          void invites.reload();
        }}
        onShowAll={(value) => api.setView({ ...view, showAll: value })}
        onShowCode={() => {
          setCodeShown(true);
          window.requestAnimationFrame(() => {
            const target = document.getElementById(`${formId}-codigo`);
            target?.scrollIntoView({ block: "nearest" });
            target?.focus({ preventScroll: true });
          });
        }}
      />

      {/* 4. Código da turma */}
      <CodeSection
        archived={archived}
        headingId={`${formId}-codigo`}
        item={item}
        shown={codeShown}
        working={working}
        onRun={run}
        onShown={setCodeShown}
        onUpdated={() => void detail.reload()}
      />

      <PanelFooter api={api}>
        <p className="admin-foot-note">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {archived
            ? "Restaurar devolve a turma aos seletores. O código continua desligado até você gerar um novo."
            : future
              ? future === 1
                ? "Ao arquivar, o evento futuro continua visível, sem lembretes."
                : `Ao arquivar, os ${future} eventos futuros continuam visíveis, sem lembretes.`
              : "Ao arquivar, a turma sai dos seletores e o código é desligado. Dá para restaurar depois."}
        </p>
        {archived ? (
          <button
            className={cx(secondaryButton, busyLook)}
            aria-disabled={busy || undefined}
            onClick={() => void run("restore", () => restoreTo(id))}
            type="button"
          >
            <ArchiveRestore className="h-4 w-4" aria-hidden />
            Restaurar turma
          </button>
        ) : (
          <button className={cx(secondaryButton, busyLook)} aria-disabled={busy || undefined} onClick={() => void archive()} type="button">
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
              <button className={secondaryButton} onClick={() => api.close()} type="button">
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
          <h3 id={headingId} className="admin-sec-t">
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
                    <span className="pill admin-pill-warn">
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
                        <span className="pill admin-pill-wt">{teachingRoleLabels[teacher.role] ?? teacher.role}</span>
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
            <Plus className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Turma sem disciplinas</p>
            <p className="mt-0.5 text-sm leading-5 text-muted">
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
  invites,
  item,
  loadingError,
  showAll,
  students,
  onChanged,
  onRetry,
  onShowAll,
  onShowCode,
}: {
  api: PanelApi;
  archived: boolean;
  invites: ClassInvite[] | null;
  item: ClassDetail;
  loadingError: unknown;
  showAll: boolean;
  students: ClassStudent[] | null;
  onChanged: () => void;
  onRetry: () => void;
  onShowAll: (value: boolean) => void;
  onShowCode: () => void;
}) {
  const { token, toast, showError } = useAppActions();
  const headingId = useId();
  const [selected, setSelected] = useState<number[]>([]);
  const [working, setWorking] = useState<string | null>(null);

  const list = students ?? [];
  const pending = list.filter((student) => student.status === "pending");
  const active = list.filter((student) => student.status === "active");
  const others = list.filter((student) => student.status === "inactive" || student.status === "completed");
  const combined = [...pending, ...active];
  const shown = showAll ? combined : combined.slice(0, STUDENT_LIMIT);
  const shownPending = shown.filter((student) => student.status === "pending");
  const shownActive = shown.filter((student) => student.status === "active");
  const inviteList = invites ?? [];
  const shownInvites = showAll ? inviteList : inviteList.slice(0, INVITE_LIMIT);
  const hiddenCount = combined.length - shown.length + (showAll ? 0 : others.length) + (inviteList.length - shownInvites.length);
  const selectedPending = selected.filter((id) => pending.some((student) => student.enrollmentId === id));
  const allSelected = shownPending.length > 0 && shownPending.every((student) => selected.includes(student.enrollmentId));

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

  async function setStatus(student: ClassStudent, status: "active" | "inactive" | "pending") {
    await updateEnrollment(token, student.enrollmentId, { status });
  }

  function decide(student: ClassStudent, status: "active" | "inactive") {
    const name = student.fullName ?? student.email;
    void run(`decide-${student.enrollmentId}`, async () => {
      try {
        await setStatus(student, status);
        setSelected((current) => current.filter((id) => id !== student.enrollmentId));
        onChanged();
        toast(status === "active" ? `${name} entrou na ${item.name}.` : `Pedido de ${name} recusado.`, {
          key: `matricula-${student.enrollmentId}`,
          undo: async () => {
            try {
              await setStatus(student, "pending");
              onChanged();
            } catch (error) {
              showError(error, `matricula-${student.enrollmentId}`);
            }
          },
        });
      } catch (error) {
        showError(error, `matricula-${student.enrollmentId}`);
      }
    });
  }

  function approveSelected() {
    const ids = selectedPending;
    if (!ids.length) {
      return;
    }
    void run("bulk", async () => {
      try {
        const result = await decideEnrollments(token, item.id, ids, "active");
        const approved = ids.filter((id) => !result.skipped.includes(id));
        setSelected([]);
        onChanged();
        toast(
          `${plural(result.updated, "pedido aprovado", "pedidos aprovados")}${
            result.skipped.length ? `; ${plural(result.skipped.length, "já tinha sido decidido", "já tinham sido decididos")}` : ""
          }.`,
          {
            key: `turma-${item.id}-lote`,
            undo: approved.length
              ? async () => {
                  try {
                    await Promise.all(approved.map((id) => updateEnrollment(token, id, { status: "pending" })));
                    onChanged();
                  } catch (error) {
                    showError(error, `turma-${item.id}-lote`);
                  }
                }
              : undefined,
          }
        );
      } catch (error) {
        showError(error, `turma-${item.id}-lote`);
      }
    });
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
              onChanged();
            } catch (error) {
              showError(error, `convite-${invite.id}`);
            }
          },
        });
      } catch (error) {
        showError(error, `convite-${invite.id}`);
      }
    });
  }

  const summary = [
    plural(active.length, "ativo", "ativos"),
    pending.length ? plural(pending.length, "pedido de entrada", "pedidos de entrada") : null,
    inviteList.length ? plural(inviteList.length, "convite", "convites") : null,
  ]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]*)$/, " e $1");

  const busyAttr = working !== null || undefined;

  return (
    <section className="admin-sec" aria-labelledby={headingId} aria-busy={students === null || undefined}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-sec-t">
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
      ) : !list.length && !inviteList.length ? (
        <div className="empty-inline compact">
          <span className="empty-ico">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Turma sem alunos</p>
            <p className="mt-0.5 text-sm leading-5 text-muted">
              {archived
                ? "A turma arquivada não recebe alunos."
                : "Cole a lista de e-mails da turma ou passe o código para os alunos pedirem para entrar."}
            </p>
            {!archived ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  className={cx(secondaryButton, "btn-sm")}
                  onClick={() => api.push({ kind: "addStudents", classId: item.id }, "add-students")}
                  type="button"
                >
                  Adicionar alunos
                </button>
                <button className={cx(secondaryButton, "btn-sm")} onClick={onShowCode} type="button">
                  Mostrar código
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {shownPending.length ? (
            <>
              <p className="admin-group">Pedidos de entrada ({pending.length})</p>
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
                            onClick={() => decide(student, "active")}
                            type="button"
                          >
                            Aprovar
                          </button>
                          <button
                            className={cx(secondaryButton, "btn-sm", busyLook)}
                            aria-disabled={busyAttr}
                            aria-label={`Recusar ${name}`}
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

          {shownActive.length ? (
            <>
              <p className="admin-group">Alunos ativos ({active.length})</p>
              <ul className="admin-people">
                {shownActive.map((student) => (
                  <li key={student.enrollmentId}>
                    <StudentRow api={api} classId={item.id} student={student} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {showAll && others.length ? (
            <>
              <p className="admin-group">Saíram ou concluíram ({others.length})</p>
              <ul className="admin-people">
                {others.map((student) => (
                  <li key={student.enrollmentId}>
                    <StudentRow api={api} classId={item.id} student={student} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {shownInvites.length ? (
            <>
              <p className="admin-group">Convites pendentes ({inviteList.length})</p>
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

          {hiddenCount > 0 || showAll ? (
            <div className="admin-list-foot">
              <button className="link" aria-expanded={showAll} onClick={() => onShowAll(!showAll)} type="button">
                {showAll ? "Mostrar menos" : `Ver todos (${list.length + inviteList.length})`}
                <ArrowRight className={cx("h-[15px] w-[15px]", showAll && "-rotate-90")} aria-hidden />
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

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
          {student.status !== "active" ? `, ${student.status === "completed" ? "concluiu" : "inativo"}` : ""}
        </span>
      </span>
      {student.isMinor ? <span className="pill st-ag">Menor</span> : null}
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
  headingId,
  item,
  shown,
  working,
  onRun,
  onShown,
  onUpdated,
}: {
  archived: boolean;
  headingId: string;
  item: ClassDetail;
  shown: boolean;
  working: string | null;
  onRun: (key: string, task: () => Promise<void>) => Promise<void>;
  onShown: (value: boolean) => void;
  onUpdated: () => void;
}) {
  const { token, toast, showError } = useAppActions();
  const on = item.joinCodeActive && !archived;
  const code = item.joinCodeFormatted ?? (item.joinCode ? normalizeCode(item.joinCode) : null);
  const busy = working !== null || undefined;

  function generate() {
    void onRun("code-new", async () => {
      try {
        await createJoinCode(token, item.id);
        onUpdated();
        onShown(true);
        toast(on ? "Código novo gerado. O código antigo parou de valer." : "Código da turma ligado.", { key: `codigo-${item.id}` });
      } catch (error) {
        showError(error, `codigo-${item.id}`);
      }
    });
  }

  function disable() {
    void onRun("code-off", async () => {
      try {
        await disableJoinCode(token, item.id);
        onUpdated();
        onShown(false);
        toast("Código da turma desligado. Ninguém pede para entrar com ele até você gerar um novo.", { key: `codigo-${item.id}` });
      } catch (error) {
        showError(error, `codigo-${item.id}`);
      }
    });
  }

  return (
    <section className="admin-sec" aria-labelledby={headingId}>
      <div className="admin-sec-head">
        <div className="min-w-0">
          <h3 id={headingId} className="admin-sec-t" tabIndex={-1}>
            Código da turma
          </h3>
          <p className="admin-sec-s">Quem tem o código pede para entrar, e o pedido aparece em Alunos.</p>
        </div>
        <span className={cx("pill", on ? "st-conc" : "st-ag")}>{on ? "Ligado" : "Desligado"}</span>
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
            <button className={cx(secondaryButton, "btn-sm", busyLook)} aria-disabled={busy} onClick={generate} type="button">
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
