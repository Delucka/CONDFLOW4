// Gera SQL que:
//  1. Insere os 15 gerentes do PDF (sem profile_id por enquanto)
//  2. Vincula cada condomínio ao seu gerente (via codigo do PDF)
const fs = require('fs');
const path = require('path');

const condos = JSON.parse(fs.readFileSync(path.join(__dirname, 'extracted/condominios.json'), 'utf-8'));
const OUTPUT = path.join(__dirname, '../../supabase/migrations/0025_vincula_gerentes_condos.sql');

const esc = (s) => String(s || '').replace(/'/g, "''");

// Extrai gerentes únicos
const byGer = new Map();
for (const c of condos) {
  if (!c.gerente_codigo || !c.gerente_nome) continue;
  if (!byGer.has(c.gerente_codigo)) {
    byGer.set(c.gerente_codigo, {
      codigo: c.gerente_codigo,
      nome:   c.gerente_nome,
    });
  }
}
const gerentes = [...byGer.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));

let sql = `-- ==========================================
-- MIGRATION: Importa gerentes do Ahreas e vincula condomínios
-- 1) Insere os 15 gerentes (sem profile_id — login virá depois)
-- 2) Vincula condominios.gerente_id ao gerente correto
-- 3) Relatório final
-- ==========================================

-- 1) Insere gerentes (idempotente via codigo_externo)
INSERT INTO public.gerentes (codigo_externo, nome) VALUES
`;
sql += gerentes.map(g => `  ('${g.codigo}', '${esc(g.nome)}')`).join(',\n');
sql += `\nON CONFLICT (codigo_externo) DO UPDATE SET nome = EXCLUDED.nome;\n\n`;

// 2) Update condominios → gerente correto
sql += `-- 2) Tabela temp com mapeamento condomínio → gerente
CREATE TEMP TABLE IF NOT EXISTS pdf_condo_ger (
  codigo_condo   INTEGER NOT NULL,
  codigo_gerente VARCHAR(10) NOT NULL
);

DELETE FROM pdf_condo_ger;

INSERT INTO pdf_condo_ger (codigo_condo, codigo_gerente) VALUES
`;

const condoGerValues = condos
  .filter(c => c.gerente_codigo)
  .map(c => `  (${parseInt(c.codigo, 10)}, '${c.gerente_codigo}')`);
sql += condoGerValues.join(',\n') + ';\n\n';

sql += `-- 3) Aplica vínculo nos condomínios já existentes
UPDATE public.condominios c
SET gerente_id = g.id
FROM pdf_condo_ger pcg
JOIN public.gerentes g ON g.codigo_externo = pcg.codigo_gerente
WHERE
  CASE
    WHEN c.name ~ '^[0-9]+' THEN (SUBSTRING(c.name FROM '^[0-9]+'))::int
    ELSE -1
  END = pcg.codigo_condo;

-- 4) RELATÓRIO: condomínios por gerente
SELECT
  g.codigo_externo,
  g.nome,
  COUNT(c.id) AS condominios,
  CASE WHEN g.profile_id IS NULL THEN '🔓 Sem login' ELSE '✅ Com login' END AS status_acesso
FROM public.gerentes g
LEFT JOIN public.condominios c ON c.gerente_id = g.id
GROUP BY g.id, g.codigo_externo, g.nome, g.profile_id
ORDER BY COUNT(c.id) DESC;
`;

fs.writeFileSync(OUTPUT, sql);

console.log(`\n✅ SQL gerado com ${gerentes.length} gerentes e ${condoGerValues.length} vínculos`);
console.log(`📄 ${OUTPUT}\n`);
gerentes.forEach(g => {
  const count = condos.filter(c => c.gerente_codigo === g.codigo).length;
  console.log(`  ${g.codigo} | ${g.nome.padEnd(40)} → ${count} condos`);
});
