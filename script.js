/**
 * =============================================
 * متتبع الوقت اليومي + تايمر السبرينت
 * script.js — النسخة الكاملة النظيفة
 * =============================================
 */

// ==========================================
// 1. ثوابت ومتغيرات عامة
// ==========================================

const COLORS = {
  'دراسة':   '#4ade80',
  'استراحة': '#60a5fa',
  'صلاة':    '#f59e0b',
  'أكل':     '#f97316',
  'تسخيت':   '#f43f5e',
  'أخرى':    '#a78bfa',
};

const ACTIVITY_KEYS = ['دراسة', 'استراحة', 'صلاة', 'أكل', 'تسخيت', 'أخرى'];

/* حالة التايمر الرئيسي */
const state = {
  running:       false,
  totalSeconds:  600,       // يتحدث من الإعدادات
  remaining:     600,
  intervalNum:   1,
  currentSession: [],
  viewDate:      todayKey(),
  goalMinutes:   180,
  darkMode:      true,
  activePopup:   null,
  _wasRunning:   false,
  intervalMinutes: 10,      // المدة المختارة من المستخدم
};

let timerTick = null;

/* حالة تايمر السبرينت */
const sprint = {
  running:   false,
  elapsed:   0,
  tickId:    null,
  minimized: false,
  sessions:  [],       // [{start, end, duration(ثواني), date}]
  goalMin:   60,       // هدف الجلسة اليومية بالدقائق
  audioCtx:  null,
  beatCount: 0,
};

// ==========================================
// 2. حساب التاريخ (إصلاح UTC)
// ==========================================

function todayKey() {
  return localDateKey(new Date());
}

function localDateKey(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ✅ الحل الصحيح لتجنب مشكلة UTC عند التنقل بين الأيام */
function shiftDate(dateKey, delta) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d); // توقيت محلي
  date.setDate(date.getDate() + delta);
  return localDateKey(date);
}

function fmt2(n) { return String(n).padStart(2, '0'); }

