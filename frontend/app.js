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

// ===== Now Playing Bar =====
// Tracks whichever audio element is currently active across all tabs/modes.

let _nowPlayingAudio = null;

const _npPlayerEl  = document.getElementById('now-playing-player');
const _npLabelEl   = document.getElementById('now-playing-label');
const _npRewindBtn = _npPlayerEl.querySelector('.player-rewind');
const _npPlayBtn   = _npPlayerEl.querySelector('.player-play');
const _npStopBtn   = _npPlayerEl.querySelector('.player-stop');
const _npScrubber  = _npPlayerEl.querySelector('.player-scrubber');
const _npFill      = _npPlayerEl.querySelector('.player-scrubber-fill');
const _npTimeEl    = _npPlayerEl.querySelector('.player-time');
const _npSaveBtn   = document.getElementById('np-save-btn');

function _updateNowPlayingProgress() {
  if (!_nowPlayingAudio) return;
  const cur = _nowPlayingAudio.currentTime || 0;
  const dur = isFinite(_nowPlayingAudio.duration) ? _nowPlayingAudio.duration : 0;
  _npFill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
  _npTimeEl.textContent = _fmtTime(cur) + ' / ' + _fmtTime(dur);
}

function _syncNowPlayingButtons() {
  const hasAudio = _nowPlayingAudio !== null;
  _npRewindBtn.disabled = !hasAudio;
  _npPlayBtn.disabled   = !hasAudio;
  if (!hasAudio) {
    _npStopBtn.disabled = true;
    _npPlayBtn.textContent = '\u25B6';
    _npPlayBtn.title = 'Play';
    return;
  }
  const paused = _nowPlayingAudio.paused;
  _npStopBtn.disabled    = paused;
  _npPlayBtn.textContent = paused ? '\u25B6' : '\u23F8';
  _npPlayBtn.title       = paused ? 'Play' : 'Pause';
}

/**
 * Wires the Now Playing bar to the given audio element.
 * Called whenever an audio element starts playing.
 * @param {HTMLAudioElement} audioEl
 * @param {string} label  — e.g. "My Lyrics", "AI Lyrics", "Rework"
 * @param {HTMLElement} playerEl  — the source player element (to read save link)
 */
function activateNowPlaying(audioEl, label, playerEl) {
  _nowPlayingAudio = audioEl;
  _npLabelEl.textContent = label || 'Playing';

  // Sync save button from source player's save link
  const saveLink = playerEl ? playerEl.querySelector('.player-save') : null;
  if (saveLink && saveLink.href && saveLink.href !== window.location.href) {
    _npSaveBtn.href     = saveLink.href;
    _npSaveBtn.download = saveLink.download || '';
    _npSaveBtn.classList.remove('hidden');
  } else {
    _npSaveBtn.classList.add('hidden');
  }

  _updateNowPlayingProgress();
  _syncNowPlayingButtons();
}

// Now Playing transport event handlers
_npPlayBtn.addEventListener('click', () => {
  if (!_nowPlayingAudio) return;
  if (_nowPlayingAudio.paused) { _stopOthers(_nowPlayingAudio); _nowPlayingAudio.play(); }
  else { _nowPlayingAudio.pause(); }
});

_npStopBtn.addEventListener('click', () => {
  if (_nowPlayingAudio) _nowPlayingAudio.pause();
});

_npRewindBtn.addEventListener('click', () => {
  if (!_nowPlayingAudio) return;
  _nowPlayingAudio.currentTime = 0;
  _updateNowPlayingProgress();
});

_npScrubber.addEventListener('click', (e) => {
  if (!_nowPlayingAudio) return;
  const dur = _nowPlayingAudio.duration;
  if (!dur || !isFinite(dur)) return;
  const rect = _npScrubber.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  _nowPlayingAudio.currentTime = (x / rect.width) * dur;
  _stopOthers(_nowPlayingAudio);
  _nowPlayingAudio.play();
});

_syncNowPlayingButtons();

function initAudioPlayer(audioEl, playerEl, label) {
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
    if (fill) fill.style.width = dur ? ((cur / dur) * 100) + '%' : '0%';
    timeEl.textContent = _fmtTime(cur) + ' / ' + _fmtTime(dur);
  }

  function syncButtons() {
    const paused = audioEl.paused;
    stopBtn.disabled = paused;
    playBtn.textContent = paused ? '\u25B6' : '\u23F8';
    playBtn.title = paused ? 'Play' : 'Pause';
  }

  // Play/Pause toggle
  playBtn.addEventListener('click', () => {
    if (audioEl.paused) {
      _stopOthers(audioEl);
      audioEl.play();
    } else {
      audioEl.pause();
    }
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
  if (scrubber) scrubber.addEventListener('click', (e) => {
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
    syncButtons();
  });

  audioEl.addEventListener('play',           syncButtons);
  audioEl.addEventListener('pause',          syncButtons);
  audioEl.addEventListener('timeupdate',     updateProgress);
  audioEl.addEventListener('loadedmetadata', updateProgress);

  // Now Playing bar sync — activate when this player plays; keep in sync while active
  if (label !== undefined) {
    audioEl.addEventListener('play', () => activateNowPlaying(audioEl, label, playerEl));
  }
  audioEl.addEventListener('play',   () => { if (audioEl === _nowPlayingAudio) _syncNowPlayingButtons(); });
  audioEl.addEventListener('pause',  () => { if (audioEl === _nowPlayingAudio) _syncNowPlayingButtons(); });
  audioEl.addEventListener('ended',  () => { if (audioEl === _nowPlayingAudio) { _syncNowPlayingButtons(); _updateNowPlayingProgress(); } });
  audioEl.addEventListener('timeupdate',     () => { if (audioEl === _nowPlayingAudio) _updateNowPlayingProgress(); });
  audioEl.addEventListener('loadedmetadata', () => { if (audioEl === _nowPlayingAudio) _updateNowPlayingProgress(); });

  syncButtons();
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
      valueEl.textContent = ['Little', 'Some', 'Strong'][val];
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
    case 'lora-scale':
      valueEl.textContent = `${val}%`;
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
let _savedGenModel = null;   // stashed gen-model value when analyze locks it to base

const modeBtns      = document.querySelectorAll('.mode-btn');
const createPanel   = document.getElementById('create-panel');
const reworkPanel   = document.getElementById('rework-panel');
const analyzePanel  = document.getElementById('analyze-panel');
const trainPanel    = document.getElementById('train-panel');
const genControls   = document.getElementById('gen-controls');
const trainControls = document.getElementById('train-controls');

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
  analyzePanel.classList.toggle('hidden', mode !== 'analyze');
  trainPanel.classList.toggle('hidden', mode !== 'train');

  // Toggle right panel: generation controls vs training controls
  genControls.classList.toggle('hidden', mode === 'train');
  trainControls.classList.toggle('hidden', mode !== 'train');

  // Show/hide create tabs — only visible in create and rework modes
  document.querySelector('.create-tabs').classList.toggle('hidden', mode === 'analyze' || mode === 'train');

  // Center column content switching
  if (mode === 'analyze') {
    document.getElementById('tab-my-lyrics').classList.add('hidden');
    document.getElementById('tab-ai-lyrics').classList.add('hidden');
    document.getElementById('tab-instrumental').classList.add('hidden');
    document.getElementById('tab-train').classList.add('hidden');
    document.getElementById('tab-analyze').classList.remove('hidden');
  } else if (mode === 'train') {
    document.getElementById('tab-my-lyrics').classList.add('hidden');
    document.getElementById('tab-ai-lyrics').classList.add('hidden');
    document.getElementById('tab-instrumental').classList.add('hidden');
    document.getElementById('tab-analyze').classList.add('hidden');
    document.getElementById('tab-train').classList.remove('hidden');
    _startTrainStatusPoll();
    _waitForAceStep();
  } else {
    document.getElementById('tab-analyze').classList.add('hidden');
    document.getElementById('tab-train').classList.add('hidden');
    // Restore the active create tab
    switchCreateTab(_createTab);
  }

  // Waveform: clear when switching to create, analyze, or train
  if (mode === 'create' || mode === 'analyze' || mode === 'train') {
    clearWaveform();
    setOutputState('now-playing');
  }

  // Stop polling when leaving train mode
  if (mode !== 'train') {
    _stopTrainStatusPoll();
    if (_healthPollTimer) { clearInterval(_healthPollTimer); _healthPollTimer = null; }
  }

  // Lock gen-model to base in Analyze mode; restore on exit
  const genModelEl = document.getElementById('gen-model');
  if (mode === 'analyze') {
    if (_savedGenModel === null) _savedGenModel = genModelEl.value;
    genModelEl.value = 'base';
    genModelEl.disabled = true;
    updateBatchLimit();
  } else if (_savedGenModel !== null) {
    genModelEl.value = _savedGenModel;
    genModelEl.disabled = false;
    _savedGenModel = null;
    updateBatchLimit();
  }

  updateControlsForMode(mode);
  updateGenerateState();
}

function updateControlsForMode(mode) {
  const genBtn = document.getElementById('generate-btn');
  if (genBtn && !genBtn.disabled) {
    if (mode === 'create') {
      genBtn.textContent = '▶ Generate';
    } else if (mode === 'analyze') {
      const labels = { extract: '▶ Extract', lego: '▶ Replace Track', complete: '▶ Complete' };
      genBtn.textContent = labels[_analyzeMode] || '▶ Analyze';
    } else {
      genBtn.textContent = _reworkApproach === 'cover' ? '▶ Reimagine' : '▶ Fix & Blend';
    }
  }

  // Lock duration to source audio length in rework/analyze modes
  const durationEl = document.getElementById('duration');
  const autoDurBtn = document.getElementById('auto-duration-btn');
  let lockNote = document.getElementById('duration-lock-note');
  if (mode === 'rework' && _uploadedAudioDuration) {
    const dur = Math.max(10, Math.min(600, Math.round(_uploadedAudioDuration / 5) * 5));
    durationEl.value = dur;
    updateSlider(durationEl);
    durationEl.disabled = true;
    autoDurBtn.disabled = true;
    if (!lockNote) {
      lockNote = document.createElement('p');
      lockNote.id = 'duration-lock-note';
      lockNote.className = 'duration-lock-note';
      durationEl.parentElement.appendChild(lockNote);
    }
    lockNote.textContent = 'Locked to source audio length';
    lockNote.classList.remove('hidden');
  } else if (mode === 'analyze') {
    durationEl.disabled = true;
    autoDurBtn.disabled = true;
    if (!lockNote) {
      lockNote = document.createElement('p');
      lockNote.id = 'duration-lock-note';
      lockNote.className = 'duration-lock-note';
      durationEl.parentElement.appendChild(lockNote);
    }
    lockNote.textContent = 'Determined by source audio';
    lockNote.classList.remove('hidden');
  } else {
    if (mode === 'create') durationEl.disabled = _autoOn;
    autoDurBtn.disabled = false;
    if (lockNote) lockNote.classList.add('hidden');
  }
}

// Per-tab audio results — each create tab remembers its own last generation
const _tabAudio = { 'my-lyrics': null, 'ai-lyrics': null, 'instrumental': null };

modeBtns.forEach(btn =>
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    // Clicking Rework auto-loads from the currently active create tab
    if (mode === 'rework') {
      const tabResult = _tabAudio[_createTab];
      if (tabResult) {
        loadAudioIntoRework(tabResult.audioPath, 'Generated audio', tabResult.lyrics);
      } else {
        switchMode(mode);
      }
    } else {
      switchMode(mode);
    }
  })
);

