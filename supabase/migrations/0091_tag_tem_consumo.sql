-- ============================================================
-- 0091 -- Tag "tem consumo": 119 condominios
-- ============================================================
-- Quem emite precisa saber, ANTES de montar, se aquele condominio depende de
-- fatura e relatorio de concessionaria. Isso vivia na cabeca de quem faz.
--
-- Ja existe "condominios_concessionarias" (0036), mas ela responde OUTRA
-- pergunta: QUAL concessionaria. Veio de uma planilha de 2025, cobre 115
-- condominios e nao e a lista que a operacao usa hoje. Serve para /consumos;
-- nao serve como "tem ou nao tem".
--
-- Esta migration cria a resposta direta -- um booleano em "condominios" -- a
-- partir da relacao passada pela operacao em 05/08/2026. As duas convivem: o
-- booleano diz SE tem, a tabela diz QUAIS, quando se sabe.
--
-- O casamento e pelo prefixo numerico do nome, comparado como NUMERO: assim
-- "088" acha tanto "088 - ..." quanto "88 - ...".
--
-- SEM TABELA TEMPORARIA, de proposito. O SQL Editor do Supabase nao mantem
-- objeto criado entre statements da mesma execucao: a primeira versao usava
-- CREATE TEMP TABLE e morria em "relation _consumo_lista does not exist". A
-- lista vai inline, repetida nos dois lugares que precisam dela.
--
-- ATENCAO: esta lista e a VERDADE. Quem nao esta nela fica com tem_consumo =
-- false, inclusive quem tem linha em condominios_concessionarias. A conferencia
-- no fim mostra essa diferenca para revisao -- nao apaga nada.
--
-- Idempotente: rodar de novo da o mesmo resultado.
--
-- ROLLBACK:
--   ALTER TABLE public.condominios DROP COLUMN IF EXISTS tem_consumo;
-- ============================================================

ALTER TABLE public.condominios
  ADD COLUMN IF NOT EXISTS tem_consumo boolean NOT NULL DEFAULT false;

-- Zera antes: a lista e a verdade do momento, nao um acrescimo ao que havia.
UPDATE public.condominios SET tem_consumo = false WHERE tem_consumo;

