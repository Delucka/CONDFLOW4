'use client';
import { useState, useEffect } from 'react';
import { Mail, ExternalLink } from 'lucide-react';

/**
 * Gerador de Rateio · Correio — ferramenta do EMISSOR.
 *
 * O app é um HTML autônomo (OCR no navegador via PDF.js + Tesseract) em
 * /public/tools/. Antes era embutido via <iframe src=...>, mas o ambiente de rede
 * de alguns usuários injeta `X-Frame-Options: deny` em todas as respostas, o que
 * bloqueia QUALQUER iframe (mesmo do próprio domínio) e deixava a aba em branco.
 * Para contornar sem tocar na lógica já validada da ferramenta, buscamos o HTML e
 * o injetamos via `srcDoc` — conteúdo inline não passa pelo X-Frame-Options. Um
 * <base href="/tools/"> garante que o único caminho relativo da ferramenta
 * (cadastro_unidades.json) continue resolvendo certo. Todo o resto (pdf.js,
 * tesseract) usa URLs absolutas de CDN. Acesso restrito pelo RouteGuard (layout.js).
 */
export default function CorreiosPage() {
  const SRC = '/tools/gerador_rateio_correio.html';
  const [html, setHtml] = useState(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch(SRC, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((txt) => {
        if (cancelado) return;
        const base = '<base href="/tools/">';
        setHtml(txt.includes('<head>') ? txt.replace('<head>', `<head>${base}`) : base + txt);
      })
      .catch(() => { if (!cancelado) setErro(true); });
    return () => { cancelado = true; };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tight">Gerador de Rateio · Correio</h2>
            <p className="text-xs text-slate-500">
              Leia as relações do Correio (OCR no seu navegador) e gere o arquivo <code className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">.txt</code> de importação do rateio.
            </p>
          </div>
        </div>
        <a
          href={SRC}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors"
        >
          <ExternalLink className="w-4 h-4" /> Abrir em nova aba
        </a>
      </div>

      <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
        {erro ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Não foi possível carregar a ferramenta aqui.{' '}
            <a href={SRC} target="_blank" rel="noreferrer" className="text-violet-600 font-bold">Abrir em nova aba</a>.
          </div>
        ) : (
          <iframe
            srcDoc={html ?? '<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:system-ui,sans-serif;color:#94a3b8;padding:28px">Carregando a ferramenta…</body>'}
            title="Gerador de Rateio · Correio"
            className="w-full block"
            style={{ height: 'calc(100vh - 150px)', border: 'none' }}
          />
        )}
      </div>
    </div>
  );
}
