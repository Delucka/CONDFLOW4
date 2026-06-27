import { apiPost } from '@/lib/api';

// Retorna a URL segura (do NOSSO domínio) para abrir/embutir o arquivo. O backend
// confere a permissão por arquivo antes de liberar. Token curto (120s).
export async function getArquivoUrlSeguro(path) {
  if (!path) return null;
  const r = await apiPost('/api/arquivo/link', { path });
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
