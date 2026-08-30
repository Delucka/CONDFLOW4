import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const supabaseChecarErro = require("./eslint-rules/supabase-checar-erro.js");

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
    rules: {
      "no-undef": "error",

      // ── Zona morta do const: o build passa, a tela morre ──
      //
      // `const x = data?.y` colocado ACIMA do `const data = useSWR(...)` compila
      // sem reclamar e explode no navegador com "Cannot access before
      // initialization" — o error boundary come a tela inteira e o usuario ve
      // "Ops! Algo deu errado".
      //
      // Aconteceu DUAS vezes em 30/08/2026, no mesmo dia: no Painel Central
      // (`concessionariasPorCondo` lendo `data`) e na planilha (um useEffect
      // lendo `canEdit`). O padrao e sempre o mesmo — inserir um bloco novo
      // perto do topo do componente e referenciar algo que nasce mais abaixo.
      //
      // `functions: false` porque declaracao de funcao e icada de verdade:
      // chamar uma funcao declarada abaixo e correto e comum aqui.
      "no-use-before-define": ["error", {
        functions: false,
        classes: true,
        variables: true,
        allowNamedExports: false,
      }],
    },
  },

  // ── Escrita no Supabase tem que ler o { error } ──
  // A classe de defeito mais cara deste projeto: `supabase-js` DEVOLVE o erro
  // em vez de lançar, então `await supabase.from(x).insert(...)` sem ler o
  // retorno transforma recusa do banco em "deu certo". Três incidentes até
  // hoje — `assistente`, `fluxo` (todo processo aprovado direto, pulando os
  // supervisores, por meses) e o anexo de boleto que ia para o bucket sem
  // registro. Nenhum deu erro em lugar nenhum.
  //
  // A regra mora em eslint-rules/ e foi testada contra os dois casos: acusa as
  // escritas soltas, ignora as que leem o erro, as que devolvem o resultado e
  // as do storage (outra API).
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { condoflow: { rules: { "supabase-checar-erro": supabaseChecarErro } } },
    rules: { "condoflow/supabase-checar-erro": "error" },
  },
]);

export default eslintConfig;
