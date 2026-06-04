# 📋 Plano — Extração automática de PDFs para Consumos

> **Status**: ✅ **IMPLEMENTADO** (Fases 1-5) em 04/06/2026. Falta: usuário rodar migration 0041 + deploy + sample Hidrogeotec.
> **Última atualização**: 04/06/2026
> **Sessão anterior**: implementou Migration 0040 + endpoints `check-duplicata-completa` e `sancionar-repeticao` + UI manual de Relatório/Concessionária
>
> **Esta sessão** implementou: migration 0041 (status de extração + colunas de leitura na fatura + trigger atualizado), `api/pdf_extractor.py` (5 extractors, parsers testados), endpoint `POST /api/consumos/extrair-pdf`, refator do `VisaoEmissor.js` (extração automática + modal de revisão), e dashboard no topo do `/consumos` (stats + banner de alertas + feed, com relatórios de leitura incluídos, polling SWR 30s).
> **Pendente**: Hidrogeotec usa fallback genérico até o usuário mandar um sample real (extractor marcado com TODO).

---

## 🎯 Objetivo

Quando o usuário anexa um PDF de fatura (SABESP/COMGAS/ENEL) ou relatório (Prosper/Hidrogeotec) numa **emissão da Central de Emissões**, o sistema deve:

1. Ler o PDF automaticamente
2. Extrair os dados estruturados
3. Detectar duplicata contra histórico
4. Salvar tudo + sincronizar com `consumos_faturas` ou `consumos_relatorios_leitura`
5. Mostrar alerta apenas se houver problema

O usuário **não preenche nada**. Forms manuais só aparecem se extração falhar.

---

## 📊 Estado atual do projeto

### ✅ Já implementado (migrations 0035-0040, código deployado)

| Item | Local |
|---|---|
| Tabela `consumos_faturas` | Migration 0035 |
| Trigger `sync_concessionaria_to_consumos` | Migration 0037 |
| Tabela `consumos_relatorios_leitura` | Migration 0040 |
| Trigger `sync_relatorio_to_consumos` | Migration 0040 |
| Coluna `categoria='relatorio_leitura'` em emissoes_arquivos | Migration 0040 |
| Endpoint `POST /api/consumos/check-duplicata-completa` | `api/api_routes.py` |
| Endpoint `POST /api/consumos/sancionar-repeticao` | `api/api_routes.py` |
| UI: 4 botões de upload (Emissão/Concessionária/Relatório/Outros) | `VisaoEmissor.js` |
| UI: modal de duplicata com sancionamento RBAC | `VisaoEmissor.js` |
| UI: modal manual de Relatório (form com 7 campos) | `VisaoEmissor.js` ← **vai ser SUBSTITUÍDO pela extração automática** |
| `/consumos` matriz + badges + tooltips | `app/consumos/page.js` ← **vai ser REPAGINADO** |

### ❌ Ainda falta (este plano)

| Fase | Tempo | Quem |
|---|---|---|
| 0. Pegar sample Hidrogeotec do usuário | 5min | usuário |
| 1. Migration 0041 (status de extração) | 5min | dev |
| 2. `api/pdf_extractor.py` com 5 extractors | 1h | dev |
| 3. Endpoint `POST /api/consumos/extrair-pdf` | 30min | dev |
| 4. VisaoEmissor: auto-extract + fallback manual | 1h | dev |
| 5. Repaginar `/consumos` (dashboard + feed + explorador) | 2h | dev |
| 6. Build + commit + deploy | 10min | dev |
| 7. Rodar migration 0041 no Supabase | 2min | usuário |

**Total estimado: ~4h30 de código**

---

## 🏗️ Arquitetura técnica

```
USER selects PDF in VisaoEmissor (Central de Emissões)
    │
    ▼
Frontend: POST /api/consumos/extrair-pdf (multipart)
    │
    ▼
Backend (FastAPI):
  1. pdfplumber abre PDF
  2. detect(text) → identifica empresa
  3. ExtractorEspecifico.extract(text) → dados estruturados
  4. check-duplicata-completa roda automaticamente
  5. retorna { tipo, subtipo, dados, alertas, bloqueia, confianca }
    │
    ▼
Frontend continua:
  - confianca >= 0.8 e sem bloqueio: upload + insert COM metadata extraída
  - confianca < 0.8: abre form pré-preenchido pro user confirmar/completar
  - bloqueia=true: modal de sancionamento (master/departamento)
    │
    ▼
Trigger SQL: sync_concessionaria_to_consumos OU sync_relatorio_to_consumos
    │
    ▼
consumos_faturas/relatorios atualizado
    │
    ▼
/consumos exibe via SWR (refresh 30s)
```