UPDATE public.condominios c
   SET tem_consumo = true
  FROM (VALUES
    (88, 'DUQUE DI FAUSTUS'),
    (94, 'GIOVANNI PASCOLI'),
    (111, 'VILLE MARSEILLE'),
    (127, 'GREGÓRIO SERRÃO'),
    (131, 'PETIT PARIS'),
    (141, 'ISO'),
    (146, 'BOULEVARD SUL'),
    (153, 'GIVERNY'),
    (154, 'THEO'),
    (155, 'FONTAINEBLEAU'),
    (157, 'STRAUSS'),
    (166, 'CONCORDE'),
    (171, 'RES. VILLA INGLESA'),
    (175, 'BRENO'),
    (176, 'GREEN PARK'),
    (178, 'AMAZONIA'),
    (181, 'HELBOR LOFT EVOLUTION'),
    (193, 'QUINTESSENCE'),
    (194, 'BARCELONA'),
    (201, 'LIVING GARDEN'),
    (203, 'PORTAL DO S. FRANCISCO'),
    (208, 'PROVENCE'),
    (222, 'ENEIDE'),
    (224, 'PAULISTANO'),
    (226, 'ANDREA'),
    (227, 'ROSSINI'),
    (228, 'MORADA MARAJOARA'),
    (229, 'FLORA VIVA'),
    (233, 'TERRA VITRIS'),
    (234, 'PRACTICAL LIFE'),
    (236, 'SPLENDOR PARK'),
    (239, 'MODIGLIANI'),
    (240, 'MORADA T. BRASILIS'),
    (242, 'PERSONA VERGUEIRO'),
    (245, 'VILLA VERDE'),
    (250, 'JOY V. MARIANA'),
    (251, 'CAROL'),
    (259, 'SPORTS GARDEN LESTE'),
    (266, 'BERRINI'),
    (270, 'THE FIRST FREE FLEX'),
    (271, 'RISERVATO'),
    (274, 'PALAZZO REALE'),
    (275, 'RES. GRAND TERRACE'),
    (277, 'ALTOS DO BOSQUE'),
    (279, 'VISTA BELA'),
    (281, 'MÁLAGA'),
    (283, 'EVOLUTION PARAÍSO'),
    (284, 'VILA DE BRAGANÇA'),
    (289, 'TERRASSE'),
    (290, 'MODERN LIFE BACELAR'),
    (292, 'WISH RESIDENCE'),
    (294, 'DECOR PARAÍSO'),
    (300, 'METROPOL. V. PRUDENTE'),
    (301, 'INTERNATIONAL DUPLEX'),
    (302, 'RES. REFERENC BY HELBOR'),
    (305, 'RES. PAINEIRAS'),
    (308, 'MAISON CHARTRES'),
    (313, 'ECOLIFE C.UNIVERSITÁRIA'),
    (314, 'RES. ARAGUAIA'),
    (315, 'MARAJOARA BUSINESS'),
    (316, 'TERRA BRASILIS'),
    (318, 'BELAS ARTES'),
    (323, 'VISIONAIRE'),
    (328, 'GIOIA'),
    (329, 'WINWORK'),
    (332, 'RES. TRIO'),
    (337, 'BLANC C. BELO'),
    (340, 'DONA RACHEL'),
    (341, 'GARDEN VILLAGE'),
    (343, 'PATEO KLABIN'),
    (345, 'V. PAULICÉIA I'),
    (348, 'ALABASTRO'),
    (350, 'IN SÃO PAULO'),
    (355, 'VERONA TROPICAL'),
    (357, 'STYLE VIVRE MOEMA'),
    (359, 'ANDORRA'),
    (365, 'PRAÇA DESIGN'),
    (366, 'RENO'),
    (371, 'PARQUE BELÉM KLABIN'),
    (374, 'MIAMI TOP'),
    (378, 'SUPÉRIA PARAÍSO'),
    (379, 'ESPAÇO A'),
    (381, 'ICON BERRINI'),
    (387, 'PORT LIGAT'),
    (389, 'DUPLEX TOP TOWER'),
    (393, 'VILLA LOBOS'),
    (394, 'ESPAÇO MOBILE C. BELO'),
    (405, 'MAISON JOLIE'),
    (407, 'ESP. CORP. SILVA BUENO'),
    (409, 'MONTE CARLO'),
    (411, 'SWEET PARK'),
    (412, 'RES. PARADISO'),
    (417, 'FIT JARDIM BOTANICO'),
    (420, 'MAISON CLASSIQUE'),
    (421, 'VISTA NORTE'),
    (425, 'HELBOR ACQUALIFE'),
    (431, 'CULLINAN'),
    (432, 'TERRAS ALTAS'),
    (433, 'GRANVILLE'),
    (436, 'IRAPURU'),
    (438, 'YOUR RESIDENCE CLUB'),
    (439, 'UNIÃO'),
    (443, 'OY CAMPOS BELO BY YOU'),
    (444, 'BELLAGIO ECOPARK RESIDENCE'),
    (447, 'FIGUEIRA'),
    (459, 'SOLAZ V. MARIANA'),
    (460, 'QUALITY HOUSE'),
    (462, 'CASUAL V. MARIANA'),
    (464, 'LIVING CLUB CHÁCARA FLORA'),
    (465, 'BOREAL'),
    (466, 'NEX ONE'),
    (467, 'CENTRAL PARK'),
    (470, 'NEO IPIRANGA'),
    (474, 'VISTA IPIRANGA'),
    (475, 'VIBE CAMPO BELO'),
    (478, 'METROCASA'),
    (483, 'BIRDS GARDEN'),
    (484, 'CLUBLINE'),
    (487, 'VERSA BROOKLIN')
  ) AS l(codigo, apelido)
 WHERE substring(c.name from '^[[:space:]]*([0-9]+)')::int = l.codigo;

-- ---- Conferencia 1: quantos ficaram marcados. Esperado: perto de 119. ----
SELECT count(*) AS marcados FROM public.condominios WHERE tem_consumo;

