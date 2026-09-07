"""O log da API — `logging`, não `print`.

POR QUE ISTO EXISTE
-------------------
Conferido em 07/09/2026, em 1.000 entradas do log de produção do Vercel:
**nenhuma** mensagem nossa aparecia. Todas as 1.000 eram do httpx. O motivo é
simples e caro: o httpx usa `logging`, e nós usávamos `print`. O runtime Python
do Vercel não leva o `print` para o log da função.

Ou seja: uns cem pontos de diagnóstico espalhados pela API — quase todos do tipo
"isto falhou e eu segui sem" — falavam para o vazio. Um erro engolido de
propósito só é uma boa decisão se alguém puder ver que ele aconteceu; sem log,
vira erro engolido e ponto.

Os erros de verdade (as quebras) continuam indo para `audit_erros` pelo handler
global. O que se perdia eram os avisos: a consulta que falhou e o código
continuou, o cache que caiu para o plano B, o e-mail que não saiu.

COMO USAR
---------
    from log import log
    log.warning("[cache] condominios indisponivel: %s", type(e).__name__)

`warning` para o que degradou mas seguiu, `error` para o que quebrou, `info`
para o que aconteceu e vale registrar (uma importação, uma transferência de
carteira).
"""

import logging
import sys

log = logging.getLogger("condoflow")
log.setLevel(logging.INFO)

# O handler normalmente já existe: em produção quem configura a raiz é o
# runtime (é por isso que o httpx aparece), e no `uvicorn --reload` é o uvicorn.
# Só criamos um quando ninguém configurou nada — senão cada linha sairia duas
# vezes, que é o jeito clássico de tornar um log inútil.
if not logging.getLogger().handlers and not log.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    log.addHandler(_h)
