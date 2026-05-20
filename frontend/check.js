const fs = require('fs');
const envStr = fs.readFileSync('.env.local', 'utf8');
const env = {};
envStr.split('\n').forEach(l => {
  if(l && l.includes('=')) {
    const [k, ...v] = l.split('=');
    env[k.trim()] = v.join('=').trim().replace(/['"]/g, '');
  }
});
fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/emissoes_pacotes?select=id,status', {
  headers: {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
}).then(r => r.json()).then(d => {
  console.log('Total pacotes:', d.length);
  const counts = {};
  d.forEach(p => counts[p.status] = (counts[p.status]||0) + 1);
  console.log('Statuses de pacotes:', counts);
}).catch(console.error);

fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/emissoes_ocorrencias?select=id,status', {
  headers: {
    'apikey': env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  }
}).then(r => r.json()).then(d => {
  if (!d || d.error) {
     console.log('Erro ocorrencias:', d);
     return;
  }
  console.log('Total ocorrencias:', d.length);
  const counts = {};
  d.forEach(p => counts[p.status] = (counts[p.status]||0) + 1);
  console.log('Statuses de ocorrencias:', counts);
}).catch(console.error);
