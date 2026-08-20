import { Database } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function EnvBancoPage() {
  return (
    <ComingSoon
      icon={Database}
      title="Banco de dados"
      description="Crie e administre bancos MySQL e PostgreSQL vinculados a este ambiente, com credenciais e uso. Em breve."
    />
  );
}
