<#
.SYNOPSIS
  Stop the llama.cpp server started by start-eval-llm.ps1.

.DESCRIPTION
  Finds the process listening on the eval port (LLM_PORT, default 8080) and
  stops it — but only if it actually is a llama-server process, so a port
  collision can never kill an unrelated application.
#>
param(
  [int]$Port = $(if ($env:LLM_PORT) { [int]$env:LLM_PORT } else { 8080 })
)

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conn) {
  Write-Host "[OK] Nothing is listening on port $Port."
  exit 0
}

$ownerPid = $conn[0].OwningProcess
$proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
if (-not $proc) {
  Write-Host "[OK] Listener on port $Port is already gone."
  exit 0
}

if ($proc.Name -notlike "*llama*") {
  Write-Host "[WARN] Port $Port is owned by '$($proc.Name)' (PID $ownerPid), which does not look like llama-server. Refusing to stop it." -ForegroundColor Yellow
  exit 1
}

Write-Host "Stopping $($proc.Name) (PID $ownerPid) on port $Port ..."
Stop-Process -Id $ownerPid -Force -Confirm:$false
Write-Host "[OK] Stopped." -ForegroundColor Green
