/**
 * Regra: escrita no Supabase precisa ler o `{ error }` que ela devolve.
 *
 * POR QUE ESTA REGRA EXISTE
 *
 * O `supabase-js` DEVOLVE `{ data, error }` em vez de lançar exceção. Escrever
 *
 *     await supabase.from('x').insert({...});
 *
 * faz uma recusa do banco passar como sucesso: a tela mostra "pronto" e o dado
 * nunca existiu. Este projeto perdeu dado assim três vezes:
 *
 *   • coluna `assistente` — cadastro de condomínio quebrado por meses
 *   • coluna `fluxo`      — TODO processo aprovado direto, pulando supervisores
 *   • anexo de boleto     — arquivos no bucket, sem linha na tabela
 *
 * Nenhum dos três deu erro em lugar nenhum. Foram descobertos por acaso.
 *
 * O QUE ELA ACEITA
 *
 *   const { error } = await supabase.from('x').insert(...);   // lê o erro
 *   const { data, error } = await supabase...update(...);
 *   return supabase.from('x').delete()...                     // devolve p/ quem chamou
 *   await supabase.storage.from('b').remove(...)              // storage: outra API
 *
 * O QUE ELA RECUSA
 *
 *   await supabase.from('x').insert(...);                     // resultado no lixo
 *   supabase.from('x').update(...);                           // idem, sem await
 */

const ESCRITAS = new Set(['insert', 'update', 'upsert', 'delete']);

/** A cadeia toca `.from(...)` sem passar por `.storage`? */
function ehTabelaSupabase(node) {
  let n = node;
  let viuFrom = false;
  while (n && n.type === 'CallExpression') {
    const callee = n.callee;
    if (callee?.type !== 'MemberExpression') break;
    const prop = callee.property?.name;
    if (prop === 'from') viuFrom = true;
    if (prop === 'storage') return false;
    if (callee.object?.type === 'Identifier') {
      const base = callee.object.name;
      if (callee.object.property?.name === 'storage') return false;
      return viuFrom && /supabase|^db$|^sb$/i.test(base);
    }
    if (callee.object?.type === 'MemberExpression'
        && callee.object.property?.name === 'storage') return false;
    n = callee.object;
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Escrita no Supabase deve ler o { error } devolvido' },
    schema: [],
    messages: {
      semChecar:
        'Esta escrita no Supabase joga o resultado fora. O supabase-js DEVOLVE '
        + '{ error } em vez de lançar: assim, uma recusa do banco passa como '
        + 'sucesso e o dado some sem ninguém ver. Use '
        + '`const { error } = await ...` e trate o erro.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const prop = node.callee?.property?.name;
        if (!ESCRITAS.has(prop)) return;
        if (!ehTabelaSupabase(node)) return;

        // Sobe a cadeia (.eq().select()...) até o topo da expressão.
        //
        // `.then(({ error }) => …)` conta como tratado: o callback recebe o
        // mesmo `{ data, error }` que a desestruturação receberia. É a forma
        // usada quando não se pode dar await — dentro de um setState, por
        // exemplo. Sem esta exceção a regra acusaria código correto, e regra
        // que dá alarme falso é regra que alguém desliga.
        let topo = node;
        let tratadoNoThen = false;
        while (
          topo.parent
          && ((topo.parent.type === 'MemberExpression' && topo.parent.object === topo)
            || (topo.parent.type === 'CallExpression' && topo.parent.callee === topo)
            || topo.parent.type === 'AwaitExpression')
        ) {
          if (topo.parent.type === 'MemberExpression'
              && ['then', 'catch', 'finally'].includes(topo.parent.property?.name)) {
            tratadoNoThen = true;
          }
          topo = topo.parent;
        }
        if (tratadoNoThen) return;

        const pai = topo.parent;
        if (!pai) return;

        // Resultado usado de alguma forma legítima: atribuído, devolvido,
        // passado adiante, encadeado em .then(), comparado, etc.
        const usado = [
          'VariableDeclarator', 'AssignmentExpression', 'ReturnStatement',
          'ArrowFunctionExpression', 'Property', 'CallExpression',
          'MemberExpression', 'ConditionalExpression', 'LogicalExpression',
          'BinaryExpression', 'ArrayExpression', 'SpreadElement',
          'TemplateLiteral', 'IfStatement', 'JSXExpressionContainer',
        ].includes(pai.type);

        if (!usado) context.report({ node, messageId: 'semChecar' });
      },
    };
  },
};
