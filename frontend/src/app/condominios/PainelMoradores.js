'use client';
// Moradores de um condomínio: ver quem está pronto para a 2ª via, trazer os CPFs,
// e simular o atendimento do WhatsApp para conferir que o fluxo passa.
//
// Por que CPF importa: `_verificar_condomino` (api_routes.py) só libera a 2ª via quando
// a unidade tem uma linha com CPF **e** responsavel_pagamento. A Relação de Condôminos
// (PDF) traz unidade, nome, telefone e e-mail — mas não traz CPF. É aqui que ele entra.
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import Modal from '@/components/Modal';
import { Loader2, Upload, Eye, MessageCircle, ShieldCheck, Send } from 'lucide-react';

const LBL = 'block text-[10px] text-slate-500 font-black uppercase tracking-[0.15em]';
const CAMPO = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-violet-500 transition-colors';

// Aceita o que sair do Excel: tab, ';' ou ','. Espera unidade e CPF (bloco opcional).
function lerCpfs(texto) {
  const linhas = (texto || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (linhas.length === 0) return { itens: [], erro: 'Cole as linhas com unidade e CPF.' };

  const sep = ['\t', ';', ','].find((c) => linhas[0].includes(c));
  if (!sep) return { itens: [], erro: 'Não achei separador. Use duas colunas: unidade e CPF.' };

  // Pula o cabeçalho se a 1ª linha não tiver 11 dígitos em nenhuma coluna.
  const temCpf = (l) => l.split(sep).some((c) => c.replace(/\D/g, '').length === 11);
  const corpo = temCpf(linhas[0]) ? linhas : linhas.slice(1);

  const itens = [];
  for (const linha of corpo) {
    const cols = linha.split(sep).map((c) => c.trim());
    const iCpf = cols.findIndex((c) => c.replace(/\D/g, '').length === 11);
    if (iCpf < 0) continue;
    const unidade = cols.find((c, i) => i !== iCpf && c) || '';
    // Se houver 3 colunas, a do meio costuma ser o bloco.
    const bloco = cols.length >= 3 ? (cols.filter((c, i) => i !== iCpf && c !== unidade)[0] || null) : null;
    if (unidade) itens.push({ unidade, bloco, cpf: cols[iCpf].replace(/\D/g, '') });
  }
  return itens.length ? { itens, erro: null } : { itens: [], erro: 'Nenhuma linha com CPF de 11 dígitos.' };
}

export default function PainelMoradores({ open, onClose, condominio }) {
  const [aba, setAba] = useState('lista');          // 'lista' | 'cpf' | 'teste'
  const chave = open && condominio ? `/api/condominos?condominio_id=${condominio.id}` : null;
  const { data, isLoading, mutate } = useSWR(chave, apiFetcher);

  const resumo = data?.resumo;

  // Uma linha por unidade, com o estado que o WhatsApp enxerga.
  const unidades = useMemo(() => {
    const linhas = data?.condominos || [];
    const m = new Map();
    for (const r of linhas) {
      const u = (r.unidade || '').toUpperCase();
      if (!m.has(u)) m.set(u, { unidade: r.unidade, bloco: r.bloco, nome: null, cpf: null, emails: [] });
      const alvo = m.get(u);
      if (r.nome && !alvo.nome) alvo.nome = r.nome;
      if (r.cpf && r.responsavel_pagamento) alvo.cpf = r.cpf;
      if (r.email) alvo.emails.push(r.email);
    }
    return [...m.values()];
  }, [data?.condominos]);

  return (
    <Modal open={open} onClose={onClose} title={`Moradores — ${condominio?.name || ''}`} maxWidth="max-w-3xl">
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex gap-2 border-b border-slate-200 pb-3">
          {[['lista', 'Situação'], ['cpf', 'Trazer CPFs'], ['teste', 'Testar WhatsApp']].map(([id, rot]) => (
            <button key={id} type="button" onClick={() => setAba(id)}
              className={`px-3.5 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-colors ${
                aba === id ? 'bg-violet-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
              {rot}
            </button>
          ))}
        </div>

        {isLoading && <p className="text-xs text-slate-500 py-6 text-center">Carregando…</p>}

        {!isLoading && aba === 'lista' && (
          <SituacaoMoradores resumo={resumo} unidades={unidades} />
        )}

        {!isLoading && aba === 'cpf' && (
          <TrazerCpfs condominio={condominio} aoGravar={() => mutate()} />
        )}

        {aba === 'teste' && <TestarWhatsApp />}
      </div>
    </Modal>
  );
}

function SituacaoMoradores({ resumo, unidades }) {
  if (!resumo || resumo.registros === 0) {
    return (
      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-4">
        Nenhum morador cadastrado. Importe a <b>Relação de Condôminos</b> (PDF) pelo botão
        <b> Importar</b> da tela de condomínios.
      </p>
    );
  }
  const faltam = resumo.unidades - resumo.unidades_prontas;
  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <p className="text-2xl font-black text-slate-700 tabular-nums">{resumo.unidades}</p>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Unidades</p>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
          <p className="text-2xl font-black text-emerald-600 tabular-nums">{resumo.unidades_prontas}</p>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Prontas p/ 2ª via</p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
          <p className="text-2xl font-black text-amber-600 tabular-nums">{faltam}</p>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sem CPF</p>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        &ldquo;Pronta&rdquo; = tem CPF do responsável <b>e</b> e-mail cadastrado. É o que o
        atendimento do WhatsApp exige para liberar o boleto.
      </p>
      <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
        {unidades.map((u, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
            <span className="truncate text-slate-700 min-w-0">
              <b>{u.unidade}</b>{u.nome ? ` · ${u.nome}` : ''}
            </span>
            <span className="shrink-0 flex items-center gap-2">
              {u.emails.length > 0
                ? <span className="text-slate-400">{u.emails.length} e-mail(s)</span>
                : <span className="text-amber-600 font-bold">sem e-mail</span>}
              {u.cpf
                ? <span className="text-emerald-600 font-bold">CPF ok</span>
                : <span className="text-rose-600 font-bold">sem CPF</span>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function TrazerCpfs({ condominio, aoGravar }) {
  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState(null);
  const [itens, setItens] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);

  async function conferir() {
    setErro(null);
    const { itens: lidos, erro: e } = lerCpfs(texto);
    if (e) { setErro(e); return; }
    setItens(lidos);
    setOcupado(true);
    try {
      setPrevia(await apiPost('/api/condominos/cpf', { condominio_id: condominio.id, itens: lidos, confirmar: false }));
    } catch (e2) { setErro(e2.message || 'Não consegui conferir.'); }
    finally { setOcupado(false); }
  }

  async function gravar() {
    setOcupado(true);
    try {
      const r = await apiPost('/api/condominos/cpf', { condominio_id: condominio.id, itens, confirmar: true });
      setPrevia(null); setTexto(''); setItens([]);
      aoGravar();
      setErro(null);
      alert(`${r.resumo.gravados} CPF(s) gravado(s).`);
    } catch (e2) { setErro(e2.message || 'Erro ao gravar.'); }
    finally { setOcupado(false); }
  }

  if (previa) {
    return (
      <>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
            <p className="text-2xl font-black text-emerald-600 tabular-nums">{previa.resumo.definidos}</p>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">A definir</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <p className="text-2xl font-black text-slate-500 tabular-nums">{previa.resumo.ja_ok}</p>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Já estavam</p>
          </div>
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
            <p className="text-2xl font-black text-rose-600 tabular-nums">{previa.resumo.erros}</p>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Com erro</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Nada foi gravado ainda.</p>
        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
          {previa.resultados.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="truncate text-slate-700 min-w-0">{r.unidade}</span>
              <span className={`shrink-0 font-bold ${
                r.status === 'definido' ? 'text-emerald-600' : r.status === 'erro' ? 'text-rose-600' : 'text-slate-400'}`}>
                {r.status === 'definido' ? (r.motivo || 'definir') : r.motivo}
              </span>
            </div>
          ))}
        </div>
        {erro && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">{erro}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" onClick={() => setPrevia(null)}
            className="sm:w-auto px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-100">
            Voltar
          </button>
          <button type="button" onClick={gravar} disabled={ocupado || previa.resumo.definidos === 0}
            className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-40">
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Gravar {previa.resumo.definidos} CPF(s)
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
        <p>Cole duas colunas: <b>unidade</b> e <b>CPF</b> (bloco no meio, se houver). Direto do Excel serve.</p>
        <p className="text-slate-500">O CPF é gravado em quem é <b>responsável pelo pagamento</b> da unidade — é o que o WhatsApp confere.</p>
      </div>
      <textarea
        data-autofocus value={texto}
        onChange={(e) => { setTexto(e.target.value); setErro(null); }}
        rows={8}
        placeholder={'Unidade\tCPF\nA0011\t123.456.789-00\nA0012\t98765432100'}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-800 outline-none focus:border-violet-500"
      />
      {erro && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">{erro}</p>}
      <button type="button" onClick={conferir} disabled={ocupado || !texto.trim()}
        className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-black rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-40">
        {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
        Conferir antes de gravar
      </button>
    </>
  );
}

// Roda o MESMO _wa_step do atendimento real, sem n8n e sem Meta.
function TestarWhatsApp() {
  const [msgs, setMsgs] = useState([]);
  const [entrada, setEntrada] = useState('');
  const [estado, setEstado] = useState({ etapa: 'inicio', dados: {} });
  const [ocupado, setOcupado] = useState(false);

  async function enviar(texto) {
    const msg = texto ?? entrada;
    setOcupado(true);
    setMsgs((m) => [...m, { eu: true, texto: msg || '(iniciar)' }]);
    setEntrada('');
    try {
      const r = await apiPost('/api/integracao/wa/simular', {
        mensagem: msg, etapa: estado.etapa, dados: estado.dados,
      });
      setMsgs((m) => [...m, { eu: false, texto: r.reply }]);
      setEstado({ etapa: r.etapa, dados: r.dados || {} });
    } catch (e) {
      setMsgs((m) => [...m, { eu: false, texto: '⚠️ ' + (e.message || e) }]);
    } finally { setOcupado(false); }
  }

  return (
    <>
      <p className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
        Conversa com o <b>mesmo</b> código que atende no WhatsApp, sem passar pelo n8n nem pela Meta.
        Serve para ver onde o fluxo trava. Confirmar aqui <b>não</b> cria pedido de verdade.
      </p>
      <div className="h-64 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50">
        {msgs.length === 0 && (
          <button type="button" onClick={() => enviar('oi')}
            className="text-xs font-bold text-violet-600 hover:text-violet-500">
            <MessageCircle className="w-4 h-4 inline -mt-0.5" /> Começar a conversa
          </button>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.eu ? 'justify-end' : 'justify-start'}`}>
            <span className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap ${
              m.eu ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
              {m.texto}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={entrada} onChange={(e) => setEntrada(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !ocupado && entrada.trim()) { e.preventDefault(); enviar(); } }}
          placeholder="Responder…" aria-label="Mensagem"
          className={CAMPO}
        />
        <button type="button" onClick={() => enviar()} disabled={ocupado || !entrada.trim()}
          aria-label="Enviar mensagem"
          className="tap shrink-0 inline-flex items-center justify-center rounded-xl bg-violet-600 text-white px-4 disabled:opacity-40">
          {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Etapa atual: <b className="text-slate-600">{estado.etapa}</b></p>
    </>
  );
}
