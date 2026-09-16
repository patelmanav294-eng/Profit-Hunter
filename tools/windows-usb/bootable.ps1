<#
    Multiple pendrives ko ek saath bootable banata hai (Ventoy ke through).

    Chalane ka tareeka - Admin PowerShell me ye ek line paste karo:

        irm https://raw.githubusercontent.com/patelmanav294-eng/Profit-Hunter/claude/chat-session-0c1q0i/tools/windows-usb/bootable.ps1 | iex

    Koi parameter nahi chahiye. Script khud ISO dhoondhta hai, khud USB drives
    detect karta hai. Tumhe sirf ISO ka number chunna hai aur ERASE type karna hai.

    Ek se zyada ISO chun sakte ho (Windows 10 + Windows 11 dono) - Ventoy
    dono ko ek hi pendrive par rakh leta hai aur boot par menu deta hai.

    Ventoy install drive ko POORA ERASE karta hai - isliye confirmation step
    jaan-bujh kar rakha hai. Galat drive chuni to data wapas nahi aayega.
    Jis drive par Ventoy pehle se hai use haath nahi lagaya jaata - us par
    sirf ISO copy hoti hai, isliye script dobara chalana safe hai.
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
$picked = @()

if (-not $isos) {
    Write-Host "  Koi .iso file nahi mili." -ForegroundColor Red
    Write-Host "  ISO ka poora path paste karo (Enter = cancel):" -ForegroundColor Yellow
    $manual = (Read-Host "  ").Trim('"').Trim()
    if (-not $manual -or -not (Test-Path -LiteralPath $manual -PathType Leaf)) {
        Write-Host "  Cancel." -ForegroundColor Yellow; return }
    $picked = @(Get-Item -LiteralPath $manual)
} elseif ($isos.Count -eq 1) {
    $picked = @($isos[0])
    Write-Host ("  Mili: {0}  ({1} GB)" -f $isos[0].FullName, [math]::Round($isos[0].Length/1GB,2)) -ForegroundColor Green
} else {
    for ($i = 0; $i -lt $isos.Count; $i++) {
        Write-Host ("  [{0}]  {1,6} GB   {2}" -f ($i+1), [math]::Round($isos[$i].Length/1GB,2), $isos[$i].FullName)
    }
    Write-Host ""
    Write-Host "  Ek se zyada chun sakte ho - Ventoy sab ko ek hi pendrive par rakh leta hai." -ForegroundColor DarkGray
    $ans = (Read-Host "  Kaunsi ISO? (jaise: 1  ya  1,2  ya  all)").Trim()
    if ($ans -eq 'all') { $picked = @($isos) }
    else {
        foreach ($tok in ($ans -split '[,\s]+' | Where-Object { $_ })) {
            $n = 0
            if ([int]::TryParse($tok, [ref]$n) -and $n -ge 1 -and $n -le $isos.Count) { $picked += $isos[$n-1] }
            else { Write-Host "  Galat number: $tok" -ForegroundColor Red; return }
        }
    }
    if (-not $picked) { Write-Host "  Kuch nahi chuna. Cancel." -ForegroundColor Yellow; return }
}
$picked = @($picked | Sort-Object FullName -Unique)
$isoGB = [math]::Round((($picked | Measure-Object Length -Sum).Sum) / 1GB, 2)

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
        HasVentoy = [bool]($vols | Where-Object { $_.FileSystemLabel -eq 'Ventoy' })
    }
}
if (-not $usb) { Write-Host "  Koi USB drive nahi mili. Pendrives lagi hain?" -ForegroundColor Red; return }

