import { createClient } from '@/utils/supabase/client';

// Base da API. Normalmente o mesmo domínio (''), servido pela função Python no Vercel
// (ver vercel.json). A VPS api.emissaonline.com fica atrás de um firewall que redes
// restritivas (ex.: a rede do escritório) bloqueiam — quando NEXT_PUBLIC_API_URL volta
// apontando pra ela, o painel cai em "Erro de Conexão". Enquanto o site roda no Vercel,
// ignoramos essa URL se ela reaparecer, pra não quebrar. Para voltar pra VPS (ex.: via
// Cloudflare, num IP que as redes liberem), remover este guard.
let API = process.env.NEXT_PUBLIC_API_URL || '';
if (API.includes('api.emissaonline.com')) API = '';

// Nada aqui pode ficar pendurado para sempre.
//
// Em 08/09/2026 os botões de anexar e de cancelar cobrança ficavam girando sem
// fim: nenhum erro na tela, nenhum registro em `audit_erros`, spinner eterno. A
// causa importa menos que a regra que faltava — **toda espera precisa de prazo**.
// Sem prazo, uma requisição que não volta prende o botão, o usuário clica de
// novo, e ninguém fica sabendo que houve falha.
//
// 30 s é folgado de propósito: a maior chamada do sistema (montar a emissão) já
// foi medida bem abaixo disso, então este teto só dispara quando algo está
// realmente errado.
const PRAZO = 30000;

function comPrazo(promessa, ms, oQue) {
  let t;
  return Promise.race([
    promessa.finally(() => clearTimeout(t)),
    new Promise((_, rejeita) => {
      t = setTimeout(() => rejeita(new Error(
        `${oQue} não respondeu em ${Math.round(ms / 1000)}s. Verifique a conexão e tente de novo.`
      )), ms);
    }),
  ]);
}

async function getAuthHeaders(supabase) {
  // `getSession()` renova o token sozinho quando ele expirou -- e é aí que ela
  // pode demorar. Com sessão de um projeto que já não existe (foi o caso depois
  // da mudança de região), ela ficava esperando por algo que nunca vinha.
  const { data: { session } } = await comPrazo(
    supabase.auth.getSession(), 15000, 'A verificação da sua sessão',
  );
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

// Sessão inválida (login expirado, ou derrubado ao entrar com a conta em outro lugar):
// leva pro /login com aviso, em vez de mostrar o "Erro de Conexão" genérico. O flag
// evita vários redirecionamentos quando várias chamadas dão 401 ao mesmo tempo.
let jaRedirecionando = false;
function irParaLoginSessaoExpirada() {
  if (typeof window === 'undefined' || jaRedirecionando) return;
  if (window.location.pathname.startsWith('/login')) return;
  jaRedirecionando = true;
  try { createClient().auth.signOut(); } catch { /* ignora */ }
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?expirado=1&next=${next}`;
}

// O `detail` do FastAPI nem sempre é texto. Erro de validação (422) vem como
// LISTA de objetos — [{ loc: ['body', 'due_day'], msg: '...' }] — e jogar isso
// direto no `new Error()` virava "[object Object]" no aviso da tela: a pessoa
// via que falhou, não o quê, e clicava de novo (em 11/09/2026 foram quatro
// avisos iguais em sequência). Aqui a lista vira uma frase com o nome do campo.
function textoDoErro(json) {
  const d = json?.detail ?? json?.message;
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    const campos = [...new Set(d.map((e) => {
      const loc = (e?.loc || []).filter((x) => x !== 'body' && x !== 'query' && typeof x !== 'number');
      return loc[loc.length - 1] || 'um campo';
    }))];
    return `O servidor recusou o formato de: ${campos.join(', ')}. Recarregue a página e tente de novo.`;
  }
  try { return JSON.stringify(d); } catch { return ''; }
}

export async function apiFetcher(url) {
  return apiFetch(url);
}

export async function apiFetch(path, opts = {}, _jaRenovou = false) {
  const supabase = createClient();
  try {
    const headers = await getAuthHeaders(supabase);
    // `AbortController` e não só um `Promise.race`: assim a requisição é de fato
    // cancelada, em vez de continuar viva ocupando conexão depois de desistirmos.
    const cancelador = new AbortController();
    const alarme = setTimeout(() => cancelador.abort(), opts.prazo || PRAZO);
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        ...opts,
        signal: cancelador.signal,
        headers: { ...headers, ...opts.headers },
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new Error('O servidor não respondeu a tempo. Tente de novo em instantes.');
      }
      throw e;
    } finally {
      clearTimeout(alarme);
    }

    // 401 = problema de AUTENTICAÇÃO (token expirado/derrubado), não de conexão.
    if (response.status === 401) {
      if (!_jaRenovou) {
        // Tenta renovar a sessão uma vez (caso o token só tenha expirado) e repete.
        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (!error && data?.session) {
            return await apiFetch(path, opts, true);
          }
        } catch { /* refresh falhou → cai no login abaixo */ }
      }
      // Não deu pra renovar: a sessão foi mesmo derrubada. Login limpo.
      irParaLoginSessaoExpirada();
      throw new Error('Sua sessão expirou. Faça login novamente.');
    }

    if (!response.ok) {
      let errorMessage = `Erro ${response.status}`;
      try {
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          errorMessage = textoDoErro(json) || errorMessage;
        } catch {
          errorMessage = text || errorMessage;
        }
      } catch {
        // ignora erro ao ler body
      }
      throw new Error(errorMessage);
    }

    return response.json();
  } catch (error) {
    console.error(`[API Error] ${path}:`, error.message);
    throw error;
  }
}

export async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function apiPut(path, body) {
  return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) });
}

export async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}
