Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "C:\Users\kiber\Desktop\ai-drama-studio\artifacts\ai-drama-studio-source.zip"
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

$sensitive = $zip.Entries | Where-Object { $_.FullName -match '\.env$|node_modules|\.next|\.git/|output/|tmp/|tsbuildinfo' }
if ($sensitive) {
    Write-Output "WARNING: Sensitive files found in zip:"
    $sensitive | ForEach-Object { Write-Output "  $($_.FullName)" }
} else {
    Write-Output "OK: No sensitive files found in zip"
}

$hasEnvExample = $zip.Entries | Where-Object { $_.FullName -match '\.env\.example' }
if ($hasEnvExample) { Write-Output "OK: .env.example is included" }

$hasKokoro = $zip.Entries | Where-Object { $_.FullName -match 'kokoro' }
if ($hasKokoro) { Write-Output "OK: Kokoro files included ($(@($hasKokoro).Count) entries)" }

$hasAudioApi = $zip.Entries | Where-Object { $_.FullName -match 'audio' }
if ($hasAudioApi) { Write-Output "OK: Audio API files included ($(@($hasAudioApi).Count) entries)" }

Write-Output "Total entries: $($zip.Entries.Count)"
$zip.Dispose()