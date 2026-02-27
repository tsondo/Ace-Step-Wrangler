// ACE-Step Wrangler — app.js

// ===== Custom Audio Player =====
// StemForge-style transport: Rewind / Play / Stop (separate, not a toggle).
// Stop saves position; Rewind jumps to 0 (keeps playing if already playing);
// scrubber click seeks AND starts playback; end of track resets to 0.

const _playerRegistry = new Set(); // tracks every live audio element

function _stopOthers(except) {
  _playerRegistry.forEach(el => { if (el !== except && !el.paused) el.pause(); });
}

function _fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function initAudioPlayer(audioEl, playerEl) {
  _playerRegistry.add(audioEl);

  const rewindBtn = playerEl.querySelector('.player-rewind');
  const playBtn   = playerEl.querySelector('.player-play');
  const stopBtn   = playerEl.querySelector('.player-stop');
  const scrubber  = playerEl.querySelector('.player-scrubber');
  const fill      = playerEl.querySelector('.player-scrubber-fill');
  const timeEl    = playerEl.querySelector('.player-time');

  function updateProgress() {
    const cur = audioEl.currentTime || 0;
    const dur = isFinite(audioEl.duration) ? audioEl.duration : 0;
    fill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
    timeEl.textContent = _fmtTime(cur) + ' / ' + _fmtTime(dur);
  }

  function syncStopBtn() {
    stopBtn.disabled = audioEl.paused;
  }

  // Play — start from current position, stop all other players
  playBtn.addEventListener('click', () => {
    _stopOthers(audioEl);
    audioEl.play();
  });

  // Stop — pause and save position (next Play resumes from here)
  stopBtn.addEventListener('click', () => {
    audioEl.pause();
  });

  // Rewind — jump to 0; keep playing if already playing, else just seek
  rewindBtn.addEventListener('click', () => {
    audioEl.currentTime = 0;
    updateProgress();
  });

  // Scrubber click — seek to position AND start playback immediately
  scrubber.addEventListener('click', (e) => {
    const dur = audioEl.duration;
    if (!dur || !isFinite(dur)) return;
    const rect = scrubber.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    audioEl.currentTime = (x / rect.width) * dur;
    _stopOthers(audioEl);
    audioEl.play();
  });

  // End of track — stop and reset to 0
  audioEl.addEventListener('ended', () => {
    audioEl.currentTime = 0;
    updateProgress();
    syncStopBtn();
  });

  audioEl.addEventListener('play',        syncStopBtn);
  audioEl.addEventListener('pause',       syncStopBtn);
  audioEl.addEventListener('timeupdate',  updateProgress);
  audioEl.addEventListener('loadedmetadata', updateProgress);

  syncStopBtn();
  updateProgress();
}

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

// ===== Mode selector (Create / Rework) =====

let _currentMode = 'create';

const modeBtns     = document.querySelectorAll('.mode-btn');
const createPanel  = document.getElementById('create-panel');
const reworkPanel  = document.getElementById('rework-panel');

function switchMode(mode) {
  // Block mode switch during active generation
  const genBtn = document.getElementById('generate-btn');
  if (genBtn && genBtn.disabled) return;

  _currentMode = mode;
  modeBtns.forEach(btn => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  createPanel.classList.toggle('hidden', mode !== 'create');
  reworkPanel.classList.toggle('hidden', mode !== 'rework');

  // Waveform: clear when switching to create; rework waveform loads via upload/sendToRework
  if (mode === 'create') {
    clearWaveform();
    setOutputState('idle');
  }

  updateControlsForMode(mode);
  updateGenerateState();
}

function updateControlsForMode(mode) {
  const genBtn = document.getElementById('generate-btn');
  if (genBtn && !genBtn.disabled) {
    if (mode === 'create') {
      genBtn.textContent = '▶ Generate';
    } else {
      genBtn.textContent = _reworkApproach === 'cover' ? '▶ Reimagine' : '▶ Repaint';
    }
  }

  // Lock duration to source audio length in rework mode
  const durationEl = document.getElementById('duration');
  let lockNote = document.getElementById('duration-lock-note');
  if (mode === 'rework' && _uploadedAudioDuration) {
    const dur = Math.max(10, Math.min(600, Math.round(_uploadedAudioDuration / 5) * 5));
    durationEl.value = dur;
    updateSlider(durationEl);
    durationEl.disabled = true;
    if (!lockNote) {
      lockNote = document.createElement('p');
      lockNote.id = 'duration-lock-note';
      lockNote.className = 'duration-lock-note';
      durationEl.parentElement.appendChild(lockNote);
    }
    lockNote.textContent = 'Locked to source audio length';
    lockNote.classList.remove('hidden');
  } else {
    if (mode === 'create') durationEl.disabled = _autoOn;
    if (lockNote) lockNote.classList.add('hidden');
  }
}

let _lastGenResult = null; // { audioPath, lyrics } — most recent completed generation

modeBtns.forEach(btn =>
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    // Clicking Rework with nothing loaded auto-loads the last generation
    if (mode === 'rework' && !_uploadedAudioPath && _lastGenResult) {
      loadAudioIntoRework(_lastGenResult.audioPath, 'Generated audio', _lastGenResult.lyrics);
    } else {
      switchMode(mode);
    }
  })
);