// ===== Analyze mode — state & sub-mode switching =====

let _analyzeMode = 'extract';       // 'extract' | 'lego' | 'complete'
let _analyzeAudioPath = null;
let _analyzeAudioDuration = null;

const analyzeAudioPreview   = document.getElementById('analyze-audio-preview');
const analyzeUploadZone     = document.getElementById('analyze-upload-zone');
const analyzeUploadPrompt   = document.getElementById('analyze-upload-prompt');
const analyzeUploadLoaded   = document.getElementById('analyze-upload-loaded');

// Init audio player for analyze preview
initAudioPlayer(analyzeAudioPreview, document.getElementById('analyze-audio-player'), 'Analyze');

const _VOCAL_TRACKS = new Set(['vocals', 'backing_vocals']);

function updateAnalyzeTrackHint() {
  const hint = document.getElementById('analyze-track-hint');
  if (_analyzeMode === 'extract') {
    hint.textContent = 'Isolates the selected stem from the mix';
  } else if (_analyzeMode === 'lego') {
    const track = document.getElementById('analyze-track').value;
    hint.textContent = _VOCAL_TRACKS.has(track)
      ? 'Generates AI vocal elements to replace this track — melodic, not sung lyrics'
      : 'Generates a new version of this track to fit the mix';
  } else {
    const selected = getSelectedTrackClasses();
    const hasVocal = selected.some(t => _VOCAL_TRACKS.has(t));
    hint.textContent = hasVocal
      ? 'Vocal tracks produce AI-generated melodic elements, not sung lyrics'
      : selected.length > 0
        ? 'Generates the selected tracks to fill out the arrangement'
        : 'Select tracks to add to the mix';
  }
}

function switchAnalyzeMode(mode) {
  _analyzeMode = mode;
  document.querySelectorAll('[data-analyze]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.analyze === mode)
  );

  // Extract & Lego: single track dropdown; Complete: multi-select tags
  document.getElementById('analyze-track-group').classList.toggle('hidden', mode === 'complete');
  document.getElementById('analyze-tracks-multi').classList.toggle('hidden', mode !== 'complete');

  updateAnalyzeTrackHint();
  updateControlsForMode(_currentMode);
  updateGenerateState();
}

document.querySelectorAll('[data-analyze]').forEach(btn =>
  btn.addEventListener('click', () => switchAnalyzeMode(btn.dataset.analyze))
);

// Track class tag toggles (Complete mode multi-select)
document.querySelectorAll('.track-class-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    tag.classList.toggle('active');
    updateAnalyzeTrackHint();
    updateGenerateState();
  });
});

// Track dropdown change → update hint (vocal vs instrument context)
document.getElementById('analyze-track').addEventListener('change', updateAnalyzeTrackHint);

function getSelectedTrackClasses() {
  return [...document.querySelectorAll('.track-class-tag.active')].map(t => t.dataset.track);
}

// --- Analyze waveform displays ---

let _analyzeSourcePeaks = null;  // Float32Array of source audio peaks

/**
 * Decode an audio URL into a Float32Array of peak amplitudes.
 * @param {string} audioUrl
 * @param {number} barCount  Number of bars to downsample to
 * @returns {Promise<Float32Array>}
 */
async function decodeAudioPeaks(audioUrl, barCount) {
  const resp = await fetch(audioUrl);
  if (!resp.ok) throw new Error(resp.statusText);
  const arrayBuf = await resp.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  audioCtx.close();

  const channels = audioBuf.numberOfChannels;
  const length = audioBuf.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuf.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  if (barCount < 1) barCount = 1;
  const samplesPerBar = Math.floor(length / barCount);
  const peaks = new Float32Array(barCount);
  for (let i = 0; i < barCount; i++) {
    let peak = 0;
    const offset = i * samplesPerBar;
    for (let j = 0; j < samplesPerBar; j++) {
      const abs = Math.abs(mono[offset + j] || 0);
      if (abs > peak) peak = abs;
    }
    peaks[i] = peak;
  }
  return peaks;
}

function drawAnalyzeWaveform(canvasEl, containerEl, peaks, colorFn) {
  const dpr = window.devicePixelRatio || 1;
  const rect = containerEl.getBoundingClientRect();
  canvasEl.width = rect.width * dpr;
  canvasEl.height = rect.height * dpr;
  canvasEl.style.width = rect.width + 'px';
  canvasEl.style.height = rect.height + 'px';
  const ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;
  const barCount = peaks.length;
  if (barCount === 0) return;

  const barWidth = w / barCount;
  const midY = h / 2;
  const maxBarH = h * 0.85;

  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < barCount; i++) {
    const x = i * barWidth;
    const barH = Math.max(1, peaks[i] * maxBarH);
    ctx.fillStyle = colorFn(i);
    ctx.fillRect(x, midY - barH / 2, Math.max(1, barWidth - 0.5), barH);
  }
}

async function renderAnalyzeSourceWaveform(audioUrl) {
  const section = document.getElementById('analyze-wf-source-section');
  const container = document.getElementById('analyze-wf-source');
  const canvas = document.getElementById('analyze-wf-source-canvas');
  section.classList.remove('hidden');

  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  const barCount = Math.max(1, Math.floor((rect.width * dpr) / (2 * dpr)));

  try {
    _analyzeSourcePeaks = await decodeAudioPeaks(audioUrl, barCount);
    const mutedColor = getComputedColor('--text-muted');
    drawAnalyzeWaveform(canvas, container, _analyzeSourcePeaks, () => mutedColor);
  } catch (err) {
    console.error('Analyze source waveform error:', err);
  }
}

async function renderAnalyzeResultWaveform(resultAudioUrl) {
  const section = document.getElementById('analyze-wf-result-section');
  const container = document.getElementById('analyze-wf-result');
  const canvas = document.getElementById('analyze-wf-result-canvas');
  section.classList.remove('hidden');

  const barCount = _analyzeSourcePeaks ? _analyzeSourcePeaks.length : 200;

  try {
    const resultPeaks = await decodeAudioPeaks(resultAudioUrl, barCount);

    // Compute per-bar difference and normalize
    const diffs = new Float32Array(barCount);
    let maxDiff = 0;
    for (let i = 0; i < barCount; i++) {
      const srcPeak = _analyzeSourcePeaks ? (_analyzeSourcePeaks[i] || 0) : 0;
      diffs[i] = Math.abs(resultPeaks[i] - srcPeak);
      if (diffs[i] > maxDiff) maxDiff = diffs[i];
    }

    // Parse muted and accent colors for interpolation
    const mutedHex = getComputedColor('--text-muted');
    const accentHex = getComputedColor('--accent');
    const mRgb = hexToRgb(mutedHex);
    const aRgb = hexToRgb(accentHex);

    drawAnalyzeWaveform(canvas, container, resultPeaks, (i) => {
      if (maxDiff === 0) return mutedHex;
      const t = diffs[i] / maxDiff;
      // Ease the transition so only strong diffs shift noticeably
      const e = t * t;
      const r = Math.round(mRgb[0] + (aRgb[0] - mRgb[0]) * e);
      const g = Math.round(mRgb[1] + (aRgb[1] - mRgb[1]) * e);
      const b = Math.round(mRgb[2] + (aRgb[2] - mRgb[2]) * e);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    });
  } catch (err) {
    console.error('Analyze result waveform error:', err);
  }
}

function hexToRgb(hex) {
  // Handle both #rrggbb and named/rgb() colors
  if (hex.startsWith('#')) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Fallback: parse rgb(r, g, b)
  const m = hex.match(/(\d+)/g);
  return m ? [+m[0], +m[1], +m[2]] : [107, 107, 132];
}

function clearAnalyzeWaveforms() {
  _analyzeSourcePeaks = null;
  document.getElementById('analyze-wf-source-section').classList.add('hidden');
  document.getElementById('analyze-wf-result-section').classList.add('hidden');
}

// --- Analyze audio upload ---

function handleAnalyzeAudioUpload(file) {
  if (!file || !file.type.startsWith('audio/')) {
    const hint = document.getElementById('generate-hint');
    if (hint) hint.textContent = 'Only audio files are supported.';
    return;
  }

  const objUrl = URL.createObjectURL(file);
  analyzeAudioPreview.src = objUrl;
  analyzeAudioPreview.onloadedmetadata = () => {
    _analyzeAudioDuration = analyzeAudioPreview.duration;
    document.getElementById('analyze-upload-duration').textContent =
      formatDuration(analyzeAudioPreview.duration);
  };

  document.getElementById('analyze-upload-filename').textContent = file.name;
  analyzeUploadPrompt.classList.add('hidden');
  analyzeUploadLoaded.classList.remove('hidden');

  const formData = new FormData();
  formData.append('file', file);
  fetch('/upload-audio', { method: 'POST', body: formData })
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then(data => {
      _analyzeAudioPath = data.path;
      updateGenerateState();
      renderAnalyzeSourceWaveform('/audio?path=' + encodeURIComponent(data.path));
    })
    .catch(err => {
      removeAnalyzeAudio();
      const hint = document.getElementById('generate-hint');
      if (hint) hint.textContent = 'Upload failed: ' + err.message;
    });
}

function removeAnalyzeAudio() {
  _analyzeAudioPath = null;
  _analyzeAudioDuration = null;
  analyzeAudioPreview.src = '';
  document.getElementById('analyze-upload-filename').textContent = '';
  document.getElementById('analyze-upload-duration').textContent = '';
  analyzeUploadPrompt.classList.remove('hidden');
  analyzeUploadLoaded.classList.add('hidden');
  clearAnalyzeWaveforms();
  updateGenerateState();
}

document.getElementById('analyze-browse-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.addEventListener('change', () => {
    if (input.files[0]) handleAnalyzeAudioUpload(input.files[0]);
  });
  input.click();
});

document.getElementById('analyze-remove-btn').addEventListener('click', removeAnalyzeAudio);