foreach ($d in $usb) {
    $tag = if ($d.Big) { "   <-- BADI DISK - external HDD ho sakti hai" }
           elseif ($d.HasVentoy) { "   Ventoy pehle se hai - erase nahi hoga" } else { "" }
    $c   = if ($d.Big) { "Yellow" } elseif ($d.HasVentoy) { "Green" } else { "White" }
    Write-Host ("  Disk {0}:  {1,-26} {2,7} GB   ({3}:){4}" -f `
        $d.Number, $d.Model, $d.SizeGB, $d.Letters, $tag) -ForegroundColor $c
}

$targets = $usb | Where-Object { $_.SizeGB -ge ($isoGB + 1) }
if (-not $targets) { Write-Host "`n  Kisi bhi drive me ISO ke liye jagah nahi." -ForegroundColor Red; return }

# ============ confirm ============
# Jin drives par Ventoy pehle se hai unhe chhedna nahi hai - unpar sirf ISO copy hogi.
$needInstall = @($targets | Where-Object { -not $_.HasVentoy })
$already     = @($targets | Where-Object { $_.HasVentoy })

Write-Host ""
Write-Host ("  ISO: " + (($picked | ForEach-Object { $_.Name }) -join ', ')) -ForegroundColor DarkGray
Write-Host ("  Total {0} GB" -f $isoGB) -ForegroundColor DarkGray

if ($already) {
    Head "Ye drives ready hain - sirf ISO copy hogi"
    $already | ForEach-Object {
        Write-Host ("  Disk {0}:  {1}  ({2} GB)" -f $_.Number, $_.Model, $_.SizeGB) -ForegroundColor Green }
}

if ($needInstall) {
    Head "Ye drives POORI ERASE hongi"
    $needInstall | ForEach-Object {
        Write-Host ("  Disk {0}:  {1}  ({2} GB)" -f $_.Number, $_.Model, $_.SizeGB) -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "  Upar ki list dhyan se padho. Erase ke baad data wapas NAHI aayega." -ForegroundColor Red
    Write-Host "  Sirf apni pendrives dikh rahi hain? Tab ERASE type karo:" -ForegroundColor Red
    if ((Read-Host "  ") -cne 'ERASE') { Write-Host "  Cancel - kuch nahi hua." -ForegroundColor Yellow; return }
} else {
    Write-Host ""
    Write-Host "  Sab drives par Ventoy pehle se hai - kuch erase nahi hoga, sirf copy." -ForegroundColor Green
    if ((Read-Host "  Aage badhein? (y/n)") -notin 'y','Y') {
        Write-Host "  Cancel." -ForegroundColor Yellow; return }
}

# ============ Ventoy ============
$work = Join-Path $env:TEMP "ventoy-auto"
$exe = $null
if ($needInstall) {
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
foreach ($t in $needInstall) {
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

if ($bad.Count -eq $needInstall.Count) {
    Write-Host ""
    Write-Host "  Ventoy CLI nahi chala (version ke saath flag badal jaata hai)." -ForegroundColor Yellow
    Write-Host "  Ye karo:" -ForegroundColor Yellow
    Write-Host "    1. Ye folder kholo: $work" -ForegroundColor Yellow
    Write-Host "    2. Ventoy2Disk.exe chalao, har pendrive select karke Install dabao" -ForegroundColor Yellow
    Write-Host "    3. Phir yahi line dobara paste karo - install skip ho jayega, sirf copy hogi" -ForegroundColor Yellow
    return
}
}  # end if ($needInstall)

# ============ copy, parallel ============
Head "ISO copy"
Start-Sleep 2
$want = @($targets | ForEach-Object { $_.Number })
$vols = @(Get-Volume | Where-Object { $_.FileSystemLabel -eq 'Ventoy' -and $_.DriveLetter } |
          Where-Object {
              # sirf wahi drives jo humne target ki thi - kisi aur Ventoy USB ko haath nahi lagana
              $dn = $null
              try { $dn = (Get-Partition -Volume $_ -ErrorAction Stop).DiskNumber } catch { }
              ($null -eq $dn) -or ($want -contains $dn)
          })
if (-not $vols) { Write-Host "  Koi Ventoy drive nahi mili." -ForegroundColor Red; return }

# har drive par sirf wahi ISO bhejni hai jo pehle se waisi ki waisi maujood nahi hai
$plan = @()
foreach ($v in $vols) {
    $L = $v.DriveLetter
    $todo = @($picked | Where-Object {
        $d = "${L}:\$($_.Name)"
        -not ((Test-Path -LiteralPath $d) -and ((Get-Item -LiteralPath $d).Length -eq $_.Length)) })
    $need = ($todo | Measure-Object Length -Sum).Sum
    if (-not $need) { $need = 0 }
    if ($need -gt $v.SizeRemaining) {
        Write-Host ("  {0}: jagah kam hai - {1} GB chahiye, {2} GB khali. Skip." -f `
            $L, [math]::Round($need/1GB,2), [math]::Round($v.SizeRemaining/1GB,2)) -ForegroundColor Yellow
        continue
    }
    $plan += [pscustomobject]@{ L = $L; Todo = $todo }
}
if (-not $plan) { Write-Host "  Kuch copy karne layak nahi bacha." -ForegroundColor Yellow; return }

$skipped = @($plan | Where-Object { $_.Todo.Count -eq 0 })
$work2   = @($plan | Where-Object { $_.Todo.Count -gt 0 })
foreach ($s in $skipped) {
    Write-Host ("  {0}: saari ISO pehle se hai - kuch copy nahi karna." -f $s.L) -ForegroundColor Green }

if ($work2) {
    Step ("Drives: " + (($work2 | ForEach-Object { "$($_.L):" }) -join ' '))
    Step ("{0} ISO, sab drives par ek saath - 5 se 20 minute. Terminal band mat karna.`n" -f $picked.Count)
}

$res = @()
if ($work2) {
    $jobs = foreach ($w in $work2) {
        Start-Job -ArgumentList $w.L, @($w.Todo | ForEach-Object { $_.FullName }) -ScriptBlock {
            param($L, $srcList)
            $out = @()
            foreach ($src in @($srcList)) {
                $name = Split-Path $src -Leaf
                $sw = [Diagnostics.Stopwatch]::StartNew()
                try {
                    Copy-Item -LiteralPath $src -Destination "${L}:\$name" -Force -ErrorAction Stop
                    $sw.Stop()
                    $out += [pscustomobject]@{ D=$L; N=$name; OK=$true
                                               Min=[math]::Round($sw.Elapsed.TotalMinutes,1)
                                               GB=[math]::Round((Get-Item -LiteralPath "${L}:\$name").Length/1GB,2)
                                               E=$null }
                } catch {
                    $sw.Stop()
                    $out += [pscustomobject]@{ D=$L; N=$name; OK=$false; Min=0; GB=0; E=$_.Exception.Message }
                }
            }
            $out
        }
    }
    $jobs = @($jobs)
    while (@($jobs | Where-Object State -eq 'Running').Count -gt 0) {
        Write-Host ("`r  {0}/{1} drive ho gayi..." -f `
            @($jobs | Where-Object State -ne 'Running').Count, $jobs.Count) -NoNewline
        Start-Sleep 3
    }
    Write-Host ("`r  {0}/{1} drive ho gayi.      " -f $jobs.Count, $jobs.Count)
    $res = @($jobs | Receive-Job); $jobs | Remove-Job
}

Head "Result"
$f = 0
foreach ($g in ($res | Group-Object D | Sort-Object Name)) {
    $okN = @($g.Group | Where-Object OK).Count
    $mins = ($g.Group | Measure-Object Min -Sum).Sum
    if ($okN -eq $g.Group.Count) {
        Write-Host ("  {0}:  OK   {1} ISO, {2} GB, {3} min" -f $g.Name, $okN,
            [math]::Round((($g.Group | Measure-Object GB -Sum).Sum),2), $mins) -ForegroundColor Green
    } else {
        $f++
        Write-Host ("  {0}:  {1}/{2} ISO copy hui" -f $g.Name, $okN, $g.Group.Count) -ForegroundColor Red
        $g.Group | Where-Object { -not $_.OK } | ForEach-Object {
            Write-Host ("        {0} - {1}" -f $_.N, $_.E) -ForegroundColor Red }
    }
}
foreach ($s in $skipped) {
    Write-Host ("  {0}:  OK   pehle se ready" -f $s.L) -ForegroundColor Green }
Write-Host ""
if ($f -eq 0) {
    Write-Host "  Ho gaya. Sab pendrives bootable hain." -ForegroundColor Green
    if ($picked.Count -gt 1) {
        Write-Host "  Boot karte waqt Ventoy menu me dono Windows dikhengi - jo chahiye wo chuno." -ForegroundColor DarkGray }
    Write-Host "  Safely eject karo, phir boot menu se USB chuno (Dell F12 / HP F9 / Lenovo F12)." -ForegroundColor DarkGray
} else {
    Write-Host "  $f drive par problem aayi. Wo nikaal ke dobara lagao, phir yahi line dobara chalao -" -ForegroundColor Yellow
    Write-Host "  jo ISO pehle se copy ho chuki hai wo skip ho jayegi." -ForegroundColor Yellow
}
Write-Host ""
