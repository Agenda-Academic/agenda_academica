/**
 * Fuso da instituição: a Agenda inteira conta o tempo pelo relógio de Mato Grosso do Sul
 * (America/Campo_Grande, UTC-4, sem horário de verão), e não pelo do computador de quem abre.
 * Assim o horário na tela é o mesmo que o servidor escreve nos e-mails e que a secretaria publica,
 * mesmo num computador com o relógio em Brasília ou em outro fuso.
 *
 * COMO FUNCIONA (convenção do front inteiro)
 * Todo `Date` do front é um Date "de parede": os campos LOCAIS dele (getHours, getDate, toLocale...)
 * mostram a hora de MS. Por isso o resto do código continua lendo `new Date(evento.startsAt)` e
 * `getHours()` sem saber de fuso. Duas bordas fazem a conversão, e só elas:
 *  - entrada: `apiFetch` troca cada instante ISO da resposta (`...Z` ou `...+00:00`) pelo ISO de parede
 *    (`wallIso`), e o `new Date(...)` do navegador devolve a hora de MS;
 *  - saída: `apiFetch` faz o inverso em cada instante ISO do corpo (`instantIso`), então o servidor
 *    sempre recebe o instante certo, inclusive o que o editor monta com `new Date(form.startsAt)`.
 * O "agora" também é de parede: use `zonedNow()` / `zonedNowMs()`, nunca `new Date()` ou
 * `Date.now()` (o ESLint barra). Data pura (`2027-01-01`) e `datetime-local` (`2026-11-23T10:00`,
 * sem fuso) não são instantes e passam direto: já significam a hora de MS.
 *
 * LIMITE CONHECIDO: num navegador de fuso COM horário de verão, a hora de MS que cair num "buraco" do
 * relógio local (ex.: 02:30 na virada de março nos EUA) sai 1 hora adiantada. O Brasil não tem horário
 * de verão desde 2019, então isso não atinge o público da Agenda.
 */

export const INSTITUTION_ZONE = "America/Campo_Grande";

const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: INSTITUTION_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

type Clock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** O relógio de MS no instante `epochMs`. */
function clockOf(epochMs: number): Clock {
  const clock: Clock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of clockFormat.formatToParts(epochMs)) {
    if (part.type in clock) {
      clock[part.type as keyof Clock] = Number(part.value);
    }
  }
  return clock;
}

const millisOf = (epochMs: number) => ((epochMs % 1000) + 1000) % 1000;

/** Quanto o relógio de MS está à frente de UTC no instante `epochMs`, em ms (negativo: -4 h). */
function offsetAt(epochMs: number) {
  const c = clockOf(epochMs);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - (epochMs - millisOf(epochMs));
}

/** O instante `epochMs` como Date de parede: os campos locais dele são a hora de MS. */
export function wallDateOf(epochMs: number): Date {
  const c = clockOf(epochMs);
  return new Date(c.year, c.month - 1, c.day, c.hour, c.minute, c.second, millisOf(epochMs));
}

/** Inverso de `wallDateOf`: lê os campos locais de `wall` como hora de MS e devolve o instante real (ms). */
export function instantOfWall(wall: Date): number {
  const asUtc = Date.UTC(
    wall.getFullYear(),
    wall.getMonth(),
    wall.getDate(),
    wall.getHours(),
    wall.getMinutes(),
    wall.getSeconds(),
    wall.getMilliseconds(),
  );
  // a diferença para UTC depende do instante; a segunda passada cobre a hora em que ela muda
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}

/** Agora, como Date de parede (hora de MS). */
export function zonedNow(): Date {
  return wallDateOf(Date.now());
}

/** Agora, em ms de parede: serve para comparar com `new Date(evento.startsAt).getTime()`. */
export function zonedNowMs(): number {
  return zonedNow().getTime();
}

/** Um instante real (ms, Date ou ISO) como Date de parede. Para o que NÃO veio pelo `apiFetch`, como o `lastModified` de um arquivo. */
export function zonedDate(value: number | string | Date): Date {
  return wallDateOf(new Date(value).getTime());
}

/** Instante ISO com fuso: `...Z`, `...+00:00`, `...-04:00`. Data pura e `datetime-local` não entram. */
const INSTANT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Entrada (API → tela): o instante ISO vira o ISO de parede, que o `new Date(...)` lê como hora de MS.
 * Sem cache de propósito: o resultado depende do relógio do computador, e a conta custa ~5 µs (uma
 * lista de mil eventos leva uns 20 ms).
 */
export function wallIso(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : wallDateOf(ms).toISOString();
}

/** Saída (tela → API): o ISO de parede volta a ser o instante real, em UTC. */
export function instantIso(wallValue: string): string {
  const ms = Date.parse(wallValue);
  return Number.isNaN(ms) ? wallValue : new Date(instantOfWall(new Date(ms))).toISOString();
}

/** Aplica `convert` a cada instante ISO dentro de um JSON (objetos, listas e textos), sem mexer no resto. */
export function mapInstants<T>(value: T, convert: (iso: string) => string): T {
  if (typeof value === "string") {
    return (INSTANT_ISO.test(value) ? convert(value) : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapInstants(item, convert)) as T;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = mapInstants(item, convert);
    }
    return out as T;
  }
  return value;
}
