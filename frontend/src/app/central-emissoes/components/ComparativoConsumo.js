'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Droplet, Flame, Zap, TrendingUp, TrendingDown, Minus, Loader2, FileText, CalendarClock } from 'lucide-react';
import { abrirArquivoSeguro } from '@/lib/arquivo';

/**
 * O consumo do MÊS ANTERIOR, ao lado do que está sendo montado agora.
 *
 * Quem emite precisa de uma régua: uma conta de água que pulou de 3 mil para 12
 * mil é vazamento, erro de leitura ou fatura do condomínio errado — e o único
 * jeito de perceber isso na hora é ter o mês passado à vista. Sem isso, o número
 * estranho só aparece quando o condômino liga reclamando.
 *
 * Lê de `emissoes_arquivos`, que já guarda o que foi extraído das faturas
 * (`valor_fatura`) e dos relatórios de leitura (`relatorio_consumo_total`).
 * Não inventa dado: o que não foi extraído aparece como "—".
 */

const SERVICOS = [
  { id: 'agua',    rotulo: 'Água',    icon: Droplet, chaves: ['sabesp', 'agua', 'água'] },
  { id: 'gas',     rotulo: 'Gás',     icon: Flame,   chaves: ['comgas', 'comgás', 'gas', 'gás'] },
  { id: 'energia', rotulo: 'Energia', icon: Zap,     chaves: ['enel', 'energia', 'eletropaulo', 'cpfl', 'edp', 'light'] },
];

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A que serviço este arquivo pertence — pelo tipo do relatório ou pelo subtipo da fatura. */
function servicoDoArquivo(a) {
  const tipo = semAcento(a.relatorio_tipo_servico);
  if (tipo) {
    const achado = SERVICOS.find(s => s.id === tipo || s.chaves.some(k => tipo.includes(semAcento(k))));
    if (achado) return achado.id;
  }
  const sub = semAcento(a.subtipo);
  if (!sub) return null;
  return SERVICOS.find(s => s.chaves.some(k => sub.includes(semAcento(k))))?.id || null;
}

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Resume um conjunto de arquivos num {valor, consumo, fatura} por serviço.
 *
 * `fatura` guarda o caminho do anexo para poder ABRIR o documento: número em
 * tela responde "mudou quanto", mas quem precisa decidir se aquilo é vazamento
 * ou fatura trocada tem que olhar a conta.
 */
function resumir(arquivos) {
  const mapa = {};
  for (const a of arquivos || []) {
    const s = servicoDoArquivo(a);
    if (!s) continue;
    mapa[s] = mapa[s] || { valor: null, consumo: null, fatura: null, relatorio: null, contas: 0, proxima: null };

    // A próxima leitura vem na fatura do mês ANTERIOR: é ela que diz quando a
    // conta deste mês se forma. Guardada aqui, o emissor sabe o que esperar
    // antes de ter a conta em mãos — e quem cobra tem data para cobrar.
    // A mais distante manda: com duas instalações, o fechamento é a última.
    if (a.proxima_leitura_fatura && (!mapa[s].proxima || a.proxima_leitura_fatura > mapa[s].proxima)) {
      mapa[s].proxima = a.proxima_leitura_fatura;
    }

    // SOMA, não sobrescreve. Um condomínio pode ter mais de uma conta do mesmo
    // serviço no mesmo mês — dois hidrômetros, bloco e casa do zelador, duas
    // instalações. Atribuindo, o comparativo mostrava só a última anexada e
    // dava a entender que o consumo tinha caído pela metade.
    //
    // O backend (`_consumos_do_pacote`) já somava; era só aqui que divergia.
    if (a.valor_fatura != null) {
      mapa[s].valor = (mapa[s].valor || 0) + Number(a.valor_fatura);
      mapa[s].contas += 1;
    } else if (a.relatorio_valor_total != null) {
      mapa[s].valor = (mapa[s].valor || 0) + Number(a.relatorio_valor_total);
      mapa[s].contas += 1;
    }
    if (a.relatorio_consumo_total != null) {
      mapa[s].consumo = (mapa[s].consumo || 0) + Number(a.relatorio_consumo_total);
    }
    // A fatura da concessionária é o documento que se confere; o relatório de
    // leitura vem junto como segunda opção.
    if (a.arquivo_url && a.categoria === 'concessionaria' && !mapa[s].fatura) {
      mapa[s].fatura = { url: a.arquivo_url, nome: a.arquivo_nome };
    }
    if (a.arquivo_url && a.categoria === 'relatorio_leitura' && !mapa[s].relatorio) {
      mapa[s].relatorio = { url: a.arquivo_url, nome: a.arquivo_nome };
    }
  }
  return mapa;
}

