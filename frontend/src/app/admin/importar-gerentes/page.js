'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { createClient } from '@/utils/supabase/client';
import { apiPost } from '@/lib/api';
import gerentesEmails from '@/data/gerentes-emails.json';
import {
  Users, Mail, Copy, Loader2, Check, AlertCircle,
  ChevronRight, RefreshCw, Eye, EyeOff, Building2, ShieldAlert, Send
} from 'lucide-react';

function gerarSenhaTemp() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out + '!';
}

export default function ImportarGerentesPage() {
  const { profile, loading: authLoading } = useAuth();
  const [supabase] = useState(() => createClient());

  const [ghosts, setGhosts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [erroLoad, setErroLoad] = useState(null);
  const [rows, setRows]       = useState({});
  const [running, setRunning] = useState(false);
  const [showPass, setShowPass] = useState({});
  const [copiou, setCopiou]   = useState({});
  const [msg, setMsg] = useState('');

  async function fetchGhosts() {
    console.log('[importar-gerentes] fetchGhosts start');
    setLoading(true);
    setErroLoad(null);
    try {
      const { data, error } = await supabase
        .from('gerentes')
        .select('id, nome, codigo_externo, profile_id')
        .is('profile_id', null)
        .order('codigo_externo');

      if (error) {
        console.error('[importar-gerentes] erro supabase:', error);
        throw error;
      }

      const list = data || [];
      console.log('[importar-gerentes] ghosts:', list.length);

      const ids = list.map(g => g.id);
      let condoCounts = {};
      if (ids.length) {
        const { data: condos } = await supabase
          .from('condominios')
          .select('gerente_id')
          .in('gerente_id', ids);
        (condos || []).forEach(c => {
          if (c.gerente_id) condoCounts[c.gerente_id] = (condoCounts[c.gerente_id] || 0) + 1;
        });
      }

      const enriched = list.map(g => ({ ...g, condos_count: condoCounts[g.id] || 0 }));
      setGhosts(enriched);

      const init = {};
      for (const g of enriched) {
        const cfg = gerentesEmails[g.codigo_externo] || {};
        init[g.id] = {
          nome: cfg.nome || g.nome || '',
          email: cfg.email || '',
          senha: gerarSenhaTemp(),
          criando: false,
          resultado: null,
          mensagem: '',
        };
      }
      setRows(init);
    } catch (err) {
      console.error('[importar-gerentes] catch:', err);
      setErroLoad(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  // Só fetch quando o profile estiver carregado e for master
  useEffect(() => {
    if (authLoading) return;
    if (profile?.role === 'master') {
      fetchGhosts();
    } else {
      setLoading(false);
    }
  }, [authLoading, profile?.role]);

  function atualizar(id, patch) {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function criarUm(g) {
    const row = rows[g.id];
    if (!row || !row.email || !row.email.includes('@')) {
      atualizar(g.id, { resultado: 'erro', mensagem: 'Email inválido' });
      return;
    }
    atualizar(g.id, { criando: true, resultado: null, mensagem: '' });
    try {
      await apiPost('/api/usuarios', {
        email: row.email,
        password: row.senha,
        full_name: row.nome,
        role: 'gerente',
      });
      atualizar(g.id, { criando: false, resultado: 'ok', mensagem: 'Criado ✓', email_enviado: false });
    } catch (err) {
      atualizar(g.id, { criando: false, resultado: 'erro', mensagem: (err.message || String(err)).slice(0, 150) });
    }
  }

  async function enviarEmail(g) {
    const row = rows[g.id];
    if (!row || row.resultado !== 'ok') return;
    atualizar(g.id, { enviando_email: true, email_err: '' });
    try {
      await apiPost('/api/email/welcome', {
        email: row.email,
        name: row.nome,
        password: row.senha,
      });
      atualizar(g.id, { enviando_email: false, email_enviado: true, email_err: '' });
    } catch (err) {
      atualizar(g.id, { enviando_email: false, email_err: (err.message || String(err)).slice(0, 200) });
    }
  }

  async function enviarTodosEmails() {
    const prontos = ghosts.filter(g => rows[g.id]?.resultado === 'ok' && !rows[g.id]?.email_enviado);
    setMsg(`Enviando ${prontos.length} email${prontos.length !== 1 ? 's' : ''}...`);
    for (const g of prontos) {
      await enviarEmail(g);
    }
    setMsg('Envio finalizado.');
  }

  async function criarTodos() {
    setRunning(true);
    setMsg('Criando usuários...');
    const pendentes = ghosts.filter(g => rows[g.id]?.email && rows[g.id]?.resultado !== 'ok');
    for (const g of pendentes) {
      await criarUm(g);
    }
    setRunning(false);
    setMsg('Processo finalizado.');
    setTimeout(() => fetchGhosts(), 1500);
  }

  function copiar(id, txt) {
    try {
      navigator.clipboard.writeText(txt);
      setCopiou(prev => ({ ...prev, [id]: true }));
      setTimeout(() => setCopiou(prev => ({ ...prev, [id]: false })), 1500);
    } catch {}
  }

  const totalCriaveis = useMemo(
    () => ghosts.filter(g => rows[g.id]?.email).length,
    [ghosts, rows]
  );
  const totalSemEmail = Math.max(0, ghosts.length - totalCriaveis);
  const totalCriados = useMemo(
    () => ghosts.filter(g => rows[g.id]?.resultado === 'ok').length,
    [ghosts, rows]
  );
  const totalEmailsPendentes = useMemo(
    () => ghosts.filter(g => rows[g.id]?.resultado === 'ok' && !rows[g.id]?.email_enviado).length,
    [ghosts, rows]
  );

  // ── Estados de tela ─────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    );
  }

  if (profile?.role !== 'master') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-bold">Acesso restrito</p>
          <p className="text-slate-500 text-sm mt-1">Apenas o master pode importar gerentes.</p>
          <p className="text-slate-600 text-xs mt-2">Seu role: {profile?.role || 'desconhecido'}</p>
        </div>
      </div>
    );
  }

  // ── UI principal ────────────────────────────────────────────────
  return (
    <div className="animate-fade-in w-full max-w-6xl mx-auto py-6 px-4">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
            <Users className="w-5 h-5 text-violet-400" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">Importar Gerentes</h2>
        </div>
        <p className="text-slate-400 text-sm">Cria os usuários dos gerentes-fantasma (importados do Ahreas) em lote.</p>
      </div>

      {erroLoad && (
        <div className="mb-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-rose-300 text-sm">
          <strong>Erro ao carregar:</strong> {erroLoad}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-violet-500/10 border border-violet-500/30 rounded-2xl px-5 py-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">Ghosts pendentes</p>
          <p className="text-3xl font-black text-white mt-1">{ghosts.length}</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-5 py-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Prontos pra criar</p>
          <p className="text-3xl font-black text-white mt-1">{totalCriaveis}</p>
        </div>
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl px-5 py-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">Sem email</p>
          <p className="text-3xl font-black text-white mt-1">{totalSemEmail}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button onClick={criarTodos} disabled={running || loading || totalCriaveis === 0}
          className="flex-1 py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
          Criar todos ({totalCriaveis})
        </button>
        {totalEmailsPendentes > 0 && (
          <button onClick={enviarTodosEmails}
            className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all">
            <Send className="w-4 h-4" /> Enviar todos os emails ({totalEmailsPendentes})
          </button>
        )}
        <button onClick={fetchGhosts} disabled={loading}
          className="px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-300 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {msg && (
        <div className="mb-4 px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-cyan-300 text-xs">{msg}</div>
      )}

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 mb-6 text-xs text-amber-200/80 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
        <div>
          Senhas temporárias são geradas automaticamente. <strong>Copie cada uma antes de criar</strong> e envie aos gerentes.
          Eles serão obrigados a trocar a senha no primeiro acesso.
        </div>
      </div>

      {loading ? (
        <div className="p-20 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
        </div>
      ) : ghosts.length === 0 ? (
        <div className="p-20 text-center bg-emerald-500/5 border border-emerald-500/20 rounded-3xl">
          <Check className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <p className="text-white font-black text-lg">Tudo limpo!</p>
          <p className="text-slate-400 text-sm mt-1">Não há mais ghosts pendentes de criação.</p>
        </div>
      ) : (
        <div className="bg-slate-900/50 border border-white/5 rounded-3xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 border-b border-white/5">
              <tr className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                <th className="px-4 py-3 text-left">Cód / Nome</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Senha</th>
                <th className="px-4 py-3 text-left">Condos</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ghosts.map(g => {
                const row = rows[g.id] || {};
                const status = row.resultado;
                return (
                  <tr key={g.id} className={status === 'ok' ? 'bg-emerald-500/5' : ''}>
                    <td className="px-4 py-3 align-top">
                      <p className="text-[10px] font-mono text-violet-300">{g.codigo_externo}</p>
                      <input
                        value={row.nome || ''}
                        onChange={(e) => atualizar(g.id, { nome: e.target.value })}
                        className="text-sm font-bold text-white bg-transparent border-none outline-none w-full focus:bg-white/5 px-1 rounded"
                      />
                    </td>
                    <td className="px-4 py-3 min-w-[260px] align-top">
                      <div className="relative">
                        <Mail className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                        <input
                          type="email"
                          value={row.email || ''}
                          onChange={(e) => atualizar(g.id, { email: e.target.value })}
                          placeholder="email@dominio.com.br"
                          className="w-full pl-7 pr-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 focus:border-violet-500 outline-none"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 min-w-[220px] align-top">
                      <div className="flex items-center gap-1">
                        <input
                          type={showPass[g.id] ? 'text' : 'password'}
                          value={row.senha || ''}
                          onChange={(e) => atualizar(g.id, { senha: e.target.value })}
                          className="flex-1 min-w-0 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-cyan-300 font-mono focus:border-cyan-500 outline-none"
                        />
                        <button onClick={() => setShowPass(p => ({ ...p, [g.id]: !p[g.id] }))}
                          className="p-1.5 text-slate-500 hover:text-cyan-400 shrink-0">
                          {showPass[g.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                        <button onClick={() => copiar(g.id, row.senha)}
                          className={`p-1.5 shrink-0 ${copiou[g.id] ? 'text-emerald-400' : 'text-slate-500 hover:text-cyan-400'}`}>
                          {copiou[g.id] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button onClick={() => atualizar(g.id, { senha: gerarSenhaTemp() })}
                          className="p-1.5 text-slate-500 hover:text-cyan-400 shrink-0">
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="text-xs text-slate-400 flex items-center gap-1 whitespace-nowrap">
                        <Building2 className="w-3 h-3" /> {g.condos_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right align-top whitespace-nowrap">
                      {status === 'ok' ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                            <Check className="w-3 h-3" /> Criado
                          </span>
                          {row.email_enviado ? (
                            <span className="inline-flex items-center gap-1 text-cyan-400 text-[10px] font-black uppercase tracking-widest">
                              <Check className="w-3 h-3" /> Email enviado
                            </span>
                          ) : (
                            <button onClick={() => enviarEmail(g)} disabled={row.enviando_email}
                              className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 rounded text-[10px] font-black uppercase tracking-widest disabled:opacity-30 flex items-center gap-1">
                              {row.enviando_email ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              {row.enviando_email ? 'Enviando...' : 'Enviar email'}
                            </button>
                          )}
                          {row.email_err && (
                            <p className="text-[9px] text-rose-400 mt-1 max-w-[200px] break-words text-right" title={row.email_err}>
                              {row.email_err}
                            </p>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => criarUm(g)} disabled={row.criando || !row.email}
                          className="px-3 py-1.5 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-violet-400 rounded text-[10px] font-black uppercase tracking-widest disabled:opacity-30">
                          {row.criando ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Criar'}
                        </button>
                      )}
                      {status === 'erro' && row.mensagem && (
                        <p className="text-[9px] text-rose-400 mt-1 max-w-[200px] break-words" title={row.mensagem}>
                          {row.mensagem}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
