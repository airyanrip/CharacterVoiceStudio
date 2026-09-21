// CharacterVoiceStudio 프론트엔드 로직 (프레임워크 없이 순수 JS)

let currentCharacter = null;
let appSettings = { language: 'ko', speed_factor: 1.0, preview_volume: 1.0, reset_browser_cache_on_next_launch: false };

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
    throw new Error(data.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---- 상단 큰 탭(캐릭터 작업 / 서버 상태 / 작업 로그 / 설정) ----
document.querySelectorAll('.top-tabs .tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.top-tabs .tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.toptab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`toptab-${btn.dataset.toptab}`).classList.add('active');
    if (btn.dataset.toptab === 'settings') refreshCacheInfo();
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
      engineBannerText.textContent = t('engine.error', { message: status.failed_message });
      engineBanner.className = 'engine-banner error';
    } else if (!status.ready) {
      engineBannerText.textContent = t('engine.starting');
      engineBanner.className = 'engine-banner loading';
    } else {
      engineBannerText.textContent = t('engine.ready');
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
    ? t('log.countFiltered', { count: visibleLines.length, total: allLogLines.length - logClearOffset })
    : t('log.countAll', { count: visibleLines.length });

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
    logCopyBtn.textContent = t('log.copied');
    setTimeout(() => { logCopyBtn.textContent = original; }, 1500);
  } catch (err) {
    alert(t('log.copyFailed', { message: err.message }));
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
    html += `<h3>${t('monitor.cpuRamHeading')}</h3>`;
    html += bar(s.cpu_percent, t('monitor.cpuLabel', { count: s.cpu_count }));
    html += bar(s.ram_percent, t('monitor.ramLabel', { used: s.ram_used_gb, total: s.ram_total_gb }));

    html += `<h3>${t('monitor.gpuHeading')}</h3>`;
    if (s.gpu) {
      html += `<div class="dim">${s.gpu.name} · ${s.gpu.temperature_c}°C</div>`;
      html += bar(s.gpu.utilization_percent, t('monitor.gpuUsage'));
      html += bar(s.gpu.memory_used_percent, t('monitor.vram', { used: s.gpu.memory_used_mb.toFixed(0), total: s.gpu.memory_total_mb.toFixed(0) }));
    } else {
      html += `<div class="dim">${t('monitor.gpuUnavailable')}</div>`;
    }

    html += `<h3>${t('monitor.diskHeading')}</h3>`;
    s.disks.forEach((d) => {
      const label = t(d.label_key === 'system_drive' ? 'monitor.diskSystemDrive' : 'monitor.diskProjectDrive');
      html += bar(d.used_percent, t('monitor.diskLabel', { label, drive: d.drive, free: d.free_gb, total: d.total_gb }));
    });

    monitorPanel.innerHTML = html;
  } catch (err) {
    monitorPanel.innerHTML = `<div class="dim">${t('monitor.loadFailed', { message: err.message })}</div>`;
  }
  setTimeout(pollMonitorStatus, 5000);
}

// ---- 캐릭터 목록 ----
const characterListEl = document.getElementById('character-list');
const emptyState = document.getElementById('empty-state');
const characterPanel = document.getElementById('character-panel');

const AVATAR_COLORS = ['#e64c93', '#8f6fd6', '#c060d6', '#ff7ab0', '#7d5bb5', '#4ac0e0', '#f0955e'];
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
    const proceed = confirm(t('character.switchConfirm'));
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
  const name = prompt(t('character.namePrompt'));
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
  if (!confirm(t('character.deleteConfirm', { name: currentCharacter }))) return;
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

