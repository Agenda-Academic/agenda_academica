"use client";

import { Building2, CheckCircle2, CloudDownload, FileJson, History, Loader2, ShieldCheck } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { CalendarImportInput } from "@/lib/api";
import { cx, formatDate } from "@/lib/format";
import type { AcademicEvent, CalendarImport } from "@/lib/types";
import { InsightTile, delay } from "./dashboard-bits";
import { EmptyState, Field, SectionTitle } from "./ui";

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

  // Validação ao vivo do JSON colado, como no protótipo.
  const jsonStatus = useMemo(() => {
    if (!jsonText.trim()) {
      return { tone: "muted", text: 'Formato: { "sourceName": "...", "events": [ ... ] } ou só a lista de eventos.' };
    }
    try {
      const parsed = JSON.parse(jsonText);
      const list = Array.isArray(parsed) ? parsed : parsed?.events;
      if (!Array.isArray(list) || !list.length) {
        return { tone: "err", text: 'Falta a lista "events" com ao menos um evento.' };
      }
      return { tone: "ok", text: `JSON válido · ${list.length} evento${list.length === 1 ? "" : "s"} pronto${list.length === 1 ? "" : "s"} para importar.` };
    } catch {
      return { tone: "err", text: "JSON inválido. Confira vírgulas, aspas e chaves." };
    }
  }, [jsonText]);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <InsightTile icon={Building2} label="Fonte" value="IFMS" hint="calendário da reitoria" order={0} />
        <InsightTile
          icon={History}
          label="Última importação"
          value={lastImport ? formatDate(lastImport.importedAt) : "Nunca"}
          tone="c-ativ"
          hint={lastImport ? lastImport.sourceName : "nenhuma sincronização ainda"}
          order={1}
        />
        <InsightTile icon={ShieldCheck} label="Datas oficiais" value={String(officialCount)} tone="c-inst" hint="prevalecem sobre eventos locais" order={2} />
      </div>

      <div className="board" style={{ "--row": "530px" } as CSSProperties}>
        <section className="card pad rise" style={delay(3)} aria-label="Importar calendário">
          <SectionTitle
            eyebrow="Sincronização"
            title="Calendário oficial da reitoria"
            subtitle="Datas institucionais entram com prioridade e aparecem para todos os usuários."
          />
          {isAdmin ? (
            <div className="scroll mt-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-line-2 bg-surface-2 p-4">
                <span className="kpi-ico">
                  <CloudDownload className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold">Calendário de demonstração</p>
                  <p className="sub !mt-0.5">Datas institucionais de exemplo para testes e apresentações.</p>
                </div>
                <button className="btn btn-p" disabled={saving} onClick={onImportDemo} type="button">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudDownload className="h-4 w-4" aria-hidden />}
                  Importar
                </button>
              </div>

              <div className="rounded-2xl border border-line-2 bg-surface-2 p-4">
                <Field label="Importar JSON personalizado" hint="cole o arquivo da reitoria">
                  <textarea
                    className="input min-h-36 font-mono text-xs"
                    value={jsonText}
                    onChange={(event) => {
                      setJsonText(event.target.value);
                      setJsonError(null);
                    }}
                    placeholder={exampleJson}
                    spellCheck={false}
                  />
                </Field>
                <p
                  role={jsonError ? "alert" : "status"}
                  className={cx(
                    "field-help flex items-center gap-1.5",
                    (jsonError || jsonStatus.tone === "err") && "font-semibold text-[#B4234A]",
                    !jsonError && jsonStatus.tone === "ok" && "font-semibold text-brand-ink"
                  )}
                >
                  {!jsonError && jsonStatus.tone === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : null}
                  {jsonError ?? jsonStatus.text}
                </p>
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-s" disabled={saving || jsonStatus.tone !== "ok"} onClick={submitJson} type="button">
                    <FileJson className="h-4 w-4" aria-hidden />
                    Validar e importar JSON
                  </button>
                  {jsonText ? (
                    <button className="btn btn-s" onClick={() => setJsonText("")} type="button">
                      Limpar
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="callout amber mt-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Importação restrita à administração. Você continua vendo o calendário oficial no cronograma.
            </p>
          )}
        </section>

        <section className="card pad rise" style={delay(4)} aria-label="Permissão">
          <SectionTitle
            eyebrow="Permissão"
            title={isAdmin ? "Acesso liberado" : "Restrito à administração"}
            subtitle={isAdmin ? "Você pode importar datas oficiais." : "Use uma conta de administração para sincronizar."}
          />
          <div className="scroll mt-4">
            <div className="rounded-2xl bg-night p-5 text-white">
              <p className="eyebrow !text-on-night-2">Eventos oficiais atuais</p>
              <p className="disp mt-2 text-[56px] font-bold leading-none text-accent">{officialCount}</p>
              <p className="mt-3 text-[13px] leading-5 text-on-night">
                Datas oficiais prevalecem sobre eventos locais quando houver conflito.
              </p>
            </div>
          </div>
        </section>
      </div>

      {isAdmin ? (
        <section className="card pad rise" style={delay(5)} aria-label="Importações realizadas">
          <SectionTitle eyebrow="Histórico" title="Importações realizadas" subtitle="Registro das sincronizações com a fonte institucional" />
          {imports.length ? (
            <div className="scroll mt-4 max-h-[420px] overflow-x-auto rounded-2xl border border-line">
              <table className="tbl min-w-[620px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Fonte</th>
                    <th>Data</th>
                    <th>Eventos</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((item) => (
                    <tr key={item.id} className="transition hover:bg-surface-2">
                      <td>
                        <p className="t">{item.sourceName}</p>
                        {item.sourceUrl ? <p className="s truncate">{item.sourceUrl}</p> : null}
                      </td>
                      <td className="whitespace-nowrap">{formatDate(item.importedAt)}</td>
                      <td>{item.totalEvents}</td>
                      <td>
                        <span className="pill st-conc">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          {item.status === "completed" ? "Concluída" : item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState icon={History} text="Nenhuma importação registrada ainda." hint="Importe o calendário de demonstração para testar." />
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
