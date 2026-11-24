# Pavé installer for Windows. It only checks that Node.js is present, then hands over to
# scripts/install.mjs, which does the same work on every operating system.
#
#   .\install.ps1            install, build and check
#   .\install.ps1 --render   also install the photoreal renderer (about 1 GB)
#   .\install.ps1 --start    start Pavé afterwards
#
# If PowerShell refuses to run it, start it this way instead:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Pavé needs Node.js 22 or newer, and it is not installed.'
  Write-Host ''
  Write-Host 'Install it one of these ways, then run .\install.ps1 again:'
  Write-Host '  - the LTS installer from https://nodejs.org'
  Write-Host '  - winget:  winget install OpenJS.NodeJS.LTS'
  exit 1
}

node scripts/install.mjs @args
exit $LASTEXITCODE