/** تنسيق الوقت بنظام 12 ساعة: "03:25 م" */
function fmtTime12(date) {
  let h   = date.getHours();
  const m = fmt2(date.getMinutes());
  const p = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${fmt2(h)}:${m} ${p}`;
}

// ==========================================
// 3. اللوكال ستوريج
// ==========================================

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('waqti_settings') || '{}');
  state.darkMode       = s.darkMode       ?? true;
  state.goalMinutes    = s.goalMinutes    ?? 180;
  state.intervalMinutes = s.intervalMinutes ?? 10;
  sprint.goalMin       = s.sprintGoal     ?? 60;
  // طبّق المدة على التايمر
  state.totalSeconds = state.intervalMinutes * 60;
  state.remaining    = state.totalSeconds;
  applyTheme();
  updateGoalDisplay();
  updateDurDisplay();
}

function saveSettings() {
  localStorage.setItem('waqti_settings', JSON.stringify({
    darkMode:        state.darkMode,
    goalMinutes:     state.goalMinutes,
    sprintGoal:      sprint.goalMin,
    intervalMinutes: state.intervalMinutes,
  }));
}

function loadTodayData() {
  const key   = `waqti_${todayKey()}`;
  const saved = localStorage.getItem(key);
  state.currentSession      = saved ? JSON.parse(saved) : [];
  state._loadedForDay       = todayKey(); // نحفظ اليوم الذي حُمّل لأجله
}

function saveTodayData() {
  localStorage.setItem(`waqti_${todayKey()}`, JSON.stringify(state.currentSession));
  updateStreak();
  if (window._fbSync) window._fbSync();
}

function getDayData(dateKey) {
  const saved = localStorage.getItem(`waqti_${dateKey}`);
  return saved ? JSON.parse(saved) : [];
}

function getAllDates() {
  const dates = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (!k.startsWith('waqti_')) continue;
    // استبعد مفاتيح الإعدادات وFirebase والسبرينت
    if (k === 'waqti_settings') continue;
    if (k.includes('sprint'))   continue;
    if (k.includes('plan'))     continue;
    if (k.includes('fb'))       continue;
    // تأكد إن المفتاح يطابق صيغة تاريخ YYYY-MM-DD
    const dateStr = k.replace('waqti_', '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    dates.push(dateStr);
  }
  return dates.sort().reverse();
}

/* ---- سبرينت ---- */
function loadSprintData() {
  const saved = localStorage.getItem(`waqti_sprint_${todayKey()}`);
  sprint.sessions = saved ? JSON.parse(saved) : [];
  updateSprintStats();
}

function saveSprintData() {
  const todaySess = sprint.sessions.filter(s => s.date === todayKey());
  localStorage.setItem(`waqti_sprint_${todayKey()}`, JSON.stringify(todaySess));
}

function getSprintDayData(dateKey) {
  const saved = localStorage.getItem(`waqti_sprint_${dateKey}`);
  return saved ? JSON.parse(saved) : [];
}

// ==========================================
// 4. التايمر الرئيسي — لا يقف أبداً بعد البدء
// ==========================================

/**
 * طابور البوب آبات المنتظرة
 * لو مرت 30 دقيقة والمستخدم لم يختر → 3 بوب آبات وراء بعض
 */
let popupQueue = [];    // عدد البوب آبات المنتظرة
let popupOpen  = false; // هل البوب آب مفتوح الآن؟

/** بدء التايمر — يُستدعى مرة واحدة فقط ثم لا يقف أبداً */
function startTimer() {
  if (state.running) return;
  state.running = true;
  document.body.classList.add('running');
  updateStartBtn();

  timerTick = setInterval(() => {
    state.remaining--;
    updateTimerDisplay();
    updateRing();

    if (state.remaining <= 0) {
      // انتهى إنتيرفال — أضف للطابور واستمر فوراً
      state.intervalNum++;
      document.getElementById('intervalNum').textContent = state.intervalNum;
      state.remaining = state.totalSeconds;
      updateTimerDisplay();
      updateRing();

      popupQueue.push(Date.now());
      playIntervalSound();
      sendNotification();
      drainPopupQueue();
    }
  }, 1000);
}

/**
 * استنزاف الطابور — يعرض البوب آبات واحداً تلو الآخر
 * إذا كان البوب آب مفتوحاً، انتظر حتى يُغلق
 */
function drainPopupQueue() {
  if (popupOpen || popupQueue.length === 0) return;
  popupQueue.shift();
  showActivityPopup();
}

/** بعد البدء: زر Space لا يوقف التايمر — فقط يبدأ */
function toggleTimer() {
  if (!state.running) startTimer();
}

/** إعادة التعيين — فقط قبل البدء */
function resetTimer() {
  if (state.running) return;
  state.remaining   = state.totalSeconds;
  state.intervalNum = 1;
  popupQueue        = [];
  document.getElementById('intervalNum').textContent = 1;
  updateTimerDisplay();
  updateRing();
  updateStartBtn();
}

function updateStartBtn() {
  const btn   = document.getElementById('startBtn');
  const reset = document.getElementById('resetBtn');
  const durRow = document.getElementById('intervalDurationRow');

  if (state.running) {
    btn.innerHTML     = '⏱ يعمل';
    btn.style.opacity = '0.65';
    btn.style.cursor  = 'not-allowed';
    if (reset)  reset.disabled = true;
    if (durRow) durRow.classList.add('hidden');
  } else {
    btn.innerHTML     = '▶ ابدأ <kbd>Space</kbd>';
    btn.style.opacity = '';
    btn.style.cursor  = '';
    if (reset)  reset.disabled = false;
    if (durRow) durRow.classList.remove('hidden');
  }
}

function onIntervalEnd() { /* لم يعد يُستخدم مباشرة */ }

/**
 * Page Visibility API — التايمر يستمر حتى خارج التبويب
 * نحسب الوقت المنقضي عند العودة بدلاً من الإيقاف
 */
let _hiddenAt = null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    _hiddenAt = Date.now();
  } else {
    if (_hiddenAt !== null && state.running) {
      const elapsed = Math.floor((Date.now() - _hiddenAt) / 1000);
      _hiddenAt = null;

      let remaining = state.remaining - elapsed;
      let extra     = 0;

      while (remaining <= 0) {
        extra++;
        remaining += state.totalSeconds;
        state.intervalNum++;
      }

      state.remaining = remaining;
      document.getElementById('intervalNum').textContent = state.intervalNum;
      updateTimerDisplay();
      updateRing();

      if (extra > 0) {
        for (let i = 0; i < extra; i++) popupQueue.push(Date.now());
        playIntervalSound();
        sendNotification();
        drainPopupQueue();
      }
    }
    _hiddenAt = null;
  }
});

// ==========================================
// 5. تحديث واجهة التايمر الرئيسي
// ==========================================

function updateTimerDisplay() {
  const m = Math.floor(state.remaining / 60);
  const s = state.remaining % 60;
  document.getElementById('timerDisplay').textContent = `${fmt2(m)}:${fmt2(s)}`;
}

function updateRing() {
  const elapsed = state.totalSeconds - state.remaining;
  const offset  = 596.9 - (elapsed / state.totalSeconds) * 596.9;
  document.getElementById('ringProgress').setAttribute('stroke-dashoffset', offset);
}

function updateClock() {
  const now = new Date();
  document.getElementById('currentTime').textContent =
    now.toLocaleTimeString('ar-IQ', { hour12: true });
  document.getElementById('currentDate').textContent =
    now.toLocaleDateString('ar-IQ', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

// ==========================================
// 6. البوب آب واختيار النشاط
// ==========================================

function showActivityPopup() {
  popupOpen = true;
  state.activePopup = 'activity';

  const pending  = popupQueue.length;
  const subtitle = document.getElementById('popupPending');
  if (subtitle) {
    if (pending > 0) {
      subtitle.textContent = `⚠️ ${pending + 1} إنتيرفال انتهت — اختر للأول`;
      subtitle.className   = 'urgent';
    } else {
      subtitle.textContent = 'انتهى إنتيرفال 10 دقائق!';
      subtitle.className   = '';
    }
  }

  document.getElementById('overlay').classList.add('active');
  document.getElementById('popup').classList.add('active');
  document.getElementById('customInputWrap').classList.remove('visible');
  document.getElementById('customActivity').value = '';
}

function hideActivityPopup() {
  popupOpen = false;
  state.activePopup = null;
  const overlay = document.getElementById('overlay');
  document.getElementById('popup').classList.remove('active');
  setTimeout(() => {
    if (popupQueue.length > 0) {
      drainPopupQueue();
    } else {
      overlay.classList.remove('active');
    }
  }, 380);
}

function selectActivity(activityName, durationMinutes = state.intervalMinutes) {
  if (activityName === 'تسخيت') {
    // أخفِ بوب آب النشاط مؤقتاً دون drain، وأظهر بوب آب الضمير
    document.getElementById('popup').classList.remove('active');
    state.activePopup = 'guilt';
    showGuiltPopup(durationMinutes);
    return;
  }
  _commitActivity(activityName, durationMinutes);
}

function _commitActivity(activityName, durationMinutes = 10) {
  // ✅ إذا تغيّر اليوم منذ آخر تحميل، أعد تحميل بيانات اليوم الجديد أولاً
  if (state._loadedForDay && state._loadedForDay !== todayKey()) {
    loadTodayData();
  }

  const now       = new Date();
  const endTime   = fmtTime12(now);
  const startD    = new Date(now.getTime() - durationMinutes * 60000);
  const startTime = fmtTime12(startD);

  state.currentSession.push({
    activity:  activityName,
    start:     startTime,
    end:       endTime,
    duration:  durationMinutes,
    timestamp: now.getTime(),
    color:     COLORS[activityName] || COLORS['أخرى'],
  });

  saveTodayData();
  renderRecent();
  updateGoalBar();
  hideActivityPopup();
}

// ==========================================
// 7. الصوت
// ==========================================

function getAudioCtx() {
  if (!sprint.audioCtx) {
    sprint.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sprint.audioCtx;
}

/* صوت انتهاء الإنتيرفال الرئيسي */
function playIntervalSound() {
  try {
    const ctx   = getAudioCtx();
    const now   = ctx.currentTime;
    [523, 659, 784].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, now + i * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 0.4);
      osc.start(now + i * 0.2);
      osc.stop(now + i * 0.2 + 0.45);
    });
  } catch (e) {}
}

/**
 * صوت السبرينت — نبضة هادئة كل ثانية تشبه دقات الساعة
 * استخدم صوت "woodblock" مُحاكى: نبضة قصيرة جداً بتردد منخفض
 */
function playSprintTick(isEven) {
  try {
    const ctx  = getAudioCtx();
    const now  = ctx.currentTime;

    // Woodblock مُحاكى: نبضتان بترددات مختلفة قليلاً
    const freq = isEven ? 480 : 420;

    const osc    = ctx.createOscillator();
    const gain   = ctx.createGain();
    // فلتر لجعل الصوت أكثر دفئاً
    const filter = ctx.createBiquadFilter();
    filter.type            = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value         = 2;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.type            = 'square';
    osc.frequency.value = freq;

    // هجوم سريع جداً + تلاشٍ سريع = نبضة حادة
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.start(now);
    osc.stop(now + 0.05);
  } catch (e) {}
}

/* نغمة لطيفة عند اكتمال كل دقيقة في السبرينت */
function playSprintMinuteBell() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    // نغمة واحدة ناعمة
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type            = 'sine';
    osc.frequency.value = 528; // تردد مريح
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc.start(now); osc.stop(now + 0.85);
  } catch (e) {}
}

/* صوت حفظ الجلسة */
function playSprintSaveSound() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    [440, 554, 659].forEach((f, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = f;
      gain.gain.setValueAtTime(0.12, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.35);
      osc.start(now + i * 0.1); osc.stop(now + i * 0.1 + 0.4);
    });
  } catch (e) {}
}

function sendNotification() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification('⏰ وقتي — انتهى الإنتيرفال!', {
      body: 'ماذا كنت تفعل في آخر 10 دقائق؟',
    });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

// ==========================================
// 8. الداش بورد والإحصائيات
// ==========================================

function calcStats(data) {
  const stats = { 'دراسة':0, 'استراحة':0, 'صلاة':0, 'أكل':0, 'تسخيت':0, 'أخرى':0 };
  data.forEach(e => {
    const k = stats.hasOwnProperty(e.activity) ? e.activity : 'أخرى';
    stats[k] += e.duration;
  });
  return stats;
}

function updateDashboard() {
  const data  = getDayData(state.viewDate);
  const today = todayKey();

  document.getElementById('dashDate').textContent =
    state.viewDate === today ? 'اليوم' : formatDate(state.viewDate);
  document.getElementById('nextDay').disabled = (state.viewDate >= today);

  const stats = calcStats(data);
  document.getElementById('stat-study').textContent   = `${stats['دراسة']} د`;
  document.getElementById('stat-break').textContent   = `${stats['استراحة']} د`;
  document.getElementById('stat-prayer').textContent  = `${stats['صلاة']} د`;
  document.getElementById('stat-food').textContent    = `${stats['أكل']} د`;
  document.getElementById('stat-waste').textContent   = `${stats['تسخيت']} د`;
  document.getElementById('stat-other').textContent   = `${stats['أخرى']} د`;

  drawPieChart(stats);
  drawBarChart(stats);
  renderTimeline(data);
  renderSprintDashboard(state.viewDate);
}

function drawPieChart(stats) {
  const canvas = document.getElementById('pieChart');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const total = Object.values(stats).reduce((a,b)=>a+b, 0);
  const surfaceColor = getComputedStyle(document.body).getPropertyValue('--surface').trim();
  const legend = document.getElementById('pieLegend');
  legend.innerHTML = '';

  if (total === 0) {
    ctx.fillStyle = '#666'; ctx.font = '13px Cairo';
    ctx.textAlign = 'center'; ctx.fillText('لا توجد بيانات', W/2, H/2);
    return;
  }

  const cx = W/2, cy = H/2, r = Math.min(W,H)/2 - 18;
  let startAngle = -Math.PI/2;

  Object.entries(stats).forEach(([name, val]) => {
    if (val === 0) return;
    const slice = (val/total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath();
    ctx.fillStyle   = COLORS[name] || COLORS['أخرى'];
    ctx.fill();
    ctx.strokeStyle = surfaceColor;
    ctx.lineWidth   = 3;
    ctx.stroke();
    startAngle += slice;

    const li = document.createElement('div');
    li.className = 'legend-item';
    li.innerHTML = `<div class="legend-dot" style="background:${COLORS[name]||COLORS['أخرى']}"></div>
                    <span>${name} ${Math.round(val/total*100)}%</span>`;
    legend.appendChild(li);
  });

  // دائرة داخلية (دونات)
  ctx.beginPath();
  ctx.arc(cx, cy, r*0.46, 0, 2*Math.PI);
  ctx.fillStyle = surfaceColor;
  ctx.fill();
}

function drawBarChart(stats) {
  const canvas = document.getElementById('barChart');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const entries = Object.entries(stats).filter(([,v])=>v>0);
  if (entries.length === 0) {
    ctx.fillStyle='#666'; ctx.font='13px Cairo';
    ctx.textAlign='center'; ctx.fillText('لا توجد بيانات', W/2, H/2);
    return;
  }

  const maxVal = Math.max(...entries.map(([,v])=>v));
  const pad    = 20, chartH = H - 50;
  const colW   = (W - pad*2) / entries.length;
  const barW   = Math.min(36, colW*0.6);

  entries.forEach(([name, val], i) => {
    const barH = (val/maxVal) * chartH;
    const x    = pad + i*colW + (colW-barW)/2;
    const y    = chartH - barH + 10;
    const col  = COLORS[name] || COLORS['أخرى'];

    const grad = ctx.createLinearGradient(x, y+barH, x, y);
    grad.addColorStop(0, col+'88'); grad.addColorStop(1, col);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(x, y, barW, barH, 5); ctx.fill();

    ctx.fillStyle = col; ctx.font = 'bold 10px Cairo';
    ctx.textAlign = 'center'; ctx.fillText(`${val}د`, x+barW/2, y-4);

    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text3').trim()||'#555';
    ctx.font = '9px Cairo'; ctx.textAlign = 'center';
    ctx.fillText(name.slice(0,4), x+barW/2, H-4);
  });
}

function renderTimeline(data) {
  const container = document.getElementById('timeline');
  container.innerHTML = '';
  if (data.length === 0) {
    container.innerHTML = '<p class="empty-msg">لا توجد بيانات لهذا اليوم</p>';
    return;
  }
  const reversed = [...data].reverse();
  reversed.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'tl-item';
    div.style.setProperty('--c', entry.color || COLORS[entry.activity] || COLORS['أخرى']);
    div.innerHTML = `
      <span class="tl-time">${entry.start} ← ${entry.end}</span>
      <span class="tl-act">${entry.activity}</span>
      <span class="tl-dur">${entry.duration} د</span>`;
    container.appendChild(div);
  });
}

// ==========================================
// 9. آخر الأنشطة والهدف
// ==========================================

function renderRecent() {
  const list = document.getElementById('recentList');
  const data = state.currentSession.slice(-5).reverse();
  if (data.length === 0) {
    list.innerHTML = '<p class="empty-msg">لا توجد أنشطة بعد — اضغط <kbd>Space</kbd> للبدء</p>';
    return;
  }
  list.innerHTML = '';
  data.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.style.setProperty('--c', entry.color || COLORS[entry.activity] || COLORS['أخرى']);
    div.innerHTML = `
      <span class="act-name">${entry.activity}</span>
      <span class="act-time">${entry.start} - ${entry.end}</span>
      <span class="act-dur">${entry.duration} د</span>`;
    list.appendChild(div);
  });
}

function updateGoalBar() {
  const studyMin = state.currentSession
    .filter(e => e.activity === 'دراسة')
    .reduce((s,e) => s+e.duration, 0);
  const pct = Math.min(100, (studyMin/state.goalMinutes)*100);
  document.getElementById('goalProgress').style.width = pct+'%';
  document.getElementById('goalText').textContent = `${studyMin} / ${state.goalMinutes} دقيقة`;
}

function updateGoalDisplay() {
  const h = Math.floor(state.goalMinutes/60);
  const m = state.goalMinutes%60;
  let txt = '';
  if (h>0) txt += `${h} ساعة`;
  if (m>0) txt += ` ${m} دقيقة`;
  document.getElementById('goalDisplay').textContent = txt.trim();
}

/* ---- ضبط مدة الإنتيرفال ---- */
function updateDurDisplay() {
  const el = document.getElementById('durNum');
  if (el) el.textContent = state.intervalMinutes;
  // حدّث عرض التايمر أيضاً إذا لم يكن شغّالاً
  if (!state.running) {
    updateTimerDisplay();
  }
}

function changeDuration(delta) {
  if (state.running) return; // لا تغيير أثناء الشغل
  const newVal = state.intervalMinutes + delta;
  if (newVal < 1 || newVal > 180) return;
  state.intervalMinutes = newVal;
  state.totalSeconds    = newVal * 60;
  state.remaining       = state.totalSeconds;
  updateDurDisplay();
  updateRing();
  saveSettings();
}

// ==========================================
// 9-B. التايم لاين القابل للطي
// ==========================================

let timelineCollapsed = false;

function setupTimelineToggle() {
  const btn = document.getElementById('timelineToggleBtn');
  const hdr = document.getElementById('timelineToggle');
  if (!btn) return;

  const doToggle = () => {
    timelineCollapsed = !timelineCollapsed;
    const tl   = document.getElementById('timeline');
    const icon = document.getElementById('timelineToggleIcon');
    const lbl  = document.getElementById('timelineToggleLabel');
    tl.classList.toggle('collapsed', timelineCollapsed);
    icon.textContent = timelineCollapsed ? '▼' : '▲';
    lbl.textContent  = timelineCollapsed ? 'توسيع' : 'طي';
  };

  btn.addEventListener('click', e => { e.stopPropagation(); doToggle(); });
  hdr.addEventListener('click', doToggle);
}

// ==========================================
// 10. الستريك والسجل
// ==========================================

function updateStreak() {
  const dates = getAllDates().filter(d => getDayData(d).length > 0);
  let streak  = 0;
  let cursor  = new Date(); cursor.setHours(0,0,0,0);
  for (let i=0; i<365; i++) {
    if (dates.includes(localDateKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate()-1);
    } else break;
  }
  document.getElementById('streakCount').textContent = streak;
}

function renderHistory() {
  const list  = document.getElementById('historyList');
  const today = todayKey();
  const dates = getAllDates().filter(d => getDayData(d).length>0 && d!==today);
  if (dates.length === 0) {
    list.innerHTML = '<p class="empty-msg">لا يوجد سجل بعد</p>';
    return;
  }
  list.innerHTML = '';
  dates.forEach(dateKey => {
    const data     = getDayData(dateKey);
    const stats    = calcStats(data);
    const totalMin = Object.values(stats).reduce((a,b)=>a+b, 0);
    const card     = document.createElement('div');
    card.className = 'hist-card';
    card.innerHTML = `
      <div>
        <div class="hist-date">${formatDate(dateKey)}</div>
        <div class="hist-summary">📚 ${stats['دراسة']}د • المجموع: ${totalMin}د • ${data.length} إنتيرفال</div>
      </div>
      <span class="hist-arrow">◀</span>`;
    card.addEventListener('click', () => {
      state.viewDate = dateKey;
      switchTab('dashboard');
    });
    list.appendChild(card);
  });
}

function formatDate(dateKey) {
  const [y,m,d] = dateKey.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('ar-IQ',{
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  });
}

// ==========================================
// 11. الإكسبورت
// ==========================================

function exportCSV() {
  const dates = getAllDates().filter(d => getDayData(d).length>0);
  let csv = 'التاريخ,النشاط,البداية,النهاية,المدة (دقائق)\n';
  dates.forEach(dk => {
    getDayData(dk).forEach(e => {
      csv += `${dk},${e.activity},${e.start},${e.end},${e.duration}\n`;
    });
  });
  // إضافة السبرينت
  csv += '\nتايمر السبرينت\nالتاريخ,البداية,النهاية,المدة (ثواني)\n';
  dates.forEach(dk => {
    getSprintDayData(dk).forEach(e => {
      csv += `${dk},${e.start},${e.end},${e.duration}\n`;
    });
  });
  downloadFile('waqti_data.csv', csv, 'text/csv;charset=utf-8;');
}

function exportJSON() {
  const dates = getAllDates().filter(d => getDayData(d).length>0);
  const all   = {};
  dates.forEach(dk => {
    all[dk] = { activities: getDayData(dk), sprint: getSprintDayData(dk) };
  });
  downloadFile('waqti_data.json', JSON.stringify(all, null, 2), 'application/json');
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob(['\uFEFF'+content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href:url, download:filename });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ==========================================
// 12. الثيم والتنقل
// ==========================================

function applyTheme() {
  document.body.classList.toggle('light', !state.darkMode);
  document.body.classList.toggle('dark',   state.darkMode);
  document.getElementById('themeToggle').innerHTML =
    (state.darkMode ? '🌙' : '☀️') + ' <kbd>T</kbd>';
}

function toggleTheme() {
  state.darkMode = !state.darkMode;
  applyTheme(); saveSettings();
  if (document.getElementById('page-dashboard').classList.contains('active')) updateDashboard();
}

function switchTab(tabName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${tabName}`).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${tabName}"]`)?.classList.add('active');
  if (tabName === 'dashboard') { state.viewDate = todayKey(); updateDashboard(); }
  else if (tabName === 'history') renderHistory();
}

