"""GPT-SoVITS api_v2 서버(engine/gpt-sovits/v2pro)를 서브프로세스로 기동/관리한다.

웹 서버(FastAPI) 프로세스 안에서 백그라운드 스레드로 관리하므로 Qt 등 GUI 프레임워크에
의존하지 않는다.
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Optional

import requests


class EngineManager:
    def __init__(self, engine_dir: Path, host: str = "127.0.0.1", port: int = 9871):
        self.engine_dir = Path(engine_dir)
        self.host = host
        self.port = port
        self.base_url = f"http://{host}:{port}"

        self._process: Optional[subprocess.Popen] = None
        self._log: deque[str] = deque(maxlen=500)
        self._ready = False
        self._failed_message: Optional[str] = None
        self._lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def failed_message(self) -> Optional[str]:
        return self._failed_message

    def log_lines(self) -> list[str]:
        return list(self._log)

    def start(self) -> None:
        with self._lock:
            if self._process is not None:
                return

            python_exe = self.engine_dir / "runtime" / "python.exe"
            api_script = self.engine_dir / "api_v2.py"
            if not python_exe.exists() or not api_script.exists():
                self._failed_message = f"엔진 파일을 찾을 수 없습니다: {python_exe}"
                self._log.append(self._failed_message)
                return

            # 엔진의 공식 실행 스크립트(api.bat)는 PYTHONUTF8/PYTHONIOENCODING을 강제로
            # utf-8로 맞춘 뒤에 실행한다. 이걸 빠뜨리면 한국어 Windows에서는 자식 프로세스가
            # 콘솔 기본 코드페이지(cp949)로 stdout을 쓰게 되고, 우리는 그걸 utf-8로 잘못
            # 해석해서 작업 로그의 한글이 깨져 보이게 된다.
            child_env = os.environ.copy()
            child_env["PYTHONUTF8"] = "1"
            child_env["PYTHONIOENCODING"] = "utf-8"
            child_env["PYTHONLEGACYWINDOWSSTDIO"] = "utf-8"

            self._process = subprocess.Popen(
                [str(python_exe), str(api_script), "-p", str(self.port), "-a", self.host],
                cwd=str(self.engine_dir),
                env=child_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )

        threading.Thread(target=self._read_output, daemon=True).start()
        threading.Thread(target=self._poll_ready, daemon=True).start()

    def _read_output(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return
        for line in process.stdout:
            line = line.rstrip()
            if line:
                self._log.append(line)
        exit_code = process.wait()
        if exit_code != 0 and not self._ready:
            self._failed_message = f"엔진 프로세스가 코드 {exit_code}로 종료되었습니다."
            self._log.append(self._failed_message)
        elif exit_code != 0:
            self._log.append(f"[엔진 종료] 코드 {exit_code}")

    def _poll_ready(self) -> None:
        attempts = 0
        max_attempts = 240  # 1.5초 * 240 = 6분. 첫 기동 시 모델 로딩 시간을 감안한 넉넉한 제한
        while attempts < max_attempts and not self._ready:
            attempts += 1
            try:
                # 상태 코드와 무관하게 응답이 왔다는 것 자체가 모델 로딩이 끝나고
                # 서버가 요청을 받을 준비가 됐다는 뜻이다 (api_v2.py는 임포트 시점에
                # 모델을 미리 올린 뒤에야 포트를 연다).
                requests.get(self.base_url + "/tts", timeout=1.0)
                self._ready = True
                self._log.append("[엔진] 준비 완료. 음성 합성을 사용할 수 있습니다.")
                return
            except requests.exceptions.RequestException:
                time.sleep(1.5)
        if not self._ready:
            self._failed_message = "엔진이 제한 시간 내에 기동되지 않았습니다. 로그를 확인하세요."
            self._log.append(self._failed_message)

    def stop(self) -> None:
        with self._lock:
            process = self._process
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            self._process = None
