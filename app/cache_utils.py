"""임시 업로드 파일 정리, 데이터 폴더 용량 조회 등 캐시 관련 유틸리티."""
from __future__ import annotations

import shutil
from pathlib import Path


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def clear_temp_uploads(data_dir: Path) -> int:
    """data/_uploads 안의 남은 임시 업로드 파일을 지우고, 지운 바이트 수를 반환한다.

    정상적인 요청 처리 중에는 매번 자동으로 정리되지만, 중간에 오류·중단이 나면
    파일이 남을 수 있어 수동 정리 버튼으로 한 번 더 치울 수 있게 한다.
    """
    tmp_dir = data_dir / "_uploads"
    freed = _dir_size(tmp_dir)
    if tmp_dir.exists():
        for item in tmp_dir.iterdir():
            try:
                if item.is_file():
                    item.unlink()
                else:
                    shutil.rmtree(item, ignore_errors=True)
            except OSError:
                pass
    return freed


def cache_info(data_dir: Path) -> dict:
    """정리 가능한 캐시 종류별 크기(바이트)를 알려준다."""
    return {
        "temp_uploads_bytes": _dir_size(data_dir / "_uploads"),
        "browser_cache_bytes": _dir_size(data_dir / "app_window_profile"),
    }


def reset_browser_cache_now(data_dir: Path) -> bool:
    """앱 창(Edge 프로필) 캐시 폴더를 지운다. 브라우저가 그 폴더를 쓰고 있는 동안에는
    지울 수 없으므로(파일 잠김), 앱 시작 시 브라우저를 띄우기 전에만 호출해야 한다.
    성공하면 True, 폴더가 원래 없었으면 True, 잠겨서 실패하면 False를 반환한다.
    """
    profile_dir = data_dir / "app_window_profile"
    if not profile_dir.exists():
        return True
    try:
        shutil.rmtree(profile_dir)
        return True
    except OSError:
        return False
