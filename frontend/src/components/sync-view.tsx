"use client";

import {
  CheckCircle2,
  CloudDownload,
  FileJson,
  History,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import type { CalendarImportInput } from "@/lib/api";
import { cx, formatDate } from "@/lib/format";
import type { AcademicEvent, CalendarImport } from "@/lib/types";
import { EmptyState, Field, SectionTitle, primaryButton, secondaryButton } from "./ui";

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

const exampleJson = `{
  "sourceName": "Calendário oficial 2026/1",
  "events": [
    {
      "title": "Início do semestre letivo",
      "category": "institutional",
      "startsAt": "2026-08-03T07:00"
    }
  ]
}`;

export function SyncView({
  events,
  imports,
  isAdmin,
  saving,
  onImportDemo,
  onImportJson,
}: {
  events: AcademicEvent[];
  imports: CalendarImport[];
  isAdmin: boolean;
  saving: boolean;
  onImportDemo: () => void;
  onImportJson: (payload: CalendarImportInput) => void;
}) {
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const officialCount = events.filter(
    (event) => event.source === "imported" || event.source === "official" || event.officialPriority
  ).length;
  const lastImport = imports[0] ?? null;

  function submitJson() {
    setJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setJsonError("JSON inválido. Confira a sintaxe e tente novamente.");
      return;
    }

    const payload: CalendarImportInput = Array.isArray(parsed)
      ? { sourceName: "Calendário oficial (colado)", events: parsed as CalendarImportInput["events"] }
      : (parsed as CalendarImportInput);

    if (!payload.sourceName || !Array.isArray(payload.events) || !payload.events.length) {
      setJsonError('O JSON precisa conter "sourceName" e uma lista "events" com ao menos um evento.');
      return;
    }

    onImportJson(payload);
    setJsonText("");
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="surface p-5">
          <SectionTitle
            eyebrow="Sincronização"
            icon={RefreshCw}
            title="Calendário oficial da reitoria"
            subtitle="Datas institucionais entram como prioridade e aparecem para todos os usuários"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <StatusTile label="Fonte" value="IFMS" />
            <StatusTile
              label="Última importação"
              value={lastImport ? formatDate(lastImport.importedAt) : "Nunca"}
            />
            <StatusTile label="Eventos oficiais" value={String(officialCount)} />
          </div>

          {isAdmin ? (
            <div className="mt-5 grid gap-4">
              <div className="flex flex-wrap gap-2">
                <button className={primaryButton} disabled={saving} onClick={onImportDemo} type="button">
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <CloudDownload className="h-4 w-4" aria-hidden />
                  )}
                  Importar calendário de demonstração
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <Field
                  label="Importar JSON personalizado"
                  hint='formato: { "sourceName", "events": [...] }'
                >
                  <textarea
                    className="input min-h-36 resize-y py-3 font-mono text-xs"
                    value={jsonText}
                    onChange={(event) => setJsonText(event.target.value)}
                    placeholder={exampleJson}
                    spellCheck={false}
                  />
                </Field>
                {jsonError ? (
                  <p
                    role="alert"
                    className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
                  >
                    {jsonError}
                  </p>
                ) : null}
                <button
                  className={cx(secondaryButton, "mt-3")}
                  disabled={saving || !jsonText.trim()}
                  onClick={submitJson}
                  type="button"
                >
                  <FileJson className="h-4 w-4" aria-hidden />
                  Validar e importar JSON
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-500">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Importação restrita à administração
            </div>
          )}
        </div>

        <div className="surface h-fit p-4">
          <SectionTitle
            eyebrow="Permissão"
            icon={ShieldCheck}
            title={isAdmin ? "Acesso liberado" : "Restrito ao admin"}
            subtitle={
              isAdmin
                ? "Você pode importar datas oficiais."
                : "Use uma conta de administração para sincronizar."
            }
          />
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-500">Eventos oficiais atuais</p>
            <p className="mt-3 text-5xl font-semibold tracking-tight text-slate-950">{officialCount}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Datas oficiais prevalecem sobre eventos locais quando houver conflito.
            </p>
          </div>
        </div>
      </section>

      {isAdmin ? (
        <section className="surface p-4">
          <SectionTitle
            eyebrow="Histórico"
            icon={History}
            title="Importações realizadas"
            subtitle="Registro das sincronizações com a fonte institucional"
          />
          {imports.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {imports.map((item, index) => (
                <div
                  key={item.id}
                  className={cx(
                    "grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                    index < imports.length - 1 ? "border-b border-slate-200" : ""
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-950">{item.sourceName}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatDate(item.importedAt)} · {item.totalEvents} evento
                      {item.totalEvents === 1 ? "" : "s"}
                      {item.sourceUrl ? ` · ${item.sourceUrl}` : ""}
                    </p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    {item.status === "completed" ? "Concluída" : item.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState icon={History} text="Nenhuma importação registrada ainda." />
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