---

## 🗄️ Migration 0041 (a criar)

```sql
-- ==========================================
-- MIGRATION: Status de extração de PDF em emissoes_arquivos
-- ==========================================

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS extracao_status TEXT
    CHECK (extracao_status IN ('pendente', 'sucesso', 'parcial', 'falha')),
  ADD COLUMN IF NOT EXISTS extracao_confianca NUMERIC(3,2),  -- 0.00 a 1.00
  ADD COLUMN IF NOT EXISTS extracao_dados_brutos JSONB,       -- debug
  ADD COLUMN IF NOT EXISTS extracao_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_arquivos_extracao_status
  ON public.emissoes_arquivos(extracao_status)
  WHERE extracao_status IN ('parcial', 'falha');
```

---

## 🔧 Backend — `api/pdf_extractor.py` (NOVO arquivo)

### Dependência

Adicionar em `api/requirements.txt`:
```
pdfplumber
```

### Estrutura do módulo

```python
"""
Extrator de PDFs de concessionárias e empresas de leitura.
Roteamento baseado em detecção do nome da empresa nos primeiros 2000 chars.
"""
import pdfplumber
import re
import io
from datetime import datetime
from typing import Optional


# ===== Helpers =====
def parse_brl(s) -> Optional[float]:
    """'R$ 11.108,90' -> 11108.90"""
    if not s:
        return None
    s = re.sub(r'[^0-9,]', '', str(s))
    if not s:
        return None
    s = s.replace('.', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def parse_date_br(s) -> Optional[str]:
    """Aceita DD/MM/YYYY, DD.MM.YYYY, DD/MM/YY, etc. Retorna ISO YYYY-MM-DD."""
    if not s:
        return None
    s = str(s).strip()
    formats = ['%d/%m/%Y', '%d.%m.%Y', '%d/%m/%y', '%d.%m.%y', '%d-%m-%Y']
    for fmt in formats:
        try:
            d = datetime.strptime(s, fmt)
            if d.year < 100:
                d = d.replace(year=d.year + 2000)
            return d.strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None


def find_first(text: str, patterns: list) -> Optional[str]:
    """Testa lista de regex e retorna primeiro match (group 1 ou full match)."""
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE | re.MULTILINE)
        if m:
            return (m.group(1) if m.groups() else m.group(0)).strip()
    return None


# ===== Detector =====
def detect_tipo(text: str):
    """Detecta tipo (fatura/relatorio) e subtipo (SABESP/COMGAS/ENEL/Prosper/Hidrogeotec)."""
    upper = text[:3000].upper()
    if 'SABESP' in upper:
        return ('fatura', 'SABESP')
    if 'COMGAS' in upper or 'COMGÁS' in upper or 'COMPANHIA DE GÁS' in upper:
        return ('fatura', 'COMGAS')
    if 'ENEL' in upper or 'ELETROPAULO' in upper:
        return ('fatura', 'ENEL')
    if 'PROSPER' in upper:
        return ('relatorio', 'Prosper')
    if 'HIDROGEOTEC' in upper:
        return ('relatorio', 'Hidrogeotec')
    return (None, None)


# ===== Extractors =====
class SabespExtractor:
    """
    Layout SABESP (ver exemplos em /Downloads):
    - "Cliente: EDIFICIO MODERN LIFE BACELAR"
    - "DATA EMISSAO: 14/05/2026"
    - "VENCIMENTO: 25/05/2026"
    - "TOTAL: R$ 11.108,90"
    - "Leitura Atual: 14/05/26 - 87660"
    - "Proxima Leitura: 13/06/2026"
    """
    @staticmethod
    def extract(text: str) -> dict:
        return {
            'cliente': find_first(text, [
                r'Cliente:\s*([A-Z][A-Z0-9\s\.\-]+?)(?:\s*CPF|\n)',
            ]),
            'vencimento': parse_date_br(find_first(text, [
                r'VENCIMENTO[:\s\*]+(\d{1,2}/\d{1,2}/\d{2,4})',
            ])),
            'valor': parse_brl(find_first(text, [
                r'TOTAL[:\s\*]+R\$\s*\*+([\d\.\,]+)',  # R$ ***********11.108,90
                r'TOTAL[:\s]+R\$\s*([\d\.\,]+)',
            ])),
            'leitura_atual': parse_date_br(find_first(text, [
                r'Leitura\s+Atual[:\s]+(\d{1,2}/\d{1,2}/\d{2,4})',
            ])),
            'proxima_leitura': parse_date_br(find_first(text, [
                r'Pr[óo]xima\s+Leitura[:\s]+(\d{1,2}/\d{1,2}/\d{2,4})',
            ])),
        }


class ComgasExtractor:
    """
    Layout COMGAS — usa DD.MM.YYYY (com pontos):
    - "COND EDIF ANDREA" (no topo direito)
    - "Vencimento: 11.05.2026"
    - "Valor a pagar (R$): 15,01"
    - "Data da leitura atual: 28.04.2026"
    - "Data da próxima leitura: 28.05.2026"
    """
    @staticmethod
    def extract(text: str) -> dict:
        return {
            'cliente': find_first(text, [
                r'(COND[\s\.]+[A-Z][A-Z\s]+?)\s*\n',
                r'(EDIF[ÍI]CIO\s+[A-Z][A-Z\s]+?)\s*\n',
            ]),
            'vencimento': parse_date_br(find_first(text, [
                r'Vencimento[:\s]+(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{2,4})',
            ])),
            'valor': parse_brl(find_first(text, [
                r'Valor\s+a\s+pagar[\s\(R\$\)]+([\d\.\,]+)',
                r'Total[:\s]+R\$\s*([\d\.\,]+)',
            ])),
            'leitura_atual': parse_date_br(find_first(text, [
                r'Data\s+(?:da\s+)?leitura\s+atual[:\s]+(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{2,4})',
            ])),
            'proxima_leitura': parse_date_br(find_first(text, [
                r'Data\s+da\s+pr[óo]xima\s+leitura[:\s]+(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{2,4})',
            ])),
        }


class EnelExtractor:
    """
    Layout ENEL:
    - "CONJUNTO RESIDENCIAL PARQUE DOS PASSAROS"
    - "MES/ANO: 05/2026"
    - "VENCIMENTO: 20/05/2026"
    - "TOTAL A PAGAR: R$ 101,46"
    - "LEITURA ATUAL: 09/05/2026"
    - "PROXIMA LEITURA: 08/06/2026"
    """
    @staticmethod
    def extract(text: str) -> dict:
        return {
            'cliente': find_first(text, [
                r'(CONJUNTO\s+RESIDENCIAL\s+[A-Z\s]+?)\s*\n',
                r'(EDIF[ÍI]CIO\s+[A-Z\s]+?)\s*\n',
                r'(COND[\s\.]+[A-Z\s]+?)\s*\n',
            ]),
            'vencimento': parse_date_br(find_first(text, [
                r'VENCIMENTO[:\s]+(\d{1,2}/\d{1,2}/\d{2,4})',
            ])),
            'valor': parse_brl(find_first(text, [
                r'TOTAL\s+A\s+PAGAR[:\s\*R\$]+([\d\.\,]+)',
                r'R\$\s*([\d\.\,]+)\s*\n.*?VENCIMENTO',
            ])),
            'leitura_atual': parse_date_br(find_first(text, [
                r'LEITURA\s+ATUAL[:\s]+(\d{1,2}/\d{1,2}/\d{2,4})',
            ])),
            'proxima_leitura': parse_date_br(find_first(text, [
                r'PR[OÓ]XIMA\s+LEITURA[:\s]+(\d{1,2}/\d{1,2}/\d{2,4})',
            ])),
        }


class ProsperExtractor:
    """
    Layout Prosper (relatório de leitura individualizada):
    - "Condominio Rossini"
    - "Mes de Referencia: MAIO Ano: 2026"
    - "Data Leitura: 15/05/2026"
    - "Numero de Unidades: 52"
    - "Valor Prosper: R$ 13.900,49"
    - "M3 Prosper: 1188,70"
    Tipo de servico: detectado pelo titulo (ÁGUA ou GÁS)
    """
    @staticmethod
    def extract(text: str) -> dict:
        upper_text = text.upper()
        tipo_servico = 'gas' if 'GÁS' in upper_text or 'GAS' in upper_text else 'agua'

        return {
            'cliente': find_first(text, [
                r'Condom[íi]nio\s+([A-Z][A-Za-z\s]+?)\s*\n',
            ]),
            'tipo_servico': tipo_servico,
            'data_leitura': parse_date_br(find_first(text, [
                r'Data\s+Leitura[:\s\n]+(\d{1,2}/\d{1,2}/\d{4})',
            ])),
            'numero_unidades': int(find_first(text, [
                r'N[úu]mero\s+de\s+Unidades[:\s]+(\d+)',
            ]) or 0) or None,
            'valor_total': parse_brl(find_first(text, [
                r'Valor\s+Prosper\s+R\$\s*([\d\.\,]+)',
            ])),
            'consumo_total': parse_brl(find_first(text, [
                r'M[³3]\s+Prosper[:\s\n]+([\d\.\,]+)',
            ])),
        }


class HidrogeotecExtractor:
    """
    Layout Hidrogeotec - PRECISA DE SAMPLE PRA AJUSTAR!
    Por enquanto usa heurística similar a Prosper.
    """
    @staticmethod
    def extract(text: str) -> dict:
        upper_text = text.upper()
        tipo_servico = 'gas' if 'GÁS' in upper_text or 'GAS' in upper_text else 'agua'
        # TODO: ajustar quando receber sample real
        return {
            'tipo_servico': tipo_servico,
            'data_leitura': parse_date_br(find_first(text, [
                r'Data\s+(?:da\s+)?Leitura[:\s]+(\d{1,2}/\d{1,2}/\d{4})',
            ])),
            'numero_unidades': None,
            'valor_total': parse_brl(find_first(text, [
                r'Total[:\s]+R\$\s*([\d\.\,]+)',
                r'Valor[:\s]+R\$\s*([\d\.\,]+)',
            ])),
            'consumo_total': None,
        }


# ===== Main entry =====
EXTRACTORS = {
    'SABESP': SabespExtractor,
    'COMGAS': ComgasExtractor,
    'ENEL': EnelExtractor,
    'Prosper': ProsperExtractor,
    'Hidrogeotec': HidrogeotecExtractor,
}


def extract_pdf(file_bytes: bytes) -> dict:
    """
    Ponto de entrada. Aceita bytes do PDF, retorna dict com:
      tipo: 'fatura' | 'relatorio' | None
      subtipo: 'SABESP' | ... | None
      cliente, vencimento, valor, ... (campos extraídos, None se não achou)
      confianca: 0.0 a 1.0
      erro: str ou None
      texto_bruto: str (debug, primeiros 5000 chars)
    """
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            text = ''
            for page in pdf.pages:
                page_text = page.extract_text() or ''
                text += page_text + '\n'
    except Exception as e:
        return {'erro': f'Falha ao ler PDF: {e}', 'confianca': 0.0}

    if not text.strip():
        return {
            'erro': 'PDF sem texto extraível (possivelmente escaneado/imagem). Preencha manualmente.',
            'confianca': 0.0,
            'texto_bruto': '',
        }

    tipo, subtipo = detect_tipo(text)
    if not tipo:
        return {
            'erro': 'Não foi possível identificar a empresa do documento.',
            'confianca': 0.0,
            'texto_bruto': text[:5000],
        }

    ExtractorCls = EXTRACTORS.get(subtipo)
    if not ExtractorCls:
        return {
            'erro': f'Extrator não implementado para {subtipo}',
            'tipo': tipo,
            'subtipo': subtipo,
            'confianca': 0.0,
            'texto_bruto': text[:5000],
        }

    data = ExtractorCls.extract(text)

    # Calcula confianca: % de campos não-None entre os esperados
    expected_fields = list(data.keys())
    filled = sum(1 for k in expected_fields if data.get(k) is not None)
    confianca = filled / len(expected_fields) if expected_fields else 0.0

    return {
        'tipo': tipo,
        'subtipo': subtipo,
        'confianca': round(confianca, 2),
        'erro': None,
        'texto_bruto': text[:5000],
        **data,
    }
```

