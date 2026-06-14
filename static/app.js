// ============================================================
// JWriteCoach — Frontend state machine
// ============================================================

const state = {
  currentStep: 0,
  examType: null,
  topic: null,          // { id, text, hint }
  sessionId: null,
  planFeedback: null,
  canProceed: false,
  draft: null,
  correction: null,
};

const CHAR_TARGETS = {
  jlpt_n2:   { min: 300, max: 400 },
  jlpt_n1:   { min: 400, max: 600 },
  eju:       { min: 400, max: 500 },
  gaokao_jp: { min: 300, max: 350 },
  tem4:      { min: 350, max: 400 },
  tem8:      { min: 450, max: 500 },
};

const EXAM_NAMES = {
  jlpt_n2:   'N2 水平',
  jlpt_n1:   'N1 水平',
  eju:       'EJU 小論文',
  gaokao_jp: '高考日语',
  tem4:      '日语专业四级',
  tem8:      '日语专业八级',
};

// Stable anonymous identity stored in the browser, used to fetch learning history.
function getUserId() {
  let id = localStorage.getItem('jwc_user_id');
  if (!id) {
    id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('jwc_user_id', id);
  }
  return id;
}
const USER_ID = getUserId();

const ERROR_LABELS = {
  particle:    { label: '助词',   cls: 'badge-particle' },
  register:    { label: '语体',   cls: 'badge-register' },
  conjugation: { label: '活用',   cls: 'badge-conjugation' },
  connector:   { label: '接续词', cls: 'badge-connector' },
  naturalness: { label: '自然度', cls: 'badge-naturalness' },
  grammar:     { label: '语法',   cls: 'badge-grammar' },
};

// -------- Step navigation --------

function goToStep(n) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`sec-${n}`).classList.add('active');

  for (let i = 0; i <= 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    const lbl = document.getElementById(`lbl-${i}`);
    dot.className = 'step-dot';
    lbl.className = 'step-label';
    if (i < n)       { dot.classList.add('done');   lbl.classList.add('done'); }
    else if (i === n){ dot.classList.add('active'); lbl.classList.add('active'); }
  }
  state.currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goBack() {
  if (state.currentStep > 0) goToStep(state.currentStep - 1);
}

function stepClick(n) {
  const dot = document.getElementById(`dot-${n}`);
  if (dot && (dot.classList.contains('done') || dot.classList.contains('active'))) {
    goToStep(n);
  }
}

// -------- Step 0: Mode selection --------

function selectMode(examType, el) {
  state.examType = examType;
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('btn-start').disabled = false;
}

async function goToStep1() {
  goToStep(1);
  await loadTopic();
}

// -------- Step 1: Topic + Plan --------

// -------- Question type detection & adaptive position UI --------

function detectQuestionType(topicText) {
  if (/解決策|どうすれば|対策|取り組み|どう改善|解決/.test(topicText)) return 'solution';
  if (/賛成か反対|賛否|どちら(が|かを)|良い(影響|面)か悪い/.test(topicText)) return 'agree_disagree';
  return 'opinion';
}

const Q_TYPE_CONFIG = {
  agree_disagree: {
    label: '你的立场',
    hint: '↑ 这是赞否型题目，请选择或输入你的立场',
    placeholder: '例：SNSの普及に賛成（社会的つながりを深めるため）',
    quickBtns: [
      { text: '赞成', value: '賛成（肯定的な立場）' },
      { text: '反对', value: '反対（否定的な立場）' },
      { text: '± 两面评价', value: '中立（両面から考える立場）' },
    ],
    reasonsLabel: '支持你立场的理由（关键词即可）',
  },
  solution: {
    label: '你的解决思路',
    hint: '↑ 这是解决方案型题目，请描述你提出的解决方向',
    placeholder: '例：教育改革と政策支援の両面からアプローチすべきだ',
    quickBtns: [],
    reasonsLabel: '具体措施 / 论据（关键词即可）',
  },
  opinion: {
    label: '你的核心观点',
    hint: '↑ 这是意见型题目，请描述你的核心立场或看法',
    placeholder: '例：AIの発展は人間の仕事を奪うより新たな可能性を生む',
    quickBtns: [
      { text: '+ 肯定评价', value: '肯定的な見方' },
      { text: '− 批判性看法', value: '批判的な見方' },
      { text: '± 两面分析', value: '両面から考える立場' },
    ],
    reasonsLabel: '展开你观点的角度 / 论据（关键词即可）',
  },
};

function renderPositionUI(topicText) {
  const qType = detectQuestionType(topicText);
  const cfg = Q_TYPE_CONFIG[qType];

  document.getElementById('position-label').textContent = cfg.label;
  document.getElementById('position-input').placeholder = cfg.placeholder;
  document.getElementById('position-hint').textContent = cfg.hint;
  document.getElementById('reasons-label').textContent = cfg.reasonsLabel;

  const btnContainer = document.getElementById('quick-pos-btns');
  btnContainer.innerHTML = '';
  cfg.quickBtns.forEach(btn => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary';
    b.style.cssText = 'font-size:13px;padding:6px 14px';
    b.textContent = btn.text;
    b.onclick = () => {
      document.getElementById('position-input').value = btn.value;
    };
    btnContainer.appendChild(b);
  });
}

function setPosition(val) {
  document.getElementById('position-input').value = val;
}

async function loadTopic() {
  document.getElementById('topic-display').textContent = '加载中…';
  document.getElementById('topic-hint').textContent = '';
  document.getElementById('position-input').value = '';
  document.getElementById('quick-pos-btns').innerHTML = '';
  try {
    const data = await api(`/api/topic?exam_type=${state.examType}`);
    state.topic = data;
    document.getElementById('topic-display').textContent = data.text;
    document.getElementById('topic-hint').textContent = data.hint ? `参考方向：${data.hint}` : '';
    renderPositionUI(data.text);
  } catch (e) {
    document.getElementById('topic-display').textContent = '题目加载失败，请刷新重试。';
  }
}

async function submitPlan() {
  const position = document.getElementById('position-input').value.trim();
  const structure = document.querySelector('input[name="structure"]:checked')?.value;
  const reasons = [
    document.getElementById('reason1').value.trim(),
    document.getElementById('reason2').value.trim(),
    document.getElementById('reason3').value.trim(),
  ];

  if (!position) { alert('请填写你的立场或核心观点'); return; }
  if (!reasons[0]) { alert('请至少填写论点①'); return; }
  if (!structure) { alert('请选择文章构成'); return; }

  show('plan-loading');
  hide('plan-feedback-box');
  document.getElementById('btn-to-write').style.display = 'none';

  try {
    const data = await api('/api/plan/review', {
      exam_type: state.examType,
      topic_text: state.topic.text,
      position,
      reasons,
      structure,
      user_id: USER_ID,
    });

    state.sessionId = data.session_id;
    state.planFeedback = data.feedback;
    state.canProceed = data.can_proceed;

    document.getElementById('plan-feedback-text').textContent = data.feedback;
    const badge = document.getElementById('plan-status-badge');
    if (data.can_proceed) {
      badge.innerHTML = '<span class="feedback-status status-ok">可以开始写作</span>';
      document.getElementById('btn-to-write').style.display = 'inline-flex';
    } else {
      badge.innerHTML = '<span class="feedback-status status-warn">建议调整后再开始</span>';
      document.getElementById('btn-to-write').style.display = 'inline-flex';
      document.getElementById('btn-to-write').textContent = '仍然开始写作 →';
    }
    show('plan-feedback-box');
  } catch (e) {
    alert('请求失败：' + e.message);
  } finally {
    hide('plan-loading');
  }
}

function goToStep2() {
  const position = document.getElementById('position-input').value.trim() || '';
  const structure = document.querySelector('input[name="structure"]:checked')?.value || '';
  const reasons = [
    document.getElementById('reason1').value.trim(),
    document.getElementById('reason2').value.trim(),
    document.getElementById('reason3').value.trim(),
  ].filter(Boolean);

  document.getElementById('topic-display-2').textContent = state.topic.text;
  document.getElementById('plan-summary-display').innerHTML =
    `<span>立场：<strong>${position}</strong></span>` +
    `<span>理由：<strong>${reasons.join(' / ')}</strong></span>` +
    `<span>构成：<strong>${structure}</strong></span>`;

  goToStep(2);
}

// -------- Step 2: Writing + Socratic --------

