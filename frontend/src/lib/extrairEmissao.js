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

// ── ZIP com os ORIGINAIS, numerados na ordem de auditoria ─────────────────────────
// Caminho preferido para ARQUIVAR: os arquivos entram bit a bit, exatamente como o
// banco/concessionária emitiram (nada é re-renderizado), e vai um ÍNDICE junto.
// Sem mesclagem = sem risco de página em branco.
const CABECALHO_INDICE = [
  'Documentos da emissão, na ordem de auditoria:',
  '1 Emissão a processar · 2 Correios · 3 Seguros · 4 Água · 5 Gás · 6 Energia',
  '7 Cobranças extras e salão · 8 Relatório de rateio',
];

// Baixa 1 original. Devolve { blob } ou { erro }.
async function baixarOriginal(item) {
  const path = item.__attachment || item.arquivo_url;
  if (!path) return { erro: 'sem caminho' };
  try {
    const url = await getArquivoUrlSeguro(path, { stream: true }); // same-origin, sem CORS
    if (!url) return { erro: 'sem acesso' };
    const resp = await fetch(url);
    if (!resp.ok) return { erro: `falha HTTP ${resp.status}` };
    const blob = await resp.blob();
    if (!blob.size) return { erro: 'arquivo vazio' };
    return { blob };
  } catch {
    return { erro: 'falha ao baixar' };
  }
}

function montarIndice(linhas, pulados) {
  return [
    ...CABECALHO_INDICE,
    '',
    ...linhas,
    ...(pulados.length ? ['', 'Não incluídos:', ...pulados.map((p) => `  - ${p}`)] : []),
    '',
    `Gerado em ${new Date().toLocaleString('pt-BR')} — CondoFlow`,
    'Os arquivos são os originais, sem qualquer reprocessamento.',
  ].join('\r\n');
}

// Uma emissão -> ZIP com os arquivos numerados na raiz.
export async function montarZipEmissao(itens, onProgress) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const pulados = [];
  const linhas = [];
  let i = 0;
  let incluidos = 0;

  for (const item of itens) {
    i += 1;
    const nome = item.arquivo_nome || `arquivo_${i}`;
    onProgress?.(i, itens.length, nome);
    const { blob, erro } = await baixarOriginal(item);
    if (erro) { if (erro !== 'sem caminho') pulados.push(`${nome} (${erro})`); continue; }
    const seq = String(i).padStart(2, '0');
    zip.file(`${seq} - ${nome}`, blob);   // preserva o nome original
    linhas.push(`${seq}  ${nome}`);
    incluidos += 1;
  }

  if (incluidos === 0) return { blob: null, pulados, incluidos: 0 };
  zip.file('INDICE.txt', montarIndice(linhas, pulados));
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, pulados, incluidos };
}

// Várias emissões -> ZIP com UMA PASTA por competência (ex.: "Agosto-2026/01 - …").
// grupos: [{ label, itens }]
export async function montarZipMulti(grupos, onProgress) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const pulados = [];
  const linhas = [];
  const total = grupos.reduce((s, g) => s + (g.itens?.length || 0), 0);
  let feitos = 0;
  let incluidos = 0;

  for (const g of grupos) {
    const pasta = String(g.label || 'emissao').replace(/[\\/:*?"<>|]/g, '-');
    linhas.push('', `[${pasta}]`);
    let i = 0;
    for (const item of (g.itens || [])) {
      i += 1; feitos += 1;
      const nome = item.arquivo_nome || `arquivo_${i}`;
      onProgress?.(feitos, total, nome);
      const { blob, erro } = await baixarOriginal(item);
      if (erro) { if (erro !== 'sem caminho') pulados.push(`${pasta}/${nome} (${erro})`); continue; }
      const seq = String(i).padStart(2, '0');
      zip.file(`${pasta}/${seq} - ${nome}`, blob);
      linhas.push(`  ${seq}  ${nome}`);
      incluidos += 1;
    }
  }

  if (incluidos === 0) return { blob: null, pulados, incluidos: 0 };
  zip.file('INDICE.txt', montarIndice(linhas, pulados));
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, pulados, incluidos };
}

// ── pdf.js (rasterização) ──────────────────────────────────────────────────────────
// Renderiza cada página do PDF e embute como imagem no PDF final. Garante conteúdo
// VISÍVEL mesmo nos PDFs que o copyPages do pdf-lib deixava em branco (scanner/gerador
// específico). Worker self-hosted em /public (same-origin, sem CDN, sem CSP issue).
let _pdfjs = null;
async function getPdfjs() {
  if (!_pdfjs) {
    // Build LEGACY de propósito: é transpilado e roda em navegador mais antigo. O build
    // moderno falhava silenciosamente na máquina do usuário e a mesclagem caía no
    // fallback (páginas em branco). O worker em /public é o legacy correspondente.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    _pdfjs = pdfjs;
  }
  return _pdfjs;
}

