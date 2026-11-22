"use client";

import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CalendarCheck2,
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
import { ApiError, authOptions, googleLoginUrl, login, requestPasswordReset, resetPassword, signup, wakeApi } from "@/lib/api";
import { cx, errorMessage } from "@/lib/format";
import { demoAccounts } from "@/lib/meta";
import type { Session } from "@/lib/types";
import { GuardianDataDialog } from "./guardian-data-dialog";
import { LoginStage } from "./login-stage";
import { Field, primaryButton, secondaryButton } from "./ui";

type Mode = "login" | "signup";
type FieldName = "fullName" | "email" | "password" | "passwordConfirmation" | "consent";
type FieldErrors = Partial<Record<FieldName, string>>;

// ordem dos campos na tela: o foco vai para o primeiro com erro
const fieldOrder: FieldName[] = ["fullName", "email", "password", "passwordConfirmation", "consent"];

// o "Li e concordo" do responsável (LGPD, desenho 6.1) é só da tela: a API não guarda o aceite
const consentMissing = "Marque Li e concordo para criar a conta de responsável.";

const emailTaken = "Este e-mail já tem conta. Entre ou use outro e-mail.";

/**
 * E-mail que já tem conta e que só o banco recusa (API sem a regra de único): a API responde 500 com o
 * erro do banco, que cita a coluna ("UNIQUE constraint failed: users.email" no SQLite e
 * "users_email_unique" no Postgres). Essa mensagem traz o comando inteiro, com dados da conta, e nunca
 * aparece na tela: vira o erro do campo.
 */