function updateCharCount() {
  const text = document.getElementById('draft-input').value;
  const count = text.length;
  const target = CHAR_TARGETS[state.examType] || { min: 300, max: 500 };
  const el = document.getElementById('char-counter');
  el.textContent = `${count} 字 （目标 ${target.min}〜${target.max} 字）`;
  el.className = 'char-counter';
  if (count >= target.min && count <= target.max) el.classList.add('good');
  else if (count > target.max) el.classList.add('warn');
}

const MIN_DRAFT = 50;

async function submitDraft() {
  const draft = document.getElementById('draft-input').value.trim();
  if (draft.length < MIN_DRAFT) {
    alert(`请至少写 ${MIN_DRAFT} 字再提交（当前 ${draft.length} 字）`);
    return;
  }
  state.draft = draft;

  hide('draft-btn-row');
  show('socratic-loading');
  hide('socratic-box');

  try {
    const data = await api('/api/draft/socratic', {
      session_id: state.sessionId,
      draft,
    });

    // Parse and display questions
    const qEl = document.getElementById('socratic-questions');
    qEl.innerHTML = '';
    const lines = data.questions.split('\n').filter(l => l.trim());
    let block = '';
    lines.forEach(line => {
      if (/^[QＱ１２３1-9]/.test(line) && block) {
        qEl.innerHTML += `<div class="question-item">${block.trim()}</div>`;
        block = '';
      }
      block += line + '\n';
    });
    if (block.trim()) {
      qEl.innerHTML += `<div class="question-item">${block.trim()}</div>`;
    }

    show('socratic-box');
  } catch (e) {
    alert('获取问题失败：' + e.message);
    show('draft-btn-row');
  } finally {
    hide('socratic-loading');
  }
}

function backToWrite() {
  hide('socratic-box');
  show('draft-btn-row');
}