---

## 🔧 Backend — Novo endpoint em `api/api_routes.py`

Adicionar APÓS o endpoint `/api/consumos/sancionar-repeticao`:

```python
from fastapi import UploadFile, File

@router.post("/consumos/extrair-pdf")
async def api_extrair_pdf(
    file: UploadFile = File(...),
    condominio_id: Optional[str] = None,
    mes_referencia: Optional[int] = None,
    ano_referencia: Optional[int] = None,
    user: dict = Depends(get_current_user),
    db: Client = Depends(get_db),
):
    """
    Extrai dados de um PDF de fatura ou relatório.
    Se condominio_id+mes+ano forem passados, também roda check de duplicata.
    Retorna: { extracao: {...}, alertas: [...], bloqueia: bool }
    """
    from pdf_extractor import extract_pdf
    import hashlib

    contents = await file.read()
    arquivo_hash = hashlib.sha256(contents).hexdigest()

    extracao = extract_pdf(contents)
    extracao['arquivo_hash'] = arquivo_hash
    extracao['arquivo_nome'] = file.filename

    alertas = []
    bloqueia = False

    # Se conseguiu identificar e tem contexto, valida duplicata
    if extracao.get('subtipo') and condominio_id and mes_referencia and ano_referencia:
        from datetime import datetime
        check_body = CheckDuplicataCompletaFatura(
            tipo='relatorio' if extracao['tipo'] == 'relatorio' else 'fatura',
            condominio_id=condominio_id,
            mes_referencia=mes_referencia,
            ano_referencia=ano_referencia,
            arquivo_hash=arquivo_hash,
        )
        if extracao['tipo'] == 'fatura':
            check_body.concessionaria = extracao['subtipo'].upper()
            check_body.leitura_atual = extracao.get('leitura_atual')
            check_body.proxima_leitura = extracao.get('proxima_leitura')
            check_body.vencimento = extracao.get('vencimento')
            check_body.valor = extracao.get('valor')
        else:
            check_body.empresa = extracao['subtipo'].upper()
            check_body.tipo_servico = extracao.get('tipo_servico', 'agua')
            check_body.consumo_total = extracao.get('consumo_total')
            check_body.valor_total = extracao.get('valor_total')
            check_body.numero_unidades = extracao.get('numero_unidades')

        result = api_check_duplicata_completa(check_body, user, db)
        alertas = result.get('alertas', [])
        bloqueia = result.get('bloqueia', False)

    return {
        'extracao': extracao,
        'alertas': alertas,
        'bloqueia': bloqueia,
    }
```

