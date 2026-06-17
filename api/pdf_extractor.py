"""
Extrator de PDFs de concessionárias e empresas de leitura.
Roteamento baseado em detecção do nome da empresa nos primeiros chars.

Entry point: extract_pdf(file_bytes) -> dict
"""
import io
import re
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


def parse_int(s) -> Optional[int]:
    """'52' / '52 unidades' -> 52"""
    if s is None:
        return None
    digits = re.sub(r'[^0-9]', '', str(s))
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def detect_tipo_servico(text: str) -> str:
    """Detecta 'agua' ou 'gas' no relatório. Prioriza o título 'Consumo (Água/Gás)',
    porque o corpo dos relatórios de água cita 'Água e Gás' e 'Tarifa Sabesp'."""
    up = text.upper()
    m = re.search(r'CONSUMO\s*\(\s*(ÁGUA|AGUA|GÁS|GAS)\s*\)', up)
    if m:
        return 'gas' if m.group(1).startswith('G') else 'agua'
    if '(ÁGUA)' in up or '(AGUA)' in up:
        return 'agua'
    if '(GÁS)' in up or '(GAS)' in up:
        return 'gas'
    # último recurso: contagem de ocorrências
    n_gas = up.count('GÁS') + up.count(' GAS')
    n_agua = up.count('ÁGUA') + up.count('AGUA')
    return 'gas' if n_gas > n_agua else 'agua'


def parse_relatorio_units(tables: list) -> list:
    """
    Extrai a tabela de leitura unidade-a-unidade dos relatórios (Prosper/etc).
    Layout Prosper (água): colunas APTO | LEIT.ANT. | LEIT.ATUAL | M³ | M³ Total | ÁGUA | ESGOTO | TOTAL,
    onde cada apartamento ocupa N linhas (1 por hidrômetro); a 1ª linha carrega
    APTO + M³ Total + valores, e as linhas seguintes só as leituras dos outros medidores.
    Tabelas de continuação (próximas páginas) vêm sem cabeçalho.

    Retorna lista de:
      { apto, m3_total, valor_agua?, valor_esgoto?, valor_total,
        medidores: [{ ant, atual, consumo }, ...] }
    Defensivo: tolera larguras diferentes (gás pode ter menos colunas).
    """
    units = []
    cur = None
    for t in tables:
        if not t:
            continue
        width = max((len(r) for r in t), default=0)
        if width < 5:
            continue  # tabela pequena (cabeçalho/totais), não é a de unidades
        # só processa se parece a tabela de unidades (alguma 1ª célula = nº de apto)
        if not any((r and (r[0] or '').strip().isdigit()) for r in t):
            continue
        for row in t:
            row = list(row) + [None] * (width - len(row))
            c0 = (row[0] or '').strip()
            if c0.upper() == 'APTO':
                continue
            if c0.isdigit():
                cur = {
                    'apto': c0,
                    'm3_total': parse_brl(row[4]) if width > 4 else None,
                    'valor_total': parse_brl(row[width - 1]),
                    'medidores': [{'ant': parse_brl(row[1]), 'atual': parse_brl(row[2]), 'consumo': parse_brl(row[3])}],
                }
                if width >= 8:
                    cur['valor_agua'] = parse_brl(row[5])
                    cur['valor_esgoto'] = parse_brl(row[6])
                units.append(cur)
            elif cur and (row[1] or row[2] or row[3]):
                cur['medidores'].append({'ant': parse_brl(row[1]), 'atual': parse_brl(row[2]), 'consumo': parse_brl(row[3])})
    return units


# ===== Detector =====
def detect_tipo(text: str):
    """Detecta tipo (fatura/relatorio) e subtipo (SABESP/COMGAS/ENEL/Prosper).

    IMPORTANTE: empresas de relatório (Prosper) têm prioridade sobre as
    concessionárias, porque os relatórios de água citam "Tarifa Sabesp"/"Valor Sabesp"
    no corpo e seriam classificados erradamente como fatura SABESP.
    """
    upper = text[:3000].upper()
    # 1) Relatórios de leitura primeiro (prioridade)
    if 'PROSPER' in upper:
        return ('relatorio', 'Prosper')
    # 2) Concessionárias
    if 'SABESP' in upper:
        return ('fatura', 'SABESP')
    if 'COMGAS' in upper or 'COMGÁS' in upper or 'COMPANHIA DE GÁS' in upper or 'COMPANHIA DE GAS' in upper:
        return ('fatura', 'COMGAS')
    if 'ENEL' in upper or 'ELETROPAULO' in upper:
        return ('fatura', 'ENEL')
    return (None, None)