// -------- Handwriting OCR (writing stage) --------
// The control is hidden until /api/health reports ocr_enabled (one env switch).
async function initOcrAvailability() {
  try {
    const h = await fetch('/api/health').then(r => r.json()).catch(() => ({}));
    if (h && h.ocr_enabled) show('ocr-row');
  } catch (_) { /* leave hidden */ }
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function setOcrHint(msg, kind) {
  const el = document.getElementById('ocr-hint');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ocr-hint' + (kind ? ' ' + kind : '');
}

async function handleOcrFiles(input) {
  const files = [...input.files].slice(0, 5);
  input.value = '';  // allow re-selecting the same file
  if (!files.length) return;
  if (files.some(f => f.size > 6 * 1024 * 1024)) {
    setOcrHint('单张图片请控制在 6MB 以内（可先压缩或截图）', 'warn');
    return;
  }
  show('ocr-loading');
  setOcrHint('');
  try {
    const images = await Promise.all(files.map(readAsDataURL));
    const data = await api('/api/ocr', { images });
    const ta = document.getElementById('draft-input');
    const text = (data.text || '').trim();
    ta.value = ta.value.trim() ? (ta.value.trim() + '\n' + text) : text;
    updateCharCount();
    setOcrHint('已识别并填入下方，请仔细核对、修正可能的误读后再提交', 'ok');
  } catch (e) {
    setOcrHint(e.message || '识别失败，请重试或手动输入', 'warn');
  } finally {
    hide('ocr-loading');
  }
}

async function requestCorrection() {
  const draft = document.getElementById('draft-input').value.trim();
  if (!draft) return;
  state.draft = draft;

  hide('socratic-box');
  show('correct-loading');

  try {
    const data = await api('/api/draft/correct', {
      session_id: state.sessionId,
      draft,
    });
    state.correction = data;
    renderCorrection(data);
    goToStep(3);
    // Model essay is the slowest call (~15-20s). Start it now, in the background,
    // so it is usually ready by the time the user reaches the reflection step.
    prefetchModelEssay();
  } catch (e) {
    alert('批改请求失败：' + e.message);
    show('socratic-box');
  } finally {
    hide('correct-loading');
  }
}

function prefetchModelEssay() {
  state.modelEssayPromise = api('/api/model-essay', { session_id: state.sessionId });
  // Swallow background errors here; loadModelEssay() surfaces them on retry.
  state.modelEssayPromise.catch(() => {});
}

// -------- Step 3: Correction display --------

// Holds the current correction's annotations so the diagnostic-panel
// interactions (filter / expand / accept / ignore / hover-link) can reach them.
let corrAnns = [];

function renderCorrection(data) {
  const score = data.score_estimate || {};
  corrAnns = (data.annotations || []);

  // --- Score overview (level + comment) ---
  document.getElementById('score-badge').innerHTML = `
    <div class="diag-score">
      <div class="diag-score-level">${esc(score.level || '—')}</div>
      <div class="diag-score-cap">当前水平估计</div>
    </div>
    ${score.comment_cn ? `<div class="diag-score-comment">${esc(score.comment_cn)}</div>` : ''}`;

  // --- Corrected essay with inline error marks ---
  // Mark by token-substitution on the raw text (so escaping never matches
  // inside already-inserted markup), then escape, then expand tokens.
  let raw = data.corrected_essay || '';
  corrAnns.forEach((a, i) => {
    const frag = a.corrected || '';
    const pos = frag ? raw.indexOf(frag) : -1;
    a._marked = pos >= 0;
    if (pos >= 0) raw = raw.slice(0, pos) + `${i}` + raw.slice(pos + frag.length);
  });
  let html = esc(raw);
  corrAnns.forEach((a, i) => {
    if (!a._marked) return;
    html = html.replace(`${i}`,
      `<mark class="emark emark-${a.error_type}" id="emark-${i}" data-type="${a.error_type}"` +
      ` onmouseenter="hlSug(${i},true)" onmouseleave="hlSug(${i},false)" onclick="jumpSug(${i})">` +
      `${esc(a.corrected)}<sup class="emark-no">${i + 1}</sup></mark>`);
  });
  document.getElementById('corrected-essay').innerHTML = html;

  // --- Category filter chips ---
  const summary = data.error_summary || {};
  const total = Object.values(summary).reduce((s, v) => s + (parseInt(v) || 0), 0);
  let chips = `<button class="diag-chip diag-chip--all is-active" data-type="__all" onclick="setCorrFilter('__all',this)">全部 ${total}</button>`;
  Object.entries(summary).forEach(([type, count]) => {
    if (count > 0) {
      const info = ERROR_LABELS[type] || { label: type, cls: '' };
      chips += `<button class="diag-chip ${info.cls}" data-type="${type}" onclick="setCorrFilter('${type}',this)">${info.label} ${count}</button>`;
    }
  });
  document.getElementById('error-stats').innerHTML = chips;

  // --- Per-suggestion cards (expand / accept / ignore) ---
  const annEl = document.getElementById('annotations-list');
  if (!corrAnns.length) {
    annEl.innerHTML = '<div class="diag-empty">没有需要修改的地方，写得很好。</div>';
    return;
  }
  annEl.innerHTML = corrAnns.map((a, i) => {
    const info = ERROR_LABELS[a.error_type] || { label: a.error_type, cls: '' };
    return `
      <div class="sug" id="sug-${i}" data-type="${a.error_type}">
        <button class="sug-head" onclick="toggleSug(${i})"
          onmouseenter="hlMark(${i},true)" onmouseleave="hlMark(${i},false)">
          <span class="sug-no">${i + 1}</span>
          <span class="stat-badge ${info.cls} sug-tag">${info.label}</span>
          <span class="sug-preview"><span class="sug-orig">${esc(a.original)}</span> → <span class="sug-fixed">${esc(a.corrected)}</span></span>
          <span class="sug-caret"></span>
        </button>
        <div class="sug-body">
          <div class="sug-change">
            <span class="annotation-original">${esc(a.original)}</span>
            <span class="annotation-arrow">→</span>
            <span class="annotation-corrected">${esc(a.corrected)}</span>
          </div>
          <div class="annotation-explain">${esc(a.explanation_cn)}</div>
          <div class="sug-actions">
            <button class="sug-act sug-accept" onclick="markSug(${i},'accepted')">采纳</button>
            <button class="sug-act sug-ignore" onclick="markSug(${i},'ignored')">忽略</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ---- Diagnostic-panel interactions (client-only; no backend state) ----
function setCorrFilter(type, btn) {
  document.querySelectorAll('#error-stats .diag-chip').forEach(c => c.classList.remove('is-active'));
  if (btn) btn.classList.add('is-active');
  document.querySelectorAll('#annotations-list .sug').forEach(s => {
    s.style.display = (type === '__all' || s.dataset.type === type) ? '' : 'none';
  });
}

function toggleSug(i) {
  const el = document.getElementById(`sug-${i}`);
  if (el) el.classList.toggle('is-open');
}

function markSug(i, stateName) {
  const sug = document.getElementById(`sug-${i}`);
  const mark = document.getElementById(`emark-${i}`);
  const wasSet = sug && sug.classList.contains(`is-${stateName}`);
  ['accepted', 'ignored'].forEach(s => {
    if (sug) sug.classList.remove(`is-${s}`);
    if (mark) mark.classList.remove(`is-${s}`);
  });
  if (!wasSet) {  // toggle off if clicking the same state again
    if (sug) sug.classList.add(`is-${stateName}`);
    if (mark) mark.classList.add(`is-${stateName}`);
  }
}

// hover a suggestion -> highlight its inline mark
function hlMark(i, on) {
  const m = document.getElementById(`emark-${i}`);
  if (m) m.classList.toggle('is-hot', on);
}
// hover an inline mark -> highlight its suggestion
function hlSug(i, on) {
  const s = document.getElementById(`sug-${i}`);
  if (s) s.classList.toggle('is-hot', on);
}
// click an inline mark -> open + scroll its suggestion into view
function jumpSug(i) {
  const s = document.getElementById(`sug-${i}`);
  if (!s) return;
  s.classList.add('is-open');
  s.scrollIntoView({ behavior: 'smooth', block: 'center' });
  s.classList.add('is-flash');
  setTimeout(() => s.classList.remove('is-flash'), 900);
}

// -------- Step 4: Reflection --------

async function requestReflection() {
  show('reflect-loading');
  try {
    const data = await api('/api/reflection', { session_id: state.sessionId });
    renderReflection(data);
    // Gate: the learner summarizes first; system reflection + model essay
    // stay hidden until revealReflection().
    document.getElementById('self-reflect-input').value = '';
    show('self-reflect-card');
    hide('system-reflect');
    goToStep(4);
  } catch (e) {
    alert('生成反思失败：' + e.message);
  } finally {
    hide('reflect-loading');
  }
}

function revealReflection() {
  const note = document.getElementById('self-reflect-input').value.trim();
  const echo = document.getElementById('self-reflect-echo');
  if (note) {
    echo.innerHTML = `<div class="self-echo-label">你的自我总结</div>${esc(note)}`;
    show('self-reflect-echo');
  } else {
    hide('self-reflect-echo');
  }
  hide('self-reflect-card');
  show('system-reflect');
  loadModelEssay();  // model essay was prefetched at correction time
  document.getElementById('system-reflect').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReflection(data) {
  // Highlights
  const hl = document.getElementById('highlights-list');
  hl.innerHTML = '';
  (data.highlights || []).forEach(h => {
    hl.innerHTML += `<div class="highlight-item"><span class="ic ic-check highlight-check"></span><span>${esc(h)}</span></div>`;
  });

  // Patterns
  const pl = document.getElementById('patterns-list');
  pl.innerHTML = '';
  (data.patterns || []).forEach(p => {
    const info = ERROR_LABELS[p.type] || { label: p.type, cls: '' };
    pl.innerHTML += `
      <div class="pattern-card">
        <div class="pattern-header">
          <span class="stat-badge ${info.cls}">${info.label}</span>
          <span class="pattern-count">${p.count} 处</span>
          <strong style="font-size:14px">${esc(p.label)}</strong>
        </div>
        <div class="pattern-rule">规律：${esc(p.rule_summary)}</div>
        <div class="pattern-tip" style="margin-top:8px">练习建议：${esc(p.practice_tip)}</div>
      </div>`;
  });

  document.getElementById('next-focus').textContent = data.next_focus || '';
  document.getElementById('encouragement').textContent = data.encouragement || '';
}

async function loadModelEssay() {
  show('model-loading');
  hide('model-essay-content');
  try {
    // Reuse the background prefetch started right after correction, if present.
    const data = await (state.modelEssayPromise || api('/api/model-essay', { session_id: state.sessionId }));
    document.getElementById('model-essay-text').textContent = data.essay || '';

    const exprSection = document.getElementById('key-expressions-section');
    const exprList = document.getElementById('key-expressions-list');
    exprList.innerHTML = '';
    if (data.key_expressions && data.key_expressions.length > 0) {
      data.key_expressions.forEach(e => {
        exprList.innerHTML += `
          <div class="expr-item">
            <span class="expr-jp">${esc(e.expression)}</span>
            <span class="expr-cn">${esc(e.explanation_cn)}</span>
          </div>`;
      });
      exprSection.style.display = 'block';
    }
    show('model-essay-content');
  } catch (e) {
    document.getElementById('model-loading').innerHTML = '<span style="color:#DC2626">范文生成失败，可刷新重试</span>';
  } finally {
    hide('model-loading');
  }
}

// -------- Reset --------

function resetAll() {
  Object.assign(state, {
    currentStep: 0, examType: null, topic: null, sessionId: null,
    planFeedback: null, canProceed: false, draft: null, correction: null,
    modelEssayPromise: null,
  });

  // Reset form
  document.getElementById('position-input').value = '';
  document.getElementById('quick-pos-btns').innerHTML = '';
  document.querySelectorAll('input[name="structure"]').forEach(r => r.checked = false);
  ['reason1','reason2','reason3'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('draft-input').value = '';
  document.getElementById('char-counter').textContent = '0 字';

  hide('plan-feedback-box');
  hide('socratic-box');
  show('draft-btn-row');

  // Reset the reflection gate for the next round
  const selfInput = document.getElementById('self-reflect-input');
  if (selfInput) selfInput.value = '';
  hide('system-reflect');
  show('self-reflect-card');

  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('btn-start').disabled = true;

  goToStep(0);
}

// -------- Learning history dashboard --------

async function openHistory() {
  const modal = document.getElementById('history-modal');
  modal.style.display = 'flex';
  show('history-loading');
  hide('history-empty');
  hide('history-content');
  try {
    const data = await api(`/api/history?user_id=${encodeURIComponent(USER_ID)}`);
    const hasEssays = data.sessions && data.sessions.length > 0;
    const hasEmails = data.email_sessions && data.email_sessions.length > 0;
    if (!hasEssays && !hasEmails) {
      show('history-empty');
    } else {
      if (hasEssays) { renderHistory(data); show('history-essay-wrap'); } else { hide('history-essay-wrap'); }
      if (hasEmails) { renderEmailHistory(data); show('history-email-wrap'); } else { hide('history-email-wrap'); }
      show('history-content');
    }
  } catch (e) {
    document.getElementById('history-loading').innerHTML =
      '<span style="color:var(--red)">加载失败，请稍后重试</span>';
    return;
  } finally {
    hide('history-loading');
  }
}

function closeHistory() {
  document.getElementById('history-modal').style.display = 'none';
}

// -------- History detail: re-open one past essay / email --------

function openDetailModal() {
  document.getElementById('detail-body').innerHTML = '';
  show('detail-loading');
  document.getElementById('detail-modal').style.display = 'flex';
}

function closeDetail() {
  document.getElementById('detail-modal').style.display = 'none';
}

function detailError(e) {
  document.getElementById('detail-body').innerHTML =
    `<div class="card" style="color:var(--red)">加载失败：${esc(e.message)}</div>`;
}

function fmtDate(s) {
  return (s || '').replace('T', ' ').slice(0, 16);
}

async function openEssayDetail(sessionId) {
  openDetailModal();
  try {
    const d = await api(`/api/history/essay/${encodeURIComponent(sessionId)}?user_id=${encodeURIComponent(USER_ID)}`);
    document.getElementById('detail-body').innerHTML = essayDetailHtml(d);
  } catch (e) {
    detailError(e);
  } finally {
    hide('detail-loading');
  }
}

async function openEmailDetail(sessionId) {
  openDetailModal();
  try {
    const d = await api(`/api/history/email/${encodeURIComponent(sessionId)}?user_id=${encodeURIComponent(USER_ID)}`);
    document.getElementById('detail-body').innerHTML = emailDetailHtml(d);
  } catch (e) {
    detailError(e);
  } finally {
    hide('detail-loading');
  }
}

function essayDetailHtml(d) {
  const c = d.correction || {};
  const score = c.score_estimate || {};
  const examName = EXAM_NAMES[d.exam_type] || d.exam_type || '';
  const summary = c.error_summary || {};
  const statBadges = Object.entries(summary)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => {
      const info = ERROR_LABELS[t] || { label: t, cls: '' };
      return `<span class="stat-badge ${info.cls}">${info.label} ${n}</span>`;
    }).join('');
  const anns = (c.annotations || []).map(a => {
    const info = ERROR_LABELS[a.error_type] || { label: a.error_type, cls: '' };
    return `
      <div class="annotation-card">
        <div class="annotation-header"><span class="stat-badge ${info.cls}" style="font-size:11px">${info.label}</span></div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <span class="annotation-original">${esc(a.original)}</span>
          <span class="annotation-arrow">→</span>
          <span class="annotation-corrected">${esc(a.corrected)}</span>
        </div>
        <div class="annotation-explain">${esc(a.explanation_cn)}</div>
      </div>`;
  }).join('');

  return `
    <div class="detail-meta">
      <div class="detail-title">${esc(examName)}</div>
      <div class="detail-date">${fmtDate(d.created_at)}</div>
    </div>
    <div class="detail-topic"><strong>题目：</strong>${esc(d.topic_text || '')}</div>
    ${d.position ? `<div class="detail-topic"><strong>立场：</strong>${esc(d.position)}</div>` : ''}
    <div class="score-badge" style="margin:14px 0">当时水平估计：${esc(score.level || '—')}　${esc(score.comment_cn || '')}</div>
    ${statBadges ? `<div class="detail-stat-row">${statBadges}</div>` : ''}
    ${d.draft_original ? `
      <div class="card">
        <div class="card-title"><span class="ic ic-doc"></span>你当时的原文</div>
        <div class="correction-essay">${esc(d.draft_original)}</div>
      </div>` : ''}
    <div class="card">
      <div class="card-title"><span class="ic ic-check"></span>修改稿</div>
      <div class="correction-essay">${esc(c.corrected_essay || '')}</div>
    </div>
    ${anns ? `<div class="card"><div class="card-title"><span class="ic ic-search"></span>批注详情（${(c.annotations || []).length}处）</div>${anns}</div>` : ''}
  `;
}

function emailDetailHtml(d) {
  const c = d.correction || {};
  const score = c.score || {};
  const grade = score.grade || '—';
  const gradeColor = { S: '#4F6B57', A: '#3D3F86', B: '#9A6B1E', C: '#A8443B' }[grade] || '#6E6A60';

  const scoreGrid = `
    <div class="card">
      <div class="card-title"><span class="ic ic-bars"></span>批改评分</div>
      <div class="email-score-grid">
        ${Object.entries(SCORE_DIM_LABELS).map(([k, v]) => `
          <div class="email-score-card">
            <div class="email-score-val" style="color:${scoreColor(score[k] || 0)}">${score[k] || 0}<span style="font-size:13px;color:var(--gray-400)">/10</span></div>
            <div class="email-score-dim">${v.label}</div>
            <div class="email-score-desc">${v.desc}</div>
          </div>`).join('')}
        <div class="email-score-card email-score-total">
          <div class="email-score-val" style="color:${gradeColor};font-size:32px">${grade}</div>
          <div class="email-score-dim">${score.total || 0} / 40</div>
          <div class="email-score-desc">${esc(score.comment_cn || '')}</div>
        </div>
      </div>
    </div>`;

  const mistakes = c.keigo_mistakes || [];
  const keigoHtml = mistakes.length ? `
    <div class="card card-keigo-alert">
      <div class="card-title"><span class="ic ic-alert"></span>敬語错误详解（${mistakes.length}处）</div>
      ${mistakes.map(m => `
        <div class="keigo-mistake-item">
          <span class="keigo-mistake-type">${esc(m.type)}</span>
          <div class="keigo-mistake-row">
            <span class="keigo-orig">${esc(m.original)}</span>
            <span class="keigo-arrow">→</span>
            <span class="keigo-fixed">${esc(m.corrected)}</span>
          </div>
          <div class="keigo-rule">${esc(m.rule)}</div>
        </div>`).join('')}
    </div>` : '';

  const annotations = c.annotations || [];
  const annHtml = annotations.length ? `
    <div class="card">
      <div class="card-title"><span class="ic ic-search"></span>批注详情（${annotations.length}处）</div>
      ${annotations.map(a => {
        const info = EMAIL_ERROR_LABELS[a.error_type] || { label: a.error_type, cls: '' };
        return `
          <div class="annotation-item">
            <span class="badge ${info.cls}">${info.label}</span>
            <div class="annotation-change">
              <span class="ann-orig">${esc(a.original)}</span>
              <span class="ann-arrow">→</span>
              <span class="ann-fixed">${esc(a.corrected)}</span>
            </div>
            <div class="annotation-exp">${esc(a.explanation_cn)}</div>
          </div>`;
      }).join('')}
    </div>` : '';

  const highlights = c.highlights || [];
  const hlHtml = highlights.length ? `
    <div class="card card-highlight">
      <div class="card-title"><span class="ic ic-star"></span>做得好的地方</div>
      ${highlights.map(h => `<div class="highlight-item"><span class="ic ic-check" style="color:var(--matcha);width:15px;height:15px"></span> ${esc(h)}</div>`).join('')}
    </div>` : '';

  return `
    <div class="detail-meta">
      <div class="detail-title">${esc(d.scene_title || '')}</div>
      <div class="detail-date">${fmtDate(d.created_at)}</div>
    </div>
    ${scoreGrid}
    ${keigoHtml}
    ${annHtml}
    ${hlHtml}
    ${d.email_draft ? `
      <div class="card">
        <div class="card-title"><span class="ic ic-doc"></span>你当时写的邮件</div>
        <div class="correction-essay">${esc(d.email_draft)}</div>
      </div>` : ''}
    <div class="card">
      <div class="card-title"><span class="ic ic-check"></span>修改稿</div>
      <div class="correction-essay">${esc(c.corrected_email || '')}</div>
    </div>
  `;
}

function renderHistory(data) {
  const stats = data.stats || {};
  const sessions = data.sessions || [];

  // Stat cards
  const weakInfo = stats.weakest_type ? ERROR_LABELS[stats.weakest_type] : null;
  document.getElementById('history-stat-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-num">${stats.total_sessions || 0}</div>
      <div class="stat-cap">累计练习</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${stats.total_errors || 0}</div>
      <div class="stat-cap">累计批注</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="font-size:18px">${weakInfo ? weakInfo.label : '—'}</div>
      <div class="stat-cap">最需强化</div>
    </div>`;

  // Error-type distribution bars
  const totals = stats.error_totals || {};
  const maxCount = Math.max(1, ...Object.values(totals));
  const barsEl = document.getElementById('history-error-bars');
  barsEl.innerHTML = '';
  Object.entries(ERROR_LABELS).forEach(([type, info]) => {
    const count = totals[type] || 0;
    const pct = Math.round((count / maxCount) * 100);
    barsEl.innerHTML += `
      <div class="err-bar-row">
        <span class="err-bar-label">${info.label}</span>
        <div class="err-bar-track">
          <div class="err-bar-fill ${info.cls}" style="width:${count ? Math.max(pct, 6) : 0}%"></div>
        </div>
        <span class="err-bar-num">${count}</span>
      </div>`;
  });

  // Trend chart (errors per essay, oldest → newest)
  const trend = stats.trend || [];
  const trendEl = document.getElementById('history-trend');
  trendEl.innerHTML = '';
  if (trend.length === 0) {
    trendEl.innerHTML = '<span class="section-sub">暂无足够数据</span>';
  } else {
    const maxErr = Math.max(1, ...trend.map(t => t.total_errors));
    trend.forEach((t, i) => {
      const h = Math.max(6, Math.round((t.total_errors / maxErr) * 90));
      trendEl.innerHTML += `
        <div class="trend-bar-wrap" title="第${i + 1}篇 · ${t.total_errors}处批注">
          <span class="trend-val">${t.total_errors}</span>
          <div class="trend-bar" style="height:${h}px"></div>
          <span class="trend-idx">${i + 1}</span>
        </div>`;
    });
  }

  // Session list
  const listEl = document.getElementById('history-list');
  listEl.innerHTML = '';
  sessions.forEach(s => {
    const date = (s.created_at || '').replace('T', ' ').slice(0, 16);
    const examName = EXAM_NAMES[s.exam_type] || s.exam_type;
    const badges = Object.entries(s.error_summary || {})
      .filter(([, c]) => c > 0)
      .map(([type, c]) => {
        const info = ERROR_LABELS[type] || { label: type, cls: '' };
        return `<span class="stat-badge ${info.cls}" style="font-size:10px">${info.label} ${c}</span>`;
      }).join('');
    listEl.innerHTML += `
      <div class="hist-item hist-item-click" onclick="openEssayDetail('${s.session_id}')">
        <div class="hist-item-head">
          <span class="hist-exam">${examName}</span>
          <span class="hist-level">${s.score_level || '—'}</span>
          <span class="hist-date">${date}</span>
        </div>
        <div class="hist-topic">${esc((s.topic_text || '').slice(0, 60))}${(s.topic_text || '').length > 60 ? '…' : ''}</div>
        <div class="hist-badges">${badges || '<span class="section-sub" style="font-size:11px">无批注</span>'}</div>
        <div class="hist-open-hint">点击回看完整批改 →</div>
      </div>`;
  });
}

// -------- Email history (Track 2) --------

function renderEmailHistory(data) {
  const stats = data.email_stats || {};
  const sessions = data.email_sessions || [];

  // Stat cards
  const weakDim = stats.weakest_dim ? SCORE_DIM_LABELS[stats.weakest_dim] : null;
  document.getElementById('history-email-stat-cards').innerHTML = `
    <div class="stat-card">
      <div class="stat-num">${stats.total_sessions || 0}</div>
      <div class="stat-cap">累计邮件</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${stats.avg_total || 0}<span style="font-size:13px;color:var(--gray-400)">/40</span></div>
      <div class="stat-cap">平均总分</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="font-size:18px">${weakDim ? weakDim.label : '—'}</div>
      <div class="stat-cap">最需强化</div>
    </div>`;

  // Per-dimension average score bars (0-10, higher = better)
  const dimAvgs = stats.dim_avgs || {};
  const barsEl = document.getElementById('history-email-bars');
  barsEl.innerHTML = '';
  Object.entries(SCORE_DIM_LABELS).forEach(([dim, info]) => {
    const avg = dimAvgs[dim] || 0;
    const pct = Math.round((avg / 10) * 100);
    barsEl.innerHTML += `
      <div class="err-bar-row">
        <span class="err-bar-label wide">${info.label}</span>
        <div class="err-bar-track">
          <div class="err-bar-fill" style="width:${avg ? Math.max(pct, 6) : 0}%;background:${scoreColor(avg)}"></div>
        </div>
        <span class="err-bar-num">${avg}</span>
      </div>`;
  });

  // Trend chart (total score per email, oldest → newest; taller = better)
  const trend = stats.trend || [];
  const trendEl = document.getElementById('history-email-trend');
  trendEl.innerHTML = '';
  if (trend.length === 0) {
    trendEl.innerHTML = '<span class="section-sub">暂无足够数据</span>';
  } else {
    trend.forEach((t, i) => {
      const h = Math.max(6, Math.round((t.total / 40) * 90));
      trendEl.innerHTML += `
        <div class="trend-bar-wrap" title="第${i + 1}封 · ${t.total}/40（${t.grade}）">
          <span class="trend-val">${t.total}</span>
          <div class="trend-bar" style="height:${h}px"></div>
          <span class="trend-idx">${i + 1}</span>
        </div>`;
    });
  }

  // Session list
  const listEl = document.getElementById('history-email-list');
  listEl.innerHTML = '';
  sessions.forEach(s => {
    const date = (s.created_at || '').replace('T', ' ').slice(0, 16);
    const dimBadges = Object.entries(SCORE_DIM_LABELS)
      .map(([dim, info]) => {
        const v = (s.dims || {})[dim] || 0;
        return `<span class="stat-badge" style="font-size:10px;color:${scoreColor(v)}">${info.label} ${v}</span>`;
      }).join('');
    listEl.innerHTML += `
      <div class="hist-item hist-item-click" onclick="openEmailDetail('${s.session_id}')">
        <div class="hist-item-head">
          <span class="hist-exam">${esc(s.scene_title || '')}</span>
          <span class="hist-level">${esc(s.grade || '—')} · ${s.total || 0}/40</span>
          <span class="hist-date">${date}</span>
        </div>
        <div class="hist-topic">${esc(s.draft_preview || '')}${(s.draft_preview || '').length >= 60 ? '…' : ''}</div>
        <div class="hist-badges">${dimBadges}</div>
        <div class="hist-open-hint">点击回看完整批改 →</div>
      </div>`;
  });
}

// -------- Utilities --------

async function api(path, body) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ============================================================
// Track 2: Email Mode
// ============================================================

const EMAIL_SCENES = [
  {
    id: 'prof_kekka',
    title: '请假申请',
    icon: '🏥',
    difficulty: '初级',
    description: '因病或因事无法出席课程/研讨会，向教授发送请假邮件',
    fields: [
      { id: 'course', label: '课程名称', placeholder: '例：日本語言語学概論' },
      { id: 'date',   label: '请假日期', placeholder: '例：6月10日（火）の授業' },
      { id: 'reason', label: '请假原因（简洁即可）', placeholder: '例：発熱のため / 帰省のため' },
      { id: 'request', label: '希望如何处理', placeholder: '例：授業の資料をいただけますでしょうか' },
    ],
    keigo_tips: [
      '先表达歉意，再说明原因——不要开门见山就说"我要请假"',
      '理由简洁即可（一句话），不需要过度解释',
      '主动提出补救方案，显示你负责任的态度',
      '「教えてください」过于直接 → 建议用「ご教示いただけますでしょうか」',
    ],
    cushion: '「ご迷惑をおかけして申し訳ございません」',
  },
  {
    id: 'prof_shitsumon',
    title: '课程提问',
    icon: '❓',
    difficulty: '初级',
    description: '对课程内容、作业要求或论文方向有疑问，通过邮件向教授请教',
    fields: [
      { id: 'course',    label: '课程/作业名称', placeholder: '例：第3回レポート課題' },
      { id: 'question',  label: '具体疑问点', placeholder: '例：○○という概念の定義について' },
      { id: 'my_thought', label: '你自己的理解（先写出来）', placeholder: '例：○○と理解していますが合っているでしょうか' },
    ],
    keigo_tips: [
      '先表明自己的理解再提问——说明你已思考过，避免被认为懒惰',
      '「ご教示いただけますでしょうか」比「教えてください」礼貌得多',
      '一封邮件不要同时提太多问题，聚焦在一个核心疑问上',
      '常用缓冲：「お時間のある際に」「よろしければ」',
    ],
    cushion: '「お忙しいところ恐れ入りますが」',
  },
  {
    id: 'prof_mendan',
    title: '约见面谈',
    icon: '📅',
    difficulty: '中级',
    description: '希望预约教授的office hour，讨论论文选题、研究进度等',
    fields: [
      { id: 'purpose',      label: '面谈目的', placeholder: '例：修士論文のテーマについてご相談したく' },
      { id: 'time_options', label: '你方便的时间（2-3个备选）', placeholder: '例：来週の火曜か木曜の午後' },
      { id: 'duration',     label: '预计时长（可选）', placeholder: '例：30分ほど' },
    ],
    keigo_tips: [
      '提供2-3个时间选项，让教授选——不要只说"随时都行"',
      '约见目的要明确写出来，不要含糊地说"想聊聊"',
      '「ご都合がよろしければ」比「時間ありますか」礼貌得多',
      '开场用：「お忙しいところ誠に恐れ入りますが」',
    ],
    cushion: '「お忙しいところ誠に恐れ入りますが」',
  },
  {
    id: 'prof_suisen',
    title: '求推荐信',
    icon: '📝',
    difficulty: '高级',
    description: '申请留学、交换项目或就职时，请求导师/教授撰写推荐信',
    fields: [
      { id: 'purpose',   label: '推荐信用途', placeholder: '例：○○大学への交換留学申請' },
      { id: 'deadline',  label: '截止日期', placeholder: '例：7月末まで（越早越好！）' },
      { id: 'relation',  label: '与该教授的关系', placeholder: '例：3年次から○○ゼミに所属' },
      { id: 'strength',  label: '希望教授提及的方面（可选）', placeholder: '例：研究への取り組み姿勢など' },
    ],
    keigo_tips: [
      '至少提前1个月发送——截止前一周才问是大忌',
      '开场用：「誠に勝手なお願いではございますが」',
      '为教授提供便利：告知deadline、所需格式、你的项目说明等',
      '若被拒绝要优雅接受，不要施压',
    ],
    cushion: '「誠に勝手なお願いではございますが」',
  },

  // ---- 求职 / 就活 ----
  {
    id: 'job_entry',
    category: 'jobhunt',
    title: '应募/エントリー',
    icon: '📨',
    difficulty: '中级',
    description: '向企业发送求职申请/咨询邮件，表达应募意向（常附简历）',
    fields: [
      { id: 'company',  label: '公司·收件人', placeholder: '例：株式会社○○ 採用ご担当者様' },
      { id: 'position', label: '应聘职位',     placeholder: '例：総合職 / ○○エンジニア職' },
      { id: 'channel',  label: '得知途径（可选）', placeholder: '例：貴社採用サイト / 大学キャリアセンター' },
      { id: 'appeal',   label: '一句话自我推荐', placeholder: '例：○○の経験を活かしたく応募いたしました' },
    ],
    keigo_tips: [
      '宛名不知道具体姓名时用「採用ご担当者様」，知道部门姓名则「人事部 ○○様」',
      '名乗り必写学校·学部·姓名：「○○大学○○学部の○○と申します」',
      '开头直接说明应募意图，简洁有力，避免冗长寒暄',
      '若附简历要在正文提及：「履歴書を添付いたしますので、ご査収ください」',
    ],
    cushion: '「突然のご連絡失礼いたします」',
  },
  {
    id: 'job_obog',
    category: 'jobhunt',
    title: 'OB·OG訪問依頼',
    icon: '🤝',
    difficulty: '高级',
    description: '请求向已入职的学长/学姐（OB·OG）请教，约访问·咨询',
    fields: [
      { id: 'intro',   label: '你如何得知对方', placeholder: '例：大学のキャリアセンターでご連絡先を拝見し' },
      { id: 'purpose', label: '想请教什么',     placeholder: '例：貴社の○○業務についてお話を伺いたく' },
      { id: 'time',    label: '你方便的时间（可选）', placeholder: '例：来週以降、○○様のご都合に合わせます' },
    ],
    keigo_tips: [
      '对方虽是前辈但素未谋面，要格外礼貌并说明来由，避免唐突',
      '明确说明怎么拿到对方联系方式的，消除"陌生联络"的戒心',
      '时间上完全配合对方：「○○様のご都合に合わせて伺います」',
      '感谢对方百忙中抽时间，结尾留有退路（对方拒绝也不施压）',
    ],
    cushion: '「突然のご連絡を差し上げる失礼をお許しください」',
  },
  {
    id: 'job_schedule',
    category: 'jobhunt',
    title: '面试日程调整',
    icon: '🗓️',
    difficulty: '中级',
    description: '回复企业的面试邀约，确认或协调面试时间',
    fields: [
      { id: 'which',        label: '针对哪次选考', placeholder: '例：一次面接 / ○○職の選考' },
      { id: 'availability', label: '你能配合的时间', placeholder: '例：候補日のうち○月○日○時が可能です' },
      { id: 'note',         label: '其他说明（可选）', placeholder: '例：上記以外の日程もご相談可能です' },
    ],
    keigo_tips: [
      '收到邀约24小时内回复，开头先道谢「面接の機会をいただき」',
      '明确写出能/不能的具体日期，不要含糊地说"都行"',
      '若需改期要诚恳致歉并主动提供2-3个备选时间',
      '结尾确认出席：「当日はどうぞよろしくお願いいたします」',
    ],
    cushion: '「この度は面接の機会をいただき、誠にありがとうございます」',
  },
  {
    id: 'job_thanks',
    category: 'jobhunt',
    title: '面试后致谢',
    icon: '🙏',
    difficulty: '中级',
    description: '面试结束当天，向面试官/人事发送感谢邮件',
    fields: [
      { id: 'interview',  label: '面试信息',       placeholder: '例：本日○時の一次面接' },
      { id: 'impression', label: '印象最深的一点', placeholder: '例：○○のお話が大変勉強になりました' },
      { id: 'aspiration', label: '强化志望度（可选）', placeholder: '例：貴社で働きたい思いが一層強まりました' },
    ],
    keigo_tips: [
      '面试当天发出，最迟次日上午——越快越显诚意',
      '提及面试中的具体内容，显示真诚，避免"模板感"',
      '简洁为主，面试官很忙，不要写太长',
      '再次表达志望度，但不卑微、不施压',
    ],
    cushion: '「本日はお忙しい中、貴重なお時間をいただき」',
  },
  {
    id: 'job_naitei',
    category: 'jobhunt',
    title: '内定承诺/辞退',
    icon: '✅',
    difficulty: '高级',
    description: '接受或婉拒企业的录用（内定），措辞需格外得体',
    fields: [
      { id: 'decision',  label: '承诺还是辞退',   placeholder: '例：内定を承諾したく / 誠に恐縮ながら辞退を' },
      { id: 'reason',    label: '辞退理由（可选）', placeholder: '例：諸般の事情により（不必详述）' },
      { id: 'gratitude', label: '感谢之词',       placeholder: '例：選考を通じて大変お世話になりました' },
    ],
    keigo_tips: [
      '辞退要尽早，越拖越失礼；语气务必诚恳致歉',
      '辞退理由不必详述，「諸般の事情により」即可，但道歉要真诚',
      '承诺要表达干劲与感谢，让对方安心',
      '无论承诺辞退，都要感谢对方提供的選考机会',
    ],
    cushion: '「この度は内定のご連絡をいただき、誠にありがとうございます」',
  },

  // ---- 商务基础 / ビジネス ----
  {
    id: 'biz_irai',
    category: 'business',
    title: '业务请求/依頼',
    icon: '🙇',
    difficulty: '中级',
    description: '请同事或合作方协助处理事务、提供资料（依頼メール）',
    fields: [
      { id: 'recipient', label: '收件对象',         placeholder: '例：株式会社○○ ○○部 ○○様' },
      { id: 'request',   label: '请求的具体内容',   placeholder: '例：○○の資料をお送りいただきたく' },
      { id: 'deadline',  label: '希望期限',         placeholder: '例：○月○日（金）までに' },
      { id: 'background', label: '背景说明（可选）', placeholder: '例：来週の会議で使用するため' },
    ],
    keigo_tips: [
      '依頼内容和期限要具体明确，不要让对方猜——「なるべく早く」是大忌',
      '「〜してください」过于直接 → 「〜していただけますでしょうか」「〜いただけますと幸いです」',
      '简述理由让对方理解必要性，更容易获得配合',
      '结尾用「ご検討のほど、よろしくお願いいたします」留出余地',
    ],
    cushion: '「お忙しいところ恐れ入りますが」',
  },
  {
    id: 'biz_apo',
    category: 'business',
    title: '约定会议/拜访',
    icon: '🗓️',
    difficulty: '中级',
    description: '与公司内外的工作对象约定打ち合わせ或拜访时间（アポ取り）',
    fields: [
      { id: 'purpose',      label: '会议/拜访目的', placeholder: '例：新プロジェクトのお打ち合わせ' },
      { id: 'time_options', label: '候补时间（2-3个）', placeholder: '例：○月○日（火）14時〜 / ○日（木）10時〜' },
      { id: 'format',       label: '形式（可选）',   placeholder: '例：オンライン（Zoom）/ 御社にお伺い' },
      { id: 'duration',     label: '预计时长（可选）', placeholder: '例：1時間ほど' },
    ],
    keigo_tips: [
      '提供2-3个候补时间让对方选，并补一句「上記以外でも調整可能です」',
      '写明形式（対面/オンライン）和预计时长，方便对方安排',
      '「ご都合いかがでしょうか」比「いつが空いていますか」礼貌得多',
      '时间确定后要回一封确认邮件，复述日期·时间·地点',
    ],
    cushion: '「ご多忙のところ恐縮ですが」',
  },
  {
    id: 'biz_soufu',
    category: 'business',
    title: '资料送付/报告',
    icon: '📎',
    difficulty: '初级',
    description: '向对方发送资料、附件，或汇报工作进展（送付・報告メール）',
    fields: [
      { id: 'what',       label: '送付物/报告内容', placeholder: '例：お見積書 / ○○の進捗状況' },
      { id: 'attachment', label: '附件文件名（可选）', placeholder: '例：見積書_株式会社○○様.pdf' },
      { id: 'point',      label: '要点/补充说明（可选）', placeholder: '例：ご不明点がございましたらお知らせください' },
    ],
    keigo_tips: [
      '有附件必须在正文提及：「○○を添付いたしますので、ご査収ください」',
      '「ご査収ください」= 请查收确认，是送付メール的定番表达',
      '报告要結論ファースト：先说结论/现状，再补充细节',
      '大文件别直接发附件，先确认或改用文件传输服务',
    ],
    cushion: '「お手数をおかけしますが、ご確認のほどよろしくお願いいたします」',
  },
  {
    id: 'biz_owabi',
    category: 'business',
    title: '道歉/お詫び',
    icon: '🙏',
    difficulty: '高级',
    description: '因延误、失误等向对方致歉并提出补救措施（お詫びメール）',
    fields: [
      { id: 'what_happened',  label: '发生了什么',     placeholder: '例：納品が予定より遅れる / 資料に誤りがあった' },
      { id: 'cause',          label: '原因（简述）',   placeholder: '例：確認不足により' },
      { id: 'countermeasure', label: '补救措施/对策',  placeholder: '例：明日○時までに修正版をお送りします' },
    ],
    keigo_tips: [
      '先道歉再解释——开头就致歉，不要先摆理由像在找借口',
      '道歉程度分级：一般用「申し訳ございません」，重大失误用「深くお詫び申し上げます」',
      '必须写明补救措施和今后的预防对策，重建信任',
      '发现问题立刻联络，道歉越拖越失礼',
    ],
    cushion: '「この度はご迷惑をおかけし、誠に申し訳ございません」',
  },
];

const emailState = {
  scene: null,
  keyInfo: {},
  emailDraft: null,
  correction: null,
  modelEmailPromise: null,
};

function updateEmailStepper(step) {
  [0, 1, 2].forEach(i => {
    const dot = document.getElementById(`email-dot-${i}`);
    const lbl = document.getElementById(`email-lbl-${i}`);
    if (!dot) return;
    dot.className = 'step-dot';
    lbl.className = 'step-label';
    if (i < step)        { dot.classList.add('done');   lbl.classList.add('done'); }
    else if (i === step) { dot.classList.add('active'); lbl.classList.add('active'); }
  });
}

function goEmailStep(n) {
  ['sec-email-0', 'sec-email-1', 'sec-email-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  const target = document.getElementById(`sec-email-${n}`);
  if (target) target.classList.add('active');
  updateEmailStepper(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function enterEmailMode() {
  document.getElementById('sec-0').classList.remove('active');
  document.getElementById('stepper').style.display = 'none';
  document.getElementById('email-stepper').style.display = 'flex';
  renderEmailSceneGrid();
  goEmailStep(0);
}

function exitEmailMode() {
  ['sec-email-0', 'sec-email-1', 'sec-email-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  document.getElementById('email-stepper').style.display = 'none';
  document.getElementById('stepper').style.display = 'flex';
  document.getElementById('sec-0').classList.add('active');
}

const EMAIL_CATEGORIES = [
  { id: 'academic', label: '给教授 / 导师', icon: '🎓' },
  { id: 'jobhunt',  label: '求职 / 就活',   icon: '💼' },
  { id: 'business', label: '商务基础 / ビジネス', icon: '🏢' },
];

function renderEmailSceneGrid() {
  const grid = document.getElementById('email-scene-grid');
  const card = s => `
    <div class="email-scene-card" id="esc-${s.id}" onclick="selectEmailScene('${s.id}', this)">
      <div class="esc-title">${esc(s.title)}</div>
      <div class="esc-difficulty">${esc(s.difficulty)}</div>
      <div class="esc-desc">${esc(s.description)}</div>
    </div>`;
  grid.innerHTML = EMAIL_CATEGORIES.map(cat => {
    const scenes = EMAIL_SCENES.filter(s => (s.category || 'academic') === cat.id);
    if (!scenes.length) return '';
    return `<div class="email-cat-header">${cat.label}</div>`
      + scenes.map(card).join('');
  }).join('');
}

function selectEmailScene(sceneId, el) {
  emailState.scene = EMAIL_SCENES.find(s => s.id === sceneId);
  document.querySelectorAll('.email-scene-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('btn-email-start').disabled = false;
  const desc = document.getElementById('email-scene-desc');
  desc.style.display = '';
  desc.innerHTML = `<span class="ic ic-idea"></span> 常用クッション言葉：<strong>${esc(emailState.scene.cushion)}</strong>`;
}

function startEmailWrite() {
  if (!emailState.scene) return;
  emailState.keyInfo = {};
  document.getElementById('email-scene-recap').textContent =
    `${emailState.scene.title}——${emailState.scene.description}`;
  document.getElementById('email-draft-input').value = '';
  document.getElementById('email-char-counter').textContent = '0 字';
  document.getElementById('btn-email-correct').disabled = false;
  document.getElementById('email-format-panel').style.display = 'none';
  document.getElementById('email-format-toggle').textContent = '展开 ▼';
  document.getElementById('email-keigo-tips').style.display = 'none';
  document.getElementById('keigo-tips-toggle').textContent = '展开 ▼';
  renderEmailKeyFields();
  renderKeigoTips();
  renderEmailFormatPanel();
  goEmailStep(1);
}

function renderEmailKeyFields() {
  document.getElementById('email-key-fields').innerHTML =
    emailState.scene.fields.map(f => `
      <div class="form-group">
        <label class="form-label">${esc(f.label)}</label>
        <input class="form-input" id="ekf-${f.id}" placeholder="${esc(f.placeholder)}"
               oninput="emailState.keyInfo['${f.id}'] = this.value">
      </div>`).join('');
}

function renderKeigoTips() {
  document.getElementById('email-keigo-tips').innerHTML =
    emailState.scene.keigo_tips.map(t => `<div class="keigo-tip-item">• ${esc(t)}</div>`).join('');
}

const EMAIL_FORMAT_TEMPLATES = {
  academic: [
    ['宛名', '〇〇先生 / 〇〇教授'],
    ['名乗り', '〇〇学部〇年の〇〇と申します。'],
    ['挨拶', 'いつもお世話になっております。'],
    ['用件', '（本題を一文で明確に）'],
    ['本文', '（詳細・依頼・質問内容）'],
    ['結び', 'どうぞよろしくお願いいたします。'],
    ['署名', '氏名 / 学籍番号 / 連絡先'],
  ],
  jobhunt: [
    ['宛名', '株式会社〇〇 採用ご担当者様 / 人事部 〇〇様'],
    ['名乗り', '〇〇大学〇〇学部の〇〇と申します。'],
    ['挨拶', 'お世話になっております。（初回は「突然のご連絡失礼いたします」）'],
    ['用件', '（応募・日程・お礼など、目的を一文で）'],
    ['本文', '（具体的な内容・志望度・依頼）'],
    ['結び', '何卒よろしくお願い申し上げます。'],
    ['署名', '大学名 / 氏名 / 電話 / メール'],
  ],
  business: [
    ['宛名', '株式会社〇〇 〇〇部 〇〇様（会社・部署宛は「御中」）'],
    ['名乗り', '〇〇株式会社の〇〇でございます。'],
    ['挨拶', 'いつもお世話になっております。'],
    ['用件', '（結論ファースト：目的を一文で明確に）'],
    ['本文', '（詳細・依頼内容・日程・添付の言及など）'],
    ['結び', '何卒よろしくお願い申し上げます。'],
    ['署名', '会社名 / 部署 / 氏名 / 電話 / メール'],
  ],
};

function renderEmailFormatPanel() {
  const tmpl = EMAIL_FORMAT_TEMPLATES[emailState.scene.category] || EMAIL_FORMAT_TEMPLATES.academic;
  document.getElementById('email-format-box').innerHTML = tmpl
    .map(([tag, val]) => `<div class="email-format-line"><span class="email-format-tag">${esc(tag)}</span>${esc(val)}</div>`)
    .join('');
}

function toggleEmailFormat() {
  const panel = document.getElementById('email-format-panel');
  const btn   = document.getElementById('email-format-toggle');
  const open  = panel.style.display === 'none';
  panel.style.display = open ? '' : 'none';
  btn.textContent = open ? '收起 ▲' : '展开 ▼';
}

function toggleKeigoTips() {
  const panel = document.getElementById('email-keigo-tips');
  const btn   = document.getElementById('keigo-tips-toggle');
  const open  = panel.style.display === 'none';
  panel.style.display = open ? '' : 'none';
  btn.textContent = open ? '收起 ▲' : '展开 ▼';
}

function updateEmailCounter(el) {
  document.getElementById('email-char-counter').textContent = `${el.value.length} 字`;
}

function buildKeyInfoString() {
  return emailState.scene.fields
    .map(f => ({ label: f.label, val: (emailState.keyInfo[f.id] || '').trim() }))
    .filter(x => x.val)
    .map(x => `${x.label}：${x.val}`)
    .join('\n') || '（未提供具体要素，请按场景常规写法示范）';
}

async function submitEmailCorrect() {
  const draft = document.getElementById('email-draft-input').value.trim();
  if (draft.length < 30) { alert('邮件内容太短，请至少写30字'); return; }
  emailState.emailDraft = draft;

  show('email-correct-loading');
  document.getElementById('btn-email-correct').disabled = true;

  try {
    const result = await api('/api/email/correct', {
      scene_id:       emailState.scene.id,
      scene_title:    emailState.scene.title,
      scene_category: emailState.scene.category || 'academic',
      key_info:       buildKeyInfoString(),
      email_draft:    draft,
      user_id:        USER_ID,
    });
    emailState.correction = result;
    emailState.modelEmailPromise = api('/api/email/model', {
      scene_id:       emailState.scene.id,
      scene_title:    emailState.scene.title,
      scene_category: emailState.scene.category || 'academic',
      key_info:       buildKeyInfoString(),
    });
    emailState.modelEmailPromise.catch(() => {});
    renderEmailCorrection(result);
    goEmailStep(2);
  } catch (e) {
    alert('批改失败：' + e.message);
    document.getElementById('btn-email-correct').disabled = false;
  } finally {
    hide('email-correct-loading');
  }
}

const SCORE_DIM_LABELS = {
  keigo:       { label: '敬語正確性', desc: '尊敬語/謙譲語正确使用' },
  politeness:  { label: '礼貌度',     desc: 'クッション言葉·语气' },
  format:      { label: '格式完整性', desc: '宛名·結び·署名等' },
  naturalness: { label: '语言自然度', desc: '地道流畅，无中文腔' },
};

const EMAIL_ERROR_LABELS = {
  keigo:       { label: '敬語', cls: 'badge-grammar' },
  politeness:  { label: '礼貌度', cls: 'badge-naturalness' },
  format:      { label: '格式', cls: 'badge-connector' },
  naturalness: { label: '自然度', cls: 'badge-particle' },
};

function scoreColor(v) {
  if (v >= 9) return '#4F6B57';  // 沙青 sage
  if (v >= 7) return '#3D3F86';  // 藍 indigo
  if (v >= 5) return '#9A6B1E';  // 金 ochre
  return '#A8443B';              // 朱 seal
}

function renderEmailCorrection(result) {
  const score = result.score || {};
  const grade = score.grade || '—';
  const gradeColor = { S: '#4F6B57', A: '#3D3F86', B: '#9A6B1E', C: '#A8443B' }[grade] || '#6E6A60';

  // Score cards
  document.getElementById('email-score-section').innerHTML = `
    <div class="card">
      <div class="card-title"><span class="ic ic-bars"></span>批改评分</div>
      <div class="email-score-grid">
        ${Object.entries(SCORE_DIM_LABELS).map(([k, v]) => `
          <div class="email-score-card">
            <div class="email-score-val" style="color:${scoreColor(score[k] || 0)}">${score[k] || 0}<span style="font-size:13px;color:var(--gray-400)">/10</span></div>
            <div class="email-score-dim">${v.label}</div>
            <div class="email-score-desc">${v.desc}</div>
          </div>`).join('')}
        <div class="email-score-card email-score-total">
          <div class="email-score-val" style="color:${gradeColor};font-size:32px">${grade}</div>
          <div class="email-score-dim">${score.total || 0} / 40</div>
          <div class="email-score-desc">${esc(score.comment_cn || '')}</div>
        </div>
      </div>
    </div>`;

  // Keigo mistakes
  const mistakes = result.keigo_mistakes || [];
  document.getElementById('email-keigo-mistakes-section').innerHTML = mistakes.length ? `
    <div class="card card-keigo-alert">
      <div class="card-title"><span class="ic ic-alert"></span>敬語错误详解（${mistakes.length}处，重点记忆）</div>
      ${mistakes.map(m => `
        <div class="keigo-mistake-item">
          <span class="keigo-mistake-type">${esc(m.type)}</span>
          <div class="keigo-mistake-row">
            <span class="keigo-orig">${esc(m.original)}</span>
            <span class="keigo-arrow">→</span>
            <span class="keigo-fixed">${esc(m.corrected)}</span>
          </div>
          <div class="keigo-rule">${esc(m.rule)}</div>
        </div>`).join('')}
    </div>` : '';

  // Annotations
  const annotations = result.annotations || [];
  document.getElementById('email-annotations-section').innerHTML = annotations.length ? `
    <div class="card">
      <div class="card-title"><span class="ic ic-search"></span>批注详情（${annotations.length}处）</div>
      ${annotations.map(a => {
        const info = EMAIL_ERROR_LABELS[a.error_type] || { label: a.error_type, cls: '' };
        return `
          <div class="annotation-item">
            <span class="badge ${info.cls}">${info.label}</span>
            <div class="annotation-change">
              <span class="ann-orig">${esc(a.original)}</span>
              <span class="ann-arrow">→</span>
              <span class="ann-fixed">${esc(a.corrected)}</span>
            </div>
            <div class="annotation-exp">${esc(a.explanation_cn)}</div>
          </div>`;
      }).join('')}
    </div>` : '';

  // Highlights
  const highlights = result.highlights || [];
  document.getElementById('email-highlights-section').innerHTML = highlights.length ? `
    <div class="card card-highlight">
      <div class="card-title"><span class="ic ic-star"></span>做得好的地方</div>
      ${highlights.map(h => `<div class="highlight-item"><span class="ic ic-check" style="color:var(--matcha);width:15px;height:15px"></span> ${esc(h)}</div>`).join('')}
    </div>` : '';

  // Corrected email
  document.getElementById('email-corrected-text').innerHTML =
    esc(result.corrected_email || '').replace(/\n/g, '<br>');

  // Reset model section
  document.getElementById('btn-email-model').disabled = false;
  hide('email-model-content');
  hide('email-model-loading');
}

async function loadEmailModel() {
  document.getElementById('btn-email-model').disabled = true;
  show('email-model-loading');
  hide('email-model-content');
  try {
    const data = await (emailState.modelEmailPromise || api('/api/email/model', {
      scene_id:       emailState.scene.id,
      scene_title:    emailState.scene.title,
      scene_category: emailState.scene.category || 'academic',
      key_info:       buildKeyInfoString(),
    }));
    renderEmailModel(data);
    show('email-model-content');
  } catch (e) {
    document.getElementById('email-model-loading').innerHTML =
      `<span style="color:var(--red)">范文生成失败：${esc(e.message)}</span>`;
  } finally {
    hide('email-model-loading');
  }
}

function renderEmailModel(data) {
  const notes = data.notes_cn || [];
  const exprs = data.key_expressions || [];
  document.getElementById('email-model-content').innerHTML = `
    ${notes.length ? `<div class="model-notes">${notes.map(n => `<div class="model-note-item">${esc(n)}</div>`).join('')}</div>` : ''}
    <div class="corrected-essay model-email-text">${esc(data.email || '').replace(/\n/g, '<br>')}</div>
    ${exprs.length ? `
      <div class="key-expressions" style="margin-top:16px">
        <div class="section-sub" style="margin-bottom:8px;font-weight:600">范文重点表达</div>
        ${exprs.map(e => `
          <div class="key-expr-item">
            <span class="key-expr-jp">${esc(e.expression)}</span>
            <span class="key-expr-cn">${esc(e.explanation_cn)}</span>
          </div>`).join('')}
      </div>` : ''}`;
}

function resetEmailMode() {
  Object.assign(emailState, {
    scene: null, keyInfo: {}, emailDraft: null, correction: null, modelEmailPromise: null,
  });
  document.getElementById('email-draft-input').value = '';
  document.getElementById('email-char-counter').textContent = '0 字';
  document.getElementById('btn-email-correct').disabled = false;
  document.getElementById('btn-email-start').disabled = true;
  document.getElementById('email-scene-desc').style.display = 'none';
  document.querySelectorAll('.email-scene-card').forEach(c => c.classList.remove('selected'));
  ['email-score-section', 'email-keigo-mistakes-section',
   'email-annotations-section', 'email-highlights-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  goEmailStep(0);
}

// Reveal handwriting upload if the backend has OCR enabled
initOcrAvailability();