---

## 🎨 Frontend — `VisaoEmissor.js` (modificar)

### O que muda na UI

**Remover:**
- O modal `showRelatorioPicker` (form manual de 7 campos) ← linhas ~1410-1500
- O modal `showConcessionariaPicker` (escolha de SABESP/COMGAS/ENEL) ← já existente

**Adicionar/Mudar:**
- Os 2 botões (Concessionária e Relatório) abrem **file picker direto**
- Função nova `handleUploadComExtracao(file, categoria)` que:
  1. Mostra loading "Lendo PDF..."
  2. POST multipart pro `/api/consumos/extrair-pdf` com condo_id/mes/ano
  3. Se `bloqueia: true`: abre modal de duplicata (já existe)
  4. Se `confianca >= 0.8`: chama `handleUploadArquivo` com metadata pronta
  5. Se `confianca < 0.8`: abre modal de revisão pré-preenchido (NOVO componente)

### Pseudocódigo da função nova

```javascript
async function handleUploadComExtracao(fileInput, categoria) {
  setIsUploading(true);
  try {
    // 1. Envia PDF pro backend extrair
    const formData = new FormData();
    formData.append('file', fileInput);
    const params = new URLSearchParams({
      condominio_id: activePacote.condominio_id,
      mes_referencia: mes,
      ano_referencia: ano,
    });
    const res = await fetch(`/api/consumos/extrair-pdf?${params}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${await getToken()}` },
      body: formData,
    });
    const { extracao, alertas, bloqueia } = await res.json();

    // 2. Se duplicata bloqueia: abre modal de sancionamento (já existe)
    if (bloqueia) {
      setDuplicataInfo({
        alertas,
        pendingFile: fileInput,
        pendingMeta: { categoria, extracao },
      });
      return;
    }

    // 3. Se baixa confiança: form de revisão
    if ((extracao.confianca || 0) < 0.8 || !extracao.subtipo) {
      setRevisaoInfo({ extracao, pendingFile: fileInput, categoria });
      return;
    }

    // 4. Confiança alta + sem bloqueio: salva direto
    const subtipo = extracao.subtipo;
    const extras = mapExtracaoToExtras(extracao);  // helper
    await handleUploadArquivo(fileInput, {
      categoria,
      subtipo,
      extras,
      skipDuplicataCheck: true,  // já checou
    });
    addToast(`✓ ${subtipo} - R$ ${formatBRL(extracao.valor || extracao.valor_total)} anexada`, 'success');
  } catch (e) {
    addToast('Erro: ' + e.message, 'error');
  } finally {
    setIsUploading(false);
  }
}

function mapExtracaoToExtras(extracao) {
  if (extracao.tipo === 'fatura') {
    return {
      nome_condominio_fatura: extracao.cliente,
      vencimento_fatura: extracao.vencimento,
      valor_fatura: extracao.valor,
      // leitura_atual e proxima_leitura ficam em consumos_faturas via trigger
    };
  } else {
    return {
      relatorio_empresa: extracao.subtipo,
      relatorio_tipo_servico: extracao.tipo_servico,
      relatorio_data_leitura: extracao.data_leitura,
      relatorio_unidades: extracao.numero_unidades,
      relatorio_consumo_total: extracao.consumo_total,
      relatorio_valor_total: extracao.valor_total,
    };
  }
}
```

