"""GPT-SoVITS api_v2 서버의 /tts 엔드포인트(제로샷 보이스 클로닝)를 호출하는 클라이언트."""
from __future__ import annotations

import re
from pathlib import Path

import requests


class TTSError(RuntimeError):
    pass


# GPT-SoVITS의 한국어 텍스트 전처리기는 이모지나 일부 기호(✓, 일본어 나카구로 등)를 만나면
# 문장 전체가 빈 문자열로 처리되면서 내부 예외("tts failed")를 던진다. 이는 엔진 자체의
# 문제라 우리 쪽에서 고칠 수 없으므로, 합성 전에 안전하게 확인된 문자만 남기고 걸러낸다.
# (한글 음절/자모, 영문·숫자, 공백, 기본 문장부호만 허용)
_UNSUPPORTED_CHARS_PATTERN = re.compile(
    r"[^가-힣ᄀ-ᇿ㄰-㆏a-zA-Z0-9\s.,!?~\-()\"'…·]"
)


def sanitize_text_for_tts(text: str) -> str:
    cleaned = _UNSUPPORTED_CHARS_PATTERN.sub("", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


class TTSClient:
    def __init__(self, base_url: str = "http://127.0.0.1:9871"):
        self.base_url = base_url.rstrip("/")

    def synthesize(
        self,
        text: str,
        ref_audio_path,
        prompt_text: str,
        aux_ref_audio_paths: list[str] | None = None,
        text_lang: str = "ko",
        prompt_lang: str = "ko",
        timeout: float = 180.0,
    ) -> bytes:
        text = sanitize_text_for_tts(text)
        if not text:
            raise TTSError("이모지나 특수문자를 제외하면 합성할 내용이 남지 않습니다. 문장에 일반 텍스트를 포함해주세요.")
        prompt_text = sanitize_text_for_tts(prompt_text)

        payload = {
            "text": text,
            "text_lang": text_lang,
            "ref_audio_path": str(ref_audio_path),
            "aux_ref_audio_paths": aux_ref_audio_paths or [],
            "prompt_text": prompt_text,
            "prompt_lang": prompt_lang,
            "media_type": "wav",
            "streaming_mode": False,
        }
        try:
            resp = requests.post(f"{self.base_url}/tts", json=payload, timeout=timeout)
        except requests.exceptions.RequestException as exc:
            raise TTSError(f"엔진 서버에 연결할 수 없습니다: {exc}") from exc

        if resp.status_code != 200:
            message = resp.text
            try:
                body = resp.json()
                message = body.get("message", message)
                # GPT-SoVITS는 합성 중 어떤 예외가 나든 "tts failed"로 뭉뚱그리고,
                # 실제 원인은 "Exception" 필드에 따로 담아 보낸다. 이걸 놓치면
                # 사용자에게 "tts failed"라는 의미 없는 메시지만 보이게 된다.
                if body.get("Exception"):
                    message = f"{message} — {body['Exception']}"
            except ValueError:
                pass
            raise TTSError(f"음성 합성 실패({resp.status_code}): {message}")

        return resp.content