function applyPreviewVolume(audioEl) {
  audioEl.volume = appSettings.preview_volume;
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
        <span class="badge ai-badge" style="display:none"></span>
        <audio controls></audio>
        <button class="danger small remove-ref-btn"></button>
      </div>
      <textarea class="prompt-text-input" rows="2"></textarea>
      <div class="btn-row">
        <button class="small auto-transcribe-btn"></button>
        <button class="small save-prompt-btn"></button>
      </div>
    `;
    li.querySelector('.ref-filename').textContent = filename;
    const audioEl = li.querySelector('audio');
    audioEl.src = audioUrl;
    applyPreviewVolume(audioEl);
    li.querySelector('.remove-ref-btn').textContent = t('voiceRef.remove');
    li.querySelector('.prompt-text-input').placeholder = t('voiceRef.promptPlaceholder');
    li.querySelector('.auto-transcribe-btn').textContent = t('voiceRef.autoTranscribe');
    li.querySelector('.save-prompt-btn').textContent = t('voiceRef.savePrompt');
    if (ref.source === 'ai_placeholder') {
      const badge = li.querySelector('.ai-badge');
      badge.textContent = t('voiceRef.aiBadge');
      badge.style.display = 'inline-block';
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
      promptInput.value = t('voiceRef.autoTranscribing');
      try {
        const result = await apiJson(`/api/characters/${encodeURIComponent(name)}/voice_refs/transcribe`, {
          method: 'POST',
          body: JSON.stringify({ wav: ref.wav }),
        });
        promptInput.value = result.text;
      } catch (err) {
        promptInput.value = previous;
        alert(t('voiceRef.transcribeFailed', { message: err.message }));
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
      alert(t('voiceRef.promptSaved'));
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

// 화면 언어와 무관하게, 4개 언어 어떤 라벨로 붙여넣어도 나눠 인식하도록 한글/영어/일본어/
// 중국어 표기를 전부 인식한다.
const BULK_HEADER_PATTERN = /^\s*(페르소나|성격|외형|생김새|말투|어투|persona|personality|appearance|looks|speech style|speech|tone|ペルソナ|性格|外見|外観|口調|話し方|人设|人設|外观|外貌|语气|語氣|说话方式)\s*[:：]?\s*(.*)$/i;
const BULK_HEADER_KEY_MAP = {
  '페르소나': 'persona', '성격': 'persona', 'persona': 'persona', 'personality': 'persona',
  'ペルソナ': 'persona', '人设': 'persona', '人設': 'persona',
  '외형': 'appearance', '생김새': 'appearance', 'appearance': 'appearance', 'looks': 'appearance',
  '外見': 'appearance', '外観': 'appearance', '外观': 'appearance', '外貌': 'appearance',
  '말투': 'speech_style', '어투': 'speech_style', 'speech style': 'speech_style', 'speech': 'speech_style', 'tone': 'speech_style',
  '口調': 'speech_style', '話し方': 'speech_style', '语气': 'speech_style', '語氣': 'speech_style', '说话方式': 'speech_style',
};

function parseBulkCharacterText(raw) {
  const sections = { persona: [], appearance: [], speech_style: [] };
  let currentKey = null;
  raw.split(/\r?\n/).forEach((line) => {
    const match = line.match(BULK_HEADER_PATTERN);
    if (match) {
      currentKey = BULK_HEADER_KEY_MAP[match[1].toLowerCase()] || BULK_HEADER_KEY_MAP[match[1]];
      const inline = match[2].trim();
      if (currentKey && inline) sections[currentKey].push(inline);
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
    alert(t('bulkInput.noSections'));
    return;
  }

  const hasExisting = personaInput.value.trim() || appearanceInput.value.trim() || speechStyleInput.value.trim();
  if (hasExisting && !confirm(t('bulkInput.confirmOverwrite'))) {
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
    saveCharacterStatus.textContent = t('save.saved');
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
    alert(data.detail || t('voiceRef.uploadFailed'));
    return;
  }
  fileInput.value = '';
  await refreshVoiceRefs(currentCharacter);
});

document.getElementById('generate-ref-btn').addEventListener('click', async (e) => {
  if (!currentCharacter) return;
  const btn = e.currentTarget;

  const proceed = confirm(t('voiceRef.generateConfirm'));
  if (!proceed) return;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = t('voiceRef.generating');
  try {
    await apiJson(`/api/characters/${encodeURIComponent(currentCharacter)}/voice_refs/generate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await refreshVoiceRefs(currentCharacter);
  } catch (err) {
    alert(t('voiceRef.generateFailed', { message: err.message }));
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
  if (!text) { alert(t('dialogue.emptyAlert')); return; }

  synthBtn.disabled = true;
  synthStatus.textContent = t('dialogue.synthesizing');
  try {
    const res = await api(`/api/characters/${encodeURIComponent(currentCharacter)}/synthesize`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || t('dialogue.synthesizeFailed', { status: res.status }));
    }
    lastSynthBlob = await res.blob();
    synthPlayer.src = URL.createObjectURL(lastSynthBlob);
    applyPreviewVolume(synthPlayer);
    synthPlayer.style.display = 'block';
    saveDialogueBtn.disabled = false;
    synthStatus.textContent = t('dialogue.synthesizeDone');
  } catch (err) {
    synthStatus.textContent = t('dialogue.synthesizeFailedLabel');
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
    alert(data.detail || t('dialogue.saveFailed'));
    return;
  }
  synthStatus.textContent = t('dialogue.saved');
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
    applyPreviewVolume(audioEl);
    const timeSpan = document.createElement('span');
    timeSpan.className = 'dim';
    timeSpan.textContent = row.created_at;

    li.appendChild(textDiv);
    li.appendChild(audioEl);
    li.appendChild(timeSpan);
    dialogueListEl.appendChild(li);
  });
}

