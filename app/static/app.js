// CharacterVoiceStudio 프론트엔드 로직 (프레임워크 없이 순수 JS)

let currentCharacter = null;

async function api(path, options = {}) {
  return fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
}

async function apiJson(path, options = {}) {
  const res = await api(path, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `요청 실패 (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- 상단 큰 탭(캐릭터 작업 / 서버 상태 / 작업 로그) ----
document.querySelectorAll('.top-tabs .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.top-tabs .tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.toptab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`toptab-${btn.dataset.toptab}`).classList.add('active');
  });
});

// ---- 캐릭터 안의 작은 탭(캐릭터 설정 / 대사 작업실) ----
document.querySelectorAll('.tabs:not(.top-tabs) .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs:not(.top-tabs) .tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ---- 엔진 상태 배너 ----
const engineBanner = document.getElementById('engine-banner');
const engineBannerText = document.getElementById('engine-banner-text');

async function pollEngineStatus() {
  try {
    const status = await apiJson('/api/engine/status');
    if (status.failed_message) {
      engineBannerText.textContent = `엔진 오류: ${status.failed_message}`;
      engineBanner.className = 'engine-banner error';
    } else if (!status.ready) {
      engineBannerText.textContent = '엔진을 기동하는 중입니다. 첫 기동은 모델 로딩으로 다소 시간이 걸립니다...';
      engineBanner.className = 'engine-banner loading';
    } else {
      engineBannerText.textContent = '엔진 준비 완료';
      engineBanner.className = 'engine-banner ready';
    }

    if (status.log && status.log.length !== lastLogLength) {
      lastLogLength = status.log.length;
      allLogLines = status.log;
      renderLogView();
    }
  } catch (err) {
    // 무시하고 다음 폴링에서 재시도
  }
  setTimeout(pollEngineStatus, 2000);
}

// ---- 작업 로그 (검색/자동스크롤/지우기/복사 지원) ----
const logFilterInput = document.getElementById('log-filter');
const logAutoscrollCheckbox = document.getElementById('log-autoscroll');
const logClearBtn = document.getElementById('log-clear-btn');
const logCopyBtn = document.getElementById('log-copy-btn');
const logCountEl = document.getElementById('log-count');
const engineLogView = document.getElementById('engine-log-view');

let allLogLines = [];
let logClearOffset = 0;
let lastLogLength = -1;

function classifyLogLine(line) {
  const lower = line.toLowerCase();
  if (lower.includes('traceback') || lower.includes('error') || lower.includes('exception') || line.includes('실패')) {
    return 'log-error';
  }
  if (lower.includes('warning') || lower.includes('warn')) {
    return 'log-warn';
  }
  if (line.trim().startsWith('---') || line.trim().startsWith('===')) {
    return 'log-section';
  }
  return 'log-normal';
}

function renderLogView() {
  const filterText = logFilterInput.value.trim().toLowerCase();
  const visibleLines = allLogLines.slice(logClearOffset).filter(
    (line) => !filterText || line.toLowerCase().includes(filterText)
  );

  engineLogView.innerHTML = '';
  visibleLines.forEach((line) => {
    const row = document.createElement('div');
    row.className = `log-line ${classifyLogLine(line)}`;
    row.textContent = line;
    engineLogView.appendChild(row);
  });

  logCountEl.textContent = filterText
    ? `검색 결과 ${visibleLines.length}줄 (화면에 ${allLogLines.length - logClearOffset}줄 중)`
    : `${visibleLines.length}줄 표시 중 (엔진은 최근 500줄까지 보관)`;

  if (logAutoscrollCheckbox.checked) {
    engineLogView.scrollTop = engineLogView.scrollHeight;
  }
}

logFilterInput.addEventListener('input', renderLogView);

logClearBtn.addEventListener('click', () => {
  logClearOffset = allLogLines.length;
  renderLogView();
});

logCopyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(allLogLines.slice(logClearOffset).join('\n'));
    const original = logCopyBtn.textContent;
    logCopyBtn.textContent = '복사됨!';
    setTimeout(() => { logCopyBtn.textContent = original; }, 1500);
  } catch (err) {
    alert('클립보드 복사에 실패했습니다: ' + err.message);
  }
});

// ---- 서버 상태(모니터링) ----
const monitorPanel = document.getElementById('monitor-panel');

function bar(percent, label) {
  const p = Math.max(0, Math.min(100, percent || 0));
  const cls = p >= 90 ? 'crit' : p >= 70 ? 'warn' : 'ok';
  return `
    <div class="monitor-bar-row">
      <div class="monitor-bar-label">${label}</div>
      <div class="monitor-bar-track"><div class="monitor-bar-fill ${cls}" style="width:${p}%"></div></div>
      <div class="monitor-bar-value">${p.toFixed(1)}%</div>
    </div>`;
}

async function pollMonitorStatus() {
  try {
    const s = await apiJson('/api/monitor/status');
    let html = '';
    html += '<h3>CPU / RAM</h3>';
    html += bar(s.cpu_percent, `CPU (코어 ${s.cpu_count}개)`);
    html += bar(s.ram_percent, `RAM (${s.ram_used_gb} / ${s.ram_total_gb} GB)`);

    if (s.gpu) {
      html += '<h3>GPU</h3>';
      html += `<div class="dim">${s.gpu.name} · ${s.gpu.temperature_c}°C</div>`;
      html += bar(s.gpu.utilization_percent, 'GPU 사용률');
      html += bar(s.gpu.memory_used_percent, `VRAM (${s.gpu.memory_used_mb.toFixed(0)} / ${s.gpu.memory_total_mb.toFixed(0)} MB)`);
    } else {
      html += '<h3>GPU</h3><div class="dim">GPU 정보를 가져올 수 없습니다 (nvidia-smi 없음).</div>';
    }

    html += '<h3>디스크 남은 용량</h3>';
    s.disks.forEach((d) => {
      html += bar(d.used_percent, `${d.label} (${d.drive}) · 남음 ${d.free_gb} GB / 전체 ${d.total_gb} GB`);
    });

    monitorPanel.innerHTML = html;
  } catch (err) {
    monitorPanel.innerHTML = `<div class="dim">서버 상태를 가져오지 못했습니다: ${err.message}</div>`;
  }
  setTimeout(pollMonitorStatus, 5000);
}

// ---- 캐릭터 목록 ----
const characterListEl = document.getElementById('character-list');
const emptyState = document.getElementById('empty-state');
const characterPanel = document.getElementById('character-panel');

const AVATAR_COLORS = ['#7289ff', '#4cc38a', '#e8c24a', '#ef5a67', '#c77dff', '#4ac0e0', '#f0955e'];
function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

async function reloadCharacterList(selectName) {
  const names = await apiJson('/api/characters');
  characterListEl.innerHTML = '';
  names.forEach((name) => {
    const li = document.createElement('li');
    li.dataset.name = name;
    li.className = name === currentCharacter ? 'selected' : '';

    const avatar = document.createElement('span');
    avatar.className = 'char-avatar';
    avatar.style.background = colorForName(name);
    avatar.textContent = name.trim().charAt(0).toUpperCase();

    const label = document.createElement('span');
    label.className = 'char-name-label';
    label.textContent = name;

    li.appendChild(avatar);
    li.appendChild(label);
    li.addEventListener('click', () => selectCharacter(name));
    characterListEl.appendChild(li);
  });

  if (selectName && names.includes(selectName)) {
    await selectCharacter(selectName);
  } else if (!names.includes(currentCharacter)) {
    currentCharacter = null;
    emptyState.style.display = 'flex';
    characterPanel.style.display = 'none';
  }
}

async function selectCharacter(name) {
  if (name !== currentCharacter && isCharacterFormDirty) {
    const proceed = confirm(
      '저장하지 않은 캐릭터 정보(페르소나/외형/말투)가 있습니다.\n저장하지 않고 다른 캐릭터로 이동할까요?'
    );
    if (!proceed) return;
  }

  currentCharacter = name;
  Array.from(characterListEl.children).forEach((li) => {
    li.className = li.dataset.name === name ? 'selected' : '';
  });
  emptyState.style.display = 'none';
  characterPanel.style.display = 'block';
  await loadCharacterDetail(name);
  await loadDialogueList(name);
  resetStudio();
}

document.getElementById('new-character-btn').addEventListener('click', async () => {
  const name = prompt('캐릭터 이름:');
  if (!name) return;
  try {
    await apiJson('/api/characters', { method: 'POST', body: JSON.stringify({ name }) });
    await reloadCharacterList(name);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('delete-character-btn').addEventListener('click', async () => {
  if (!currentCharacter) return;
  if (!confirm(`'${currentCharacter}' 캐릭터와 저장된 모든 음성·대사를 삭제합니다. 계속할까요?`)) return;
  await apiJson(`/api/characters/${encodeURIComponent(currentCharacter)}`, { method: 'DELETE' });
  currentCharacter = null;
  await reloadCharacterList();
});

// ---- 캐릭터 설정 탭 ----
const nameInput = document.getElementById('char-name');
const personaInput = document.getElementById('char-persona');
const appearanceInput = document.getElementById('char-appearance');
const speechStyleInput = document.getElementById('char-speech-style');
const voiceRefListEl = document.getElementById('voice-ref-list');
const saveCharacterStatus = document.getElementById('save-character-status');

// 페르소나/외형/말투를 저장하지 않은 채로 다른 동작(레퍼런스 추가·삭제, 캐릭터 전환 등)을
// 하다가 입력하던 내용이 조용히 사라지는 것을 막기 위한 "저장 안 함" 표시.
let isCharacterFormDirty = false;
function markCharacterFormDirty() {
  isCharacterFormDirty = true;
}
personaInput.addEventListener('input', markCharacterFormDirty);
appearanceInput.addEventListener('input', markCharacterFormDirty);
speechStyleInput.addEventListener('input', markCharacterFormDirty);

window.addEventListener('beforeunload', (e) => {
  if (isCharacterFormDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

async function loadCharacterDetail(name) {
  hideBulkInput();
  const data = await apiJson(`/api/characters/${encodeURIComponent(name)}`);
  nameInput.value = data.name;
  personaInput.value = data.persona || '';
  appearanceInput.value = data.appearance || '';
  speechStyleInput.value = data.speech_style || '';
  saveCharacterStatus.textContent = '';
  isCharacterFormDirty = false;
  renderVoiceRefs(name, data.voice_refs || []);
}

// 레퍼런스 음성 추가/삭제/대본 작업은 목소리 목록만 다시 불러오고, 페르소나/외형/말투
// 입력창은 절대 건드리지 않는다(저장 안 한 내용이 사라지지 않도록).
async function refreshVoiceRefs(name) {
  const data = await apiJson(`/api/characters/${encodeURIComponent(name)}`);
  renderVoiceRefs(name, data.voice_refs || []);
}

function renderVoiceRefs(name, refs) {
  voiceRefListEl.innerHTML = '';
  refs.forEach((ref) => {
    const li = document.createElement('li');
    li.className = 'voice-ref-item';

    const filename = ref.wav.split('/').pop();
    const audioUrl = `/api/characters/${encodeURIComponent(name)}/voice_refs/audio?wav=${encodeURIComponent(ref.wav)}`;

    // 업로드 파일명은 사용자가 지정한 값이라 innerHTML에 직접 넣지 않고
    // textContent/속성으로만 채워서 DOM 기반 XSS를 피한다.
    li.innerHTML = `
      <div class="voice-ref-head">
        <strong class="ref-filename"></strong>
        <span class="badge ai-badge" style="display:none">🤖 AI 임시 생성</span>
        <audio controls></audio>
        <button class="danger small remove-ref-btn">삭제</button>
      </div>
      <textarea class="prompt-text-input" rows="2" placeholder="이 음성이 실제로 말한 문장(대본)"></textarea>
      <div class="btn-row">
        <button class="small auto-transcribe-btn">자동 대본 추출</button>
        <button class="small save-prompt-btn">대본 저장</button>
      </div>
    `;
    li.querySelector('.ref-filename').textContent = filename;
    li.querySelector('audio').src = audioUrl;
    if (ref.source === 'ai_placeholder') {
      li.querySelector('.ai-badge').style.display = 'inline-block';
    }

    const promptInput = li.querySelector('.prompt-text-input');
    promptInput.value = ref.prompt_text || '';

    li.querySelector('.remove-ref-btn').addEventListener('click', async () => {
      await apiJson(`/api/characters/${encodeURIComponent(name)}/voice_refs?wav=${encodeURIComponent(ref.wav)}`, { method: 'DELETE' });
      await refreshVoiceRefs(name);
    });

    li.querySelector('.auto-transcribe-btn').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      const previous = promptInput.value;
      promptInput.value = '추출 중입니다... (엔진의 faster-whisper 사용)';
      try {
        const result = await apiJson(`/api/characters/${encodeURIComponent(name)}/voice_refs/transcribe`, {
          method: 'POST',
          body: JSON.stringify({ wav: ref.wav }),
        });
        promptInput.value = result.text;
      } catch (err) {
        promptInput.value = previous;
        alert(`대본 자동 추출 실패: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });

    li.querySelector('.save-prompt-btn').addEventListener('click', async () => {
      await apiJson(`/api/characters/${encodeURIComponent(name)}/voice_refs/prompt_text`, {
        method: 'PUT',
        body: JSON.stringify({ wav: ref.wav, prompt_text: promptInput.value }),
      });
      ref.prompt_text = promptInput.value;
      alert('대본이 저장되었습니다.');
    });

    voiceRefListEl.appendChild(li);
  });
}

