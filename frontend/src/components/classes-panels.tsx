"use client";

import { Archive, ArchiveRestore, Check, CircleAlert, Info, Plus, Search, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import {
  addClassStudentsByEmail,
  addClassSubject,
  archiveClassSubject,
  archiveSubject,
  assignTeacher,
  conflictOf,
  createSubject,
  deleteClassSubject,
  deleteSubject,
  endTeachingAssignment,
  getClass,
  restoreSubject,
  searchUsers,
  updateSubject,
  updateTeachingAssignment,
} from "@/lib/api";
import { classLabel, cx, errorMessage, fieldErrors, normalizeText } from "@/lib/format";
import { teachingRoleLabels } from "@/lib/meta";
import type { AddStudentsResult, ClassDetail, ClassOffer, Subject, TeachingRole, UserSummary } from "@/lib/types";
import { useAppActions } from "./app-actions";
import { PanelSubtitle, type PanelProps } from "./classes-class-panel";
import {
  PanelFooter,
  SkeletonRows,
  dependentsText,
  initialsOf,
  joinPt,
  parseEmails,
  plural,
  useDebounced,
  useRemote,
  type PanelApi,
  type SubjectDraft,
} from "./classes-shared";
import { EmptyState, ErrorState, Field, Segmented, SegmentedButton, primaryButton, secondaryButton } from "./ui";

const busyLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-55";
const MAX_EMAILS = 200;

/** Ação do painel com o painel ocupado (Esc e o X não fecham no meio dela). */
function useWorking(api: PanelApi) {
  const [working, setWorking] = useState<string | null>(null);
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
  return { working, run, busy: working !== null };
}

/* ------------------------------------------------------------------ */
/* Disciplina (criar e editar)                                         */
/* ------------------------------------------------------------------ */

type SubjectErrors = Partial<Record<keyof SubjectDraft | "form", string>>;

const emptySubject: SubjectDraft = { code: "", name: "", workloadHours: "80" };

function draftFromSubject(subject: Subject): SubjectDraft {
  return { code: subject.code, name: subject.name, workloadHours: String(subject.workloadHours ?? 80) };
}

function sameSubject(a: SubjectDraft, b: SubjectDraft) {
  return a.code.trim() === b.code.trim() && a.name.trim() === b.name.trim() && a.workloadHours.trim() === b.workloadHours.trim();
}

function validateSubject(draft: SubjectDraft): SubjectErrors {
  const errors: SubjectErrors = {};
  const name = draft.name.trim();
  if (name.length < 2) {
    errors.name = "Escreva o nome da disciplina, com pelo menos 2 caracteres. Ex.: Banco de Dados.";
  } else if (name.length > 80) {
    errors.name = "Use até 80 caracteres no nome da disciplina.";
  }
  if (!/^[A-Z0-9-]{2,12}$/.test(draft.code.trim().toUpperCase())) {
    errors.code = "Use de 2 a 12 letras, números ou hífen no código. Ex.: BD-401.";
  }
  const hours = Number(draft.workloadHours);
  if (!/^\d+$/.test(draft.workloadHours.trim()) || hours < 1 || hours > 2000) {
    errors.workloadHours = "Digite a carga horária em horas, de 1 a 2000. Ex.: 80.";
  }
  return errors;
}

function subjectInput(draft: SubjectDraft) {
  return { code: draft.code.trim().toUpperCase(), name: draft.name.trim(), workloadHours: Number(draft.workloadHours) };
}

function SubjectFields({
  disabled,
  draft,
  errors,
  restoreLabel,
  onChange,
  onBlurField,
  onRestore,
}: {
  disabled?: boolean;
  draft: SubjectDraft;
  errors: SubjectErrors;
  restoreLabel?: string | null;
  onChange: (draft: SubjectDraft) => void;
  onBlurField: (field: keyof SubjectDraft) => void;
  onRestore?: () => void;
}) {
  return (
    <div className="admin-grid">
      <div className="admin-span6">
        <Field label="Nome da disciplina" error={errors.name}>
          <input
            className="input"
            autoComplete="off"
            data-panel-focus={disabled ? undefined : ""}
            disabled={disabled}
            maxLength={80}
            placeholder="Ex.: Banco de Dados"
            value={draft.name}
            onBlur={() => onBlurField("name")}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </Field>
      </div>
      <div className="admin-span3">
        <Field label="Código" hint="letras, números e hífen" error={errors.code}>
          <input
            className="input admin-mono"
            autoCapitalize="characters"
            autoComplete="off"
            disabled={disabled}
            maxLength={12}
            placeholder="Ex.: BD-401"
            value={draft.code}
            onBlur={() => onBlurField("code")}
            onChange={(event) => onChange({ ...draft, code: event.target.value.toUpperCase() })}
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
        <Field label="Carga horária" hint="em horas" error={errors.workloadHours}>
          <input
            className="input"
            disabled={disabled}
            inputMode="numeric"
            maxLength={4}
            value={draft.workloadHours}
            onBlur={() => onBlurField("workloadHours")}
            onChange={(event) => onChange({ ...draft, workloadHours: event.target.value.replace(/\D/g, "") })}
          />
        </Field>
      </div>
    </div>
  );
}

function useSubjectForm(draft: SubjectDraft | null) {
  const [errors, setErrors] = useState<SubjectErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof SubjectDraft, boolean>>>({});
  const [archivedId, setArchivedId] = useState<number | null>(null);

  return {
    errors,
    archivedId,
    blur(field: keyof SubjectDraft) {
      if (draft && touched[field]) {
        const found = validateSubject(draft);
        setErrors((current) => ({ ...current, [field]: found[field] }));
      }
    },
    edited(previous: SubjectDraft, next: SubjectDraft) {
      const found = validateSubject(next);
      const marks = { ...touched };
      const cleared = { ...errors };
      for (const key of Object.keys(next) as Array<keyof SubjectDraft>) {
        if (next[key] !== previous[key]) {
          marks[key] = true;
          if (cleared[key] && !found[key]) {
            delete cleared[key];
          }
        }
      }
      if (next.code !== previous.code) {
        setArchivedId(null);
      }
      setTouched(marks);
      setErrors(cleared);
    },
    check() {
      if (!draft) {
        return false;
      }
      const found = validateSubject(draft);
      setErrors(found);
      setArchivedId(null);
      return Object.keys(found).length === 0;
    },
    fromApi(error: unknown) {
      const duplicate = conflictOf(error, "ARCHIVED_DUPLICATE");
      if (duplicate) {
        setErrors({ code: duplicate.message });
        setArchivedId(duplicate.archivedId ?? null);
        return;
      }
      const byField = fieldErrors(error) as SubjectErrors;
      setErrors(Object.keys(byField).length ? byField : { form: errorMessage(error) });
      setArchivedId(null);
    },
  };
}

function focusFirstError(root: HTMLElement | null) {
  window.requestAnimationFrame(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

function warningsText(warnings: string[] | undefined) {
  return warnings?.length ? ` ${warnings.join(" ")}` : "";
}

export function NewSubjectPanel({ api, data, subtitle, view }: PanelProps<"newSubject">) {
  const { token, toast, showError } = useAppActions();
  const formId = useId();
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const draft = view.draft ?? emptySubject;
  const form = useSubjectForm(draft);
  const { working, run } = useWorking(api);
  const offerClass = view.offerTo
    ? (data?.classes.find((item) => item.id === view.offerTo) ?? null)
    : null;

  function change(next: SubjectDraft) {
    form.edited(draft, next);
    api.setView({ ...view, draft: next, dirty: !sameSubject(next, emptySubject) });
  }

  /** Disciplina pronta: oferta na turma (se veio de lá) e volta, ou fecha e mostra a linha. */
  async function finish(subject: Subject, verb: string, warnings?: string[]) {
    if (view.offerTo) {
      try {
        await addClassSubject(token, view.offerTo, subject.id);
        api.changed({ catalog: true });
        toast(
          `Disciplina ${subject.name} ${verb} e adicionada à ${offerClass?.name ?? "turma"}.${warningsText(warnings)}`,
          { key: `disciplina-${subject.id}` }
        );
      } catch (error) {
        api.changed({ catalog: true });
        showError(error, `disciplina-${subject.id}`);
      }
      api.back();
      return;
    }
    api.changed({ catalog: true });
    api.saved(`subject-${subject.id}`);
    toast(`Disciplina ${subject.name} ${verb}.${warningsText(warnings)}`, {
      key: `disciplina-${subject.id}`,
      tone: warnings?.length ? "info" : "success",
    });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!form.check()) {
      focusFirstError(formEl);
      return;
    }
    await run("save", async () => {
      try {
        const result = await createSubject(token, subjectInput(draft));
        await finish(result.data, "criada", result.warnings);
      } catch (error) {
        form.fromApi(error);
        focusFirstError(formEl);
      }
    });
  }

  function restore() {
    const id = form.archivedId;
    if (!id) {
      return;
    }
    void run("restore", async () => {
      try {
        const subject = await restoreSubject(token, id);
        if (view.offerTo) {
          await finish(subject, "restaurada");
        } else {
          api.changed({ catalog: true });
          toast(`Disciplina ${subject.name} restaurada.`, { key: `disciplina-${id}` });
          api.replace({ kind: "subject", subjectId: id });
        }
      } catch (error) {
        showError(error, `disciplina-${id}`);
      }
    });
  }

  return (
    <>
      {offerClass ? (
        <PanelSubtitle node={subtitle}>
          <span>Entra na {classLabel(offerClass)} ao criar</span>
        </PanelSubtitle>
      ) : null}
      <form ref={setFormEl} id={formId} className="admin-sec !pt-1" noValidate onSubmit={(event) => void save(event)}>
        <h3 className="sr-only" data-panel-start tabIndex={-1}>
          Dados da disciplina
        </h3>
        {form.errors.form ? (
          <p className="callout rose mb-4" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {form.errors.form}
          </p>
        ) : null}
        <SubjectFields
          draft={draft}
          errors={form.errors}
          restoreLabel={form.archivedId ? "Restaurar disciplina" : null}
          onBlurField={form.blur}
          onChange={change}
          onRestore={restore}
        />
        {view.offerTo ? (
          <p className="field-help mt-4">Depois de criar, a disciplina já entra na turma e você volta para ela.</p>
        ) : null}
      </form>
      <PanelFooter api={api}>
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.back()} type="button">
          {api.canGoBack ? "Voltar" : "Cancelar"}
        </button>
        <button className={cx(primaryButton, busyLook)} aria-disabled={working !== null || undefined} form={formId} type="submit">
          <Plus className="h-4 w-4" aria-hidden />
          {view.offerTo ? "Criar e adicionar" : "Criar disciplina"}
        </button>
      </PanelFooter>
    </>
  );
}

export function SubjectPanel({ api, data, subtitle, view }: PanelProps<"subject">) {
  const { token, toast, showError, confirm } = useAppActions();
  const formId = useId();
  const [formEl, setFormEl] = useState<HTMLFormElement | null>(null);
  const subject =
    data?.subjects.find((item) => item.id === view.subjectId) ??
    data?.archivedSubjects.find((item) => item.id === view.subjectId) ??
    null;
  const original = subject ? draftFromSubject(subject) : null;
  const draft = view.draft ?? original;
  const form = useSubjectForm(draft);
  const { busy, run } = useWorking(api);
  const archived = Boolean(subject?.archivedAt);

  if (!subject || !draft || !original) {
    return (
      <>
        {data ? (
          <EmptyState icon={Info} text="Disciplina não encontrada" hint="Ela pode ter sido excluída. Volte para a lista." />
        ) : (
          <SkeletonRows rows={3} label="Carregando a disciplina" />
        )}
        <h3 className="sr-only" data-panel-start tabIndex={-1}>
          Disciplina
        </h3>
        <PanelFooter api={api}>
          <span className="admin-foot-gap" />
          <button className={secondaryButton} onClick={() => api.back()} type="button">
            Fechar
          </button>
        </PanelFooter>
      </>
    );
  }

  const current = subject;
  const dirty = Boolean(view.dirty) && !archived;
  const used = current.usedIn ?? 0;

  function change(next: SubjectDraft) {
    if (!draft || !original) {
      return;
    }
    form.edited(draft, next);
    api.setView({ ...view, draft: next, dirty: !sameSubject(next, original) });
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!draft || !original) {
      return;
    }
    if (sameSubject(draft, original)) {
      api.close();
      return;
    }
    if (!form.check()) {
      focusFirstError(formEl);
      return;
    }
    await run("save", async () => {
      try {
        const result = await updateSubject(token, current.id, subjectInput(draft));
        api.changed({ catalog: true });
        api.saved(`subject-${current.id}`);
        toast(`Disciplina ${result.data.name} salva.${warningsText(result.warnings)}`, {
          key: `disciplina-${current.id}`,
          tone: result.warnings?.length ? "info" : "success",
        });
      } catch (error) {
        if (conflictOf(error, "ARCHIVED")) {
          showError(error, `disciplina-${current.id}`);
          api.changed();
          return;
        }
        form.fromApi(error);
        focusFirstError(formEl);
      }
    });
  }

  async function restoreNow() {
    try {
      await restoreSubject(token, current.id);
      api.changed({ catalog: true });
      toast(`Disciplina ${current.name} restaurada.`, { key: `disciplina-${current.id}` });
    } catch (error) {
      showError(error, `disciplina-${current.id}`);
    }
  }

  function archive() {
    void run("archive", async () => {
      try {
        await archiveSubject(token, current.id);
        api.setView({ ...view, draft: undefined, dirty: false });
        api.changed({ catalog: true });
        toast(`Disciplina ${current.name} arquivada.`, { key: `disciplina-${current.id}`, undo: restoreNow });
      } catch (error) {
        showError(error, `disciplina-${current.id}`);
      }
    });
  }

  function remove() {
    confirm({
      title: `Excluir a disciplina ${current.name}?`,
      message: "Ela não está em nenhuma turma e sai do sistema. Não dá para desfazer.",
      confirmLabel: "Excluir disciplina",
      cancelLabel: "Manter disciplina",
      action: async () => {
        try {
          await deleteSubject(token, current.id);
          api.changed({ catalog: true });
          api.close();
          toast(`Disciplina ${current.name} excluída.`, { key: `disciplina-${current.id}` });
        } catch (error) {
          const blocked = conflictOf(error, "HAS_DEPENDENTS");
          if (blocked) {
            const what = dependentsText(blocked.counts);
            toast(
              what ? `Não dá para excluir: a disciplina tem ${what}. Arquive a disciplina em vez de excluir.` : blocked.message,
              { tone: "danger", key: `disciplina-${current.id}` }
            );
            return;
          }
          showError(error, `disciplina-${current.id}`);
        }
      },
    });
  }

  function restoreOther() {
    const id = form.archivedId;
    if (!id) {
      return;
    }
    void run("restore-other", async () => {
      try {
        const restored = await restoreSubject(token, id);
        api.changed({ catalog: true });
        toast(`Disciplina ${restored.name} restaurada.`, { key: `disciplina-${id}` });
        api.replace({ kind: "subject", subjectId: id });
      } catch (error) {
        showError(error, `disciplina-${id}`);
      }
    });
  }

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span className="admin-code">{current.code}</span>
        {archived ? <span className="pill st-canc">Arquivada</span> : <span className="pill st-conc">Ativa</span>}
        {!archived ? <span>{used ? `usada em ${plural(used, "turma", "turmas")}` : "ainda sem turma"}</span> : null}
      </PanelSubtitle>
      {archived ? (
        <p className="callout amber mt-1">
          <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Disciplina arquivada: fica fora dos seletores de oferta e de evento novo. Restaure para ofertar de novo.
        </p>
      ) : null}
      <form ref={setFormEl} id={formId} className="admin-sec" noValidate onSubmit={(event) => void save(event)}>
        <div className="admin-sec-head">
          <h3 className="admin-sec-t" data-panel-start tabIndex={-1}>
            Dados
          </h3>
        </div>
        {form.errors.form ? (
          <p className="callout rose mb-4" role="alert">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {form.errors.form}
          </p>
        ) : null}
        <SubjectFields
          disabled={archived}
          draft={archived ? original : draft}
          errors={form.errors}
          restoreLabel={form.archivedId ? "Restaurar disciplina" : null}
          onBlurField={form.blur}
          onChange={change}
          onRestore={restoreOther}
        />
      </form>
      <PanelFooter api={api}>
        <p className="admin-foot-note">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {archived
            ? "Restaurar devolve a disciplina aos seletores."
            : used
              ? `Usada em ${plural(used, "turma", "turmas")}. Ao arquivar, as ofertas e os eventos que já existem ficam como estão.`
              : "Ao arquivar, ela sai dos seletores de oferta e de evento novo. Dá para restaurar depois."}
        </p>
        {archived ? (
          <button
            className={cx(secondaryButton, busyLook)}
            aria-disabled={busy || undefined}
            onClick={() => void run("restore", restoreNow)}
            type="button"
          >
            <ArchiveRestore className="h-4 w-4" aria-hidden />
            Restaurar disciplina
          </button>
        ) : (
          <button className={cx(secondaryButton, busyLook)} aria-disabled={busy || undefined} onClick={archive} type="button">
            <Archive className="h-4 w-4" aria-hidden />
            Arquivar
          </button>
        )}
        {!used ? (
          <button className={cx("btn btn-danger", busyLook)} aria-disabled={busy || undefined} onClick={remove} type="button">
            <Trash2 className="h-4 w-4" aria-hidden />
            Excluir
          </button>
        ) : null}
        <span className="admin-foot-gap" />
        {dirty ? (
          <>
            <button className={secondaryButton} onClick={() => api.close()} type="button">
              Cancelar
            </button>
            <button className={cx(primaryButton, busyLook)} aria-disabled={busy || undefined} form={formId} type="submit">
              Salvar alterações
            </button>
          </>
        ) : (
          <button className={secondaryButton} onClick={() => api.close()} type="button">
            Fechar
          </button>
        )}
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Adicionar disciplina à turma                                        */
/* ------------------------------------------------------------------ */

function ClassSubtitle({ node, item }: { node: HTMLElement | null; item: ClassDetail | null }) {
  return item ? (
    <PanelSubtitle node={node}>
      <span>
        {classLabel(item)}
        {item.course ? `, ${item.course.code}` : ""}
      </span>
    </PanelSubtitle>
  ) : null;
}

export function AddOfferPanel({ api, data, subtitle, view }: PanelProps<"addOffer">) {
  const { token, toast, showError } = useAppActions();
  const detail = useRemote(`admin:turma:${view.classId}`, () => getClass(token, view.classId));
  const [filter, setFilter] = useState("");
  const { working, run } = useWorking(api);
  const item = detail.data;
  const offered = new Set((item?.offers ?? []).filter((offer) => !offer.archivedAt).map((offer) => offer.subjectId));
  const words = normalizeText(filter).split(/\s+/).filter(Boolean);
  const subjects = data?.subjects ?? [];
  const available = subjects.filter(
    (subject) =>
      !offered.has(subject.id) &&
      words.every((word) => normalizeText(`${subject.name} ${subject.code}`).includes(word))
  );
  const inClass = subjects.filter((subject) => offered.has(subject.id));
  const added = view.added ?? [];

  function add(subject: Subject) {
    if (!item) {
      return;
    }
    const className = item.name;
    void run(`add-${subject.id}`, async () => {
      try {
        const offer = await addClassSubject(token, view.classId, subject.id);
        api.setView({ ...view, added: [...added, subject.id] });
        void detail.reload();
        api.changed({ catalog: true });
        toast(
          offer.restored ? `${subject.name} voltou para a ${className}.` : `${subject.name} adicionada à ${className}.`,
          {
            key: `oferta-${view.classId}-${subject.id}`,
            undo: async () => {
              try {
                if (offer.restored) {
                  await archiveClassSubject(token, view.classId, subject.id);
                } else {
                  await deleteClassSubject(token, view.classId, subject.id);
                }
                void detail.reload();
                api.changed({ catalog: true });
              } catch (error) {
                showError(error, `oferta-${view.classId}-${subject.id}`);
              }
            },
          }
        );
      } catch (error) {
        showError(error, `oferta-${view.classId}-${subject.id}`);
      }
    });
  }

  const newSubject = () => api.push({ kind: "newSubject", offerTo: view.classId }, "new-subject");

  return (
    <>
      <ClassSubtitle node={subtitle} item={item} />
      <div className="admin-sec !pt-1">
        <div className="admin-sec-head">
          <div className="min-w-0">
            <h3 className="admin-sec-t" data-panel-start tabIndex={-1}>
              Disciplinas cadastradas
            </h3>
            <p className="admin-sec-s">Escolha a disciplina que a turma vai ter. A docente você vincula depois.</p>
          </div>
          <button className={cx(secondaryButton, "btn-sm")} data-return="new-subject" onClick={newSubject} type="button">
            <Plus className="h-4 w-4" aria-hidden />
            Nova disciplina
          </button>
        </div>
        <Field label="Filtrar disciplinas">
          <input
            className="input"
            autoComplete="off"
            data-panel-focus=""
            placeholder="Nome ou código"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </Field>

        {!item || !data ? (
          detail.error ? (
            <div className="mt-4">
              <ErrorState title="Não deu para abrir a turma" text={errorMessage(detail.error)} onRetry={() => void detail.reload()} />
            </div>
          ) : (
            <div className="mt-4">
              <SkeletonRows rows={4} label="Carregando as disciplinas" />
            </div>
          )
        ) : available.length ? (
          <ul className="admin-people mt-3" aria-label="Disciplinas que dá para adicionar">
            {available.map((subject) => (
              <li key={subject.id} className="admin-irow">
                <span className="admin-s-main">
                  <span className="admin-s-name">{subject.name}</span>
                  <span className="admin-d-s">
                    <span className="admin-code">{subject.code}</span>
                    {subject.usedIn ? `usada em ${plural(subject.usedIn, "turma", "turmas")}` : "ainda sem turma"}
                  </span>
                </span>
                <button
                  className={cx(secondaryButton, "btn-sm", busyLook)}
                  aria-disabled={working !== null || undefined}
                  aria-label={`Adicionar ${subject.name} à ${item.name}`}
                  onClick={() => add(subject)}
                  type="button"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Adicionar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              compact
              icon={words.length ? Search : Check}
              text={
                words.length
                  ? `Nenhuma disciplina com "${filter.trim()}"`
                  : subjects.length
                    ? "Todas as disciplinas já estão na turma"
                    : "Nenhuma disciplina cadastrada"
              }
              hint="Cadastre a disciplina que falta: ela já entra nesta turma."
              action={{ label: "Nova disciplina", onClick: newSubject }}
            />
          </div>
        )}

        {item && inClass.length ? (
          <>
            <p className="admin-group mt-5">Já na turma ({inClass.length})</p>
            <p className="text-sm leading-6 text-ink-3">
              {joinPt(inClass.map((subject) => (added.includes(subject.id) ? `${subject.name} (agora)` : subject.name)))}
            </p>
          </>
        ) : null}
      </div>
      <PanelFooter api={api}>
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.back()} type="button">
          Voltar para a turma
        </button>
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Vincular docente (oferta da turma)                                  */
/* ------------------------------------------------------------------ */

export function OfferPanel({ api, subtitle, view }: PanelProps<"offer">) {
  const { token, toast, showError } = useAppActions();
  const detail = useRemote(`admin:turma:${view.classId}`, () => getClass(token, view.classId));
  const item = detail.data;
  const offer: ClassOffer | null = item?.offers.find((entry) => entry.subjectId === view.subjectId && !entry.archivedAt) ?? null;
  const [query, setQuery] = useState("");
  const settled = useDebounced(query.trim(), 300);
  const teachers = useRemote<UserSummary[]>(`admin:docentes:${normalizeText(settled)}`, () =>
    searchUsers(token, { role: "teacher", q: settled || undefined })
  );
  const [roleChoice, setRoleChoice] = useState<TeachingRole | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { working, run } = useWorking(api);
  const searchId = useId();
  const busyAttr = working !== null || undefined;

  if (!item || !offer) {
    return (
      <>
        <h3 className="sr-only" data-panel-start tabIndex={-1}>
          Vincular docente
        </h3>
        {detail.error ? (
          <ErrorState title="Não deu para abrir a turma" text={errorMessage(detail.error)} onRetry={() => void detail.reload()} />
        ) : item ? (
          <EmptyState icon={Info} text="Esta disciplina não está mais na turma" hint="Volte para a turma e confira as disciplinas." />
        ) : (
          <SkeletonRows rows={3} label="Carregando a disciplina" />
        )}
        <PanelFooter api={api}>
          <span className="admin-foot-gap" />
          <button className={secondaryButton} onClick={() => api.back()} type="button">
            Voltar para a turma
          </button>
        </PanelFooter>
      </>
    );
  }

  const current = offer;
  const klass = item;
  const role: TeachingRole = roleChoice ?? (current.teachers.length ? "substituto" : "titular");
  const linkedIds = new Set(current.teachers.map((teacher) => teacher.teacherId));
  const results = (teachers.data ?? []).filter((person) => !linkedIds.has(person.id));
  const where = `${current.subject.name} na ${klass.name}`;

  function refresh() {
    void detail.reload();
    api.changed({ catalog: true });
  }

  function link(person: UserSummary) {
    const name = person.fullName ?? person.email;
    setSearchError(null);
    void run(`link-${person.id}`, async () => {
      try {
        const assignment = await assignTeacher(token, klass.id, current.subjectId, { teacherId: person.id, role });
        refresh();
        toast(`${name} agora dá aula de ${where}, como ${teachingRoleLabels[role].toLowerCase()}.`, {
          key: `docente-${klass.id}-${current.subjectId}-${person.id}`,
          undo: async () => {
            try {
              await endTeachingAssignment(token, assignment.id);
              refresh();
            } catch (error) {
              showError(error, `docente-${klass.id}-${current.subjectId}-${person.id}`);
            }
          },
        });
        api.back();
      } catch (error) {
        const byField = fieldErrors(error);
        if (byField.teacherId) {
          setSearchError(byField.teacherId);
          return;
        }
        showError(error, `docente-${klass.id}-${current.subjectId}`);
      }
    });
  }

  function changeRole(assignmentId: number, name: string, from: TeachingRole, to: TeachingRole) {
    if (from === to) {
      return;
    }
    void run(`role-${assignmentId}`, async () => {
      try {
        await updateTeachingAssignment(token, assignmentId, to);
        refresh();
        toast(`${name} agora é ${teachingRoleLabels[to].toLowerCase()} em ${current.subject.name}.`, {
          key: `vinculo-${assignmentId}`,
          undo: async () => {
            try {
              await updateTeachingAssignment(token, assignmentId, from);
              refresh();
            } catch (error) {
              showError(error, `vinculo-${assignmentId}`);
            }
          },
        });
      } catch (error) {
        showError(error, `vinculo-${assignmentId}`);
      }
    });
  }

  function unlink(assignmentId: number, teacherId: number, name: string, teacherRole: TeachingRole) {
    void run(`end-${assignmentId}`, async () => {
      try {
        await endTeachingAssignment(token, assignmentId);
        refresh();
        toast(`${name} não dá mais aula de ${where}. Os eventos já publicados continuam.`, {
          key: `vinculo-${assignmentId}`,
          undo: async () => {
            try {
              await assignTeacher(token, klass.id, current.subjectId, { teacherId, role: teacherRole });
              refresh();
            } catch (error) {
              showError(error, `vinculo-${assignmentId}`);
            }
          },
        });
      } catch (error) {
        showError(error, `vinculo-${assignmentId}`);
      }
    });
  }

  function archiveOffer() {
    const previous = current.teachers.map((teacher) => ({ teacherId: teacher.teacherId, role: teacher.role }));
    void run("archive", async () => {
      try {
        const result = await archiveClassSubject(token, klass.id, current.subjectId);
        refresh();
        toast(
          `${current.subject.name} saiu da ${klass.name}.${
            result.endedAssignments
              ? ` ${plural(result.endedAssignments, "vínculo de docente encerrado", "vínculos de docente encerrados")}.`
              : ""
          }`,
          {
            key: `oferta-${klass.id}-${current.subjectId}`,
            undo: async () => {
              try {
                await addClassSubject(token, klass.id, current.subjectId);
                for (const teacher of previous) {
                  await assignTeacher(token, klass.id, current.subjectId, teacher);
                }
                refresh();
              } catch (error) {
                showError(error, `oferta-${klass.id}-${current.subjectId}`);
              }
            },
          }
        );
        api.back();
      } catch (error) {
        showError(error, `oferta-${klass.id}-${current.subjectId}`);
      }
    });
  }

  return (
    <>
      <PanelSubtitle node={subtitle}>
        <span>
          {current.subject.name}, {classLabel(klass)}
        </span>
      </PanelSubtitle>

      {current.teachers.length ? (
        <section className="admin-sec !pt-1" aria-labelledby={`${searchId}-atuais`}>
          <div className="admin-sec-head">
            <h3 id={`${searchId}-atuais`} className="admin-sec-t" data-panel-start tabIndex={-1}>
              Docentes desta disciplina
            </h3>
          </div>
          <ul className="admin-people">
            {current.teachers.map((teacher) => (
              <li key={teacher.assignmentId} className="admin-irow">
                <span className="admin-av-xs" aria-hidden>
                  {initialsOf(teacher.fullName)}
                </span>
                <span className="admin-s-main">
                  <span className="admin-s-name">{teacher.fullName}</span>
                </span>
                <select
                  className="input admin-role-select"
                  aria-label={`Tipo do vínculo de ${teacher.fullName}`}
                  disabled={working !== null}
                  value={teacher.role}
                  onChange={(event) =>
                    changeRole(teacher.assignmentId, teacher.fullName, teacher.role, event.target.value as TeachingRole)
                  }
                >
                  <option value="titular">{teachingRoleLabels.titular}</option>
                  <option value="substituto">{teachingRoleLabels.substituto}</option>
                </select>
                <button
                  className={cx("ib sm", busyLook)}
                  aria-disabled={busyAttr}
                  aria-label={`Desvincular ${teacher.fullName} de ${current.subject.name}`}
                  title="Desvincular"
                  onClick={() => unlink(teacher.assignmentId, teacher.teacherId, teacher.fullName, teacher.role)}
                  type="button"
                >
                  <UserMinus className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="callout amber mt-1">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {current.subject.name} está sem docente: ninguém publica eventos dela na {klass.name} ainda.
        </p>
      )}

      <section className="admin-sec" aria-labelledby={`${searchId}-novo`}>
        <div className="admin-sec-head">
          <div className="min-w-0">
            <h3
              id={`${searchId}-novo`}
              className="admin-sec-t"
              data-panel-start={current.teachers.length ? undefined : ""}
              tabIndex={-1}
            >
              Vincular docente
            </h3>
            <p className="admin-sec-s">Busque pelo nome ou pelo e-mail da conta de docente.</p>
          </div>
        </div>
        <div className="mb-3 grid gap-2">
          <span className="lbl">Tipo do vínculo</span>
          <Segmented label="Tipo do vínculo">
            <SegmentedButton active={role === "titular"} label="Titular" onClick={() => setRoleChoice("titular")} />
            <SegmentedButton active={role === "substituto"} label="Substituto" onClick={() => setRoleChoice("substituto")} />
          </Segmented>
        </div>
        <Field label="Buscar docente" error={searchError ?? undefined}>
          <input
            className="input"
            autoComplete="off"
            data-panel-focus=""
            placeholder="Nome ou e-mail"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchError(null);
            }}
          />
        </Field>
        <div className="mt-3" aria-live="polite" aria-busy={teachers.loading || undefined}>
          {teachers.loading ? (
            <SkeletonRows rows={3} label="Buscando docentes" />
          ) : teachers.error && !teachers.data ? (
            <p className="field-error" role="alert">
              <CircleAlert aria-hidden />
              <span>{errorMessage(teachers.error)}</span>
            </p>
          ) : results.length ? (
            <ul className="admin-people" aria-label="Docentes encontradas">
              {results.map((person) => (
                <li key={person.id} className="admin-irow">
                  <span className="admin-av-xs" aria-hidden>
                    {initialsOf(person.fullName ?? person.email)}
                  </span>
                  <span className="admin-s-main">
                    <span className="admin-s-name">{person.fullName ?? person.email}</span>
                    <span className="admin-s-mail">{person.email}</span>
                  </span>
                  <button
                    className={cx(primaryButton, "btn-sm", busyLook)}
                    aria-disabled={busyAttr}
                    aria-label={`Vincular ${person.fullName ?? person.email} como ${teachingRoleLabels[role].toLowerCase()}`}
                    onClick={() => link(person)}
                    type="button"
                  >
                    <UserPlus className="h-4 w-4" aria-hidden />
                    Vincular
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={Search}
              text={settled ? `Nenhuma docente com "${settled}"` : "Nenhuma docente para vincular"}
              hint="Confira o nome ou o e-mail. A pessoa precisa ter uma conta de docente na Agenda."
            />
          )}
        </div>
      </section>

      <PanelFooter api={api}>
        <button className={cx(secondaryButton, busyLook)} aria-disabled={busyAttr} onClick={archiveOffer} type="button">
          <Archive className="h-4 w-4" aria-hidden />
          Tirar da turma
        </button>
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.back()} type="button">
          Voltar para a turma
        </button>
      </PanelFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Adicionar alunos (lista de e-mails)                                 */
/* ------------------------------------------------------------------ */

const rejectLabels: Record<string, [string, string]> = {
  invalid_email: ["com e-mail inválido", "com e-mail inválido"],
  not_student: ["sem conta de aluno", "sem conta de aluno"],
  already_enrolled: ["já estava na turma", "já estavam na turma"],
  already_invited: ["já tinha convite", "já tinham convite"],
};

/** "12 incluídos, 3 convidados, 1 com e-mail inválido". */
export function addStudentsSummary(result: AddStudentsResult) {
  const parts: string[] = [];
  if (result.added) {
    parts.push(plural(result.added, "incluído", "incluídos"));
  }
  if (result.invited) {
    parts.push(plural(result.invited, "convidado", "convidados"));
  }
  const byReason = new Map<string, number>();
  for (const item of result.rejected) {
    byReason.set(item.reason, (byReason.get(item.reason) ?? 0) + 1);
  }
  for (const [reason, count] of byReason) {
    const label = rejectLabels[reason];
    parts.push(label ? `${count} ${count === 1 ? label[0] : label[1]}` : `${count} com problema`);
  }
  return parts.length ? parts.join(", ") : "Nenhum e-mail novo";
}

export function AddStudentsPanel({ api, subtitle, view }: PanelProps<"addStudents">) {
  const { token, showError } = useAppActions();
  const detail = useRemote(`admin:turma:${view.classId}`, () => getClass(token, view.classId));
  const formId = useId();
  const text = view.text ?? "";
  const emails = parseEmails(text);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddStudentsResult | null>(null);
  const { working, run } = useWorking(api);
  const item = detail.data;

  function change(value: string) {
    setError(null);
    api.setView({ ...view, text: value, dirty: value.trim() !== "" });
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!emails.length) {
      setError("Cole pelo menos um e-mail, um por linha.");
      return;
    }
    if (emails.length > MAX_EMAILS) {
      setError(`Cole até ${MAX_EMAILS} e-mails por vez. Esta lista tem ${emails.length}: divida em duas partes.`);
      return;
    }
    await run("add", async () => {
      try {
        const outcome = await addClassStudentsByEmail(token, view.classId, emails);
        setResult(outcome);
        // ficam no campo só os e-mails que a pessoa precisa corrigir
        const invalid = outcome.rejected.filter((entry) => entry.reason === "invalid_email").map((entry) => entry.email);
        api.setView({ ...view, text: invalid.join("\n"), dirty: invalid.length > 0 });
        api.changed();
      } catch (failure) {
        const byField = fieldErrors(failure);
        if (byField.emails) {
          setError(byField.emails);
          return;
        }
        showError(failure, `alunos-${view.classId}`);
      }
    });
  }

  const good = result ? result.added + result.invited : 0;

  return (
    <>
      <ClassSubtitle node={subtitle} item={item} />
      <form id={formId} className="admin-sec !pt-1" noValidate onSubmit={(event) => void submit(event)}>
        <h3 className="sr-only" data-panel-start tabIndex={-1}>
          Lista de e-mails
        </h3>
        <div role="status">
          {result ? (
            <div className={cx("callout mb-4", good ? "green" : "amber")}>
              {good ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              <div className="min-w-0">
                <p className="font-bold">{addStudentsSummary(result)}</p>
                {result.invited ? (
                  <p className="mt-1">Quem foi convidado entra na turma assim que criar a conta com esse e-mail.</p>
                ) : null}
                {result.rejected.length ? (
                  <ul className="admin-rejected">
                    {result.rejected.map((entry) => (
                      <li key={`${entry.reason}-${entry.email}`}>
                        <span className="admin-mono wrap-anywhere">{entry.email}</span>: {entry.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <Field
          label="E-mails dos alunos"
          hint={emails.length ? plural(emails.length, "e-mail", "e-mails") : "um por linha"}
          error={error ?? undefined}
        >
          <textarea
            className="input"
            autoComplete="off"
            data-panel-focus=""
            placeholder={"ana.rocha@agenda.test\nbruno.alves@agenda.test"}
            rows={9}
            spellCheck={false}
            value={text}
            onChange={(event) => change(event.target.value)}
          />
        </Field>
        <p className="field-help">
          Quem já tem conta de aluno entra na turma na hora. Quem ainda não tem recebe um convite e entra ao criar a conta.
          E-mail repetido conta uma vez.
        </p>
      </form>
      <PanelFooter api={api}>
        <span className="admin-foot-gap" />
        <button className={secondaryButton} onClick={() => api.back()} type="button">
          Voltar para a turma
        </button>
        <button className={cx(primaryButton, busyLook)} aria-disabled={working !== null || undefined} form={formId} type="submit">
          <UserPlus className="h-4 w-4" aria-hidden />
          Adicionar alunos
        </button>
      </PanelFooter>
    </>
  );
}