// ---- 설정 페이지 ----
const langPicker = document.getElementById('lang-picker');
const speedFactorSlider = document.getElementById('speed-factor-slider');
const speedFactorValue = document.getElementById('speed-factor-value');
const previewVolumeSlider = document.getElementById('preview-volume-slider');
const previewVolumeValue = document.getElementById('preview-volume-value');
const tempCacheInfoEl = document.getElementById('temp-cache-info');
const browserCacheInfoEl = document.getElementById('browser-cache-info');
const clearTempCacheBtn = document.getElementById('clear-temp-cache-btn');
const resetBrowserCacheBtn = document.getElementById('reset-browser-cache-btn');

function highlightLangButtons() {
  langPicker.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === appSettings.language);
  });
}

function refreshResetCacheBtnLabel() {
  resetBrowserCacheBtn.textContent = appSettings.reset_browser_cache_on_next_launch
    ? t('settings.resetBrowserCacheCancel')
    : t('settings.resetBrowserCacheBtn');
}

async function saveSettings(updates) {
  try {
    appSettings = await apiJson('/api/settings', { method: 'PUT', body: JSON.stringify(updates) });
  } catch (err) {
    alert(t('settings.saveFailed', { message: err.message }));
  }
}

langPicker.querySelectorAll('.lang-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const lang = btn.dataset.lang;
    setLanguage(lang);
    highlightLangButtons();
    refreshResetCacheBtnLabel();
    renderLogView();
    await saveSettings({ language: lang });
  });
});

let speedSaveTimer = null;
speedFactorSlider.addEventListener('input', () => {
  const value = parseFloat(speedFactorSlider.value);
  speedFactorValue.textContent = `${value.toFixed(2)}x`;
  appSettings.speed_factor = value;
  clearTimeout(speedSaveTimer);
  speedSaveTimer = setTimeout(() => saveSettings({ speed_factor: value }), 400);
});

let volumeSaveTimer = null;
previewVolumeSlider.addEventListener('input', () => {
  const value = parseFloat(previewVolumeSlider.value);
  previewVolumeValue.textContent = `${Math.round(value * 100)}%`;
  appSettings.preview_volume = value;
  applyPreviewVolume(synthPlayer);
  clearTimeout(volumeSaveTimer);
  volumeSaveTimer = setTimeout(() => saveSettings({ preview_volume: value }), 400);
});

async function refreshCacheInfo() {
  try {
    const info = await apiJson('/api/settings/cache_info');
    tempCacheInfoEl.textContent = t('settings.tempCacheInfo', { size: formatBytes(info.temp_uploads_bytes) });
    browserCacheInfoEl.textContent = t('settings.browserCacheInfo', { size: formatBytes(info.browser_cache_bytes) });
  } catch (err) {
    // 조용히 무시(설정 탭을 보지 않을 때도 있으니 알림은 띄우지 않음)
  }
}

clearTempCacheBtn.addEventListener('click', async () => {
  clearTempCacheBtn.disabled = true;
  try {
    const result = await apiJson('/api/settings/clear_temp_cache', { method: 'POST' });
    alert(t('settings.tempCacheCleared', { size: formatBytes(result.freed_bytes) }));
    await refreshCacheInfo();
  } finally {
    clearTempCacheBtn.disabled = false;
  }
});

resetBrowserCacheBtn.addEventListener('click', async () => {
  const next = !appSettings.reset_browser_cache_on_next_launch;
  await saveSettings({ reset_browser_cache_on_next_launch: next });
  refreshResetCacheBtnLabel();
  alert(next ? t('settings.resetBrowserCacheScheduled') : t('settings.resetBrowserCacheCancelled'));
});

async function initSettings() {
  try {
    appSettings = await apiJson('/api/settings');
  } catch (err) {
    console.error(t('settings.loadFailed', { message: err.message }));
  }
  setLanguage(appSettings.language || 'ko');
  highlightLangButtons();
  speedFactorSlider.value = appSettings.speed_factor;
  speedFactorValue.textContent = `${appSettings.speed_factor.toFixed(2)}x`;
  previewVolumeSlider.value = appSettings.preview_volume;
  previewVolumeValue.textContent = `${Math.round(appSettings.preview_volume * 100)}%`;
  refreshResetCacheBtnLabel();
}

// ---- 시작 ----
async function init() {
  await initSettings();
  reloadCharacterList();
  pollEngineStatus();
  pollMonitorStatus();
}
init();
