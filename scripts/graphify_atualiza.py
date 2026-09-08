# -*- coding: utf-8 -*-
"""Reconstroi o grafo do projeto e o vault do Obsidian, a cada commit.

POR QUE ESTE ARQUIVO EXISTE
---------------------------
O `graphify hook install` ja instala um post-commit que reconstroi o grafo --
mas ele NAO regenera o vault do Obsidian. Conferido na versao instalada: a
funcao `_rebuild_code` chama `to_json`, `to_html` e o relatorio, e nunca
`to_obsidian`. Ou seja: com o gancho de fabrica, o grafo ficaria em dia e o
vault continuaria parado, que e exatamente o problema que se queria resolver.

Entao o gancho e este script, e nao o de fabrica: ele chama a MESMA funcao da
biblioteca (`_rebuild_code`) e acrescenta o passo do vault.

CUSTO: zero. E so AST em cima dos arquivos que mudaram, sem LLM. Mudanca em
`.md` continua exigindo `/graphify --update` na mao -- essa sim usa modelo.

NUNCA DERRUBA O COMMIT. Roda destacado, depois do commit ja feito, e qualquer
falha vai para o log em vez de aparecer no terminal. Um mapa desatualizado e um
inconveniente; um commit que falha por causa do mapa e um problema.
"""
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "graphify-out"


def main() -> int:
    try:
        from graphify.watch import _rebuild_code
    except Exception as e:
        print(f"[graphify] biblioteca indisponivel ({type(e).__name__}); nada a fazer")
        return 0

    try:
        _rebuild_code(RAIZ)
    except Exception as e:
        print(f"[graphify] reconstrucao do grafo falhou: {type(e).__name__}: {e}")
        return 0            # nao propaga: o commit ja aconteceu

    # ── o passo que o gancho de fabrica nao tem ──────────────────────
    grafo = SAIDA / "graph.json"
    if not grafo.exists():
        print("[graphify] sem graph.json; vault nao regenerado")
        return 0
    try:
        import json
        import networkx as nx
        from networkx.readwrite import json_graph
        from graphify.export import to_obsidian, to_canvas

        dados = json.loads(grafo.read_text(encoding="utf-8"))
        G = json_graph.node_link_graph(dados, edges="links")

        # As comunidades vem gravadas em cada no; o vault as quer agrupadas.
        comunidades: dict = {}
        for n, d in G.nodes(data=True):
            c = d.get("community")
            if c is None:
                continue
            comunidades.setdefault(int(c), []).append(n)

        destino = SAIDA / "obsidian"
        n = to_obsidian(G, comunidades, str(destino))
        try:
            to_canvas(G, comunidades, str(destino / "graph.canvas"))
        except Exception:
            pass            # o canvas e extra; sem ele o vault ainda serve
        print(f"[graphify] vault regenerado: {n} notas em {destino}")
    except Exception as e:
        print(f"[graphify] vault nao regenerado ({type(e).__name__}: {e}); o grafo esta em dia")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# ─────────────────────────────────────────────────────────────────────────────
# COMO LIGAR ISTO NUMA MAQUINA NOVA
#
# `.git/hooks/` nao e versionado, entao o gancho nao vem no clone. Para ligar:
#
#     cp scripts/post-commit .git/hooks/post-commit && chmod +x .git/hooks/post-commit
#
# Para desligar:  rm .git/hooks/post-commit
#
# Nota: com mais de 5.000 nos o graphify pula o `graph.html` (limite dele). O
# vault e o `GRAPH_REPORT.md` continuam sendo gerados, que e o que se usa.
# Para forcar o HTML: GRAPHIFY_VIZ_NODE_LIMIT=10000.
# ─────────────────────────────────────────────────────────────────────────────
