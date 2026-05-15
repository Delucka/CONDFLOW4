// Parser do RelCondominios.pdf → lista (codigo, nome, plano_codigo)
const fs = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, 'extracted/condominios.txt');
const OUTPUT = path.join(__dirname, 'extracted/condominios.json');

const text = fs.readFileSync(INPUT, 'utf-8');
const lines = text.split(/\r?\n/);

// Padrões:
//   "Condomínio: 0002 - COND. ED. CAIOBA   Gerente: 0016 - ALINE BULARA"
//   "Plano de contas: 1 - P. DE CONTAS PADRÃO"
const CONDO_REGEX = /^Condomínio:\s*(\d{4})\s*-\s*(.+?)(?:\s{2,}|\s+Gerente:|$)/;
const PLANO_REGEX = /Plano de contas:\s*(\d+)\s*-\s*(.+?)\s*$/;
const GERENTE_REGEX = /Gerente:\s*(\d+)\s*-\s*(.+?)\s*$/;

// Dedup por código: cada condomínio aparece várias vezes no PDF.
// Acumula info em um Map e só sobrescreve campo quando o valor novo é mais "completo"
const byCode = new Map();
let currentCode = null;

for (const raw of lines) {
  const line = raw.replace(/\s+$/, '');
  const trimmed = line.trim();
  if (!trimmed) continue;

  const condoMatch = line.match(CONDO_REGEX);
  if (condoMatch) {
    currentCode = condoMatch[1];
    if (!byCode.has(currentCode)) {
      byCode.set(currentCode, {
        codigo: currentCode,
        nome: condoMatch[2].trim(),
        plano_codigo: null,
        plano_nome: null,
        gerente_codigo: null,
        gerente_nome: null,
      });
    }
    const c = byCode.get(currentCode);
    // Atualiza gerente se a linha tem (algumas linhas têm, outras não)
    const gerMatch = line.match(GERENTE_REGEX);
    if (gerMatch && !c.gerente_codigo) {
      c.gerente_codigo = gerMatch[1];
      c.gerente_nome   = gerMatch[2].trim();
    }
    continue;
  }

  if (!currentCode) continue;
  const c = byCode.get(currentCode);
  if (!c) continue;

  const planoMatch = trimmed.match(PLANO_REGEX);
  if (planoMatch && !c.plano_codigo) {
    c.plano_codigo = planoMatch[1];
    c.plano_nome   = planoMatch[2].trim();
  }
}

const condos = [...byCode.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));

fs.writeFileSync(OUTPUT, JSON.stringify(condos, null, 2));

// Stats
const semPlano = condos.filter(c => !c.plano_codigo).length;
const porPlano = {};
for (const c of condos) {
  const k = c.plano_codigo || 'SEM_PLANO';
  porPlano[k] = (porPlano[k] || 0) + 1;
}

console.log(`\n✅ ${condos.length} condomínios extraídos`);
console.log(`   sem plano definido: ${semPlano}`);
console.log('\n📊 Distribuição por plano:');
for (const [k, n] of Object.entries(porPlano).sort()) {
  console.log(`   plano ${k}: ${n} condomínios`);
}
console.log(`\n📄 JSON: ${OUTPUT}`);
console.log('\nAmostra dos primeiros 5:');
condos.slice(0, 5).forEach(c => {
  console.log(`  ${c.codigo} | ${c.nome.padEnd(40)} → plano ${c.plano_codigo || '—'}`);
});
