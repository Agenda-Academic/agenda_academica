"use client";

import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheckBig,
  Eye,
  EyeOff,
  GraduationCap,
  Info,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ApiError, googleLoginUrl, login, requestPasswordReset, resetPassword, signup, wakeApi } from "@/lib/api";
import { cx, errorMessage } from "@/lib/format";
import { demoAccounts } from "@/lib/meta";
import type { Session } from "@/lib/types";
import { GuardianDataDialog } from "./guardian-data-dialog";
import { Field, primaryButton, secondaryButton } from "./ui";

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

// motivo da volta do Google (?google_erro=, ou "falhou" quando a troca do código não deu certo)
const googleFailed = "Não foi possível entrar com o Google. Tente de novo.";
const googleErrors: Record<string, string> = {
  dominio: "Esse e-mail não é do IFMS. Entre com e-mail e senha ou crie sua conta.",
  cancelado: "O login com o Google foi cancelado.",
  nao_configurado: "O login com o Google ainda não está disponível.",
  estado: googleFailed,
  falhou: googleFailed,
};

/** Mensagem de um motivo de erro do Google; um motivo desconhecido vira a de "falhou". */
function googleErrorMessage(reason: string | null | undefined) {
  if (!reason) {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(googleErrors, reason) ? googleErrors[reason] : googleFailed;
}

/** O "G" colorido oficial do Google. */
function GoogleMark() {
  return (
    <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 48 48" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

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

const slowServer = "O servidor estava em repouso e está voltando. No primeiro acesso isso leva até um minuto.";

/** O link do e-mail não vale mais (usado, vencido ou trocado por um novo): a API responde no campo token. */
function tokenProblem(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  return err.errors.find((item) => item.field === "token")?.message ?? null;
}

/**
 * "Esqueci minha senha" (pedir o link por e-mail) e "Criar senha nova" (pelo link do e-mail). Fica no lugar do
 * formulário de entrar, no mesmo cartão.
 */
function PasswordRecovery({
  mode,
  token,
  initialEmail,
  onBack,
  onAskLink,
  onSession,
}: {
  mode: "forgot" | "reset";
  token: string | null;
  initialEmail: string;
  onBack: () => void;
  /** Link que não vale mais: volta para o pedido de link. */
  onAskLink: () => void;
  onSession: (session: Session) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; passwordConfirmation?: string }>({});

  const baseId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);

  // a tela troca dentro do mesmo cartão: o foco vai para o título novo
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    if (sentTo) doneRef.current?.focus();
  }, [sentTo]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  async function submitForgot(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const value = email.trim();
    if (!value) {
      setFieldErrors({ email: "Digite o e-mail da sua conta." });
      emailRef.current?.focus();
      return;
    }
    if (!emailPattern.test(value)) {
      setFieldErrors({ email: "Digite um e-mail válido, como nome@exemplo.com." });
      emailRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(value);
      setSentTo(value);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setSlow(false);
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    if (loading || !token) return;
    const next: typeof fieldErrors = {};
    if (!password) {
      next.password = "Digite a senha nova.";
    } else if (password.length < 8 || password.length > 32) {
      next.password = "A senha precisa ter de 8 a 32 caracteres.";
    } else if (confirm !== password) {
      next.passwordConfirmation = "As senhas não são iguais.";
    }
    if (next.password || next.passwordConfirmation) {
      setFieldErrors(next);
      (next.password ? passwordRef : confirmRef).current?.focus();
      return;
    }
    setFieldErrors({});
    setError(null);
    setLoading(true);
    try {
      onSession(await resetPassword(token, password, confirm));
    } catch (err) {
      const problem = tokenProblem(err);
      if (problem) {
        setLinkProblem(problem);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
      setSlow(false);
    }
  }

  const backButton = (
    <button className="link mb-5 inline-flex min-h-6 items-center gap-1.5 text-sm" onClick={onBack} type="button">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Voltar para entrar
    </button>
  );

  const brand = (
    <div className="mb-6 flex items-center gap-3 xl:hidden">
      <span className="mark">
        <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <p className="brand-name text-ink">Agenda Acadêmica</p>
    </div>
  );

  if (mode === "forgot") {
    return (
      <form className="w-full max-w-md" onSubmit={submitForgot} noValidate>
        {brand}
        {/* depois do envio, o "Voltar para entrar" fica só no botão grande */}
        {sentTo ? null : backButton}
        <h1 ref={titleRef} className="disp text-[30px] font-bold leading-tight outline-none" tabIndex={-1}>
          Esqueci minha senha
        </h1>
        <p className="mt-2 text-[14.5px] leading-6 text-muted">
          Digite o e-mail da sua conta. Enviamos um link para você criar uma senha nova.
        </p>

        {sentTo ? (
          <>
            <p ref={doneRef} role="status" tabIndex={-1} className="callout green mt-5 outline-none">
              <CircleCheckBig className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 wrap-anywhere">
                Se existir uma conta com <b>{sentTo}</b>, o link chega em alguns minutos e vale por 1 hora. Olhe também
                no spam.
              </span>
            </p>
            <button className={cx(primaryButton, "mt-5 h-11 w-full")} onClick={onBack} type="button">
              <UserRound className="h-4 w-4" aria-hidden />
              Voltar para entrar
            </button>
            <button
              className={cx(secondaryButton, "mt-3 h-11 w-full")}
              onClick={() => {
                setSentTo(null);
                window.requestAnimationFrame(() => emailRef.current?.focus());
              }}
              type="button"
            >
              Usar outro e-mail
            </button>
          </>
        ) : (
          <>
            <div className="mt-5 grid gap-3">
              <Field label="E-mail" error={fieldErrors.email} errorId={`${baseId}-email-erro`}>
                <input
                  ref={emailRef}
                  className="input"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setFieldErrors({});
                    setError(null);
                  }}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                />
              </Field>
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
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}
              {loading ? "Enviando" : "Enviar link"}
            </button>
            {loading && slow ? (
              <p role="status" className="mt-3 text-center text-sm text-muted">
                {slowServer}
              </p>
            ) : null}
            <p className="mt-3 text-center text-[13px] leading-5 text-muted">As contas de demonstração não recebem e-mail.</p>
          </>
        )}
      </form>
    );
  }

  return (
    <form className="w-full max-w-md" onSubmit={submitReset} noValidate>
      {brand}
      {backButton}
      <h1 ref={titleRef} className="disp text-[30px] font-bold leading-tight outline-none" tabIndex={-1}>
        Criar senha nova
      </h1>
      <p className="mt-2 text-[14.5px] leading-6 text-muted">Escolha a senha nova da sua conta. Depois de salvar, você já entra.</p>

      {linkProblem || !token ? (
        <>
          <p role="alert" className="callout rose pop mt-5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">{linkProblem ?? "Este link está incompleto. Peça outro em Esqueci minha senha."}</span>
          </p>
          <button className={cx(primaryButton, "mt-5 h-11 w-full")} onClick={onAskLink} type="button">
            <Mail className="h-4 w-4" aria-hidden />
            Pedir outro link
          </button>
        </>
      ) : (
        <>
          <div className="mt-5 grid gap-3">
            <PasswordField
              autoComplete="new-password"
              error={fieldErrors.password}
              errorId={`${baseId}-senha-erro`}
              hint="mínimo de 8 caracteres"
              inputRef={passwordRef}
              label="Senha nova"
              shown={shown}
              value={password}
              onChange={(value) => {
                setPassword(value);
                setFieldErrors({});
                setError(null);
              }}
              onToggle={() => setShown((current) => !current)}
            />
            <PasswordField
              autoComplete="new-password"
              error={fieldErrors.passwordConfirmation}
              errorId={`${baseId}-confirmar-erro`}
              inputRef={confirmRef}
              label="Confirmar senha nova"
              shown={shown}
              value={confirm}
              onChange={(value) => {
                setConfirm(value);
                setFieldErrors({});
                setError(null);
              }}
            />
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
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
            {loading ? "Salvando" : "Salvar senha e entrar"}
          </button>
          {loading && slow ? (
            <p role="status" className="mt-3 text-center text-sm text-muted">
              {slowServer}
            </p>
          ) : null}
        </>
      )}
    </form>
  );
}

