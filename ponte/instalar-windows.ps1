# Instalador da caixinha de impressao Xis da Gaucha - versao para computador Windows
# Uso (PowerShell): iex ((New-Object Net.WebClient).DownloadString('https://xisdagaucha.github.io/validades/ponte/instalar-windows.ps1'))
$ErrorActionPreference = 'Stop'
$BASE = 'https://xisdagaucha.github.io/validades/ponte'
$DIR  = 'C:\ponte-xis'
function Linha { Write-Host '==============================================' -ForegroundColor Green }
Write-Host ''; Linha; Write-Host '  Caixinha de impressao - Xis da Gaucha (Windows)'; Linha; Write-Host ''

# 1. Node.js
function Recarregar-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host '>> Instalando o Node.js (programa que roda a caixinha)...'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    Recarregar-Path
  }
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host 'Nao consegui instalar o Node.js sozinho.' -ForegroundColor Yellow
    Write-Host 'Abra nodejs.org, baixe a versao LTS, instale (Next ate o fim),'
    Write-Host 'feche esta janela, abra o PowerShell de novo e rode o comando outra vez.'
    return
  }
}

# 2. Dados da loja
$EMAIL = Read-Host 'E-mail da conta da loja'
$sec   = Read-Host 'Senha da conta da loja' -AsSecureString
$SENHA = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$traco = [string][char]0x2013
$UNIDS = @( ('Barreiros ' + $traco + ' S' + [char]0xE3 + 'o Jos' + [char]0xE9), ('Centro ' + $traco + ' Palho' + [char]0xE7 + 'a'), 'Estoque Principal' )
Write-Host ''
Write-Host 'Em qual loja este computador vai imprimir?'
Write-Host '  1) Barreiros - Sao Jose'
Write-Host '  2) Centro - Palhoca'
Write-Host '  3) Estoque Principal'
$u = Read-Host 'Digite o numero'
if ($u -notin '1','2','3') { Write-Host 'Opcao invalida' -ForegroundColor Red; return }
$UNID = $UNIDS[[int]$u - 1]

# 3. Impressora
$imps = @(Get-Printer | Select-Object -ExpandProperty Name)
if ($imps.Count -eq 0) { Write-Host 'Nenhuma impressora instalada no Windows. Instale o driver da impressora e rode de novo.' -ForegroundColor Red; return }
Write-Host ''
Write-Host 'Qual e a impressora de etiquetas?'
for ($i = 0; $i -lt $imps.Count; $i++) { Write-Host ('  ' + ($i + 1) + ') ' + $imps[$i]) }
$n = Read-Host 'Digite o numero'
if (-not ($n -as [int]) -or [int]$n -lt 1 -or [int]$n -gt $imps.Count) { Write-Host 'Opcao invalida' -ForegroundColor Red; return }
$IMP = $imps[[int]$n - 1]

# 4. Programa
Write-Host ''
Write-Host '>> Baixando e instalando a caixinha (pode levar alguns minutos)...'
Get-CimInstance Win32_Process | Where-Object { ($_.CommandLine -like '*ponte-xis*' -or $_.CommandLine -like '*ponte.mjs*') -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $DIR | Out-Null
$t = [DateTimeOffset]::Now.ToUnixTimeSeconds()
Invoke-WebRequest "$BASE/ponte.mjs?t=$t" -OutFile "$DIR\ponte.mjs" -UseBasicParsing
Invoke-WebRequest "$BASE/package.json?t=$t" -OutFile "$DIR\package.json" -UseBasicParsing
Push-Location $DIR
& npm.cmd install --omit=dev --no-audit --no-fund
Pop-Location

# 5. Configuracao
$cfg = [ordered]@{
  id = ('computador-' + $env:COMPUTERNAME.ToLower()); email = $EMAIL; senha = $SENHA; unidades = @($UNID); impressora = ('win:' + $IMP)
  firebase = [ordered]@{ apiKey = 'AIzaSyDOuxT3TAaJ0yqf9MGgASEzcFnEplcrEJ8'; authDomain = 'validades-xis.firebaseapp.com'; projectId = 'validades-xis'
    storageBucket = 'validades-xis.firebasestorage.app'; messagingSenderId = '905066579589'; appId = '1:905066579589:web:d96c08cc0a0937c854cbec' }
}
[IO.File]::WriteAllText("$DIR\config.json", ($cfg | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))

# 6. Iniciar sozinha quando o computador ligar
$cmdTxt = "@echo off`r`ncd /d $DIR`r`n:loop`r`nnode ponte.mjs > ponte.log 2>&1`r`ntimeout /t 10 /nobreak >nul`r`ngoto loop`r`n"
[IO.File]::WriteAllText("$DIR\iniciar.cmd", $cmdTxt)
$vbs = 'CreateObject("WScript.Shell").Run "cmd /c ""' + $DIR + '\iniciar.cmd""", 0, False'
$startup = [Environment]::GetFolderPath('Startup')
[IO.File]::WriteAllText("$startup\Caixinha Xis da Gaucha.vbs", $vbs)
try { powercfg /change standby-timeout-ac 0 | Out-Null } catch {}
Start-Process wscript.exe -ArgumentList ('"' + "$startup\Caixinha Xis da Gaucha.vbs" + '"')
Start-Sleep -Seconds 12
Write-Host ''
if (Test-Path "$DIR\ponte.log") { Get-Content "$DIR\ponte.log" -Tail 3 }
Write-Host ''
Linha
Write-Host '  Pronto! Este computador agora e a caixinha de impressao.'
Write-Host ('  Impressora: ' + $IMP)
Write-Host '  Confira no app: Ajustes > Impressora de etiquetas'
Write-Host '  Deixe o computador ligado. Ele volta a funcionar sozinho ao reiniciar.'
Linha
