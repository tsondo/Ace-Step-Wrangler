// ACE-Step Wrangler — app.js
// Stage 3: Style panel — tag groups, selection count, clear all, style preview.

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

// ===== Generate button (stub — wired in Stage 5) =====

document.getElementById('generate-btn').addEventListener('click', () => {
  // TODO Stage 5: POST to /generate
  console.log('[stub] generate');
});
