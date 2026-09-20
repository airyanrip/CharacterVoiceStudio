# CharacterVoiceStudio

내 캐릭터(페르소나·외형·말투)를 만들고, 짧은 목소리 샘플만으로 GPT-SoVITS 제로샷 보이스
클로닝을 이용해 원하는 대사를 그 목소리로 합성·저장하는 프로그램입니다.

**이 PC 한 대에서만 쓰는 로컬 프로그램**입니다. 로그인이나 계정 없이 `CharacterVoiceStudio.exe`를
누르면 바로 사용할 수 있습니다. `siro_ai`에 이미 설치되어 있던 GPT-SoVITS(v2pro) 엔진을 그대로
복사해 왔기 때문에, `siro_ai`가 없어도 이 폴더만으로 독립적으로 동작합니다.

## 실행 방법

**`CharacterVoiceStudio.exe`를 더블클릭하세요.**

- 콘솔 창이 뜨고, 잠시 후 **주소창·탭이 없는 프로그램 창**이 열리면서 앱이 바로 나타납니다.
  (Windows 기본 내장 Edge를 "앱 모드"로 띄우는 방식이라 일반 웹사이트처럼 보이지 않습니다.
  로그인 화면도 없음 — 열리자마자 바로 캐릭터를 만들고 쓸 수 있습니다.)
- 이 프로그램은 이 PC 안에서만 동작하며, 다른 PC나 휴대폰에서는 열 수 없습니다.
- 프로그램 창만 닫으면 뒤에서 계속 떠 있으니, 완전히 종료하려면 처음에 뜬 **콘솔 창**을
  닫아주세요.

## 화면 구성

- **캐릭터 작업**: 캐릭터 생성/편집, 목소리 레퍼런스 등록, 대사 합성·저장
- **서버 상태**: 이 PC의 CPU/RAM 사용률, GPU 사용률·VRAM·온도, 디스크 남은 용량을 실시간으로 확인
- **작업 로그**: 음성 엔진(GPT-SoVITS) 콘솔의 실제 출력을 보기 편하게 보여줍니다. 오류로 보이는
  줄은 빨간색, 경고는 노란색으로 강조되고, 검색·자동 스크롤 켜고 끄기·화면 지우기·전체 복사를
  지원합니다.

## 사용 흐름

1. **캐릭터 설정** 탭에서 새 캐릭터를 만들고 페르소나/외형/말투를 적습니다(참고용 메타데이터).
   미리 써둔 설정을 한 번에 붙여넣고 싶다면 "페르소나·외형·말투 한 번에 입력하기"를 눌러
   `페르소나: ...` / `외형: ...` / `말투: ...` 형식으로 붙여넣은 뒤 "나눠서 채우기"를 누르면
   자동으로 세 칸에 나눠 들어갑니다.
2. 3~10초 정도의 깨끗한 짧은 wav 파일을 "레퍼런스 추가"로 등록하고, 그 음성이 실제로 말한
   문장을 대본(prompt_text)에 정확히 입력합니다. 직접 입력이 번거로우면 "자동 대본 추출"로
   엔진의 faster-whisper를 이용해 초안을 뽑아낼 수 있습니다(부정확할 수 있으니 확인 후 사용).
3. **대사 작업실** 탭에서 대사를 입력, "합성"을 누르면 GPU로 그 캐릭터 목소리의 WAV가
   만들어집니다. 미리듣기 후 "저장"하면 `characters/<이름>/dialogues/`에 텍스트+WAV 쌍으로
   쌓입니다.

## 폴더 구조

```
CharacterVoiceStudio/
  CharacterVoiceStudio.exe   더블클릭으로 실행하는 파일
  engine/gpt-sovits/v2pro/   GPT-SoVITS 엔진 (siro_ai에서 복사, 그대로 둘 것)
  app/                       파이썬 소스 (exe는 이 코드를 그대로 묶은 것)
  characters/                캐릭터별 페르소나·레퍼런스 음성·대사(text+wav)
  data/_uploads/             레퍼런스 음성 업로드 중 잠깐 쓰는 임시 폴더
  requirements.txt           app/ 소스를 직접 파이썬으로 실행할 때 필요한 패키지
```

## exe 대신 소스로 직접 실행하고 싶다면

```
F:\CharacterVoiceStudio\.venv\Scripts\python.exe F:\CharacterVoiceStudio\app\main.py
```
(엔진 자체의 torch 등 의존성은 `engine\gpt-sovits\v2pro\runtime` 안에 이미 다 들어있으므로
따로 설치할 필요가 없습니다. `.venv`는 이 프로젝트 전용 가상환경입니다.)

exe를 다시 빌드해야 한다면(`app/` 코드를 수정한 뒤):
```
cd F:\CharacterVoiceStudio\app
..\.venv\Scripts\python.exe -m PyInstaller --noconfirm --onefile --name CharacterVoiceStudio ^
  --add-data "static;static" --collect-submodules uvicorn ^
  --hidden-import uvicorn.lifespan.on --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets.auto --hidden-import uvicorn.loops.auto main.py
```
빌드 결과(`app\dist\CharacterVoiceStudio.exe`)를 `CharacterVoiceStudio.exe`로 복사해서 덮어쓰면 됩니다.

## 참고

- 입력한 대사 문장은 그대로(가공/재작성 없이) 음성으로 합성됩니다.
- 레퍼런스 음성을 여러 개 등록하면 첫 번째가 대표 레퍼런스로, 나머지는 톤 보강용
  보조 레퍼런스(aux_ref_audio_paths)로 함께 사용됩니다.
- 저장 형식은 이 프로그램 전용 자유 형식이며, 다른 도구와의 호환 포맷 변환은 포함하지 않습니다.
