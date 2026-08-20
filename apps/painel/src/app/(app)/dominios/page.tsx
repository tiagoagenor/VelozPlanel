import { Globe } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function DominiosPage() {
  return (
    <ComingSoon
      icon={Globe}
      title="Domínios"
      description="Conecte domínios próprios aos seus ambientes, gerencie DNS e emita certificados HTTPS automáticos. Estamos preparando esta área para chegar em breve."
    />
  );
}
