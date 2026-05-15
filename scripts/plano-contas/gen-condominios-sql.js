// Gera SQL que:
//  1. Atualiza plano_contas_id dos condomínios JÁ existentes (match por código)
//  2. Insere os que NÃO existem (com o plano correto)
//  3. Imprime relatório no final
const fs = require('fs');
const path = require('path');

const condos = JSON.parse(fs.readFileSync(path.join(__dirname, 'extracted/condominios.json'), 'utf-8'));
const OUTPUT = path.join(__dirname, '../../supabase/migrations/0023_condominios_planos.sql');

const esc = (s) => String(s || '').replace(/'/g, "''");

let sql = `-- ==========================================
-- MIGRATION: Vincula 321 condomínios aos seus planos de contas
-- 1. Atualiza condomínios já existentes (match por código do nome)
-- 2. Insere os condomínios faltantes (criando novos)
-- 3. Reporta resultado final
-- ==========================================

-- Tabela temporária com a base do PDF Ahreas
CREATE TEMP TABLE IF NOT EXISTS pdf_condos (
  codigo_pdf   INTEGER NOT NULL,
  nome_pdf     TEXT NOT NULL,
  plano_codigo VARCHAR(10) NOT NULL
);

DELETE FROM pdf_condos;

INSERT INTO pdf_condos (codigo_pdf, nome_pdf, plano_codigo) VALUES
`;

const values = condos.map(c => {
  const codigo  = parseInt(c.codigo, 10);
  const plano   = String(c.plano_codigo).padStart(4, '0');
  return `  (${codigo}, '${esc(c.nome)}', '${plano}')`;
});
sql += values.join(',\n') + ';\n\n';

sql += `-- 1) UPDATE: atualiza plano_contas_id dos condomínios cujo código bate
UPDATE public.condominios c
SET plano_contas_id = pc.id
FROM pdf_condos pdf
JOIN public.planos_contas pc ON pc.codigo = pdf.plano_codigo
WHERE
  CASE
    -- Extrai número do início do name (ex: "066 - COND. ED. LUCRECIA" → 66)
    WHEN c.name ~ '^[0-9]+' THEN (SUBSTRING(c.name FROM '^[0-9]+'))::int
    ELSE -1
  END = pdf.codigo_pdf;

-- 2) INSERT: insere os faltantes (que não tinham match)
INSERT INTO public.condominios (name, plano_contas_id, due_day)
SELECT
  LPAD(pdf.codigo_pdf::text, 3, '0') || ' - ' || pdf.nome_pdf,
  pc.id,
  1
FROM pdf_condos pdf
JOIN public.planos_contas pc ON pc.codigo = pdf.plano_codigo
WHERE NOT EXISTS (
  SELECT 1 FROM public.condominios c
  WHERE
    CASE
      WHEN c.name ~ '^[0-9]+' THEN (SUBSTRING(c.name FROM '^[0-9]+'))::int
      ELSE -1
    END = pdf.codigo_pdf
);

-- 3) RELATÓRIO: contagem por plano
SELECT
  pc.codigo,
  pc.nome,
  COUNT(c.id) AS total_condos
FROM public.planos_contas pc
LEFT JOIN public.condominios c ON c.plano_contas_id = pc.id
GROUP BY pc.id, pc.codigo, pc.nome
ORDER BY pc.codigo;
`;

fs.writeFileSync(OUTPUT, sql);

console.log(`\n✅ SQL gerado com ${condos.length} condomínios:`);
const porPlano = {};
for (const c of condos) {
  const k = String(c.plano_codigo).padStart(4, '0');
  porPlano[k] = (porPlano[k] || 0) + 1;
}
for (const [k, n] of Object.entries(porPlano).sort()) {
  console.log(`   plano ${k}: ${n} condomínios`);
}
console.log(`\n📄 ${OUTPUT}`);
