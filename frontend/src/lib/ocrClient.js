// OCR no navegador (sem créditos): decifra faturas escaneadas (PDF imagem) com pdf.js + tesseract.js.
// Usado quando o PDF não tem camada de texto — o backend devolve "sem texto" e caímos aqui.

let _libsP = null;

function injectScript(src) {
  return new Promise((res, rej) => {
    if (Array.from(document.scripts).some(s => s.src === src)) return res();
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = () => res();
    el.onerror = () => rej(new Error('Falha ao carregar ' + src));
    document.head.appendChild(el);
  });
}

async function loadOcrLibs() {
  if (_libsP) return _libsP;
  _libsP = (async () => {
    await injectScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
    await injectScript('https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/tesseract.min.js');
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; } catch (e) {}
    if (!window.pdfjsLib || !window.Tesseract) throw new Error('OCR não carregou (sem internet?)');
  })();
  return _libsP;
}

// Binariza o canvas (cinza + limiar) — tesseract acerta MUITO mais em texto preto/fundo branco.
function binarize(cv) {
  const ctx = cv.getContext('2d');
  const im = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = g > 165 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
}

// Renderiza o PDF/imagem em DPI alto + binariza e devolve o texto reconhecido. onProgress(pagina, total).
export async function ocrFileToText(file, onProgress) {
  await loadOcrLibs();
  const pdfjsLib = window.pdfjsLib, Tesseract = window.Tesseract;
  const SCALE = 3.0;   // DPI alto: dígitos de boleto denso ficam legíveis
  const ocrCanvas = async (cv) => {
    binarize(cv);
    const { data } = await Tesseract.recognize(cv, 'por');
    return (data && data.text) || '';
  };
  let text = '';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const n = pdf.numPages;
    for (let p = 1; p <= n; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: SCALE });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }).promise;
      onProgress?.(p, n);
      text += '\n' + await ocrCanvas(cv);
      cv.width = cv.height = 0; page.cleanup?.();
    }
    pdf.destroy?.();
  } else {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Falha ao abrir imagem')); i.src = URL.createObjectURL(file); });
    const cv = document.createElement('canvas');
    const s = Math.min(2, Math.max(1, 2200 / (img.naturalWidth || img.width || 1100)));
    cv.width = Math.round((img.naturalWidth || img.width) * s); cv.height = Math.round((img.naturalHeight || img.height) * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    onProgress?.(1, 1);
    text += '\n' + await ocrCanvas(cv);
    cv.width = cv.height = 0;
  }
  return text;
}

// ───────── Código de barras do boleto = VALOR EXATO (sem erro de OCR) ─────────
let _zxingP = null;
async function loadZxing() {
  if (!_zxingP) _zxingP = import('https://esm.sh/zxing-wasm@1.3.4/reader').catch(() => null);
  return _zxingP;
}
// 44 dígitos. Arrecadação (concessionárias, começa em 8): valor = pos 5-15. Boleto bancário: valor = pos 10-19.
function parseBarcodeValor(digits) {
  if (!digits || digits.length !== 44) return null;
  const slice = digits[0] === '8' ? digits.slice(4, 15) : digits.slice(9, 19);
  const v = parseInt(slice, 10);
  return (!isNaN(v) && v > 0) ? v / 100 : null;
}
// Renderiza o PDF/imagem e lê o código de barras (ITF) -> valor exato. null se não achar.
export async function decodeBoletoValor(file) {
  try {
    await loadOcrLibs();
    const zx = await loadZxing();
    if (!zx || !zx.readBarcodes) return null;
    const pdfjsLib = window.pdfjsLib;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const canvases = [];
    if (isPdf) {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 3 });
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        await page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp }).promise;
        canvases.push(cv); page.cleanup?.();
      }
      pdf.destroy?.();
    } else {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = URL.createObjectURL(file); });
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth || img.width; cv.height = img.naturalHeight || img.height;
      cv.getContext('2d').drawImage(img, 0, 0); canvases.push(cv);
    }
    let achado = null;
    for (const cv of canvases) {
      if (achado) break;
      const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      let results = [];
      try { results = await zx.readBarcodes(id, { tryHarder: true, formats: ['ITF'], maxNumberOfSymbols: 8 }); } catch (e) {}
      for (const r of results) {
        const digs = (String(r.text || '').match(/\d/g) || []).join('');
        const v = parseBarcodeValor(digs);
        if (v != null) { achado = { valor: v, barcode: digs }; break; }
      }
    }
    canvases.forEach(c => { c.width = c.height = 0; });
    return achado;
  } catch (e) { return null; }
}

