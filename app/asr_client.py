"""엔진(runtime\\python.exe)의 faster-whisper를 빌려 레퍼런스 음성의 대본을 자동 추출한다."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


class ASRError(RuntimeError):
    pass


class ASRClient:
    def __init__(self, engine_dir: Path):
        self.engine_dir = Path(engine_dir)
        self.python_exe = self.engine_dir / "runtime" / "python.exe"
        self.worker_script = Path(__file__).with_name("_asr_worker.py")

    def transcribe(self, wav_path: str, timeout: float = 120.0) -> str:
        if not self.python_exe.exists():
            raise ASRError(f"엔진 파이썬을 찾을 수 없습니다: {self.python_exe}")
        if not Path(wav_path).exists():
            raise ASRError(f"음성 파일을 찾을 수 없습니다: {wav_path}")

        # engine_manager와 동일한 이유(한국어 Windows의 cp949 기본 코드페이지)로,
        # 이 값을 안 넣으면 인식된 한글 대본이 깨져서 넘어올 수 있다.
        child_env = os.environ.copy()
        child_env["PYTHONUTF8"] = "1"
        child_env["PYTHONIOENCODING"] = "utf-8"
        child_env["PYTHONLEGACYWINDOWSSTDIO"] = "utf-8"

        try:
            result = subprocess.run(
                [str(self.python_exe), str(self.worker_script), str(wav_path)],
                cwd=str(self.engine_dir),
                env=child_env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise ASRError("대본 자동 추출이 시간 초과되었습니다.") from exc

        if result.returncode != 0:
            raise ASRError(f"대본 자동 추출 실패:\n{result.stderr.strip()[-2000:]}")

        last_line = ""
        for line in result.stdout.splitlines():
            line = line.strip()
            if line:
                last_line = line

        try:
            data = json.loads(last_line)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ASRError(f"대본 추출 결과를 해석할 수 없습니다: {result.stdout[-500:]}") from exc

        if "error" in data:
            raise ASRError(data["error"])

        return data.get("text", "")
