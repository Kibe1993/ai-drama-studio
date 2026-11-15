$ErrorActionPreference = "Stop"

$projectRoot = "C:\Users\kiber\Desktop\ai-drama-studio"
$stagingDir = "$env:TEMP\ai-drama-studio-staging"
$zipPath = "$projectRoot\artifacts\ai-drama-studio-source.zip"

if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

$excludeDirs = @(".agents", ".codeartsdoer", ".git", ".next", "node_modules", "output", "tmp", "storage")
$excludeFiles = @(".env", "tsconfig.tsbuildinfo", "next-env.d.ts", "ai-drama-studio-source.zip")

$robocopyArgs = @($projectRoot, $stagingDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP")
foreach ($d in $excludeDirs) { $robocopyArgs += "/XD"; $robocopyArgs += "$projectRoot\$d" }
foreach ($f in $excludeFiles) { $robocopyArgs += "/XF"; $robocopyArgs += $f }

Write-Host "Copying files to staging directory..."
& robocopy @robocopyArgs
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

Write-Host "Creating zip archive..."
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$stagingDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

Remove-Item $stagingDir -Recurse -Force

$size = (Get-Item $zipPath).Length / 1KB
Write-Host "Zip created: $zipPath ($([math]::Round($size)) KB)"