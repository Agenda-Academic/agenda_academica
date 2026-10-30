"use client";

import {
  AlertCircle,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  Eye,
  EyeOff,
  GraduationCap,
  Loader2,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { login, signup, wakeApi } from "@/lib/api";
import { cx, errorMessage } from "@/lib/format";
import { demoAccounts } from "@/lib/meta";
import type { Session } from "@/lib/types";
import { Field, primaryButton } from "./ui";

type Mode = "login" | "signup";

export function LoginScreen({ onSession }: { onSession: (session: Session) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [loginForm, setLoginForm] = useState({
    email: demoAccounts[0].email,
    password: demoAccounts[0].password,
  });
  const [signupForm, setSignupForm] = useState({
    fullName: "",
    email: "",
    registration: "",
    role: "student" as "student" | "teacher",
    password: "",
    passwordConfirmation: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Acorda a API enquanto a pessoa ainda está lendo a tela de login.
  useEffect(() => {
    wakeApi();
  }, []);

  // Se a resposta demorar, avisa que o servidor está voltando do repouso.
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 4000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "login") {
        onSession(await login(loginForm.email, loginForm.password));
      } else {
        if (signupForm.password !== signupForm.passwordConfirmation) {
          throw new Error("As senhas não conferem.");
        }
        onSession(
          await signup({
            fullName: signupForm.fullName,
            email: signupForm.email,
            password: signupForm.password,
            passwordConfirmation: signupForm.passwordConfirmation,
            role: signupForm.role,
            registration: signupForm.registration || null,
          })
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setSlow(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const passwordType = showPassword ? "text" : "password";

  return (
    <main className="flex min-h-screen items-center bg-login px-4 py-6 text-ink sm:px-6 lg:px-8">
      <section className="card rise mx-auto grid w-full max-w-6xl overflow-hidden !rounded-[28px] xl:grid-cols-[1fr_0.95fr]">
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
              <h1 className="disp text-[44px] font-bold leading-[1.05]">Agenda acadêmica unificada do campus</h1>
              <p className="mt-4 text-[15.5px] leading-7 text-on-night">
                Centraliza provas, trabalhos, atividades, datas oficiais e lembretes de alunos, professores e coordenação.
              </p>
            </div>

            <div className="mt-10 grid gap-4 text-[14.5px] text-on-night">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                  <CalendarDays className="h-4 w-4 text-accent" aria-hidden />
                </span>
                Prazos docentes e datas institucionais no mesmo fluxo
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                  <Bell className="h-4 w-4 text-accent" aria-hidden />
                </span>
                Lembretes pessoais antes de provas, trabalhos e eventos
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                  <Users className="h-4 w-4 text-accent" aria-hidden />
                </span>
                Visão por perfil para aluno, professor e administração
              </div>
            </div>
          </div>

          <p className="flex items-center gap-2 border-t border-white/10 pt-5 text-[13px] text-on-night-2">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
            Ambiente de demonstração: os dados voltam ao padrão sempre que o servidor reinicia.
          </p>
        </div>

        <div className="flex items-center justify-center p-5 sm:p-8">
          <form className="w-full max-w-md" onSubmit={handleSubmit}>
            <div className="mb-6 flex items-center gap-3 xl:hidden">
              <span className="mark">
                <GraduationCap className="h-[22px] w-[22px]" aria-hidden />
              </span>
              <p className="brand-name text-ink">Agenda Acadêmica</p>
            </div>

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

            <h2 className="disp text-[30px] font-bold leading-tight">
              {mode === "login" ? "Entrar" : "Criar minha conta"}
            </h2>
            <p className="mt-2 text-[14.5px] leading-6 text-muted">
              {mode === "login"
                ? "Use seu e-mail ou escolha uma conta de demonstração."
                : "Crie uma conta para acompanhar prazos e configurar lembretes."}
            </p>

            <div className="mt-5 grid gap-3">
              {mode === "signup" ? (
                <>
                  <Field label="Nome completo">
                    <input
                      className="input"
                      value={signupForm.fullName}
                      onChange={(event) =>
                        setSignupForm({ ...signupForm, fullName: event.target.value })
                      }
                      autoComplete="name"
                      required
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Matrícula" hint="opcional">
                      <input
                        className="input"
                        value={signupForm.registration}
                        onChange={(event) =>
                          setSignupForm({ ...signupForm, registration: event.target.value })
                        }
                        placeholder="ALU-000"
                      />
                    </Field>
                    <Field label="Perfil">
                      <select
                        className="input"
                        value={signupForm.role}
                        onChange={(event) =>
                          setSignupForm({
                            ...signupForm,
                            role: event.target.value as "student" | "teacher",
                          })
                        }
                      >
                        <option value="student">Aluno</option>
                        <option value="teacher">Professor</option>
                      </select>
                    </Field>
                  </div>
                </>
              ) : null}

              <Field label="E-mail">
                <input
                  className="input"
                  value={mode === "login" ? loginForm.email : signupForm.email}
                  onChange={(event) =>
                    mode === "login"
                      ? setLoginForm({ ...loginForm, email: event.target.value })
                      : setSignupForm({ ...signupForm, email: event.target.value })
                  }
                  type="email"
                  autoComplete="email"
                  required
                />
              </Field>

              <Field label="Senha" hint={mode === "signup" ? "mínimo de 8 caracteres" : undefined}>
                <span className="relative block">
                  <input
                    className="input pr-11"
                    value={mode === "login" ? loginForm.password : signupForm.password}
                    onChange={(event) =>
                      mode === "login"
                        ? setLoginForm({ ...loginForm, password: event.target.value })
                        : setSignupForm({ ...signupForm, password: event.target.value })
                    }
                    type={passwordType}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={mode === "signup" ? 8 : undefined}
                    maxLength={mode === "signup" ? 32 : undefined}
                    required
                  />
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-ink"
                    onClick={() => setShowPassword((current) => !current)}
                    title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    type="button"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </span>
              </Field>

              {mode === "signup" ? (
                <Field label="Confirmar senha">
                  <input
                    className="input"
                    value={signupForm.passwordConfirmation}
                    onChange={(event) =>
                      setSignupForm({ ...signupForm, passwordConfirmation: event.target.value })
                    }
                    type={passwordType}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={32}
                    required
                  />
                </Field>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="callout rose pop mt-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            ) : null}

            <button className={cx(primaryButton, "mt-5 h-11 w-full")} disabled={loading} type="submit">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : mode === "login" ? (
                <UserRound className="h-4 w-4" aria-hidden />
              ) : (
                <UserPlus className="h-4 w-4" aria-hidden />
              )}
              {mode === "login" ? "Entrar" : "Criar conta e entrar"}
            </button>

            {loading && slow ? (
              <p role="status" className="mt-3 text-center text-xs text-muted">
                O servidor estava em repouso e está voltando. No primeiro acesso isso leva até um minuto.
              </p>
            ) : null}

            {mode === "login" ? (
              <div className="mt-7">
                <p className="eyebrow flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Contas de demonstração
                </p>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                  {demoAccounts.map((account, index) => {
                    const on = loginForm.email === account.email;
                    const Icon = [GraduationCap, BookOpen, ShieldCheck][index % 3];
                    const tone = ["bg-brand-50 text-brand", "bg-[#EDE9FE] text-[#5B21B6]", "bg-[#DBEAFE] text-[#1E40AF]"][index % 3];
                    return (
                      <button
                        key={account.email}
                        type="button"
                        title={`Usar conta ${account.label}`}
                        aria-pressed={on}
                        onClick={() => setLoginForm({ email: account.email, password: account.password })}
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
    </main>
  );
}
