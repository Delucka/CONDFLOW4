"""`maybe_single()` devolve resposta vazia, e não `None`.

O QUE ACONTECIA
---------------
No supabase-py, `.maybe_single().execute()` devolve **`None`** quando não há
linha — não uma resposta com `data` vazio. Então o padrão natural, que está em
36 lugares da nossa API,

    linha = db.table("x").select("*").eq(...).maybe_single().execute().data

estoura com `AttributeError: 'NoneType' object has no attribute 'data'` toda
vez que o registro simplesmente não existe. Não é caso raro: é o caso normal de
"primeiro mês", "ainda não cadastrado", "sem mês anterior".

Custou **83 quebras de 500** em produção entre 15/07 e 27/08/2026, quase todas
em `/api/consumos/check-duplicata-completa`, que procura a fatura do mês
anterior — e no primeiro mês de um condomínio não existe mês anterior.

POR QUE AQUI, E NÃO NOS 36 LUGARES
-----------------------------------
Já corrigimos esse mesmo tropeço à mão antes, e ele voltou. Corrigir 36 sítios
são 36 chances de errar e nenhuma garantia sobre o 37º, que alguém escreve mês
que vem sem saber desta história. O formato da resposta é a armadilha; então o
conserto é no formato.

Depois disto, `.data` é `None` quando não há linha — que é exatamente o que os
36 lugares já esperam encontrar (todos testam `if x:` / `x or {}`).

CONFERIDO ANTES DE APLICAR
--------------------------
Nenhum lugar da API compara o resultado de `maybe_single()` com `None` nem
depende de ele ser falsy (`if not res:`). Varredura feita em 07/09/2026 sobre
`api/*.py`. Se algum dia alguém escrever isso, este arquivo é o motivo de o
código não se comportar como o tipo `Optional[...]` da biblioteca promete.

SE A BIBLIOTECA MUDAR
---------------------
`aplicar()` nunca levanta. Se a classe ou o método sumirem numa versão nova, o
comportamento volta a ser o de origem — e o log diz isso. Por isso `supabase`
está com versão fixa no `requirements.txt`: sem fixar, uma reconstrução na
Vercel podia trocar a biblioteca por baixo deste arquivo sem ninguém notar.
"""


def aplicar():
    """Devolve True se o ajuste entrou; False se a biblioteca não é a esperada."""
    try:
        from postgrest._sync.request_builder import (
            SyncMaybeSingleRequestBuilder,
            SyncSingleRequestBuilder,
            SingleAPIResponse,
        )
        from postgrest.exceptions import APIError
    except Exception as e:
        print(f"[supabase] maybe_single nao ajustado ({type(e).__name__}); "
              f"cuidado: pode voltar None")
        return False

    if getattr(SyncMaybeSingleRequestBuilder.execute, "_sem_none", False):
        return True     # já aplicado (reimportação do módulo)

    original = SyncMaybeSingleRequestBuilder.execute
    vazia = lambda: SingleAPIResponse(data=None, count=None)

    def execute(self):
        try:
            r = SyncSingleRequestBuilder(self.request).execute()
        except APIError as e:
            if e.details and "The result contains 0 rows" in e.details:
                return vazia()          # não achou: é resposta vazia, não erro
            # QUALQUER outro erro sobe com a mensagem de verdade. O original
            # engolia todos e levantava um `APIError("Missing response",
            # code 204)` no lugar — então uma coluna que não existe, uma
            # policy que barrou ou o banco fora do ar chegavam à tela com a
            # mesma frase, que não diz nada. Foi assim que "column
            # profiles.ativo does not exist" virou "Missing response".
            raise
        return r if r is not None else vazia()

    execute._sem_none = True
    execute.__doc__ = (original.__doc__ or "") + \
        "\n\nAjustado por api/supabase_sem_none.py: sem linha devolve resposta " \
        "com data=None (nunca None), e erro real sobe com a mensagem original."
    SyncMaybeSingleRequestBuilder.execute = execute
    return True
