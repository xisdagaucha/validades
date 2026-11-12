#!/bin/bash
# Atualiza o programa da caixinha de impressão Xis da Gaúcha
set -e
BASE="https://xisdagaucha.github.io/validades/ponte"
echo ">> Baixando a versão nova da caixinha..."
sudo curl -fsSL "$BASE/ponte.mjs?t=$(date +%s)" -o /opt/ponte-xis/ponte.mjs.novo
node --check /opt/ponte-xis/ponte.mjs.novo
sudo mv /opt/ponte-xis/ponte.mjs.novo /opt/ponte-xis/ponte.mjs
sudo systemctl restart ponte-xis
sleep 6
sudo journalctl -u ponte-xis -n 3 --no-pager
echo ""
echo "=============================================="
echo "  Pronto! Caixinha atualizada."
echo "  A partir de agora ela se atualiza sozinha."
echo "=============================================="