// ---- 페르소나·외형·말투 한 번에 입력하기 ----
const bulkInputToggleBtn = document.getElementById('bulk-input-toggle-btn');
const bulkInputPanel = document.getElementById('bulk-input-panel');
const bulkInputText = document.getElementById('bulk-input-text');
const bulkInputApplyBtn = document.getElementById('bulk-input-apply-btn');
const bulkInputCancelBtn = document.getElementById('bulk-input-cancel-btn');
const individualFieldsBlock = document.getElementById('individual-fields-block');

// 일괄 입력창이 열려 있는 동안에는 하나씩 입력하는 칸을 숨겨서, 같은 화면에 두 가지
// 입력 방식이 동시에 보여 헷갈리는 일이 없게 한다.
function showBulkInput() {
  bulkInputPanel.style.display = 'block';
  individualFieldsBlock.style.display = 'none';
}
function hideBulkInput() {
  bulkInputPanel.style.display = 'none';
  individualFieldsBlock.style.display = 'block';
}

const BULK_HEADER_PATTERN = /^\s*(페르소나|성격|외형|생김새|말투|어투)\s*[:：]?\s*(.*)$/;
const BULK_HEADER_KEY_MAP = {
  페르소나: 'persona',
  성격: 'persona',
  외형: 'appearance',
  생김새: 'appearance',
  말투: 'speech_style',
  어투: 'speech_style',
};

