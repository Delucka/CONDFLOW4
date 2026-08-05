import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ── no-undef: a checagem que o build NÃO faz ──
  // `npm run build` compila JSX sem reclamar de identificador que não existe:
  // `{cond && foo}` com `foo` inexistente vira ReferenceError só no navegador,
  // e o error boundary come a tela inteira. Aconteceu em 05/08/2026 — a Central
  // de Emissões caiu inteira porque sobrou um `isPronto` depois que a
  // declaração dele foi removida. Build passou verde, deploy foi, tela morreu.
  //
  // A config do Next não liga essa regra: ela pressupõe TypeScript, que pega o
  // mesmo erro no compilador. Este projeto é JS puro, então aqui ela é a única
  // rede.
  {
    files: ["src/**/*.{js,jsx,mjs}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: { "no-undef": "error" },
  },
]);

export default eslintConfig;