// Drag-and-drop on analyze upload zone
analyzeUploadZone.addEventListener('dragenter', (e) => {
  e.preventDefault();
  analyzeUploadZone.classList.add('drag-over');
});
analyzeUploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
analyzeUploadZone.addEventListener('dragleave', (e) => {
  if (!analyzeUploadZone.contains(e.relatedTarget)) {
    analyzeUploadZone.classList.remove('drag-over');
  }
});
analyzeUploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  analyzeUploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleAnalyzeAudioUpload(file);
});

// ===== Rework panel — audio upload, approach selector =====

let _uploadedAudioPath = null;
let _uploadedAudioDuration = null;
let _reworkApproach = 'cover';

const audioUploadZone = document.getElementById('audio-upload-zone');
const uploadPrompt    = document.getElementById('upload-prompt');
const uploadLoaded    = document.getElementById('upload-loaded');
const audioPreview    = document.getElementById('audio-preview');

// Initialise custom player for the rework audio preview
initAudioPlayer(audioPreview, document.getElementById('audio-preview-player'), 'Rework');
// Also wire the transport bar in the waveform output panel
initAudioPlayer(audioPreview, document.getElementById('wf-transport'), 'Rework');

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
  setOutputState('now-playing');
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

// Approach selector (scoped to rework panel — analyze has its own buttons)
const approachBtns       = document.querySelectorAll('#rework-panel .approach-btn');
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
  const tags   = [...document.querySelectorAll('.tag.active:not(.track-class-tag)')].map(t => t.textContent.trim()).join(', ');
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
  const selected = document.querySelectorAll('.tag.active:not(.track-class-tag)');
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

document.querySelectorAll('.tag:not(.track-class-tag)').forEach(tag => {
  tag.addEventListener('click', () => {
    tag.classList.toggle('active');
    updateStyleState();
  });
});

document.getElementById('clear-tags-btn').addEventListener('click', () => {
  document.querySelectorAll('.tag.active:not(.track-class-tag)').forEach(t => t.classList.remove('active'));
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

// ===== Create tabs (My Lyrics / AI Lyrics / Instrumental) =====

let _createTab = 'my-lyrics'; // 'my-lyrics' | 'ai-lyrics' | 'instrumental'

const createTabBtns    = document.querySelectorAll('.create-tab');
const aiDescription    = document.getElementById('ai-description');
const aiLyricsDisplay  = document.getElementById('ai-lyrics-display');

function switchCreateTab(tab) {
  _createTab = tab;
  createTabBtns.forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  document.getElementById('tab-my-lyrics').classList.toggle('hidden', tab !== 'my-lyrics');
  document.getElementById('tab-ai-lyrics').classList.toggle('hidden', tab !== 'ai-lyrics');
  document.getElementById('tab-instrumental').classList.toggle('hidden', tab !== 'instrumental');

  // In Rework mode, switch the waveform to this tab's audio
  if (_currentMode === 'rework') {
    const tabResult = _tabAudio[tab];
    if (tabResult) {
      loadAudioIntoRework(tabResult.audioPath, _TAB_LABELS[tab] || 'Generated audio', tabResult.lyrics);
    } else {
      removeAudio();
    }
  }

  updateGenerateState();
}

createTabBtns.forEach(btn =>
  btn.addEventListener('click', () => switchCreateTab(btn.dataset.tab))
);

// AI description input — update generate state as user types
aiDescription.addEventListener('input', updateGenerateState);

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

// ===== Load lyrics =====

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

// Load Music — audio file + optional companion JSON
document.getElementById('load-music-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.wav,.flac,.mp3,.json';
  input.multiple = true;
  input.addEventListener('change', () => handleMusicLoad(Array.from(input.files)));
  input.click();
});

// Load Music — audio file + optional companion JSON, loaded into Rework
async function handleMusicLoad(files) {
  const audioFile = files.find(f => /\.(wav|flac|mp3)$/i.test(f.name));
  const jsonFile  = files.find(f => /\.json$/i.test(f.name));
  if (!audioFile) return;

  // Apply companion JSON params if present (lyrics, BPM, key, etc.)
  if (jsonFile) {
    try {
      const meta = JSON.parse(await jsonFile.text());
      const params = meta.params || meta;
      applyJsonParams(params);
    } catch (_) { /* JSON parse error — ignore */ }
  }

  // Switch to Rework mode and use existing audio upload flow
  switchMode('rework');
  handleAudioUpload(audioFile);
}

function applyJsonParams(params) {
  if (!params) return;

  if (params.lyrics) {
    lyricsText.value = params.lyrics;
    updateLyricsCount();
  }

  const styleTextEl = document.getElementById('style-text');
  if (params.style && styleTextEl) styleTextEl.value = params.style;

  const bpmEl = document.getElementById('bpm');
  if (params.bpm != null && bpmEl) bpmEl.value = params.bpm;

  const durEl = document.getElementById('duration');
  if (params.duration != null && durEl) {
    durEl.value = Math.round(params.duration);
    updateSlider(durEl);
  }

  const timeSigEl = document.getElementById('time-sig');
  if (params.time_signature && timeSigEl) timeSigEl.value = params.time_signature;

  if (params.key) {
    const parts = params.key.trim().split(/\s+/);
    const rootEl = document.getElementById('key-root');
    const modeEl = document.getElementById('key-mode');
    if (rootEl && parts[0]) rootEl.value = parts[0];
    if (modeEl && parts[1]) modeEl.value = parts[1];
  }

  const langEl = document.getElementById('lyrics-language');
  if (params.vocal_language && langEl) langEl.value = params.vocal_language;
}

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

// ===== Style Adapter (LoRA) =====

const _loraBrowser     = document.getElementById('lora-browser');
const _loraLoadBtn     = document.getElementById('lora-load-btn');
const _loraUnloadBtn   = document.getElementById('lora-unload-btn');
const _loraStatusEl    = document.getElementById('lora-status');
const _loraActiveCtrl  = document.getElementById('lora-active-controls');
const _loraScaleSlider = document.getElementById('lora-scale');

function _setLoraStatus(text, state) {
  _loraStatusEl.textContent = text;
  _loraStatusEl.classList.toggle('loaded', state === 'loaded');
  _loraStatusEl.classList.toggle('error', state === 'error');
}

function _showLoraLoaded(name) {
  _setLoraStatus(name + ' loaded', 'loaded');
  _loraLoadBtn.classList.add('hidden');
  _loraUnloadBtn.classList.remove('hidden');
  _loraActiveCtrl.classList.remove('hidden');
}

function _showLoraUnloaded() {
  _setLoraStatus('No adapter loaded', '');
  _loraLoadBtn.classList.remove('hidden');
  _loraUnloadBtn.classList.add('hidden');
  _loraActiveCtrl.classList.add('hidden');
}

async function _refreshLoraBrowser() {
  try {
    const r = await fetch('/lora/browse');
    if (!r.ok) return;
    const data = await r.json();
    // Keep the placeholder, replace the rest
    while (_loraBrowser.options.length > 1) _loraBrowser.remove(1);
    for (const a of data.adapters) {
      const opt = document.createElement('option');
      opt.value = a.path;
      opt.textContent = a.name + ' (' + a.type + ', ' + a.size_mb + ' MB)';
      _loraBrowser.appendChild(opt);
    }
  } catch { /* ignore — browse is best-effort */ }
}

async function _refreshLoraStatus() {
  try {
    const r = await fetch('/lora/status');
    if (!r.ok) return;
    const data = await r.json();
    const info = data.data || data;
    if (info.lora_loaded) {
      _showLoraLoaded(info.adapter_type || 'Adapter');
      if (typeof info.lora_scale === 'number') {
        _loraScaleSlider.value = Math.round(info.lora_scale * 100);
        updateSlider(_loraScaleSlider);
      }
    } else {
      _showLoraUnloaded();
    }
  } catch { /* AceStep may not be ready yet */ }
}

_loraLoadBtn.addEventListener('click', async () => {
  const path = _loraBrowser.value;
  if (!path) { _setLoraStatus('Select an adapter first', 'error'); return; }
  _loraLoadBtn.disabled = true;
  _setLoraStatus('Loading\u2026', '');
  try {
    const r = await fetch('/lora/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lora_path: path }),
    });
    const data = await r.json();
    if (r.ok) {
      const name = _loraBrowser.selectedOptions[0]?.textContent?.split(' (')[0] || 'Adapter';
      _showLoraLoaded(name);
    } else {
      const msg = (data.data && data.data.error) || data.detail || 'Load failed';
      _setLoraStatus(msg, 'error');
    }
  } catch (e) {
    _setLoraStatus('Connection error', 'error');
  } finally {
    _loraLoadBtn.disabled = false;
  }
});

_loraUnloadBtn.addEventListener('click', async () => {
  _loraUnloadBtn.disabled = true;
  _setLoraStatus('Unloading\u2026', '');
  try {
    const r = await fetch('/lora/unload', { method: 'POST' });
    if (r.ok) {
      _showLoraUnloaded();
      _loraScaleSlider.value = 100;
      updateSlider(_loraScaleSlider);
    } else {
      _setLoraStatus('Unload failed', 'error');
    }
  } catch {
    _setLoraStatus('Connection error', 'error');
  } finally {
    _loraUnloadBtn.disabled = false;
  }
});

const _debouncedLoraScale = debounce(async (val) => {
  try {
    await fetch('/lora/scale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale: val / 100 }),
    });
  } catch { /* best-effort */ }
}, 300);

_loraScaleSlider.addEventListener('input', () => {
  updateSlider(_loraScaleSlider);
  _debouncedLoraScale(Number(_loraScaleSlider.value));
});

// Initialize on load
_refreshLoraBrowser();
_refreshLoraStatus();

// ===== AceStep readiness check =====

let _aceStepReady = false;
let _healthPollTimer = null;

async function _checkAceStepHealth() {
  try {
    const r = await fetch('/api/health');
    if (r.ok) {
      _aceStepReady = true;
      if (_healthPollTimer) { clearInterval(_healthPollTimer); _healthPollTimer = null; }
      _onAceStepReady();
      return true;
    }
  } catch { /* not ready yet */ }
  _aceStepReady = false;
  return false;
}

function _waitForAceStep() {
  if (_aceStepReady) { _onAceStepReady(); return; }
  _setPipelineStatus('Waiting for AceStep to start...', '');
  _trainScanBtn.disabled = true;
  _trainPreprocessBtn.disabled = true;
  _trainStartBtn.disabled = true;
  if (_healthPollTimer) clearInterval(_healthPollTimer);
  _checkAceStepHealth();
  _healthPollTimer = setInterval(_checkAceStepHealth, 3000);
}

function _onAceStepReady() {
  if (_trainPipelineStatus.textContent === 'Waiting for AceStep to start...') {
    _setPipelineStatus('AceStep ready', 'ok');
  }
  _trainScanBtn.disabled = _trainFiles.length === 0;
  _trainPreprocessBtn.disabled = !_trainScanned;
  _trainStartBtn.disabled = !_trainPreprocessed;
  _recoverPipelineState();
}