function parseBulkCharacterText(raw) {
  const sections = { persona: [], appearance: [], speech_style: [] };
  let currentKey = null;
  raw.split(/\r?\n/).forEach((line) => {
    const match = line.match(BULK_HEADER_PATTERN);
    if (match) {
      currentKey = BULK_HEADER_KEY_MAP[match[1]];
      const inline = match[2].trim();
      if (inline) sections[currentKey].push(inline);
      return;
    }
    if (currentKey) sections[currentKey].push(line);
  });
  return {
    persona: sections.persona.join('\n').trim(),
    appearance: sections.appearance.join('\n').trim(),
    speech_style: sections.speech_style.join('\n').trim(),
  };
}

bulkInputToggleBtn.addEventListener('click', () => {
  const isHidden = bulkInputPanel.style.display === 'none';
  if (isHidden) showBulkInput(); else hideBulkInput();
});

bulkInputCancelBtn.addEventListener('click', () => {
  hideBulkInput();
});

bulkInputApplyBtn.addEventListener('click', () => {
  const raw = bulkInputText.value;
  const parsed = parseBulkCharacterText(raw);

  if (!parsed.persona && !parsed.appearance && !parsed.speech_style) {
    alert('내용을 나눌 수 없습니다. "페르소나:", "외형:", "말투:"로 시작하는 줄을 넣어주세요.');
    return;
  }

  const hasExisting = personaInput.value.trim() || appearanceInput.value.trim() || speechStyleInput.value.trim();
  if (hasExisting && !confirm('기존에 입력된 페르소나/외형/말투 내용을 덮어씁니다. 계속할까요?')) {
    return;
  }

  if (parsed.persona) personaInput.value = parsed.persona;
  if (parsed.appearance) appearanceInput.value = parsed.appearance;
  if (parsed.speech_style) speechStyleInput.value = parsed.speech_style;
  markCharacterFormDirty();

  bulkInputText.value = '';
  hideBulkInput();
});