# ===== Extractors =====
class SabespExtractor:
    """
    Layout SABESP:
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
                r'Valor\s+a\s+pagar[\s\(\):R\$]+([\d\.\,]+)',
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
        tipo_servico = detect_tipo_servico(text)

        return {
            'cliente': find_first(text, [
                r'Condom[íi]nio\s+([A-Z][A-Za-z\s]+?)\s*\n',
            ]),
            'tipo_servico': tipo_servico,
            'data_leitura': parse_date_br(find_first(text, [
                r'Data\s+Leitura[:\s\n]+(\d{1,2}/\d{1,2}/\d{4})',
            ])),
            'numero_unidades': parse_int(find_first(text, [
                r'N[úu]mero\s+de\s+Unidades[:\s]+(\d+)',
            ])),
            'valor_total': parse_brl(find_first(text, [
                r'Valor\s+Prosper[:\s]*R?\$?\s*([\d\.\,]+)',
            ])),
            'consumo_total': parse_brl(find_first(text, [
                r'M[³3]\s+Prosper[:\s\n]+([\d\.\,]+)',
            ])),
        }


# ===== Main entry =====
EXTRACTORS = {
    'SABESP': SabespExtractor,
    'COMGAS': ComgasExtractor,
    'ENEL': EnelExtractor,
    'Prosper': ProsperExtractor,
}


def unlock_pdf_bytes(file_bytes: bytes, passwords: Optional[list] = None):
    """
    Se o PDF estiver protegido por senha, tenta destravar com as senhas-candidatas.
    Retorna (bytes_utilizaveis, status):
      - ('aberto')        : não estava protegido, devolve os bytes originais
      - ('desbloqueado')  : estava protegido e foi destravado com uma das senhas
      - ('protegido')     : protegido e nenhuma senha funcionou (bytes_utilizaveis=None)
    """
    import pikepdf  # type: ignore  # lazy
    # 1) Tenta abrir sem senha — se abrir, não está protegido
    try:
        with pikepdf.open(io.BytesIO(file_bytes)):
            return file_bytes, 'aberto'
    except pikepdf.PasswordError:
        pass
    except Exception:
        # arquivo problemático mas não necessariamente protegido; deixa o pdfplumber tentar
        return file_bytes, 'aberto'
    # 2) Protegido: tenta cada senha-candidata
    for pw in (passwords or []):
        if not pw:
            continue
        try:
            with pikepdf.open(io.BytesIO(file_bytes), password=str(pw)) as pdf:
                out = io.BytesIO()
                pdf.save(out)
                return out.getvalue(), 'desbloqueado'
        except pikepdf.PasswordError:
            continue
        except Exception:
            continue
    return None, 'protegido'


def cnpj_to_passwords(cnpj: Optional[str]) -> list:
    """Deriva senhas-candidatas a partir do CNPJ (apenas dígitos).
    Convenção das concessionárias BR: primeiros 3 (SABESP/COMGAS), 4 (Vivo) ou 5 dígitos.
    Tenta todas pra não depender de detectar a concessionária antes de abrir o PDF."""
    if not cnpj:
        return []
    d = re.sub(r'\D', '', str(cnpj))
    if not d:
        return []
    cands = [d[:3], d[:4], d[:5], d[:6], d[:8], d]
    seen, out = set(), []
    for c in cands:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


_MES_MAP = {
    'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06',
    'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12',
    'JANEIRO': '01', 'FEVEREIRO': '02', 'MARCO': '03', 'MARÇO': '03', 'ABRIL': '04',
    'MAIO': '05', 'JUNHO': '06', 'JULHO': '07', 'AGOSTO': '08', 'SETEMBRO': '09',
    'OUTUBRO': '10', 'NOVEMBRO': '11', 'DEZEMBRO': '12',
}


def _iso_date(raw: str) -> Optional[str]:
    """'12/05/2026' / '12.05.2026' -> '2026-05-12' (valida ano 2000-2100)."""
    parts = re.split(r"[/.\-]", str(raw))
    if len(parts) != 3:
        return None
    d, m, y = parts
    try:
        if 2000 <= int(y) <= 2100:
            return f"{int(y):04d}-{m.zfill(2)}-{d.zfill(2)}"
    except ValueError:
        pass
    return None


def parse_fatura_fallback(text: str) -> dict:
    """
    Regex tolerante (porte do _parse_fields do processador de e-mails): extrai
    valor / vencimento / referência de forma robusta. Usado SÓ para preencher
    campos que o extractor por concessionária não conseguiu (layout fora do padrão
    ou texto ruidoso de OCR). Nunca sobrescreve um valor já extraído.
    """
    out = {'valor': None, 'vencimento': None, 'referencia': None}
    if not text:
        return out

    # ── Valor ──
    for p in [
        r"(?:TOTAL\s+A\s+PAGAR|VALOR\s+TOTAL|VALOR\s+A\s+PAGAR|TOTAL\s+DA\s+FATURA)[:\s]*R?\$?\s*([\d.,]+)",
        r"R\$\s*([\d.]{1,12},\d{2})",
    ]:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            v = parse_brl(m.group(1))
            if v is not None and v > 1.0:  # filtra ruído (ex.: ano "2026")
                out['valor'] = v
                break

    # ── Vencimento ──
    for p in [
        r"VENCIMENTO[:\s]*(\d{2}[/.\-]\d{2}[/.\-]\d{4})",
        r"PAGAR\s+AT[EÉ][:\s]*(\d{2}[/.\-]\d{2}[/.\-]\d{4})",
        r"(\d{2}[/.\-]\d{2}[/.\-]\d{4})",  # último recurso
    ]:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            iso = _iso_date(m.group(1))
            if iso:
                out['vencimento'] = iso
                break

    # ── Referência (mês/ano) ──
    mes_names = '|'.join(_MES_MAP.keys())
    rm = re.search(rf"({mes_names})[\s/\-]+(\d{{4}})", text, re.IGNORECASE)
    if rm:
        out['referencia'] = f"{rm.group(1).capitalize()}/{rm.group(2)}"
    else:
        nm = re.search(r"\b(\d{2})/(\d{4})\b", text)
        if nm:
            out['referencia'] = f"{nm.group(1)}/{nm.group(2)}"

    return out


def extract_pdf(file_bytes: bytes, passwords: Optional[list] = None) -> dict:
    """
    Ponto de entrada. Aceita bytes do PDF, retorna dict com:
      tipo: 'fatura' | 'relatorio' | None
      subtipo: 'SABESP' | ... | None
      cliente, vencimento, valor, ... (campos extraídos, None se não achou)
      confianca: 0.0 a 1.0
      erro: str ou None
      desbloqueado: bool (True se o PDF veio com senha e foi destravado)
      texto_bruto: str (debug, primeiros 5000 chars)

    `passwords`: lista de senhas-candidatas para PDFs protegidos (ex.: derivadas do CNPJ).
    """
    import pdfplumber  # type: ignore  # lazy: evita custo de import no cold-start

    # 0) Desbloqueio de PDF protegido por senha
    usable, lock_status = unlock_pdf_bytes(file_bytes, passwords)
    if lock_status == 'protegido':
        return {
            'erro': 'PDF protegido por senha e não foi possível destravar (CNPJ do condomínio ausente ou senha fora do padrão).',
            'confianca': 0.0,
            'protegido': True,
            'texto_bruto': '',
        }
    file_bytes = usable
    desbloqueado = (lock_status == 'desbloqueado')

    text = ''
    all_tables = []
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                text += (page.extract_text() or '') + '\n'
            # Pré-detecção: só vale extrair tabelas se for relatório (faturas não precisam)
            pre_tipo, _ = detect_tipo(text)
            if pre_tipo == 'relatorio':
                for page in pdf.pages:
                    all_tables.extend(page.extract_tables() or [])
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

    # Fallback tolerante: preenche valor/vencimento/referência que o extractor
    # específico não pegou (nunca sobrescreve um campo já extraído).
    if tipo == 'fatura':
        fb = parse_fatura_fallback(text)
        if data.get('valor') is None and fb.get('valor') is not None:
            data['valor'] = fb['valor']
        if data.get('vencimento') is None and fb.get('vencimento') is not None:
            data['vencimento'] = fb['vencimento']
        if fb.get('referencia') and not data.get('referencia'):
            data['referencia'] = fb['referencia']

    # Confiança = % de campos escalares não-None entre os esperados
    expected_fields = list(data.keys())
    filled = sum(1 for k in expected_fields if data.get(k) is not None)
    confianca = filled / len(expected_fields) if expected_fields else 0.0

    # Relatórios: anexa a tabela de leitura por unidade (não entra na confiança)
    if tipo == 'relatorio' and all_tables:
        unidades = parse_relatorio_units(all_tables)
        if unidades:
            data['unidades'] = unidades
            data['unidades_count'] = len(unidades)
            # Cross-check / fallback do número de unidades
            if not data.get('numero_unidades'):
                data['numero_unidades'] = len(unidades)

    return {
        'tipo': tipo,
        'subtipo': subtipo,
        'confianca': round(confianca, 2),
        'erro': None,
        'desbloqueado': desbloqueado,
        'texto_bruto': text[:5000],
        **data,
    }
