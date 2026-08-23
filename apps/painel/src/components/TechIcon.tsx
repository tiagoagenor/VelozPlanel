/**
 * TechIcon — ícone da tecnologia do ambiente (Node.js, PHP, Redis, MySQL…).
 * Usa o conjunto gerado no agy/nano banana (rodada 4, escolha do especialista):
 * PNGs "app-icon" em public/img/tech/<tech>.png (glifo branco sobre tile sólido
 * na cor da marca). Assinatura compatível com Lucide ({ size, className }).
 */
import type { Environment } from "@velozplanel/contracts";

const TITLES: Record<string, string> = {
  php: "PHP",
  node: "Node.js",
  redis: "Redis",
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgres: "PostgreSQL",
  rabbitmq: "RabbitMQ",
  n8n: "n8n",
  wordpress: "WordPress",
};

/** Resolve a chave de tecnologia a partir do ambiente. */
function techKey(env: Environment): string | null {
  if (env.category === "service") {
    const t = (env.type ?? "").toLowerCase();
    if (t.includes("maria")) return "mariadb";
    if (t.includes("postgres") || t === "pg") return "postgres";
    if (t.includes("mysql")) return "mysql";
    if (t.includes("redis")) return "redis";
    if (t.includes("rabbit")) return "rabbitmq";
    if (t.includes("n8n")) return "n8n";
    if (t.includes("word")) return "wordpress";
    return TITLES[t] ? t : null;
  }
  return env.runtime.kind === "php" ? "php" : "node";
}

/** Tile PNG da tecnologia. */
function TileImg({ tkey, title, size, className }: { tkey: string; title: string; size: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/img/tech/${tkey}.png`}
      alt={title}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

/** Fallback (tipo sem ícone próprio): tile neutro roxo com um glifo genérico. */
function Fallback({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Ambiente" className={className}>
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#634ca8" />
      <path d="M12 15a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2Zm2 0v3h12v-3Z" fill="#fff" />
    </svg>
  );
}

/** Ícone da tecnologia do ambiente. */
export function EnvTechIcon({ env, size = 34, className }: { env: Environment; size?: number; className?: string }) {
  const key = techKey(env);
  const title = key ? TITLES[key] : undefined;
  if (!key || !title) return <Fallback size={size} className={className} />;
  return <TileImg tkey={key} title={title} size={size} className={className} />;
}

/** Ícone por id de tipo (usado no CreateEnvironmentDialog). */
export function TechIconById({ id, size = 30, className }: { id: string; size?: number; className?: string }) {
  const title = TITLES[id];
  if (!title) return <Fallback size={size} className={className} />;
  return <TileImg tkey={id} title={title} size={size} className={className} />;
}
