'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Droplet, Flame, Zap, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';

/**
 * O consumo do MÊS ANTERIOR, ao lado do que está sendo montado agora.
 *
 * Quem emite precisa de uma régua: uma conta de água que pulou de 3 mil para 12
 * mil é vazamento, erro de leitura ou fatura do condomínio errado — e o único
 * jeito de perceber isso na hora é ter o mês passado à vista. Sem isso, o número
 * estranho só aparece quando o condômino liga reclamando.
 *
 * Lê de `emissoes_arquivos`, que já guarda o que foi extraído das faturas
 * (`valor_fatura`) e dos relatórios de leitura (`relatorio_consumo_total`).
 * Não inventa dado: o que não foi extraído aparece como "—".
 */

const SERVICOS = [
  { id: 'agua',    rotulo: 'Água',    icon: Droplet, chaves: ['sabesp', 'agua', 'água'] },
  { id: 'gas',     rotulo: 'Gás',     icon: Flame,   chaves: ['comgas', 'comgás', 'gas', 'gás'] },
  { id: 'energia', rotulo: 'Energia', icon: Zap,     chaves: ['enel', 'energia', 'eletropaulo', 'cpfl', 'edp', 'light'] },
];

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A que serviço este arquivo pertence — pelo tipo do relatório ou pelo subtipo da fatura. */
function servicoDoArquivo(a) {
  const tipo = semAcento(a.relatorio_tipo_servico);
  if (tipo) {
    const achado = SERVICOS.find(s => s.id === tipo || s.chaves.some(k => tipo.includes(semAcento(k))));
    if (achado) return achado.id;
  }
  const sub = semAcento(a.subtipo);
  if (!sub) return null;
  return SERVICOS.find(s => s.chaves.some(k => sub.includes(semAcento(k))))?.id || null;
}

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Resume um conjunto de arquivos num par {valor, consumo} por serviço. */
function resumir(arquivos) {
  const mapa = {};
  for (const a of arquivos || []) {
    const s = servicoDoArquivo(a);
    if (!s) continue;
    mapa[s] = mapa[s] || { valor: null, consumo: null };
    if (a.valor_fatura != null) mapa[s].valor = Number(a.valor_fatura);
    if (a.relatorio_valor_total != null && mapa[s].valor == null) mapa[s].valor = Number(a.relatorio_valor_total);
    if (a.relatorio_consumo_total != null) mapa[s].consumo = Number(a.relatorio_consumo_total);
  }
  return mapa;
}

export default function ComparativoConsumo({ condominioId, mes, ano, arquivosAtuais }) {
  const supabase = useMemo(() => createClient(), []);
  const [anteriores, setAnteriores] = useState(null);   // null = carregando
  const [erro, setErro] = useState(false);

  // Mês anterior, virando o ano quando preciso.
  const { mesAnt, anoAnt } = useMemo(() => (
    mes === 1 ? { mesAnt: 12, anoAnt: ano - 1 } : { mesAnt: mes - 1, anoAnt: ano }
  ), [mes, ano]);

  useEffect(() => {
    if (!condominioId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        .from('emissoes_arquivos')
        .select('subtipo, categoria, valor_fatura, relatorio_tipo_servico, relatorio_consumo_total, relatorio_valor_total')
        .eq('condominio_id', condominioId)
        .eq('mes_referencia', mesAnt)
        .eq('ano_referencia', anoAnt)
        .in('categoria', ['concessionaria', 'relatorio_leitura']);
      if (!vivo) return;
      if (error) { setErro(true); setAnteriores({}); return; }
      setAnteriores(resumir(data));
    })();
    return () => { vivo = false; };
  }, [supabase, condominioId, mesAnt, anoAnt]);

  const atuais = useMemo(() => resumir(arquivosAtuais), [arquivosAtuais]);

  if (anteriores === null) {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando o consumo do mês anterior…
      </div>
    );
  }

  const linhas = SERVICOS
    .map(s => ({ s, ant: anteriores[s.id], atual: atuais[s.id] }))
    .filter(l => l.ant || l.atual);

  // Sem nada dos dois lados não vale ocupar espaço: condomínio sem consumo, ou
  // primeiro mês no sistema.
  if (linhas.length === 0) return null;

  const nomeMes = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                   'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][mesAnt];

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        <Droplet className="w-4 h-4 text-sky-600" aria-hidden="true" />
        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-600">
          Comparativo de consumo
        </h4>
        <span className="text-[11px] text-slate-500">
          {nomeMes}/{String(anoAnt).slice(-2)} ao lado do que você está montando
        </span>
        {erro && <span className="ml-auto text-[11px] text-amber-700">não consegui ler o mês anterior</span>}
      </div>

      <div className="divide-y divide-slate-100">
        {linhas.map(({ s, ant, atual }) => {
          const Icone = s.icon;
          const vAnt = ant?.valor;
          const vAtual = atual?.valor;
          // Variação só faz sentido com os dois lados e base diferente de zero.
          const varia = (vAnt != null && vAtual != null && vAnt !== 0)
            ? ((vAtual - vAnt) / Math.abs(vAnt)) * 100
            : null;
          // 15% é onde uma conta deixa de ser oscilação e vira pergunta.
          const alerta = varia != null && Math.abs(varia) >= 15;
          const Seta = varia == null ? Minus : varia > 0 ? TrendingUp : TrendingDown;

          return (
            <div key={s.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 w-24 shrink-0 text-xs font-bold text-slate-700">
                <Icone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                {s.rotulo}
              </span>

              <span className="text-xs text-slate-500 tabular-nums">
                <span className="text-[10px] uppercase tracking-widest text-slate-400 mr-1">antes</span>
                {vAnt != null ? `R$ ${brl(vAnt)}` : '—'}
                {ant?.consumo != null && <span className="text-slate-400"> · {brl(ant.consumo)} m³</span>}
              </span>

              <span className="text-slate-300">→</span>

              <span className={`text-xs tabular-nums font-bold ${vAtual != null ? 'text-slate-800' : 'text-slate-400'}`}>
                <span className="text-[10px] uppercase tracking-widest text-slate-400 mr-1 font-normal">agora</span>
                {vAtual != null ? `R$ ${brl(vAtual)}` : 'ainda não anexada'}
                {atual?.consumo != null && <span className="text-slate-400 font-normal"> · {brl(atual.consumo)} m³</span>}
              </span>

              {varia != null && (
                <span className={`ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                  alerta ? 'border-amber-300 bg-amber-50 text-amber-800'
                         : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
                  title={alerta ? 'Variação grande — vale conferir a leitura e o condomínio da fatura.' : undefined}>
                  <Seta className="w-3 h-3" aria-hidden="true" />
                  {varia > 0 ? '+' : ''}{varia.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
