import { Database } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function BancosPage() {
  return (
    <ComingSoon
      icon={Database}
      title="Bancos de dados"
      description="Crie bancos MySQL e PostgreSQL, gerencie usuários e acompanhe o uso ao lado de cada ambiente. Em breve por aqui."
    />
  );
}
