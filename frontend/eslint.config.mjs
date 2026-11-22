import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // A Agenda conta o tempo pelo relógio de Mato Grosso do Sul, não pelo do computador (ver src/lib/zone.ts):
  // ler o relógio do navegador direto desalinha o "agora" das datas que vêm da API.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/zone.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use zonedNow() de @/lib/zone: a Agenda usa a hora de MS, não a do computador.",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Use zonedNowMs() de @/lib/zone: a Agenda usa a hora de MS, não a do computador.",
        },
      ],
    },
  },
]);

export default eslintConfig;
