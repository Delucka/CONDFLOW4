import { apiPost } from '@/lib/api';

// Retorna uma URL segura para abrir/embutir/baixar o arquivo. O backend confere a
// permissão por arquivo antes de liberar. Por padrão devolve URL assinada do Supabase
// (entrega pela CDN, sem passar pela função). Passe { stream: true } quando for fazer
// fetch()/download no navegador — aí vem um link same-origin (não depende de CORS).
export async function getArquivoUrlSeguro(path, { stream = false } = {}) {
  if (!path) return null;
  const r = await apiPost('/api/arquivo/link', { path, stream });
  return r?.url || null;
}

// Abre o arquivo numa nova aba (via backend; nunca expõe o Supabase).
export async function abrirArquivoSeguro(path) {
  const url = await getArquivoUrlSeguro(path);
  if (url) {
    window.open(url, '_blank', 'noopener');
    return true;
  }
  return false;
}