// ==========================================
// 13. البوب آبات
// ==========================================

function showQuickAdd() {
  state.activePopup = 'quick';
  document.getElementById('overlay').classList.add('active');
  document.getElementById('quickPopup').classList.add('active');
  document.getElementById('quickCustomWrap').classList.remove('visible');
  document.getElementById('quickCustomActivity').value = '';
}

function hideQuickAdd() {
  state.activePopup = null;
  document.getElementById('overlay').classList.remove('active');
  document.getElementById('quickPopup').classList.remove('active');
}

function showExportPopup() {
  state.activePopup = 'export';
  document.getElementById('overlay').classList.add('active');
  document.getElementById('exportPopup').classList.add('active');
}

function hideExportPopup() {
  state.activePopup = null;
  document.getElementById('overlay').classList.remove('active');
  document.getElementById('exportPopup').classList.remove('active');
}

function showShortcuts() {
  state.activePopup = 'shortcuts';
  document.getElementById('shortcutsOverlay').classList.add('active');
  document.getElementById('shortcutsPanel').classList.add('active');
}

function hideShortcuts() {
  state.activePopup = null;
  document.getElementById('shortcutsOverlay').classList.remove('active');
  document.getElementById('shortcutsPanel').classList.remove('active');
}

// ==========================================
// 14. ⚡ تايمر السبرينت — المنطق الكامل
// ==========================================

function sprintToggle() {
  sprint.running ? sprintPause() : sprintStart();
}

function sprintStart() {
  if (sprint.running) return;
  sprint.running   = true;
  sprint.beatCount = 0;
  document.getElementById('sprintWidget').classList.add('sw-running');
  document.getElementById('swStart').innerHTML = '⏸ إيقاف <kbd>S</kbd>';
  document.getElementById('swStatusLabel').textContent = 'يعمل';

  sprint.tickId = setInterval(() => {
    sprint.elapsed++;
    sprint.beatCount++;

    // دقة كل ثانية (تيك-توك)
    playSprintTick(sprint.beatCount % 2 === 0);

    // نغمة كل دقيقة كاملة
    if (sprint.elapsed % 60 === 0) playSprintMinuteBell();

    updateSprintDisplay();
  }, 1000);
}

function sprintPause() {
  if (!sprint.running) return;
  sprint.running = false;
  clearInterval(sprint.tickId); sprint.tickId = null;
  document.getElementById('sprintWidget').classList.remove('sw-running');
  document.getElementById('swStart').innerHTML = '▶ ابدأ <kbd>S</kbd>';
  document.getElementById('swStatusLabel').textContent = 'متوقف';
}

function sprintReset() {
  sprintPause();
  sprint.elapsed = 0;
  updateSprintDisplay();
  document.getElementById('swStatusLabel').textContent = 'جاهز';
}

/**
 * حفظ الجلسة الحالية وإعادة تعيين العداد
 */
function sprintSave() {
  if (sprint.elapsed < 5) return; // تجاهل الجلسات القصيرة جداً

  sprintPause();

  const now       = new Date();
  const endTime   = fmtTime12(now);
  const startD    = new Date(now.getTime() - sprint.elapsed*1000);
  const startTime = fmtTime12(startD);

  const session = {
    start:    startTime,
    end:      endTime,
    duration: sprint.elapsed,
    date:     todayKey(),
  };

  sprint.sessions.push(session);
  saveSprintData();
  playSprintSaveSound();

  // عرض آخر جلسة
  document.getElementById('swLastSession').style.display = 'flex';
  document.getElementById('swLastVal').textContent = secsToDisplay(sprint.elapsed);

  sprint.elapsed = 0;
  updateSprintDisplay();
  updateSprintStats();
  document.getElementById('swStatusLabel').textContent = 'تم الحفظ ✓';
  setTimeout(() => {
    document.getElementById('swStatusLabel').textContent = 'جاهز';
  }, 2000);
}

