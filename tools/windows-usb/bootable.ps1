<#
    Multiple pendrives ko ek saath bootable banata hai (Ventoy ke through).

    Chalane ka tareeka - Admin PowerShell me ye ek line paste karo:

        irm https://raw.githubusercontent.com/patelmanav294-eng/Profit-Hunter/claude/chat-session-0c1q0i/tools/windows-usb/bootable.ps1 | iex

    Koi parameter nahi chahiye. Script khud ISO dhoondhta hai, khud USB drives
    detect karta hai. Tumhe sirf ISO ka number chunna hai aur ERASE type karna hai.

    Ventoy install drive ko POORA ERASE karta hai - isliye confirmation step
    jaan-bujh kar rakha hai. Galat drive chuni to data wapas nahi aayega.
#>

$ErrorActionPreference = 'Stop'
function Head($t) { Write-Host ""; Write-Host $t -ForegroundColor Cyan
                    Write-Host ("=" * $t.Length) -ForegroundColor DarkCyan }
function Step($t) { Write-Host "  $t" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  Bootable USB Maker" -ForegroundColor White
Write-Host "  Kai pendrives ek saath, Ventoy ke through" -ForegroundColor DarkGray

# ============ admin check ============
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  Admin ke bina ye nahi chalega (disk operations ke liye chahiye)." -ForegroundColor Red
    Write-Host "  Start button par right-click -> 'Terminal (Admin)' -> phir ye line dobara paste karo." -ForegroundColor Yellow
    Write-Host ""
    return
}

# ============ ISO dhoondo ============
Head "ISO dhoondh raha hoon"
$found = New-Object System.Collections.Generic.List[object]

# pehle aam jagahein - ye fast hain
$quick = @(
    "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\Documents", "$env:PUBLIC\Downloads"
) | Where-Object { Test-Path $_ }

foreach ($p in $quick) {
    Get-ChildItem -LiteralPath $p -Filter *.iso -File -ErrorAction SilentlyContinue |
        ForEach-Object { $found.Add($_) }
}

# phir har fixed drive ki upar ki 2 layers
Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
  Where-Object { $_.Used -ne $null -and $_.Root -match '^[A-Z]:\\$' } | ForEach-Object {
    Get-ChildItem -LiteralPath $_.Root -Filter *.iso -File -Depth 2 -ErrorAction SilentlyContinue |
        ForEach-Object { $found.Add($_) }
}

$isos = $found | Sort-Object FullName -Unique | Sort-Object Length -Descending
if (-not $isos) {
    Write-Host "  Koi .iso file nahi mili." -ForegroundColor Red
    Write-Host "  ISO ka poora path yahan paste karo (ya sirf Enter dabao cancel ke liye):" -ForegroundColor Yellow
    $manual = (Read-Host "  ").Trim('"').Trim()
    if (-not $manual -or -not (Test-Path -LiteralPath $manual -PathType Leaf)) {
        Write-Host "  Cancel." -ForegroundColor Yellow; return }
    $iso = Get-Item -LiteralPath $manual
} elseif ($isos.Count -eq 1) {
    $iso = $isos[0]
    Write-Host ("  Mili: {0}  ({1} GB)" -f $iso.FullName, [math]::Round($iso.Length/1GB,2)) -ForegroundColor Green
} else {
    for ($i = 0; $i -lt $isos.Count; $i++) {
        Write-Host ("  [{0}]  {1,6} GB   {2}" -f ($i+1), [math]::Round($isos[$i].Length/1GB,2), $isos[$i].FullName)
    }
    Write-Host ""
    $pick = Read-Host "  Kaunsi ISO? number type karo"
    $n = 0
    if (-not [int]::TryParse($pick, [ref]$n) -or $n -lt 1 -or $n -gt $isos.Count) {
        Write-Host "  Galat number. Cancel." -ForegroundColor Yellow; return }
    $iso = $isos[$n - 1]
}
$isoGB = [math]::Round($iso.Length / 1GB, 2)

