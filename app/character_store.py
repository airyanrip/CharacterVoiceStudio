"""캐릭터별 persona.json / 목소리 레퍼런스 / 대사(text+wav) 데이터를 관리한다."""
from __future__ import annotations

import csv
import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class CharacterStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    # ---- 캐릭터 목록/경로 ----
    def character_dir(self, name: str) -> Path:
        return self.root / name

    def list_characters(self) -> list[str]:
        if not self.root.exists():
            return []
        return sorted(
            p.name for p in self.root.iterdir()
            if p.is_dir() and (p / "persona.json").exists()
        )

    def exists(self, name: str) -> bool:
        return (self.character_dir(name) / "persona.json").exists()

    # ---- 캐릭터 생성/로드/저장/삭제 ----
    def create_character(self, name: str, persona: str = "", appearance: str = "", speech_style: str = "") -> dict:
        name = name.strip()
        if not name:
            raise ValueError("캐릭터 이름을 입력하세요.")
        char_dir = self.character_dir(name)
        if char_dir.exists():
            raise ValueError(f"이미 '{name}' 캐릭터가 존재합니다.")
        (char_dir / "voice_refs").mkdir(parents=True, exist_ok=True)
        (char_dir / "dialogues").mkdir(parents=True, exist_ok=True)
        data = {
            "name": name,
            "persona": persona,
            "appearance": appearance,
            "speech_style": speech_style,
            "voice_refs": [],
            "created_at": _now(),
            "updated_at": _now(),
        }
        self._write_persona(name, data)
        self._ensure_manifest(name)
        return data

    def load_character(self, name: str) -> dict:
        path = self.character_dir(name) / "persona.json"
        if not path.exists():
            raise FileNotFoundError(f"'{name}' 캐릭터를 찾을 수 없습니다.")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def save_character(self, name: str, data: dict) -> None:
        data["updated_at"] = _now()
        self._write_persona(name, data)

    def delete_character(self, name: str) -> None:
        char_dir = self.character_dir(name)
        if char_dir.exists():
            shutil.rmtree(char_dir)

    def _write_persona(self, name: str, data: dict) -> None:
        path = self.character_dir(name) / "persona.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # ---- 목소리 레퍼런스 ----
    def add_voice_ref(self, name: str, src_wav_path: str, prompt_text: str = "", lang: str = "ko") -> dict:
        data = self.load_character(name)
        voice_dir = self.character_dir(name) / "voice_refs"
        voice_dir.mkdir(parents=True, exist_ok=True)

        src = Path(src_wav_path)
        if not src.exists():
            raise FileNotFoundError(f"음성 파일을 찾을 수 없습니다: {src_wav_path}")

        dest_name = f"{uuid.uuid4().hex[:8]}_{src.name}"
        dest = voice_dir / dest_name
        shutil.copy2(src, dest)

        ref = {"wav": f"voice_refs/{dest_name}", "prompt_text": prompt_text, "lang": lang}
        data.setdefault("voice_refs", []).append(ref)
        self.save_character(name, data)
        return ref

    def remove_voice_ref(self, name: str, wav_rel_path: str) -> None:
        data = self.load_character(name)
        refs = data.get("voice_refs", [])
        data["voice_refs"] = [r for r in refs if r["wav"] != wav_rel_path]
        self.save_character(name, data)
        wav_path = self.character_dir(name) / wav_rel_path
        if wav_path.exists():
            wav_path.unlink()

    def voice_ref_abs_path(self, name: str, wav_rel_path: str) -> Path:
        return (self.character_dir(name) / wav_rel_path).resolve()

    def update_voice_ref_prompt(self, name: str, wav_rel_path: str, prompt_text: str) -> None:
        data = self.load_character(name)
        found = False
        for ref in data.get("voice_refs", []):
            if ref["wav"] == wav_rel_path:
                ref["prompt_text"] = prompt_text
                found = True
        if not found:
            raise FileNotFoundError(f"레퍼런스를 찾을 수 없습니다: {wav_rel_path}")
        self.save_character(name, data)

    # ---- 대사(text+wav) ----
    def _manifest_path(self, name: str) -> Path:
        return self.character_dir(name) / "dialogues" / "manifest.tsv"

    def _ensure_manifest(self, name: str) -> None:
        path = self._manifest_path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            with open(path, "w", encoding="utf-8", newline="") as f:
                writer = csv.writer(f, delimiter="\t")
                writer.writerow(["id", "text", "wav_filename", "created_at"])

    def list_dialogues(self, name: str) -> list[dict]:
        self._ensure_manifest(name)
        with open(self._manifest_path(name), "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f, delimiter="\t")
            return list(reader)

    def add_dialogue(self, name: str, text: str, wav_bytes: bytes) -> dict:
        self._ensure_manifest(name)
        dialogues_dir = self.character_dir(name) / "dialogues"
        dialogue_id = uuid.uuid4().hex[:12]
        wav_filename = f"{dialogue_id}.wav"
        with open(dialogues_dir / wav_filename, "wb") as f:
            f.write(wav_bytes)

        row = {"id": dialogue_id, "text": text, "wav_filename": wav_filename, "created_at": _now()}
        with open(self._manifest_path(name), "a", encoding="utf-8", newline="") as f:
            writer = csv.writer(f, delimiter="\t")
            writer.writerow([row["id"], row["text"], row["wav_filename"], row["created_at"]])
        return row

    def dialogue_wav_path(self, name: str, wav_filename: str) -> Path:
        return self.character_dir(name) / "dialogues" / wav_filename