export function LoginScreen({
  email,
  googleError,
  notice,
  onSession,
  resetToken,
  onResetHandled,
}: {
  /** E-mail de quem estava na sessão que venceu: o formulário (e o cartão da conta de teste) já vem com ele. */
  email?: string | null;
  /** Motivo da volta do Google sem entrar (?google_erro=): a mensagem aparece abaixo do botão do Google. */
  googleError?: string | null;
  /** Aviso no topo do formulário (ex.: sessão vencida). */
  notice?: string | null;
  onSession: (session: Session) => void;
  /** Token do link "Criar senha nova" (?redefinir=): a tela abre direto nele. */
  resetToken?: string | null;
  /** O link já foi tratado (senha salva ou a pessoa voltou): não abre de novo depois de sair. */
  onResetHandled?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  // "Esqueci minha senha" e "Criar senha nova" ficam no lugar do formulário de entrar
  const [recovery, setRecovery] = useState<"forgot" | "reset" | null>(resetToken ? "reset" : null);
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
  // a ida ao Google: o botão mostra que está carregando até a página do Google abrir
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleMessage, setGoogleMessage] = useState(() => googleErrorMessage(googleError));
  const busy = loading || googleLoading;

  const baseId = useId();
  const errorId = (name: FieldName) => `${baseId}-${name}-erro`;
  const googleErrorId = `${baseId}-google-erro`;
  const googleHintId = `${baseId}-google-ajuda`;
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
    if (!busy) return;
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  // Voltar do Google pelo botão do navegador traz a página da memória (bfcache): o botão deixa de carregar.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setGoogleLoading(false);
        setSlow(false);
      }
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  function startGoogle() {
    if (busy) {
      return;
    }
    setGoogleMessage(null);
    setGoogleLoading(true);
    window.location.assign(googleLoginUrl());
  }

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
    if (busy) {
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
    setGoogleMessage(null);
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
          {recovery ? (
            <PasswordRecovery
              key={recovery}
              mode={recovery}
              token={resetToken ?? null}
              // conta de demonstração não recebe e-mail: o campo começa vazio
              initialEmail={demoAccounts.some((account) => account.email === loginForm.email) ? "" : loginForm.email}
              onBack={() => {
                if (recovery === "reset") onResetHandled?.();
                setRecovery(null);
                switchMode("login");
              }}
              onAskLink={() => {
                onResetHandled?.();
                setRecovery("forgot");
              }}
              onSession={(session) => {
                onResetHandled?.();
                onSession(session);
              }}
            />
          ) : (
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

                {mode === "login" ? (
                  <button
                    className="link -mt-1 min-h-6 justify-self-end text-sm"
                    onClick={() => {
                      setError(null);
                      setFieldErrors({});
                      setRecovery("forgot");
                    }}
                    type="button"
                  >
                    Esqueci minha senha
                  </button>
                ) : null}

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
                aria-disabled={busy || undefined}
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

              <div className="mt-5 flex items-center gap-3 text-[13px] font-semibold text-muted">
                <span className="h-px flex-1 bg-line" aria-hidden />
                ou
                <span className="h-px flex-1 bg-line" aria-hidden />
              </div>

              {/* padrão do botão do Google: fundo branco, borda cinza e o "G" colorido */}
              <button
                className={cx(
                  secondaryButton,
                  "mt-4 h-11 w-full gap-3 border-[#747775] aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                )}
                aria-disabled={busy || undefined}
                aria-describedby={googleMessage ? `${googleErrorId} ${googleHintId}` : googleHintId}
                onClick={startGoogle}
                type="button"
              >
                {googleLoading ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <GoogleMark />}
                {googleLoading ? "Abrindo o Google" : "Entrar com o Google"}
              </button>
              {googleMessage ? (
                <p role="alert" className="field-error pop" id={googleErrorId}>
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{googleMessage}</span>
                </p>
              ) : null}
              <p id={googleHintId} className="mt-2 text-center text-[13px] leading-5 text-muted">
                Use seu e-mail @estudante.ifms.edu.br ou @ifms.edu.br.
              </p>
              {googleLoading && slow ? (
                <p role="status" className="mt-2 text-center text-sm text-muted">
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
          )}
        </div>
      </section>
      <GuardianDataDialog open={dataOpen} onClose={() => setDataOpen(false)} />
    </main>
  );
}
