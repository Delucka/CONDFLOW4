'use client';
import { Mail, ExternalLink } from 'lucide-react';

/**
 * Gerador de Rateio · Correio — ferramenta do EMISSOR.
 *
 * O app é um HTML autônomo (OCR no navegador via PDF.js + Tesseract) que gera
 * o .txt de largura fixa validado para o ahreas. Para não arriscar a lógica já
 * validada byte-a-byte, ele roda como está, embutido via iframe a partir de
 * /public/tools/. O acesso é restrito ao emissor pelo RouteGuard (layout.js)
 * e pelo ROUTE_ACCESS ('/correios' -> master/departamento).
 */
export default function CorreiosPage() {
  const SRC = '/tools/gerador_rateio_correio.html';
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
        <iframe
          src={SRC}
          title="Gerador de Rateio · Correio"
          className="w-full block"
          style={{ height: 'calc(100vh - 150px)', border: 'none' }}
        />
      </div>
    </div>
  );
}
