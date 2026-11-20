param([string]$Dir)
# Narration for each beat with the built-in Windows voice (Zira), one WAV per beat.
Add-Type -AssemblyName System.Speech
$beats = Get-Content (Join-Path $Dir 'beats.json') -Raw | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Zira Desktop')
$s.Rate = 0
$i = 0
foreach ($b in $beats) {
  $i++
  $wav = Join-Path $Dir ('say-{0:D2}.wav' -f $i)
  $s.SetOutputToWaveFile($wav)
  $s.Speak($b.say)
}
$s.SetOutputToNull()
"wrote $i files"
