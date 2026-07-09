// Extração de emissão: junta os anexos de um pacote num único PDF, na ordem de auditoria:
// 1 Emissão a processar · 2 Correios · 3 Seguros · 4 Água (fatura+relatório) ·
// 5 Gás (fatura+relatório) · 6 Energia · 7 Cobranças extras e salão · 8 Relatório de rateio.
// Só entra o que foi anexado (sem geração). Só PDF/imagem entram no PDF mesclado.
import { getArquivoUrlSeguro } from '@/lib/arquivo';

const norm = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

// Monta a lista ordenada de itens { arquivo_url|__attachment, arquivo_nome, formato }.
export function ordenarParaExtracao(arquivos = [], cobrancas = []) {
  const usados = new Set();
  const out = [];
  const add = (a) => {
    const key = a.__attachment || a.arquivo_url || a.id;
    if (!key || usados.has(key)) return;
    usados.add(key);
    out.push(a);
  };

  const porCat = (cat) => arquivos.filter((a) => a.categoria === cat);
  const outrosSub = (...subs) =>
    arquivos.filter((a) => a.categoria === 'outros' && subs.some((s) => norm(a.subtipo) === norm(s)));
  const concessKeys = (...keys) =>
    arquivos.filter((a) => a.categoria === 'concessionaria' && keys.some((k) => norm(a.subtipo).includes(norm(k))));
  const relat = (serv) =>
    arquivos.filter((a) => a.categoria === 'relatorio_leitura' && norm(a.relatorio_tipo_servico) === serv);

  // 1 · Emissão a processar
  porCat('emissao').forEach(add);
  // 2 · Correios
  outrosSub('Correios').forEach(add);
  // 3 · Seguros
  outrosSub('Seguro', 'Seguros').forEach(add);
  // 4 · Água: fatura (SABESP) + relatório (água)
  concessKeys('sabesp', 'agua', 'água').forEach(add);
  relat('agua').forEach(add);
  // 5 · Gás: fatura (COMGAS) + relatório (gás)
  concessKeys('comgas', 'gas', 'gás').forEach(add);
  relat('gas').forEach(add);
  // 6 · Energia: fatura (ENEL)
  concessKeys('enel', 'energia', 'eletropaulo', 'cpfl', 'edp', 'light').forEach(add);
  // 7 · Cobranças extras (anexos) + salão de festas
  (cobrancas || []).forEach((c) => {
    (c.attachments || []).forEach((att) => add({ __attachment: att, arquivo_nome: `Cobranca_${c.descricao || c.description || ''}` }));
  });
  outrosSub('Salão de festas', 'Salao de festas').forEach(add);
  // 8 · Relatório de cálculo de rateio
  outrosSub('Relatório de Rateio', 'Relatorio de Rateio').forEach(add);

  // Catch-all: qualquer anexo restante (não classificado) entra no fim, pra nada se perder.
  arquivos.forEach(add);

  return out;
}

// Baixa cada item e mescla num PDF único (pdf-lib). Devolve { blob, pulados, totalPaginas }.
export async function montarPdfEmissao(itens, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const pulados = [];
  let i = 0;

  for (const item of itens) {
    i += 1;
    const nome = item.arquivo_nome || 'arquivo';
    onProgress?.(i, itens.length, nome);
    const path = item.__attachment || item.arquivo_url;
    if (!path) continue;

    let bytes;
    try {
      const url = await getArquivoUrlSeguro(path, { stream: true });   // fetch → same-origin, sem CORS
      if (!url) { pulados.push(`${nome} (sem acesso)`); continue; }
      const resp = await fetch(url);
      if (!resp.ok) { pulados.push(`${nome} (falha HTTP ${resp.status})`); continue; }
      bytes = await resp.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) { pulados.push(`${nome} (arquivo vazio)`); continue; }
    } catch {
      pulados.push(`${nome} (falha ao baixar)`);
      continue;
    }

    const low = nome.toLowerCase();
    const fmt = norm(item.formato);
    const isPdf = low.endsWith('.pdf') || fmt === 'pdf';
    const isPng = low.endsWith('.png') || fmt === 'png';
    const isJpg = /\.jpe?g$/.test(low) || fmt === 'jpg' || fmt === 'jpeg';

    try {
      if (isPdf) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } else if (isPng || isJpg) {
        const img = isPng ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
        const page = merged.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      } else {
        pulados.push(`${nome} (não é PDF/imagem)`);
      }
    } catch {
      pulados.push(`${nome} (não consegui mesclar)`);
    }
  }

  const blob = new Blob([await merged.save()], { type: 'application/pdf' });
  return { blob, pulados, totalPaginas: merged.getPageCount() };
}
