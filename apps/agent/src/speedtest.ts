/**
 * Teste de velocidade de internet do NÓ onde o agente vive (download/upload/ping).
 *
 * Usa os endpoints públicos do Cloudflare Speed Test (speed.cloudflare.com) —
 * os mesmos que o site speed.cloudflare.com usa — via `fetch` do próprio Node.
 * Sem binário extra (não depende de speedtest-cli), mede a banda REAL da máquina.
 *
 *   download: GET  /__down?bytes=N   (corpo descartado, contando bytes)
 *   upload:   POST /__up             (corpo de N bytes zerados)
 *   ping:     TTFB de /__down?bytes=0 (menor RTT de algumas amostras)
 */

const DOWN = "https://speed.cloudflare.com/__down";
const UP = "https://speed.cloudflare.com/__up";
const SERVER = "speed.cloudflare.com";
// O Cloudflare passou a responder 403 no /__down quando `bytes` chega a ~100 MB
// (10^8) — antes aceitava bem mais. Tetamos a medição de download abaixo disso
// (90 MB, comprovado 200) para não estourar o limite. O /__up ainda aceita ≥100 MB.
const DOWN_MAX_BYTES = 90_000_000;

export interface SpeedtestResult {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number | null;
  bytesDown: number;
  bytesUp: number;
  server: string;
}

/** bytes transferidos em `seconds` -> megabits por segundo (2 casas). */
function mbps(bytes: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.round(((bytes * 8) / seconds / 1e6) * 100) / 100;
}

async function measurePing(samples = 5): Promise<number | null> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${DOWN}?bytes=0`);
      await res.arrayBuffer();
      times.push(performance.now() - t0);
    } catch {
      /* amostra ruim: ignora */
    }
  }
  if (times.length === 0) return null;
  return Math.round(Math.min(...times) * 100) / 100; // menor RTT observado
}

async function runDownload(bytes: number, timeoutMs: number): Promise<{ bytes: number; seconds: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  let received = 0;
  try {
    const res = await fetch(`${DOWN}?bytes=${bytes}`, { signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status}`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) received += value.length; // descarta o conteúdo, só conta
    }
  } finally {
    clearTimeout(timer);
  }
  return { bytes: received, seconds: (performance.now() - t0) / 1000 };
}

async function runUpload(bytes: number, timeoutMs: number): Promise<{ bytes: number; seconds: number }> {
  const payload = Buffer.alloc(bytes); // conteúdo irrelevante p/ medir banda
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(UP, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/octet-stream" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
    await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
  return { bytes, seconds: (performance.now() - t0) / 1000 };
}

/**
 * Roda o teste completo. Cada direção faz uma SONDA curta p/ estimar a banda e
 * depois a medição principal com tamanho ajustado (~8s download / ~6s upload),
 * limitado para não estourar tempo/memória em links lentos ou rápidos demais.
 */
export async function runSpeedtest(): Promise<SpeedtestResult> {
  const pingMs = await measurePing();

  const dlProbe = await runDownload(10_000_000, 20_000);
  const dlEst = mbps(dlProbe.bytes, dlProbe.seconds) || 10;
  // O Cloudflare passou a responder 403 no /__down para `bytes` >= ~100 MB (antes
  // aceitava até 200 MB+). Tetamos em DOWN_MAX_BYTES (90 MB): uma requisição só,
  // baixo consumo e sem risco de 429 por volume. Em link muito rápido a janela fica
  // curta (~1s), com alguma variância — aceitável para o monitoramento horário.
  const dlBytes = Math.min(DOWN_MAX_BYTES, Math.max(20_000_000, Math.round(dlEst * 1_000_000)));
  const dl = await runDownload(dlBytes, 45_000);

  const upProbe = await runUpload(5_000_000, 20_000);
  const upEst = mbps(upProbe.bytes, upProbe.seconds) || 5;
  const ulBytes = Math.min(100_000_000, Math.max(10_000_000, Math.round((upEst * 1_000_000 * 6) / 8))); // ~6s
  const ul = await runUpload(ulBytes, 45_000);

  return {
    downloadMbps: mbps(dl.bytes, dl.seconds),
    uploadMbps: mbps(ul.bytes, ul.seconds),
    pingMs,
    bytesDown: dl.bytes,
    bytesUp: ul.bytes,
    server: SERVER,
  };
}
