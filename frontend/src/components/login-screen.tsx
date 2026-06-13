"use client";

import {
  Bell,
  CalendarDays,
  Eye,
  EyeOff,
  GraduationCap,
  Loader2,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { login, signup } from "@/lib/api";
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
  const [error, setError] = useState<string | null>(null);

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
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const passwordType = showPassword ? "text" : "password";

  return (
    <main className="min-h-screen bg-login px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-6xl overflow-hidden rounded-2xl border border-white/70 bg-white/90 shadow-2xl shadow-slate-900/10 backdrop-blur xl:grid-cols-[1fr_0.95fr]">
        <div className="relative hidden min-h-[560px] flex-col justify-between overflow-hidden bg-slate-950 p-8 text-white xl:flex">
          <div className="absolute inset-0 opacity-80 [background:linear-gradient(135deg,#0f172a_0%,#064e3b_42%,#312e81_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.96))]" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-emerald-800 shadow-lg shadow-emerald-950/20">
                <GraduationCap className="h-6 w-6" aria-hidden />
              </span>
              <div>
                <p className="text-sm text-emerald-100">Agenda Acadêmica</p>
                <h1 className="text-2xl font-semibold">Painel de prazos do semestre</h1>
              </div>
            </div>

            <div className="mt-12 max-w-xl">
              <p className="text-sm font-medium uppercase tracking-wide text-emerald-200">
                Fonte única de verdade
              </p>
              <h2 className="mt-3 text-4xl font-semibold leading-tight">
                Veja o que importa hoje, esta semana e no calendário oficial.
              </h2>
            </div>

            <div className="mt-10 grid gap-4 text-sm text-emerald-50">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <CalendarDays className="h-4 w-4 text-emerald-200" aria-hidden />
                </span>
                Prazos docentes e datas institucionais no mesmo fluxo
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <Bell className="h-4 w-4 text-emerald-200" aria-hidden />
                </span>
                Lembretes pessoais antes de provas, trabalhos e eventos
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                  <Users className="h-4 w-4 text-emerald-200" aria-hidden />
                </span>
                Visão por perfil para aluno, professor e administração
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center p-5 sm:p-8">
          <form className="w-full max-w-md" onSubmit={handleSubmit}>
            <div className="mb-6 flex items-center gap-3 xl:hidden">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                <GraduationCap className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-lg font-semibold">Agenda Acadêmica</p>
            </div>

            <div className="mb-6 grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
              <button
                className={cx(
                  "flex h-10 items-center justify-center gap-2 rounded-lg transition",
                  mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
                aria-pressed={mode === "login"}
                onClick={() => switchMode("login")}
                type="button"
              >
                <UserRound className="h-4 w-4" aria-hidden />
                Entrar
              </button>
              <button
                className={cx(
                  "flex h-10 items-center justify-center gap-2 rounded-lg transition",
                  mode === "signup" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
                aria-pressed={mode === "signup"}
                onClick={() => switchMode("signup")}
                type="button"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Criar conta
              </button>
            </div>

            <h2 className="text-3xl font-semibold tracking-tight">
              {mode === "login" ? "Entrar na agenda" : "Criar minha conta"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {mode === "login"
                ? "Acesse com sua conta ou use um dos perfis de demonstração abaixo."
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
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
              <div
                role="alert"
                className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
              >
                {error}
              </div>
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

            {mode === "login" ? (
              <div className="mt-6">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Contas de demonstração
                </p>
                <div className="mt-3 grid gap-2">
                  {demoAccounts.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      title={`Usar conta ${account.label}`}
                      onClick={() => setLoginForm({ email: account.email, password: account.password })}
                      className={cx(
                        "flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left transition",
                        loginForm.email === account.email
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      )}
                    >
                      <span>
                        <span className="block text-sm font-semibold text-slate-950">{account.label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">{account.description}</span>
                      </span>
                      <span
                        className={cx(
                          "text-xs font-semibold",
                          loginForm.email === account.email ? "text-emerald-700" : "text-slate-400"
                        )}
                      >
                        {loginForm.email === account.email ? "Selecionada" : "Usar"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </form>
        </div>
      </section>
    </main>
  );
}
