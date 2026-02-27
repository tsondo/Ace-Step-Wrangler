// ACE-Step Wrangler — app.js
// Stage 4: Controls validation — ready state, inline hint, content change hooks.

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

// ===== Style panel — tags, count, preview =====

const tagsStatus   = document.getElementById('tags-status');
const tagsCountEl  = document.getElementById('tags-count');
const previewText  = document.getElementById('style-preview-text');
const styleText    = document.getElementById('style-text');

/** Returns the combined style prompt (tags + custom text) for use in stage 5. */
function getStylePrompt() {
  const tags   = [...document.querySelectorAll('.tag.active')].map(t => t.textContent.trim()).join(', ');
  const custom = styleText.value.trim();
  if (tags && custom) return `${tags} — ${custom}`;
  return tags || custom;
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

  // Style preview
  const prompt = getStylePrompt();
  if (prompt) {
    previewText.textContent = prompt;
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

const lyricsText = document.getElementById('lyrics-text');
const lyricsCount = document.getElementById('lyrics-count');

function updateLyricsCount() {
  const text = lyricsText.value;
  const chars = text.length;
  const lines = text === '' ? 0 : text.split('\n').length;
  lyricsCount.textContent = `${lines} line${lines !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
}

lyricsText.addEventListener('input', updateLyricsCount);
updateLyricsCount();

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
    updateGenerateState();
    lyricsText.focus();
  };
  reader.onerror = () => showFileError('Could not read file.');
  reader.readAsText(file);
}

function showFileError(msg) {
  const warning = document.getElementById('lyrics-warning');
  warning.textContent = '⚠ ' + msg;
  warning.classList.remove('hidden');
  setTimeout(() => {
    warning.textContent = '⚠ May be too long for selected duration';
    warning.classList.add('hidden');
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
  };
}

let _pollInterval = null;

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
        setGenerating(false);
        showResultCards(taskId, data.results, payload.audio_format);
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

// Keep state in sync with all content-affecting inputs
lyricsText.addEventListener('input', updateGenerateState);
styleText.addEventListener('input', updateGenerateState);
document.querySelectorAll('.tag').forEach(tag =>
  tag.addEventListener('click', updateGenerateState)
);
document.getElementById('clear-tags-btn').addEventListener('click', updateGenerateState);
document.getElementById('clear-btn').addEventListener('click', updateGenerateState);

updateGenerateState();