function dataBR(s) {
  const m = String(s).match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
  if (!m) return null;
  const y = parseInt(m[3], 10);
  if (y < 2000 || y > 2100) return null;   // valida ano — descarta ruído de OCR
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// mês -> número (p/ referência), tolerante a acento/abreviação
const _MESES = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06',
  JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12',
  JANEIRO: '01', FEVEREIRO: '02', MARCO: '03', 'MARÇO': '03', ABRIL: '04',
  MAIO: '05', JUNHO: '06', JULHO: '07', AGOSTO: '08', SETEMBRO: '09',
  OUTUBRO: '10', NOVEMBRO: '11', DEZEMBRO: '12',
};
function brl(s) {
  let v = String(s).replace(/[^\d.,]/g, '');
  if (v.indexOf(',') >= 0) v = v.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Extrai os campos da fatura a partir do texto OCR (tolerante a ruído). O usuário confere depois.
export function parseFaturaOcr(text) {
  const t = text || '';
  const up = t.toUpperCase();
  let subtipo = null;
  if (up.includes('SABESP') || up.includes('SANEAMENTO BASICO') || up.includes('SANEAMENTO BÁSICO')) subtipo = 'SABESP';
  else if (up.includes('COMGAS') || up.includes('COMGÁS') || up.includes('COMPANHIA DE G')) subtipo = 'COMGAS';
  else if (up.includes('ENEL') || up.includes('ELETROPAULO')) subtipo = 'ENEL';
  else if (up.includes('PROSPER')) subtipo = 'Prosper';

  // Vencimento: "VENCIMENTO" ou "PAGAR ATÉ"; senão a 1ª data válida do documento
  let vencimento = null;
  const vencRes = [
    /VENC[I1]?MENTO[^\d]{0,25}(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/i,
    /PAG[A4]R\s+AT[EÉ][^\d]{0,25}(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/i,
  ];
  for (const re of vencRes) { const m = t.match(re); if (m) { vencimento = dataBR(m[1]); if (vencimento) break; } }
  if (!vencimento) {
    const re = /(\d{2}[\/.\-]\d{2}[\/.\-]\d{4})/g; let m;
    while ((m = re.exec(t))) { const iso = dataBR(m[1]); if (iso) { vencimento = iso; break; } }
  }

  // Valor: perto de "TOTAL A PAGAR"/"VALOR"; senão o maior valor monetário plausível (> R$ 1)
  let valor = null;
  const mvl = t.match(/(?:TOTAL\s*A\s*PAGAR|VALOR\s*(?:A\s*PAGAR|TOTAL|DO\s*D[ÉE]BITO|COBRADO)|TOTAL\s*DA\s*FATURA)[^\dR$]{0,20}R?\$?\s*([\d.]{1,12},\d{2})/i);
  if (mvl) valor = brl(mvl[1]);
  if (valor == null) {
    const todos = (t.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []).map(brl).filter(v => v != null && v > 1 && v < 10000000);
    if (todos.length) valor = Math.max(...todos);
  }

  // Referência (mês/ano) — ajuda a casar o período do consumo
  let referencia = null;
  const mesNames = Object.keys(_MESES).join('|');
  const rm = up.match(new RegExp(`(${mesNames})[\\s/\\-]+(\\d{4})`));
  if (rm) referencia = `${rm[1]}/${rm[2]}`;
  else { const nm = t.match(/\b(\d{2})\/(\d{4})\b/); if (nm) referencia = `${nm[1]}/${nm[2]}`; }

  return { subtipo, vencimento, valor, referencia };
}
