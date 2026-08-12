'use client';
import { useEffect, useState } from 'react';
import { AlertCircle, RotateCcw, Copy, Check } from 'lucide-react';

// Tela de quebra do React (App Router). Ela ESCONDIA o erro: dizia "nossos
// engenheiros foram notificados" — o que era falso, só havia um console.error —
// e não mostrava mensagem nenhuma. Resultado: para saber o que quebrou era
// preciso abrir o DevTools, coisa que ninguém faz no meio do expediente, e o
// relato chegava como "deu erro na tela", sem nada acionável.
//
// Agora o erro aparece na própria tela, com botão de copiar.
export default function GlobalError({ error, reset }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    console.error('ERRO FATAL NO SISTEMA:', error);
  }, [error]);

  // `digest` é o id que o Next dá ao erro em produção, onde a mensagem real vem
  // ofuscada. Sem ele não há como cruzar com o log do servidor.
  const detalhes = [
    `Mensagem: ${error?.message || '(sem mensagem)'}`,
    error?.digest ? `Digest: ${error.digest}` : null,
    `Rota: ${typeof window !== 'undefined' ? window.location.pathname : '—'}`,
    `Quando: ${new Date().toLocaleString('pt-BR')}`,
    error?.stack ? `\nStack:\n${error.stack}` : null,
  ].filter(Boolean).join('\n');

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(detalhes);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);   // navegador sem permissão de área de transferência
    }
  };

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mb-5 border border-rose-500/20">
        <AlertCircle className="w-8 h-8 text-rose-500" />
      </div>

      <h1 className="text-2xl font-semibold text-slate-900 mb-2 tracking-tight">Esta tela não carregou</h1>
      <p className="text-slate-500 max-w-md mb-6">
        O resto do sistema continua funcionando. Copie os detalhes abaixo e envie
        para quem cuida do sistema — sem eles não há como saber o que aconteceu.
      </p>

      {/* O que realmente importa: a mensagem, visível sem abrir o DevTools. */}
      <div className="w-full max-w-2xl mb-6 text-left">
        <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200">
            <span className="text-xs font-medium text-slate-500">Detalhes do erro</span>
            <button
              onClick={copiar}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-violet-600 transition-colors"
            >
              {copiado
                ? <><Check className="w-3.5 h-3.5" aria-hidden="true" /> Copiado</>
                : <><Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copiar</>}
            </button>
          </div>
          <div className="px-4 py-3 space-y-1">
            <p className="text-sm font-medium text-slate-900 break-words">
              {error?.message || '(sem mensagem)'}
            </p>
            {error?.digest && (
              <p className="text-xs text-slate-500 font-mono">digest: {error.digest}</p>
            )}
          </div>
          {error?.stack && (
            <details className="border-t border-slate-200">
              <summary className="px-4 py-2 text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-700">
                Rastro técnico
              </summary>
              <pre className="px-4 py-3 text-[11px] leading-relaxed text-slate-600 overflow-x-auto whitespace-pre-wrap break-words max-h-64">
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> Tentar de novo
        </button>
        <button
          onClick={() => { window.location.href = '/dashboard'; }}
          className="px-5 py-2.5 bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 rounded-xl text-sm font-medium transition-colors"
        >
          Voltar ao início
        </button>
      </div>
    </div>
  );
}
