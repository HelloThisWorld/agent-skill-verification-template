<#
.SYNOPSIS
  Start a single llama.cpp server for the live-model eval (npm run eval:llm).

.DESCRIPTION
  Resource-safe defaults, chosen so an eval run cannot exhaust the host:
    - ONE model instance (never start a second one for the eval),
    - --parallel 1        (the eval runner is strictly sequential anyway),
    - --ctx-size 8192     (eval prompts are short; a small context keeps the
                           KV cache small so VRAM is not exhausted),
    - bounded CPU threads.

  Nothing is hardcoded. Every setting comes from a parameter or an env var:
    LLM_SERVER_EXE   path to llama-server.exe      (required)
    LLM_MODEL_PATH   path to the .gguf model file  (required)
    LLM_PORT         listen port                   (default 8080)
    LLM_CTX_SIZE     context window                (default 8192)
    LLM_NGL          GPU layers to offload         (default 999 = all;
                     lower it if the GPU driver is unstable — weights spill
                     to system RAM, slower but safer)
    LLM_THREADS      CPU threads                   (default 8)

.EXAMPLE
  $env:LLM_SERVER_EXE = "D:\titan-llama\llama-server.exe"
  $env:LLM_MODEL_PATH = "D:\titan-models\gemma4-26b\gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"
  .\scripts\start-eval-llm.ps1
#>
param(
  [string]$ServerExe = $env:LLM_SERVER_EXE,
  [string]$ModelPath = $env:LLM_MODEL_PATH,
  [int]$Port     = $(if ($env:LLM_PORT)     { [int]$env:LLM_PORT }     else { 8080 }),
  [int]$CtxSize  = $(if ($env:LLM_CTX_SIZE) { [int]$env:LLM_CTX_SIZE } else { 8192 }),
  [int]$Ngl      = $(if ($env:LLM_NGL)      { [int]$env:LLM_NGL }      else { 999 }),
  [int]$Threads  = $(if ($env:LLM_THREADS)  { [int]$env:LLM_THREADS }  else { 8 })
)

$ErrorActionPreference = "Stop"

if (-not $ServerExe -or -not $ModelPath) {
  Write-Host "[ERROR] LLM_SERVER_EXE and LLM_MODEL_PATH must be set (env var or -ServerExe/-ModelPath)." -ForegroundColor Red
  Write-Host '  example:  $env:LLM_SERVER_EXE = "D:\titan-llama\llama-server.exe"'
  Write-Host '            $env:LLM_MODEL_PATH = "D:\titan-models\gemma4-26b\gemma-4-26B-A4B-it-UD-Q4_K_M.gguf"'
  exit 1
}
if (-not (Test-Path $ServerExe)) { Write-Host "[ERROR] llama-server not found: $ServerExe" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $ModelPath)) { Write-Host "[ERROR] model file not found: $ModelPath" -ForegroundColor Red; exit 1 }

# Already running? Reuse it instead of loading the model twice.
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "[OK] Port $Port is already listening (PID $($existing[0].OwningProcess)) - reusing that server." -ForegroundColor Yellow
  exit 0
}

# Resource guard: refuse to start when free RAM is critically low. (With full
# GPU offload the weights live in VRAM, but model load still streams through
# the page cache and partial offload spills weights into RAM.)
$os = Get-CimInstance Win32_OperatingSystem
$freeGb = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$modelGb = [math]::Round((Get-Item $ModelPath).Length / 1GB, 1)
Write-Host "[INFO] model: $modelGb GB | free RAM: $freeGb GB | ctx: $CtxSize | ngl: $Ngl | threads: $Threads"
if ($freeGb -lt 4) {
  Write-Host "[ERROR] Only $freeGb GB RAM free - refusing to start to protect the host. Close some applications first." -ForegroundColor Red
  exit 1
}
if ($freeGb -lt 8) {
  Write-Host "[WARN] Low free RAM ($freeGb GB). If the system becomes unresponsive, lower LLM_NGL or use a smaller model." -ForegroundColor Yellow
}

$serverArgs = @(
  "-m", $ModelPath,
  "--host", "127.0.0.1",       # local only - never exposed to the network for an eval
  "--port", "$Port",
  "--ctx-size", "$CtxSize",
  "-ngl", "$Ngl",
  "--parallel", "1",           # the eval sends one request at a time
  "--threads", "$Threads"
)
Write-Host "[1/2] Starting llama-server on http://127.0.0.1:$Port ..."
$proc = Start-Process -FilePath $ServerExe -ArgumentList $serverArgs -WindowStyle Minimized -PassThru
Write-Host "      PID: $($proc.Id)"

# Wait until /health reports ready (model load can take a while on first start).
Write-Host "[2/2] Waiting for the model to load" -NoNewline
$deadline = (Get-Date).AddSeconds(180)
$ready = $false
while ((Get-Date) -lt $deadline) {
  if ($proc.HasExited) {
    Write-Host ""
    Write-Host "[ERROR] llama-server exited with code $($proc.ExitCode) during startup." -ForegroundColor Red
    exit 1
  }
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2
    if ($health.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Write-Host "." -NoNewline
  Start-Sleep -Seconds 2
}
Write-Host ""

if ($ready) {
  Write-Host "[OK] llama-server ready at http://127.0.0.1:$Port/v1" -ForegroundColor Green
  Write-Host "     run the eval:   npm run eval:llm"
  Write-Host "     stop the server: .\scripts\stop-eval-llm.ps1"
} else {
  Write-Host "[ERROR] Server did not become healthy within 180 s. Check the llama-server window for errors." -ForegroundColor Red
  exit 1
}
