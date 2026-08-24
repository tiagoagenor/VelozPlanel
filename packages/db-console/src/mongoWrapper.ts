/**
 * Wrapper mongosh 100% ESTÁTICO (nenhum dado do usuário é interpolado aqui).
 * Recebe os argumentos como DADOS via `process.env.VP_ARGS` (Extended JSON) e
 * `process.env.VP_DB`; valida a operação de novo (defesa dupla) e imprime o
 * resultado em EJSON canônico. Passado ao mongosh como `--eval "$VP_WRAP"`
 * (VP_WRAP vem por env, sem re-avaliação de shell; e como é estático não há
 * injeção de JS possível).
 */
export const MONGO_WRAPPER_JS = `
(function () {
  var a = EJSON.parse(process.env.VP_ARGS);
  var READ = ['find','aggregate','count','distinct','listCollections','listIndexes'];
  var WRITE = ['insertOne','insertMany','updateOne','updateMany','deleteOne','deleteMany','createCollection','createIndex'];
  if (READ.indexOf(a.op) < 0 && WRITE.indexOf(a.op) < 0) throw new Error('op_nao_permitida');
  if (a.write !== true && WRITE.indexOf(a.op) >= 0) throw new Error('escrita_requer_modo_escrita');
  if (a.op === 'aggregate') {
    var banned = ['$out','$merge','$function','$accumulator','$where'];
    var p = a.pipeline || [];
    for (var i = 0; i < p.length; i++) for (var k in p[i]) if (banned.indexOf(k) >= 0) throw new Error('estagio_proibido:' + k);
  }
  var T = 25000;
  var D = db.getSiblingDB(process.env.VP_DB);
  var c = a.collection ? D.getCollection(a.collection) : null;
  var out;
  switch (a.op) {
    case 'find': out = c.find(a.filter || {}, a.projection || undefined).sort(a.sort || {}).skip(a.skip || 0).limit(Math.min(a.limit || 100, 1000)).maxTimeMS(T).toArray(); break;
    case 'aggregate': out = c.aggregate(a.pipeline || [], { maxTimeMS: T }).toArray(); break;
    case 'count': out = c.countDocuments(a.filter || {}, { maxTimeMS: T }); break;
    case 'distinct': out = c.distinct(a.field, a.filter || {}); break;
    case 'listCollections': out = D.getCollectionInfos(); break;
    case 'listIndexes': out = c.getIndexes(); break;
    case 'insertOne': out = c.insertOne(a.doc); break;
    case 'insertMany': out = c.insertMany(a.docs || []); break;
    case 'updateOne': out = c.updateOne(a.filter, a.update, a.options || {}); break;
    case 'updateMany': out = c.updateMany(a.filter, a.update, a.options || {}); break;
    case 'deleteOne': out = c.deleteOne(a.filter); break;
    case 'deleteMany': out = c.deleteMany(a.filter); break;
    case 'createCollection': out = D.createCollection(a.collection); break;
    case 'createIndex': out = c.createIndex(a.keys, a.options || {}); break;
    default: throw new Error('op_nao_permitida');
  }
  print(EJSON.stringify({ ok: 1, op: a.op, result: out }, { relaxed: false }));
})();
`;