// ===== Rework panel — audio upload, approach selector =====

let _uploadedAudioPath = null;
let _uploadedAudioDuration = null;
let _reworkApproach = 'cover';

const audioUploadZone = document.getElementById('audio-upload-zone');
const uploadPrompt    = document.getElementById('upload-prompt');
const uploadLoaded    = document.getElementById('upload-loaded');
const audioPreview    = document.getElementById('audio-preview');

// Initialise custom players for the two static audio elements
initAudioPlayer(audioPreview, document.getElementById('audio-preview-player'));
initAudioPlayer(
  document.getElementById('lyrics-audio-preview'),
  document.getElementById('lyrics-player'),
);

function handleAudioUpload(file) {
  if (!file || !file.type.startsWith('audio/')) {
    const hint = document.getElementById('generate-hint');
    if (hint) hint.textContent = 'Only audio files are supported.';
    return;
  }

  // Client-side preview
  const objUrl = URL.createObjectURL(file);
  audioPreview.src = objUrl;
  audioPreview.onloadedmetadata = () => {
    _uploadedAudioDuration = audioPreview.duration;
    document.getElementById('upload-duration').textContent =
      formatDuration(audioPreview.duration);
    // Set region end to audio duration
    document.getElementById('region-end').value = Math.round(audioPreview.duration * 10) / 10;
    document.getElementById('region-end').max = Math.round(audioPreview.duration * 10) / 10;
    document.getElementById('region-start').max = Math.round(audioPreview.duration * 10) / 10;
  };

  document.getElementById('upload-filename').textContent = file.name;
  uploadPrompt.classList.add('hidden');
  uploadLoaded.classList.remove('hidden');

  // Upload to server
  const formData = new FormData();
  formData.append('file', file);
  fetch('/upload-audio', { method: 'POST', body: formData })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(data => {
      _uploadedAudioPath = data.path;
      updateGenerateState();
      loadWaveformForRework(data.path, _uploadedAudioDuration, lyricsText.value);
    })
    .catch(err => {
      removeAudio();
      const hint = document.getElementById('generate-hint');
      if (hint) hint.textContent = `Upload failed: ${err.message}`;
    });
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function removeAudio() {
  _uploadedAudioPath = null;
  _uploadedAudioDuration = null;
  audioPreview.src = '';
  document.getElementById('upload-filename').textContent = '';
  document.getElementById('upload-duration').textContent = '';
  uploadPrompt.classList.remove('hidden');
  uploadLoaded.classList.add('hidden');
  clearWaveform();
  setOutputState('idle');
  updateGenerateState();
}

document.getElementById('browse-audio-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.addEventListener('change', () => {
    if (input.files[0]) handleAudioUpload(input.files[0]);
  });
  input.click();
});

document.getElementById('remove-audio-btn').addEventListener('click', removeAudio);

// Drag-and-drop on upload zone
audioUploadZone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  audioUploadZone.classList.add('drag-over');
});

audioUploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

audioUploadZone.addEventListener('dragleave', (e) => {
  if (!audioUploadZone.contains(e.relatedTarget)) {
    audioUploadZone.classList.remove('drag-over');
  }
});

audioUploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  audioUploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleAudioUpload(file);
});

// Approach selector
const approachBtns       = document.querySelectorAll('.approach-btn');
const coverStrengthGroup = document.getElementById('cover-strength-group');
const regionInputs       = document.getElementById('region-inputs');

function switchApproach(approach) {
  _reworkApproach = approach;
  approachBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.approach === approach));
  coverStrengthGroup.classList.toggle('hidden', approach !== 'cover');
  regionInputs.classList.toggle('hidden', approach !== 'repaint');

  // Update waveform selection visibility: show handles for Fix & Blend, hide for Reimagine
  if (_waveformData && _waveformDuration > 0) {
    if (approach === 'repaint') {
      updateWaveformVisuals();
    } else {
      waveformSelection.classList.add('hidden');
      wfSelectionInfo.textContent = '';
      drawWaveform(); // redraw without selection highlight
    }
  }

  updateControlsForMode(_currentMode);
  updateGenerateState();
}

// Region validation (start < end, end ≤ duration)
function validateRegion() {
  const start = Number(document.getElementById('region-start').value);
  const end   = Number(document.getElementById('region-end').value);
  const hint  = document.getElementById('generate-hint');
  if (_currentMode === 'rework' && _reworkApproach === 'repaint') {
    if (start >= end && end > 0) {
      hint.textContent = 'Region start must be before end.';
      return false;
    }
    if (_uploadedAudioDuration && end > _uploadedAudioDuration) {
      hint.textContent = 'Region end exceeds audio duration.';
      return false;
    }
  }
  return true;
}

document.getElementById('region-start').addEventListener('input', validateRegion);
document.getElementById('region-end').addEventListener('input', validateRegion);

approachBtns.forEach(btn =>
  btn.addEventListener('click', () => switchApproach(btn.dataset.approach))
);

// Cover strength slider
const coverStrengthSlider = document.getElementById('cover-strength');
const coverStrengthValue  = document.getElementById('cover-strength-value');
coverStrengthSlider.addEventListener('input', () => {
  const val = Number(coverStrengthSlider.value);
  const pct = ((val - Number(coverStrengthSlider.min)) / (Number(coverStrengthSlider.max) - Number(coverStrengthSlider.min))) * 100;
  coverStrengthSlider.style.setProperty('--fill', pct + '%');
  coverStrengthValue.textContent = `${val}%`;
});
// Init fill
coverStrengthSlider.dispatchEvent(new Event('input'));

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

// ===== Lyrics mode (With Lyrics / Instrumental) =====

let _lyricsMode = 'lyrics'; // 'lyrics' | 'instrumental'

const lyricsModeTabs   = document.querySelectorAll('.lyrics-mode-tab');
const lyricsWriteArea  = document.getElementById('lyrics-write-area');
const lyricsActions    = document.getElementById('lyrics-actions');
const instrumentalNote = document.getElementById('instrumental-note');