/**
 * Um lado do comparativo. Vira botão quando existe documento anexado — o
 * número sozinho não resolve; para decidir se é vazamento ou fatura trocada,
 * é preciso abrir a conta.
 */
/**
 * "leitura prevista 12/09" — a data que a fatura do mês anterior informou.
 *
 * Muda de cor quando a data já passou: se a leitura era para ter acontecido e a
 * conta não chegou, é hora de cobrar, não de esperar.
 */
function PrevisaoLeitura({ data }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const passou = data < hoje;
  return (
    <span
      title={passou
        ? 'A leitura já deveria ter acontecido e a conta não chegou — vale cobrar o responsável.'
        : 'Data em que a concessionária lê o medidor. A conta chega depois disso.'}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        passou ? 'border-amber-300 bg-amber-50 text-amber-800'
               : 'border-violet-200 bg-violet-50 text-violet-700'}`}
    >
      <CalendarClock className="w-3 h-3" aria-hidden="true" />
      {passou ? 'leitura era ' : 'leitura '}{new Date(data + 'T12:00:00').toLocaleDateString('pt-BR')}
    </span>
  );
}

function Lado({ rotulo, valor, consumo, doc, vazio, forte, contas, onAbrir, abrindo }) {
  const conteudo = (
    <>
      <span className="text-[10px] uppercase tracking-widest text-slate-400 mr-1 font-normal">{rotulo}</span>
      {valor != null ? `R$ ${brl(valor)}` : vazio}
      {consumo != null && <span className="text-slate-400 font-normal"> · {brl(consumo)} m³</span>}
      {/* Dizer que são várias evita a leitura errada do total: sem isto, um mês
          com duas contas parece um mês caríssimo de uma conta só. */}
      {contas > 1 && (
        <span className="text-slate-400 font-normal"> · soma de {contas} contas</span>
      )}
    </>
  );
  const classe = `text-xs tabular-nums ${forte ? 'font-bold ' : ''}${valor != null ? (forte ? 'text-slate-800' : 'text-slate-500') : 'text-slate-400'}`;

  if (!doc) return <span className={classe}>{conteudo}</span>;

  return (
    <button type="button" onClick={() => onAbrir(doc)} disabled={abrindo === doc.url}
      title={`Abrir ${doc.nome || 'o documento anexado'}`}
      className={`${classe} inline-flex items-center gap-1 rounded-md px-1 -mx-1 hover:bg-violet-50 hover:text-violet-700 transition-colors disabled:opacity-50`}>
      {conteudo}
      {abrindo === doc.url
        ? <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />
        : <FileText className="w-3 h-3 shrink-0 text-violet-500" aria-hidden="true" />}
    </button>
  );
}

export default function ComparativoConsumo({ condominioId, mes, ano, arquivosAtuais }) {
  const supabase = useMemo(() => createClient(), []);
  const [anteriores, setAnteriores] = useState(null);   // null = carregando
  const [erro, setErro] = useState(false);

  // Mês anterior, virando o ano quando preciso.
  const { mesAnt, anoAnt } = useMemo(() => (
    mes === 1 ? { mesAnt: 12, anoAnt: ano - 1 } : { mesAnt: mes - 1, anoAnt: ano }
  ), [mes, ano]);

  useEffect(() => {
    if (!condominioId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        .from('emissoes_arquivos')
        .select('subtipo, categoria, valor_fatura, relatorio_tipo_servico, relatorio_consumo_total, relatorio_valor_total, arquivo_url, arquivo_nome, proxima_leitura_fatura')
        .eq('condominio_id', condominioId)
        .eq('mes_referencia', mesAnt)
        .eq('ano_referencia', anoAnt)
        .in('categoria', ['concessionaria', 'relatorio_leitura']);
      if (!vivo) return;
      if (error) { setErro(true); setAnteriores({}); return; }
      setAnteriores(resumir(data));
    })();
    return () => { vivo = false; };
  }, [supabase, condominioId, mesAnt, anoAnt]);

  const atuais = useMemo(() => resumir(arquivosAtuais), [arquivosAtuais]);

  // Nunca abre o Supabase direto: o backend confere a permissão por arquivo
  // antes de devolver a URL assinada.
  const [abrindo, setAbrindo] = useState(null);
  async function abrir(doc) {
    if (!doc?.url) return;
    setAbrindo(doc.url);
    try { await abrirArquivoSeguro(doc.url); }
    finally { setAbrindo(null); }
  }

  if (anteriores === null) {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando o consumo do mês anterior…
      </div>
    );
  }

  const linhas = SERVICOS
    .map(s => ({ s, ant: anteriores[s.id], atual: atuais[s.id] }))
    .filter(l => l.ant || l.atual);

  // Sem nada dos dois lados não vale ocupar espaço: condomínio sem consumo, ou
  // primeiro mês no sistema.
  if (linhas.length === 0) return null;

  const nomeMes = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                   'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][mesAnt];

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
        <Droplet className="w-4 h-4 text-sky-600" aria-hidden="true" />
        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-600">
          Comparativo de consumo
        </h4>
        <span className="text-[11px] text-slate-500">
          {nomeMes}/{String(anoAnt).slice(-2)} ao lado do que você está montando
        </span>
        {erro && <span className="ml-auto text-[11px] text-amber-700">não consegui ler o mês anterior</span>}
      </div>

      <div className="divide-y divide-slate-100">
        {linhas.map(({ s, ant, atual }) => {
          const Icone = s.icon;
          const vAnt = ant?.valor;
          const vAtual = atual?.valor;
          // Variação só faz sentido com os dois lados e base diferente de zero.
          const varia = (vAnt != null && vAtual != null && vAnt !== 0)
            ? ((vAtual - vAnt) / Math.abs(vAnt)) * 100
            : null;
          // 15% é onde uma conta deixa de ser oscilação e vira pergunta.
          const alerta = varia != null && Math.abs(varia) >= 15;
          const Seta = varia == null ? Minus : varia > 0 ? TrendingUp : TrendingDown;

          return (
            <div key={s.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5 w-24 shrink-0 text-xs font-bold text-slate-700">
                <Icone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                {s.rotulo}
              </span>

              <Lado rotulo="antes" valor={vAnt} consumo={ant?.consumo} doc={ant?.fatura || ant?.relatorio}
                    vazio="—" contas={ant?.contas} onAbrir={abrir} abrindo={abrindo} />

              <span className="text-slate-300">→</span>

              <Lado rotulo="agora" valor={vAtual} consumo={atual?.consumo} doc={atual?.fatura || atual?.relatorio}
                    vazio="ainda não anexada" forte contas={atual?.contas} onAbrir={abrir} abrindo={abrindo} />

              {/* A data que a conta do mês passado prometeu. Só aparece enquanto
                  a conta deste mês não chegou — depois disso ela já cumpriu o
                  papel, e o número real ocupa o lugar. É por esta data que se
                  cobra quem tem de mandar a fatura. */}
              {!atual && ant?.proxima && <PrevisaoLeitura data={ant.proxima} />}

              {varia != null && (
                <span className={`ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                  alerta ? 'border-amber-300 bg-amber-50 text-amber-800'
                         : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
                  title={alerta ? 'Variação grande — vale conferir a leitura e o condomínio da fatura.' : undefined}>
                  <Seta className="w-3 h-3" aria-hidden="true" />
                  {varia > 0 ? '+' : ''}{varia.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
