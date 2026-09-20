# CharacterVoiceStudio

내 캐릭터(페르소나·외형·말투)를 만들고, 짧은 목소리 샘플 하나만으로 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)의
제로샷 보이스 클로닝을 이용해 원하는 대사를 그 목소리로 합성·저장하는 로컬 프로그램입니다.

- 로그인/계정 없이 실행 파일 하나로 바로 사용
- 별도 학습 없이, 3~10초짜리 레퍼런스 음성 + 그 발화의 정확한 대본만으로 목소리를 재현(제로샷)
- 실행 파일을 눌러도 브라우저 탭이 아니라 주소창 없는 독립된 프로그램 창으로 열림
- GPU/CPU/RAM 사용량과 엔진 로그를 앱 안에서 바로 확인 가능

이 저장소에는 **CharacterVoiceStudio 자체의 코드(`app/`)만** 들어 있습니다. 음성 합성을 실제로
수행하는 GPT-SoVITS 엔진(용량이 크고 제3자 프로젝트라 별도 배포)은 포함되어 있지 않으며,
아래 "GPT-SoVITS 엔진 준비"를 먼저 따라야 실제로 동작합니다.

## 화면 구성

- **캐릭터 작업**: 캐릭터 생성/편집, 목소리 레퍼런스 등록, 대사 합성·저장
- **서버 상태**: 이 PC의 CPU/RAM 사용률, GPU 사용률·VRAM·온도, 디스크 남은 용량을 실시간으로 확인
- **작업 로그**: 음성 엔진(GPT-SoVITS) 콘솔의 실제 출력을 보기 편하게 보여줍니다. 오류로 보이는
  줄은 빨간색, 경고는 노란색으로 강조되고, 검색·자동 스크롤 켜고 끄기·화면 지우기·전체 복사를
  지원합니다.

## 사용 흐름

1. **캐릭터 설정** 탭에서 새 캐릭터를 만들고 페르소나/외형/말투를 적습니다(참고용 메타데이터,
   음성 합성 자체에는 쓰이지 않습니다). 미리 써둔 설정을 한 번에 붙여넣고 싶다면
   "페르소나·외형·말투 한 번에 입력하기"를 눌러
   ```
   페르소나: 씩씩하고 장난기 많은 성격.
   외형: 은발에 붉은 눈, 작은 체구.
   말투: 문장 끝에 ~다냥을 붙임.
   ```
   처럼 붙여넣고 "나눠서 채우기"를 누르면 자동으로 세 칸에 나눠 들어갑니다.
2. 3~10초 정도의 깨끗한 짧은 wav 파일을 "레퍼런스 추가"로 등록하고, 그 음성이 실제로 말한
   문장을 대본(prompt_text)에 정확히 입력합니다. 직접 입력이 번거로우면 "자동 대본 추출"로
   엔진의 faster-whisper를 이용해 초안을 뽑아낼 수 있습니다(부정확할 수 있으니 확인 후 사용).
   목소리 샘플이 아직 없다면 "페르소나로 임시 목소리 만들기"를 눌러 Windows 내장 한국어
   음성(SAPI)으로 임시 레퍼런스를 만들 수도 있습니다 — 진짜 목소리가 아니라 시작점이니,
   나중에 실제 샘플로 교체하는 걸 추천합니다.
3. **대사 작업실** 탭에서 대사를 입력하고 "합성"을 누르면 GPU로 그 캐릭터 목소리의 WAV가
   만들어집니다. 미리듣기 후 "저장"하면 `characters/<이름>/dialogues/`에 텍스트+WAV 쌍으로
   쌓입니다.

## GPT-SoVITS 엔진 준비

CharacterVoiceStudio는 음성 합성 자체를 직접 구현하지 않고, [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)를
서브프로세스로 띄워 그 `/tts` API를 호출하는 방식으로 동작합니다. 아래 구조를 프로젝트 루트의
`engine/gpt-sovits/v2pro/` 아래에 준비해주세요.

```
engine/gpt-sovits/v2pro/
  runtime/python.exe          포터블 파이썬(임베디드) — torch 등 의존성이 이미 설치되어 있어야 함
  api_v2.py                   GPT-SoVITS의 API 서버 스크립트
  GPT_SoVITS/                 GPT-SoVITS 본체 코드 + configs/tts_infer.yaml + pretrained_models/
```

가장 쉬운 방법은 GPT-SoVITS가 배포하는 **Windows 통합 패키지**(포터블 런타임과 사전학습
모델이 이미 포함된 압축본)를 받아 그대로 `engine/gpt-sovits/v2pro/`에 풀어 넣는 것입니다.
자세한 다운로드 위치와 버전은 GPT-SoVITS 저장소의 안내를 따르세요. `GPT_SoVITS/configs/tts_infer.yaml`의
`custom` 항목에서 `device: cuda`(GPU 있을 때) 여부와 버전(`v2`, `v2Pro`, `v2ProPlus` 등)을 확인하세요.