async function _recoverPipelineState() {
  // 1. Check AceStep's in-memory preprocess task (survives page refresh but not server restart)
  try {
    const r = await fetch('/train/preprocess/status');
    if (r.ok) {
      const raw = await r.json();
      const info = raw.data || raw;
      if (info && info.status === 'running') {
        _trainPreprocessBtn.disabled = true;
        _setPipelineStatus('Preprocessing', '');
        _startPreprocessAnim();
        const pollRecover = async () => {
          try {
            const sr = await fetch('/train/preprocess/status');
            const sd = await sr.json();
            const d = sd.data || sd;
            if (d.status === 'completed' || d.status === 'done') {
              _stopPreprocessAnim();
              _setPipelineStatus('Preprocessing complete', 'ok');
              _trainPreprocessed = true; _syncSnapshotBtn();
              _trainStartBtn.disabled = false;
              _trainPreprocessBtn.disabled = false;
              fetch('/train/save', { method: 'POST' }).catch(() => {});
              return;
            } else if (d.status === 'failed' || d.status === 'error') {
              _stopPreprocessAnim();
              _setPipelineStatus(d.error || 'Preprocessing failed', 'error');
              _trainPreprocessBtn.disabled = false;
              return;
            }
            if (d.current && d.total && d.total > 0) {
              const pct = Math.round((d.current / d.total) * 100);
              _setPipelineStatus('Preprocessing ' + d.current + '/' + d.total + ' (' + pct + '%)', '');
            }
            setTimeout(pollRecover, 10000);
          } catch { _stopPreprocessAnim(); }
        };
        setTimeout(pollRecover, 10000);
        return; // active task found — don't fall through to disk check
      }
    }
  } catch { /* AceStep may not have task state */ }

  // 2. Check for in-progress auto-label task
  try {
    const lr = await fetch('/train/label/status');
    if (lr.ok) {
      const lraw = await lr.json();
      const linfo = lraw.data || lraw;
      if (linfo && linfo.status === 'running') {
        _trainLabelBtn.disabled = true;
        _trainLabelProgressEl.classList.remove('hidden');
        _trainLabelProgressText.textContent = 'Resuming...';
        // Try to show samples table
        await _fetchSamples();
        const pollResumeLabel = async () => {
          try {
            const sr = await fetch('/train/label/status');
            const sd = await sr.json();
            const d = sd.data || sd;
            if (d.current && d.total && d.total > 0) {
              const pct = Math.round((d.current / d.total) * 100);
              _trainLabelProgressFill.style.width = pct + '%';
              _trainLabelProgressText.textContent = d.current + '/' + d.total + ' (' + pct + '%)';
            }
            await _fetchSamples();
            if (d.status === 'completed') {
              _trainLabelProgressFill.style.width = '100%';
              _trainLabelProgressText.textContent = 'Complete';
              _enableLabelBtns();
              _trainLabeled = true;
              _trainPreprocessBtn.disabled = false;
              _setPipelineStatus('All labeled — preprocess next', 'ok');
              fetch('/train/save', { method: 'POST' }).catch(() => {});
              setTimeout(() => _trainLabelProgressEl.classList.add('hidden'), 2000);
              return;
            }
            if (d.status === 'failed') {
              _trainLabelProgressText.textContent = d.error || 'Failed';
              _enableLabelBtns();
              return;
            }
            setTimeout(pollResumeLabel, 10000);
          } catch { _enableLabelBtns(); }
        };
        setTimeout(pollResumeLabel, 10000);
        return; // active label task — don't fall through
      }
    }
  } catch { /* ignore */ }

  // 3. Fall back to checking what exists on disk (survives server restart)
  try {
    const r = await fetch('/train/pipeline-state');
    if (!r.ok) return;
    const state = await r.json();

    // Show file list + clear button when audio exists on disk
    if (state.has_audio) {
      _trainFileCountEl.textContent = state.audio_count;
      _trainFileListEl.classList.remove('hidden');
      // Populate minimal file entries so clear works
      if (_trainFiles.length === 0 && state.audio_files) {
        state.audio_files.forEach(name => _trainFiles.push({ filename: name }));
        _updateTrainFileList();
      }
    }

    // Reload saved dataset into AceStep memory if available
    if (state.has_saved_dataset) {
      try {
        await fetch('/train/load', { method: 'POST' });
        _trainScanned = true;
        _trainScanBtn.disabled = false;
        _trainLabelBtn.disabled = false;
        await _fetchSamples();
        const unlabeled = _trainSamples.filter(s => !s.labeled).length;
        if (unlabeled === 0 && _trainSamples.length > 0) {
          _trainLabeled = true;
          _trainPreprocessBtn.disabled = false;
        }
      } catch { /* user can scan manually */ }
    }

    if (state.has_tensors) {
      _trainPreprocessed = true; _syncSnapshotBtn();
      _trainScanned = true;
      _trainLabeled = true;
      _trainStartBtn.disabled = false;
      _trainPreprocessBtn.disabled = false;
      _trainLabelBtn.disabled = false;
      _trainScanBtn.disabled = false;
      _setPipelineStatus(state.tensor_count + ' preprocessed tensors ready — train or re-preprocess', 'ok');
    } else if (_trainLabeled) {
      _setPipelineStatus('Saved dataset loaded — all labeled, preprocess next', 'ok');
    } else if (_trainScanned) {
      const unlabeled = _trainSamples.filter(s => !s.labeled).length;
      _setPipelineStatus('Saved dataset loaded — ' + unlabeled + ' need labeling', 'ok');
    } else if (state.has_audio) {
      _trainScanBtn.disabled = false;
      _setPipelineStatus(state.audio_count + ' audio file(s) uploaded — scan to continue', '');
    }
  } catch { /* ignore */ }
}

// ===== Training Tab =====

let _trainPollTimer = null;
let _trainFiles = [];
let _trainPreprocessed = false;
let _trainScanned = false;
let _trainLabeled = false;
let _trainSamples = [];  // sample data from AceStep after scan

const _trainFileInput    = document.getElementById('train-file-input');
const _trainUploadZone   = document.getElementById('train-upload-zone');
const _trainBrowseBtn    = document.getElementById('train-browse-btn');
const _trainFileListEl   = document.getElementById('train-file-list');
const _trainFilesEl      = document.getElementById('train-files');
const _trainFileCountEl  = document.getElementById('train-file-count');
const _trainClearBtn     = document.getElementById('train-clear-files-btn');
const _trainScanBtn      = document.getElementById('train-scan-btn');
const _trainLabelBtn     = document.getElementById('train-label-btn');
const _trainPreprocessBtn = document.getElementById('train-preprocess-btn');
const _trainPipelineStatus = document.getElementById('train-pipeline-status');
const _trainStartBtn     = document.getElementById('train-start-btn');
const _trainStopBtn      = document.getElementById('train-stop-btn');
const _trainHint         = document.getElementById('train-hint');
const _trainStatusLabel  = document.getElementById('train-status-label');
const _trainEpochInfo    = document.getElementById('train-epoch-info');
const _trainLossDisplay  = document.getElementById('train-loss-display');
const _trainLossValue    = document.getElementById('train-loss-value');
const _trainLossBarFill  = document.getElementById('train-loss-bar-fill');
const _trainProgress     = document.getElementById('train-progress');
const _trainProgressFill = document.getElementById('train-progress-fill');
const _trainProgressText = document.getElementById('train-progress-text');

// Dataset view elements
const _trainDatasetView     = document.getElementById('train-dataset-view');
const _trainSampleCountEl   = document.getElementById('train-sample-count');
const _trainLabeledCountEl  = document.getElementById('train-labeled-count');
const _trainLabelProgressEl = document.getElementById('train-label-progress');
const _trainLabelProgressFill = document.getElementById('train-label-progress-fill');
const _trainLabelProgressText = document.getElementById('train-label-progress-text');
const _trainSamplesTable    = document.getElementById('train-samples-table');
const _trainLog          = document.getElementById('train-log');
const _trainCompleteActions = document.getElementById('train-complete-actions');
const _trainExportBtn    = document.getElementById('train-export-btn');
const _trainReinitBtn    = document.getElementById('train-reinit-btn');

function _setPipelineStatus(text, state) {
  _trainPipelineStatus.textContent = text;
  _trainPipelineStatus.classList.toggle('ok', state === 'ok');
  _trainPipelineStatus.classList.toggle('error', state === 'error');
}

function _updateTrainFileList() {
  _trainFileCountEl.textContent = _trainFiles.length;
  _trainFilesEl.textContent = '';
  _trainFiles.forEach(f => {
    const el = document.createElement('div');
    el.className = 'train-file-entry';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'train-file-name';
    nameSpan.textContent = f.filename;
    el.appendChild(nameSpan);
    _trainFilesEl.appendChild(el);
  });
  _trainFileListEl.classList.toggle('hidden', _trainFiles.length === 0);
  _trainScanBtn.disabled = _trainFiles.length === 0;
}

// ----- Dataset sample table -----

function _formatSecs(s) {
  if (!s || s <= 0) return '--';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? m + ':' + String(sec).padStart(2, '0') : sec + 's';
}

async function _fetchSamples() {
  try {
    const r = await fetch('/train/samples');
    if (!r.ok) {
      console.warn('fetchSamples failed:', r.status, await r.text());
      return;
    }
    const raw = await r.json();
    const data = raw.data || raw;
    const samples = data.samples || [];
    if (samples.length > 0) {
      _trainSamples = samples;
      _renderSampleTable();
      _trainDatasetView.classList.remove('hidden');
    }
  } catch (e) { console.warn('fetchSamples error:', e); }
}

function _renderSampleTable() {
  _trainSamplesTable.textContent = '';

  // Header row
  const header = document.createElement('div');
  header.className = 'train-sample-header';
  header.innerHTML = '<span>File</span><span>Dur</span><span>Caption</span>';
  _trainSamplesTable.appendChild(header);

  let labeledCount = 0;
  _trainSamples.forEach((sample, idx) => {
    if (sample.labeled) labeledCount++;
    const row = document.createElement('div');
    row.className = 'train-sample-row' + (sample.labeled ? ' labeled' : '');
    row.dataset.idx = idx;

    const nameEl = document.createElement('span');
    nameEl.className = 'train-sample-filename';
    nameEl.textContent = sample.filename || '(unknown)';
    nameEl.title = sample.filename || '';

    const durEl = document.createElement('span');
    durEl.className = 'train-sample-duration';
    durEl.textContent = _formatSecs(sample.duration);

    const captionEl = document.createElement('textarea');
    captionEl.className = 'train-sample-caption';
    captionEl.value = sample.caption || '';
    captionEl.placeholder = 'No label';
    captionEl.rows = 3;

    // Auto-save on blur: PUT the sample then persist the full dataset
    captionEl.addEventListener('blur', async () => {
      if (captionEl.value === (sample.caption || '')) return;
      try {
        const r = await fetch('/train/sample/' + idx, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption: captionEl.value }),
        });
        if (r.ok) {
          sample.caption = captionEl.value;
          sample.labeled = true;
          row.classList.add('labeled');
          _updateLabeledCount();
          fetch('/train/save', { method: 'POST' }).catch(() => {});
        }
      } catch { /* ignore */ }
    });

    row.appendChild(nameEl);
    row.appendChild(durEl);
    row.appendChild(captionEl);
    _trainSamplesTable.appendChild(row);
  });

  _trainSampleCountEl.textContent = _trainSamples.length;
  _trainLabeledCountEl.textContent = labeledCount;
}