/** تحديث عرض الوقت الحالي للسبرينت */
function updateSprintDisplay() {
  const s   = sprint.elapsed;
  const m   = Math.floor(s/60);
  const sec = s%60;
  const str = fmt2(m)+':'+fmt2(sec);

  document.getElementById('swTime').textContent     = str;
  document.getElementById('swMiniTime').textContent = str;

  // حلقة SVG تدور كل 60 ثانية
  const circumference = 364.4; // 2π×58
  const progress      = (sec/60);
  const offset        = circumference - progress*circumference;
  document.getElementById('swRingArc').setAttribute('stroke-dashoffset', offset);

  // تحديث بارات الدقائق
  updateMinuteBars();
}

/** بارات الدقائق المنجزة — تُظهر كم دقيقة انتهت */
function updateMinuteBars() {
  const container   = document.getElementById('swMinuteBars');
  const totalMins   = Math.floor(sprint.elapsed/60);
  const secInMin    = sprint.elapsed%60;
  const BARS_SHOWN  = 12; // نعرض آخر 12 دقيقة

  container.innerHTML = '';

  for (let i=0; i<BARS_SHOWN; i++) {
    const bar = document.createElement('div');
    bar.className = 'sw-min-bar';

    const minIndex = Math.max(0, totalMins - BARS_SHOWN + 1) + i;

    if (minIndex < totalMins) {
      // دقيقة مكتملة — ارتفاع 100%
      bar.classList.add('filled');
      bar.style.height = '28px';
    } else if (minIndex === totalMins && sprint.running) {
      // الدقيقة الحالية — ارتفاع نسبي
      bar.classList.add('current');
      const h = Math.max(4, Math.round((secInMin/60)*28));
      bar.style.height = h+'px';
    } else {
      // فارغ
      bar.style.height = '4px';
    }

    container.appendChild(bar);
  }
}

/** تحديث الإحصائيات في الويدجيت */
function updateSprintStats() {
  const todaySessions = sprint.sessions.filter(s => s.date === todayKey());
  const totalSec      = todaySessions.reduce((sum,s) => sum+s.duration, 0);
  const bestSec       = todaySessions.reduce((mx,s)  => Math.max(mx,s.duration), 0);
  const avgSec        = todaySessions.length ? Math.round(totalSec/todaySessions.length) : 0;

  document.getElementById('swStatTotal').textContent = secsToDisplay(totalSec);
  document.getElementById('swStatCount').textContent = todaySessions.length;
  document.getElementById('swStatBest').textContent  = secsToDisplay(bestSec);
  document.getElementById('swStatAvg').textContent   = secsToDisplay(avgSec);

  // بروجريس بار الهدف
  const goalSec = sprint.goalMin * 60;
  const pct     = Math.min(100, (totalSec/goalSec)*100);
  document.getElementById('swGoalFill').style.width = pct+'%';
  document.getElementById('swGoalText').textContent =
    `${secsToDisplay(totalSec)} / ${sprint.goalMin} دقيقة`;

  // آخر جلسة
  if (todaySessions.length > 0) {
    const last = todaySessions[todaySessions.length-1];
    document.getElementById('swLastSession').style.display = 'flex';
    document.getElementById('swLastVal').textContent =
      `${last.start}–${last.end} (${secsToDisplay(last.duration)})`;
  }
}

/** تحويل الثواني إلى نص عرض */
function secsToDisplay(secs) {
  const m = Math.floor(secs/60);
  const s = secs%60;
  if (m >= 60) {
    const h = Math.floor(m/60);
    return `${h}:${fmt2(m%60)} س`;
  }
  return `${m}:${fmt2(s)}`;
}

// ==========================================
// 15. إحصائيات السبرينت في الداش بورد
// ==========================================

function renderSprintDashboard(dateKey) {
  const sessions  = getSprintDayData(dateKey);
  const section   = document.getElementById('sprintDashSection');

  if (sessions.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  const totalSec  = sessions.reduce((s,x) => s+x.duration, 0);
  const bestSec   = sessions.reduce((mx,x) => Math.max(mx,x.duration), 0);
  const avgSec    = Math.round(totalSec/sessions.length);

  document.getElementById('sd-total').textContent = secsToDisplay(totalSec);
  document.getElementById('sd-count').textContent = sessions.length;
  document.getElementById('sd-best').textContent  = secsToDisplay(bestSec);
  document.getElementById('sd-avg').textContent   = secsToDisplay(avgSec);

  drawSprintBarChart(sessions);
  renderSprintTimeline(sessions);
}

function drawSprintBarChart(sessions) {
  const canvas = document.getElementById('sprintBarChart');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (sessions.length === 0) return;

  const maxSec = Math.max(...sessions.map(s => s.duration));
  const pad    = 15, chartH = H - 40;
  const colW   = (W - pad*2) / sessions.length;
  const barW   = Math.min(32, colW*0.6);

  sessions.forEach((sess, i) => {
    const barH = (sess.duration/maxSec)*chartH;
    const x    = pad + i*colW + (colW-barW)/2;
    const y    = chartH - barH + 10;

    const grad = ctx.createLinearGradient(x, y+barH, x, y);
    grad.addColorStop(0, '#22d3ee55');
    grad.addColorStop(1, '#4ade80');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(x, y, barW, barH, 5); ctx.fill();

    ctx.fillStyle = '#4ade80'; ctx.font = 'bold 9px Cairo';
    ctx.textAlign = 'center';
    ctx.fillText(secsToDisplay(sess.duration), x+barW/2, y-4);

    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text3').trim()||'#555';
    ctx.font = '8px Cairo'; ctx.textAlign = 'center';
    ctx.fillText(`#${i+1}`, x+barW/2, H-5);
  });
}

function renderSprintTimeline(sessions) {
  const container = document.getElementById('sprintTimeline');
  container.innerHTML = '';
  sessions.forEach((sess, i) => {
    const div = document.createElement('div');
    div.className = 'tl-item';
    div.style.setProperty('--c', '#4ade80');
    div.innerHTML = `
      <span class="tl-time">${sess.start} ← ${sess.end}</span>
      <span class="tl-act">جلسة #${i+1}</span>
      <span class="tl-dur">${secsToDisplay(sess.duration)}</span>`;
    container.appendChild(div);
  });
}

// ==========================================
// 16. الويدجيت القابل للسحب
// ==========================================

function setupSprintDrag() {
  const widget = document.getElementById('sprintWidget');
  const handle = document.getElementById('swHeader');
  let dragging = false, ox = 0, oy = 0;

  const onDown = (cx, cy) => {
    dragging = true;
    const rect = widget.getBoundingClientRect();
    ox = cx - rect.left; oy = cy - rect.top;
    widget.style.transition = 'none';
  };
  const onMove = (cx, cy) => {
    if (!dragging) return;
    let x = Math.max(0, Math.min(window.innerWidth  - widget.offsetWidth,  cx - ox));
    let y = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, cy - oy));
    widget.style.left = x+'px'; widget.style.top = y+'px';
    widget.style.bottom = 'auto'; widget.style.right = 'auto';
  };
  const onUp = () => { dragging = false; widget.style.transition = ''; };

  handle.addEventListener('mousedown',  e => onDown(e.clientX, e.clientY));
  document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  document.addEventListener('mouseup',   onUp);

  handle.addEventListener('touchstart',  e => { onDown(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive:false });
  document.addEventListener('touchmove',  e => { if(dragging){onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault();} }, { passive:false });
  document.addEventListener('touchend',   onUp);
}

function sprintMinimize() {
  sprint.minimized = true;
  document.getElementById('sprintWidget').classList.add('minimized');
}

function sprintExpand() {
  sprint.minimized = false;
  document.getElementById('sprintWidget').classList.remove('minimized');
}

