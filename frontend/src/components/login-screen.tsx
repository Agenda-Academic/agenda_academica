"use client";

import {
  AlertCircle,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  GraduationCap,
  Info,
  Loader2,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ApiError, login, signup, wakeApi } from "@/lib/api";
import { cx, errorMessage } from "@/lib/format";
import { demoAccounts } from "@/lib/meta";
import type { Session } from "@/lib/types";
import { GuardianDataDialog } from "./guardian-data-dialog";
import { Field, primaryButton } from "./ui";

type Mode = "login" | "signup";
type SignupRole = "student" | "teacher" | "guardian";
type FieldName = "fullName" | "registration" | "email" | "password" | "passwordConfirmation" | "consent";
type FieldErrors = Partial<Record<FieldName, string>>;

// ordem dos campos na tela: o foco vai para o primeiro com erro
const fieldOrder: FieldName[] = ["fullName", "registration", "email", "password", "passwordConfirmation", "consent"];

// o "Li e concordo" do responsável (LGPD, desenho 6.1) é só da tela: a API não guarda o aceite
const consentMissing = "Marque Li e concordo para criar a conta de responsável.";

const emailTaken = "Este e-mail já tem conta. Entre ou use outro e-mail.";
const registrationTaken = "Esta matrícula já tem conta. Entre ou confira o número.";

/**
 * Matrícula (ou e-mail) que já tem conta e que só o banco recusa (API sem a regra de único): a API
 * responde 500 com o erro do banco, que cita a coluna ("UNIQUE constraint failed: users.registration"
 * no SQLite e "users_registration_unique" no Postgres e no MySQL). Essa mensagem traz o comando
 * inteiro, com dados da conta, e nunca aparece na tela: vira o erro do campo.
 */