function _updateLabeledCount() {
  const count = _trainSamples.filter(s => s.labeled).length;
  _trainLabeledCountEl.textContent = count;
  // Enable preprocess if all labeled
  if (count === _trainSamples.length && count > 0) {
    _trainLabeled = true;
    _trainPreprocessBtn.disabled = false;
  }
}

function _updateSampleInTable(idx, sampleData) {
  if (idx < 0 || idx >= _trainSamples.length) return;
  Object.assign(_trainSamples[idx], sampleData);
  // Update the row in the DOM
  const rows = _trainSamplesTable.querySelectorAll('.train-sample-row');
  const row = rows[idx];
  if (!row) return;
  const captionEl = row.querySelector('.train-sample-caption');
  if (captionEl && sampleData.caption !== undefined) {
    captionEl.value = sampleData.caption;
  }
  if (sampleData.labeled) {
    row.classList.add('labeled');
  }
  _updateLabeledCount();
}

function _enableLabelBtns() {
  _trainLabelBtn.disabled = false;
}

// Warn when 4B labeling model selected
document.getElementById('train-label-model').addEventListener('change', function() {
  document.getElementById('train-label-model-warn').classList.toggle('hidden', this.value !== 'acestep-5Hz-lm-4B');
});

// Auto-label (async with polling)
_trainLabelBtn.addEventListener('click', async () => {
  _trainLabelBtn.disabled = true;
  _trainLabelProgressEl.classList.remove('hidden');
  _trainLabelProgressText.textContent = 'Starting...';
  _trainLabelProgressFill.style.width = '0%';

  const labelModel = document.getElementById('train-label-model').value;
  const stemsMode = document.getElementById('train-stems-mode')?.checked || false;
  const body = {};
  if (labelModel) body.lm_model_path = labelModel;
  if (stemsMode) body.stems_mode = true;

  try {
    const r = await fetch('/train/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const raw = await r.json();
    const data = raw.data || raw;

    if (!r.ok) {
      _trainLabelProgressText.textContent = data.detail || 'Failed';
      _enableLabelBtns();
      return;
    }

    if (data.total === 0) {
      _trainLabelProgressText.textContent = 'All samples already labeled';
      _trainLabelProgressEl.classList.add('hidden');
      _enableLabelBtns();
      _trainLabeled = true;
      _trainPreprocessBtn.disabled = false;
      _setPipelineStatus('All labeled — preprocess next', 'ok');
      return;
    }

    // Poll auto-label status
    const pollLabel = async () => {
      try {
        const sr = await fetch('/train/label/status');
        const sraw = await sr.json();
        const info = sraw.data || sraw;

        if (info.current && info.total && info.total > 0) {
          const pct = Math.round((info.current / info.total) * 100);
          _trainLabelProgressFill.style.width = pct + '%';
          _trainLabelProgressText.textContent = info.current + '/' + info.total + ' (' + pct + '%)';
        }

        // Refresh table to show newly labeled samples
        await _fetchSamples();

        if (info.status === 'completed') {
          _trainLabelProgressFill.style.width = '100%';
          _trainLabelProgressText.textContent = 'Complete';
          _enableLabelBtns();
          _trainLabeled = true;
          _trainPreprocessBtn.disabled = false;
          _setPipelineStatus('All labeled — preprocess next', 'ok');
          // Auto-save after labeling
          fetch('/train/save', { method: 'POST' }).catch(() => {});
          setTimeout(() => _trainLabelProgressEl.classList.add('hidden'), 2000);
          return;
        }
        if (info.status === 'failed') {
          _trainLabelProgressText.textContent = info.error || 'Failed';
          _enableLabelBtns();
          return;
        }
        setTimeout(pollLabel, 10000);
      } catch {
        _trainLabelProgressText.textContent = 'Status check failed';
        _enableLabelBtns();
      }
    };
    setTimeout(pollLabel, 10000);
  } catch {
    _trainLabelProgressText.textContent = 'Connection error';
    _enableLabelBtns();
  }
});

// File upload
_trainBrowseBtn.addEventListener('click', () => _trainFileInput.click());

_trainFileInput.addEventListener('change', async () => {
  if (!_trainFileInput.files.length) return;
  const formData = new FormData();
  for (const file of _trainFileInput.files) formData.append('files', file);
  _setPipelineStatus('Uploading...', '');
  try {
    const r = await fetch('/train/upload', { method: 'POST', body: formData });
    const data = await r.json();
    if (r.ok) {
      _trainFiles.push(...(data.files || []));
      _updateTrainFileList();
      let msg = data.uploaded + ' file(s) uploaded';
      if (data.skipped) msg += ', ' + data.skipped + ' duplicate(s) skipped';
      _setPipelineStatus(msg, 'ok');
      _trainPreprocessed = false; _syncSnapshotBtn();
    } else {
      _setPipelineStatus(data.detail || 'Upload failed', 'error');
    }
  } catch {
    _setPipelineStatus('Upload failed', 'error');
  }
  _trainFileInput.value = '';
});

// Drag-and-drop
_trainUploadZone.addEventListener('dragover', e => { e.preventDefault(); _trainUploadZone.classList.add('drag-over'); });
_trainUploadZone.addEventListener('dragleave', () => _trainUploadZone.classList.remove('drag-over'));
_trainUploadZone.addEventListener('drop', async e => {
  e.preventDefault();
  _trainUploadZone.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('audio/'));
  if (!files.length) return;
  const formData = new FormData();
  files.forEach(f => formData.append('files', f));
  _setPipelineStatus('Uploading...', '');
  try {
    const r = await fetch('/train/upload', { method: 'POST', body: formData });
    const data = await r.json();
    if (r.ok) {
      _trainFiles.push(...(data.files || []));
      _updateTrainFileList();
      let msg = data.uploaded + ' file(s) uploaded';
      if (data.skipped) msg += ', ' + data.skipped + ' duplicate(s) skipped';
      _setPipelineStatus(msg, 'ok');
      _trainPreprocessed = false; _syncSnapshotBtn();
    } else {
      _setPipelineStatus(data.detail || 'Upload failed', 'error');
    }
  } catch {
    _setPipelineStatus('Upload failed', 'error');
  }
});

_trainClearBtn.addEventListener('click', async () => {
  _trainFiles = [];
  _trainSamples = [];
  _updateTrainFileList();
  _trainScanned = false;
  _trainLabeled = false;
  _trainPreprocessed = false; _syncSnapshotBtn();
  _trainStartBtn.disabled = true;
  _trainPreprocessBtn.disabled = true;
  _trainLabelBtn.disabled = true;
  _trainDatasetView.classList.add('hidden');
  _trainSamplesTable.textContent = '';
  _setPipelineStatus('Clearing...', '');
  try {
    await fetch('/train/clear', { method: 'POST' });
    _setPipelineStatus('Cleared', '');
  } catch {
    _setPipelineStatus('', '');
  }
});

// Scan & Load
_trainScanBtn.addEventListener('click', async () => {
  _trainScanBtn.disabled = true;
  _setPipelineStatus('Scanning...', '');
  const stemsMode = document.getElementById('train-stems-mode').checked;
  try {
    const r = await fetch('/train/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stems_mode: stemsMode }),
    });
    const data = await r.json();
    if (r.ok) {
      _trainScanned = true;
      _trainLabelBtn.disabled = false;
      // Fetch and display samples in center panel
      await _fetchSamples();
      const unlabeled = _trainSamples.filter(s => !s.labeled).length;
      if (unlabeled > 0) {
        _setPipelineStatus(_trainSamples.length + ' samples loaded — ' + unlabeled + ' need labeling', 'ok');
      } else {
        _setPipelineStatus(_trainSamples.length + ' samples loaded, all labeled', 'ok');
        _trainLabeled = true;
        _trainPreprocessBtn.disabled = false;
      }
    } else {
      _setPipelineStatus(data.detail || 'Scan failed', 'error');
    }
  } catch {
    _setPipelineStatus('Scan failed', 'error');
  } finally {
    _trainScanBtn.disabled = _trainFiles.length === 0;
  }
});

// Preprocess
let _preprocessDots = 0;
let _preprocessAnimTimer = null;

function _startPreprocessAnim() {
  _preprocessDots = 0;
  _preprocessAnimTimer = setInterval(() => {
    _preprocessDots = (_preprocessDots + 1) % 4;
    const dots = '.'.repeat(_preprocessDots) + '\u2008'.repeat(3 - _preprocessDots);
    const current = _trainPipelineStatus.textContent.replace(/[.\u2008]+$/, '');
    _trainPipelineStatus.textContent = current + dots;
  }, 500);
}

function _stopPreprocessAnim() {
  if (_preprocessAnimTimer) { clearInterval(_preprocessAnimTimer); _preprocessAnimTimer = null; }
}

_trainPreprocessBtn.addEventListener('click', async () => {
  _trainPreprocessBtn.disabled = true;
  _setPipelineStatus('Preprocessing', '');
  _startPreprocessAnim();
  try {
    const r = await fetch('/train/preprocess', { method: 'POST' });
    if (!r.ok) {
      _stopPreprocessAnim();
      const data = await r.json();
      _setPipelineStatus(data.detail || 'Preprocess failed', 'error');
      _trainPreprocessBtn.disabled = false;
      return;
    }
    // Poll preprocess status
    const pollPreprocess = async () => {
      try {
        const sr = await fetch('/train/preprocess/status');
        const sd = await sr.json();
        const info = sd.data || sd;
        if (info.status === 'completed' || info.status === 'done') {
          _stopPreprocessAnim();
          _setPipelineStatus('Preprocessing complete', 'ok');
          _trainPreprocessed = true; _syncSnapshotBtn();
          _trainStartBtn.disabled = false;
          _trainPreprocessBtn.disabled = false;
          fetch('/train/save', { method: 'POST' }).catch(() => {});
          return;
        } else if (info.status === 'failed' || info.status === 'error') {
          _stopPreprocessAnim();
          _setPipelineStatus(info.error || 'Preprocessing failed', 'error');
          _trainPreprocessBtn.disabled = false;
          return;
        }
        if (info.current && info.total && info.total > 0) {
          const pct = Math.round((info.current / info.total) * 100);
          _setPipelineStatus('Preprocessing ' + info.current + '/' + info.total + ' (' + pct + '%)', '');
        } else {
          _setPipelineStatus('Preprocessing', '');
        }
        setTimeout(pollPreprocess, 10000);
      } catch {
        _stopPreprocessAnim();
        _setPipelineStatus('Status check failed', 'error');
        _trainPreprocessBtn.disabled = false;
      }
    };
    setTimeout(pollPreprocess, 10000);
  } catch {
    _stopPreprocessAnim();
    _setPipelineStatus('Preprocess failed', 'error');
    _trainPreprocessBtn.disabled = false;
  }
});