// ==========================================
// 17. نظام الكيبورد الكامل
// ==========================================

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    const tag     = document.activeElement.tagName.toLowerCase();
    const isInput = tag==='input' || tag==='textarea';

    /* ========= Escape — يعمل دائماً ========= */
    if (e.key === 'Escape') {
      if (state.activePopup === 'quick')     { hideQuickAdd();     return; }
      if (state.activePopup === 'export')    { hideExportPopup();  return; }
      if (state.activePopup === 'shortcuts') { hideShortcuts();    return; }
      return;
    }

    if (isInput) return; // لا اختصارات داخل الإن بوت

    /* ========= بوب آب النشاط مفتوح ========= */
    if (state.activePopup === 'activity' || state.activePopup === 'quick') {
      if (e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        const activity = ACTIVITY_KEYS[parseInt(e.key)-1];
        const isQuick  = state.activePopup === 'quick';
        if (activity === 'أخرى') {
          const wrapId  = isQuick ? 'quickCustomWrap'  : 'customInputWrap';
          const inputId = isQuick ? 'quickCustomActivity' : 'customActivity';
          document.getElementById(wrapId).classList.add('visible');
          document.getElementById(inputId).focus();
        } else {
          if (isQuick) {
            const dur = parseInt(document.getElementById('quickDuration').value)||10;
            hideQuickAdd(); selectActivity(activity, dur);
          } else {
            hideActivityPopup(); selectActivity(activity);
          }
        }
        return;
      }
    }

    /* ========= بوب آب الإكسبورت مفتوح ========= */
    if (state.activePopup === 'export') {
      if (e.key==='c'||e.key==='C') { exportCSV(); return; }
      if (e.key==='j'||e.key==='J') { exportJSON(); return; }
      return;
    }

    /* ========= لا بوب آب مفتوح ========= */

    // Space — يبدأ التايمر فقط، لا يوقفه
    if (e.code==='Space'||e.key===' ') {
      e.preventDefault();
      if (!state.running) startTimer();
      return;
    }

    // Alt+رقم — التنقل
    if (e.altKey) {
      if (e.key==='1') { e.preventDefault(); switchTab('timer');     return; }
      if (e.key==='2') { e.preventDefault(); switchTab('dashboard'); return; }
      if (e.key==='3') { e.preventDefault(); switchTab('plan');      return; }
      if (e.key==='4') { e.preventDefault(); switchTab('history');   return; }
      if (e.key==='5') { e.preventDefault(); switchTab('compare');   return; }
    }

    // أسهم — التنقل بين أيام الداش بورد
    if (document.getElementById('page-dashboard').classList.contains('active')) {
      if (e.key==='ArrowLeft')  { e.preventDefault(); state.viewDate=shiftDate(state.viewDate,-1); updateDashboard(); return; }
      if (e.key==='ArrowRight') {
        e.preventDefault();
        const next=shiftDate(state.viewDate,+1);
        if (next<=todayKey()) { state.viewDate=next; updateDashboard(); }
        return;
      }
    }

    // ======== اختصارات صفحة الخطة ========
    if (document.getElementById('page-plan').classList.contains('active')) {
      // أسهم: التنقل بين أيام الخطة
      if (e.key==='ArrowLeft')  { e.preventDefault(); planState.viewDate=shiftDate(planState.viewDate,-1); renderPlanPage(); return; }
      if (e.key==='ArrowRight') { e.preventDefault(); planState.viewDate=shiftDate(planState.viewDate,+1); renderPlanPage(); return; }

      // N — إضافة مادة جديدة
      if ((e.key==='n'||e.key==='N') && !state.activePopup) { e.preventDefault(); openPlanPopup(); return; }

      // . أو Delete — رجوع لليوم الحالي
      if (e.key==='.'||e.key==='Delete') { e.preventDefault(); planState.viewDate=todayKey(); renderPlanPage(); return; }

      // أرقام 1-9: تفعيل/إلغاء الموضوع رقم N في اليوم الحالي (كل المواضيع مرتبة)
      if (e.key>='1' && e.key<='9' && !state.activePopup) {
        e.preventDefault();
        const idx   = parseInt(e.key) - 1;
        const data  = getPlanData(planState.viewDate);
        // اجمع كل المواضيع مرتبة
        let allTopics = [];
        data.forEach(s => s.topics.forEach(t => allTopics.push({ subjectId:s.id, topicId:t.id })));
        if (allTopics[idx]) {
          toggleTopic(allTopics[idx].subjectId, allTopics[idx].topicId);
        }
        return;
      }
    }
    // =========================================

    // R — ريست (فقط قبل البدء)
    if (e.key==='r'||e.key==='R') { if (!state.running) resetTimer(); return; }

    // Q — إضافة سريعة
    if (e.key==='q'||e.key==='Q') { showQuickAdd(); return; }

    // S — تايمر السبرينت ابدأ/إيقاف
    if (e.key==='s'||e.key==='S') { e.preventDefault(); sprintToggle(); return; }

    // X — حفظ جلسة السبرينت
    if (e.key==='x'||e.key==='X') { e.preventDefault(); sprintSave(); return; }

    // Z — ريست السبرينت
    if (e.key==='z'||e.key==='Z') { e.preventDefault(); sprintReset(); return; }

    // M — تصغير/توسيع ويدجيت السبرينت
    if (e.key==='m'||e.key==='M') {
      e.preventDefault();
      sprint.minimized ? sprintExpand() : sprintMinimize();
      return;
    }

    // T — تبديل الثيم
    if (e.key==='t'||e.key==='T') { toggleTheme(); return; }

    // E — الإكسبورت
    if (e.key==='e'||e.key==='E') { showExportPopup(); return; }

    // H — لوحة الاختصارات
    if (e.key==='h'||e.key==='H') {
      state.activePopup==='shortcuts' ? hideShortcuts() : showShortcuts();
      return;
    }

    // + / - — تغيير الهدف
    if (!e.ctrlKey && (e.key==='+'||e.key==='=')) {
      state.goalMinutes=Math.min(720,state.goalMinutes+30);
      updateGoalDisplay(); updateGoalBar(); saveSettings(); return;
    }
    if (!e.ctrlKey && (e.key==='-'||e.key==='_')) {
      state.goalMinutes=Math.max(30,state.goalMinutes-30);
      updateGoalDisplay(); updateGoalBar(); saveSettings(); return;
    }

    // Ctrl++ / Ctrl+- — تغيير مدة الإنتيرفال (قبل البدء فقط)
    if (e.ctrlKey && (e.key==='+'||e.key==='='))  { e.preventDefault(); changeDuration(+1); return; }
    if (e.ctrlKey && (e.key==='-'||e.key==='_'))   { e.preventDefault(); changeDuration(-1); return; }
    if (e.ctrlKey && e.key==='ArrowUp')             { e.preventDefault(); changeDuration(+5); return; }
    if (e.ctrlKey && e.key==='ArrowDown')           { e.preventDefault(); changeDuration(-5); return; }

    // C/J مباشرة (بدون بوب آب)
    if (!state.activePopup) {
      if (e.key==='c'||e.key==='C') { exportCSV(); return; }
      if (e.key==='j'||e.key==='J') { exportJSON(); return; }
    }
  });
}

// ==========================================
// 18. ربط أحداث الواجهة
// ==========================================

function setupEventListeners() {

  /* ---- ريست اليوم ---- */
  document.getElementById('resetTodayBtn').addEventListener('click', () => {
    if (!confirm('هل تريد حذف جميع إحصائيات اليوم؟ لا يمكن التراجع.')) return;
    state.currentSession = [];
    state._loadedForDay  = todayKey();
    localStorage.removeItem(`waqti_${todayKey()}`);
    renderRecent();
    updateGoalBar();
    updateStreak();
    if (window._fbSync) window._fbSync();
  });
  document.getElementById('resetBtn').addEventListener('click', resetTimer);
  document.getElementById('quickAddBtn').addEventListener('click', showQuickAdd);
  document.getElementById('durMinus').addEventListener('click', () => changeDuration(-1));
  document.getElementById('durPlus').addEventListener('click',  () => changeDuration(+1));

  /* ---- التابس ---- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* ---- التوب بار ---- */
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('exportBtn').addEventListener('click', showExportPopup);
  document.getElementById('helpBtn').addEventListener('click', showShortcuts);

  /* ---- داش بورد أيام ---- */
  document.getElementById('prevDay').addEventListener('click', () => {
    state.viewDate = shiftDate(state.viewDate, -1); updateDashboard();
  });
  document.getElementById('nextDay').addEventListener('click', () => {
    const next = shiftDate(state.viewDate, +1);
    if (next <= todayKey()) { state.viewDate = next; updateDashboard(); }
  });

  /* ---- الهدف ---- */
  document.getElementById('goalPlus').addEventListener('click', () => {
    state.goalMinutes=Math.min(720,state.goalMinutes+30);
    updateGoalDisplay(); updateGoalBar(); saveSettings();
  });
  document.getElementById('goalMinus').addEventListener('click', () => {
    state.goalMinutes=Math.max(30,state.goalMinutes-30);
    updateGoalDisplay(); updateGoalBar(); saveSettings();
  });

  /* ---- بوب آب النشاط ---- */
  document.querySelectorAll('#popup .act-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.activity==='أخرى') {
        document.getElementById('customInputWrap').classList.add('visible');
        document.getElementById('customActivity').focus();
      } else {
        hideActivityPopup(); selectActivity(btn.dataset.activity);
      }
    });
  });
  document.getElementById('confirmCustom').addEventListener('click', () => {
    const val = document.getElementById('customActivity').value.trim();
    if (val) { hideActivityPopup(); selectActivity(val); }
  });
  document.getElementById('customActivity').addEventListener('keydown', e => {
    if (e.key==='Enter') document.getElementById('confirmCustom').click();
  });

  /* ---- الإضافة السريعة ---- */
  document.querySelectorAll('#quickPopup .act-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dur = parseInt(document.getElementById('quickDuration').value)||10;
      if (btn.dataset.activity==='أخرى') {
        document.getElementById('quickCustomWrap').classList.add('visible');
        document.getElementById('quickCustomActivity').focus();
      } else {
        hideQuickAdd(); selectActivity(btn.dataset.activity, dur);
      }
    });
  });
  document.getElementById('confirmQuickCustom').addEventListener('click', () => {
    const val = document.getElementById('quickCustomActivity').value.trim();
    const dur = parseInt(document.getElementById('quickDuration').value)||10;
    if (val) { hideQuickAdd(); selectActivity(val, dur); }
  });
  document.getElementById('quickCustomActivity').addEventListener('keydown', e => {
    if (e.key==='Enter') document.getElementById('confirmQuickCustom').click();
  });
  document.getElementById('closeQuickPopup').addEventListener('click', hideQuickAdd);

  /* ---- الإكسبورت ---- */
  document.getElementById('exportCSVBtn').addEventListener('click', exportCSV);
  document.getElementById('exportJSONBtn').addEventListener('click', exportJSON);
  document.getElementById('closeExport').addEventListener('click', hideExportPopup);

  /* ---- الاختصارات ---- */
  document.getElementById('closeShortcuts').addEventListener('click', hideShortcuts);
  document.getElementById('shortcutsOverlay').addEventListener('click', hideShortcuts);

  /* ---- الأوفرلاي — بوب آب النشاط إجباري لا يُغلق بالنقر ---- */
  document.getElementById('overlay').addEventListener('click', () => {
    if (state.activePopup==='quick')  { hideQuickAdd();    return; }
    if (state.activePopup==='export') { hideExportPopup(); return; }
    // state.activePopup === 'activity' → لا نغلقه، إجباري
  });

  /* ---- ألوان أزرار النشاط ---- */
  document.querySelectorAll('.act-btn').forEach(btn => {
    if (btn.dataset.color) btn.style.setProperty('--c', btn.dataset.color);
  });

  /* ---- تايمر السبرينت ---- */
  document.getElementById('swStart').addEventListener('click', sprintToggle);
  document.getElementById('swSave').addEventListener('click', sprintSave);
  document.getElementById('swReset').addEventListener('click', sprintReset);
  document.getElementById('swMinimize').addEventListener('click', sprintMinimize);
  document.getElementById('swExpand').addEventListener('click', sprintExpand);

  /* ---- إذن الإشعارات ---- */
  document.getElementById('startBtn').addEventListener('click', () => {
    if ('Notification' in window && Notification.permission==='default') {
      Notification.requestPermission();
    }
  }, { once:true });
}

