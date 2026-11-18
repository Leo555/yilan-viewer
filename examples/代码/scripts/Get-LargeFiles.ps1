#Requires -Version 7
<#
.SYNOPSIS
  列出指定目录中占用空间最大的文件
.EXAMPLE
  ./Get-LargeFiles.ps1 -Path ~/Downloads -Top 10
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateScript({ Test-Path $_ -PathType Container })]
    [string]$Path,

    [int]$Top = 20,
    [string[]]$Exclude = @('node_modules', '.git')
)

function Format-Size([long]$Bytes) {
    switch ($Bytes) {
        { $_ -ge 1GB } { '{0:N2} GB' -f ($_ / 1GB); break }
        { $_ -ge 1MB } { '{0:N2} MB' -f ($_ / 1MB); break }
        default        { '{0:N0} KB' -f ($_ / 1KB) }
    }
}

$files = Get-ChildItem -Path $Path -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $p = $_.FullName; -not ($Exclude | Where-Object { $p -match [regex]::Escape($_) }) } |
    Sort-Object Length -Descending |
    Select-Object -First $Top

$files | ForEach-Object {
    [pscustomobject]@{
        Size     = Format-Size $_.Length
        Modified = $_.LastWriteTime.ToString('yyyy-MM-dd')
        Name     = $_.FullName.Replace((Resolve-Path $Path).Path, '.')
    }
} | Format-Table -AutoSize

Write-Host "共 $($files.Count) 个文件，合计 $(Format-Size ($files | Measure-Object Length -Sum).Sum)" -ForegroundColor Cyan