const RASTER = 2; // 2x = boa legibilidade sem inflar demais o arquivo

function dataUrlParaBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k += 1) arr[k] = bin.charCodeAt(k);
  return arr;
}

async function rasterizarPaginas(arrayBuffer) {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer.slice(0)),
    wasmUrl: '/pdfjs-wasm/',                       // JBIG2/JPEG2000 (scans) decodificam via WASM — SEM isso o scan sai em branco
    standardFontDataUrl: '/pdfjs-standard-fonts/', // fontes padrão (boletos/PDFs vetoriais)
    isEvalSupported: false,
  }).promise;
  const out = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: RASTER });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ bytes: dataUrlParaBytes(canvas.toDataURL('image/jpeg', 0.9)), ptW: vp1.width, ptH: vp1.height });
      canvas.width = 0; canvas.height = 0; // libera memória
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

// Baixa 1 item e adiciona ao doc `merged`. PDF entra RASTERIZADO (pdf.js); imagem
// entra direto. Falhas vão pra `pulados` (não abortam o resto).
async function mesclarItem(merged, PDFDocument, item, pulados, onProgress, idx, total) {
  const nome = item.arquivo_nome || 'arquivo';
  onProgress?.(idx, total, nome);
  const path = item.__attachment || item.arquivo_url;
  if (!path) return;

  let bytes;
  try {
    const url = await getArquivoUrlSeguro(path, { stream: true }); // fetch → same-origin, sem CORS
    if (!url) { pulados.push(`${nome} (sem acesso)`); return; }
    const resp = await fetch(url);
    if (!resp.ok) { pulados.push(`${nome} (falha HTTP ${resp.status})`); return; }
    bytes = await resp.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) { pulados.push(`${nome} (arquivo vazio)`); return; }
  } catch {
    pulados.push(`${nome} (falha ao baixar)`);
    return;
  }

  const low = nome.toLowerCase();
  const fmt = norm(item.formato);
  const isPdf = low.endsWith('.pdf') || fmt === 'pdf';
  const isPng = low.endsWith('.png') || fmt === 'png';
  const isJpg = /\.jpe?g$/.test(low) || fmt === 'jpg' || fmt === 'jpeg';

  try {
    if (isPdf) {
      const paginas = await rasterizarPaginas(bytes);
      if (paginas.length === 0) { pulados.push(`${nome} (sem páginas)`); return; }
      for (const pg of paginas) {
        const jpg = await merged.embedJpg(pg.bytes);
        const page = merged.addPage([pg.ptW, pg.ptH]);
        page.drawImage(jpg, { x: 0, y: 0, width: pg.ptW, height: pg.ptH });
      }
    } else if (isPng || isJpg) {
      const img = isPng ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
      const page = merged.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      pulados.push(`${nome} (não é PDF/imagem)`);
    }
  } catch {
    // Fallback: se a rasterização falhar, tenta copiar as páginas direto (salva PDFs normais).
    try {
      if (isPdf) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } else {
        pulados.push(`${nome} (não consegui mesclar)`);
      }
    } catch {
      pulados.push(`${nome} (não consegui mesclar)`);
    }
  }
}

// Uma emissão: junta os itens num PDF único. Devolve { blob, pulados, totalPaginas }.
export async function montarPdfEmissao(itens, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const pulados = [];
  let i = 0;
  for (const item of itens) { i += 1; await mesclarItem(merged, PDFDocument, item, pulados, onProgress, i, itens.length); }
  const blob = new Blob([await merged.save()], { type: 'application/pdf' });
  return { blob, pulados, totalPaginas: merged.getPageCount() };
}

// Várias emissões num PDF único, cada uma com uma página divisória rotulada (ex.:
// "Janeiro/2026"). grupos: [{ label, itens }]. Devolve { blob, pulados, totalPaginas }.
export async function montarPdfMulti(grupos, onProgress) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.HelveticaBold);
  const pulados = [];
  const total = grupos.reduce((s, g) => s + (g.itens?.length || 0), 0);
  let i = 0;
  for (const g of grupos) {
    if (g.label) {
      const p = merged.addPage([595.28, 841.89]); // A4 retrato
      p.drawText(String(g.label), { x: 50, y: 780, size: 22, font, color: rgb(0.1, 0.1, 0.15) });
      p.drawText('Documentos da emissão', { x: 50, y: 752, size: 11, font, color: rgb(0.42, 0.42, 0.48) });
    }
    for (const item of (g.itens || [])) { i += 1; await mesclarItem(merged, PDFDocument, item, pulados, onProgress, i, total); }
  }
  const blob = new Blob([await merged.save()], { type: 'application/pdf' });
  return { blob, pulados, totalPaginas: merged.getPageCount() };
}