function switchLyricsMode(mode) {
  _lyricsMode = mode;
  lyricsModeTabs.forEach(btn => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  const isInstrumental = mode === 'instrumental';
  lyricsWriteArea.classList.toggle('hidden', isInstrumental);
  lyricsActions.classList.toggle('hidden', isInstrumental);
  instrumentalNote.classList.toggle('hidden', !isInstrumental);
  updateGenerateState();
}

lyricsModeTabs.forEach(btn =>
  btn.addEventListener('click', () => switchLyricsMode(btn.dataset.mode))
);

// --- Load any audio path into Rework mode ---

function loadAudioIntoRework(audioPath, label, lyrics, knownDuration) {
  _uploadedAudioPath = audioPath;
  audioPreview.src = '/audio?path=' + encodeURIComponent(audioPath);

  function applyDuration(dur) {
    if (!dur || !isFinite(dur)) return;
    _uploadedAudioDuration = dur;
    document.getElementById('upload-duration').textContent = formatDuration(dur);
    const d = Math.round(dur * 10) / 10;
    document.getElementById('region-end').value = d;
    document.getElementById('region-end').max = d;
    document.getElementById('region-start').max = d;
  }

  if (knownDuration) {
    applyDuration(knownDuration);
  } else {
    audioPreview.addEventListener('loadedmetadata', function onMeta() {
      applyDuration(audioPreview.duration);
      audioPreview.removeEventListener('loadedmetadata', onMeta);
    });
  }

  document.getElementById('upload-filename').textContent = label || 'Generated audio';
  uploadPrompt.classList.add('hidden');
  uploadLoaded.classList.remove('hidden');

  switchMode('rework');
  updateControlsForMode('rework');
  updateGenerateState();
  loadWaveformForRework(audioPath, _uploadedAudioDuration || null, lyrics || '');
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

// ===== Waveform Timeline =====

let _waveformData = null;     // Float32Array of downsampled peaks
let _waveformDuration = 0;    // audio duration in seconds
let _waveformSections = [];   // [{name, start, end, bars}]
let _waveformAudioUrl = '';   // current audio URL for the waveform
let _waveformAnimFrame = null;

const waveformCanvas    = document.getElementById('waveform-canvas');
const waveformCtx       = waveformCanvas.getContext('2d');
const waveformSelection = document.getElementById('waveform-selection');
const waveformPlayhead  = document.getElementById('waveform-playhead');
const wfRegionStart     = document.getElementById('wf-region-start');
const wfRegionEnd       = document.getElementById('wf-region-end');
const wfSelectionInfo   = document.getElementById('wf-selection-info');
const waveformContainer = document.querySelector('.waveform-container');

function getComputedColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

async function renderWaveform(audioUrl) {
  if (!audioUrl) return;
  _waveformAudioUrl = audioUrl;

  const loadingEl = document.getElementById('waveform-loading');
  loadingEl.classList.remove('hidden');

  try {
    const resp = await fetch(audioUrl);
    if (!resp.ok) throw new Error(resp.statusText);
    const arrayBuf = await resp.arrayBuffer();

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    audioCtx.close();

    _waveformDuration = audioBuf.duration;

    // Mono mixdown
    const channels = audioBuf.numberOfChannels;
    const length = audioBuf.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / channels;
      }
    }

    // Downsample to canvas width (one peak per 2-3 pixels)
    resizeCanvas();
    const barCount = Math.floor(waveformCanvas.width / (2 * (window.devicePixelRatio || 1)));
    const samplesPerBar = Math.floor(length / barCount);
    _waveformData = new Float32Array(barCount);
    for (let i = 0; i < barCount; i++) {
      let peak = 0;
      const offset = i * samplesPerBar;
      for (let j = 0; j < samplesPerBar; j++) {
        const abs = Math.abs(mono[offset + j] || 0);
        if (abs > peak) peak = abs;
      }
      _waveformData[i] = peak;
    }

    drawWaveform();
  } catch (err) {
    console.error('Waveform decode error:', err);
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = waveformCanvas.parentElement.getBoundingClientRect();
  waveformCanvas.width = rect.width * dpr;
  waveformCanvas.height = rect.height * dpr;
  waveformCanvas.style.width = rect.width + 'px';
  waveformCanvas.style.height = rect.height + 'px';
  waveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawWaveform() {
  if (!_waveformData) return;

  const w = waveformCanvas.parentElement.getBoundingClientRect().width;
  const h = waveformCanvas.parentElement.getBoundingClientRect().height;
  const barCount = _waveformData.length;
  if (barCount === 0) return;

  const barWidth = w / barCount;
  const selStart = Number(wfRegionStart.value) || 0;
  const selEnd = Number(wfRegionEnd.value) || 0;
  // Only highlight the selection in Fix & Blend mode; Reimagine ignores the region
  const hasSelection = selEnd > selStart && _reworkApproach === 'repaint';

  const mutedColor = getComputedColor('--text-muted');
  const accentColor = getComputedColor('--accent');

  waveformCtx.clearRect(0, 0, w, h);

  const midY = h / 2;
  const maxBarH = h * 0.85;

  for (let i = 0; i < barCount; i++) {
    const x = i * barWidth;
    const barH = Math.max(1, _waveformData[i] * maxBarH);

    // Determine if this bar is in the selected region
    const barSecs = (i / barCount) * _waveformDuration;
    const inSelection = hasSelection && barSecs >= selStart && barSecs <= selEnd;

    waveformCtx.fillStyle = inSelection ? accentColor : mutedColor;
    waveformCtx.fillRect(x, midY - barH / 2, Math.max(1, barWidth - 0.5), barH);
  }
}

function renderSections(sections) {
  _waveformSections = sections;
  const container = document.getElementById('waveform-sections');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!sections.length || !_waveformDuration) return;

  sections.forEach((sec, i) => {
    // Section stripe (alternating background)
    const stripe = document.createElement('div');
    stripe.className = 'waveform-section-stripe';
    stripe.style.left = (sec.start / _waveformDuration * 100) + '%';
    stripe.style.width = ((sec.end - sec.start) / _waveformDuration * 100) + '%';
    container.appendChild(stripe);

    // Section label pill
    const label = document.createElement('div');
    label.className = 'waveform-section-label';
    label.textContent = sec.name;
    label.style.left = (sec.start / _waveformDuration * 100) + '%';
    label.dataset.index = i;
    label.addEventListener('click', (e) => {
      if (e.shiftKey && _waveformSections.length > 0) {
        // Shift+click: extend selection
        const curStart = Number(wfRegionStart.value) || 0;
        const curEnd = Number(wfRegionEnd.value) || 0;
        const newStart = Math.min(curStart, sec.start);
        const newEnd = Math.max(curEnd, sec.end);
        setWaveformRegion(newStart, newEnd);
      } else {
        setWaveformRegion(sec.start, sec.end);
      }
    });
    container.appendChild(label);
  });
}

// --- Waveform region selection (drag + input sync) ---

function setWaveformRegion(start, end) {
  start = Math.max(0, Math.round(start * 10) / 10);
  end = Math.min(_waveformDuration, Math.round(end * 10) / 10);
  if (end < start) end = start;

  wfRegionStart.value = start.toFixed(1);
  wfRegionEnd.value = end.toFixed(1);

  // Sync with rework panel region inputs (bidirectional)
  document.getElementById('region-start').value = start.toFixed(1);
  document.getElementById('region-end').value = end.toFixed(1);

  updateWaveformVisuals();
}

function updateWaveformVisuals() {
  const start = Number(wfRegionStart.value) || 0;
  const end = Number(wfRegionEnd.value) || 0;

  if (end > start && _waveformDuration > 0) {
    const leftPct = (start / _waveformDuration) * 100;
    const widthPct = ((end - start) / _waveformDuration) * 100;
    waveformSelection.style.left = leftPct + '%';
    waveformSelection.style.width = widthPct + '%';
    waveformSelection.classList.remove('hidden');

    // Selection info text
    const durSecs = end - start;
    const sectionNames = _waveformSections
      .filter(s => s.start >= start - 0.5 && s.end <= end + 0.5)
      .map(s => s.name);
    const secLabel = sectionNames.length ? sectionNames.join(' + ') + ' \u00b7 ' : '';
    wfSelectionInfo.textContent = secLabel + formatTimecode(start) + ' \u2013 ' + formatTimecode(end) + ' (' + durSecs.toFixed(1) + 's)';
  } else {
    waveformSelection.classList.add('hidden');
    wfSelectionInfo.textContent = '';
  }

  drawWaveform();
}

function formatTimecode(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const frac = Math.round((secs % 1) * 10);
  return m + ':' + String(s).padStart(2, '0') + '.' + frac;
}

// Drag-to-select on waveform canvas
let _wfDragging = false;
let _wfDragStart = 0;
let _wfHandleDrag = null; // 'left' | 'right' | null

waveformContainer.addEventListener('mousedown', (e) => {
  // Check if drag started on a handle
  const target = e.target;
  if (target.classList.contains('waveform-handle-left')) {
    _wfHandleDrag = 'left';
    e.preventDefault();
    return;
  }
  if (target.classList.contains('waveform-handle-right')) {
    _wfHandleDrag = 'right';
    e.preventDefault();
    return;
  }

  if (target.classList.contains('waveform-section-label')) return;

  _wfDragging = true;
  const rect = waveformCanvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  _wfDragStart = (x / rect.width) * _waveformDuration;
  setWaveformRegion(_wfDragStart, _wfDragStart);
});

document.addEventListener('mousemove', (e) => {
  if (!_wfDragging && !_wfHandleDrag) return;

  const rect = waveformCanvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const secs = (x / rect.width) * _waveformDuration;

  if (_wfHandleDrag === 'left') {
    const end = Number(wfRegionEnd.value) || 0;
    setWaveformRegion(Math.min(secs, end), end);
  } else if (_wfHandleDrag === 'right') {
    const start = Number(wfRegionStart.value) || 0;
    setWaveformRegion(start, Math.max(secs, start));
  } else if (_wfDragging) {
    const start = Math.min(_wfDragStart, secs);
    const end = Math.max(_wfDragStart, secs);
    setWaveformRegion(start, end);
  }
});

document.addEventListener('mouseup', () => {
  _wfDragging = false;
  _wfHandleDrag = null;
});

// Number input -> waveform sync
wfRegionStart.addEventListener('input', () => {
  document.getElementById('region-start').value = wfRegionStart.value;
  updateWaveformVisuals();
});

wfRegionEnd.addEventListener('input', () => {
  document.getElementById('region-end').value = wfRegionEnd.value;
  updateWaveformVisuals();
});

// Rework panel region inputs -> waveform sync (bidirectional)
document.getElementById('region-start').addEventListener('input', () => {
  wfRegionStart.value = document.getElementById('region-start').value;
  updateWaveformVisuals();
});

document.getElementById('region-end').addEventListener('input', () => {
  wfRegionEnd.value = document.getElementById('region-end').value;
  updateWaveformVisuals();
});

// Playhead tracking
function startPlayheadTracking(audioEl) {
  stopPlayheadTracking();
  waveformPlayhead.classList.add('active');

  function update() {
    if (audioEl.paused && !audioEl.seeking) {
      waveformPlayhead.classList.remove('active');
      return;
    }
    if (_waveformDuration > 0) {
      const pct = (audioEl.currentTime / _waveformDuration) * 100;
      waveformPlayhead.style.left = pct + '%';
    }
    _waveformAnimFrame = requestAnimationFrame(update);
  }
  _waveformAnimFrame = requestAnimationFrame(update);
}

function stopPlayheadTracking() {
  if (_waveformAnimFrame) {
    cancelAnimationFrame(_waveformAnimFrame);
    _waveformAnimFrame = null;
  }
  waveformPlayhead.classList.remove('active');
}

// Hook playhead into rework panel's audio preview
audioPreview.addEventListener('play', () => startPlayheadTracking(audioPreview));
audioPreview.addEventListener('pause', stopPlayheadTracking);
audioPreview.addEventListener('ended', stopPlayheadTracking);

// Resize handling
const debouncedWaveformResize = debounce(() => {
  if (_waveformData) {
    resizeCanvas();
    drawWaveform();
  }
}, 200);
window.addEventListener('resize', debouncedWaveformResize);

// --- Integration: load waveform when audio loads in rework mode ---

async function loadWaveformForRework(audioPath, duration, lyrics) {
  if (!audioPath) return;
  const audioUrl = '/audio?path=' + encodeURIComponent(audioPath);
  setOutputState('waveform');

  // Set max on waveform inputs
  if (duration) {
    wfRegionEnd.max = Math.round(duration * 10) / 10;
    wfRegionStart.max = Math.round(duration * 10) / 10;
  }

  await renderWaveform(audioUrl);

  // Fetch section estimates if we have lyrics
  if (lyrics && lyrics.trim()) {
    try {
      const bpmVal = document.getElementById('bpm').value.trim();
      const timeSig = document.getElementById('time-sig').value;
      const res = await fetch('/estimate-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics: lyrics,
          duration: _waveformDuration || duration || 30,
          bpm: bpmVal ? parseInt(bpmVal, 10) : null,
          time_signature: timeSig,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        renderSections(data.sections || []);
      }
    } catch (_) { /* section labels are optional */ }
  }
}

function clearWaveform() {
  _waveformData = null;
  _waveformDuration = 0;
  _waveformSections = [];
  _waveformAudioUrl = '';
  stopPlayheadTracking();
  waveformSelection.classList.add('hidden');
  wfSelectionInfo.textContent = '';
  document.getElementById('waveform-result-actions').classList.add('hidden');
  const container = document.getElementById('waveform-sections');
  while (container.firstChild) container.removeChild(container.firstChild);
}

// ===== Generate — validation & ready state =====

const generateBtn  = document.getElementById('generate-btn');
const generateHint = document.getElementById('generate-hint');

function hasContent() {
  if (_currentMode === 'rework') {
    return !!_uploadedAudioPath;
  }
  return lyricsText.value.trim().length > 0 || getStylePrompt().length > 0;
}

function updateGenerateState() {
  if (hasContent()) {
    generateBtn.classList.add('ready');
    generateHint.textContent = '';
  } else {
    generateBtn.classList.remove('ready');
    if (_currentMode === 'rework') {
      generateHint.textContent = 'Upload audio to get started.';
    }
  }
}

// Collect shared controls (used by both Create and Rework)
function buildSharedPayload() {
  const seedRaw = document.getElementById('seed').value.trim();
  return {
    lyrics:          (_currentMode === 'create' && _lyricsMode === 'instrumental') ? '' : lyricsText.value,
    duration:        Number(document.getElementById('duration').value),
    lyric_adherence: Number(document.getElementById('lyric-adherence').value),
    creativity:      Number(document.getElementById('creativity').value),
    quality:         Number(document.getElementById('quality').value),
    seed:            seedRaw !== '' ? parseInt(seedRaw, 10) : null,
    gen_model:       document.getElementById('gen-model').value,
    batch_size:      Number(document.getElementById('batch-size').value),
    scheduler:       document.getElementById('scheduler').value,
    audio_format:    document.getElementById('audio-format').value,
    guidance_scale_raw:   Number(document.getElementById('guidance-lyric').value),
    audio_guidance_scale: Number(document.getElementById('guidance-audio').value),
    inference_steps_raw:  Number(document.getElementById('inference-steps').value),
  };
}

function buildCreatePayload() {
  const bpmRaw  = document.getElementById('bpm').value.trim();
  const keyRoot = document.getElementById('key-root').value;
  const keyMode = document.getElementById('key-mode').value;
  const payload = {
    ...buildSharedPayload(),
    style:          getStylePrompt(),
    key:            keyRoot ? `${keyRoot} ${keyMode}` : '',
    bpm:            bpmRaw !== '' ? parseInt(bpmRaw, 10) : null,
    time_signature: document.getElementById('time-sig').value,
  };

  // With Lyrics + empty textarea → ask AceStep's LM to generate lyrics from style.
  // Controls are still forwarded; AceStep may adjust duration, BPM, key to fit.
  if (_lyricsMode === 'lyrics' && !lyricsText.value.trim()) {
    const styleContext = [getStylePrompt(), getSongParamsSummary()].filter(Boolean).join(', ');
    if (styleContext) {
      payload.sample_query   = styleContext;
      payload.vocal_language = document.getElementById('lyrics-language').value;
    }
  }

  return payload;
}

function buildReworkPayload() {
  const taskType = _reworkApproach === 'cover' ? 'cover' : 'repaint';
  const payload = {
    ...buildSharedPayload(),
    style:          document.getElementById('rework-direction').value.trim(),
    task_type:      taskType,
    src_audio_path: _uploadedAudioPath,
  };

  if (taskType === 'cover') {
    payload.audio_cover_strength = Number(coverStrengthSlider.value) / 100;
  } else {
    payload.repainting_start = Number(document.getElementById('region-start').value);
    payload.repainting_end   = Number(document.getElementById('region-end').value);
  }

  return payload;
}

function buildPayload() {
  return _currentMode === 'rework' ? buildReworkPayload() : buildCreatePayload();
}

let _pollInterval = null;
let _timerInterval = null;

// Ctrl/Cmd+Enter keyboard shortcut — trigger Generate from anywhere in the UI
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    generateBtn.click();
  }
});

