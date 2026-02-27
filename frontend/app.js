// ACE-Step Wrangler — app.js

// ===== Utility =====

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ===== Slider display & fill =====

function updateSlider(slider) {
  const id = slider.id;
  const val = Number(slider.value);
  const min = Number(slider.min);
  const max = Number(slider.max);

  // Update filled track
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--fill', pct + '%');

  // Update value label
  const valueEl = document.getElementById(id + '-value');
  if (!valueEl) return;

  switch (id) {
    case 'duration': {
      const m = Math.floor(val / 60);
      const s = val % 60;
      valueEl.textContent = m > 0
        ? (s > 0 ? `${m}m ${s}s` : `${m}m`)
        : `${val}s`;
      break;
    }
    case 'lyric-adherence':
      valueEl.textContent = ['Loose', 'Med', 'Strict'][val];
      break;
    case 'creativity':
      valueEl.textContent = `${val}%`;
      break;
    case 'quality':
      valueEl.textContent = ['Raw', 'Balanced', 'Polished'][val];
      break;
    case 'inference-steps':
      valueEl.textContent = val;
      break;
    case 'guidance-lyric':
    case 'guidance-audio':
      valueEl.textContent = Number(val).toFixed(1);
      break;
  }
}

document.querySelectorAll('.slider').forEach(slider => {
  updateSlider(slider);
  slider.addEventListener('input', () => updateSlider(slider));
});

// Duration changes may affect the lyrics-too-long warning
document.getElementById('duration').addEventListener('input', checkLyricsWarning);

// ===== Style panel — tags, count, song params, preview =====

const tagsStatus   = document.getElementById('tags-status');
const tagsCountEl  = document.getElementById('tags-count');
const previewText  = document.getElementById('style-preview-text');
const styleText    = document.getElementById('style-text');

/** Returns the combined style prompt (tags + custom text) for the AceStep `style` field. */
function getStylePrompt() {
  const tags   = [...document.querySelectorAll('.tag.active')].map(t => t.textContent.trim()).join(', ');
  const custom = styleText.value.trim();
  if (tags && custom) return `${tags} — ${custom}`;
  return tags || custom;
}

/**
 * Returns a summary of non-empty song parameters, e.g. "C major, 120 BPM, 4/4 time".
 * Time signature is only appended when key or BPM is also set.
 */
function getSongParamsSummary() {
  const root    = document.getElementById('key-root').value;
  const mode    = document.getElementById('key-mode').value;
  const bpmVal  = document.getElementById('bpm').value.trim();
  const timeSig = document.getElementById('time-sig').value;

  const parts = [];
  if (root)   parts.push(`${root} ${mode}`);
  if (bpmVal) parts.push(`${bpmVal} BPM`);
  if (parts.length > 0) parts.push(`${timeSig} time`);
  return parts.join(', ');
}

function updateStyleState() {
  const selected = document.querySelectorAll('.tag.active');
  const n = selected.length;

  // Tag count badge
  if (n > 0) {
    tagsCountEl.textContent = `${n} selected`;
    tagsStatus.classList.remove('hidden');
  } else {
    tagsStatus.classList.add('hidden');
  }

  // Style preview — combine tags/custom text with song params
  const stylePrompt = getStylePrompt();
  const songParams  = getSongParamsSummary();
  const parts = [];
  if (stylePrompt) parts.push(stylePrompt);
  if (songParams)  parts.push(songParams);
  const preview = parts.join(' · ');

  if (preview) {
    previewText.textContent = preview;
    previewText.classList.remove('empty');
  } else {
    previewText.textContent = 'Nothing set — add tags or a description';
    previewText.classList.add('empty');
  }
}

document.querySelectorAll('.tag').forEach(tag => {
  tag.addEventListener('click', () => {
    tag.classList.toggle('active');
    updateStyleState();
  });
});

document.getElementById('clear-tags-btn').addEventListener('click', () => {
  document.querySelectorAll('.tag.active').forEach(t => t.classList.remove('active'));
  updateStyleState();
});

styleText.addEventListener('input', updateStyleState);

updateStyleState();

// ===== Lyrics line/char count =====

const lyricsText   = document.getElementById('lyrics-text');
const lyricsCount  = document.getElementById('lyrics-count');
const lyricsWarning = document.getElementById('lyrics-warning');

