// Sanitiza o nome do arquivo para uso como CHAVE no Supabase Storage.
// O Storage rejeita acentos e vários caracteres especiais (ç, ã, #, espaços repetidos,
// parênteses em alguns casos…) — era isso que fazia o upload falhar "dependendo do nome".
// O nome original continua sendo guardado em arquivo_nome (para exibição).
export function safeStorageName(name) {
  const raw = (name || 'arquivo').toString().trim();
  const m = raw.match(/\.([a-zA-Z0-9]{1,8})$/);
  const ext = m ? '.' + m[1].toLowerCase() : '';
  const base = m ? raw.slice(0, -m[0].length) : raw;
  const clean = base
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')     // remove acentos
    .replace(/[^a-zA-Z0-9._-]+/g, '_')                   // qualquer outro caractere -> _
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
  return (clean || 'arquivo') + ext;
}
