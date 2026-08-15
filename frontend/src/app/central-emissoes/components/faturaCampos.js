/**
 * Nome padronizado do arquivo de fatura/relatório, e as conversões de número
 * que ele usa.
 *
 * Saiu do VisaoEmissor (3.273 linhas) porque não é tela: são três funções puras,
 * sem estado e sem React. Ficar no meio do componente só as escondia — e foi num
 * arquivo desse tamanho que os dois defeitos desta semana passaram batido, ambos
 * de coisas que dá para ver quando o arquivo cabe na cabeça.
 */

// Gera nome de arquivo padronizado a partir dos dados extraídos/revisados.
// Fatura:    "0066 - LUCRECIA - SABESP - 25-05-2026 - R$ 11.108,90.pdf"
// Relatório: "0374 - ROSSINI - PROSPER - agua - R$ 13.900,49.pdf"
// `src` pode ser o dict da extração OU o objeto de extras (lê chaves de ambos).
export function nomeArquivoPadrao(categoria, subtipo, src, originalName, condoName) {
  try {
    const ext = (String(originalName || '').split('.').pop() || 'pdf').toLowerCase();
    const m = String(condoName || '').match(/^\s*(\d+)\s*[-–]?\s*(.*)$/);
    const numero = m ? m[1].padStart(4, '0') : '';
    const nome = (m ? m[2] : (condoName || '')).trim().toUpperCase();
    const venc = src?.vencimento || src?.vencimento_fatura || null;
    const valor = src?.valor ?? src?.valor_total ?? src?.valor_fatura ?? src?.relatorio_valor_total ?? null;
    const servico = src?.tipo_servico || src?.relatorio_tipo_servico || null;

    const partes = [numero, nome, String(subtipo || '').toUpperCase()].filter(Boolean);
    if (categoria === 'relatorio_leitura' && servico) partes.push(servico);
    let base = partes.join(' - ');
    if (venc) base += ` - ${String(venc).split('-').reverse().join('-')}`; // YYYY-MM-DD -> DD-MM-YYYY
    if (valor != null) base += ` - R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    base = base.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim();
    return base ? `${base}.${ext}` : (originalName || 'arquivo.pdf');
  } catch {
    return originalName || 'arquivo.pdf';
  }
}

// Converte "1.234,56" (pt-BR) ou "1234.56" em número; null se vazio/ inválido.
export function parseNumBR(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
export function fmtNumBR(n) {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (isNaN(num)) return '';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
