'use client';

/**
 * Histórico de emissões de UM condomínio.
 *
 * Esta rota existia e mostrava a tabela `emissoes` — a do sistema antigo, que
 * nenhuma tela escreve desde que a Central de Emissões entrou no ar. Quem vinha
 * pela aba "Emissões" da planilha encontrava uma página vazia e um formulário
 * de upload que gravava num lugar que ninguém lê.
 *
 * Agora ela mostra o que de fato aconteceu: os pacotes de `emissoes_pacotes`
 * daquele condomínio, mês a mês, com status, arquivos e o caminho de volta para
 * a emissão. Os arquivos antigos continuam acessíveis, numa seção separada e
 * só quando existem.
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useCondoNaCarteira } from '@/lib/carteira';
import { useToast } from '@/components/Toast';
import { abrirArquivoSeguro, getArquivoUrlSeguro } from '@/lib/arquivo';
import { anexarGrupos } from '@/lib/conjuntoEmissao';
import StatusBadge from '@/app/central-emissoes/components/StatusBadge';
import SeloCancelada, { AvisoCanceladas, MarcaDaguaCancelada } from '@/components/SeloCancelada';
import {
  FileText, Download, Calendar, Building2, Loader2, Inbox, ExternalLink, Archive, ShieldAlert
} from 'lucide-react';
import Link from 'next/link';

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const fmtData = (iso) => (iso
  ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : null);

const formatSize = (bytes) => {
  if (!bytes) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

export default function CondominioEmissoesPage() {
  const params = useParams();
  const condoId = params.id;
  const carteira = useCondoNaCarteira(condoId);
  const { profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [condo, setCondo] = useState(null);
  const [pacotes, setPacotes] = useState([]);
  const [legado, setLegado] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(null);      // pacote com arquivos à vista
  const [verLegado, setVerLegado] = useState(false);

  // Quem monta a emissão pode abrir o pacote lá; os demais veem o histórico.
  const podeAbrirEmissao = profile?.role === 'master' || profile?.role === 'departamento';

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      try {
        const { data: condoData } = await supabase
          .from('condominios').select('id, name, due_day, due_day_2').eq('id', condoId).maybeSingle();

        const { data: pacs, error } = await supabase
          .from('emissoes_pacotes')
          // As colunas do cancelamento vêm junto: sem elas o selo apareceria sem o
          // motivo, e é justamente o motivo que faz a emissão cancelada valer a
          // pena continuar no histórico.
          .select('id, mes_referencia, ano_referencia, status, grupo_id, criado_em, lacrada_em, '
                + 'cancelamento_motivo, cancelada_por_nome, cancelada_em, substituida_por')
          .eq('condominio_id', condoId)
          .order('ano_referencia', { ascending: false })
          .order('mes_referencia', { ascending: false });
        if (error) throw error;

        // Contagem de arquivos por pacote numa consulta só, sem trazer os JSONs
        // de extração — a lista aqui só precisa saber quantos são.
        const ids = (pacs || []).map(p => p.id);
        const porPacote = {};
        if (ids.length) {
          const { data: arqs } = await supabase
            .from('emissoes_arquivos')
            .select('id, pacote_id, arquivo_nome, arquivo_url, categoria, criado_em')
            .in('pacote_id', ids)
            .order('criado_em');
          (arqs || []).forEach(a => { (porPacote[a.pacote_id] = porPacote[a.pacote_id] || []).push(a); });
        }

        const comGrupo = await anexarGrupos(supabase, pacs || []);

        // Sistema anterior: só aparece se tiver alguma coisa.
        const { data: antigos } = await supabase
          .from('emissoes')
          .select('id, mes_ano, tipo, nome_arquivo, storage_path, tamanho_bytes, criado_em')
          .eq('condominio_id', condoId)
          .order('criado_em', { ascending: false });

        if (!vivo) return;
        setCondo(condoData);
        setPacotes(comGrupo.map(p => ({ ...p, arquivos: porPacote[p.id] || [] })));
        setLegado(antigos || []);
      } catch (err) {
        if (vivo) addToast('Não consegui carregar o histórico: ' + (err.message || err), 'error');
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condoId]);

  async function baixarLegado(e) {
    try {
      const link = await getArquivoUrlSeguro(e.storage_path, { stream: true });
      if (!link) throw new Error('Sem acesso ao arquivo.');
      const resp = await fetch(link);
      if (!resp.ok) throw new Error('Falha ao baixar.');
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = e.nome_arquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      addToast('Erro ao baixar arquivo.', 'error');
    }
  }

  // Agrupa por ano para a lista não virar uma parede de meses.
  const porAno = useMemo(() => {
    const mapa = new Map();
    for (const p of pacotes) {
      const lista = mapa.get(p.ano_referencia) || [];
      lista.push(p);
      mapa.set(p.ano_referencia, lista);
    }
    return [...mapa.entries()].sort((a, b) => b[0] - a[0]);
  }, [pacotes]);

  // A lista só oferece os condomínios da carteira, mas o id vai na URL — e URL
  // se digita, se guarda nos favoritos e se manda por mensagem. Sem esta
  // checagem, um gerente que troque o id na barra de endereços abre a planilha
  // de outro. O RLS destas tabelas é `USING (true)`: o banco entrega.
  if (carteira.carregando) {
    return (
      <div className="flex flex-col items-center justify-center p-20">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  if (!carteira.permitido) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-20 text-center">
        <ShieldAlert className="h-10 w-10 text-rose-500" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-800">Este condomínio não está na sua carteira</p>
        <p className="text-xs text-slate-500">Se você deveria ter acesso a ele, peça ao administrador para vinculá-lo.</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in w-full pb-20 space-y-6">
      <div className="glass-panel p-6 rounded-2xl space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-violet-500" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-900 truncate">{condo?.name || 'Condomínio'}</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Histórico de emissões
              {condo?.due_day ? ` · vencimento dia ${condo.due_day}${condo.due_day_2 ? ` e ${condo.due_day_2}` : ''}` : ''}
            </p>
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-200 pt-4">
          <Link href={`/condominio/${condoId}/arrecadacoes`}
            className="text-xs font-medium px-4 py-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            Arrecadações
          </Link>
          <span className="text-xs font-medium px-4 py-2 rounded-lg bg-violet-600 text-white">
            Emissões
          </span>
          <Link href={`/carteiras/cobrancas?condo=${condoId}`}
            className="text-xs font-medium px-4 py-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            Cobranças
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-16"><Loader2 className="w-7 h-7 text-violet-500 animate-spin" /></div>
      ) : pacotes.length === 0 ? (
        <div className="glass-panel rounded-2xl p-16 text-center">
          <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-700">Nenhuma emissão registrada</p>
          <p className="text-xs text-slate-500 mt-1">
            Este condomínio ainda não teve emissão criada na Central.
          </p>
        </div>
      ) : (
        porAno.map(([ano, lista]) => (
          <div key={ano} className="glass-panel rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-violet-500" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-900">{ano}</h2>
              <span className="text-[11px] text-slate-500">
                {lista.length} emiss{lista.length === 1 ? 'ão' : 'ões'}
              </span>
            </div>

            <div className="divide-y divide-slate-200">
              {lista.map(p => (
                <div key={p.id}
                  className={(p.status || '').toLowerCase() === 'cancelada'
                    ? 'tem-marca-dagua relative overflow-hidden bg-rose-50/40 border-l-4 border-rose-500'
                    : undefined}>
                  {(p.status || '').toLowerCase() === 'cancelada' && <MarcaDaguaCancelada />}
                  <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
                    <span className="w-24 shrink-0 text-sm font-medium text-slate-800">
                      {MESES[p.mes_referencia]}
                    </span>

                    {p.grupo_nome && (
                      <span className="shrink-0 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
                        {p.grupo_nome}
                      </span>
                    )}

                    <StatusBadge status={p.status} />
                    {/* No histórico é onde se vai procurar "o que aconteceu
                        naquele mês" — o motivo tem de estar aqui. */}
                    <SeloCancelada pacote={p} />

                    <span className="text-[11px] text-slate-500">
                      {p.arquivos.length} arquivo{p.arquivos.length !== 1 ? 's' : ''}
                      {p.lacrada_em ? ` · registrada em ${fmtData(p.lacrada_em)}` : ''}
                    </span>

                    <div className="ml-auto flex items-center gap-2">
                      {p.arquivos.length > 0 && (
                        <button type="button" onClick={() => setAberto(a => (a === p.id ? null : p.id))}
                          aria-expanded={aberto === p.id}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors">
                          {aberto === p.id ? 'Ocultar arquivos' : 'Ver arquivos'}
                        </button>
                      )}
                      {podeAbrirEmissao && (
                        <Link
                          href={`/central-emissoes?tab=upload&condo=${condoId}&mes=${p.mes_referencia}&ano=${p.ano_referencia}&pacote=${p.id}`}
                          title="Abrir esta emissão na Central"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-violet-700 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" /> Abrir
                        </Link>
                      )}
                    </div>
                  </div>

                  {aberto === p.id && (
                    <div className="px-5 pb-3 pl-[7.5rem] space-y-1">
                      {p.arquivos.map(a => (
                        <button key={a.id} type="button" onClick={() => abrirArquivoSeguro(a.arquivo_url)}
                          className="flex items-center gap-2 text-xs text-slate-600 hover:text-violet-700 hover:underline text-left">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                          <span className="truncate">{a.arquivo_nome}</span>
                          {a.categoria && (
                            <span className="shrink-0 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-500">
                              {a.categoria}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Sistema anterior: só existe para consulta. Nada escreve aqui há tempo,
          então não há upload nem exclusão — o que está guardado continua
          acessível, e é só isso. */}
      {legado.length > 0 && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <button type="button" onClick={() => setVerLegado(v => !v)} aria-expanded={verLegado}
            className="w-full px-5 py-3 flex items-center gap-2 hover:bg-slate-100 transition-colors">
            <Archive className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-700">
              Arquivos do sistema anterior ({legado.length})
            </span>
            <span className="text-[11px] text-slate-400 ml-auto">
              {verLegado ? 'ocultar' : 'mostrar'}
            </span>
          </button>

          {verLegado && (
            <div className="border-t border-slate-200 divide-y divide-slate-100">
              {legado.map(e => (
                <div key={e.id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                  <FileText className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="text-xs text-slate-700 truncate max-w-[320px]" title={e.nome_arquivo}>
                    {e.nome_arquivo}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {e.mes_ano} · {e.tipo}{e.tamanho_bytes ? ` · ${formatSize(e.tamanho_bytes)}` : ''}
                  </span>
                  <button type="button" onClick={() => baixarLegado(e)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors">
                    <Download className="w-3.5 h-3.5" /> Baixar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
