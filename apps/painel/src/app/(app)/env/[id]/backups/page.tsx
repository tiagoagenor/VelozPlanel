import { Archive } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function EnvBackupsPage() {
  return (
    <ComingSoon
      icon={Archive}
      title="Backups"
      description="Agende backups automáticos e restaure o ambiente para um ponto anterior com poucos cliques. Em breve."
    />
  );
}
