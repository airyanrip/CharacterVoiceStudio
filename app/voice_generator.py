"""페르소나 텍스트만으로 임시 목소리 레퍼런스를 만들어낸다.

실제 사람 음성을 아직 구하지 못했을 때, Windows에 내장된 SAPI(System.Speech) 한국어
음성을 빌려 짧은 시드 문장을 합성하고, 그 결과를 GPT-SoVITS 제로샷 클로닝의 "레퍼런스
음성"으로 쓴다. 진짜 목소리를 만들어내는 것이 아니라 시작점(placeholder)일 뿐이므로,
저장되는 레퍼런스에는 항상 source="ai_placeholder" 표시를 남겨 화면에서 구분할 수 있게 한다.

한국어 SAPI 음성이 하나뿐이라(보통 여성 음성인 Microsoft Heami) 성별까지 바꿔주지는
못하고, 페르소나 텍스트에서 대략의 성격(활발함/차분함)만 읽어 말하기 속도·음높이를
조정한다.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

SEED_SENTENCE = "안녕하세요. 오늘 하루도 좋은 일들이 가득하길 바라요."

_ENERGETIC_WORDS = ("발랄", "씩씩", "장난기", "활발", "명랑", "귀여운", "쾌활", "밝은", "어린", "장난")
_CALM_WORDS = ("차분", "냉정", "위엄", "진지", "성숙", "우아", "무거운", "무뚝뚝", "낮은", "조용", "냉철")


class VoiceGenerationError(RuntimeError):
    pass


def _infer_prosody(text: str) -> tuple[str, str]:
    """페르소나 텍스트에서 대략의 rate/pitch 조정값을 추정한다."""
    energetic = sum(text.count(w) for w in _ENERGETIC_WORDS)
    calm = sum(text.count(w) for w in _CALM_WORDS)
    if energetic > calm:
        return "+15%", "+8%"
    if calm > energetic:
        return "-15%", "-8%"
    return "+0%", "+0%"


def generate_placeholder_voice(persona_text: str, out_path: Path, timeout: float = 30.0) -> str:
    """out_path에 임시 목소리 WAV를 만들고, 그 음성이 실제로 말한 대본(prompt_text)을 반환한다."""
    rate, pitch = _infer_prosody(persona_text or "")
    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">'
        f'<prosody rate="{rate}" pitch="{pitch}">{SEED_SENTENCE}</prosody>'
        "</speak>"
    )

    script = f"""Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object {{ $_.VoiceInfo.Culture.Name -eq "ko-KR" }} | Select-Object -First 1
if ($voice) {{ $synth.SelectVoice($voice.VoiceInfo.Name) }}
$synth.SetOutputToWaveFile("{out_path}")
$synth.SpeakSsml(@'
{ssml}
'@)
$synth.Dispose()
"""

    # 파일로 스크립트를 넘겨야 명령줄 인자 인코딩/따옴표 문제를 피할 수 있다.
    with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8-sig") as f:
        f.write(script)
        script_path = Path(f.name)

    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script_path)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise VoiceGenerationError("임시 목소리 생성이 시간 초과되었습니다.") from exc
    finally:
        script_path.unlink(missing_ok=True)

    if result.returncode != 0 or not out_path.exists():
        raise VoiceGenerationError(f"임시 목소리 생성에 실패했습니다: {result.stderr.strip()[-500:]}")

    return SEED_SENTENCE
