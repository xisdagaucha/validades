#!/bin/bash
# Instalador da caixinha de impressão Xis da Gaúcha (Raspberry Pi OS)
set -e
BASE="https://xisdagaucha.github.io/validades/ponte"
echo ""
echo "=============================================="
echo "  Caixinha de impressão - Xis da Gaúcha"
echo "=============================================="
read -p "E-mail da conta da loja: " EMAIL </dev/tty
read -s -p "Senha da conta da loja: " SENHA </dev/tty; echo ""
echo ""
echo "Em qual loja esta caixinha vai ficar?"
echo "  1) Barreiros – São José"
echo "  2) Centro – Palhoça"
echo "  3) Estoque Principal"
read -p "Digite o número: " U </dev/tty
case "$U" in
  1) UNID="Barreiros – São José";;
  2) UNID="Centro – Palhoça";;
  3) UNID="Estoque Principal";;
  *) echo "Opção inválida"; exit 1;;
esac
IMP="/dev/usb/lp0"
if [ ! -e /dev/usb/lp0 ]; then
  echo ""
  echo "Não encontrei a Zebra no USB."
  read -p "Se ela estiver na rede, digite o IP (ex.: 192.168.0.50) ou Enter para usar USB: " IP </dev/tty
  if [ -n "$IP" ]; then IMP="tcp://$IP:9100"; fi
fi
echo ""
echo ">> Instalando programas (pode levar alguns minutos)..."
sudo apt-get update -y
sudo apt-get install -y nodejs npm curl
sudo mkdir -p /opt/ponte-xis
sudo curl -fsSL "$BASE/ponte.mjs" -o /opt/ponte-xis/ponte.mjs
sudo curl -fsSL "$BASE/package.json" -o /opt/ponte-xis/package.json
cd /opt/ponte-xis && sudo npm install --omit=dev --no-audit --no-fund
echo ">> Salvando configuração..."
EMAIL="$EMAIL" SENHA="$SENHA" UNID="$UNID" IMP="$IMP" HN="$(hostname)" sudo -E node -e '
const fs=require("fs"); const e=process.env;
fs.writeFileSync("/etc/ponte-xis.json", JSON.stringify({
  id:e.HN, email:e.EMAIL, senha:e.SENHA, unidades:[e.UNID], impressora:e.IMP,
  firebase:{apiKey:"AIzaSyDOuxT3TAaJ0yqf9MGgASEzcFnEplcrEJ8",authDomain:"validades-xis.firebaseapp.com",projectId:"validades-xis",
    storageBucket:"validades-xis.firebasestorage.app",messagingSenderId:"905066579589",appId:"1:905066579589:web:d96c08cc0a0937c854cbec"}
}, null, 2));'
sudo chmod 600 /etc/ponte-xis.json
echo ">> Ligando a caixinha para iniciar sozinha..."
sudo tee /etc/systemd/system/ponte-xis.service >/dev/null <<SVC
[Unit]
Description=Caixinha de impressao Xis da Gaucha
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/usr/bin/node /opt/ponte-xis/ponte.mjs
WorkingDirectory=/opt/ponte-xis
Restart=always
RestartSec=10
User=root
[Install]
WantedBy=multi-user.target
SVC
sudo systemctl daemon-reload
sudo systemctl enable ponte-xis
sudo systemctl restart ponte-xis
sleep 6
echo ""
sudo journalctl -u ponte-xis -n 5 --no-pager
echo ""
echo "=============================================="
echo "  Pronto! Caixinha da loja: $UNID"
echo "  Impressora: $IMP"
echo "  Confira no app: Ajustes > Impressora Zebra"
echo "=============================================="
