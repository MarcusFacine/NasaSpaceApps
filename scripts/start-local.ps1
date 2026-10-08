$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$serverPath = Join-Path $projectPath 'scripts\serve-local.mjs'
$healthUrl = 'http://127.0.0.1:4173/__local_health'
$existingListeners = @(Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue)

if ($existingListeners.Count -gt 0) {
    try { $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3 } catch { $health = $null }
    $owner = if ($health) { Get-CimInstance Win32_Process -Filter "ProcessId=$($health.pid)" } else { $null }
    $owned = $health -and $health.app -eq 'lunar-horizon-local' -and
        $health.root -eq (Join-Path $projectPath 'dist') -and $owner -and
        $owner.CommandLine.Contains('"' + $serverPath + '"') -and
        (@($existingListeners | Where-Object { $_.OwningProcess -ne $health.pid }).Count -eq 0)
    if ($owned) {
        Write-Output "Lunar Horizon já está ativo: http://localhost:4173/ (PID $($health.pid))"
        exit 0
    }
    throw 'A porta 4173 está ocupada por outro processo. Nenhum processo foi encerrado.'
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
    Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw 'Node.js não encontrado. Instale Node.js ou abra este projeto no ambiente Codex com Node disponível.'
}

# WMI starts the process outside the temporary terminal job. No scheduled task,
# service, startup entry, public interface or global execution-policy change.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = '"' + $nodePath + '" "' + $serverPath + '"'
    CurrentDirectory = $projectPath
    ProcessStartupInformation = $startup
}
if ($result.ReturnValue -ne 0) { throw "Não foi possível iniciar o servidor (WMI $($result.ReturnValue))." }

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
        if ($health.app -eq 'lunar-horizon-local' -and $health.pid -eq $result.ProcessId) {
            Write-Output "Lunar Horizon ativo: http://localhost:4173/ (PID $($result.ProcessId))"
            Write-Output 'Servidor restrito a 127.0.0.1 e ::1. Continua ativo após fechar este comando.'
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 250
}
throw 'Servidor não respondeu. Consulte artifacts\localhost-server.log.'
