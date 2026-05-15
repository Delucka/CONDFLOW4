const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'plano-0001-raw.txt'), 'utf-8');
const lines = raw.split('\n').filter(l => l.trim());

// Escapa apóstrofo no SQL
const esc = (s) => String(s).replace(/'/g, "''");

const PLANO_ID = '00000000-0000-0000-0000-000000000001'; // UUID fixo

const planoSql = `INSERT INTO public.planos_contas (id, codigo, nome) VALUES ('${PLANO_ID}', '0001', 'P. DE CONTAS PADRÃO') ON CONFLICT (codigo) DO NOTHING;\n\n`;

// Agrupa por grupo
const grupos = new Map();
for (const line of lines) {
  const [nome, codGrupo, codSub, codRed, tipo, natRaw] = line.split('|');
  const grupo = parseInt(codGrupo.split('.')[0], 10);
  const sub = parseInt(codGrupo.split('.')[1], 10);
  const ana = parseInt(codSub, 10);
  const reduzido = parseInt(codRed, 10);
  const natureza = natRaw && natRaw.trim() ? natRaw.trim() : null;
  if (!grupos.has(grupo)) grupos.set(grupo, []);
  grupos.get(grupo).push({ nome: nome.trim(), grupo, sub, ana, reduzido, natureza });
}

let sql = planoSql;
sql += '-- Insere todos os itens (grupos primeiro, depois sintéticas, depois analíticas)\n';
sql += 'INSERT INTO public.planos_contas_itens (plano_id, codigo_grupo, codigo_subconta, codigo_analitico, codigo_reduzido, nome, natureza, ordem) VALUES\n';

const values = [];
let ordem = 0;
for (const [, items] of [...grupos.entries()].sort((a, b) => a[0] - b[0])) {
  for (const it of items) {
    ordem++;
    const nat = it.natureza ? `'${esc(it.natureza)}'` : 'NULL';
    values.push(`  ('${PLANO_ID}', ${it.grupo}, ${it.sub}, ${it.ana}, ${it.reduzido}, '${esc(it.nome)}', ${nat}, ${ordem})`);
  }
}
sql += values.join(',\n') + '\nON CONFLICT (plano_id, codigo_grupo, codigo_subconta, codigo_analitico) DO NOTHING;\n';

// Atualiza parent_id (sintética/analítica apontam pro grupo, analítica aponta pra sintética se houver)
sql += `
-- Linka parent_id: itens de 2º grau apontam para o grupo (codigo_subconta=0, codigo_analitico=0)
UPDATE public.planos_contas_itens c
SET parent_id = p.id
FROM public.planos_contas_itens p
WHERE c.plano_id = p.plano_id
  AND c.plano_id = '${PLANO_ID}'
  AND p.codigo_grupo = c.codigo_grupo
  AND p.codigo_subconta = 0
  AND p.codigo_analitico = 0
  AND (c.codigo_subconta > 0 OR c.codigo_analitico > 0)
  AND c.parent_id IS NULL;

-- Analíticas (codigo_analitico > 0) apontam para sua sintética irmã (mesmo grupo + mesma subconta + analítico=0)
UPDATE public.planos_contas_itens c
SET parent_id = s.id
FROM public.planos_contas_itens s
WHERE c.plano_id = s.plano_id
  AND c.plano_id = '${PLANO_ID}'
  AND s.codigo_grupo = c.codigo_grupo
  AND s.codigo_subconta = c.codigo_subconta
  AND s.codigo_analitico = 0
  AND s.codigo_subconta > 0
  AND c.codigo_analitico > 0;
`;

fs.writeFileSync(path.join(__dirname, '../../supabase/migrations/0022_plano_0001_data.sql'), sql);
console.log(`✓ Generated SQL with ${ordem} itens across ${grupos.size} grupos`);
