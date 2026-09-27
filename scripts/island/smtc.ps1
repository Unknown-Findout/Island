# Windows media bridge for the island.
#
# Reads and drives the OS media session (System Media Transport Controls), so
# Spotify, a browser tab or any other player that shows up in the Windows
# volume flyout shows up here too. Runs as one long-lived process: the Node
# server writes one command per line on stdin and reads one JSON line back.
#
#   get                      -> now-playing JSON, or {"none":true}
#   toggle|play|pause|next|previous
#   seek <seconds>
#
# Windows PowerShell 5.1 only: pwsh 7 dropped the WinRT projection this uses.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($op, [Type]$type) {
    $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = Await ($mgrType::RequestAsync()) $mgrType

# Album art is re-encoded only when the track changes; every other poll reuses it.
$artKey = ''
$artData = $null

function Pick-Session {
    # Spotify first when it has a session, otherwise whatever Windows calls current.
    foreach ($s in $manager.GetSessions()) {
        if ($s.SourceAppUserModelId -like '*Spotify*') { return $s }
    }
    return $manager.GetCurrentSession()
}

[void][Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
# PowerShell 5.1 hands the thumbnail stream back as a bare __ComObject: its
# Size is blank and GetInputStreamAt "does not exist", and overload matching
# refuses it for AsStreamForRead. Calling the converter through reflection skips
# that matching, and the object does implement IInputStream underneath.
$toNetStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

function Read-Art($thumb) {
    if ($null -eq $thumb) { return $null }
    $stream = Await ($thumb.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = $toNetStream.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $net.Dispose()
    $bytes = $ms.ToArray()
    if ($bytes.Length -eq 0) { return $null }
    # The content type is blank for the same reason as Size; read the magic bytes.
    $mime = if ($bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) { 'image/png' } else { 'image/jpeg' }
    return "data:$mime;base64," + [Convert]::ToBase64String($bytes)
}

function Get-NowPlaying {
    $s = Pick-Session
    if ($null -eq $s) { return @{ none = $true } }
    $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
    $t = $s.GetTimelineProperties()
    $info = $s.GetPlaybackInfo()
    $ctl = $info.Controls

    $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
    if ($key -ne $script:artKey) {
        $script:artKey = $key
        try { $script:artData = Read-Art $p.Thumbnail } catch { $script:artData = $null }
    }

    $status = switch ([int]$info.PlaybackStatus) { 4 { 'playing' } 5 { 'paused' } default { 'stopped' } }
    $app = $s.SourceAppUserModelId
    $source = if ($app -like '*Spotify*') { 'spotify' } else { $app }

    return @{
        source    = $source
        title     = $p.Title
        artist    = $p.Artist
        album     = $p.AlbumTitle
        artUrl    = $script:artData
        status    = $status
        # Windows reports the position as of LastUpdatedTime, not as of now.
        # Sending both lets the client extrapolate instead of trusting a stale value.
        position  = $t.Position.TotalSeconds
        duration  = ($t.EndTime - $t.StartTime).TotalSeconds
        # LastUpdatedTime is already a DateTimeOffset; wrapping it in ::new() throws.
        sampledAt = $t.LastUpdatedTime.ToUnixTimeMilliseconds()
        canNext   = $ctl.IsNextEnabled
        canPrev   = $ctl.IsPreviousEnabled
        canSeek   = $ctl.IsPlaybackPositionEnabled
    }
}

function Invoke-Action($cmd, $arg) {
    $s = Pick-Session
    if ($null -eq $s) { return @{ ok = $false; error = 'no media session' } }
    $op = switch ($cmd) {
        'toggle'   { $s.TryTogglePlayPauseAsync() }
        'play'     { $s.TryPlayAsync() }
        'pause'    { $s.TryPauseAsync() }
        'next'     { $s.TrySkipNextAsync() }
        'previous' { $s.TrySkipPreviousAsync() }
        'seek'     { $s.TryChangePlaybackPositionAsync([long]([double]$arg * 10000000)) }
    }
    $ok = Await $op ([bool])
    return @{ ok = $ok }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $parts = $line.Trim().Split(' ', 2)
    $cmd = $parts[0]
    try {
        if ($cmd -eq 'get') { $out = Get-NowPlaying }
        elseif ($cmd -in 'toggle', 'play', 'pause', 'next', 'previous', 'seek') {
            $out = Invoke-Action $cmd ($(if ($parts.Count -gt 1) { $parts[1] } else { '' }))
        }
        elseif ($cmd -eq 'quit') { break }
        else { $out = @{ ok = $false; error = "unknown command: $cmd" } }
    } catch {
        $out = @{ ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 3))
    [Console]::Out.Flush()
}