### Novo modal de revisão (quando confiança < 80%)

Form pré-preenchido com:
- Campos que conseguiu extrair (greyish, pode editar)
- Campos vazios destacados (precisa preencher)
- Botão "Salvar"
- Mostra confiança da extração

---

## 🎨 Frontend — Repaginar `/consumos` (arquivo `app/consumos/page.js`)

### Visualização nova

```
┌─ 4 CARDS DE STATS ────────────────────────────────────────────┐
│ 📊 Processadas  │ ⚠ Anomalias │ 🔴 Duplicatas │ 📥 Pendentes │
│     245         │      8      │      3        │      62      │
│   R$ 142k       │ Δ +60% médio│  sancionadas  │  sem upload  │
└───────────────────────────────────────────────────────────────┘

🚨 BANNER DE ATENÇÃO (só aparece se há problemas)
┌────────────────────────────────────────────────────────────┐
│ 🔴 066 Lucrecia · SABESP Jun → mesmo valor de Maio        │
│ 🟡 094 Giovanni · COMGAS Jun → Δ +112% vs Maio            │
│ ...                                            [Ver todos] │
└────────────────────────────────────────────────────────────┘

📋 ÚLTIMAS 10 ANEXAÇÕES (feed)
┌────────────────────────────────────────────────────────────┐
│ ✓ SABESP  · 066 Lucrecia · R$ 11.108,90 · Jun · 5min ago  │
│ ✓ Prosper · 374 Rossini  · R$ 13.900,49 · Mai · 1h ago    │
│ ...                                                        │
└────────────────────────────────────────────────────────────┘

🔍 EXPLORAR POR CONDOMÍNIO
┌────────┬───────────────────────────────────────────────────┐
│ Lista  │ 094 - COND. ED. GIOVANNI PASCOLI                  │
│        │ Gerente: Marlei · Vencimento dia 1                │
│        │                                                   │
│        │ SABESP - 2026                                     │
│ Lucr.  │ J  F  M  A  M  J  J  A  S  O  N  D                │
│ Gio.←  │ ✓  ✓  ✓  ✓  ✓  ✓  -  -  -  -  -  -                │
│ Ville  │                                                   │
│ ...    │ COMGAS - 2026                                     │
│        │ -  ✓  ✓  -  ✓  ⚠Δ  -  -  -  -  -  -               │
│        │                                                   │
│        │ Click no mês → painel lateral com:                │
│        │  · valor, vencimento, leituras                    │
│        │  · variação vs mês anterior                       │
│        │  · botão "Abrir PDF"                              │
└────────┴───────────────────────────────────────────────────┘
```