이 저장소는 이 엔진 폴더를 함께 배포하지 않습니다(용량이 크고, GPT-SoVITS 자체 라이선스를
따로 지켜야 하는 제3자 코드이기 때문입니다).

## 실행 방법

### 1) 미리 빌드한 실행 파일이 있다면
`CharacterVoiceStudio.exe`를 더블클릭하세요.
- 콘솔 창이 뜨고, 잠시 후 **주소창·탭이 없는 프로그램 창**이 열리면서 앱이 바로 나타납니다.
  (Windows 기본 내장 Edge를 "앱 모드"로 띄우는 방식이라 일반 웹사이트처럼 보이지 않습니다.
  로그인 화면도 없음 — 열리자마자 바로 캐릭터를 만들고 쓸 수 있습니다.)
- 이 프로그램은 이 PC 안에서만 동작하며, 다른 PC나 휴대폰에서는 열 수 없습니다.
- 프로그램 창만 닫으면 뒤에서 계속 떠 있으니, 완전히 종료하려면 처음에 뜬 **콘솔 창**을
  닫아주세요.

### 2) 소스에서 직접 실행하려면
```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python app\main.py
```
(`engine/gpt-sovits/v2pro/runtime` 안에 엔진 자체의 torch 등 의존성이 이미 들어있으므로,
`app/`을 실행하는 이 가상환경에는 `requirements.txt`에 적힌 가벼운 패키지만 있으면 됩니다.)

### 3) 실행 파일을 직접 빌드하려면
```
cd app
..\.venv\Scripts\python -m PyInstaller --noconfirm --onefile --name CharacterVoiceStudio ^
  --add-data "static;static" --collect-submodules uvicorn ^
  --hidden-import uvicorn.lifespan.on --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets.auto --hidden-import uvicorn.loops.auto main.py
```
빌드 결과(`app\dist\CharacterVoiceStudio.exe`)를 프로젝트 루트로 복사하면 됩니다.

## 폴더 구조

```
CharacterVoiceStudio/
  CharacterVoiceStudio.exe   (직접 빌드 시) 더블클릭으로 실행하는 파일
  engine/gpt-sovits/v2pro/   GPT-SoVITS 엔진 — 저장소에는 없음, 직접 준비 필요 (위 안내 참고)
  app/                       이 저장소의 실제 소스 코드
    main.py                    진입점(로컬 웹서버 + 앱 창 실행)
    web_server.py              FastAPI 라우트
    character_store.py         캐릭터/레퍼런스/대사 파일 저장 로직
    engine_manager.py          GPT-SoVITS 서브프로세스 관리
    tts_client.py               GPT-SoVITS /tts 호출 클라이언트
    asr_client.py, _asr_worker.py  레퍼런스 음성 자동 대본 추출(faster-whisper)
    monitor.py                  CPU/GPU/디스크 상태 조회
    static/                     프론트엔드(HTML/CSS/JS, 프레임워크 없이 순수 구현)
  characters/                캐릭터별 페르소나·레퍼런스 음성·대사(text+wav) — 저장소에는 없음(개인 데이터)
  data/_uploads/             레퍼런스 음성 업로드 중 잠깐 쓰는 임시 폴더
  requirements.txt           app/ 실행에 필요한 패키지
```

## 참고

- 입력한 대사 문장은 그대로(가공/재작성 없이) 음성으로 합성됩니다. 다만 이모지·일부 특수기호는
  GPT-SoVITS의 한국어 텍스트 전처리기가 처리하지 못해 합성이 실패하는 문제가 있어, 합성 전에
  자동으로 걸러냅니다.
- 레퍼런스 음성을 여러 개 등록하면 첫 번째가 대표 레퍼런스로, 나머지는 톤 보강용
  보조 레퍼런스(`aux_ref_audio_paths`)로 함께 사용됩니다.
- 저장 형식(`characters/<이름>/persona.json`, `dialogues/manifest.tsv`)은 이 프로그램 전용 자유
  형식이며, 다른 도구와의 호환 포맷 변환은 포함하지 않습니다.
- 캐릭터 이름에는 파일 시스템에서 문제가 되는 문자(`\ / : * ? " < > |`)를 쓸 수 없습니다.

## 라이선스 / 크레딧

- 이 저장소의 코드에는 별도 라이선스가 명시되어 있지 않습니다.
- 실제 음성 합성 엔진은 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)(MIT 라이선스)를 그대로
  사용하며, GPT-SoVITS 자체와 그 사전학습 모델의 라이선스·이용 조건은 해당 프로젝트를 따릅니다.
