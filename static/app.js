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
};

const EXAM_NAMES = {
  jlpt_n2:   'N2 水平',
  jlpt_n1:   'N1 水平',
  eju:       'EJU 小論文',
  gaokao_jp: '高考日语',
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
      { text: '✓ 赞成', value: '賛成（肯定的な立場）' },
      { text: '✗ 反对', value: '反対（否定的な立場）' },
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
    document.getElementById('topic-hint').textContent = data.hint ? `💡 参考方向：${data.hint}` : '';
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
      badge.innerHTML = '<span class="feedback-status status-ok">✓ 可以开始写作</span>';
      document.getElementById('btn-to-write').style.display = 'inline-flex';
    } else {
      badge.innerHTML = '<span class="feedback-status status-warn">⚠ 建议调整后再开始</span>';
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

function renderCorrection(data) {
  // Score badge
  const score = data.score_estimate || {};
  document.getElementById('score-badge').innerHTML =
    `<div class="score-badge">📊 当前水平估计：${score.level || '—'}&nbsp;&nbsp;${score.comment_cn || ''}</div>`;

  // Error stats
  const statsEl = document.getElementById('error-stats');
  statsEl.innerHTML = '';
  const summary = data.error_summary || {};
  Object.entries(summary).forEach(([type, count]) => {
    if (count > 0) {
      const info = ERROR_LABELS[type] || { label: type, cls: '' };
      statsEl.innerHTML += `<span class="stat-badge ${info.cls}">${info.label} ${count}</span>`;
    }
  });

  // Corrected essay
  document.getElementById('corrected-essay').textContent = data.corrected_essay || '';

  // Annotations
  const annEl = document.getElementById('annotations-list');
  annEl.innerHTML = '';
  (data.annotations || []).forEach(ann => {
    const info = ERROR_LABELS[ann.error_type] || { label: ann.error_type, cls: '' };
    annEl.innerHTML += `
      <div class="annotation-card">
        <div class="annotation-header">
          <span class="stat-badge ${info.cls}" style="font-size:11px">${info.label}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <span class="annotation-original">${esc(ann.original)}</span>
          <span class="annotation-arrow">→</span>
          <span class="annotation-corrected">${esc(ann.corrected)}</span>
        </div>
        <div class="annotation-explain">💡 ${esc(ann.explanation_cn)}</div>
      </div>`;
  });
}

// -------- Step 4: Reflection --------

async function requestReflection() {
  show('reflect-loading');
  try {
    const data = await api('/api/reflection', { session_id: state.sessionId });
    renderReflection(data);
    goToStep(4);
    // Also kick off model essay async
    loadModelEssay();
  } catch (e) {
    alert('生成反思失败：' + e.message);
  } finally {
    hide('reflect-loading');
  }
}

function renderReflection(data) {
  // Highlights
  const hl = document.getElementById('highlights-list');
  hl.innerHTML = '';
  (data.highlights || []).forEach(h => {
    hl.innerHTML += `<div class="highlight-item"><span class="highlight-check">✓</span><span>${esc(h)}</span></div>`;
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
        <div class="pattern-rule">📖 规律：${esc(p.rule_summary)}</div>
        <div class="pattern-tip" style="margin-top:8px">🏋️ 练习建议：${esc(p.practice_tip)}</div>
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
    if (!data.sessions || data.sessions.length === 0) {
      show('history-empty');
    } else {
      renderHistory(data);
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
      <div class="hist-item">
        <div class="hist-item-head">
          <span class="hist-exam">${examName}</span>
          <span class="hist-level">${s.score_level || '—'}</span>
          <span class="hist-date">${date}</span>
        </div>
        <div class="hist-topic">${esc((s.topic_text || '').slice(0, 60))}${(s.topic_text || '').length > 60 ? '…' : ''}</div>
        <div class="hist-badges">${badges || '<span class="section-sub" style="font-size:11px">无批注</span>'}</div>
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