// ==========================================
// 19. التهيئة النهائية
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadTodayData();
  loadSprintData();
  updateClock();
  setInterval(updateClock, 1000);
  renderRecent();
  updateGoalBar();
  updateStreak();
  setupEventListeners();
  setupKeyboard();
  setupSprintDrag();
  setupTimelineToggle();
  updateTimerDisplay();
  updateRing();
  updateDurDisplay();
  updateSprintDisplay();
  updateMinuteBars();

  if ('Notification' in window && Notification.permission==='default') {
    Notification.requestPermission();
  }
});


// ==========================================
// 💀 نظام ضربة الضمير — Guilt System
// ==========================================

const GUILT_MSGS = [
  'اليوتيوب والتيك توك ما راح يذاكرون عنك 🙂',
  'كل دقيقة تسخيت = دقيقة دراسة ضايعة من وقتك اللي ما يرجع ⏳',
  'الناجحين الحين جالسين يذاكرون، وأنت؟ 🤔',
  'الاستراحة كانت قبل شوي، هذا تسخيت مو استراحة 😮‍💨',
  'تخيّل نفسك بعد الامتحان — هل تتمنى إنك ذاكرت الحين؟ 📝',
  'عقلك يبي تسخيت لأنه يخاف من الصعوبة، لا تسمع له 💪',
  'مريت على هذا الموضوع عشر مرات وما ذاكرته… الحين وقته 📖',
  'ثلاث دقائق دراسة أفضل من صفر دقيقة 🎯',
];

const GUILT_MOTIVATE = [
  '💡 كل عالم كبير كان يوماً طالباً يجلس ويذاكر رغم صعوبة الموضوع — الفرق أنه ما استسلم.',
  '🔥 الإنجاز ما يجي من الراحة، يجي من اللحظات اللي قررت فيها إنك تكمل حتى لو صعب.',
  '⚡ دماغك يقدر — هو بس يبي إذن منك إنك تبدأ. ابدأ الحين.',
  '🏆 الفرق بين الناجح والفاشل مو الذكاء — هو قرار إنك تواصل وما توقف.',
  '🌙 في الليل لما تنام، هل تبي تقول "ذاكرت" ولا "ندمت"؟ القرار الحين.',
  '📚 كل صفحة تذاكرها هي صفحة أقل قلق قبل الامتحان — استثمر الحين.',
  '🎯 ما يكون الإنسان عظيماً بما يفعله لما يشتهي — بل بما يفعله لما لا يشتهي.',
  '💪 الانضباط هو اختيار إنك تختار ما تريده غداً على ما تشتهيه الحين.',
  '🚀 كل دقيقة دراسة الحين = ثقة إضافية يوم الامتحان. وقتك يُبنى الحين.',
  '✨ مو لازم تحب الدراسة — بس لازم تحترم مستقبلك. ذاكر.',
];

const guilt = {
  countdown:    10,
  tickId:       null,
  pendingDur:   10,     // المدة اللي كانت ستُسجَّل
};

function showGuiltPopup(durationMinutes) {
  guilt.pendingDur = durationMinutes;
  guilt.countdown  = 10;

  // رسالة عشوائية
  const msg      = GUILT_MSGS[Math.floor(Math.random() * GUILT_MSGS.length)];
  const motivate = GUILT_MOTIVATE[Math.floor(Math.random() * GUILT_MOTIVATE.length)];
  document.getElementById('guiltMsg').textContent          = msg;
  document.getElementById('guiltMotivateText').textContent = motivate;
  document.getElementById('guiltCountdown').textContent    = 10;
  document.getElementById('guiltArc').setAttribute('stroke-dashoffset', 0);

  // إعادة تشغيل أنيميشن الآيقونة
  const icon = document.getElementById('guiltIcon');
  icon.style.animation = 'none';
  requestAnimationFrame(() => { icon.style.animation = ''; });

  state.activePopup = 'guilt';
  document.getElementById('guiltPopup').classList.add('active');

  playGuiltSound();
  startGuiltCountdown();
}

function hideGuiltPopup() {
  clearInterval(guilt.tickId);
  guilt.tickId = null;
  document.getElementById('guiltPopup').classList.remove('active');
  state.activePopup = 'activity'; // ارجع للبوب آب الأصلي
}

function startGuiltCountdown() {
  clearInterval(guilt.tickId);
  const totalDash = 201.1; // 2π×32

  guilt.tickId = setInterval(() => {
    guilt.countdown--;
    document.getElementById('guiltCountdown').textContent = guilt.countdown;

    // تقليص الحلقة
    const offset = ((10 - guilt.countdown) / 10) * totalDash;
    document.getElementById('guiltArc').setAttribute('stroke-dashoffset', offset);

    // نبضة صوتية كل ثانية عندما يقترب
    if (guilt.countdown <= 3) playGuiltTick();

    if (guilt.countdown <= 0) {
      // انتهى الوقت — سجّل التسخيت تلقائياً
      clearInterval(guilt.tickId);
      guilt.tickId = null;
      confirmGuilt();
    }
  }, 1000);
}

/** سجّل التسخيت */
function confirmGuilt() {
  clearInterval(guilt.tickId);
  guilt.tickId = null;
  document.getElementById('guiltPopup').classList.remove('active');
  // سجّل التسخيت ثم أعد بوب آب النشاط للإنتيرفال التالي
  // ✅ تحقق من تغيير اليوم
  if (state._loadedForDay && state._loadedForDay !== todayKey()) {
    loadTodayData();
  }
  const now       = new Date();
  const endTime   = fmtTime12(now);
  const startD    = new Date(now.getTime() - guilt.pendingDur * 60000);
  const startTime = fmtTime12(startD);
  state.currentSession.push({
    activity:  'تسخيت',
    start:     startTime,
    end:       endTime,
    duration:  guilt.pendingDur,
    timestamp: now.getTime(),
    color:     COLORS['تسخيت'],
  });
  saveTodayData();
  renderRecent();
  updateGoalBar();
  // الآن أغلق بوب آب النشاط وانتقل للطابور
  popupOpen = false;
  state.activePopup = null;
  const overlay = document.getElementById('overlay');
  setTimeout(() => {
    if (popupQueue.length > 0) {
      drainPopupQueue();
    } else {
      overlay.classList.remove('active');
    }
  }, 200);
}

function playGuiltSound() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    [440, 330].forEach((f, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now + i * 0.18);
      osc.frequency.exponentialRampToValueAtTime(f * 0.7, now + i * 0.18 + 0.25);
      gain.gain.setValueAtTime(0.09, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.28);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.3);
    });
  } catch(e) {}
}

function playGuiltTick() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.start(now); osc.stop(now + 0.09);
  } catch(e) {}
}

/* ---- ربط أحداث بوب آب الضمير ---- */
function setupGuiltEvents() {
  document.getElementById('guiltConfirmBtn').addEventListener('click', confirmGuilt);
}

/* ---- الكيبورد داخل بوب آب الضمير ---- */
document.addEventListener('keydown', e => {
  if (state.activePopup !== 'guilt') return;
  if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); confirmGuilt(); }
});



// تهيئة الضمير
document.addEventListener('DOMContentLoaded', () => {
  setupGuiltEvents();
});

// ==========================================
// 📋 نظام الخطة اليومية — من الصفر
// ==========================================

// ---- بيانات الخطة ----
const planState = {
  viewDate: todayKey(),
  editId:   null,       // id المادة عند التعديل
  color:    '#6c63ff',
  days:     [],
  topics:   [],         // [{id, text}] قبل الحفظ
  step:     1,          // الخطوة الحالية في البوب آب (1-4)
};

