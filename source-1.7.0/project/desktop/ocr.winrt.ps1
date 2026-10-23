$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$stream = $null
$writer = $null
$bitmap = $null
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.DataWriter, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType=WindowsRuntime]
    $awaitMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await-WinRt($operation, [Type]$resultType) {
        $task = $awaitMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
        return $task.GetAwaiter().GetResult()
    }
    $source = [Console]::In.ReadToEnd()
    if ($source.Length -gt 3000000) { throw 'OCR_IMAGE_LIMIT' }
    $value = $source | ConvertFrom-Json
    if ($value.version -ne 1 -or $value.op -notin @('probe','recognize')) { throw 'OCR_INPUT_INVALID' }
    $names = @($value.PSObject.Properties.Name)
    if (@($names | Where-Object { $_ -notin @('version','op','mime','sha256','bodyBase64') }).Count) { throw 'OCR_INPUT_INVALID' }
    $language = New-Object Windows.Globalization.Language('zh-Hans-CN')
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    if ($null -eq $engine) { throw 'OCR_LANGUAGE_UNAVAILABLE' }
    if ($value.op -eq 'probe') {
        if ($names.Count -ne 2) { throw 'OCR_INPUT_INVALID' }
        $result = [ordered]@{available=$true;engine='windows.media.ocr';language=$engine.RecognizerLanguage.LanguageTag;maxDimension=[Windows.Media.Ocr.OcrEngine]::MaxImageDimension;osBuild=[Environment]::OSVersion.Version.ToString()}
    } else {
        if ($value.mime -notin @('image/png','image/jpeg') -or $value.sha256 -notmatch '^[a-f0-9]{64}$' -or $value.bodyBase64.Length -gt 2796204) { throw 'OCR_IMAGE_INVALID' }
        $bytes = [Convert]::FromBase64String($value.bodyBase64)
        if (!$bytes.Length -or $bytes.Length -gt 2097152) { throw 'OCR_IMAGE_LIMIT' }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $digest = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($digest -ne $value.sha256) { throw 'OCR_IMAGE_CHANGED' }
        $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
        $writer = New-Object Windows.Storage.Streams.DataWriter($stream)
        $writer.WriteBytes($bytes)
        $null = Await-WinRt ($writer.StoreAsync()) ([uint32])
        $null = $writer.DetachStream()
        $stream.Seek(0)
        $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        if ($decoder.FrameCount -ne 1 -or $decoder.PixelWidth -gt 10000 -or $decoder.PixelHeight -gt 10000 -or [long]$decoder.PixelWidth * $decoder.PixelHeight -gt 16000000) { throw 'OCR_IMAGE_LIMIT' }
        $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $recognized = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $lines = @()
        $wordCount = 0
        foreach ($line in $recognized.Lines) {
            $words = @()
            foreach ($word in $line.Words) {
                $wordCount++
                if ($wordCount -gt 2000) { throw 'OCR_RESULT_LIMIT' }
                $box = $word.BoundingRect
                $words += [ordered]@{text=$word.Text;x=[double]$box.X;y=[double]$box.Y;width=[double]$box.Width;height=[double]$box.Height}
            }
            $lines += [ordered]@{text=$line.Text;words=@($words)}
        }
        if ($recognized.Text.Length -gt 200000 -or $lines.Count -gt 1000) { throw 'OCR_RESULT_LIMIT' }
        $angle = $null
        if ($null -ne $recognized.TextAngle) { $angle = [double]$recognized.TextAngle }
        $result = [ordered]@{version=1;engine='windows.media.ocr';language=$engine.RecognizerLanguage.LanguageTag;osBuild=[Environment]::OSVersion.Version.ToString();width=$bitmap.PixelWidth;height=$bitmap.PixelHeight;text=$recognized.Text;angle=$angle;lines=@($lines)}
    }
    $json = $result | ConvertTo-Json -Depth 8 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1048576) { throw 'OCR_RESULT_LIMIT' }
    [Console]::Out.Write($json)
} catch {
    $message = $_.Exception.Message
    if ($message -notmatch 'OCR_[A-Z_]+') { $message = 'OCR_WINRT_FAILED' }
    [Console]::Error.Write($message.Substring(0,[Math]::Min(800,$message.Length)))
    exit 1
} finally {
    foreach ($item in @($bitmap,$writer,$stream)) { if ($null -ne $item) { try { $item.Dispose() } catch {} } }
}
