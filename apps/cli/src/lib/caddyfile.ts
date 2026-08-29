/** Utilidades puras para editar o Caddyfile monolítico por blocos (depth-0). */

export interface Block {
  header: string; // texto antes do primeiro '{' (hosts do site)
  text: string; // bloco inteiro, do header ao '}' correspondente
  start: number;
  end: number; // índice logo após o '}'
}

/** Divide o Caddyfile em blocos de nível 0 (site { … }). Ignora linhas soltas (ex.: import). */
export function splitBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    // pula espaços/linhas/comentários até um header
    while (i < n && /\s/.test(src[i]!)) i++;
    if (i >= n) break;
    // linha de comentário ou diretiva solta (sem '{' antes da quebra) — pula a linha
    const brace = src.indexOf("{", i);
    const nl = src.indexOf("\n", i);
    if (brace === -1 || (nl !== -1 && nl < brace)) {
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    const header = src.slice(i, brace).trim();
    // acha o '}' correspondente
    let depth = 0;
    let j = brace;
    for (; j < n; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    blocks.push({ header, text: src.slice(i, j), start: i, end: j });
    i = j;
  }
  return blocks;
}

/** Acha o bloco cujo header contém o host (token separado por vírgula). */
export function findByHost(blocks: Block[], host: string): Block | undefined {
  const h = host.replace(/\.$/, "");
  return blocks.find((b) =>
    b.header
      .split(",")
      .map((s) => s.trim().replace(/\.$/, ""))
      .includes(h),
  );
}

/** Acha o bloco cujo corpo contém uma substring (ex.: "painel:3000"). */
export function findByBody(blocks: Block[], needle: string): Block | undefined {
  return blocks.find((b) => b.text.includes(needle));
}

/** Substitui o texto de um bloco existente por `newText`, ou anexa ao fim. */
export function upsertBlock(src: string, target: Block | undefined, newText: string): string {
  if (target) {
    return src.slice(0, target.start) + newText.trim() + src.slice(target.end);
  }
  const sep = src.endsWith("\n") ? "\n" : "\n\n";
  return src.replace(/\s*$/, "") + sep + newText.trim() + "\n";
}