### Implementação

**SWR config recomendada:**
```javascript
const { data, mutate } = useSWR('/api/consumos?ano=' + anoSel, apiFetcher, {
  refreshInterval: 30000,        // 30s polling
  revalidateOnFocus: true,        // atualiza ao voltar pra aba
  dedupingInterval: 5000,
});
```

**Não usar Supabase Realtime** — SWR é suficiente e mais barato.

**Componentes a criar:**
- `<StatsCardsHeader />` — 4 cards no topo
- `<AlertasBanner />` — só renderiza se houver alertas
- `<FeedAnexacoes />` — últimas 10 (limit + order by anexada_em desc)
- `<ExploradorCondos />` — sidebar + painel detalhado

---

## ⚠️ Para um novo Claude pegar este plano

### Como começar:

1. **Leia este arquivo inteiro**
2. **Leia `CLAUDE.md`** na raiz pra entender o projeto
3. **Confira estado das migrations**: `supabase/migrations/applied.txt`
4. **Verifique se 0040 já rodou** rodando no SQL Editor:
   ```sql
   SELECT COUNT(*) FROM public.consumos_relatorios_leitura;
   ```
   Se a query rodar (mesmo retornando 0), a migration 0040 está aplicada.
5. **Pergunte ao usuário** se ele já tem sample do Hidrogeotec
6. **Comece pela Fase 1** (migration 0041), siga a ordem

