"""CharacterVoiceStudio 진입점: 이 PC에서만 쓰는 로컬 웹 서버를 띄우고,
브라우저 탭이 아니라 주소창/탭이 없는 '앱 창' 형태로 화면을 연다.
"""
from __future__ import annotations

import shutil
import subprocess
import threading
import time
import webbrowser
import winreg
from pathlib import Path

import uvicorn

from paths import project_root
from web_server import app

HOST = "127.0.0.1"
PORT = 8877


def _find_edge_path() -> str | None:
    """설치된 Microsoft Edge 실행 파일 경로를 찾는다. Windows에는 기본 내장되어 있다."""
    which = shutil.which("msedge")
    if which:
        return which

    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
        ) as key:
            path, _ = winreg.QueryValueEx(key, None)
            if path and Path(path).exists():
                return path
    except OSError:
        pass

    for candidate in (
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ):
        if Path(candidate).exists():
            return candidate
    return None


def _open_app_window(url: str) -> None:
    """가능하면 Edge '앱 모드'로 열어 주소창·탭 없는 프로그램 창처럼 보이게 하고,
    Edge를 찾을 수 없으면 일반 브라우저 탭으로라도 연다."""
    edge_path = _find_edge_path()
    if edge_path:
        profile_dir = project_root() / "data" / "app_window_profile"
        profile_dir.mkdir(parents=True, exist_ok=True)
        subprocess.Popen([
            edge_path,
            f"--app={url}",
            f"--user-data-dir={profile_dir}",
            "--window-size=1280,840",
        ])
    else:
        webbrowser.open(url)


def _open_when_ready() -> None:
    import requests

    url = f"http://127.0.0.1:{PORT}/"
    for _ in range(60):
        try:
            requests.get(url, timeout=1)
            break
        except requests.exceptions.RequestException:
            time.sleep(0.5)
    _open_app_window(url)


def main() -> None:
    print("=" * 60)
    print(" CharacterVoiceStudio 시작 중입니다...")
    print(" (이 콘솔 창을 닫으면 프로그램이 완전히 종료됩니다)")
    print("=" * 60)

    threading.Thread(target=_open_when_ready, daemon=True).start()

    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