function updateLyricsCount() {
  const text = lyricsText.value;
  const chars = text.length;
  const lines = text === '' ? 0 : text.split('\n').length;
  lyricsCount.textContent = `${lines} line${lines !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
}

lyricsText.addEventListener('input', updateLyricsCount);
updateLyricsCount();

// ===== Lyrics warnings =====

let _fileErrorTimer = null;

/**
 * Show or hide the "lyrics may be too long" warning.
 * Heuristic: count words in non-section-header lines, assume 100 wpm singing
 * pace (0.6 s/word). If estimated minimum duration > selected duration, warn.
 * Does nothing if a file-error message is currently showing.
 */
function checkLyricsWarning() {
  if (_fileErrorTimer) return; // file-error overrides — let its timer handle restore

  const text = lyricsText.value;
  if (!text.trim()) {
    lyricsWarning.classList.add('hidden');
    return;
  }

  const contentLines = text.split('\n').filter(
    line => line.trim() && !line.trim().startsWith('[')
  );
  const wordCount = contentLines.join(' ')
    .split(/\s+/).filter(w => w.length > 0).length;

  const duration = Number(document.getElementById('duration').value);
  const minSeconds = wordCount * 0.6; // 100 wpm → 0.6 s/word

  if (wordCount > 0 && minSeconds > duration) {
    lyricsWarning.textContent = '⚠ May be too long for selected duration';
    lyricsWarning.classList.remove('hidden');
  } else {
    lyricsWarning.classList.add('hidden');
  }
}

// ===== Clear button =====

document.getElementById('clear-btn').addEventListener('click', () => {
  lyricsText.value = '';
  updateLyricsCount();
  lyricsText.focus();
});

// ===== Load file =====

const lyricsPanel = document.getElementById('lyrics-panel');

function loadTextFile(file) {
  if (!file || !file.type.startsWith('text/') && !file.name.endsWith('.lrc') && !file.name.endsWith('.txt')) {
    showFileError('Only .txt or .lrc files are supported.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    lyricsText.value = e.target.result;
    updateLyricsCount();
    checkLyricsWarning();
    updateGenerateState();
    lyricsText.focus();
  };
  reader.onerror = () => showFileError('Could not read file.');
  reader.readAsText(file);
}

function showFileError(msg) {
  if (_fileErrorTimer) clearTimeout(_fileErrorTimer);
  lyricsWarning.textContent = '⚠ ' + msg;
  lyricsWarning.classList.remove('hidden');
  _fileErrorTimer = setTimeout(() => {
    _fileErrorTimer = null;
    checkLyricsWarning(); // restore correct warning state
  }, 4000);
}

// File picker
document.getElementById('load-file-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.lrc,text/plain';
  input.addEventListener('change', () => {
    if (input.files[0]) loadTextFile(input.files[0]);
  });
  input.click();
});

// Drag-and-drop onto lyrics panel
lyricsPanel.addEventListener('dragenter', (e) => {
  e.preventDefault();
  lyricsPanel.classList.add('drag-over');
});

lyricsPanel.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

lyricsPanel.addEventListener('dragleave', (e) => {
  // Only remove class when leaving the panel itself, not a child element
  if (!lyricsPanel.contains(e.relatedTarget)) {
    lyricsPanel.classList.remove('drag-over');
  }
});

lyricsPanel.addEventListener('drop', (e) => {
  e.preventDefault();
  lyricsPanel.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadTextFile(file);
});

// ===== Advanced panel — model selection & batch size constraint =====

const BATCH_LIMITS = {
  '16': { heavy: 1, normal: 2 },
  '24': { heavy: 2, normal: 4 },
  '32': { heavy: 4, normal: 8 },
};

function isHeavyCombo() {
  const model = document.getElementById('gen-model').value;
  const lm    = document.getElementById('lm-model').value;
  return (model === 'sft' || model === 'base') && lm === '4b';
}

function updateBatchLimit() {
  const tier       = document.getElementById('vram-tier').value;
  const max        = BATCH_LIMITS[tier][isHeavyCombo() ? 'heavy' : 'normal'];
  const batchInput = document.getElementById('batch-size');
  const batchNote  = document.getElementById('batch-note');

  batchInput.max = max;
  if (Number(batchInput.value) > max) batchInput.value = max;

  if (max === 1) {
    batchInput.disabled = true;
    batchNote.textContent = 'Locked to 1 — this model + VRAM combination requires it.';
    batchNote.classList.remove('hidden');
  } else {
    batchInput.disabled = false;
    batchNote.textContent = '';
    batchNote.classList.add('hidden');
  }
}

['gen-model', 'lm-model', 'vram-tier'].forEach(id =>
  document.getElementById(id).addEventListener('change', updateBatchLimit)
);

updateBatchLimit();

// ===== Advanced panel — friendly ↔ raw slider sync =====
// Friendly sliders (quality, lyric-adherence) drive preset values on the raw
// advanced sliders. The user can then fine-tune the raw sliders independently.
// buildPayload() always reads the raw slider values, so fine-tuning is preserved.

const _LYRIC_STEPS_MAP = [3.0, 7.0, 12.0]; // lyric-adherence → guidance_scale
const _QUALITY_STEPS_MAP = [15, 60, 120];   // quality → inference_steps

function syncAdvancedFromFriendly() {
  const adherence     = Number(document.getElementById('lyric-adherence').value);
  const quality       = Number(document.getElementById('quality').value);
  const guidanceLyric = document.getElementById('guidance-lyric');
  const infSteps      = document.getElementById('inference-steps');

  guidanceLyric.value = _LYRIC_STEPS_MAP[adherence];
  updateSlider(guidanceLyric);

  infSteps.value = _QUALITY_STEPS_MAP[quality];
  updateSlider(infSteps);
}

// Sync on page load so raw sliders start consistent with friendly defaults
syncAdvancedFromFriendly();

// When a friendly slider moves, update the corresponding raw slider
document.getElementById('lyric-adherence').addEventListener('input', () => {
  const val = Number(document.getElementById('lyric-adherence').value);
  const guidanceLyric = document.getElementById('guidance-lyric');
  guidanceLyric.value = _LYRIC_STEPS_MAP[val];
  updateSlider(guidanceLyric);
});

document.getElementById('quality').addEventListener('input', () => {
  const val = Number(document.getElementById('quality').value);
  const infSteps = document.getElementById('inference-steps');
  infSteps.value = _QUALITY_STEPS_MAP[val];
  updateSlider(infSteps);
});

// ===== Generate — validation & ready state =====

const generateBtn  = document.getElementById('generate-btn');
const generateHint = document.getElementById('generate-hint');

function hasContent() {
  return lyricsText.value.trim().length > 0 || getStylePrompt().length > 0;
}

function updateGenerateState() {
  if (hasContent()) {
    generateBtn.classList.add('ready');
    generateHint.textContent = '';
  } else {
    generateBtn.classList.remove('ready');
  }
}

// Collect the full request payload from all UI controls
function buildPayload() {
  const seedRaw = document.getElementById('seed').value.trim();
  const bpmRaw  = document.getElementById('bpm').value.trim();
  const keyRoot = document.getElementById('key-root').value;
  const keyMode = document.getElementById('key-mode').value;
  return {
    style:           getStylePrompt(),
    lyrics:          lyricsText.value,
    duration:        Number(document.getElementById('duration').value),
    lyric_adherence: Number(document.getElementById('lyric-adherence').value),
    creativity:      Number(document.getElementById('creativity').value),
    quality:         Number(document.getElementById('quality').value),
    seed:            seedRaw !== '' ? parseInt(seedRaw, 10) : null,
    gen_model:       document.getElementById('gen-model').value,
    batch_size:      Number(document.getElementById('batch-size').value),
    scheduler:       document.getElementById('scheduler').value,
    audio_format:    document.getElementById('audio-format').value,
    key:             keyRoot ? `${keyRoot} ${keyMode}` : '',
    bpm:             bpmRaw !== '' ? parseInt(bpmRaw, 10) : null,
    time_signature:  document.getElementById('time-sig').value,
    // Raw advanced slider values — override the friendly preset mappings
    guidance_scale_raw:   Number(document.getElementById('guidance-lyric').value),
    audio_guidance_scale: Number(document.getElementById('guidance-audio').value),
    inference_steps_raw:  Number(document.getElementById('inference-steps').value),
  };
}

let _pollInterval = null;

// Ctrl/Cmd+Enter keyboard shortcut — trigger Generate from anywhere in the UI
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    generateBtn.click();
  }
});

// Manage the three output panel states: idle / generating / cards
function setOutputState(state) {
  document.getElementById('output-idle').classList.toggle('hidden', state !== 'idle');
  document.getElementById('output-generating').classList.toggle('hidden', state !== 'generating');
  document.getElementById('output-cards').classList.toggle('hidden', state !== 'cards');
}

function setGenerating(on) {
  generateBtn.textContent = on ? 'Generating…' : '▶ Generate';
  generateBtn.disabled    = on;
  if (on) setOutputState('generating');
}

document.getElementById('cancel-btn').addEventListener('click', () => {
  if (_pollInterval) clearInterval(_pollInterval);
  _pollInterval = null;
  setGenerating(false);
  setOutputState('idle');
});

function createResultCard(taskId, index, result, total, fmt) {
  const card = document.createElement('div');
  card.className = 'result-card';

  if (total > 1) {
    const label = document.createElement('div');
    label.className = 'card-label';
    label.textContent = `Result ${index + 1} of ${total}`;
    card.appendChild(label);
  }

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = '/audio?path=' + encodeURIComponent(result.audio_url);
  card.appendChild(audio);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const dlAudio = document.createElement('a');
  dlAudio.className = 'ghost-btn';
  dlAudio.href      = `/download/${taskId}/${index}/audio`;
  dlAudio.download  = `acestep-${taskId.slice(0, 8)}-${index + 1}.${fmt}`;
  dlAudio.textContent = 'Download audio';

  const dlJson = document.createElement('a');
  dlJson.className = 'ghost-btn';
  dlJson.href      = `/download/${taskId}/${index}/json`;
  dlJson.download  = `acestep-${taskId.slice(0, 8)}-${index + 1}.json`;
  dlJson.textContent = 'Download JSON';

  actions.appendChild(dlAudio);
  actions.appendChild(dlJson);
  card.appendChild(actions);
  return card;
}

function showResultCards(taskId, results, fmt) {
  const container = document.getElementById('output-cards');
  container.innerHTML = '';
  results.forEach((result, i) => {
    container.appendChild(createResultCard(taskId, i, result, results.length, fmt));
  });
  setOutputState('cards');
  // Brief amber pulse on the output panel to draw the user's eye downward
  const panel = document.getElementById('output-panel');
  panel.classList.add('results-ready');
  setTimeout(() => panel.classList.remove('results-ready'), 1200);
}

generateBtn.addEventListener('click', async () => {
  if (!hasContent()) {
    generateHint.textContent = 'Add some lyrics or a style description first.';
    return;
  }
  generateHint.textContent = '';

  const payload = buildPayload();
  setGenerating(true);

  let taskId;
  try {
    const res = await fetch('/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    ({ task_id: taskId } = await res.json());
  } catch (err) {
    generateHint.textContent = `Error: ${err.message}`;
    setGenerating(false);
    setOutputState('idle');
    return;
  }

  // Poll /status/{task_id} every 2 seconds
  _pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/status/${taskId}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();

      if (data.status === 'done') {
        clearInterval(_pollInterval);
        showResultCards(taskId, data.results, payload.audio_format);
        setGenerating(false);
      } else if (data.status === 'error') {
        clearInterval(_pollInterval);
        setGenerating(false);
        setOutputState('idle');
        generateHint.textContent = 'Generation failed. Check AceStep logs.';
      }
      // 'processing' → keep polling
    } catch (err) {
      clearInterval(_pollInterval);
      setGenerating(false);
      setOutputState('idle');
      generateHint.textContent = `Polling error: ${err.message}`;
    }
  }, 2000);
});

// ===== Auto Duration =====

const autoDurationBtn = document.getElementById('auto-duration-btn');
const durationSlider  = document.getElementById('duration');
let _autoOn = false;

async function computeAutoDuration() {
  if (!_autoOn) return;
  const bpmRaw  = document.getElementById('bpm').value.trim();
  const timeSig = document.getElementById('time-sig').value;
  const lmModel = document.getElementById('lm-model').value;
  try {
    const res = await fetch('/estimate-duration', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        lyrics:         lyricsText.value,
        bpm:            bpmRaw !== '' ? parseInt(bpmRaw, 10) : null,
        time_signature: timeSig,
        lm_model:       lmModel,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const secs = Math.max(10, Math.min(240, Math.round(data.seconds / 5) * 5));
    durationSlider.value = secs;
    updateSlider(durationSlider);
    checkLyricsWarning();
  } catch (_) {
    // Silently fail — leave slider as-is
  }
}

const debouncedComputeAutoDuration = debounce(computeAutoDuration, 600);

autoDurationBtn.addEventListener('click', () => {
  _autoOn = !_autoOn;
  autoDurationBtn.classList.toggle('active', _autoOn);
  autoDurationBtn.textContent = _autoOn ? 'Auto ✓' : 'Auto';
  durationSlider.disabled = _autoOn;
  if (_autoOn) computeAutoDuration();
});

// ===== Event wiring — keep all state in sync =====

lyricsText.addEventListener('input', () => {
  updateLyricsCount();
  checkLyricsWarning();
  updateGenerateState();
  debouncedComputeAutoDuration();
});

styleText.addEventListener('input', () => {
  updateStyleState();
  updateGenerateState();
});

document.querySelectorAll('.tag').forEach(tag =>
  tag.addEventListener('click', updateGenerateState)
);
document.getElementById('clear-tags-btn').addEventListener('click', updateGenerateState);
document.getElementById('clear-btn').addEventListener('click', () => {
  updateLyricsCount();
  checkLyricsWarning();
  updateGenerateState();
});

// Song parameter changes → update preview, generate state, and auto duration
['key-root', 'key-mode', 'time-sig'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    updateStyleState();
    updateGenerateState();
    debouncedComputeAutoDuration();
  });
});
document.getElementById('bpm').addEventListener('input', () => {
  updateStyleState();
  updateGenerateState();
  debouncedComputeAutoDuration();
});

updateGenerateState();
