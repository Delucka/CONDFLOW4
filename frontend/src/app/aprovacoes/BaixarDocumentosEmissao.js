'use client';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { apiFetcher, apiFetch } from '@/lib/api';
import { ordenarParaExtracao, montarZipMulti } from '@/lib/extrairEmissao';
import { saveAs } from 'file-saver';
import { FolderDown, Loader2, FileText, Building2 } from 'lucide-react';

const MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Colunas de emissoes_arquivos que a ordenação/mesclagem precisa
const ARQ_COLS = 'id, pacote_id, arquivo_nome, arquivo_url, formato, categoria, subtipo, relatorio_tipo_servico, condominio_id, mes_referencia, ano_referencia';

export default function BaixarDocumentosEmissao() {
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const { data: condosData } = useSWR('/api/condominios', apiFetcher);
  const condos = condosData?.condos || [];

  const anoAtual = new Date().getFullYear();
  const [condominioId, setCondominioId] = useState('');
  const [ano, setAno] = useState(anoAtual);
  const [mes, setMes] = useState(0);            // 0 = ano inteiro
  const [rodando, setRodando] = useState(false);
  const [prog, setProg] = useState(null);       // { i, n, nome }

  const anos = Array.from({ length: 6 }, (_, i) => anoAtual - i);
  const condoNome = condos.find((c) => c.id === condominioId)?.name || 'condominio';

  async function baixar() {
    if (!condominioId) return addToast('Escolha o condomínio.', 'error');
    setRodando(true);
    setProg({ i: 0, n: 0, nome: 'buscando emissões…' });
    try {
      // 1) Emissões (pacotes) do condomínio no período
      let q = supabase
        .from('emissoes_pacotes')
        .select('id, mes_referencia, ano_referencia, status, cobrancas_incluidas, condominio_id')
        .eq('condominio_id', condominioId)
        .eq('ano_referencia', ano)
        .neq('status', 'rascunho')
        .order('mes_referencia', { ascending: true });
      if (mes) q = q.eq('mes_referencia', mes);
      const { data: pacotes, error } = await q;
      if (error) throw error;
      if (!pacotes || pacotes.length === 0) {
        addToast('Nenhuma emissão encontrada nesse período.', 'warning');
        return;
      }

      // 2) Arquivos de todas as emissões (por pacote_id)
      const ids = pacotes.map((p) => p.id);
      const { data: arquivos, error: errA } = await supabase
        .from('emissoes_arquivos').select(ARQ_COLS).in('pacote_id', ids);
      if (errA) throw errA;
      const arqPorPacote = {};
      (arquivos || []).forEach((a) => { (arqPorPacote[a.pacote_id] ||= []).push(a); });

      // 3) Monta os grupos (uma emissão por competência, na ordem 1→8)
      const grupos = [];
      for (const p of pacotes) {
        let cobrancas = [];
        try {
          const conf = await apiFetch(`/api/condominio/${p.condominio_id}/conferencia?mes=${p.mes_referencia}&ano=${p.ano_referencia}&retificacao=false`);
          const todas = conf?.cobrancas_extras || [];
          const incl = p.cobrancas_incluidas;
          cobrancas = Array.isArray(incl) ? todas.filter((c) => incl.includes(c.id)) : todas;
        } catch { /* segue sem cobranças */ }
        const itens = ordenarParaExtracao(arqPorPacote[p.id] || [], cobrancas);
        if (itens.length) grupos.push({ label: `${MESES[p.mes_referencia] || '?'}/${p.ano_referencia}`, itens });
      }

      if (grupos.length === 0) {
        addToast('As emissões do período não têm documentos anexados.', 'warning');
        return;
      }

      // 4) ZIP com os ORIGINAIS, uma pasta por competência e um índice
      const { blob, pulados, incluidos } = await montarZipMulti(grupos, (i, n, nome) => setProg({ i, n, nome }));
      if (!blob || incluidos === 0) { addToast('Nenhum documento pôde ser baixado no período.', 'error'); return; }

      const nomeArq = `documentos_${(condoNome).replace(/[^\w]+/g, '_')}_${mes ? String(mes).padStart(2, '0') + '-' : ''}${ano}.zip`;
      saveAs(blob, nomeArq);
      const resumo = `${grupos.length} emissão(ões) · ${incluidos} documento(s)`;
      if (pulados.length) addToast(`ZIP gerado (${resumo}). ${pulados.length} item(ns) ficaram de fora: ${pulados.slice(0, 3).join('; ')}${pulados.length > 3 ? '…' : ''}`, 'warning');
      else addToast(`Documentos gerados! ${resumo}`, 'success');
    } catch (e) {
      addToast('Erro ao gerar: ' + (e.message || e), 'error');
    } finally {
      setRodando(false);
      setProg(null);
    }
  }

  return (
    <div className="glass-panel p-4 rounded-2xl border border-slate-200 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center shrink-0">
          <FolderDown className="w-5 h-5 text-violet-500" />
        </div>
        <div>
          <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Baixar documentos das emissões</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Baixa os documentos originais de cada emissão num ZIP, na ordem 1→8, com uma pasta por competência.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Condomínio</label>
          <select value={condominioId} onChange={(e) => setCondominioId(e.target.value)}
            className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            <option value="">Selecione…</option>
            {condos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ano</label>
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="block mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500/60">
            <option value={0}>Ano inteiro</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{MESES[m]}</option>)}
          </select>
        </div>
        <button onClick={baixar} disabled={rodando || !condominioId}
          className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
          {rodando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Baixar documentos (ZIP)
        </button>
      </div>

      {prog && (
        <div className="text-[11px] text-slate-500">
          {prog.n > 0
            ? <>Montando… <b className="text-slate-700">{prog.i}/{prog.n}</b> {prog.nome ? `· ${prog.nome}` : ''}</>
            : <>{prog.nome}</>}
        </div>
      )}
      {mes === 0 && !rodando && (
        <p className="text-[10px] text-amber-700"><Building2 className="w-3 h-3 inline -mt-0.5" /> Ano inteiro baixa muitos arquivos — pode demorar um pouco, mas não trava (são os originais, sem processamento).</p>
      )}
    </div>
  );
}
