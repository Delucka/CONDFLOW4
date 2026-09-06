'use client';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { apiFetcher, apiFetch } from '@/lib/api';
import {
  ordenarParaExtracao, montarZipMulti, montarPdfMulti, juntarPdfsProntos,
  TIPOS_DOCUMENTO, filtrarPorTipo,
} from '@/lib/extrairEmissao';
import { apiPost } from '@/lib/api';
import { buscarPlanilhaDoMes, montarPlanilhaPdf } from '@/lib/planilhaPdf';
import SeletorCondominio from '@/components/SeletorCondominio';
import { saveAs } from 'file-saver';
import { FolderDown, Loader2, FileText, Building2, Printer } from 'lucide-react';

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
  const [tipoDoc, setTipoDoc] = useState('tudo'); // 'tudo' | 'emissao' | 'boletos'
  const [comPlanilha, setComPlanilha] = useState(true);
  const [rodando, setRodando] = useState(null);   // 'zip' | 'pdf'
  const [prog, setProg] = useState(null);       // { i, n, nome }

  const anos = Array.from({ length: 6 }, (_, i) => anoAtual - i);
  const condoNome = condos.find((c) => c.id === condominioId)?.name || 'condominio';

  /**
   * Busca as emissões do período e devolve `[{ label, itens }]`, na ordem 1→8.
   *
   * Sai de dentro do botão de ZIP porque o PDF precisa exatamente do mesmo
   * material: mudam o empacotamento e o destino, não a origem.
   */
  async function montarGrupos() {
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
        return null;
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
        // Cobrança extra é material de conferência (passo 7): não entra quando
        // o pedido é só dos boletos.
        if (tipoDoc !== 'boletos') {
          try {
            const conf = await apiFetch(`/api/condominio/${p.condominio_id}/conferencia?mes=${p.mes_referencia}&ano=${p.ano_referencia}&retificacao=false`);
            const todas = conf?.cobrancas_extras || [];
            const incl = p.cobrancas_incluidas;
            cobrancas = Array.isArray(incl) ? todas.filter((c) => incl.includes(c.id)) : todas;
          } catch { /* segue sem cobranças */ }
        }
        const itens = ordenarParaExtracao(filtrarPorTipo(arqPorPacote[p.id] || [], tipoDoc), cobrancas);
        // `sublabel` alimenta a folha de rosto do PDF: sem o nome do condomínio
        // ela não diz de quem é o maço, e num carrinho de impressão isso é a
        // única informação que importa.
        if (itens.length) {
          grupos.push({
            label: `${MESES[p.mes_referencia] || '?'}/${p.ano_referencia}`,
            sublabel: condoNome,
            itens,
          });
        }
      }

      if (grupos.length === 0) {
        addToast('As emissões do período não têm documentos anexados.', 'warning');
        return null;
      }
      return { grupos, pacotes };
  }

  /**
   * A planilha daquela competência, em bytes de PDF — ou `null`.
   *
   * `null` em três casos, todos legítimos: o pedido é só dos boletos (planilha
   * não é material de expedição), a pessoa desligou a opção, ou não há verba
   * lançada no mês. Neste último, desenhar uma folha zerada seria pior que não
   * desenhar: afirmaria que a previsão é zero.
   */
  async function planilhaDoMes(p, avisos) {
    if (!comPlanilha || tipoDoc === 'boletos') return null;
    const comp = `${MESES[p.mes_referencia] || '?'}/${p.ano_referencia}`;
    try {
      const { linhas, liberacao, motivo } = await buscarPlanilhaDoMes(
        supabase, p.condominio_id, p.mes_referencia, p.ano_referencia,
      );
      // Falhar calado foi o defeito que gerou este arquivo. Se a planilha foi
      // pedida e não saiu, a pessoa precisa saber por quê.
      if (!linhas.length) { avisos.push(`planilha de ${comp}: ${motivo || 'sem verbas'}`); return null; }
      return await montarPlanilhaPdf({
        condoNome, mes: p.mes_referencia, ano: p.ano_referencia, linhas, liberacao,
      });
    } catch (e) {
      // A planilha é um extra: não derruba o maço, mas também não some sem dizer.
      avisos.push(`planilha de ${comp}: ${e.message || e}`);
      return null;
    }
  }

  // O tipo entra no nome do arquivo: com dois maços saindo da mesma tela, dois
  // downloads com o mesmo nome na pasta viram "(1)" e ninguém sabe qual é qual.
  const nomeBase = () => {
    const sufixo = tipoDoc === 'emissao' ? '_emissao' : tipoDoc === 'boletos' ? '_boletos' : '';
    return `${(condoNome).replace(/[^\w]+/g, '_')}_${mes ? String(mes).padStart(2, '0') + '-' : ''}${ano}${sufixo}`;
  };

  async function baixarZip() {
    if (!condominioId) return addToast('Escolha o condomínio.', 'error');
    setRodando('zip');
    setProg({ i: 0, n: 0, nome: 'buscando emissões…' });
    try {
      const r = await montarGrupos();
      if (!r) return;
      const { grupos } = r;

      // ZIP com os ORIGINAIS, uma pasta por competência e um índice
      const { blob, pulados, incluidos } = await montarZipMulti(grupos, (i, n, nome) => setProg({ i, n, nome }));
      if (!blob || incluidos === 0) { addToast('Nenhum documento pôde ser baixado no período.', 'error'); return; }

      saveAs(blob, `documentos_${nomeBase()}.zip`);
      const resumo = `${grupos.length} emissão(ões) · ${incluidos} documento(s)`;
      if (pulados.length) addToast(`ZIP gerado (${resumo}). ${pulados.length} item(ns) ficaram de fora: ${pulados.slice(0, 3).join('; ')}${pulados.length > 3 ? '…' : ''}`, 'warning');
      else addToast(`Documentos gerados! ${resumo}`, 'success');
    } catch (e) {
      addToast('Erro ao gerar: ' + (e.message || e), 'error');
    } finally {
      setRodando(null);
      setProg(null);
    }
  }

  /**
   * PDF único, na ordem de auditoria, com uma página divisória por competência.
   *
   * A mesclagem acontece na memória do navegador, e os anexos têm ~750 KB em
   * média — por isso o aviso acima de doze emissões. O laço já é em série, um
   * arquivo por vez, mas o documento montado fica inteiro na memória até salvar.
   */
  async function imprimirPdf() {
    if (!condominioId) return addToast('Escolha o condomínio.', 'error');
    setRodando('pdf');
    setProg({ i: 0, n: 0, nome: 'buscando emissões…' });
    try {
      const r = await montarGrupos();
      if (!r) return;
      const { grupos, pacotes } = r;

      if (grupos.length > 12 && !window.confirm(
        `São ${grupos.length} emissões neste período. Juntar tudo num PDF só pode demorar ` +
        'e consumir bastante memória do navegador.\n\nQuer continuar?')) {
        return;
      }

      // ── O SERVIDOR MONTA; o navegador só costura ──────────────────────
      //
      // Os PDFs que o sistema emissor gera vêm cifrados (RC4 40 bits, senha de
      // usuário vazia, só para travar permissões). Visualizador nenhum reclama
      // — mas o pdf-lib, que roda aqui no navegador, NÃO decifra. Ele copiava
      // os bytes ainda cifrados e produzia um arquivo com o número certo de
      // páginas e todas em branco.
      //
      // O servidor usa pikepdf, que decifra. Medido com os quatro documentos do
      // 025 - SUN GATE: pelo navegador, 27 páginas e 27 em branco; pelo
      // servidor, as mesmas 27 páginas com o conteúdo todo.
      //
      // Então o servidor passou a ser o caminho NORMAL, não o plano B. Ele
      // trabalha por emissão, e o que ele devolve já vem limpo — daí o
      // navegador conseguir juntar as competências e pôr as folhas de rosto.
      // A PLANILHA VEM ANTES, e fora do caminho do servidor.
      //
      // Ela estava sendo montada DENTRO do ramo que fala com o servidor. Quando
      // esse ramo falhava, `planilhaDoMes` nem chegava a rodar: não saía a folha
      // e não saía aviso nenhum — que é a pior combinação possível, porque não
      // dá nem para descobrir o que houve.
      //
      // Agora ela é montada para toda competência, seja qual for o caminho do
      // resto do maço, e o que der errado é dito.
      const avisosPlanilha = [];
      const planilhas = new Map();
      for (const p of pacotes) {
        const comp = `${MESES[p.mes_referencia] || '?'}/${p.ano_referencia}`;
        setProg({ i: 0, n: 0, nome: `montando a planilha de ${comp}…` });
        planilhas.set(p.id, await planilhaDoMes(p, avisosPlanilha));
      }

      const prontas = [];
      const semServidor = [];
      for (let k = 0; k < pacotes.length; k += 1) {
        const p = pacotes[k];
        const comp = `${MESES[p.mes_referencia] || '?'}/${p.ano_referencia}`;
        setProg({ i: k + 1, n: pacotes.length, nome: `montando ${comp}…` });
        try {
          // O recorte por tipo vai junto: o servidor é quem monta, então é ele
          // que precisa saber se o pedido é da emissão, dos boletos, ou de tudo.
          const srv = await apiPost(`/api/emissoes/${p.id}/extrair-pdf?tipo=${tipoDoc}`, {});
          const resp = srv?.url ? await fetch(srv.url) : null;
          if (resp?.ok) {
            const g = grupos.find((x) => x.label === comp);
            prontas.push({
              label: comp,
              sublabel: condoNome,
              itens: g?.itens || [],
              // A planilha primeiro: ela é o que foi DEFINIDO, e o resto do maço
              // é o que saiu disso.
              bytes: [planilhas.get(p.id), await resp.arrayBuffer()],
              pulados: srv.pulados || [],
            });
            continue;
          }
          avisosPlanilha.push(`${comp}: o servidor não montou o PDF (HTTP ${resp?.status ?? 'sem resposta'})`);
        } catch (e) {
          avisosPlanilha.push(`${comp}: falha ao pedir o PDF ao servidor (${e.message || e})`);
        }
        semServidor.push(p);
      }

      let blob; let pulados = []; let paginasDeDocumento = 0;

      if (prontas.length) {
        const r2 = await juntarPdfsProntos(prontas);
        blob = r2.blob;
        paginasDeDocumento = r2.paginasDeDocumento;
        pulados = [
          ...avisosPlanilha,
          ...r2.pulados,
          ...prontas.flatMap((p) => (p.pulados || []).map((n) => `${p.label}: ${n}`)),
          ...semServidor.map((p) => `${MESES[p.mes_referencia]}/${p.ano_referencia} (servidor não respondeu)`),
        ];
      } else {
        // Nenhuma emissão passou pelo servidor. Tenta no navegador — funciona
        // para anexo que não esteja cifrado, e diz o motivo quando não der.
        //
        // A planilha entra aqui também: ela é desenhada localmente e não depende
        // do servidor, então não há razão para perdê-la junto com ele.
        setProg({ i: 0, n: 0, nome: 'tentando montar aqui…' });
        const r3 = await montarPdfMulti(grupos, (i, n, nome) => setProg({ i, n, nome }));
        const folhas = pacotes.map((p) => planilhas.get(p.id)).filter(Boolean);
        if (folhas.length) {
          const r4 = await juntarPdfsProntos([{ bytes: [...folhas, await r3.blob.arrayBuffer()] }]);
          blob = r4.blob;
          paginasDeDocumento = r4.paginasDeDocumento;
        } else {
          blob = r3.blob;
          paginasDeDocumento = r3.paginasDeDocumento;
        }
        pulados = [...avisosPlanilha, ...r3.pulados];
      }

      // A planilha foi pedida e nenhuma competência a produziu, mas nada
      // explicou por quê. Não deixar isso passar calado é metade do conserto.
      if (comPlanilha && tipoDoc !== 'boletos'
          && ![...planilhas.values()].some(Boolean) && avisosPlanilha.length === 0) {
        pulados.push('a planilha do gerente não foi montada e não houve erro — avise o suporte');
      }

      // Nada mesclou: não vale salvar um arquivo só com folhas de rosto e
      // chamar de sucesso. Diz o que aconteceu e manda para o ZIP.
      if (!blob || paginasDeDocumento === 0) {
        const porque = pulados.length
          ? ` Motivo do primeiro: ${pulados[0]}.`
          : '';
        addToast(
          `Nenhum documento pôde ser juntado no PDF.${porque} Baixe o ZIP com os originais.`,
          'error',
        );
        return;
      }

      saveAs(blob, `emissao_${nomeBase()}.pdf`);
      // Diz quantas planilhas entraram, e não só quantas páginas saíram: ficar
      // adivinhando se ela veio foi o que custou duas rodadas de conserto.
      const comFolha = [...planilhas.values()].filter(Boolean).length;
      const resumo = `${grupos.length} emissão(ões) · ${paginasDeDocumento} página(s) de documento`
        + (comFolha ? ` · ${comFolha} planilha(s) do gerente` : '');
      if (pulados.length) {
        addToast(`PDF gerado (${resumo}). ${pulados.length} item(ns) ficaram de fora — baixe o ZIP para eles: ${pulados.slice(0, 3).join('; ')}${pulados.length > 3 ? '…' : ''}`, 'warning');
      } else {
        addToast(`PDF pronto para imprimir! ${resumo}`, 'success');
      }
    } catch (e) {
      addToast('Erro ao gerar o PDF: ' + (e.message || e), 'error');
    } finally {
      setRodando(null);
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
          <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Documentos das emissões</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Na ordem 1→8. O <b>PDF</b> sai pronto para a impressora; o <b>ZIP</b> traz os arquivos originais, para arquivar.</p>
        </div>
      </div>

      {/* O maço é de dois tipos, e vinham grudados: no 025 - SUN GATE saíram
          3 páginas de emissão e 24 de boleto no mesmo PDF. */}
      <div className="flex flex-wrap items-center gap-2">
        {TIPOS_DOCUMENTO.map(({ id, rotulo, descricao }) => (
          <button key={id} type="button" onClick={() => setTipoDoc(id)}
            aria-pressed={tipoDoc === id} title={descricao}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors border ${
              tipoDoc === id
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {rotulo}
          </button>
        ))}
        <span className="text-[11px] text-slate-500">
          {TIPOS_DOCUMENTO.find((t) => t.id === tipoDoc)?.descricao}
        </span>
        {tipoDoc !== 'boletos' && (
          <label className="flex items-center gap-2 cursor-pointer ml-auto">
            <input type="checkbox" checked={comPlanilha} onChange={(e) => setComPlanilha(e.target.checked)}
              className="w-4 h-4 accent-violet-600" />
            <span className="text-[11px] text-slate-600">Incluir a planilha do gerente</span>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <SeletorCondominio condos={condos} value={condominioId} onChange={setCondominioId} />
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
        <button onClick={imprimirPdf} disabled={!!rodando || !condominioId}
          className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
          {rodando === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Imprimir tudo (PDF)
        </button>
        <button onClick={baixarZip} disabled={!!rodando || !condominioId}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-40">
          {rodando === 'zip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Originais (ZIP)
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
