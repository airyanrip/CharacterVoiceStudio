"""앱 전역 설정(언어, 합성 속도, 미리듣기 볼륨, 캐시 정리 예약)을 저장/조회한다."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_SETTINGS: dict[str, Any] = {
    "language": "ko",  # ko, en, ja, zh
    "speed_factor": 1.0,  # 0.5~2.0, GPT-SoVITS의 speed_factor로 그대로 전달됨
    "preview_volume": 1.0,  # 0.0~1.0, 미리듣기/저장된 대사 재생 볼륨(프론트엔드에서만 사용)
    "reset_browser_cache_on_next_launch": False,
}

_ALLOWED_LANGUAGES = {"ko", "en", "ja", "zh"}


class SettingsStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return dict(DEFAULT_SETTINGS)
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            return dict(DEFAULT_SETTINGS)
        merged = dict(DEFAULT_SETTINGS)
        merged.update({k: v for k, v in data.items() if k in DEFAULT_SETTINGS})
        return merged

    def save(self, updates: dict[str, Any]) -> dict[str, Any]:
        current = self.load()

        if "language" in updates:
            lang = updates["language"]
            if lang not in _ALLOWED_LANGUAGES:
                raise ValueError(f"지원하지 않는 언어입니다: {lang}")
            current["language"] = lang

        if "speed_factor" in updates:
            speed = float(updates["speed_factor"])
            current["speed_factor"] = max(0.5, min(2.0, speed))

        if "preview_volume" in updates:
            volume = float(updates["preview_volume"])
            current["preview_volume"] = max(0.0, min(1.0, volume))

        if "reset_browser_cache_on_next_launch" in updates:
            current["reset_browser_cache_on_next_launch"] = bool(updates["reset_browser_cache_on_next_launch"])

        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(current, f, ensure_ascii=False, indent=2)
        return current
