import { CreditCard } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function FinanceiroPage() {
  return (
    <ComingSoon
      icon={CreditCard}
      title="Financeiro"
      description="Acompanhe o saldo pré-pago, o consumo por hora de cada ambiente e o histórico de recargas. Esta área chega em breve."
    />
  );
}
