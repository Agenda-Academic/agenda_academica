// Roda com: npm test (node --test). O Node 24 lê o .ts direto.
// Quem publicou o evento: o texto do detalhe tem que dizer quem foi, sem chamar a administração de docente.
import assert from "node:assert/strict";
import test from "node:test";
import { sourceText } from "../src/lib/meta.ts";

const event = (extra) => ({
  source: "teacher",
  teacherId: null,
  createdById: null,
  teacher: null,
  academicClass: { id: 1, name: "TADS 5" },
  ...extra,
});

test("evento da docente mostra o nome dela", () => {
  const text = sourceText(event({ teacherId: 3, createdById: 3, teacher: { id: 3, fullName: "Maraisa Guerra" } }));
  assert.equal(text, "Publicado por Maraisa Guerra");
});

test("evento de turma publicado pela administração não aparece como de docente", () => {
  assert.equal(sourceText(event({ createdById: 2 })), "Publicado pela administração, para TADS 5");
});

test("evento de turma sem autor conhecido segue como de docente", () => {
  assert.equal(sourceText(event({})), "Publicado por docente");
});

test("evento oficial segue para todas as turmas", () => {
  assert.equal(
    sourceText(event({ source: "official", createdById: 2, academicClass: null })),
    "Publicado pela administração, para todas as turmas"
  );
});
