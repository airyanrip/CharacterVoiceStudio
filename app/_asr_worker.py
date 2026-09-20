"""engine의 runtime\\python.exe로 실행되는 보조 스크립트.

faster-whisper로 wav 파일 하나를 전사해서 결과를 JSON 한 줄로 stdout에 출력한다.
이 파일은 앱(app/) 쪽 파이썬이 아니라 engine 쪽 파이썬(runtime\\python.exe)으로
서브프로세스 실행되므로, engine에 이미 설치된 faster_whisper를 그대로 사용한다.
"""
from __future__ import annotations

import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "wav 경로가 필요합니다."}, ensure_ascii=False))
        sys.exit(1)

    wav_path = sys.argv[1]

    from faster_whisper import WhisperModel

    try:
        model = WhisperModel("small", device="cuda", compute_type="float16")
    except Exception:
        model = WhisperModel("small", device="cpu", compute_type="int8")

    segments, _info = model.transcribe(wav_path, language="ko")
    text = "".join(segment.text for segment in segments).strip()
    print(json.dumps({"text": text}, ensure_ascii=False))


if __name__ == "__main__":
    main()
