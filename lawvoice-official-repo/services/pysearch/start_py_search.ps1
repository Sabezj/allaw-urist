param(
  [string]$PyDir = ".\pysearch_venv"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $PyDir)) {
  Write-Host "Creating venv at $PyDir"
  py -3 -m venv $PyDir
}

$venvActivate = Join-Path $PyDir "Scripts\Activate.ps1"
if (!(Test-Path $venvActivate)) {
  throw "Virtualenv not found: $venvActivate"
}

Write-Host "Activating venv..."
. $venvActivate

if (Test-Path .\requirements.txt) {
  Write-Host "Installing requirements..."
  pip install --upgrade pip
  pip install -r .\requirements.txt
}

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL is not set in environment. Please set it before running."
}

#$env:HOST = $Host
#$env:PORT = "$Port"

while ($true) {
  try {
    Write-Host "Starting uvicorn on http://127.0.0.1:5051"
    uvicorn main:app --host 127.0.0.1 --port 5051
  } catch {
    Write-Warning "Python search crashed: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 1
  Write-Host "Restarting..."
}