-- ---- Conferencia 2: codigos da lista que NAO acharam condominio. ----
-- Erro de digitacao ou condominio que saiu da base. Esperado: nenhuma linha.
SELECT l.codigo, l.apelido
  FROM (VALUES
    (88, 'DUQUE DI FAUSTUS'),
    (94, 'GIOVANNI PASCOLI'),
    (111, 'VILLE MARSEILLE'),
    (127, 'GREGÓRIO SERRÃO'),
    (131, 'PETIT PARIS'),
    (141, 'ISO'),
    (146, 'BOULEVARD SUL'),
    (153, 'GIVERNY'),
    (154, 'THEO'),
    (155, 'FONTAINEBLEAU'),
    (157, 'STRAUSS'),
    (166, 'CONCORDE'),
    (171, 'RES. VILLA INGLESA'),
    (175, 'BRENO'),
    (176, 'GREEN PARK'),
    (178, 'AMAZONIA'),
    (181, 'HELBOR LOFT EVOLUTION'),
    (193, 'QUINTESSENCE'),
    (194, 'BARCELONA'),
    (201, 'LIVING GARDEN'),
    (203, 'PORTAL DO S. FRANCISCO'),
    (208, 'PROVENCE'),
    (222, 'ENEIDE'),
    (224, 'PAULISTANO'),
    (226, 'ANDREA'),
    (227, 'ROSSINI'),
    (228, 'MORADA MARAJOARA'),
    (229, 'FLORA VIVA'),
    (233, 'TERRA VITRIS'),
    (234, 'PRACTICAL LIFE'),
    (236, 'SPLENDOR PARK'),
    (239, 'MODIGLIANI'),
    (240, 'MORADA T. BRASILIS'),
    (242, 'PERSONA VERGUEIRO'),
    (245, 'VILLA VERDE'),
    (250, 'JOY V. MARIANA'),
    (251, 'CAROL'),
    (259, 'SPORTS GARDEN LESTE'),
    (266, 'BERRINI'),
    (270, 'THE FIRST FREE FLEX'),
    (271, 'RISERVATO'),
    (274, 'PALAZZO REALE'),
    (275, 'RES. GRAND TERRACE'),
    (277, 'ALTOS DO BOSQUE'),
    (279, 'VISTA BELA'),
    (281, 'MÁLAGA'),
    (283, 'EVOLUTION PARAÍSO'),
    (284, 'VILA DE BRAGANÇA'),
    (289, 'TERRASSE'),
    (290, 'MODERN LIFE BACELAR'),
    (292, 'WISH RESIDENCE'),
    (294, 'DECOR PARAÍSO'),
    (300, 'METROPOL. V. PRUDENTE'),
    (301, 'INTERNATIONAL DUPLEX'),
    (302, 'RES. REFERENC BY HELBOR'),
    (305, 'RES. PAINEIRAS'),
    (308, 'MAISON CHARTRES'),
    (313, 'ECOLIFE C.UNIVERSITÁRIA'),
    (314, 'RES. ARAGUAIA'),
    (315, 'MARAJOARA BUSINESS'),
    (316, 'TERRA BRASILIS'),
    (318, 'BELAS ARTES'),
    (323, 'VISIONAIRE'),
    (328, 'GIOIA'),
    (329, 'WINWORK'),
    (332, 'RES. TRIO'),
    (337, 'BLANC C. BELO'),
    (340, 'DONA RACHEL'),
    (341, 'GARDEN VILLAGE'),
    (343, 'PATEO KLABIN'),
    (345, 'V. PAULICÉIA I'),
    (348, 'ALABASTRO'),
    (350, 'IN SÃO PAULO'),
    (355, 'VERONA TROPICAL'),
    (357, 'STYLE VIVRE MOEMA'),
    (359, 'ANDORRA'),
    (365, 'PRAÇA DESIGN'),
    (366, 'RENO'),
    (371, 'PARQUE BELÉM KLABIN'),
    (374, 'MIAMI TOP'),
    (378, 'SUPÉRIA PARAÍSO'),
    (379, 'ESPAÇO A'),
    (381, 'ICON BERRINI'),
    (387, 'PORT LIGAT'),
    (389, 'DUPLEX TOP TOWER'),
    (393, 'VILLA LOBOS'),
    (394, 'ESPAÇO MOBILE C. BELO'),
    (405, 'MAISON JOLIE'),
    (407, 'ESP. CORP. SILVA BUENO'),
    (409, 'MONTE CARLO'),
    (411, 'SWEET PARK'),
    (412, 'RES. PARADISO'),
    (417, 'FIT JARDIM BOTANICO'),
    (420, 'MAISON CLASSIQUE'),
    (421, 'VISTA NORTE'),
    (425, 'HELBOR ACQUALIFE'),
    (431, 'CULLINAN'),
    (432, 'TERRAS ALTAS'),
    (433, 'GRANVILLE'),
    (436, 'IRAPURU'),
    (438, 'YOUR RESIDENCE CLUB'),
    (439, 'UNIÃO'),
    (443, 'OY CAMPOS BELO BY YOU'),
    (444, 'BELLAGIO ECOPARK RESIDENCE'),
    (447, 'FIGUEIRA'),
    (459, 'SOLAZ V. MARIANA'),
    (460, 'QUALITY HOUSE'),
    (462, 'CASUAL V. MARIANA'),
    (464, 'LIVING CLUB CHÁCARA FLORA'),
    (465, 'BOREAL'),
    (466, 'NEX ONE'),
    (467, 'CENTRAL PARK'),
    (470, 'NEO IPIRANGA'),
    (474, 'VISTA IPIRANGA'),
    (475, 'VIBE CAMPO BELO'),
    (478, 'METROCASA'),
    (483, 'BIRDS GARDEN'),
    (484, 'CLUBLINE'),
    (487, 'VERSA BROOKLIN')
  ) AS l(codigo, apelido)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.condominios c
    WHERE substring(c.name from '^[[:space:]]*([0-9]+)')::int = l.codigo
 )
 ORDER BY l.codigo;

-- ---- Conferencia 3: tinha concessionaria mas ficou de fora da lista nova. ----
-- Nada foi apagado -- e so para conferir se algum ficou de fora sem querer.
SELECT DISTINCT c.name
  FROM public.condominios c
  JOIN public.condominios_concessionarias cc ON cc.condominio_id = c.id
 WHERE NOT c.tem_consumo
 ORDER BY c.name;
