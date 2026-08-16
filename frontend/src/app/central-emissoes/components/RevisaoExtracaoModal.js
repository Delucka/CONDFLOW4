'use client';
import { useState } from 'react';
import { CheckCircle, Loader2, X, AlertCircle, Sparkles } from 'lucide-react';
import { nomeArquivoPadrao, parseNumBR, fmtNumBR } from './faturaCampos';

// Modal de revisão: aparece quando a extração tem baixa confiança ou não
// identificou a empresa. Vem pré-preenchido com o que foi extraído; o usuário
// confirma/corrige e o arquivo é anexado (re-checando duplicata).
export default function RevisaoExtracaoModal({ info, onCancel, onConfirm }) {
  const { extracao, categoria, file } = info;
  const ehFatura = categoria === 'concessionaria';
  const { texto_bruto, ...brutos } = extracao || {};

  // Estado dos campos
  const detectado = extracao?.subtipo || '';
  const empresasFatura = ['SABESP', 'COMGAS', 'ENEL'];
  const empresasRelatorio = ['Prosper'];
  const lista = ehFatura ? empresasFatura : empresasRelatorio;
  const detectadoNaLista = lista.includes(detectado);

  const [empresa, setEmpresa] = useState(detectadoNaLista ? detectado : (detectado ? 'Outra' : lista[0]));
  const [empresaOutra, setEmpresaOutra] = useState(detectadoNaLista ? '' : detectado);
  const [cliente, setCliente] = useState(extracao?.cliente || '');
  const [vencimento, setVencimento] = useState(extracao?.vencimento || '');
  const [leituraAtual, setLeituraAtual] = useState(extracao?.leitura_atual || '');
  const [proximaLeitura, setProximaLeitura] = useState(extracao?.proxima_leitura || '');
  const [tipoServico, setTipoServico] = useState(extracao?.tipo_servico || 'agua');
  const [dataLeitura, setDataLeitura] = useState(extracao?.data_leitura || '');
  const [unidades, setUnidades] = useState(extracao?.numero_unidades ?? '');
  const [valor, setValor] = useState(fmtNumBR(ehFatura ? extracao?.valor : extracao?.valor_total));
  const [consumo, setConsumo] = useState(fmtNumBR(extracao?.consumo_total));
  const [salvando, setSalvando] = useState(false);

  const empresaFinal = empresa === 'Outra' ? empresaOutra.trim() : empresa;
  const confPct = Math.round((extracao?.confianca || 0) * 100);

  // Próxima leitura é obrigatória na fatura de concessionária.
  //
  // É ela que agenda a cobrança do mês seguinte: sem a data, a conta some da
  // fila e ninguém cobra — o que só se descobre no mês que vem, com a emissão
  // parada. Um campo a mais agora evita uma emissão travada depois.
  //
  // Vale só para FATURA. O relatório de leitura não traz essa informação.
  const faltaProximaLeitura = ehFatura && !proximaLeitura;

  async function handleConfirm() {
    if (!empresaFinal || faltaProximaLeitura) return;
    setSalvando(true);
    const baseExtras = {
      extracao_status: 'sucesso',
      extracao_confianca: extracao?.confianca ?? null,
      extracao_dados_brutos: brutos,
      extracao_em: new Date().toISOString(),
    };
    let extras, subtipo;
    if (ehFatura) {
      subtipo = empresaFinal.toUpperCase();
      extras = {
        ...baseExtras,
        nome_condominio_fatura: cliente.trim() || null,
        vencimento_fatura: vencimento || null,
        valor_fatura: parseNumBR(valor),
        leitura_atual_fatura: leituraAtual || null,
        proxima_leitura_fatura: proximaLeitura || null,
        dados_extraidos_em: new Date().toISOString(),
      };
    } else {
      subtipo = empresaFinal;
      extras = {
        ...baseExtras,
        relatorio_empresa: empresaFinal,
        relatorio_tipo_servico: tipoServico,
        relatorio_data_leitura: dataLeitura || null,
        relatorio_unidades: unidades ? parseInt(String(unidades), 10) : null,
        relatorio_consumo_total: parseNumBR(consumo),
        relatorio_valor_total: parseNumBR(valor),
      };
    }
    await onConfirm(categoria, subtipo, extras, file);
  }

  const inputCls = 'w-full mt-1 bg-slate-100 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white border border-violet-500/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Confira os dados extraídos</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                {file?.name} · confiança {confPct}%
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        {extracao?.erro && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {extracao.erro}
          </div>
        )}
        {(extracao?.barcode || extracao?.ocr) ? (
          <div className="mb-3 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-[11px] text-violet-700 flex items-start gap-2">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {extracao?.barcode ? <><b>Valor lido do código de barras</b> (exato). </> : <>Imagem lida por OCR. </>}
              <b>Confira o vencimento</b> e os demais campos com o PDF antes de anexar.
            </span>
          </div>
        ) : !extracao?.erro && (
          <p className="mb-3 text-[11px] text-slate-400">
            A leitura automática não teve confiança suficiente. Revise os campos abaixo antes de anexar.
          </p>
        )}

        <div className="space-y-3">
          {/* Empresa / Concessionária */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {ehFatura ? 'Concessionária' : 'Empresa de leitura'}
            </label>
            <select value={empresa} onChange={e => setEmpresa(e.target.value)} className={inputCls}>
              {lista.map(op => <option key={op} value={op}>{op}</option>)}
              <option value="Outra">Outra (digitar)</option>
            </select>
            {empresa === 'Outra' && (
              <input value={empresaOutra} onChange={e => setEmpresaOutra(e.target.value)}
                placeholder="Nome da empresa" className={inputCls} />
            )}
          </div>

          {ehFatura ? (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cliente na conta</label>
                <input value={cliente} onChange={e => setCliente(e.target.value)} placeholder="EDIFICIO ..." className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vencimento</label>
                  <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valor R$</label>
                  <input value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00"
                    className={`${inputCls} text-right font-mono`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Leitura atual</label>
                  <input type="date" value={leituraAtual} onChange={e => setLeituraAtual(e.target.value)} className={inputCls} />
                </div>
                <div>
                  {/* Este campo alimenta a cobrança: é ele que diz quando a
                      conta do mês que vem se forma, e portanto a partir de
                      quando faz sentido cobrar quem não mandou. Quando a
                      extração falha, é aqui que ele entra à mão — por isso o
                      rótulo diz para que serve, em vez de só nomear o campo. */}
                  <label className="text-[10px] font-bold uppercase tracking-wider text-violet-500">
                    Próxima leitura <span className="text-rose-500">*</span>
                  </label>
                  <input type="date" value={proximaLeitura} onChange={e => setProximaLeitura(e.target.value)}
                    className={inputCls} />
                  <p className={`mt-0.5 text-[9px] leading-tight ${faltaProximaLeitura ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                    {faltaProximaLeitura
                      ? 'obrigatório — procure na conta, costuma vir perto da leitura atual'
                      : 'vem impressa na conta · agenda a cobrança do mês que vem'}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tipo de serviço</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button type="button" onClick={() => setTipoServico('agua')}
                    className={`py-2 rounded-lg text-xs font-black uppercase tracking-widest border transition-all ${tipoServico === 'agua' ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'bg-slate-100 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    💧 Água
                  </button>
                  <button type="button" onClick={() => setTipoServico('gas')}
                    className={`py-2 rounded-lg text-xs font-black uppercase tracking-widest border transition-all ${tipoServico === 'gas' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-slate-100 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    🔥 Gás
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Data da leitura</label>
                <input type="date" value={dataLeitura} onChange={e => setDataLeitura(e.target.value)} className={inputCls} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unidades</label>
                  <input type="number" value={unidades} onChange={e => setUnidades(e.target.value)} placeholder="52"
                    className={`${inputCls} text-right font-mono`} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Consumo m³</label>
                  <input value={consumo} onChange={e => setConsumo(e.target.value)} placeholder="1.188,70"
                    className={`${inputCls} text-right font-mono`} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valor R$</label>
                  <input value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00"
                    className={`${inputCls} text-right font-mono`} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} disabled={salvando}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-700 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleConfirm} disabled={salvando || !empresaFinal || faltaProximaLeitura}
            title={faltaProximaLeitura ? 'Preencha a próxima leitura — é ela que agenda a cobrança' : undefined}
            className={`px-5 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50 flex items-center gap-2 ${ehFatura ? 'bg-amber-600 hover:bg-amber-500' : 'bg-violet-600 hover:bg-violet-500'}`}>
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Anexar
          </button>
        </div>
      </div>
    </div>
  );
}
