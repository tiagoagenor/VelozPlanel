import { ShieldCheck } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function EnvSslPage() {
  return (
    <ComingSoon
      icon={ShieldCheck}
      title="SSL"
      description="Emissão e renovação automática de certificados HTTPS para o domínio do ambiente. Chega na próxima fase."
    />
  );
}