// ===== Snapshots =====

const _snapshotNameInput = document.getElementById('train-snapshot-name');
const _snapshotSaveBtn   = document.getElementById('train-snapshot-save-btn');
const _snapshotListEl    = document.getElementById('train-snapshot-list');

_snapshotSaveBtn.disabled = true;

function _syncSnapshotBtn() {
  _snapshotSaveBtn.disabled = !(_trainLabeled && _trainPreprocessed);
}

async function _loadSnapshotList() {
  try {
    const r = await fetch('/train/snapshots');
    if (!r.ok) return;
    const data = await r.json();
    const snaps = data.snapshots || [];
    if (snaps.length === 0) {
      _snapshotListEl.classList.add('hidden');
      return;
    }
    _snapshotListEl.textContent = '';
    _snapshotListEl.classList.remove('hidden');
    snaps.forEach(snap => {
      const entry = document.createElement('div');
      entry.className = 'train-snapshot-entry';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'snapshot-name';
      nameSpan.textContent = snap.name;
      nameSpan.title = snap.name;

      const meta = document.createElement('span');
      meta.className = 'snapshot-meta';
      const parts = [];
      if (snap.has_dataset) parts.push('labels');
      if (snap.tensor_count > 0) parts.push(snap.tensor_count + ' tensors');
      meta.textContent = parts.join(' + ') || 'empty';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'ghost-btn';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', async () => {
        loadBtn.disabled = true;
        loadBtn.textContent = '...';
        try {
          const lr = await fetch('/train/snapshots/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: snap.name }),
          });
          if (lr.ok) {
            const result = await lr.json();
            // Update pipeline state
            if (result.restored.dataset) {
              _trainScanned = true;
              _trainLabelBtn.disabled = false;
              _trainScanBtn.disabled = false;
              await _fetchSamples();
              const unlabeled = _trainSamples.filter(s => !s.labeled).length;
              if (unlabeled === 0 && _trainSamples.length > 0) {
                _trainLabeled = true;
                _trainPreprocessBtn.disabled = false;
              }
            }
            if (result.restored.tensors > 0) {
              _trainPreprocessed = true; _syncSnapshotBtn();
              _trainStartBtn.disabled = false;
              _setPipelineStatus('Snapshot "' + snap.name + '" loaded — ' + result.restored.tensors + ' tensors ready', 'ok');
            } else if (result.restored.dataset) {
              const unlabeled = _trainSamples.filter(s => !s.labeled).length;
              if (unlabeled === 0) {
                _setPipelineStatus('Snapshot "' + snap.name + '" loaded — all labeled, preprocess next', 'ok');
              } else {
                _setPipelineStatus('Snapshot "' + snap.name + '" loaded — ' + unlabeled + ' need labeling', 'ok');
              }
            }
          }
        } catch { /* ignore */ }
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'ghost-btn';
      delBtn.textContent = 'Del';
      delBtn.addEventListener('click', async () => {
        delBtn.disabled = true;
        try {
          const dr = await fetch('/train/snapshots/' + encodeURIComponent(snap.name), { method: 'DELETE' });
          if (dr.ok) {
            entry.remove();
            if (_snapshotListEl.children.length === 0) _snapshotListEl.classList.add('hidden');
          }
        } catch { /* ignore */ }
        delBtn.disabled = false;
      });

      entry.appendChild(nameSpan);
      entry.appendChild(meta);
      entry.appendChild(loadBtn);
      entry.appendChild(delBtn);
      _snapshotListEl.appendChild(entry);
    });
  } catch { /* ignore */ }
}

_snapshotSaveBtn.addEventListener('click', async () => {
  const name = _snapshotNameInput.value.trim()
    || new Date().toISOString().replace(/[T]/g, ' ').replace(/[:]/g, '-').slice(0, 19);
  _snapshotSaveBtn.disabled = true;
  _snapshotSaveBtn.textContent = 'Saving...';
  try {
    const r = await fetch('/train/snapshots/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      _snapshotSaveBtn.textContent = 'Saved!';
      _snapshotNameInput.value = '';
      await _loadSnapshotList();
    } else {
      const data = await r.json().catch(() => ({}));
      _snapshotSaveBtn.textContent = data.detail || 'Failed';
    }
  } catch {
    _snapshotSaveBtn.textContent = 'Failed';
  }
  setTimeout(() => {
    _snapshotSaveBtn.textContent = 'Save snapshot';
    _syncSnapshotBtn();
  }, 1500);
});

// Load snapshot list on init
_loadSnapshotList();

// Start training
_trainStartBtn.addEventListener('click', async () => {
  _trainStartBtn.disabled = true;
  _trainStartBtn.classList.add('hidden');
  _trainStopBtn.classList.remove('hidden');
  _trainHint.textContent = '';
  _trainCompleteActions.classList.add('hidden');

  const payload = {
    adapter_type: document.getElementById('train-adapter-type').value,
    lora_rank: Number(document.getElementById('train-rank').value),
    lora_alpha: Number(document.getElementById('train-alpha').value),
    lora_dropout: Number(document.getElementById('train-dropout').value),
    learning_rate: Number(document.getElementById('train-lr').value),
    train_epochs: Number(document.getElementById('train-epochs').value),
    train_batch_size: Number(document.getElementById('train-batch').value),
    gradient_accumulation: Number(document.getElementById('train-grad-accum').value),
    save_every_n_epochs: Number(document.getElementById('train-save-every').value),
    training_seed: Number(document.getElementById('train-seed').value),
    gradient_checkpointing: document.getElementById('train-grad-ckpt').checked,
  };

  try {
    const r = await fetch('/train/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = (data.data && data.data.error) || data.detail || 'Failed to start training';
      _trainHint.textContent = msg;
      _trainStartBtn.classList.remove('hidden');
      _trainStopBtn.classList.add('hidden');
      _trainStartBtn.disabled = false;
      return;
    }
    _trainStatusLabel.textContent = 'Training...';
    _trainLog.textContent = 'Training started. Monitoring progress...';
    _trainLossDisplay.classList.remove('hidden');
    _trainProgress.classList.remove('hidden');
    _startTrainStatusPoll();
  } catch (e) {
    _trainHint.textContent = 'Connection error';
    _trainStartBtn.classList.remove('hidden');
    _trainStopBtn.classList.add('hidden');
    _trainStartBtn.disabled = false;
  }
});

// Stop training
_trainStopBtn.addEventListener('click', async () => {
  _trainStopBtn.disabled = true;
  try {
    await fetch('/train/stop', { method: 'POST' });
  } catch { /* best-effort */ }
  _trainStopBtn.disabled = false;
});

// Status polling
function _startTrainStatusPoll() {
  _stopTrainStatusPoll();
  _pollTrainStatus();
  _trainPollTimer = setInterval(_pollTrainStatus, 10000);
}

function _stopTrainStatusPoll() {
  if (_trainPollTimer) { clearInterval(_trainPollTimer); _trainPollTimer = null; }
}

async function _pollTrainStatus() {
  try {
    const r = await fetch('/train/status');
    if (!r.ok) return;
    const raw = await r.json();
    const d = raw.data || raw;

    if (d.is_training) {
      _trainStatusLabel.textContent = 'Training...';
      const epochText = d.current_epoch ? 'Epoch ' + d.current_epoch + (d.config && d.config.epochs ? '/' + d.config.epochs : '') : '';
      _trainEpochInfo.textContent = epochText;

      if (d.current_loss != null) {
        _trainLossValue.textContent = d.current_loss.toFixed(4);
        _trainLossDisplay.classList.remove('hidden');
        // Scale bar: assume loss starts around 1.0, goes toward 0
        const pct = Math.max(0, Math.min(100, (1 - d.current_loss) * 100));
        _trainLossBarFill.style.width = pct + '%';
      }

      if (d.config && d.config.epochs && d.current_epoch) {
        const pct = (d.current_epoch / d.config.epochs) * 100;
        _trainProgressFill.style.width = pct + '%';
        _trainProgressText.textContent = Math.round(pct) + '%';
        _trainProgress.classList.remove('hidden');
      }

      _trainStartBtn.classList.add('hidden');
      _trainStopBtn.classList.remove('hidden');
      _trainCompleteActions.classList.add('hidden');

      if (d.status) {
        _trainLog.textContent = d.status;
      }
    } else {
      // Not training
      _trainStopBtn.classList.add('hidden');
      _trainStartBtn.classList.remove('hidden');
      _trainStartBtn.disabled = !_trainPreprocessed;

      if (d.error) {
        _trainStatusLabel.textContent = 'Error';
        _trainLog.textContent = d.error;
        _trainHint.textContent = d.error;
      } else if (d.current_step > 0) {
        // Training completed
        _trainStatusLabel.textContent = 'Complete';
        _trainEpochInfo.textContent = '';
        _trainCompleteActions.classList.remove('hidden');
        _stopTrainStatusPoll();
      } else {
        _trainStatusLabel.textContent = 'Idle';
        _trainEpochInfo.textContent = '';
      }
    }
  } catch { /* ignore poll errors */ }
}