const takenByDatabase: Array<{ field: FieldName; column: RegExp; message: string }> = [
  { field: "registration", column: /users\.registration\b|users_registration_unique/i, message: registrationTaken },
  { field: "email", column: /users\.email\b|users_email_unique/i, message: emailTaken },
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function letters(value: string) {
  return (value.match(/\p{L}/gu) ?? []).length;
}

/** Erros da API ligados ao campo certo (cadastro e entrada). */
function serverErrors(err: unknown, mode: Mode): FieldErrors | null {
  if (!(err instanceof ApiError)) {
    return null;
  }
  if (mode === "login") {
    if (err.status === 400 || err.status === 401 || /credentials/i.test(err.message)) {
      return { password: "E-mail ou senha incorretos." };
    }
  }
  if (mode === "signup" && err.status >= 500 && /unique|duplicate/i.test(err.message)) {
    const taken = takenByDatabase.find((item) => item.column.test(err.message));
    if (taken) {
      return { [taken.field]: taken.message };
    }
  }
  const items = Array.isArray(err.errors) ? err.errors : [];
  const result: FieldErrors = {};
  for (const item of items) {
    if (item.field === "email") {
      result.email ??= item.rule === "database.unique" ? emailTaken : "Digite um e-mail válido.";
    } else if (item.field === "password") {
      result.password ??= "A senha precisa ter de 8 a 32 caracteres.";
    } else if (item.field === "passwordConfirmation") {
      result.passwordConfirmation ??= "As senhas não são iguais.";
    } else if (item.field === "fullName") {
      result.fullName ??= item.message && /[áéíóúãõç]/i.test(item.message) ? item.message : "Digite seu nome completo.";
    } else if (item.field === "registration") {
      result.registration ??= item.rule === "database.unique" ? registrationTaken : "Confira a matrícula.";
    }
  }
  return Object.keys(result).length ? result : null;
}

/** Campo de senha com o botão de mostrar fora do rótulo (o nome do campo fica só "Senha"). */
function PasswordField({
  autoComplete,
  error,
  errorId,
  hint,
  inputRef,
  label,
  shown,
  value,
  onChange,
  onToggle,
}: {
  autoComplete: string;
  error?: string;
  errorId: string;
  hint?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  shown: boolean;
  value: string;
  onChange: (value: string) => void;
  onToggle?: () => void;
}) {
  const inputId = useId();
  return (
    <div className="grid content-start gap-1.5">
      <div className="grid gap-2">
        <label htmlFor={inputId} className="lbl">
          {label}
          {hint ? <span className="hint">{hint}</span> : null}
        </label>
        <span className="relative block">
          <input
            ref={inputRef}
            id={inputId}
            className={cx("input", onToggle && "pr-12")}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            type={shown ? "text" : "password"}
            autoComplete={autoComplete}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {onToggle ? (
            <button
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
              onClick={onToggle}
              aria-label="Mostrar senha"
              aria-pressed={shown}
              title={shown ? "Ocultar senha" : "Mostrar senha"}
              type="button"
            >
              {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          ) : null}
        </span>
      </div>
      {error ? <FieldMessage id={errorId}>{error}</FieldMessage> : null}
    </div>
  );
}

function FieldMessage({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="field-error flex items-start gap-1.5" id={id}>
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function LoginScreen({
  email,
  notice,
  onSession,
}: {
  /** E-mail de quem estava na sessão que venceu: o formulário (e o cartão da conta de teste) já vem com ele. */
  email?: string | null;
  /** Aviso no topo do formulário (ex.: sessão vencida). */
  notice?: string | null;
  onSession: (session: Session) => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [loginForm, setLoginForm] = useState(() => {
    if (email) {
      // conta de demonstração: a senha também vem, e um clique em Entrar volta para quem estava
      const known = demoAccounts.find((account) => account.email === email);
      return { email, password: known?.password ?? "" };
    }
    return { email: demoAccounts[0].email, password: demoAccounts[0].password };
  });
  const [signupForm, setSignupForm] = useState({
    fullName: "",
    email: "",
    registration: "",
    role: "student" as SignupRole,
    password: "",
    passwordConfirmation: "",
    consent: false,
  });
  // "Quais dados o responsável vê", aberto pelo aviso do cadastro do responsável
  const [dataOpen, setDataOpen] = useState(false);
  const guardian = mode === "signup" && signupForm.role === "guardian";
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const baseId = useId();
  const errorId = (name: FieldName) => `${baseId}-${name}-erro`;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const registrationRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  // Acorda a API enquanto a pessoa ainda está lendo a tela de login.
  useEffect(() => {
    wakeApi();
  }, []);

  // Depois de sair (ou de a sessão vencer) o foco cairia no body: vai para o título da tela,
  // sem abrir o teclado do celular.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) {
      titleRef.current?.focus({ preventScroll: true });
    }
  }, []);

  // Se a resposta demorar, avisa que o servidor está voltando do repouso.
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  function showErrors(next: FieldErrors) {
    setFieldErrors(next);
    const first = fieldOrder.find((name) => next[name]);
    if (first) {
      // espera o campo ganhar aria-invalid antes de focar
      const target = {
        fullName: fullNameRef,
        registration: registrationRef,
        email: emailRef,
        password: passwordRef,
        passwordConfirmation: confirmRef,
        consent: consentRef,
      }[first];
      window.requestAnimationFrame(() => target.current?.focus());
    }
  }

  /** Limpa o erro do campo que a pessoa mexeu (e o aviso geral). */
  function touched(name: FieldName) {
    setError(null);
    setFieldErrors((current) => {
      if (mode === "login") {
        // e-mail ou senha errados: qualquer mudança nos dois apaga o aviso
        return {};
      }
      const next = { ...current };
      delete next[name];
      if (name === "password") {
        delete next.passwordConfirmation;
      }
      return next;
    });
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    const email = (mode === "login" ? loginForm.email : signupForm.email).trim();
    const password = mode === "login" ? loginForm.password : signupForm.password;
    if (mode === "signup" && letters(signupForm.fullName.trim()) < 3) {
      next.fullName = "Digite seu nome completo.";
    }
    if (!email) {
      next.email = "Digite seu e-mail.";
    } else if (!emailPattern.test(email)) {
      next.email = "Digite um e-mail válido, como nome@exemplo.com.";
    }
    if (!password) {
      next.password = "Digite sua senha.";
    } else if (mode === "signup" && (password.length < 8 || password.length > 32)) {
      next.password = "A senha precisa ter de 8 a 32 caracteres.";
    }
    if (mode === "signup" && !next.password && signupForm.passwordConfirmation !== signupForm.password) {
      next.passwordConfirmation = "As senhas não são iguais.";
    }
    if (guardian && !signupForm.consent) {
      next.consent = consentMissing;
    }
    return next;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) {
      return;
    }
    setError(null);
    const problems = validate();
    if (Object.keys(problems).length) {
      showErrors(problems);
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      if (mode === "login") {
        onSession(await login(loginForm.email.trim(), loginForm.password));
      } else {
        onSession(
          await signup({
            fullName: signupForm.fullName.trim().replace(/\s+/g, " "),
            email: signupForm.email.trim(),
            password: signupForm.password,
            passwordConfirmation: signupForm.passwordConfirmation,
            role: signupForm.role,
            // o responsável não tem matrícula (mandar uma dá 422)
            registration: guardian ? null : signupForm.registration.trim() || null,
          })
        );
      }
    } catch (err) {
      const byField = serverErrors(err, mode);
      if (byField) {
        showErrors(byField);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
      setSlow(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setFieldErrors({});
  }

  return (
    // o cartão fica no meio da altura, entre os dois vãos da .entrada (globals.css); com aviso na
    // tela, o vão de baixo guarda o lugar dele e, no fim da rolagem, o cartão fica acima do aviso
    <main className="entrada flex min-h-screen flex-col bg-login px-4 py-6 text-ink sm:px-6 lg:px-8">
      <section className="card rise mx-auto grid w-full max-w-6xl shrink-0 overflow-hidden !rounded-[28px] xl:grid-cols-[1fr_0.95fr]">
        <div className="hidden min-h-[600px] flex-col justify-between bg-night p-10 text-white xl:flex">
          <div>
            <div className="flex items-center gap-3">
              <span className="mark">
                <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
              </span>
              <div>
                <p className="brand-name">Agenda Acadêmica</p>
                <p className="brand-sub">IFMS, Campus Três Lagoas</p>
              </div>
            </div>

            <div className="mt-12 max-w-xl">
              <p className="disp text-[44px] font-bold leading-[1.05]">Agenda acadêmica unificada do campus</p>
              <p className="mt-4 text-[15.5px] leading-7 text-on-night">
                Centraliza provas, trabalhos, atividades, datas oficiais e lembretes de alunos, docentes e coordenação.
              </p>
            </div>

            <ul className="mt-10 grid gap-4 text-[14.5px] text-on-night">
              <li className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
                  <CalendarDays className="h-4 w-4 text-accent" aria-hidden />
                </span>
                Prazos docentes e datas institucionais no mesmo fluxo
              </li>
              <li className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
                  <Bell className="h-4 w-4 text-accent" aria-hidden />
                </span>
                Lembretes pessoais antes de provas, trabalhos e eventos
              </li>
              <li className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
                  <Users className="h-4 w-4 text-accent" aria-hidden />
                </span>
                Visão por perfil para aluno, docente e administração
              </li>
            </ul>
          </div>

          <p className="flex items-center gap-2 border-t border-white/10 pt-5 text-[13px] text-on-night-2">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
            Ambiente de demonstração: os dados voltam ao padrão sempre que o servidor reinicia.
          </p>
        </div>

        <div className="flex items-center justify-center p-5 sm:p-8">
          <form className="w-full max-w-md" onSubmit={handleSubmit} noValidate>
            <div className="mb-6 flex items-center gap-3 xl:hidden">
              <span className="mark">
                <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
              </span>
              <p className="brand-name text-ink">Agenda Acadêmica</p>
            </div>

            {notice ? (
              <p role="status" className="callout blue mb-5">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {notice}
              </p>
            ) : null}

            <div className="seg mb-7 grid w-full grid-cols-2">
              <button
                className={cx(mode === "login" && "on")}
                aria-pressed={mode === "login"}
                onClick={() => switchMode("login")}
                type="button"
              >
                <UserRound className="h-4 w-4" aria-hidden />
                Entrar
              </button>
              <button
                className={cx(mode === "signup" && "on")}
                aria-pressed={mode === "signup"}
                onClick={() => switchMode("signup")}
                type="button"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Criar conta
              </button>
            </div>

            <h1 ref={titleRef} className="disp text-[30px] font-bold leading-tight" tabIndex={-1}>
              {mode === "login" ? "Entrar" : "Criar minha conta"}
            </h1>
            <p className="mt-2 text-[14.5px] leading-6 text-muted">
              {mode === "login"
                ? "Use seu e-mail ou escolha uma conta de demonstração."
                : "Crie uma conta para acompanhar prazos e configurar lembretes."}
            </p>

            <div className="mt-5 grid gap-3">
              {mode === "signup" ? (
                <>
                  <Field label="Nome completo" error={fieldErrors.fullName} errorId={errorId("fullName")}>
                    <input
                      ref={fullNameRef}
                      className="input"
                      value={signupForm.fullName}
                      onChange={(event) => {
                        setSignupForm({ ...signupForm, fullName: event.target.value });
                        touched("fullName");
                      }}
                      autoComplete="name"
                      maxLength={120}
                    />
                  </Field>
                  <div className={cx("grid gap-3", !guardian && "sm:grid-cols-2")}>
                    {/* o responsável não tem matrícula: o campo some (o que foi digitado fica guardado) */}
                    {guardian ? null : (
                      <Field
                        label="Matrícula"
                        hint="opcional"
                        error={fieldErrors.registration}
                        errorId={errorId("registration")}
                      >
                        <input
                          ref={registrationRef}
                          className="input"
                          value={signupForm.registration}
                          onChange={(event) => {
                            setSignupForm({ ...signupForm, registration: event.target.value });
                            touched("registration");
                          }}
                          placeholder="ALU-000"
                        />
                      </Field>
                    )}
                    <Field label="Perfil">
                      <select
                        className="input"
                        value={signupForm.role}
                        onChange={(event) => {
                          setSignupForm({
                            ...signupForm,
                            role: event.target.value as SignupRole,
                          });
                          touched("registration");
                        }}
                      >
                        <option value="student">Aluno</option>
                        <option value="teacher">Docente</option>
                        <option value="guardian">Responsável</option>
                      </select>
                    </Field>
                  </div>
                  {guardian ? (
                    <p className="callout blue">
                      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        Usamos seu nome e e-mail só para mostrar a agenda do aluno que você acompanha.{" "}
                        <button className="link inline min-h-6" onClick={() => setDataOpen(true)} type="button">
                          Quais dados o responsável vê
                        </button>
                      </span>
                    </p>
                  ) : null}
                </>
              ) : null}

              <Field label="E-mail" error={fieldErrors.email} errorId={errorId("email")}>
                <input
                  ref={emailRef}
                  className="input"
                  value={mode === "login" ? loginForm.email : signupForm.email}
                  onChange={(event) => {
                    if (mode === "login") {
                      setLoginForm({ ...loginForm, email: event.target.value });
                    } else {
                      setSignupForm({ ...signupForm, email: event.target.value });
                    }
                    touched("email");
                  }}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                />
              </Field>

              <PasswordField
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                error={fieldErrors.password}
                errorId={errorId("password")}
                hint={mode === "signup" ? "mínimo de 8 caracteres" : undefined}
                inputRef={passwordRef}
                label="Senha"
                shown={showPassword}
                value={mode === "login" ? loginForm.password : signupForm.password}
                onChange={(value) => {
                  if (mode === "login") {
                    setLoginForm({ ...loginForm, password: value });
                  } else {
                    setSignupForm({ ...signupForm, password: value });
                  }
                  touched("password");
                }}
                onToggle={() => setShowPassword((current) => !current)}
              />

              {mode === "signup" ? (
                <PasswordField
                  autoComplete="new-password"
                  error={fieldErrors.passwordConfirmation}
                  errorId={errorId("passwordConfirmation")}
                  inputRef={confirmRef}
                  label="Confirmar senha"
                  shown={showPassword}
                  value={signupForm.passwordConfirmation}
                  onChange={(value) => {
                    setSignupForm({ ...signupForm, passwordConfirmation: value });
                    touched("passwordConfirmation");
                  }}
                />
              ) : null}

              {guardian ? (
                <div className="grid gap-1.5">
                  <label className="flex min-h-6 cursor-pointer items-start gap-2.5 text-sm leading-6 text-ink-2">
                    <input
                      ref={consentRef}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]"
                      type="checkbox"
                      checked={signupForm.consent}
                      onChange={(event) => {
                        setSignupForm({ ...signupForm, consent: event.target.checked });
                        touched("consent");
                      }}
                      aria-invalid={fieldErrors.consent ? true : undefined}
                      aria-describedby={fieldErrors.consent ? errorId("consent") : undefined}
                    />
                    <span>Li e concordo com o uso do meu nome e e-mail para acompanhar a agenda do aluno.</span>
                  </label>
                  {fieldErrors.consent ? <FieldMessage id={errorId("consent")}>{fieldErrors.consent}</FieldMessage> : null}
                </div>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="callout rose pop mt-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            <button
              className={cx(primaryButton, "mt-5 h-11 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-55")}
              aria-disabled={loading || undefined}
              type="submit"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : mode === "login" ? (
                <UserRound className="h-4 w-4" aria-hidden />
              ) : (
                <UserPlus className="h-4 w-4" aria-hidden />
              )}
              {loading ? (mode === "login" ? "Entrando" : "Criando conta") : mode === "login" ? "Entrar" : "Criar conta e entrar"}
            </button>

            {loading && slow ? (
              <p role="status" className="mt-3 text-center text-sm text-muted">
                O servidor estava em repouso e está voltando. No primeiro acesso isso leva até um minuto.
              </p>
            ) : null}

            {mode === "login" ? (
              <div className="mt-7">
                <p className="flex items-center gap-2 text-sm font-bold text-ink-2">
                  <ShieldCheck className="h-4 w-4 text-muted" aria-hidden />
                  Contas de demonstração
                </p>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  {demoAccounts.map((account, index) => {
                    const on = loginForm.email === account.email;
                    const Icon = [GraduationCap, BookOpen, ShieldCheck, Users][index % 4];
                    const tone = [
                      "bg-brand-50 text-brand",
                      "bg-[#EDE9FE] text-[#5B21B6]",
                      "bg-[#DBEAFE] text-[#1E40AF]",
                      "bg-[#FEF3C7] text-[#92400E]",
                    ][index % 4];
                    return (
                      <button
                        key={account.email}
                        type="button"
                        title={`Usar conta ${account.label}`}
                        aria-pressed={on}
                        onClick={() => {
                          setLoginForm({ email: account.email, password: account.password });
                          touched("email");
                        }}
                        // no celular vira linha (ícone, texto, check); a partir de sm, cartão com o texto embaixo
                        className={cx(
                          "grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border p-3.5 text-left transition hover:-translate-y-0.5 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-2.5",
                          on ? "border-brand bg-brand-50 shadow-[inset_0_0_0_1px_var(--brand)]" : "border-line-strong bg-white hover:border-[var(--line-hover)]"
                        )}
                      >
                        <span
                          className={cx(
                            "flex h-[34px] w-[34px] items-center justify-center rounded-[10px] sm:row-start-1",
                            on ? "bg-white text-brand" : tone
                          )}
                        >
                          <Icon className="h-[18px] w-[18px]" aria-hidden />
                        </span>
                        <span className="min-w-0 sm:col-span-2 sm:row-start-2">
                          <span className="block text-[14.5px] font-bold">{account.label}</span>
                          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{account.description}</span>
                        </span>
                        <Check
                          className={cx("h-4 w-4 text-brand transition-opacity sm:col-start-2 sm:row-start-1", on ? "opacity-100" : "opacity-0")}
                          aria-hidden
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </form>
        </div>
      </section>
      <GuardianDataDialog open={dataOpen} onClose={() => setDataOpen(false)} />
    </main>
  );
}