document.getElementById('save-character-btn').addEventListener('click', async () => {
  if (!currentCharacter) return;
  try {
    await apiJson(`/api/characters/${encodeURIComponent(currentCharacter)}`, {
      method: 'PUT',
      body: JSON.stringify({
        persona: personaInput.value,
        appearance: appearanceInput.value,
        speech_style: speechStyleInput.value,
      }),
    });
    isCharacterFormDirty = false;
    saveCharacterStatus.textContent = '저장됨';
    setTimeout(() => { saveCharacterStatus.textContent = ''; }, 2000);
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('add-ref-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentCharacter) return;
  const fileInput = document.getElementById('ref-file');
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('prompt_text', '');

  const res = await fetch(`/api/characters/${encodeURIComponent(currentCharacter)}/voice_refs`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.detail || '업로드 실패');
    return;
  }
  fileInput.value = '';
  await refreshVoiceRefs(currentCharacter);
});

document.getElementById('generate-ref-btn').addEventListener('click', async (e) => {
  if (!currentCharacter) return;
  const btn = e.currentTarget;

  const proceed = confirm(
    'Windows에 내장된 한국어 음성(현재는 여성 음성만 지원)으로 페르소나 성격을 어느 정도 반영한 ' +
    '임시 목소리를 만듭니다.\n\n실제 목소리가 아니라 시작점일 뿐이니, 나중에 진짜 음성 샘플로 ' +
    '교체하는 걸 추천합니다.\n\n계속할까요?'
  );
  if (!proceed) return;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '생성 중입니다...';
  try {
    await apiJson(`/api/characters/${encodeURIComponent(currentCharacter)}/voice_refs/generate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await refreshVoiceRefs(currentCharacter);
  } catch (err) {
    alert(`임시 목소리 생성 실패: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// ---- 대사 작업실 탭 ----
const dialogueTextEl = document.getElementById('dialogue-text');
const synthBtn = document.getElementById('synth-btn');
const saveDialogueBtn = document.getElementById('save-dialogue-btn');
const synthStatus = document.getElementById('synth-status');
const synthPlayer = document.getElementById('synth-player');
const dialogueListEl = document.getElementById('dialogue-list');
let lastSynthBlob = null;

function resetStudio() {
  dialogueTextEl.value = '';
  synthStatus.textContent = '';
  synthPlayer.style.display = 'none';
  synthPlayer.removeAttribute('src');
  saveDialogueBtn.disabled = true;
  lastSynthBlob = null;
}

synthBtn.addEventListener('click', async () => {
  if (!currentCharacter) return;
  const text = dialogueTextEl.value.trim();
  if (!text) { alert('대사를 입력하세요.'); return; }

  synthBtn.disabled = true;
  synthStatus.textContent = '합성 중입니다... (GPU 추론)';
  try {
    const res = await api(`/api/characters/${encodeURIComponent(currentCharacter)}/synthesize`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `합성 실패 (${res.status})`);
    }
    lastSynthBlob = await res.blob();
    synthPlayer.src = URL.createObjectURL(lastSynthBlob);
    synthPlayer.style.display = 'block';
    saveDialogueBtn.disabled = false;
    synthStatus.textContent = '합성 완료. 미리듣기 후 저장하세요.';
  } catch (err) {
    synthStatus.textContent = '합성 실패';
    alert(err.message);
  } finally {
    synthBtn.disabled = false;
  }
});

saveDialogueBtn.addEventListener('click', async () => {
  if (!currentCharacter || !lastSynthBlob) return;
  const formData = new FormData();
  formData.append('file', lastSynthBlob, 'dialogue.wav');
  formData.append('text', dialogueTextEl.value.trim());

  const res = await fetch(`/api/characters/${encodeURIComponent(currentCharacter)}/dialogues`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.detail || '저장 실패');
    return;
  }
  synthStatus.textContent = '저장되었습니다.';
  await loadDialogueList(currentCharacter);
});

async function loadDialogueList(name) {
  const rows = await apiJson(`/api/characters/${encodeURIComponent(name)}/dialogues`);
  dialogueListEl.innerHTML = '';
  rows.slice().reverse().forEach((row) => {
    const li = document.createElement('li');
    const audioUrl = `/api/characters/${encodeURIComponent(name)}/dialogues/${encodeURIComponent(row.wav_filename)}`;
    const textDiv = document.createElement('div');
    textDiv.textContent = row.text;
    const audioEl = document.createElement('audio');
    audioEl.controls = true;
    audioEl.src = audioUrl;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'dim';
    timeSpan.textContent = row.created_at;

    li.appendChild(textDiv);
    li.appendChild(audioEl);
    li.appendChild(timeSpan);
    dialogueListEl.appendChild(li);
  });
}

// ---- 시작 ----
reloadCharacterList();
pollEngineStatus();
pollMonitorStatus();
