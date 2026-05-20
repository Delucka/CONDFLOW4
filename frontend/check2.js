const fs = require('fs');
const envStr = fs.readFileSync('.env.vercel', 'utf8');
const env = {};
envStr.split('\n').forEach(l => {
  if(l && l.includes('=')) {
    const [k, ...v] = l.split('=');
    env[k.trim()] = v.join('=').trim().replace(/['"]/g, '');
  }
});
console.log(env);