### Arquivos importantes pra editar:

| Arquivo | Mudança |
|---|---|
| `api/requirements.txt` | adicionar `pdfplumber` |
| `api/pdf_extractor.py` | criar (código completo neste plano) |
| `api/api_routes.py` | adicionar endpoint `extrair-pdf` |
| `frontend/src/app/central-emissoes/components/VisaoEmissor.js` | refatorar upload (remover modais, adicionar extração) |
| `frontend/src/app/consumos/page.js` | repaginar completo |
| `supabase/migrations/0041_status_extracao.sql` | criar |

### Comandos pra deploy (em ordem):

```bash
cd C:\projetos\condominios
# build
cd frontend && npm run build 2>&1 | tail -3
# se OK: voltar pra raiz
cd ..
# commit + push
git add -A
git commit -m "feat(consumos): extração automática de PDFs"
git push origin main
# deploy (PRECISA ser da raiz pra incluir api/)
npx vercel --prod --yes
```

### Avisos importantes:

- ⚠️ Deploy do Vercel **PRECISA** ser feito de `C:\projetos\condominios` (não do worktree, não da pasta `frontend/`), porque o `vercel.json` está na raiz e inclui a API Python.
- ⚠️ `.vercelignore` está configurado pra excluir só `node_modules`, `.next`, `.git`, `.claude`, docs e `/supabase/` (com barra inicial — sem barra exclui `frontend/src/utils/supabase/`).
- ⚠️ Se `npx vercel --prod` falhar com `BUILD_ERROR`, verificar logs com `npx vercel inspect <url> --logs`.

---

## 🤝 Decisões já tomadas (não precisa reperguntar ao usuário)

| Decisão | Escolha |
|---|---|
| Onde extrai? | Backend FastAPI com pdfplumber |
| LLM Vision? | NÃO (usuário sem créditos Anthropic) |
| Quando extração falhar? | Form de revisão pré-preenchido (não bloqueia upload) |
| Realtime ou polling? | SWR com 30s |
| Sample Hidrogeotec? | Usuário vai mandar — usar fallback genérico até lá |
| Cobertura do extrator? | Faturas (SABESP/COMGAS/ENEL) + relatórios (Prosper/Hidrogeotec) |
| Detecção de empresa? | Automática via texto do PDF |
| Sancionamento de duplicata? | Já implementado (master/departamento com motivo obrigatório) |

---

## 📞 Contato

Se o novo Claude precisar de mais contexto, manda o usuário compartilhar:
- Print dos PDFs que estão dando problema na extração
- Erro completo do toast
- F12 → Network → response da chamada que falhou