// Export trained adapter
_trainExportBtn.addEventListener('click', async () => {
  const name = prompt('Name for the exported adapter:', 'my_trained_lora');
  if (!name) return;
  _trainExportBtn.disabled = true;
  try {
    const r = await fetch('/train/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await r.json();
    if (r.ok) {
      _trainHint.textContent = 'Exported! You can now load it in the Style Adapter section.';
      // Refresh the LoRA browser
      _refreshLoraBrowser();
    } else {
      _trainHint.textContent = (data.data && data.data.error) || data.detail || 'Export failed';
    }
  } catch {
    _trainHint.textContent = 'Export failed';
  } finally {
    _trainExportBtn.disabled = false;
  }
});

// Reinitialize model after training
_trainReinitBtn.addEventListener('click', async () => {
  _trainReinitBtn.disabled = true;
  _trainHint.textContent = 'Reloading generation model...';
  try {
    const r = await fetch('/train/reinitialize', { method: 'POST' });
    if (r.ok) {
      _trainHint.textContent = 'Generation model restored. You can switch back to Create mode.';
    } else {
      _trainHint.textContent = 'Reinitialize failed — you may need to restart the server.';
    }
  } catch {
    _trainHint.textContent = 'Connection error';
  } finally {
    _trainReinitBtn.disabled = false;
  }
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
      if (_reworkApproach === 'cover') return;
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

const wfTimeStart = document.getElementById('wf-time-start');
const wfTimeEnd   = document.getElementById('wf-time-end');

function updateWaveformVisuals() {
  const start = Number(wfRegionStart.value) || 0;
  const end = Number(wfRegionEnd.value) || 0;

  if (end > start && _waveformDuration > 0) {
    const leftPct = (start / _waveformDuration) * 100;
    const widthPct = ((end - start) / _waveformDuration) * 100;
    waveformSelection.style.left = leftPct + '%';
    waveformSelection.style.width = widthPct + '%';
    waveformSelection.classList.remove('hidden');

    // In-waveform time labels at selection edges
    wfTimeStart.textContent = formatTimecode(start);
    wfTimeEnd.textContent = formatTimecode(end);

    // Selection info text
    const durSecs = end - start;
    const sectionNames = _waveformSections
      .filter(s => s.start >= start - 0.5 && s.end <= end + 0.5)
      .map(s => s.name);
    const secLabel = sectionNames.length ? sectionNames.join(' + ') + ' \u00b7 ' : '';
    wfSelectionInfo.textContent = secLabel + formatTimecode(start) + ' \u2013 ' + formatTimecode(end) + ' (' + durSecs.toFixed(1) + 's)';
  } else {
    waveformSelection.classList.add('hidden');
    wfTimeStart.textContent = '';
    wfTimeEnd.textContent = '';
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

// Click-to-seek + drag-to-select on waveform canvas
let _wfDragging = false;
let _wfDragFraction = 0;    // click/drag start position as a fraction 0–1
let _wfDragStartSecs = 0;   // drag start in seconds (for region dragging)
let _wfDragMoved = false;   // true once mouse has moved far enough to be a drag
let _wfMouseDownX = 0;
let _wfHandleDrag = null;   // 'left' | 'right' | null

waveformContainer.addEventListener('mousedown', (e) => {
  // In Reimagine mode, no region selection — entire song is processed
  if (_reworkApproach === 'cover') return;

  // Handle edge-drag
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
  _wfDragMoved = false;
  _wfMouseDownX = e.clientX;
  const rect = waveformCanvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  _wfDragFraction = rect.width > 0 ? x / rect.width : 0;
  _wfDragStartSecs = _wfDragFraction * _waveformDuration;
  // Don't start a region yet — wait to see if it's a click or a real drag
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
    // Require >4px movement before treating as a drag (avoids accidental region clear)
    if (!_wfDragMoved && Math.abs(e.clientX - _wfMouseDownX) > 4) {
      _wfDragMoved = true;
      setWaveformRegion(_wfDragStartSecs, _wfDragStartSecs);
    }
    if (_wfDragMoved) {
      setWaveformRegion(Math.min(_wfDragStartSecs, secs), Math.max(_wfDragStartSecs, secs));
    }
  }
});

document.addEventListener('mouseup', () => {
  if (_wfDragging && !_wfDragMoved) {
    // Pure click — seek using fraction × live duration
    const dur = isFinite(audioPreview.duration) ? audioPreview.duration
              : (_waveformDuration > 0 ? _waveformDuration : 0);
    if (dur > 0) {
      audioPreview.currentTime = _wfDragFraction * dur;
      _stopOthers(audioPreview);
      audioPreview.play();
    }
  }
  _wfDragging = false;
  _wfHandleDrag = null;
  _wfDragMoved = false;
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
  // Resize card waveforms in result cards
  document.querySelectorAll('.result-card').forEach(function(card) {
    if (card._waveform && card._waveform._state && card._waveform._state.data) {
      card._waveform.resize();
    }
  });
  // Resize analyze source waveform
  if (_analyzeSourcePeaks) {
    const srcContainer = document.getElementById('analyze-wf-source');
    const srcCanvas = document.getElementById('analyze-wf-source-canvas');
    const mutedColor = getComputedColor('--text-muted');
    drawAnalyzeWaveform(srcCanvas, srcContainer, _analyzeSourcePeaks, () => mutedColor);
  }
}, 200);
window.addEventListener('resize', debouncedWaveformResize);

// ===== Card Waveform — per-result-card waveform with section labels =====

function createCardWaveform(containerEl, canvasEl, audioEl, sections) {
  const ctx = canvasEl.getContext('2d');
  const playhead = document.createElement('div');
  playhead.className = 'card-wf-playhead';
  containerEl.appendChild(playhead);

  const sectionsEl = document.createElement('div');
  sectionsEl.className = 'card-wf-sections';
  containerEl.appendChild(sectionsEl);

  const state = {
    data: null,
    duration: 0,
    sections: sections || [],
    animFrame: null,
  };

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = containerEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    canvasEl.style.width = rect.width + 'px';
    canvasEl.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawPeaks() {
    if (!state.data) return;
    const w = containerEl.getBoundingClientRect().width;
    const h = containerEl.getBoundingClientRect().height;
    const barCount = state.data.length;
    if (barCount === 0) return;

    const barWidth = w / barCount;
    const mutedColor = getComputedColor('--text-muted');

    ctx.clearRect(0, 0, w, h);
    const midY = h / 2;
    const maxBarH = h * 0.85;

    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth;
      const barH = Math.max(1, state.data[i] * maxBarH);
      ctx.fillStyle = mutedColor;
      ctx.fillRect(x, midY - barH / 2, Math.max(1, barWidth - 0.5), barH);
    }
  }

  function renderSectionLabels() {
    while (sectionsEl.firstChild) sectionsEl.removeChild(sectionsEl.firstChild);
    if (!state.sections.length || !state.duration) return;

    state.sections.forEach(function(sec) {
      // Tick at section boundary
      if (sec.start > 0) {
        var tick = document.createElement('div');
        tick.className = 'card-wf-section-tick';
        tick.style.left = (sec.start / state.duration * 100) + '%';
        sectionsEl.appendChild(tick);
      }

      // Label pill
      var lbl = document.createElement('div');
      lbl.className = 'card-wf-section-label';
      lbl.textContent = sec.name;
      lbl.style.left = (sec.start / state.duration * 100) + '%';
      lbl.addEventListener('click', function(e) {
        e.stopPropagation();
        audioEl.currentTime = sec.start;
        _stopOthers(audioEl);
        audioEl.play();
      });
      sectionsEl.appendChild(lbl);
    });
  }

  // Click-to-seek on the waveform body
  containerEl.addEventListener('click', function(e) {
    if (e.target.classList.contains('card-wf-section-label')) return;
    var dur = isFinite(audioEl.duration) ? audioEl.duration
            : (state.duration > 0 ? state.duration : 0);
    if (dur <= 0) return;
    var rect = containerEl.getBoundingClientRect();
    var x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    audioEl.currentTime = (x / rect.width) * dur;
    _stopOthers(audioEl);
    audioEl.play();
  });

  // Playhead tracking
  function startTracking() {
    stopTracking();
    playhead.classList.add('active');
    (function tick() {
      if (audioEl.paused && !audioEl.seeking) {
        playhead.classList.remove('active');
        return;
      }
      var dur = state.duration || audioEl.duration || 0;
      if (dur > 0) {
        playhead.style.left = (audioEl.currentTime / dur * 100) + '%';
      }
      state.animFrame = requestAnimationFrame(tick);
    })();
  }

  function stopTracking() {
    if (state.animFrame) {
      cancelAnimationFrame(state.animFrame);
      state.animFrame = null;
    }
    playhead.classList.remove('active');
  }

  audioEl.addEventListener('play', startTracking);
  audioEl.addEventListener('pause', stopTracking);
  audioEl.addEventListener('ended', stopTracking);

  // Render — fetch, decode, downsample, draw
  async function render(audioUrl) {
    try {
      var resp = await fetch(audioUrl);
      if (!resp.ok) return;
      var arrayBuf = await resp.arrayBuffer();

      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var audioBuf = await audioCtx.decodeAudioData(arrayBuf);
      audioCtx.close();

      state.duration = audioBuf.duration;

      // Mono mixdown
      var channels = audioBuf.numberOfChannels;
      var length = audioBuf.length;
      var mono = new Float32Array(length);
      for (var ch = 0; ch < channels; ch++) {
        var chData = audioBuf.getChannelData(ch);
        for (var s = 0; s < length; s++) {
          mono[s] += chData[s] / channels;
        }
      }

      // Downsample to peaks
      resizeCanvas();
      var barCount = Math.floor(canvasEl.width / (2 * (window.devicePixelRatio || 1)));
      if (barCount < 1) barCount = 1;
      var samplesPerBar = Math.floor(length / barCount);
      state.data = new Float32Array(barCount);
      for (var i = 0; i < barCount; i++) {
        var peak = 0;
        var offset = i * samplesPerBar;
        for (var j = 0; j < samplesPerBar; j++) {
          var abs = Math.abs(mono[offset + j] || 0);
          if (abs > peak) peak = abs;
        }
        state.data[i] = peak;
      }

      drawPeaks();
      renderSectionLabels();
    } catch (err) {
      console.error('Card waveform decode error:', err);
    }
  }

  function resize() {
    resizeCanvas();
    drawPeaks();
    renderSectionLabels();
  }

  function destroy() {
    stopTracking();
    audioEl.removeEventListener('play', startTracking);
    audioEl.removeEventListener('pause', stopTracking);
    audioEl.removeEventListener('ended', stopTracking);
  }

  return { data: state.data, duration: state.duration, sections: state.sections,
           animFrame: state.animFrame, render: render, resize: resize,
           drawPeaks: drawPeaks, destroy: destroy, _state: state };
}

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
  if (_currentMode === 'analyze') {
    return !!_analyzeAudioPath;
  }
  if (_currentMode === 'rework') {
    return !!_uploadedAudioPath;
  }
  if (_createTab === 'my-lyrics') {
    return lyricsText.value.trim().length > 0 || getStylePrompt().length > 0;
  }
  if (_createTab === 'ai-lyrics') {
    return aiDescription.value.trim().length > 0 || getStylePrompt().length > 0;
  }
  return true; // instrumental — always ready
}

function updateGenerateState() {
  if (hasContent()) {
    generateBtn.classList.add('ready');
    generateHint.textContent = '';
  } else {
    generateBtn.classList.remove('ready');
    if (_currentMode === 'rework' || _currentMode === 'analyze') {
      generateHint.textContent = 'Upload audio to get started.';
    }
  }
}

// Collect shared controls (used by both Create and Rework)
function buildSharedPayload() {
  const seedRaw = document.getElementById('seed').value.trim();
  return {
    lyrics:          (_currentMode === 'create' && _createTab !== 'my-lyrics') ? '' : lyricsText.value,
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

  // AI Lyrics tab — always send sample_query built from description + style context.
  // AceStep generates lyrics; they come back in result.lyrics and populate the display.
  if (_createTab === 'ai-lyrics') {
    const desc = aiDescription.value.trim();
    const styleContext = [getStylePrompt(), getSongParamsSummary()].filter(Boolean).join(', ');
    const query = [desc, styleContext].filter(Boolean).join('. ');
    if (query) {
      payload.sample_query   = query;
      payload.vocal_language = document.getElementById('ai-language').value;
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

function buildAnalyzePayload() {
  const payload = {
    ...buildSharedPayload(),
    task_type: _analyzeMode,
    src_audio_path: _analyzeAudioPath,
    style: document.getElementById('analyze-description').value.trim(),
  };
  if (_analyzeMode === 'extract' || _analyzeMode === 'lego') {
    payload.track_name = document.getElementById('analyze-track').value;
  }
  if (_analyzeMode === 'complete') {
    payload.track_classes = getSelectedTrackClasses();
  }
  return payload;
}

function buildPayload() {
  if (_currentMode === 'analyze') return buildAnalyzePayload();
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

// Manage the output panel footer states: now-playing / generating / waveform
// Now Playing bar is always visible; only the dynamic content above it changes.
function setOutputState(state) {
  document.getElementById('output-generating').classList.toggle('hidden', state !== 'generating');
  document.getElementById('output-waveform').classList.toggle('hidden',   state !== 'waveform');
}

function getGenerateLabel() {
  if (_currentMode === 'analyze') {
    const labels = { extract: '▶ Extract', lego: '▶ Replace Track', complete: '▶ Complete' };
    return labels[_analyzeMode] || '▶ Analyze';
  }
  if (_currentMode === 'rework') {
    return _reworkApproach === 'cover' ? '▶ Reimagine' : '▶ Fix & Blend';
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
  setOutputState('now-playing');
});

const _TAB_LABELS = { 'my-lyrics': 'My Lyrics', 'ai-lyrics': 'AI Lyrics', 'instrumental': 'Instrumental', 'analyze': 'Analyze' };
const _TAB_RESULT_IDS = { 'my-lyrics': 'tab-my-lyrics-results', 'ai-lyrics': 'tab-ai-lyrics-results', 'instrumental': 'tab-instrumental-results', 'analyze': 'tab-analyze-results' };

function createResultCard(taskId, index, result, total, fmt, label, sections) {
  const card = document.createElement('div');
  card.className = 'result-card';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'card-close-btn';
  closeBtn.type = 'button';
  closeBtn.title = 'Dismiss';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => {
    if (card._waveform) card._waveform.destroy();
    // Stop audio if playing
    const audioEl = card.querySelector('audio');
    if (audioEl) {
      if (!audioEl.paused) audioEl.pause();
      _playerRegistry.delete(audioEl);
      if (_nowPlayingAudio === audioEl) {
        _nowPlayingAudio = null;
        _syncNowPlayingButtons();
        _npLabelEl.textContent = '\u2014';
      }
    }
    const container = card.parentElement;
    card.remove();
    // Hide the result area if no cards remain
    if (container && !container.querySelector('.result-card')) {
      container.classList.add('hidden');
    }
  });
  card.appendChild(closeBtn);

  if (total > 1) {
    const label = document.createElement('div');
    label.className = 'card-label';
    label.textContent = `Result ${index + 1} of ${total}`;
    card.appendChild(label);
  }

  const audio = document.createElement('audio');
  audio.src = '/audio?path=' + encodeURIComponent(result.audio_url);
  card.appendChild(audio);

  // Card waveform
  const wfContainer = document.createElement('div');
  wfContainer.className = 'card-wf-container';
  const wfCanvas = document.createElement('canvas');
  wfCanvas.className = 'card-wf-canvas';
  wfContainer.appendChild(wfCanvas);
  card.appendChild(wfContainer);

  const player = document.createElement('div');
  player.className = 'audio-player';
  player.innerHTML =
    '<button class="player-btn player-rewind" type="button" title="Rewind to start">⟪</button>' +
    '<button class="player-btn player-play"   type="button" title="Play">▶</button>' +
    '<button class="player-btn player-stop"   type="button" title="Stop" disabled>⏹</button>' +
    '<span class="player-time">0:00 / 0:00</span>' +
    `<a class="player-btn player-save" title="Save audio" href="/download/${taskId}/${index}/audio" download="acestep-${taskId.slice(0, 8)}-${index + 1}.${fmt}">⬇</a>`;
  card.appendChild(player);
  initAudioPlayer(audio, player, label);

  // Initialize card waveform after layout
  const wf = createCardWaveform(wfContainer, wfCanvas, audio, sections || []);
  card._waveform = wf;
  requestAnimationFrame(function() {
    wf.render(audio.src);
  });

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

async function showResultCards(taskId, results, fmt) {
  // Store per-tab result so Rework can auto-load from the active tab
  if (results.length > 0) {
    _tabAudio[_createTab] = {
      audioPath: results[0].audio_url,
      lyrics: results[0].lyrics || (_createTab === 'my-lyrics' ? lyricsText.value : ''),
    };
  }

  // Fetch section estimates (shared across batch — same lyrics/duration/BPM)
  var sections = [];
  var lyricsForSections = '';
  if (_createTab === 'my-lyrics') lyricsForSections = lyricsText.value;
  else if (_createTab === 'ai-lyrics' && results[0] && results[0].lyrics) lyricsForSections = results[0].lyrics;

  if (lyricsForSections && lyricsForSections.trim()) {
    try {
      var bpmVal = document.getElementById('bpm').value.trim();
      var timeSig = document.getElementById('time-sig').value;
      var dur = Number(document.getElementById('duration').value) || 30;
      var secRes = await fetch('/estimate-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics: lyricsForSections,
          duration: dur,
          bpm: bpmVal ? parseInt(bpmVal, 10) : null,
          time_signature: timeSig,
        }),
      });
      if (secRes.ok) {
        var secData = await secRes.json();
        sections = secData.sections || [];
      }
    } catch (_) { /* sections are optional */ }
  }

  const label = _TAB_LABELS[_createTab] || 'Result';
  const containerId = _TAB_RESULT_IDS[_createTab];
  const container = document.getElementById(containerId);

  // Clean up existing card waveforms before replacing
  container.querySelectorAll('.result-card').forEach(function(oldCard) {
    if (oldCard._waveform) oldCard._waveform.destroy();
  });

  container.innerHTML = '';
  results.forEach((result, i) => {
    container.appendChild(createResultCard(taskId, i, result, results.length, fmt, label, sections));
  });
  container.classList.remove('hidden');
  setOutputState('now-playing');

  // Brief amber pulse on the tab result area
  container.classList.add('results-ready');
  setTimeout(() => container.classList.remove('results-ready'), 1200);
}

async function showAnalyzeResults(taskId, results, fmt) {
  const container = document.getElementById('tab-analyze-results');

  // Clean up existing card waveforms
  container.querySelectorAll('.result-card').forEach(function(oldCard) {
    if (oldCard._waveform) oldCard._waveform.destroy();
  });

  container.innerHTML = '';
  results.forEach((result, i) => {
    // No section labels for analyze results (no lyrics to estimate from)
    container.appendChild(createResultCard(taskId, i, result, results.length, fmt, 'Analyze', []));
  });
  container.classList.remove('hidden');
  setOutputState('now-playing');

  // Render diff waveform for the first result
  if (results.length > 0 && results[0].audio_url) {
    renderAnalyzeResultWaveform('/audio?path=' + encodeURIComponent(results[0].audio_url));
  }

  container.classList.add('results-ready');
  setTimeout(() => container.classList.remove('results-ready'), 1200);
}

generateBtn.addEventListener('click', async () => {
  if (!hasContent()) {
    generateHint.textContent = (_currentMode === 'rework' || _currentMode === 'analyze')
      ? 'Upload audio to get started.'
      : 'Add some lyrics or a style description first.';
    return;
  }
  if (!validateRegion()) return;
  generateHint.textContent = '';

  // Hide stale result waveform when starting a new analyze generation
  if (_currentMode === 'analyze') {
    document.getElementById('analyze-wf-result-section').classList.add('hidden');
  }

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
    setOutputState('now-playing');
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
        if (_currentMode === 'analyze') {
          // Show result cards in the analyze result area
          await showAnalyzeResults(taskId, data.results, payload.audio_format);
        } else if (_currentMode === 'rework') {
          // Stay in waveform view — load the result as the new source audio
          const result = data.results[0];
          _uploadedAudioPath = result.audio_url;
          audioPreview.src = '/audio?path=' + encodeURIComponent(result.audio_url);
          document.getElementById('upload-filename').textContent = 'Reworked audio';
          loadWaveformForRework(result.audio_url, null, payload.lyrics || '');

          // Save reworked audio back to the active tab so it becomes the new source
          _tabAudio[_createTab] = {
            audioPath: result.audio_url,
            lyrics: payload.lyrics || (_tabAudio[_createTab] ? _tabAudio[_createTab].lyrics : ''),
          };

          // Wire download links
          const fmt = payload.audio_format || 'mp3';
          const dlAudio = document.getElementById('wf-download-audio');
          const dlJson  = document.getElementById('wf-download-json');
          const dlFile  = `acestep-${taskId.slice(0, 8)}-rework.${fmt}`;
          dlAudio.href     = `/download/${taskId}/0/audio`;
          dlAudio.download = dlFile;
          dlJson.href      = `/download/${taskId}/0/json`;
          dlJson.download  = `acestep-${taskId.slice(0, 8)}-rework.json`;
          const wfSaveBtn = document.getElementById('wf-save-btn');
          wfSaveBtn.href     = `/download/${taskId}/0/audio`;
          wfSaveBtn.download = dlFile;
          document.getElementById('waveform-result-actions').classList.remove('hidden');
        } else {
          await showResultCards(taskId, data.results, payload.audio_format);
          // AI Lyrics tab — populate read-only lyrics display with what AceStep generated
          if (_createTab === 'ai-lyrics' && data.results[0] && data.results[0].lyrics) {
            aiLyricsDisplay.value = data.results[0].lyrics;
          }
        }
      } else if (data.status === 'error') {
        clearInterval(_pollInterval);
        setGenerating(false);
        setOutputState('now-playing');
        generateHint.textContent = 'Generation failed. Check AceStep logs.';
      }
      // 'processing' → keep polling
    } catch (err) {
      clearInterval(_pollInterval);
      setGenerating(false);
      setOutputState('now-playing');
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

document.querySelectorAll('.tag:not(.track-class-tag)').forEach(tag =>
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
