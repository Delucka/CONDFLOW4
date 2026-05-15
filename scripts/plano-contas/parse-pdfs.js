// Processa os 4 PDFs convertidos em texto e gera uma migration SQL única com
// os 4 planos de contas (0001 a 0004).
const fs = require('fs');
const path = require('path');

const EXTRACTED_DIR = path.join(__dirname, 'extracted');
const OUTPUT_SQL    = path.join(__dirname, '../../supabase/migrations/0022_plano_0001_data.sql');

// UUIDs determinísticos pra cada plano (mantém estáveis entre runs)
const PLANO_UUIDS = {
  '0001': '00000000-0000-0000-0000-000000000001',
  '0002': '00000000-0000-0000-0000-000000000002',
  '0003': '00000000-0000-0000-0000-000000000003',
  '0004': '00000000-0000-0000-0000-000000000004',
};

const esc = (s) => String(s).replace(/'/g, "''");

// Pattern: nome (sem âncora pra esquerda, mas precisa ter algo) + XX.YYY - ZZ + numero + Receita + (Sintética|Analítica)?
// PDF tem espaços variáveis, então tolerante a múltiplos espaços
const LINE_REGEX = /^\s*(.+?)\s{2,}(\d{2})\.(\d{3})\s*-\s*(\d{2})\s+(\d+)\s+Receita(?:\s+(Sintética|Analítica))?\s*$/;

function parseFile(filePath, expectedCodigo) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/);

  // Acha o nome do plano no header
  let planoNome = null;
  for (const line of lines.slice(0, 20)) {
    const m = line.match(/Plano de Contas:\s*(\d{4})\s*-\s*(.+?)\s*$/);
    if (m) {
      if (m[1] !== expectedCodigo) {
        console.warn(`⚠️  Esperava plano ${expectedCodigo} mas achei ${m[1]} em ${path.basename(filePath)}`);
      }
      planoNome = m[2].trim();
      break;
    }
  }

  const itens = [];
  for (const line of lines) {
    const m = line.match(LINE_REGEX);
    if (!m) continue;
    const [, nome, grupo, sub, ana, reduzido, naturezaRaw] = m;
    const isGrupo = parseInt(sub, 10) === 0 && parseInt(ana, 10) === 0;
    itens.push({
      nome: nome.trim(),
      grupo: parseInt(grupo, 10),
      sub: parseInt(sub, 10),
      ana: parseInt(ana, 10),
      reduzido: parseInt(reduzido, 10),
      natureza: isGrupo ? null : (naturezaRaw || null),
    });
  }

  return { codigo: expectedCodigo, nome: planoNome || `P. CONTAS ${expectedCodigo}`, itens };
}

function genSql() {
  const planos = [
    parseFile(path.join(EXTRACTED_DIR, 'plano1.txt'), '0001'),
    parseFile(path.join(EXTRACTED_DIR, 'plano2.txt'), '0002'),
    parseFile(path.join(EXTRACTED_DIR, 'plano3.txt'), '0003'),
    parseFile(path.join(EXTRACTED_DIR, 'plano4.txt'), '0004'),
  ];

  let sql = `-- ==========================================
-- MIGRATION: Dados completos dos Planos de Contas (gerado automaticamente)
-- Planos: 0001, 0002, 0003, 0004 — extraídos dos PDFs do Ahreas
-- ==========================================

`;

  // Insere os 4 planos
  sql += '-- 1) Planos\n';
  sql += 'INSERT INTO public.planos_contas (id, codigo, nome) VALUES\n';
  sql += planos.map(p => `  ('${PLANO_UUIDS[p.codigo]}', '${p.codigo}', '${esc(p.nome)}')`).join(',\n');
  sql += '\nON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome;\n\n';

  // Limpa itens existentes (pra reapply seguro)
  sql += '-- 2) Limpa itens antigos (idempotente)\n';
  sql += `DELETE FROM public.planos_contas_itens WHERE plano_id IN (\n  ${planos.map(p => `'${PLANO_UUIDS[p.codigo]}'`).join(', ')}\n);\n\n`;

  // Insere itens
  sql += '-- 3) Insere todos os itens\n';
  sql += 'INSERT INTO public.planos_contas_itens (plano_id, codigo_grupo, codigo_subconta, codigo_analitico, codigo_reduzido, nome, natureza, ordem) VALUES\n';

  const allRows = [];
  for (const p of planos) {
    let ordem = 0;
    for (const it of p.itens) {
      ordem++;
      const nat = it.natureza ? `'${esc(it.natureza)}'` : 'NULL';
      allRows.push(`  ('${PLANO_UUIDS[p.codigo]}', ${it.grupo}, ${it.sub}, ${it.ana}, ${it.reduzido}, '${esc(it.nome)}', ${nat}, ${ordem})`);
    }
  }
  sql += allRows.join(',\n') + ';\n\n';

  // Linka parent_id
  sql += `-- 4) Linka parent_id: itens de 2º grau apontam pro grupo da mesma codigo_grupo (sub=0, ana=0)
UPDATE public.planos_contas_itens c
SET parent_id = p.id
FROM public.planos_contas_itens p
WHERE c.plano_id = p.plano_id
  AND p.codigo_grupo = c.codigo_grupo
  AND p.codigo_subconta = 0
  AND p.codigo_analitico = 0
  AND (c.codigo_subconta > 0 OR c.codigo_analitico > 0)
  AND c.parent_id IS NULL;

-- 5) Analíticas (ana > 0) apontam pra sintética irmã (mesma sub, ana=0)
UPDATE public.planos_contas_itens c
SET parent_id = s.id
FROM public.planos_contas_itens s
WHERE c.plano_id = s.plano_id
  AND s.codigo_grupo = c.codigo_grupo
  AND s.codigo_subconta = c.codigo_subconta
  AND s.codigo_analitico = 0
  AND s.codigo_subconta > 0
  AND c.codigo_analitico > 0;
`;

  fs.writeFileSync(OUTPUT_SQL, sql);

  // Stats
  console.log('\n✅ Migration gerada:\n');
  for (const p of planos) {
    const grupos = p.itens.filter(i => i.sub === 0 && i.ana === 0).length;
    const sint   = p.itens.filter(i => i.sub > 0 && i.ana === 0).length;
    const ana    = p.itens.filter(i => i.ana > 0).length;
    console.log(`  Plano ${p.codigo} — ${p.nome}: ${p.itens.length} itens (${grupos} grupos, ${sint} sintéticas, ${ana} analíticas)`);
  }
  console.log(`\n📄 SQL: ${OUTPUT_SQL}`);
}

genSql();