const PLAN_COLOR_NAMES = {
  '#6c63ff':'بنفسجي','#4ade80':'أخضر','#60a5fa':'أزرق','#f59e0b':'ذهبي',
  '#f43f5e':'أحمر','#a78bfa':'ليلكي','#22d3ee':'سماوي','#f97316':'برتقالي',
};
const PLAN_DAY_NAMES  = ['أحد','إثن','ثلا','أرب','خمي','جمع','سبت'];
const PLAN_DAY_FULL   = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const PLAN_MONTHS     = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// ---- تخزين ----
function getPlan(dateKey)      { return JSON.parse(localStorage.getItem('waqti_plan_'+dateKey)||'[]'); }
function savePlan(dateKey, d)  { localStorage.setItem('waqti_plan_'+dateKey, JSON.stringify(d)); }
function getTemplates()        { return JSON.parse(localStorage.getItem('waqti_plan_tpl')||'[]'); }
function saveTemplates(t)      { localStorage.setItem('waqti_plan_tpl', JSON.stringify(t)); }
function planUID()             { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function dayOfWeekFromKey(dk) {
  const [y,m,d] = dk.split('-').map(Number);
  return new Date(y,m-1,d).getDay();
}

// دمج القوالب مع اليوم
function applyTemplates(dk) {
  const dow  = dayOfWeekFromKey(dk);
  const data = getPlan(dk);
  getTemplates()
    .filter(t => t.days.includes(dow) && !data.find(s => s.tplId===t.id))
    .forEach(t => data.push({
      id: planUID(), tplId: t.id, name: t.name, color: t.color,
      days: t.days, collapsed: false,
      topics: t.topics.map(x=>({id:planUID(), text:x.text, done:false}))
    }));
  savePlan(dk, data);
  return data;
}

// ---- حساب التقدم ----
function planProgress(data) {
  let total=0, done=0;
  data.forEach(s => s.topics.forEach(t => { total++; if(t.done) done++; }));
  return {total, done, pct: total ? Math.round(done/total*100) : 0};
}

// ==========================================
// رندر صفحة الخطة
// ==========================================

function renderPlanPage() {
  const data = applyTemplates(planState.viewDate);
  _renderPlanHeader();
  _renderWeekStrip();
  _renderPlanProgress(data);
  _renderSubjects(data);
}

function _renderPlanHeader() {
  const dk    = planState.viewDate;
  const today = todayKey();
  const [y,m,d] = dk.split('-').map(Number);
  const date  = new Date(y,m-1,d);
  let label   = dk===today ? 'اليوم'
              : dk===shiftDate(today,-1) ? 'أمس'
              : dk===shiftDate(today, 1) ? 'غداً'
              : PLAN_DAY_FULL[date.getDay()];
  document.getElementById('planDateLabel').textContent = label;
  document.getElementById('planDateSub').textContent   = `${d} ${PLAN_MONTHS[m-1]} ${y}`;
}

function _renderWeekStrip() {
  const strip = document.getElementById('planWeekStrip');
  strip.innerHTML = '';
  const today = todayKey();
  const [ty,tm,td] = today.split('-').map(Number);
  const sun   = new Date(ty,tm-1,td);
  sun.setDate(sun.getDate() - sun.getDay()); // بداية الأسبوع (أحد)

  for (let i=0; i<7; i++) {
    const d   = new Date(sun); d.setDate(sun.getDate()+i);
    const dk  = localDateKey(d);
    const dow = d.getDay();
    const hasPlan = getPlan(dk).length > 0
      || getTemplates().some(t => t.days.includes(dow));

    const btn = document.createElement('div');
    btn.className = 'plan-week-day';
    if (dk === today)               btn.classList.add('today');
    if (dk === planState.viewDate)  btn.classList.add('active');
    if (hasPlan)                    btn.classList.add('has-plan');
    btn.innerHTML = `<span class="plan-wd-name">${PLAN_DAY_NAMES[dow]}</span>
                     <span class="plan-wd-num">${d.getDate()}</span>`;
    btn.addEventListener('click', () => { planState.viewDate=dk; renderPlanPage(); });
    strip.appendChild(btn);
  }
}

function _renderPlanProgress(data) {
  const {total,done,pct} = planProgress(data);
  document.getElementById('planProgressPct').textContent   = pct+'%';
  document.getElementById('planProgressFill').style.width  = pct+'%';
  document.getElementById('planProgressCounts').textContent =
    total===0 ? 'لا توجد مواضيع — اضغط N لإضافة مادة'
             : `${done} من ${total} موضوع مكتمل`;
}

function _renderSubjects(data) {
  const container = document.getElementById('planSubjects');
  const empty     = document.getElementById('planEmpty');
  container.querySelectorAll('.plan-subject-card').forEach(e=>e.remove());

  if (data.length===0) { empty.style.display='block'; return; }
  empty.style.display = 'none';

  data.forEach(subj => {
    const {done,total,pct} = _subjProgress(subj);
    const card = document.createElement('div');
    card.className = 'plan-subject-card';
    card.dataset.id = subj.id;
    card.style.setProperty('--sc', subj.color);
    if (subj.collapsed) card.classList.add('collapsed');

    card.innerHTML = `
      <div class="plan-subject-header">
        <div class="plan-subject-dot" style="background:${subj.color}"></div>
        <span class="plan-subject-name">${subj.name}</span>
        <div class="plan-subject-mini-progress">
          <div class="plan-subject-mini-fill" style="width:${pct}%;background:${subj.color}"></div>
        </div>
        <span class="plan-subject-meta">${done}/${total}</span>
        <div class="plan-subject-actions">
          <button class="plan-subject-action-btn edit-btn" title="تعديل">✏️</button>
          <button class="plan-subject-action-btn del plan-del-btn" title="حذف">🗑</button>
        </div>
        <span class="plan-subject-chevron">▲</span>
      </div>
      <div class="plan-topics-body">
        ${subj.topics.map((t,i) => `
          <div class="plan-topic-item${t.done?' done':''}" data-tid="${t.id}">
            <div class="plan-topic-check" style="${t.done?`background:${subj.color};border-color:${subj.color};color:white`:''}">
              ${t.done?'✓':''}
            </div>
            <span class="plan-topic-num">${i+1}.</span>
            <span class="plan-topic-text">${_esc(t.text)}</span>
            <button class="plan-topic-del" data-tid="${t.id}">✕</button>
          </div>`).join('')}
        <div class="plan-inline-add">
          <input class="plan-inline-input" placeholder="أضف موضوعاً..." maxlength="80"/>
          <button class="plan-inline-add-btn">+</button>
        </div>
      </div>`;

    // طي/توسيع
    card.querySelector('.plan-subject-header').addEventListener('click', e => {
      if (e.target.closest('.plan-subject-actions')) return;
      subj.collapsed = !subj.collapsed;
      card.classList.toggle('collapsed', subj.collapsed);
      _updateSubj(subj);
    });

    // تعديل
    card.querySelector('.edit-btn').addEventListener('click', e => {
      e.stopPropagation(); openPlanPopup(subj);
    });

    // حذف
    card.querySelector('.plan-del-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`حذف "${subj.name}"؟`)) return;
      let data2 = getPlan(planState.viewDate).filter(s=>s.id!==subj.id);
      savePlan(planState.viewDate, data2);
      if (subj.tplId) saveTemplates(getTemplates().filter(t=>t.id!==subj.tplId));
      renderPlanPage();
    });

    // تفعيل موضوع
    card.querySelectorAll('.plan-topic-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.classList.contains('plan-topic-del')) return;
        _toggleTopic(subj.id, item.dataset.tid);
      });
    });

    // حذف موضوع
    card.querySelectorAll('.plan-topic-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _deleteTopic(subj.id, btn.dataset.tid);
      });
    });

    // إضافة موضوع سريع
    const inp = card.querySelector('.plan-inline-input');
    const addBtn = card.querySelector('.plan-inline-add-btn');
    const doAdd = () => {
      const txt = inp.value.trim(); if (!txt) return;
      _addTopic(subj.id, txt); inp.value=''; inp.focus();
    };
    addBtn.addEventListener('click', doAdd);
    inp.addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();doAdd();} });

    container.appendChild(card);
  });
}

function _subjProgress(subj) {
  const total = subj.topics.length;
  const done  = subj.topics.filter(t=>t.done).length;
  return {total, done, pct: total ? Math.round(done/total*100) : 0};
}

function _esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _updateSubj(subj) {
  const data = getPlan(planState.viewDate);
  const i    = data.findIndex(s=>s.id===subj.id);
  if (i>=0) { data[i]=subj; savePlan(planState.viewDate,data); }
}

function _toggleTopic(subjId, topicId) {
  const data = getPlan(planState.viewDate);
  const subj = data.find(s=>s.id===subjId);
  if (!subj) return;
  const t = subj.topics.find(x=>x.id===topicId);
  if (t) t.done = !t.done;
  savePlan(planState.viewDate, data);
  renderPlanPage();
}

function _deleteTopic(subjId, topicId) {
  const data = getPlan(planState.viewDate);
  const subj = data.find(s=>s.id===subjId);
  if (!subj) return;
  subj.topics = subj.topics.filter(t=>t.id!==topicId);
  savePlan(planState.viewDate, data);
  renderPlanPage();
}

function _addTopic(subjId, text) {
  const data = getPlan(planState.viewDate);
  const subj = data.find(s=>s.id===subjId);
  if (!subj) return;
  subj.topics.push({id:planUID(), text, done:false});
  savePlan(planState.viewDate, data);
  renderPlanPage();
}

// ==========================================
// بوب آب الخطة — نظام الخطوات الواضح
// ==========================================

function openPlanPopup(existing=null) {
  planState.editId  = existing ? existing.id : null;
  planState.color   = existing ? existing.color : '#6c63ff';
  planState.days    = existing ? [...existing.days] : [];
  planState.topics  = existing ? existing.topics.map(t=>({id:t.id,text:t.text})) : [];

  document.getElementById('planPopupTitle').textContent =
    existing ? `✏️ تعديل: ${existing.name}` : '📚 إضافة مادة';
  document.getElementById('planSubjectName').value = existing ? existing.name : '';
  document.getElementById('planTopicInput').value  = '';

  _setColor(planState.color);
  document.querySelectorAll('.plan-day-btn').forEach(btn =>
    btn.classList.toggle('active', planState.days.includes(parseInt(btn.dataset.day))));
  _renderPendingTopics();
  _gotoStep(1);
  _showPlanPopup();
}

function _showPlanPopup() {
  state.activePopup = 'plan';
  document.getElementById('overlay').classList.add('active');
  document.getElementById('planPopup').classList.add('active');
}

function _hidePlanPopup() {
  state.activePopup = null;
  document.getElementById('overlay').classList.remove('active');
  document.getElementById('planPopup').classList.remove('active');
}