// Manage the four output panel states: idle / generating / cards / waveform
function setOutputState(state) {
  document.getElementById('output-idle').classList.toggle('hidden', state !== 'idle');
  document.getElementById('output-generating').classList.toggle('hidden', state !== 'generating');
  document.getElementById('output-cards').classList.toggle('hidden', state !== 'cards');
  document.getElementById('output-waveform').classList.toggle('hidden', state !== 'waveform');
}

function getGenerateLabel() {
  if (_currentMode === 'rework') {
    return _reworkApproach === 'cover' ? '▶ Reimagine' : '▶ Repaint';
  }
  return '▶ Generate';
}

function setGenerating(on) {
  generateBtn.textContent = on ? 'Generating…' : getGenerateLabel();
  generateBtn.disabled    = on;
  if (on) {
    setOutputState('generating');
    // Start elapsed-time counter
    const timerEl = document.getElementById('generating-timer');
    const startTime = Date.now();
    timerEl.textContent = '';
    _timerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      timerEl.textContent = m > 0
        ? `${m}m ${String(s).padStart(2, '0')}s`
        : `${s}s`;
    }, 1000);
  } else {
    clearInterval(_timerInterval);
    _timerInterval = null;
    document.getElementById('generating-timer').textContent = '';
  }
}

document.getElementById('cancel-btn').addEventListener('click', () => {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
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
  audio.src = '/audio?path=' + encodeURIComponent(result.audio_url);
  card.appendChild(audio);

  const player = document.createElement('div');
  player.className = 'audio-player';
  player.innerHTML =
    '<button class="player-btn player-rewind" type="button" title="Rewind to start">⟪</button>' +
    '<button class="player-btn player-play"   type="button" title="Play">▶</button>' +
    '<button class="player-btn player-stop"   type="button" title="Stop" disabled>⏹</button>' +
    '<div class="player-scrubber"><div class="player-scrubber-fill"></div></div>' +
    '<span class="player-time">0:00 / 0:00</span>';
  card.appendChild(player);
  initAudioPlayer(audio, player);

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

  const sendBtn = document.createElement('button');
  sendBtn.className = 'ghost-btn';
  sendBtn.type = 'button';
  sendBtn.textContent = 'Send to Rework';
  sendBtn.addEventListener('click', () => {
    loadAudioIntoRework(result.audio_url, 'Generated audio', lyricsText.value);
  });

  actions.appendChild(dlAudio);
  actions.appendChild(dlJson);
  actions.appendChild(sendBtn);
  card.appendChild(actions);
  return card;
}

function showResultCards(taskId, results, fmt) {
  // Track most recent generation for Rework auto-load
  if (results.length > 0) {
    _lastGenResult = {
      audioPath: results[0].audio_url,
      lyrics: lyricsText.value,
    };
  }

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
    generateHint.textContent = _currentMode === 'rework'
      ? 'Upload audio to get started.'
      : 'Add some lyrics or a style description first.';
    return;
  }
  if (!validateRegion()) return;
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
        if (_currentMode === 'rework') {
          // Stay in waveform view — load the result as the new source audio
          const result = data.results[0];
          _uploadedAudioPath = result.audio_url;
          audioPreview.src = '/audio?path=' + encodeURIComponent(result.audio_url);
          document.getElementById('upload-filename').textContent = 'Reworked audio';
          loadWaveformForRework(result.audio_url, null, payload.lyrics || '');

          // Wire download links
          const fmt = payload.audio_format || 'mp3';
          const dlAudio = document.getElementById('wf-download-audio');
          const dlJson  = document.getElementById('wf-download-json');
          dlAudio.href     = `/download/${taskId}/0/audio`;
          dlAudio.download = `acestep-${taskId.slice(0, 8)}-rework.${fmt}`;
          dlJson.href      = `/download/${taskId}/0/json`;
          dlJson.download  = `acestep-${taskId.slice(0, 8)}-rework.json`;
          document.getElementById('waveform-result-actions').classList.remove('hidden');
        } else {
          showResultCards(taskId, data.results, payload.audio_format);
        }
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

  autoDurationBtn.textContent = 'Computing…';
  autoDurationBtn.disabled = true;
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
    const secs = Math.max(10, Math.min(600, Math.round(data.seconds / 5) * 5));
    durationSlider.value = secs;
    updateSlider(durationSlider);
    checkLyricsWarning();
  } catch (_) {
    // Silently fail — leave slider as-is
  } finally {
    autoDurationBtn.textContent = _autoOn ? 'Auto ✓' : 'Auto';
    autoDurationBtn.disabled = false;
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
