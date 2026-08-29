/**
 * Saída do CLI: SEMPRE um único objeto JSON no stdout. É onde mora a economia
 * de token — o assistente lê ~50–150 tokens em vez do stdout/stderr cru.
 *
 * Convenção:
 *  - sucesso: { ok: true, ...campos essenciais... }
 *  - falha:   { ok: false, error, step?, tail?[~40 linhas], hint?, logId? }
 *  - grande:  { ok: true, summary, logId, more, truncated }  (detalhe via `jamees logs pull`)
 *
 * Códigos de saída: 0 ok · 1 falha tratada · 2 uso/args · 3 confirmação exigida.
 */

export type Json = Record<string, unknown>;

/** Imprime o objeto e encerra o processo com o código adequado. */
export function emit(obj: Json, code = 0): never {
  process.stdout.write(JSON.stringify(obj) + "\n");
  process.exit(code);
}

export function ok(fields: Json = {}): never {
  emit({ ok: true, ...fields }, 0);
}

export function fail(error: string, extra: Json = {}, code = 1): never {
  emit({ ok: false, error, ...extra }, code);
}

/** Falta --yes numa operação destrutiva: devolve o plano e sai com código 3. */
export function needConfirm(plan: Json): never {
  emit({ ok: false, needsConfirm: true, plan }, 3);
}

/** Erro de uso/args. */
export function usage(error: string, extra: Json = {}): never {
  emit({ ok: false, error, usage: true, ...extra }, 2);
}

/** Últimas n linhas de um texto (para o campo `tail` em falhas). */
export function tail(text: string, n = 40): string[] {
  const lines = text.replace(/\s+$/, "").split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n));
}