# ============ USB detect ============
Head "USB drives"
$usb = Get-Disk | Where-Object { $_.BusType -eq 'USB' } | ForEach-Object {
    $sz = [math]::Round($_.Size/1GB, 2)
    $vols = Get-Partition -DiskNumber $_.Number -ErrorAction SilentlyContinue |
            Get-Volume -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Number = $_.Number; Model = $_.FriendlyName; SizeGB = $sz
        Letters = ($vols | Where-Object DriveLetter | ForEach-Object { $_.DriveLetter }) -join ','
        Big = ($sz -gt 256)
    }
}
if (-not $usb) { Write-Host "  Koi USB drive nahi mili. Pendrives lagi hain?" -ForegroundColor Red; return }

foreach ($d in $usb) {
    $tag = if ($d.Big) { "   <-- BADI DISK - external HDD ho sakti hai" } else { "" }
    $c   = if ($d.Big) { "Yellow" } else { "White" }
    Write-Host ("  Disk {0}:  {1,-26} {2,7} GB   ({3}:){4}" -f `
        $d.Number, $d.Model, $d.SizeGB, $d.Letters, $tag) -ForegroundColor $c
}

$targets = $usb | Where-Object { $_.SizeGB -ge ($isoGB + 1) }
if (-not $targets) { Write-Host "`n  Kisi bhi drive me ISO ke liye jagah nahi." -ForegroundColor Red; return }

# ============ confirm ============
Head "Ye drives POORI ERASE hongi"
$targets | ForEach-Object {
    Write-Host ("  Disk {0}:  {1}  ({2} GB)" -f $_.Number, $_.Model, $_.SizeGB) -ForegroundColor Yellow }
Write-Host ""
Write-Host ("  ISO: {0}  ({1} GB)" -f $iso.Name, $isoGB) -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Upar ki list dhyan se padho. Erase ke baad data wapas NAHI aayega." -ForegroundColor Red
Write-Host "  Sirf apni pendrives dikh rahi hain? Tab ERASE type karo:" -ForegroundColor Red
if ((Read-Host "  ") -cne 'ERASE') { Write-Host "  Cancel - kuch nahi hua." -ForegroundColor Yellow; return }

# ============ Ventoy ============
$work = Join-Path $env:TEMP "ventoy-auto"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$exe = Get-ChildItem -Path $work -Recurse -Filter Ventoy2Disk.exe -ErrorAction SilentlyContinue |
       Select-Object -First 1 -ExpandProperty FullName

if (-not $exe) {
    Head "Ventoy download"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Step "Latest version check..."
    $rel = Invoke-RestMethod "https://api.github.com/repos/ventoy/Ventoy/releases/latest" `
                             -Headers @{ 'User-Agent' = 'bootable-usb' }
    $asset = $rel.assets | Where-Object name -like '*-windows.zip' | Select-Object -First 1
    if (-not $asset) { Write-Host "  Windows build nahi mila. ventoy.net se manually lo." -ForegroundColor Red; return }
    $zip = Join-Path $work $asset.name
    Step ("{0} ({1} MB)" -f $rel.tag_name, [math]::Round($asset.size/1MB,1))
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive -LiteralPath $zip -DestinationPath $work -Force
    $exe = Get-ChildItem -Path $work -Recurse -Filter Ventoy2Disk.exe |
           Select-Object -First 1 -ExpandProperty FullName
    if (-not $exe) { Write-Host "  Ventoy2Disk.exe nahi mila." -ForegroundColor Red; return }
}

Head "Ventoy install"
$bad = @()
foreach ($t in $targets) {
    $L = ($t.Letters -split ',')[0]
    if (-not $L) { Write-Host ("  Disk {0}: drive letter nahi - GUI chahiye" -f $t.Number) -ForegroundColor Yellow
                   $bad += $t; continue }
    Write-Host ("  Disk {0} ({1}:) ... " -f $t.Number, $L) -NoNewline
    try {
        $p = Start-Process $exe -ArgumentList @('VTOYCLI','/I',"/Drive:${L}:") -Wait -PassThru -NoNewWindow
        Start-Sleep 3
        $ok = Get-Volume -ErrorAction SilentlyContinue | Where-Object {
                $_.FileSystemLabel -eq 'Ventoy' -and
                (Get-Partition -Volume $_ -ErrorAction SilentlyContinue).DiskNumber -eq $t.Number }
        if ($ok) { Write-Host "OK" -ForegroundColor Green }
        else { Write-Host ("verify fail (exit {0})" -f $p.ExitCode) -ForegroundColor Yellow; $bad += $t }
    } catch { Write-Host "fail" -ForegroundColor Yellow; $bad += $t }
}

if ($bad.Count -eq $targets.Count) {
    Write-Host ""
    Write-Host "  Ventoy CLI nahi chala (version ke saath flag badal jaata hai)." -ForegroundColor Yellow
    Write-Host "  Ye karo:" -ForegroundColor Yellow
    Write-Host "    1. Ye folder kholo: $work" -ForegroundColor Yellow
    Write-Host "    2. Ventoy2Disk.exe chalao, har pendrive select karke Install dabao" -ForegroundColor Yellow
    Write-Host "    3. Phir yahi line dobara paste karo - install skip ho jayega, sirf copy hogi" -ForegroundColor Yellow
    return
}

# ============ copy, parallel ============
Head "ISO copy"
Start-Sleep 2
$vols = Get-Volume | Where-Object { $_.FileSystemLabel -eq 'Ventoy' -and $_.DriveLetter }
if (-not $vols) { Write-Host "  Koi Ventoy drive nahi mili." -ForegroundColor Red; return }
$letters = $vols | ForEach-Object { $_.DriveLetter }
Step ("Drives: " + (($letters | ForEach-Object { "${_}:" }) -join ' '))
Step "Sab par ek saath copy - 5 se 15 minute. Terminal band mat karna.`n"

$jobs = foreach ($L in $letters) {
    Start-Job -ArgumentList $iso.FullName, $L, $iso.Name -ScriptBlock {
        param($src, $L, $name)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        try {
            Copy-Item -LiteralPath $src -Destination "${L}:\$name" -Force -ErrorAction Stop
            $sw.Stop()
            [pscustomobject]@{ D=$L; OK=$true; Min=[math]::Round($sw.Elapsed.TotalMinutes,1)
                               GB=[math]::Round((Get-Item "${L}:\$name").Length/1GB,2); E=$null }
        } catch {
            $sw.Stop()
            [pscustomobject]@{ D=$L; OK=$false; Min=0; GB=0; E=$_.Exception.Message }
        }
    }
}
while ($jobs | Where-Object State -eq 'Running') {
    Write-Host ("`r  {0}/{1} ho gayi..." -f ($jobs|Where-Object State -ne 'Running').Count, $jobs.Count) -NoNewline
    Start-Sleep 3
}
Write-Host ("`r  {0}/{1} ho gayi.      " -f $jobs.Count, $jobs.Count)
$res = $jobs | Receive-Job; $jobs | Remove-Job

Head "Result"
$f = 0
foreach ($r in $res) {
    if ($r.OK) { Write-Host ("  {0}:  OK   {1} GB, {2} min" -f $r.D, $r.GB, $r.Min) -ForegroundColor Green }
    else { $f++; Write-Host ("  {0}:  FAIL - {1}" -f $r.D, $r.E) -ForegroundColor Red }
}
Write-Host ""
if ($f -eq 0) {
    Write-Host "  Ho gaya. Sab pendrives bootable hain." -ForegroundColor Green
    Write-Host "  Safely eject karo, phir boot menu se USB chuno (Dell F12 / HP F9 / Lenovo F12)." -ForegroundColor DarkGray
} else {
    Write-Host "  $f drive fail hui. Wo nikaal ke dobara lagao, phir yahi line dobara chalao." -ForegroundColor Yellow
}
Write-Host ""
