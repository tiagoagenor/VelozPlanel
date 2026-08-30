# Política de Uso Aceitável — VPS (KVM) VelozPlanel

Ao contratar um VPS você concorda com o abaixo. O descumprimento leva a **suspensão
imediata** da VM (congelamento, com preservação de dados por período limitado) e, em
reincidência, ao encerramento.

## É proibido
- **Envio de spam / e-mail em massa.** A saída SMTP (portas 25/465/587) é **bloqueada por
  padrão** — libera-se relay só após avaliação.
- **Port scanning, brute-force, DDoS** (origem ou reflexão/amplificação), botnets, C2.
- **Mineração de criptomoeda** sem autorização prévia por escrito.
- **Phishing, malware, conteúdo ilegal**, violação de direitos autorais.
- Tentar alcançar a rede de gestão, o host, outros clientes ou a LAN do provedor
  (bloqueado por firewall; a tentativa já é violação).
- Consumo abusivo que degrade o nó para os demais (a banda/CPU/RAM têm limites por VM).

## Responsabilidades do cliente
- Você é **root** na sua VM e responsável por mantê-la atualizada e segura
  (senhas/chaves fortes, serviços expostos por sua conta e risco).
- Backups do seu conteúdo são sua responsabilidade, salvo plano com backup contratado.

## Limitações conhecidas (piloto)
- **IP residencial**: 80/443 podem estar filtrados pelo provedor de internet; a borda usa
  porta alternativa + proxy por domínio. **Não há garantia de entregabilidade de e-mail.**
- Recursos são **reserva real** (RAM/vCPU) — os planos refletem isso.

## Resposta a abuso
- Suspensão via painel (admin) ou `virsh suspend` no nó; logs preservados para apuração.
- Denúncias: abra um chamado no painel.
