"""로컬 PC 한 대에서만 쓰는 캐릭터 생성·목소리 등록·대사 합성 웹앱(FastAPI)."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import cache_utils
from asr_client import ASRClient, ASRError
from character_store import CharacterStore
from engine_manager import EngineManager
import monitor as monitor_module
from paths import bundled_resource, project_root
from settings_store import SettingsStore
from tts_client import TTSClient, TTSError
from voice_generator import VoiceGenerationError, generate_placeholder_voice

PROJECT_ROOT = project_root()
ENGINE_DIR = PROJECT_ROOT / "engine" / "gpt-sovits" / "v2pro"
CHARACTERS_DIR = PROJECT_ROOT / "characters"
DATA_DIR = PROJECT_ROOT / "data"
STATIC_DIR = bundled_resource("static")

store = CharacterStore(CHARACTERS_DIR)
engine = EngineManager(ENGINE_DIR)
tts_client = TTSClient(engine.base_url)
asr_client = ASRClient(ENGINE_DIR)
settings_store = SettingsStore(DATA_DIR / "settings.json")

app = FastAPI(title="CharacterVoiceStudio")


@app.on_event("startup")
def _on_startup() -> None:
    engine.start()


@app.on_event("shutdown")
def _on_shutdown() -> None:
    engine.stop()


# ---------------- 페이지 ----------------

@app.get("/")
def page_index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/assets", StaticFiles(directory=str(STATIC_DIR)), name="assets")


# ---------------- 엔진 상태 / 작업 로그 ----------------

@app.get("/api/engine/status")
def api_engine_status() -> dict:
    return {
        "ready": engine.ready,
        "failed_message": engine.failed_message,
        "log": engine.log_lines(),
    }


# ---------------- 서버 모니터링 ----------------

@app.get("/api/monitor/status")
def api_monitor_status() -> dict:
    return monitor_module.collect_status(PROJECT_ROOT)


# ---------------- 설정 ----------------

class UpdateSettingsPayload(BaseModel):
    language: str | None = None
    speed_factor: float | None = None
    preview_volume: float | None = None
    reset_browser_cache_on_next_launch: bool | None = None


@app.get("/api/settings")
def api_get_settings() -> dict:
    return settings_store.load()


@app.put("/api/settings")
def api_update_settings(payload: UpdateSettingsPayload):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    try:
        return settings_store.save(updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/settings/cache_info")
def api_cache_info() -> dict:
    return cache_utils.cache_info(DATA_DIR)


@app.post("/api/settings/clear_temp_cache")
def api_clear_temp_cache() -> dict:
    freed = cache_utils.clear_temp_uploads(DATA_DIR)
    return {"freed_bytes": freed}


# ---------------- 캐릭터 ----------------

class CreateCharacterPayload(BaseModel):
    name: str


class UpdateCharacterPayload(BaseModel):
    persona: str = ""
    appearance: str = ""
    speech_style: str = ""


@app.get("/api/characters")
def api_list_characters() -> list[str]:
    return store.list_characters()


@app.post("/api/characters")
def api_create_character(payload: CreateCharacterPayload):
    try:
        return store.create_character(payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/characters/{name}")
def api_get_character(name: str):
    try:
        return store.load_character(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/api/characters/{name}")
def api_update_character(name: str, payload: UpdateCharacterPayload):
    try:
        data = store.load_character(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    data["persona"] = payload.persona
    data["appearance"] = payload.appearance
    data["speech_style"] = payload.speech_style
    store.save_character(name, data)
    return data


@app.delete("/api/characters/{name}")
def api_delete_character(name: str):
    store.delete_character(name)
    return {"ok": True}


# ---------------- 목소리 레퍼런스 ----------------

@app.post("/api/characters/{name}/voice_refs")
async def api_add_voice_ref(name: str, file: UploadFile = File(...), prompt_text: str = Form("")):
    tmp_dir = DATA_DIR / "_uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    # 업로드 원본 파일명을 그대로 쓰면 동시 업로드 충돌이나 경로 조작 위험이 있으므로,
    # 확장자만 원본에서 가져오고 파일명 자체는 항상 새로 만든다.
    suffix = Path(file.filename or "").suffix or ".wav"
    tmp_path = tmp_dir / f"{uuid.uuid4().hex}{suffix}"
    content = await file.read()
    tmp_path.write_bytes(content)
    try:
        ref = store.add_voice_ref(name, str(tmp_path), prompt_text=prompt_text)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)
    return ref


@app.post("/api/characters/{name}/voice_refs/generate")
def api_generate_voice_ref(name: str):
    try:
        data = store.load_character(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    persona_text = " ".join(
        part for part in (data.get("persona"), data.get("appearance"), data.get("speech_style")) if part
    ).strip()
    if not persona_text:
        raise HTTPException(status_code=400, detail="페르소나·외형·말투 중 하나는 먼저 입력하고 저장해주세요.")

    tmp_dir = DATA_DIR / "_uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_wav = tmp_dir / f"{uuid.uuid4().hex}.wav"
    try:
        seed_text = generate_placeholder_voice(persona_text, tmp_wav)
    except VoiceGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    try:
        ref = store.add_voice_ref(name, str(tmp_wav), prompt_text=seed_text, lang="ko", source="ai_placeholder")
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_wav.unlink(missing_ok=True)
    return ref


@app.delete("/api/characters/{name}/voice_refs")
def api_remove_voice_ref(name: str, wav: str):
    try:
        store.remove_voice_ref(name, wav)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/characters/{name}/voice_refs/audio")
def api_get_voice_ref_audio(name: str, wav: str):
    try:
        path = store.voice_ref_abs_path(name, wav)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(path, media_type="audio/wav")


class PromptTextPayload(BaseModel):
    wav: str
    prompt_text: str


@app.put("/api/characters/{name}/voice_refs/prompt_text")
def api_update_prompt_text(name: str, payload: PromptTextPayload):
    try:
        store.update_voice_ref_prompt(name, payload.wav, payload.prompt_text)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


class TranscribePayload(BaseModel):
    wav: str


@app.post("/api/characters/{name}/voice_refs/transcribe")
def api_transcribe(name: str, payload: TranscribePayload):
    try:
        wav_path = store.voice_ref_abs_path(name, payload.wav)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        text = asr_client.transcribe(str(wav_path))
    except ASRError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"text": text}


# ---------------- 대사 합성/저장 ----------------

class SynthesizePayload(BaseModel):
    text: str


@app.post("/api/characters/{name}/synthesize")
def api_synthesize(name: str, payload: SynthesizePayload):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="대사를 입력하세요.")

    try:
        data = store.load_character(name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    refs = data.get("voice_refs", [])
    if not refs:
        raise HTTPException(status_code=400, detail="등록된 목소리 레퍼런스가 없습니다.")
    main_ref = refs[0]
    if not main_ref.get("prompt_text"):
        raise HTTPException(status_code=400, detail="대표 레퍼런스에 대본(prompt_text)이 없습니다.")

    ref_path = store.voice_ref_abs_path(name, main_ref["wav"])
    aux_paths = [str(store.voice_ref_abs_path(name, r["wav"])) for r in refs[1:]]

    if not engine.ready:
        raise HTTPException(status_code=503, detail="엔진이 아직 준비되지 않았습니다.")

    speed_factor = settings_store.load().get("speed_factor", 1.0)

    try:
        wav_bytes = tts_client.synthesize(
            text=text,
            ref_audio_path=str(ref_path),
            prompt_text=main_ref.get("prompt_text", ""),
            aux_ref_audio_paths=aux_paths,
            text_lang=main_ref.get("lang", "ko"),
            prompt_lang=main_ref.get("lang", "ko"),
            speed_factor=speed_factor,
        )
    except TTSError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return Response(content=wav_bytes, media_type="audio/wav")


@app.post("/api/characters/{name}/dialogues")
async def api_save_dialogue(name: str, file: UploadFile = File(...), text: str = Form(...)):
    wav_bytes = await file.read()
    return store.add_dialogue(name, text, wav_bytes)


@app.get("/api/characters/{name}/dialogues")
def api_list_dialogues(name: str):
    return store.list_dialogues(name)


@app.get("/api/characters/{name}/dialogues/{wav_filename}")
def api_get_dialogue_audio(name: str, wav_filename: str):
    try:
        path = store.dialogue_wav_path(name, wav_filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(path, media_type="audio/wav")
