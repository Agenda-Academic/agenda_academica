// Roda com: npm test (node --test). O Node 24 lê o .ts direto.
// A camada de fuso tem que dar o MESMO resultado qualquer que seja o relógio do computador.
import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTITUTION_ZONE,
  instantIso,
  instantOfWall,
  mapInstants,
  wallDateOf,
  wallIso,
  zonedDate,
  zonedNow,
} from "../src/lib/zone.ts";

// fusos do computador de quem abre a Agenda: MS certo, Brasília (relógio errado), UTC, Japão (+9), Manaus,
// e Nova York (tem horário de verão: confere que a conversão também fecha lá)
const COMPUTER_ZONES = ["America/Campo_Grande", "America/Sao_Paulo", "UTC", "Asia/Tokyo", "America/Manaus", "America/New_York"];

const fields = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];

// o relógio de MS calculado de outro jeito, sem passar pelo código testado
function msClock(epochMs) {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: INSTITUTION_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(epochMs);
  return text.replace(",", "").split(/[-: ]+/).map(Number);
}

function inComputerZone(zone, run) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    // garante que o relógio do computador mudou de fato (senão o teste não prova nada)
    assert.equal(
      new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).resolvedOptions().timeZone,
      zone,
      `o TZ=${zone} não pegou`,
    );
    run();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

for (const zone of COMPUTER_ZONES) {
  test(`computador em ${zone}: 23:00 UTC é 19:00 em MS, em qualquer relógio`, () => {
    inComputerZone(zone, () => {
      const wall = wallDateOf(Date.UTC(2026, 10, 26, 23, 0, 0));
      assert.deepEqual(fields(wall), [2026, 11, 26, 19, 0, 0]);
    });
  });

  test(`computador em ${zone}: instante → hora de MS → instante fecha, inclusive na virada do dia e do ano`, () => {
    inComputerZone(zone, () => {
      const samples = [
        Date.UTC(2026, 10, 26, 23, 0, 0),
        Date.UTC(2027, 0, 1, 4, 0, 0), // 00:00 de 01/01 em MS (feriado do PDF)
        Date.UTC(2026, 11, 31, 3, 59, 59), // 23:59:59 de 30/12 em MS
        Date.UTC(2026, 6, 15, 12, 34, 56, 789), // julho, no meio do dia (fora de qualquer "buraco" de horário de verão)
        Date.UTC(2026, 11, 1, 0, 0, 0, 1),
      ];
      for (const ms of samples) {
        assert.equal(instantOfWall(wallDateOf(ms)), ms, `ida e volta de ${new Date(ms).toISOString()}`);
        assert.deepEqual(fields(wallDateOf(ms)), msClock(ms).slice(0, 6), `campos de ${new Date(ms).toISOString()}`);
      }
    });
  });

  test(`computador em ${zone}: o ISO que a API manda vira a hora de MS no new Date(), e volta igual`, () => {
    inComputerZone(zone, () => {
      const fromApi = "2026-11-26T22:00:00.000+00:00"; // 18:00 em MS (a prova do seed, que foi gravada às 19:00 de Brasília)
      const wall = new Date(wallIso(fromApi));
      assert.deepEqual(fields(wall), [2026, 11, 26, 18, 0, 0]);
      assert.equal(instantIso(wallIso(fromApi)), "2026-11-26T22:00:00.000Z");
    });
  });

  test(`computador em ${zone}: feriado do PDF (00:00 de MS) aparece como dia todo no dia certo`, () => {
    inComputerZone(zone, () => {
      const wall = new Date(wallIso("2027-01-01T04:00:00.000Z"));
      assert.deepEqual(fields(wall), [2027, 1, 1, 0, 0, 0]);
    });
  });

  test(`computador em ${zone}: o que o editor monta com datetime-local sai como o instante certo para o servidor`, () => {
    inComputerZone(zone, () => {
      // o campo datetime-local entrega "2026-11-23T10:00" e o editor faz new Date(texto).toISOString()
      const sent = instantIso(new Date("2026-11-23T10:00").toISOString());
      assert.equal(sent, "2026-11-23T14:00:00.000Z"); // 10:00 de MS = 14:00 UTC
    });
  });

  test(`computador em ${zone}: zonedNow() mostra a hora de MS de agora`, () => {
    inComputerZone(zone, () => {
      // as três leituras são só relógio de MS; vira uma "hora UTC" qualquer para poder comparar (antes <= agora <= depois)
      const asNumber = (f) => Date.UTC(f[0], f[1] - 1, f[2], f[3], f[4], f[5]);
      const before = asNumber(msClock(Date.now()));
      const now = asNumber(fields(zonedNow()));
      const after = asNumber(msClock(Date.now()));
      assert.ok(before <= now && now <= after, `agora ${now} fora de ${before}..${after}`);
    });
  });

  test(`computador em ${zone}: zonedDate() converte um instante real que não veio da API`, () => {
    inComputerZone(zone, () => {
      assert.deepEqual(fields(zonedDate(Date.UTC(2026, 10, 26, 23, 0, 0))), [2026, 11, 26, 19, 0, 0]);
    });
  });
}

test("mapInstants troca só instantes ISO e deixa o resto como está", () => {
  const out = mapInstants(
    {
      startsAt: "2026-11-26T23:00:00.000Z",
      endsAt: null,
      day: "2027-01-01", // data pura: fica
      field: "2026-11-23T10:00", // datetime-local, sem fuso: fica
      title: "Prova de 2026-11-26T23:00:00.000Z em aberto", // texto que só contém uma data: fica
      nested: [{ at: "2026-11-26T23:00:00+00:00" }, 7, true],
      plain: new Date(0),
    },
    (iso) => `<${iso}>`,
  );
  assert.equal(out.startsAt, "<2026-11-26T23:00:00.000Z>");
  assert.equal(out.endsAt, null);
  assert.equal(out.day, "2027-01-01");
  assert.equal(out.field, "2026-11-23T10:00");
  assert.equal(out.title, "Prova de 2026-11-26T23:00:00.000Z em aberto");
  assert.equal(out.nested[0].at, "<2026-11-26T23:00:00+00:00>");
  assert.deepEqual(out.nested.slice(1), [7, true]);
  assert.ok(out.plain instanceof Date, "objetos que não são JSON puro (Date, File) passam sem mexer");
});

test("um ISO inválido passa sem quebrar", () => {
  assert.equal(wallIso("2026-13-45T99:00:00Z"), "2026-13-45T99:00:00Z");
  assert.equal(instantIso("não é data"), "não é data");
});