function _gotoStep(n) {
  planState.step = n;
  // شريط الخطوات
  document.querySelectorAll('.plan-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.toggle('active', s===n);
    el.classList.toggle('done',   s<n);
  });
  // اللوحات
  document.querySelectorAll('.plan-step-panel').forEach(el => el.classList.remove('active'));
  const panel = document.getElementById('planStep'+n);
  if (panel) panel.classList.add('active');
  // أزرار
  document.getElementById('planPrevStep').style.display    = n>1    ? '' : 'none';
  document.getElementById('planNextStep').style.display    = n<4    ? '' : 'none';
  document.getElementById('planSaveSubject').style.display = n===4  ? '' : 'none';
  // فوكس
  setTimeout(() => {
    if (n===1) document.getElementById('planSubjectName').focus();
    if (n===4) document.getElementById('planTopicInput').focus();
  }, 60);
}

function _planNext() {
  if (planState.step===1) {
    const n = document.getElementById('planSubjectName').value.trim();
    if (!n) { document.getElementById('planSubjectName').focus(); return; }
  }
  if (planState.step<4) _gotoStep(planState.step+1);
}

function _planPrev() {
  if (planState.step>1) _gotoStep(planState.step-1);
}

function _setColor(color) {
  planState.color = color;
  document.querySelectorAll('.plan-color-choice').forEach(el =>
    el.classList.toggle('selected', el.dataset.color===color));
  const dot  = document.getElementById('planColorPreview');
  const name = document.getElementById('planColorName');
  if (dot)  dot.style.background = color;
  if (name) name.textContent = PLAN_COLOR_NAMES[color]||color;
}

function _toggleDay(day) {
  if (planState.days.includes(day)) planState.days = planState.days.filter(d=>d!==day);
  else planState.days.push(day);
  document.querySelectorAll('.plan-day-btn').forEach(btn =>
    btn.classList.toggle('active', planState.days.includes(parseInt(btn.dataset.day))));
}

function _addPendingTopic() {
  const inp  = document.getElementById('planTopicInput');
  const text = inp.value.trim();
  if (!text) return;
  planState.topics.push({id:planUID(), text});
  _renderPendingTopics();
  inp.value=''; inp.focus();
}

function _renderPendingTopics() {
  const list = document.getElementById('planTopicsList');
  list.innerHTML = '';
  planState.topics.forEach((t,i) => {
    const div = document.createElement('div');
    div.className = 'plan-topic-pill';
    div.innerHTML = `<span class="plan-topic-pill-num">${i+1}.</span>
      <span>${_esc(t.text)}</span>
      <button data-id="${t.id}">✕</button>`;
    div.querySelector('button').addEventListener('click', () => {
      planState.topics = planState.topics.filter(x=>x.id!==t.id);
      _renderPendingTopics();
    });
    list.appendChild(div);
  });
}

function savePlanSubject() {
  const name = document.getElementById('planSubjectName').value.trim();
  if (!name) { _gotoStep(1); return; }

  const data = getPlan(planState.viewDate);

  if (planState.editId) {
    // تعديل
    const idx = data.findIndex(s=>s.id===planState.editId);
    if (idx>=0) {
      const old = data[idx];
      // احتفظ بحالة done للمواضيع المشتركة
      const doneMap = {};
      old.topics.forEach(t => { doneMap[t.id]=t.done; });
      data[idx] = {
        ...old, name, color:planState.color, days:[...planState.days],
        topics: planState.topics.map(t=>({id:t.id,text:t.text,done:doneMap[t.id]||false}))
      };
      // حدّث القالب
      if (old.tplId) {
        const tpls = getTemplates();
        const ti   = tpls.findIndex(t=>t.id===old.tplId);
        if (ti>=0) {
          tpls[ti] = {...tpls[ti], name, color:planState.color, days:[...planState.days],
            topics:planState.topics.map(t=>({id:planUID(),text:t.text}))};
          saveTemplates(tpls);
        }
      }
    }
  } else {
    // جديد
    const tplId = planUID();
    data.push({
      id:planUID(), tplId, name, color:planState.color,
      days:[...planState.days], collapsed:false,
      topics:planState.topics.map(t=>({id:planUID(),text:t.text,done:false}))
    });
    if (planState.days.length>0) {
      const tpls = getTemplates();
      tpls.push({id:tplId, name, color:planState.color, days:[...planState.days],
        topics:planState.topics.map(t=>({id:planUID(),text:t.text}))});
      saveTemplates(tpls);
    }
  }

  savePlan(planState.viewDate, data);
  _hidePlanPopup();
  renderPlanPage();
}

// ==========================================
// أحداث صفحة الخطة
// ==========================================

function setupPlanEvents() {
  // التنقل
  document.getElementById('planPrevDay').addEventListener('click',  () => { planState.viewDate=shiftDate(planState.viewDate,-1); renderPlanPage(); });
  document.getElementById('planNextDay').addEventListener('click',  () => { planState.viewDate=shiftDate(planState.viewDate,+1); renderPlanPage(); });
  document.getElementById('planGoToday').addEventListener('click',  () => { planState.viewDate=todayKey(); renderPlanPage(); });
  document.getElementById('planOpenAdd').addEventListener('click',  () => openPlanPopup());

  // أزرار البوب آب
  document.getElementById('planNextStep').addEventListener('click',    _planNext);
  document.getElementById('planPrevStep').addEventListener('click',    _planPrev);
  document.getElementById('planSaveSubject').addEventListener('click', savePlanSubject);
  document.getElementById('closePlanPopup').addEventListener('click',  _hidePlanPopup);

  // ألوان
  document.querySelectorAll('.plan-color-choice').forEach(btn =>
    btn.addEventListener('click', () => _setColor(btn.dataset.color)));

  // أيام
  document.querySelectorAll('.plan-day-btn').forEach(btn =>
    btn.addEventListener('click', () => _toggleDay(parseInt(btn.dataset.day))));

  // إضافة موضوع
  document.getElementById('planAddTopicBtn').addEventListener('click', _addPendingTopic);

  // ---- كيبورد داخل البوب آب ----
  document.getElementById('planPopup').addEventListener('keydown', e => {
    if (state.activePopup !== 'plan') return;
    const activeId = document.activeElement.id;
    const inName   = activeId === 'planSubjectName';
    const inTopic  = activeId === 'planTopicInput';

    // Ctrl+Enter — حفظ من أي مكان
    if ((e.ctrlKey||e.metaKey) && e.key==='Enter') { e.preventDefault(); savePlanSubject(); return; }

    // Enter
    if (e.key==='Enter') {
      e.preventDefault();
      if (inTopic) { _addPendingTopic(); return; }
      _planNext();
      return;
    }

    // ArrowLeft (رجوع في الخطوات) — فقط خارج الإن بوت
    if (e.key==='ArrowLeft' && !inName && !inTopic) { e.preventDefault(); _planPrev(); return; }

    // Backspace في المواضيع الفارغ
    if (e.key==='Backspace' && inTopic) {
      const inp = document.getElementById('planTopicInput');
      if (inp.value==='' && planState.topics.length>0) {
        e.preventDefault(); planState.topics.pop(); _renderPendingTopics();
      }
      return;
    }

    // لا اختصارات داخل إن بوت
    if (inName || inTopic) return;

    // خطوة 2 — أرقام لاختيار اللون
    if (planState.step===2 && e.key>='1' && e.key<='8') {
      e.preventDefault();
      const btn = document.querySelector(`.plan-color-choice:nth-child(${e.key})`);
      if (btn) _setColor(btn.dataset.color);
      return;
    }

    // خطوة 3 — أرقام لاختيار الأيام، A للكل
    if (planState.step===3) {
      if (e.key>='1' && e.key<='7') { e.preventDefault(); _toggleDay(parseInt(e.key)-1); return; }
      if (e.key==='a'||e.key==='A') {
        e.preventDefault();
        planState.days = planState.days.length===7 ? [] : [0,1,2,3,4,5,6];
        document.querySelectorAll('.plan-day-btn').forEach(btn =>
          btn.classList.toggle('active', planState.days.includes(parseInt(btn.dataset.day))));
        return;
      }
    }
  });
}

// ==========================================
// دعم تاب الخطة في switchTab
// ==========================================
const _origSwitchTab = switchTab;
window.switchTab = function(tabName) {
  _origSwitchTab(tabName);
  if (tabName === 'plan') {
    planState.viewDate = todayKey();
    renderPlanPage();
  }
  // تاب المقارنة — لا يحتاج منطق إضافي، Firebase يتولى
};

// تهيئة الخطة
document.addEventListener('DOMContentLoaded', () => {
  setupPlanEvents();
});
// ==========================================
// مرايا التايمر الرئيسي في صفحة المقارنة
// ==========================================
(function() {
  const CIRC = 414.7;

  function syncMirror() {
    const display  = document.getElementById('cmpMirrorDisplay');
    const arc      = document.getElementById('cmpMirrorArc');
    const status   = document.getElementById('cmpMirrorStatus');
    const interval = document.getElementById('cmpMirrorInterval');
    if (!display) return;

    const m = Math.floor(state.remaining / 60);
    const s = state.remaining % 60;
    display.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

    const progress = 1 - state.remaining / state.totalSeconds;
    arc.style.strokeDashoffset = CIRC * (1 - progress);

    interval.textContent = state.intervalNum;

    if (state.running) {
      status.textContent = '🟢 يعمل';
      status.style.color = 'var(--green)';
    } else {
      status.textContent = '⏸ موقوف';
      status.style.color = 'var(--text3)';
    }
  }

  // شغّل المزامنة كل ثانية دائماً
  setInterval(syncMirror, 1000);

  // زامن فوراً عند تحميل الصفحة
  document.addEventListener('DOMContentLoaded', syncMirror);
})();