const takenByDatabase: Array<{ field: FieldName; column: RegExp; message: string }> = [
  { field: "email", column: /users\.email\b|users_email_unique/i, message: emailTaken },
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// motivo da volta do Google (?google_erro=, ou "falhou" quando a troca do código não deu certo)
const googleFailed = "Não foi possível entrar com o Google. Tente de novo.";
const googleErrors: Record<string, string> = {
  dominio: "Esse e-mail não é da instituição. Use o e-mail institucional, ou entre com e-mail e senha.",
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
    if (err.status === 429 && err.message) {
      return { password: err.message };
    }
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
      result.email ??=
        item.rule === "database.unique"
          ? emailTaken
          : item.rule === "google_only" && item.message
            ? item.message
            : "Digite um e-mail válido.";
    } else if (item.field === "password") {
      result.password ??= "A senha precisa ter de 8 a 32 caracteres.";
    } else if (item.field === "passwordConfirmation") {
      result.passwordConfirmation ??= "As senhas não são iguais.";
    } else if (item.field === "fullName") {
      result.fullName ??= item.message && /[áéíóúãõç]/i.test(item.message) ? item.message : "Digite seu nome completo.";
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
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink pointer-coarse:right-px pointer-coarse:h-11 pointer-coarse:w-11 max-md:right-px max-md:h-11 max-md:w-11"
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
    <div className="ent-brand xl:hidden">
      <span className="mark">
        <CalendarCheck2 className="h-[22px] w-[22px]" aria-hidden />
      </span>
      <p className="brand-name text-ink">Agenda Acadêmica</p>
    </div>
  );

  if (mode === "forgot") {
    return (
      <form className="ent-form" onSubmit={submitForgot} noValidate>
        {brand}
        {/* depois do envio, o "Voltar para entrar" fica só no botão grande */}
        {sentTo ? null : backButton}
        <h1 ref={titleRef} className="disp text-[26px] font-bold leading-tight outline-none" tabIndex={-1}>
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
    <form className="ent-form" onSubmit={submitReset} noValidate>
      {brand}
      {backButton}
      <h1 ref={titleRef} className="disp text-[26px] font-bold leading-tight outline-none" tabIndex={-1}>
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
    return { email: "", password: "" };
  });
  // Contas de demonstração ligadas na API (DEMO_ACCOUNTS)? Até a resposta chegar, os atalhos não aparecem.
  const [demoOn, setDemoOn] = useState<boolean | null>(null);
  // Cadastro com e-mail e senha: só de responsável (aluno e docente entram com o Google do IFMS)
  const [signupForm, setSignupForm] = useState({
    fullName: "",
    email: "",
    password: "",
    passwordConfirmation: "",
    consent: false,
  });
  // "Quais dados o responsável vê", aberto pelo aviso do cadastro do responsável
  const [dataOpen, setDataOpen] = useState(false);
  const guardian = mode === "signup";
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
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

  // Acorda a API enquanto a pessoa ainda está lendo a tela de login e pergunta se os atalhos de
  // demonstração aparecem. Ligados e com o formulário ainda vazio, a primeira conta já vem preenchida.
  useEffect(() => {
    wakeApi();
    let active = true;
    authOptions()
      .then((options) => {
        if (!active) return;
        setDemoOn(options.demoAccounts);
        if (options.demoAccounts) {
          setLoginForm((current) =>
            current.email || current.password ? current : { email: demoAccounts[0].email, password: demoAccounts[0].password }
          );
        }
      })
      .catch(() => {
        if (active) setDemoOn(false);
      });
    return () => {
      active = false;
    };
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
            role: "guardian",
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
    // a tela de entrar ocupa a altura da janela e não rola: o cartão fica no meio, entre os dois
    // vãos da .entrada (globals.css), e os espaços internos encolhem com a altura (visual-novo.css).
    // Só se o conteúdo não couber de jeito nenhum (criar conta num celular baixo) o cartão rola por dentro.
    <main className="entrada bg-login text-ink">
      <section className="card rise entrada-card">
        <div className="hidden xl:flex">
          <LoginStage />
        </div>

        <div className="entrada-form">
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
            <form className={cx("ent-form", mode === "signup" && "criar")} onSubmit={handleSubmit} noValidate>
              <div className="ent-brand xl:hidden">
                <span className="mark">
                  <CalendarCheck2 className="h-[22px] w-[22px]" aria-hidden />
                </span>
                <p className="brand-name text-ink">Agenda Acadêmica</p>
              </div>

              {notice ? (
                <p role="status" className="callout blue ent-notice">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {notice}
                </p>
              ) : null}

              <div className="seg ent-tabs grid w-full grid-cols-2">
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

              {/* em tela baixa o título some da vista (as abas já dizem onde se está), mas segue para o leitor de tela */}
              <h1 ref={titleRef} className={cx("ent-title disp", mode === "signup" && "longo")} tabIndex={-1}>
                {mode === "login" ? "Entrar" : "Criar conta de responsável"}
              </h1>
              <p className={cx("ent-desc", mode === "login" && "opcional")}>
                {mode === "signup" ? (
                  <>
                    <span className="opcional">Para pais e responsáveis acompanharem a agenda e as notas do aluno. </span>
                    Tenha em mãos o código do aluno: ele gera no perfil, ou a secretaria passa.
                  </>
                ) : demoOn
                    ? "Use seu e-mail ou escolha uma conta de demonstração."
                    : "Use seu e-mail e senha, ou a conta Google da instituição."}
              </p>
              <div className="ent-fields">
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

                {/* ao criar conta, senha e confirmação ficam lado a lado a partir de 640 px */}
                <div className={cx("ent-senhas", mode === "signup" && "par")}>
                {/* "Esqueci minha senha" fica na linha do rótulo, à direita, para não gastar uma linha só dele */}
                <div className="relative">
                  <PasswordField
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    error={fieldErrors.password}
                    errorId={errorId("password")}
                    hint={mode === "signup" ? "mín. 8 caracteres" : undefined}
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
                      className="link ent-forgot"
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
                </div>

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
                </div>

                {guardian ? (
                  <div className="grid gap-1.5">
                    <label className="flex min-h-6 cursor-pointer items-start gap-2.5 text-sm leading-5 text-ink-2 pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:gap-3">
                      <input
                        ref={consentRef}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)] pointer-coarse:mt-0 pointer-coarse:h-5 pointer-coarse:w-5"
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
                    <button className="link ent-dados" onClick={() => setDataOpen(true)} type="button">
                      Quais dados o responsável vê
                    </button>
                    {fieldErrors.consent ? <FieldMessage id={errorId("consent")}>{fieldErrors.consent}</FieldMessage> : null}
                  </div>
                ) : null}
              </div>

              {error ? (
                <p role="alert" className="callout rose pop ent-notice-in">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {error}
                </p>
              ) : null}

              <button
                className={cx(primaryButton, "ent-submit h-11 w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-55")}
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

              {mode === "login" ? (
                <>
                  <div className="ent-or">
                    <span aria-hidden />
                    ou
                    <span aria-hidden />
                  </div>

                  {/* padrão "neutro" do botão do Google: fundo #F2F2F2, sem borda e o "G" colorido */}
                  <button
                    className={cx(
                      secondaryButton,
                      "ent-google h-11 w-full gap-3 aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                    )}
                    aria-disabled={busy || undefined}
                    aria-describedby={googleMessage ? `${googleErrorId} ${googleHintId}` : googleHintId}
                    onClick={startGoogle}
                    type="button"
                  >
                    {googleLoading ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <GoogleMark />}
                    {googleLoading ? "Abrindo o Google" : "Entrar com o Google"}
                  </button>
                </>
              ) : null}
              {googleMessage ? (
                <p role="alert" className="field-error pop" id={googleErrorId}>
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{googleMessage}</span>
                </p>
              ) : null}
              {/* criar conta é só para responsável: quem é aluno ou docente caiu na aba errada, e o
                  caminho dele (o Google) fica numa linha só, sem o botão grande */}
              {mode === "login" ? (
                <p id={googleHintId} className="ent-hint opcional">
                  Use o e-mail da sua instituição.
                </p>
              ) : (
                <p className="ent-hint ent-hint-google">
                  Aluno ou docente não cria conta:{" "}
                  <button
                    className="link aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                    aria-disabled={busy || undefined}
                    aria-describedby={googleMessage ? googleErrorId : undefined}
                    onClick={startGoogle}
                    type="button"
                  >
                    {googleLoading ? "abrindo o Google" : "entre com o Google"}
                  </button>
                  , com o e-mail da instituição.
                </p>
              )}
              {googleLoading && slow ? (
                <p role="status" className="mt-2 text-center text-sm text-muted">
                  O servidor estava em repouso e está voltando. No primeiro acesso isso leva até um minuto.
                </p>
              ) : null}

              {mode === "login" && demoOn ? (
                <div className="ent-demo">
                  <p className="ent-demo-t">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    Contas de demonstração
                  </p>
                  {/* uma linha curta por conta (ícone e papel); a escolhida fica azul. O que cada uma faz fica na dica do botão */}
                  <div className="ent-demo-grid">
                    {demoAccounts.map((account, index) => {
                      const on = loginForm.email === account.email;
                      const Icon = [GraduationCap, BookOpen, ShieldCheck, Users][index % 4];
                      return (
                        <button
                          key={account.email}
                          type="button"
                          title={`${account.label}: ${account.description}`}
                          aria-pressed={on}
                          onClick={() => {
                            setLoginForm({ email: account.email, password: account.password });
                            touched("email");
                          }}
                          className={cx("ent-demo-btn", on && "on")}
                          data-tom={index % 4}
                        >
                          <span className="ent-demo-ico">
                            <Icon className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0 truncate">{account.label}</span>
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
