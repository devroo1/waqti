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
    openGuiltFlow(durationMinutes);   // يختار: النظام الأصلي أو المخصص (انظر Custom Guilt System)
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

  handle.addEventListener('mousedown',  e => {
    if (e.target.closest('.sw-min-btn')) return;
    onDown(e.clientX, e.clientY);
  });
  document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  document.addEventListener('mouseup',   onUp);

  handle.addEventListener('touchstart',  e => {
    if (e.target.closest('.sw-min-btn')) return;
    onDown(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive:false });
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

    // نافذة الجدول اليومي مفتوحة → لا اختصارات عامة (إلا لو ظهر بوب آب التايمر الإجباري)
    if (window.DailySchedule && window.DailySchedule.isModalOpen() && !state.activePopup) return;

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
      if (e.key==='3') { e.preventDefault(); window.DailySchedule && window.DailySchedule.togglePanel(); return; }
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

  /* ---- بدء التايمر بالضغط الطبيعي على الزر ---- */
  document.getElementById('startBtn').addEventListener('click', () => {
    if ('Notification' in window && Notification.permission==='default') {
      Notification.requestPermission();
    }
    if (!state.running) startTimer();
  });
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
  cgCloseCustom();   // لو كان النظام المخصص مفتوحًا: أغلقه وأوقف صوته (لا شيء يحصل في النظام الأصلي)
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
// 🎭 Custom Guilt System — نظام ضربة الضمير المخصص
// ------------------------------------------
// • الإعدادات النصية  → localStorage  (المفتاح: waqti_customGuilt)
// • الصورة والصوت     → IndexedDB     (قاعدة: waqti_custom_guilt)
// • كل شيء محلي على جهازك فقط — لا يُرسل أي شيء إلى Firebase أو أي خادم
// • النظام الأصلي (showGuiltPopup) ما تغيّر
// ==========================================

const CG_LS_KEY     = 'waqti_customGuilt';
const CG_LAST_KEY   = 'waqti_customGuilt_last';   // آخر عناصر ظهرت (لمنع التكرار)
const CG_DB_NAME    = 'waqti_custom_guilt';
const CG_DB_VER     = 2;
const CG_DB_STORE   = 'items';                    // الإصدار 2: عدة ملفات (الإصدار 1 كان ملف صورة وملف صوت فقط)
const CG_DB_OLD     = 'files';
const CG_MAX_IMAGE  = 10 * 1024 * 1024;   // 10 ميجا للصورة الواحدة
const CG_MAX_AUDIO  = 25 * 1024 * 1024;   // 25 ميجا للصوت الواحد
const CG_MAX_TEXT   = 2000;
const CG_IMAGE_EXT  = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const CG_AUDIO_EXT  = ['mp3', 'wav', 'ogg'];
const CG_DEFAULTS   = { enabled: true, preferred: 'ask', volume: 100, muted: false, duration: 10 };

const cg = {
  cfg:         { ...CG_DEFAULTS, texts: [] },     // texts: [{id, text}]
  items:       { image: [], audio: [] },          // السجلات المحفوظة: {id, kind, blob, name, type, size, addedAt}
  last:        { image: null, audio: null, text: null },
  filesReady:  false,
  loadPromise: null,
  dbPromise:   null,
  storageErr:  null,
  inited:      false,
  stage:       null,      // null | 'choose' | 'custom' | 'preview' | 'settings'
  pendingDur:  10,
  // عرض النظام المخصص
  customTick:  null,
  customLeft:  0,
  customTotal: 0,
  customSrc:   null,
  customUrls:  [],
  // الإعدادات
  draft:       null,      // { enabled, preferred, volume, muted, duration, texts, images, audios }
  returnTo:    null,      // 'choose' | 'standalone'
  thumbUrls:   {},
  statusTimer: null,
  // الصوت
  audioEl:     null,
  audioUrl:    null,
  audioId:     null,
};

function cgEl(id) { return document.getElementById(id); }

/* ---------- الإعدادات (localStorage) ---------- */

function cgNewId() {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function cgSanitize(r) {
  const d = CG_DEFAULTS;
  r = (r && typeof r === 'object') ? r : {};
  const num = (v, min, max, def) => {
    v = Number(v);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
  };
  let texts = [];
  if (Array.isArray(r.texts)) {
    texts = r.texts
      .filter(t => t && typeof t.text === 'string' && t.text.trim())
      .map(t => ({ id: (typeof t.id === 'string' && t.id) ? t.id : cgNewId(), text: t.text.slice(0, CG_MAX_TEXT) }));
  } else if (typeof r.text === 'string' && r.text.trim()) {
    texts = [{ id: cgNewId(), text: r.text.slice(0, CG_MAX_TEXT) }];      // ترحيل النص الواحد القديم
  }
  return {
    enabled:   typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    preferred: ['ask', 'original', 'custom'].includes(r.preferred) ? r.preferred : d.preferred,
    volume:    num(r.volume, 0, 100, d.volume),
    muted:     typeof r.muted === 'boolean' ? r.muted : d.muted,
    duration:  [10, 20, 30, 60].includes(Number(r.duration)) ? Number(r.duration) : d.duration,
    texts,
  };
}

function cgLoadConfig() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(CG_LS_KEY) || 'null'); } catch (e) { raw = null; }
  const legacy = !!(raw && typeof raw === 'object' && !Array.isArray(raw.texts) && 'text' in raw);
  cg.cfg = cgSanitize(raw);
  if (legacy) {                       // نكتب الصيغة الجديدة مرة واحدة (والنص القديم محفوظ ضمن العبارات)
    try { cgWriteConfig(cg.cfg); } catch (e) { console.warn('CustomGuilt: تعذّر ترحيل الإعدادات', e); }
  }
  try {
    const l = JSON.parse(localStorage.getItem(CG_LAST_KEY) || 'null');
    if (l && typeof l === 'object') cg.last = { image: l.image || null, audio: l.audio || null, text: l.text || null };
  } catch (e) {}
}

/** يكتب الإعدادات في localStorage — يرمي خطأ لو فشل */
function cgWriteConfig(cfg) {
  localStorage.setItem(CG_LS_KEY, JSON.stringify(cfg));
}

function cgSetPreferred(mode) {
  const next = { ...cg.cfg, preferred: mode };
  try { cgWriteConfig(next); cg.cfg = next; } catch (e) { console.warn('CustomGuilt: تعذّر حفظ الاختيار', e); }
}

function cgSaveLast() {
  try { localStorage.setItem(CG_LAST_KEY, JSON.stringify(cg.last)); } catch (e) {}
}

/* ---------- الملفات (IndexedDB) ---------- */

function cgOpenDB() {
  if (cg.dbPromise) return cg.dbPromise;
  cg.dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('NO_IDB')); return; }
    let req;
    try { req = indexedDB.open(CG_DB_NAME, CG_DB_VER); } catch (e) { reject(e); return; }
    req.onupgradeneeded = ev => {
      const db = req.result, tx = req.transaction;
      const store = db.objectStoreNames.contains(CG_DB_STORE) ? tx.objectStore(CG_DB_STORE) : db.createObjectStore(CG_DB_STORE, { keyPath: 'id' });
      // ترحيل ملفات الإصدار 1 (صورة واحدة + صوت واحد) إلى الصيغة الجديدة — داخل نفس العملية، فلو فشل شيء ما يضيع شيء
      if (ev.oldVersion >= 1 && db.objectStoreNames.contains(CG_DB_OLD)) {
        const cur = tx.objectStore(CG_DB_OLD).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) {
            const v = c.value, k = c.key;
            if ((k === 'image' || k === 'audio') && v && v.blob instanceof Blob) {
              store.put({ id: 'mig_' + k, kind: k, blob: v.blob, name: v.name || k, type: v.type || '', size: v.size || v.blob.size, addedAt: v.savedAt || Date.now() });
            }
            c.continue();
          } else {
            db.deleteObjectStore(CG_DB_OLD);
          }
        };
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); cg.dbPromise = null; };
      resolve(db);
    };
    req.onerror   = () => reject(req.error || new Error('IDB_OPEN'));
    req.onblocked = () => console.warn('CustomGuilt: قاعدة البيانات مفتوحة في تبويب آخر، سيكتمل التحديث عند إغلاقه');
  });
  cg.dbPromise.catch(() => { cg.dbPromise = null; });
  return cg.dbPromise;
}

function cgValidRecord(r) {
  return (r && typeof r.id === 'string' && (r.kind === 'image' || r.kind === 'audio') && r.blob instanceof Blob && r.blob.size > 0) ? r : null;
}

async function cgIdbLoad() {
  const db = await cgOpenDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(CG_DB_STORE, 'readonly');
    const req = tx.objectStore(CG_DB_STORE).getAll();
    const out = { image: [], audio: [] };
    req.onsuccess = () => {
      (req.result || []).map(cgValidRecord).filter(Boolean).forEach(r => out[r.kind].push(r));
      out.image.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
      out.audio.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('IDB_READ'));
  });
}

/** changes = { put?: [records], del?: [ids] } — عملية واحدة: إما كلها تنجح أو ولا شيء */
async function cgIdbApply(changes) {
  const db = await cgOpenDB();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(CG_DB_STORE, 'readwrite'); } catch (e) { reject(e); return; }
    const st = tx.objectStore(CG_DB_STORE);
    try {
      (changes.del || []).forEach(id => st.delete(id));
      (changes.put || []).forEach(r => st.put(r));
    } catch (e) {
      try { tx.abort(); } catch (_) {}
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IDB_WRITE'));
    tx.onabort = () => reject(tx.error || new Error('IDB_ABORT'));
  });
}

function cgErrMsg(e, what) {
  const name = (e && e.name) || '';
  const msg  = (e && e.message) || '';
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
    return 'مساحة التخزين في المتصفح ممتلئة، فما قدرت ' + what + '. احذف ملفات ثانية أو اختر ملفات أصغر.';
  }
  if (msg === 'NO_IDB' || name === 'SecurityError' || name === 'InvalidStateError' || msg === 'IDB_BLOCKED') {
    return 'المتصفح ما يسمح بتخزين الملفات محليًا (ممكن بسبب التصفح الخاص أو منع التخزين). العبارات والإعدادات تنحفظ، لكن الصور والأصوات لا.';
  }
  return 'صار خطأ وما قدرت ' + what + '. جرّب مرة ثانية.';
}

/* ---------- أدوات صغيرة ---------- */

/** عدد العناصر في كل قسم (مصدر: الإعدادات المحفوظة أو المسودة) */
function cgCounts(src) {
  const i = src ? src.images : cg.items.image;
  const a = src ? src.audios : cg.items.audio;
  const t = src ? src.texts.filter(x => x.text.trim()) : cg.cfg.texts;
  return { i: i.length, a: a.length, t: t.length };
}

function cgHasContent(src) {
  const c = cgCounts(src);
  return (c.i + c.a + c.t) > 0;
}

function cgFmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function cgExt(name) { return ((name || '').split('.').pop() || '').toLowerCase(); }

function cgSummary() {
  const c = cgCounts();
  const parts = [];
  if (c.i) parts.push('🖼 ' + c.i);
  if (c.a) parts.push('🔊 ' + c.a);
  if (c.t) parts.push('✍️ ' + c.t);
  return parts.join(' · ');
}

/** اختيار عشوائي من قائمة، مع تجنب آخر عنصر ظهر (لو في أكثر من عنصر) */
function cgPick(list, lastId) {
  if (!list || !list.length) return null;
  if (list.length === 1) return list[0];
  const pool = list.filter(x => x.id !== lastId);
  const arr = pool.length ? pool : list;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** يتأكد إن الخلفية الداكنة ظاهرة (البوب آب الأصلي يخفيها بعد 380ms، فنعيدها بعده مباشرة) */
function cgEnsureOverlay() {
  const ov = cgEl('overlay');
  ov.classList.add('active');
  setTimeout(() => { if (cg.stage) ov.classList.add('active'); }, 380);
}

/* ---------- الصوت ---------- */

function cgStopAudio() {
  const a = cg.audioEl;
  if (a) {
    try { a.pause(); } catch (e) {}
    a.removeAttribute('src');
    try { a.load(); } catch (e) {}
  }
  if (cg.audioUrl) URL.revokeObjectURL(cg.audioUrl);
  cg.audioEl  = null;
  cg.audioUrl = null;
  cg.audioId  = null;
  cgSyncAudioButtons();
}

function cgPlayAudio(rec, volume, cb) {
  cgStopAudio();
  cb = cb || {};
  if (!rec || !rec.blob) return;
  const url = URL.createObjectURL(rec.blob);
  const a   = new Audio();
  a.preload = 'auto';
  a.volume  = Math.min(1, Math.max(0, volume / 100));
  a.addEventListener('ended', () => { if (cg.audioEl === a) { cgStopAudio(); if (cb.onEnd) cb.onEnd(); } });
  a.addEventListener('error', () => { if (cg.audioEl === a) { cgStopAudio(); if (cb.onError) cb.onError(); } });
  cg.audioEl  = a;
  cg.audioUrl = url;
  cg.audioId  = rec.id || null;
  a.src = url;
  const p = a.play();
  if (p && typeof p.catch === 'function') {
    p.catch(err => {
      if (cg.audioEl !== a) return;
      if (err && err.name === 'NotAllowedError') {
        if (cb.onBlocked) cb.onBlocked();
      } else if (err && err.name !== 'AbortError') {
        cgStopAudio();
        if (cb.onError) cb.onError();
      }
    });
  }
  cgSyncAudioButtons();
}

/** هل الصوت مسموح أن يشتغل؟ (مو مكتوم ومستواه فوق 0) */
function cgAudible(src) { return !!src.audio && !src.muted && src.volume > 0; }

/* ---------- تدفق ضربة الضمير ---------- */

/** نقطة الدخول: تُستدعى من selectActivity('تسخيت') بدل showGuiltPopup مباشرة */
function openGuiltFlow(durationMinutes) {
  guilt.pendingDur = durationMinutes;
  cg.pendingDur    = durationMinutes;

  // لو الملفات لسه تتحمّل من التخزين، انتظر لحظة
  if (!cg.filesReady && cg.loadPromise) {
    cg.loadPromise.then(() => openGuiltFlow(durationMinutes));
    return;
  }

  const c = cg.cfg;
  if (!c.enabled || c.preferred === 'original') { showGuiltPopup(durationMinutes); return; }
  if (c.preferred === 'custom' && cgHasContent()) { cgShowCustom(durationMinutes); return; }
  cgShowChooser();
}

/* ---- نافذة الاختيار ---- */

function cgShowChooser() {
  cg.stage = 'choose';
  state.activePopup = 'cgChoose';
  const has = cgHasContent();
  cgEl('cgPickCustomDesc').textContent = has ? cgSummary() : 'لسه ما جهّزته — اضغط لإعداده';
  cgEl('cgRemember').checked = false;
  cgEnsureOverlay();
  const pop = cgEl('cgChoosePopup');
  pop.classList.add('active');
  pop.focus({ preventScroll: true });
}

function cgPickOriginal() {
  if (cg.stage !== 'choose') return;
  if (cgEl('cgRemember').checked) cgSetPreferred('original');
  cgEl('cgChoosePopup').classList.remove('active');
  cg.stage = null;
  state.activePopup = 'guilt';
  showGuiltPopup(cg.pendingDur);      // النظام الأصلي كما هو
}

function cgPickCustom() {
  if (cg.stage !== 'choose') return;
  if (!cgHasContent()) { cgOpenSettings({ from: 'choose' }); return; }
  if (cgEl('cgRemember').checked) cgSetPreferred('custom');
  cgEl('cgChoosePopup').classList.remove('active');
  cgShowCustom(cg.pendingDur);
}

/* ---- عرض النظام المخصص ---- */

function cgRenderText(box, text) {
  box.replaceChildren();
  const t = text || '';
  if (!t.trim()) { box.hidden = true; return; }
  t.replace(/\r\n?/g, '\n').split('\n').forEach(line => {
    const p = document.createElement('p');
    p.dir = 'auto';                       // عربي → RTL ، إنجليزي → LTR
    if (line === '') p.className = 'cg-blank'; else p.textContent = line;
    box.appendChild(p);
  });
  box.hidden = false;
}

function cgCountUI() {
  const left  = Math.max(0, cg.customLeft);
  cgEl('cgCustomBar').style.width = (cg.customTotal ? (left / cg.customTotal) * 100 : 0) + '%';
  cgEl('cgCustomCount').textContent = 'يُسجَّل التسخيت تلقائيًا بعد ' + left + ' ث';
}

function cgPlayCustomAudio() {
  const src = cg.customSrc;
  if (!src || !cgAudible(src)) return;
  cgEl('cgReplayBtn').hidden = true;
  cgPlayAudio(src.audio, src.volume, {
    onBlocked: () => { cgEl('cgReplayBtn').hidden = false; },   // المتصفح منع التشغيل التلقائي
    onError:   () => { cgEl('cgReplayBtn').hidden = true; },
  });
}

function cgShowCustom(dur, opts) {
  const preview = !!(opts && opts.preview);
  const d = preview ? cg.draft : null;

  // اختيار عشوائي جديد في كل مرة — الصورة والصوت والعبارة مستقلة عن بعضها،
  // ولا يتكرر نفس العنصر مرتين متتاليتين إذا كان في أكثر من عنصر
  const pickImg = cgPick(preview ? d.images : cg.items.image, preview ? null : cg.last.image);
  const pickAud = cgPick(preview ? d.audios : cg.items.audio, preview ? null : cg.last.audio);
  const pickTxt = cgPick(preview ? d.texts.filter(t => t.text.trim()) : cg.cfg.texts, preview ? null : cg.last.text);
  if (!preview) {
    cg.last = { image: pickImg ? pickImg.id : null, audio: pickAud ? pickAud.id : null, text: pickTxt ? pickTxt.id : null };
    cgSaveLast();
  }
  const base = preview ? d : cg.cfg;
  const src = { text: pickTxt ? pickTxt.text : '', image: pickImg, audio: pickAud, volume: base.volume, muted: base.muted, duration: base.duration };

  cgCleanupCustom(true);
  cg.customSrc = src;
  cg.stage = preview ? 'preview' : 'custom';
  state.activePopup = preview ? 'cgPreview' : 'cgCustom';
  if (!preview) guilt.pendingDur = dur;

  // الصورة (فقط لو اخترتها)
  const img = cgEl('cgCustomImg');
  if (src.image) {
    const url = URL.createObjectURL(src.image.blob);
    cg.customUrls.push(url);
    img.onerror = () => { img.hidden = true; img.removeAttribute('src'); };
    img.src = url;
    img.hidden = false;
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }

  // النص (فقط لو كتبته)
  cgRenderText(cgEl('cgCustomText'), src.text);

  // الأزرار والعداد
  cgEl('cgPreviewBadge').hidden = !preview;
  cgEl('cgCountdownBox').hidden = preview;
  cgEl('cgReplayBtn').hidden = true;
  cgEl('cgCustomConfirmBtn').innerHTML = preview
    ? 'إغلاق المعاينة <kbd>Esc</kbd>'
    : 'سجّل التسخيت وكمّل <kbd>Enter</kbd>';

  cgEnsureOverlay();
  const pop = cgEl('cgCustomPopup');
  cgEl('cgCustomScroll').scrollTop = 0;
  pop.classList.add('active');
  pop.focus({ preventScroll: true });

  // الصوت (فقط لو اخترته وما هو مكتوم)
  cgPlayCustomAudio();

  // العداد التنازلي — نفس فكرة الأصلي: بعده يُسجَّل التسخيت تلقائيًا
  if (!preview) {
    cg.customTotal = src.duration;
    cg.customLeft  = src.duration;
    cgEl('cgCustomBar').style.transition = 'none';
    cgCountUI();
    void cgEl('cgCustomBar').offsetWidth;
    cgEl('cgCustomBar').style.transition = '';
    cg.customTick = setInterval(() => {
      cg.customLeft--;
      cgCountUI();
      if (cg.customLeft <= 0) {
        clearInterval(cg.customTick);
        cg.customTick = null;
        cgConfirmCustom();
      }
    }, 1000);
  }
}

/** ينظّف الصوت والعداد والروابط المؤقتة. keepDom=true يعني لا تمسح عناصر الصفحة الآن */
function cgCleanupCustom(keepDom) {
  clearInterval(cg.customTick);
  cg.customTick = null;
  cgStopAudio();
  const urls = cg.customUrls;                       // نؤخّر إلغاء الروابط قليلًا حتى لا نقطع تحميل صورة لسه بتظهر
  cg.customUrls = [];
  setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 700);
  cg.customSrc  = null;
  if (!keepDom) {
    // نمسح المحتوى بعد ما تختفي النافذة (عشان ما يقفز الشكل أثناء الإغلاق)
    setTimeout(() => {
      if (cg.stage === 'custom' || cg.stage === 'preview') return;
      const img = cgEl('cgCustomImg');
      img.hidden = true;
      img.removeAttribute('src');
      cgEl('cgCustomText').replaceChildren();
      cgEl('cgCustomText').hidden = true;
    }, 450);
  }
}

/** يغلق النظام المخصص — يُستدعى من confirmGuilt() قبل تسجيل التسخيت */
function cgCloseCustom() {
  if (cg.stage !== 'custom') return;
  cg.stage = null;
  cgEl('cgCustomPopup').classList.remove('active');
  cgCleanupCustom(false);
}

/** زر التأكيد / انتهاء العداد — يمر دائمًا عبر confirmGuilt الأصلية (تسجيل واحد فقط) */
function cgConfirmCustom() {
  if (cg.stage !== 'custom') return;     // حماية من التسجيل مرتين
  confirmGuilt();
}

function cgClosePreview() {
  if (cg.stage !== 'preview') return;
  cgEl('cgCustomPopup').classList.remove('active');
  cg.stage = 'settings';
  state.activePopup = 'cgSettings';
  cgCleanupCustom(false);
  const pop = cgEl('cgSettingsPopup');
  pop.classList.add('active');
  pop.focus({ preventScroll: true });
}

/* ---------- نافذة الإعدادات ---------- */

function cgMakeDraft() {
  return {
    enabled: cg.cfg.enabled, preferred: cg.cfg.preferred, volume: cg.cfg.volume, muted: cg.cfg.muted, duration: cg.cfg.duration,
    texts:  cg.cfg.texts.map(t => ({ ...t })),
    images: cg.items.image.slice(),
    audios: cg.items.audio.slice(),
  };
}

const cgIds = list => list.map(x => x.id).join('|');
const cgTextSig = list => list.filter(t => t.text.trim()).map(t => t.id + '\u0000' + t.text).join('\u0001');

function cgIsDirty() {
  if (!cg.draft || (cg.stage !== 'settings' && cg.stage !== 'preview')) return false;
  const d = cg.draft, c = cg.cfg;
  return d.enabled !== c.enabled || d.preferred !== c.preferred || d.volume !== c.volume ||
         d.muted !== c.muted || d.duration !== c.duration ||
         cgTextSig(d.texts) !== cgTextSig(c.texts) ||
         cgIds(d.images) !== cgIds(cg.items.image) || cgIds(d.audios) !== cgIds(cg.items.audio);
}

function cgSetStatus(msg, type) {
  const box = cgEl('cgStatus');
  clearTimeout(cg.statusTimer);
  if (!msg) { box.hidden = true; box.textContent = ''; return; }
  box.textContent = msg;
  box.className = 'cg-status ' + (type || 'info');
  box.hidden = false;
  cgEl('cgSettingsBody').scrollTop = 0;
  if (type !== 'error') cg.statusTimer = setTimeout(() => { box.hidden = true; }, 7000);
}

function cgShowConfirm(msg, actions) {
  cgEl('cgConfirmMsg').textContent = msg;
  const box = cgEl('cgConfirmBtns');
  box.replaceChildren();
  actions.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cg-btn' + (a.cls ? ' cg-btn-' + a.cls : '');
    b.textContent = a.label;
    b.addEventListener('click', () => { cgHideConfirm(); if (a.fn) a.fn(); });
    box.appendChild(b);
  });
  cgEl('cgConfirmBar').hidden = false;
  cgEl('cgSettingsBody').scrollTop = 0;
}

function cgHideConfirm() {
  cgEl('cgConfirmBar').hidden = true;
  cgEl('cgConfirmBtns').replaceChildren();
}

/** يحدّث شكل أزرار التجربة (▶ / ⏹) حسب الصوت الجاري */
function cgSyncAudioButtons() {
  document.querySelectorAll('#cgAudioList .cg-play').forEach(b => {
    const on = cg.audioId === b.dataset.id;
    b.textContent = on ? '⏹' : '▶';
    b.title = on ? 'إيقاف' : 'تجربة';
    b.setAttribute('aria-label', on ? 'إيقاف الصوت' : 'تجربة الصوت');
    b.classList.toggle('playing', on);
  });
}

/* ---- رسم القوائم (صور / أصوات / عبارات) ---- */

function cgRenderImages() {
  const d = cg.draft, box = cgEl('cgImageList');
  const keep = new Set(d.images.map(r => r.id));
  Object.keys(cg.thumbUrls).forEach(id => {
    if (!keep.has(id)) { URL.revokeObjectURL(cg.thumbUrls[id]); delete cg.thumbUrls[id]; }
  });
  box.replaceChildren();
  d.images.forEach(r => {
    if (!cg.thumbUrls[r.id]) cg.thumbUrls[r.id] = URL.createObjectURL(r.blob);
    const wrap = document.createElement('div');
    wrap.className = 'cg-thumb';
    const img = document.createElement('img');
    img.src = cg.thumbUrls[r.id];
    img.alt = r.name;
    img.title = r.name + ' (' + cgFmtSize(r.size) + ')';
    img.loading = 'lazy';
    img.decoding = 'async';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cg-thumb-del';
    del.dataset.act = 'del-image';
    del.dataset.id = r.id;
    del.title = 'حذف الصورة';
    del.setAttribute('aria-label', 'حذف الصورة ' + r.name);
    del.textContent = '✕';
    wrap.append(img, del);
    box.appendChild(wrap);
  });
  box.hidden = d.images.length === 0;
  cgEl('cgImageEmpty').hidden = d.images.length > 0;
}

function cgRenderAudios() {
  const d = cg.draft, box = cgEl('cgAudioList');
  box.replaceChildren();
  d.audios.forEach(r => {
    const row = document.createElement('div');
    row.className = 'cg-audio-item';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'cg-btn cg-play';
    play.dataset.act = 'play-audio';
    play.dataset.id = r.id;
    const meta = document.createElement('div');
    meta.className = 'cg-audio-meta';
    const nm = document.createElement('span');
    nm.textContent = r.name;
    const sz = document.createElement('small');
    sz.textContent = cgFmtSize(r.size);
    meta.append(nm, sz);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cg-btn cg-btn-danger';
    del.dataset.act = 'del-audio';
    del.dataset.id = r.id;
    del.title = 'حذف الصوت';
    del.setAttribute('aria-label', 'حذف الصوت ' + r.name);
    del.textContent = '🗑';
    row.append(play, meta, del);
    box.appendChild(row);
  });
  box.hidden = d.audios.length === 0;
  cgEl('cgAudioEmpty').hidden = d.audios.length > 0;
  cgSyncAudioButtons();
}

function cgRenderTexts() {
  const d = cg.draft, box = cgEl('cgTextList');
  box.replaceChildren();
  d.texts.forEach(t => {
    const row = document.createElement('div');
    row.className = 'cg-text-item';
    const ta = document.createElement('textarea');
    ta.dir = 'auto';
    ta.rows = 2;
    ta.maxLength = CG_MAX_TEXT;
    ta.placeholder = 'اكتب عبارة...';
    ta.setAttribute('aria-label', 'عبارة');
    ta.dataset.id = t.id;
    ta.value = t.text;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cg-btn cg-btn-danger';
    del.dataset.act = 'del-text';
    del.dataset.id = t.id;
    del.title = 'حذف العبارة';
    del.setAttribute('aria-label', 'حذف العبارة');
    del.textContent = '🗑';
    row.append(ta, del);
    box.appendChild(row);
  });
  box.hidden = d.texts.length === 0;
  cgEl('cgTextEmpty').hidden = d.texts.length > 0;
}

function cgRenderLists() {
  cgRenderImages();
  cgRenderAudios();
  cgRenderTexts();
}

/** يحدّث الحقول العامة والعدّادات وحالة التعديلات (بدون إعادة رسم القوائم) */
function cgRenderSettings() {
  const d = cg.draft;
  if (!d) return;
  cgEl('cgEnabled').checked   = d.enabled;
  cgEl('cgPreferred').value   = d.preferred;
  cgEl('cgDuration').value    = String(d.duration);
  cgEl('cgVolume').value      = d.volume;
  cgEl('cgVolumeOut').textContent = d.volume + '%';
  cgEl('cgMute').checked      = d.muted;

  const c = cgCounts(d);
  cgEl('cgImageCount').textContent = c.i;
  cgEl('cgAudioCount').textContent = c.a;
  cgEl('cgTextCount').textContent  = c.t;

  const dirty = cgIsDirty();
  cgEl('cgDirtyBadge').hidden = !dirty;
  cgEl('cgSaveBtn').disabled  = !dirty;
}

function cgOpenSettings(opts) {
  opts = opts || {};
  if (cg.stage === 'settings') return;

  // انتظر تحميل الملفات المحفوظة قبل ما نفتح
  if (!cg.filesReady && cg.loadPromise) { cg.loadPromise.then(() => cgOpenSettings(opts)); return; }

  const fromChoose = opts.from === 'choose';
  if (fromChoose) {
    if (cg.stage !== 'choose') return;
    cgEl('cgChoosePopup').classList.remove('active');
  } else {
    // فتح مستقل من زر الهيدر: فقط لو ما في بوب آب ثاني مفتوح
    if (cg.stage || state.activePopup || popupOpen) return;
    popupOpen = true;                 // يؤجّل بوب آب الإنتيرفال لحد ما نغلق الإعدادات (الطابور يبقى محفوظ)
  }

  cg.returnTo = fromChoose ? 'choose' : 'standalone';
  cg.stage = 'settings';
  state.activePopup = 'cgSettings';
  cg.draft = cgMakeDraft();
  cgHideConfirm();
  cgSetStatus('');
  cgRenderLists();
  cgRenderSettings();
  if (cg.storageErr) cgSetStatus(cgErrMsg(cg.storageErr, 'قراءة الملفات المحفوظة'), 'error');

  cgEnsureOverlay();
  const pop = cgEl('cgSettingsPopup');
  cgEl('cgSettingsBody').scrollTop = 0;
  pop.classList.add('active');
  pop.focus({ preventScroll: true });
}

function cgCloseSettings() {
  cgStopAudio();
  cgHideConfirm();
  cgEl('cgImageList').replaceChildren();
  const thumbs = Object.values(cg.thumbUrls);
  cg.thumbUrls = {};
  setTimeout(() => thumbs.forEach(u => URL.revokeObjectURL(u)), 700);
  cgEl('cgSettingsPopup').classList.remove('active');
  cg.draft = null;
  cg.stage = null;

  if (cg.returnTo === 'choose') {
    cgShowChooser();                  // نرجع لنافذة الاختيار (والوصف يتحدّث)
  } else {
    popupOpen = false;
    state.activePopup = null;
    setTimeout(() => {
      if (popupOpen || cg.stage) return;
      if (popupQueue.length > 0) drainPopupQueue();
      else cgEl('overlay').classList.remove('active');
    }, 380);
  }
}

function cgRequestClose() {
  if (cgIsDirty()) {
    cgShowConfirm('عندك تغييرات ما انحفظت. وش تبي تسوي؟', [
      { label: '💾 حفظ وإغلاق', cls: 'primary', fn: async () => { if (await cgSave()) cgCloseSettings(); } },
      { label: 'تجاهل وإغلاق', cls: 'danger', fn: cgCloseSettings },
      { label: 'رجوع للتعديل' },
    ]);
    return;
  }
  cgCloseSettings();
}

/* ---- اختيار الملفات ---- */

function cgCanDecodeImage(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const im  = new Image();
    const done = ok => { URL.revokeObjectURL(url); resolve(ok); };
    im.onload  = () => done(im.naturalWidth > 0 && im.naturalHeight > 0);
    im.onerror = () => done(false);
    im.src = url;
  });
}

function cgAudioMime(file) {
  if (file.type) return file.type;
  const e = cgExt(file.name);
  return e === 'mp3' ? 'audio/mpeg' : e === 'wav' ? 'audio/wav' : e === 'ogg' ? 'audio/ogg' : '';
}

function cgCanLoadAudio(file) {
  return new Promise(resolve => {
    const probe = new Audio();
    const mimes = [file.type, cgAudioMime(file), cgExt(file.name) === 'wav' ? 'audio/wav' : ''].filter(Boolean);
    if (probe.canPlayType && !mimes.some(m => probe.canPlayType(m))) { resolve(false); return; }   // المتصفح ما يدعم الصيغة
    const url = URL.createObjectURL(file);
    const a = new Audio();
    let finished = false;
    let timer = null;
    const done = ok => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      try { a.load(); } catch (e) {}
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    timer = setTimeout(() => done(true), 6000);   // بعض المتصفحات (مثل iOS) ما تحمّل البيانات مسبقًا: نقبل لأن الصيغة مدعومة
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => done(true));
    a.addEventListener('error', () => done(false));
    a.src = url;
  });
}

/** يرجع نص الخطأ لو الصورة مرفوضة، أو null لو سليمة */
async function cgCheckImage(file) {
  const okType = file.type ? /^image\/(png|jpe?g|webp|gif)$/.test(file.type) : CG_IMAGE_EXT.includes(cgExt(file.name));
  if (!okType) return 'صيغة غير مدعومة (استخدم PNG أو JPG أو WebP)';
  if (file.size === 0) return 'الملف فارغ';
  if (file.size > CG_MAX_IMAGE) return 'حجمه كبير (' + cgFmtSize(file.size) + ')، الحد 10 MB';
  if (!(await cgCanDecodeImage(file))) return 'تعذّرت قراءته، ممكن الملف تالف';
  return null;
}

async function cgCheckAudio(file) {
  const typeOK = /^audio\/(mpeg|mp3|wav|x-wav|wave|ogg)$/.test(file.type) || file.type === 'application/ogg';
  const extOK  = CG_AUDIO_EXT.includes(cgExt(file.name));
  if (!typeOK && !extOK) return 'صيغة غير مدعومة (استخدم MP3 أو WAV أو OGG)';
  if (file.size === 0) return 'الملف فارغ';
  if (file.size > CG_MAX_AUDIO) return 'حجمه كبير (' + cgFmtSize(file.size) + ')، الحد 25 MB';
  if (!(await cgCanLoadAudio(file))) return 'متصفحك ما يقدر يشغّله';
  return null;
}

/** إضافة عدة ملفات دفعة واحدة (kind = 'image' | 'audio') مع تقرير واضح بما أُضيف وما رُفض */
async function cgAddFiles(kind, files) {
  if (!cg.draft || !files.length) return;
  const isImg = kind === 'image';
  const added = [], rejected = [];
  for (const file of files) {
    if (!cg.draft) return;            // أُغلقت النافذة أثناء الفحص
    const list = isImg ? cg.draft.images : cg.draft.audios;
    if (list.some(r => r.name === file.name && r.size === file.size)) { rejected.push(file.name + ': مضاف من قبل'); continue; }
    const err = isImg ? await cgCheckImage(file) : await cgCheckAudio(file);
    if (!cg.draft) return;
    if (err) { rejected.push(file.name + ': ' + err); continue; }
    const rec = { id: cgNewId(), kind, blob: file, name: file.name, type: file.type || (isImg ? '' : cgAudioMime(file)), size: file.size, addedAt: Date.now() + added.length };
    (isImg ? cg.draft.images : cg.draft.audios).push(rec);
    added.push(rec);
  }
  if (isImg) cgRenderImages(); else cgRenderAudios();
  cgRenderSettings();
  const what = isImg ? 'صورة' : 'ملف صوت';
  let msg = '';
  if (added.length) msg += 'تمت إضافة ' + added.length + ' ' + what + '. اضغط «حفظ» عشان تنحفظ.';
  if (rejected.length) {
    const shown = rejected.slice(0, 4).join(' — ') + (rejected.length > 4 ? ' — و' + (rejected.length - 4) + ' غيرها' : '');
    msg += (msg ? ' ' : '') + 'لم تُضف ' + rejected.length + ': ' + shown;
  }
  cgSetStatus(msg, added.length ? 'info' : 'error');
}

function cgPreviewAudio(id) {
  const d = cg.draft;
  if (!d) return;
  if (cg.audioId === id) { cgStopAudio(); return; }          // الضغط مرة ثانية يوقف
  const rec = d.audios.find(r => r.id === id);
  if (!rec) return;
  if (d.muted)       { cgStopAudio(); cgSetStatus('الصوت مكتوم. ألغِ الكتم عشان تسمعه.', 'info'); return; }
  if (d.volume <= 0) { cgStopAudio(); cgSetStatus('مستوى الصوت 0%. ارفعه عشان تسمعه.', 'info'); return; }
  cgSetStatus('');
  cgPlayAudio(rec, d.volume, {
    onError:   () => cgSetStatus('ما قدرت أشغّل هذا الصوت.', 'error'),
    onBlocked: () => cgSetStatus('المتصفح منع التشغيل. اضغط مرة ثانية.', 'error'),
  });
}

/* ---- الحفظ والاستعادة ---- */

async function cgSave() {
  const d = cg.draft;
  if (!d) return false;
  const cfg = cgSanitize({ enabled: d.enabled, preferred: d.preferred, volume: d.volume, muted: d.muted, duration: d.duration, texts: d.texts });

  const draftAll = d.images.concat(d.audios);
  const savedAll = cg.items.image.concat(cg.items.audio);
  const draftIds = new Set(draftAll.map(r => r.id));
  const savedIds = new Set(savedAll.map(r => r.id));
  const put = draftAll.filter(r => !savedIds.has(r.id));
  const del = savedAll.filter(r => !draftIds.has(r.id));
  const hasChanges = put.length > 0 || del.length > 0;

  if (hasChanges) {
    if (put.length) { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
    try {
      await cgIdbApply({ put, del: del.map(r => r.id) });
    } catch (e) {
      console.warn('CustomGuilt: فشل حفظ الملفات', e);
      cgSetStatus(cgErrMsg(e, 'أحفظ الملفات'), 'error');
      return false;
    }
  }

  try {
    cgWriteConfig(cfg);
  } catch (e) {
    console.warn('CustomGuilt: فشل حفظ الإعدادات', e);
    if (hasChanges) {                                   // تراجع عن الملفات عشان ما يصير تعارض
      try { await cgIdbApply({ put: del, del: put.map(r => r.id) }); } catch (e2) { console.warn('CustomGuilt: فشل التراجع', e2); }
    }
    cgSetStatus(cgErrMsg(e, 'أحفظ الإعدادات'), 'error');
    return false;
  }

  cg.cfg   = cfg;
  cg.items = { image: d.images.slice(), audio: d.audios.slice() };
  d.texts  = cfg.texts.map(t => ({ ...t }));            // العبارات الفارغة تُحذف تلقائيًا
  cgRenderTexts();
  cgRenderSettings();
  cgSetStatus('تم الحفظ ✓', 'success');
  return true;
}

function cgAskReset() {
  cgShowConfirm('بتنحذف كل الصور والأصوات والعبارات وترجع الإعدادات للوضع الافتراضي. ما تقدر تتراجع. متأكد؟', [
    { label: 'نعم، احذف كل شيء', cls: 'danger', fn: cgDoReset },
    { label: 'تراجع' },
  ]);
}

async function cgDoReset() {
  cgStopAudio();
  const all = cg.items.image.concat(cg.items.audio);
  if (all.length) {
    try {
      await cgIdbApply({ del: all.map(r => r.id) });
    } catch (e) {
      console.warn('CustomGuilt: فشل الحذف', e);
      cgSetStatus(cgErrMsg(e, 'أحذف الملفات'), 'error');
      return;
    }
  }
  try { localStorage.removeItem(CG_LS_KEY); localStorage.removeItem(CG_LAST_KEY); } catch (e) { console.warn('CustomGuilt: فشل حذف الإعدادات', e); }
  cg.cfg   = { ...CG_DEFAULTS, texts: [] };
  cg.items = { image: [], audio: [] };
  cg.last  = { image: null, audio: null, text: null };
  cg.draft = cgMakeDraft();
  cgRenderLists();
  cgRenderSettings();
  cgSetStatus('تم حذف المحتوى المخصص ورجعت الإعدادات الافتراضية ✓', 'success');
}

function cgPreviewFull() {
  const d = cg.draft;
  if (!d) return;
  if (!cgHasContent(d)) { cgSetStatus('أضف صورة أو صوتًا أو عبارة أول عشان تشوف المعاينة.', 'info'); return; }
  cgStopAudio();
  cgHideConfirm();
  cgEl('cgSettingsPopup').classList.remove('active');
  cgShowCustom(0, { preview: true });
}

/* ---------- ربط الأحداث (مرة واحدة فقط) ---------- */

function cgBindEvents() {
  // اختيار النظام
  cgEl('cgPickOriginal').addEventListener('click', cgPickOriginal);
  cgEl('cgPickCustom').addEventListener('click', cgPickCustom);
  cgEl('cgOpenSettingsBtn').addEventListener('click', () => cgOpenSettings({ from: 'choose' }));

  // عرض النظام المخصص
  cgEl('cgCustomConfirmBtn').addEventListener('click', () => {
    if (cg.stage === 'preview') cgClosePreview(); else cgConfirmCustom();
  });
  cgEl('cgReplayBtn').addEventListener('click', cgPlayCustomAudio);

  // زر الهيدر
  cgEl('guiltSettingsBtn').addEventListener('click', () => cgOpenSettings({ from: 'header' }));

  // الإعدادات
  cgEl('cgCloseBtn').addEventListener('click', cgRequestClose);
  cgEl('cgCancelBtn').addEventListener('click', cgRequestClose);
  cgEl('cgSaveBtn').addEventListener('click', () => { cgSave(); });
  cgEl('cgPreviewBtn').addEventListener('click', cgPreviewFull);
  cgEl('cgResetBtn').addEventListener('click', cgAskReset);

  cgEl('cgEnabled').addEventListener('change', e => { cg.draft.enabled = e.target.checked; cgRenderSettings(); });
  cgEl('cgPreferred').addEventListener('change', e => { cg.draft.preferred = e.target.value; cgRenderSettings(); });
  cgEl('cgDuration').addEventListener('change', e => { cg.draft.duration = Number(e.target.value) || 10; cgRenderSettings(); });

  cgEl('cgVolume').addEventListener('input', e => {
    cg.draft.volume = Number(e.target.value);
    if (cg.audioEl) cg.audioEl.volume = cg.draft.volume / 100;     // تغيير حيّ أثناء التجربة
    cgRenderSettings();
  });
  cgEl('cgMute').addEventListener('change', e => {
    cg.draft.muted = e.target.checked;
    if (cg.draft.muted) cgStopAudio();
    cgRenderSettings();
  });

  // الصور (متعددة)
  cgEl('cgChooseImageBtn').addEventListener('click', () => cgEl('cgImageInput').click());
  cgEl('cgImageInput').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';                                           // يسمح باختيار نفس الملفات مرة ثانية
    cgAddFiles('image', files);
  });
  cgEl('cgImageList').addEventListener('click', e => {
    const b = e.target.closest('[data-act="del-image"]');
    if (!b || !cg.draft) return;
    cg.draft.images = cg.draft.images.filter(r => r.id !== b.dataset.id);
    cgRenderImages();
    cgRenderSettings();
  });

  // الأصوات (متعددة)
  cgEl('cgChooseAudioBtn').addEventListener('click', () => cgEl('cgAudioInput').click());
  cgEl('cgAudioInput').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    cgAddFiles('audio', files);
  });
  cgEl('cgAudioList').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !cg.draft) return;
    if (b.dataset.act === 'play-audio') { cgPreviewAudio(b.dataset.id); return; }
    if (b.dataset.act === 'del-audio') {
      if (cg.audioId === b.dataset.id) cgStopAudio();
      cg.draft.audios = cg.draft.audios.filter(r => r.id !== b.dataset.id);
      cgRenderAudios();
      cgRenderSettings();
    }
  });

  // العبارات (متعددة)
  cgEl('cgAddTextBtn').addEventListener('click', () => {
    if (!cg.draft) return;
    cg.draft.texts.push({ id: cgNewId(), text: '' });
    cgRenderTexts();
    cgRenderSettings();
    const tas = cgEl('cgTextList').querySelectorAll('textarea');
    if (tas.length) { tas[tas.length - 1].focus(); tas[tas.length - 1].scrollIntoView({ block: 'nearest' }); }
  });
  cgEl('cgTextList').addEventListener('input', e => {
    const ta = e.target.closest('textarea');
    if (!ta || !cg.draft) return;
    const t = cg.draft.texts.find(x => x.id === ta.dataset.id);
    if (t) { t.text = ta.value; cgRenderSettings(); }
  });
  cgEl('cgTextList').addEventListener('click', e => {
    const b = e.target.closest('[data-act="del-text"]');
    if (!b || !cg.draft) return;
    cg.draft.texts = cg.draft.texts.filter(x => x.id !== b.dataset.id);
    cgRenderTexts();
    cgRenderSettings();
  });

  // تنبيه لو حاول يغلق الصفحة وفي تعديلات غير محفوظة
  window.addEventListener('beforeunload', e => {
    if (cgIsDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ---- الكيبورد: يعمل فقط أثناء ظهور نوافذ النظام المخصص، ويمنع اختصارات الصفحة من التداخل ---- */
document.addEventListener('keydown', e => {
  if (!cg.stage) return;
  switch (cg.stage) {
    case 'choose':
      if (e.key === '1') { e.preventDefault(); cgPickOriginal(); }
      else if (e.key === '2') { e.preventDefault(); cgPickCustom(); }
      break;
    case 'custom':
      if (e.target && e.target.id === 'cgReplayBtn') break;       // خله يشتغل كزر عادي
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); cgConfirmCustom(); }
      break;
    case 'preview':
      if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); cgClosePreview(); }
      break;
    case 'settings':
      if (e.key === 'Escape') { e.preventDefault(); cgRequestClose(); }
      break;
  }
  e.stopImmediatePropagation();       // لا تدع اختصارات الصفحة (Q, T, 1-6 ...) تشتغل خلف النافذة
}, true);

function cgInit() {
  if (cg.inited) return;
  cg.inited = true;
  cgLoadConfig();
  cg.loadPromise = cgIdbLoad()
    .then(f => { cg.items = f; })
    .catch(e => {
      console.warn('CustomGuilt: تعذّر قراءة الملفات المحفوظة', e);
      cg.storageErr = e;
      cg.items = { image: [], audio: [] };
    })
    .then(() => { cg.filesReady = true; });
  cgBindEvents();
}

document.addEventListener('DOMContentLoaded', cgInit);


// ==========================================
// 📅 Daily Schedule — الجدول اليومي
// ------------------------------------------
// • المواد السبع ثابتة، والمهام تُجهَّز لكل يوم على حدة
// • العادات اليومية ثابتة وتتكرر تلقائيًا كل يوم
// • التخزين: localStorage فقط (لا علاقة له بـ Firebase أو التايمر)
//     waqti_ds_day_YYYY-MM-DD  → جدول يوم كامل (مهام + عادات + حالة الإنجاز)
//     waqti_ds_habits          → قائمة العادات الثابتة
//     waqti_ds_ui              → حالة الفتح/الإغلاق للوحة
//     waqti_ds_migrated        → علامة نقل بيانات نظام "الخطة" القديم
// • بيانات "الخطة" القديمة (waqti_plan_*) لا تُحذف من المتصفح أبدًا
// ==========================================
(function () {
  'use strict';

  const SUBJECTS = [
    { key: 'arabic',  name: 'عربي',     color: '#f59e0b' },
    { key: 'math',    name: 'رياضيات',  color: '#6c63ff' },
    { key: 'chem',    name: 'كيمياء',   color: '#4ade80' },
    { key: 'physics', name: 'فيزياء',   color: '#60a5fa' },
    { key: 'islamic', name: 'إسلامية',  color: '#22d3ee' },
    { key: 'english', name: 'إنكليزي',  color: '#f43f5e' },
    { key: 'bio',     name: 'أحياء',    color: '#a78bfa' },
  ];
  const DAYS   = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const K_DAY = 'waqti_ds_day_', K_HABITS = 'waqti_ds_habits', K_UI = 'waqti_ds_ui', K_MIG = 'waqti_ds_migrated';
  const WIDE = 1100;           // أوسع من هذا → لوحة جانبية ثابتة
  const MAX_AHEAD = 7;         // أقصى عدد أيام قادمة يمكن تجهيزها

  const $   = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const isWide = () => window.innerWidth >= WIDE;

  const S = {
    view: todayKey(), today: todayKey(),
    editing: null,          // {t:'task'|'habit', k, id}
    confirm: null,          // 'h:<id>'
    modal: null,            // 'prepare' | 'reminder' | 'history'
    draft: null, draftStart: '', stash: {}, escArm: false,
    pendingReminder: false, refocus: null,
  };
  let ui = { collapsed: null, closed: {} };

  /* ---------- تخزين ---------- */
  function jget(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function jset(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('⚠️ تعذّر الحفظ — التخزين المحلي ممتلئ أو غير متاح'); return false; }
  }
  const loadDay  = dk => jget(K_DAY + dk, null);
  const getHabits = () => { const h = jget(K_HABITS, []); return Array.isArray(h) ? h.filter(x => x && x.id && x.name) : []; };
  const saveHabits = h => jset(K_HABITS, h);
  const saveUI = () => jset(K_UI, ui);

  function normDay(r) {
    r = r && typeof r === 'object' ? r : {};
    const subjects = (Array.isArray(r.subjects) ? r.subjects : []).map(s => ({
      ...s, tasks: Array.isArray(s.tasks) ? s.tasks : [],
    }));
    return { prepared: !!r.prepared, subjects, habits: Array.isArray(r.habits) ? r.habits : null };
  }
  function saveDay(dk, rec) {
    const o = { v: 1, prepared: !!rec.prepared, subjects: rec.subjects, updatedAt: Date.now() };
    if (rec.habits) o.habits = rec.habits;
    return jset(K_DAY + dk, o);
  }

  /** يطابق عادات اليوم مع قائمة العادات الثابتة (لليوم الحالي فقط) */
  function syncHabits(dk) {
    const raw = loadDay(dk), rec = normDay(raw), defs = getHabits(), old = rec.habits || [];
    const next = defs.map(h => { const o = old.find(x => x.id === h.id); return { id: h.id, name: h.name, done: !!(o && o.done) }; });
    if (JSON.stringify(next) !== JSON.stringify(old) && (raw || next.length)) { rec.habits = next; saveDay(dk, rec); }
    rec.habits = next;
    return rec;
  }
  function modeOf(dk) { const t = todayKey(); return dk === t ? 'today' : dk < t ? 'past' : 'future'; }
  function getView(dk) {
    const m = modeOf(dk);
    if (m === 'today') { const r = syncHabits(dk); r.exists = true; return r; }
    const raw = loadDay(dk), r = normDay(raw);
    r.exists = !!raw;
    r.habits = m === 'future' ? getHabits().map(h => ({ id: h.id, name: h.name, done: false })) : (r.habits || []);
    return r;
  }
  function mutate(dk, fn) {
    if (modeOf(dk) === 'past') return;
    const rec = getView(dk);
    fn(rec);
    if (modeOf(dk) === 'future') rec.habits = null;   // عادات الأيام القادمة تُحسب عند حلول اليوم
    saveDay(dk, rec);
  }
  const isPrepared = rec => rec.prepared && rec.subjects.length > 0;

  function stats(rec) {
    let tt = 0, td = 0;
    rec.subjects.forEach(s => s.tasks.forEach(t => { tt++; if (t.done) td++; }));
    const ht = rec.habits.length, hd = rec.habits.filter(h => h.done).length, tot = tt + ht;
    return { tt, td, ht, hd, pct: tot ? Math.round((td + hd) / tot * 100) : 0 };
  }
  function subjStat(s) {
    const t = s.tasks.length, d = s.tasks.filter(x => x.done).length;
    return { t, d, pct: t ? Math.round(d / t * 100) : 0 };
  }

  /* ---------- تواريخ ---------- */
  function parts(dk) { const [y, m, d] = dk.split('-').map(Number); return { y, m, d, dow: new Date(y, m - 1, d).getDay() }; }
  function dateStr(dk) { const p = parts(dk); return `${DAYS[p.dow]} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`; }
  function relLabel(dk) {
    const t = todayKey();
    if (dk === t) return 'اليوم';
    if (dk === shiftDate(t, -1)) return 'أمس';
    if (dk === shiftDate(t, 1)) return 'غدًا';
    return DAYS[parts(dk).dow];
  }

  /* ---------- نقل بيانات نظام الخطة القديم ---------- */
  function normName(s) {
    return String(s || '').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase().replace(/^ال/, '');
  }
  const ALIASES = {
    arabic:  ['عربي', 'عربيه', 'لغه عربيه', 'اللغه العربيه', 'لغتي'],
    math:    ['رياضيات', 'رياضه'],
    chem:    ['كيمياء', 'كيميا', 'chemistry'],
    physics: ['فيزياء', 'فيزيا', 'physics'],
    islamic: ['اسلاميه', 'تربيه اسلاميه', 'دين', 'تربيه دينيه'],
    english: ['انكليزي', 'انجليزي', 'انكليزيه', 'انجليزيه', 'english', 'لغه انكليزيه', 'لغه انجليزيه'],
    bio:     ['احياء', 'احيا', 'بايولوجي', 'biology'],
  };
  const aliasMap = {};
  Object.keys(ALIASES).forEach(k => ALIASES[k].forEach(a => { aliasMap[normName(a)] = k; }));
  const matchSubject = name => { const k = aliasMap[normName(name)]; return k ? SUBJECTS.find(s => s.key === k) : null; };

  function migrateLegacy() {
    if (localStorage.getItem(K_MIG)) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('waqti_plan_') && /^\d{4}-\d{2}-\d{2}$/.test(k.slice(11))) keys.push(k);
      }
      keys.forEach(k => {
        try {
          const dk = k.slice(11), arr = JSON.parse(localStorage.getItem(k) || '[]');
          if (!Array.isArray(arr) || !arr.length || localStorage.getItem(K_DAY + dk)) return;
          const subjects = [];
          arr.forEach(s => {
            const tasks = (Array.isArray(s.topics) ? s.topics : [])
              .map(t => ({ id: t.id || uid(), text: String(t.text || '').trim(), count: null, done: !!t.done }))
              .filter(t => t.text);
            const fixed = matchSubject(s.name);
            if (fixed) {
              let ex = subjects.find(x => x.key === fixed.key);
              if (!ex) { ex = { key: fixed.key, name: fixed.name, color: fixed.color, tasks: [] }; subjects.push(ex); }
              ex.tasks.push(...tasks);
            } else {
              subjects.push({ key: 'legacy_' + (s.id || uid()), name: String(s.name || 'مادة'), color: s.color || '#6c63ff', legacy: true, tasks });
            }
          });
          if (subjects.length) jset(K_DAY + dk, { v: 1, prepared: true, subjects, updatedAt: Date.now() });
        } catch (e) { console.warn('Daily Schedule: تعذّر نقل', k, e); }
      });
      localStorage.setItem(K_MIG, '1');
    } catch (e) { console.warn('Daily Schedule: فشل نقل بيانات الخطة القديمة', e); }
  }

  /* ---------- رسالة سريعة ---------- */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'ds-toast'; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
  }

  /* =====================================================
     اللوحة الثابتة
     ===================================================== */
  function collapsedNow() { return ui.collapsed === null ? !isWide() : !!ui.collapsed; }

  function render() {
    const body = $('dsBody'), scroll = body.scrollTop;
    const rec = getView(S.view), mode = modeOf(S.view), st = stats(rec);
    const col = collapsedNow(), prepared = isPrepared(rec);
    document.body.classList.toggle('ds-collapsed', col);
    document.body.classList.toggle('ds-expanded', !col);
    $('dsPanel').classList.toggle('collapsed', col);
    const cb = $('dsCollapseBtn');
    cb.textContent = isWide() ? (col ? '⇤' : '⇥') : (col ? '▼' : '▲');
    cb.setAttribute('aria-expanded', String(!col));

    $('dsMiniRing').style.setProperty('--p', st.pct);
    $('dsMiniPct').textContent = st.pct + '%';
    $('dsHeadSub').textContent = relLabel(S.view) + ' · ' + dateStr(S.view);

    const editable = mode !== 'past';
    const canCheck = mode === 'today';
    let h = '';

    // تنقل بين الأيام
    const maxDk = shiftDate(todayKey(), MAX_AHEAD);
    h += `<div class="ds-nav">
      <button class="ds-icon-btn" data-a="prev" title="اليوم السابق">◀</button>
      <div class="ds-nav-label"><b>${esc(relLabel(S.view))}</b><span>${esc(dateStr(S.view))}</span></div>
      <button class="ds-icon-btn" data-a="next" title="اليوم التالي" ${S.view >= maxDk ? 'disabled' : ''}>▶</button>
    </div>
    <div class="ds-actions">
      ${mode !== 'today' ? '<button class="ds-btn ds-btn-sm" data-a="gotoday">اليوم</button>' : ''}
      ${editable && prepared ? '<button class="ds-btn ds-btn-sm" data-a="prepare">✏️ تعديل الجدول <kbd>P</kbd></button>' : ''}
      <button class="ds-btn ds-btn-sm" data-a="history">📜 السجل</button>
      <button class="ds-btn ds-btn-sm" data-a="bell" title="إظهار رسالة التذكير">🔔</button>
    </div>`;

    // شريط الحالة
    if (mode === 'past') {
      h += rec.exists
        ? '<div class="ds-banner ds-banner-info">📜 يوم سابق — للعرض فقط</div>'
        : '<div class="ds-banner ds-banner-info">لا توجد بيانات محفوظة لهذا اليوم</div>';
    } else if (!prepared) {
      h += `<div class="ds-banner ds-banner-warn">
        <div>${mode === 'today' ? 'لم تجهز جدول اليوم بعد، جهّز مهامك حتى تبدأ يومك.' : 'لم يُجهَّز جدول هذا اليوم بعد.'}</div>
        <button class="ds-btn ds-btn-primary ds-btn-sm" data-a="prepare">📝 ${mode === 'today' ? "Prepare Today's Schedule" : 'Prepare Schedule'}</button>
      </div>`;
    } else if (mode === 'future') {
      h += '<div class="ds-banner ds-banner-info">📅 يوم قادم — يمكنك تعديل جدوله، والإنجاز يبدأ في يومه</div>';
    }

    // الإنجاز الكلي
    if (mode !== 'past' || rec.exists) {
      h += `<div class="ds-overall">
        <div class="ds-ov-top"><span>إنجاز اليوم</span><b>${st.pct}%</b></div>
        <div class="ds-bar"><i style="width:${st.pct}%"></i></div>
        <div class="ds-ov-sub">مهام ${st.td}/${st.tt} • عادات ${st.hd}/${st.ht}</div>
      </div>`;
    }

    // المواد
    h += '<div class="ds-sec-title">📚 المواد الدراسية</div>';
    if (!rec.subjects.length) {
      h += `<div class="ds-empty">${mode === 'past' ? 'لا توجد مواد في هذا اليوم' : 'لم تختر مواد لهذا اليوم بعد'}</div>`;
    }
    rec.subjects.forEach(s => {
      const ss = subjStat(s), open = !ui.closed[s.key], complete = ss.t > 0 && ss.d === ss.t;
      h += `<div class="ds-subj${open ? '' : ' closed'}${complete ? ' complete' : ''}" style="--c:${esc(s.color)}">
        <div class="ds-subj-head" data-a="tsubj" data-k="${esc(s.key)}" role="button" tabindex="0">
          <span class="ds-dot"></span>
          <span class="ds-subj-name">${esc(s.name)}</span>
          <span class="ds-subj-meta">${complete ? '✔ مكتملة' : ss.d + '/' + ss.t}</span>
          <span class="ds-mini-bar"><i style="width:${ss.pct}%"></i></span>
          <span class="ds-chev">▾</span>
        </div>
        <div class="ds-subj-body">`;
      if (!s.tasks.length) h += '<div class="ds-empty ds-empty-sm">لا توجد مهام بعد</div>';
      s.tasks.forEach(t => {
        const ed = S.editing && S.editing.t === 'task' && S.editing.id === t.id;
        if (ed) {
          h += `<div class="ds-task editing" data-k="${esc(s.key)}" data-id="${esc(t.id)}">
            <input class="ds-in" data-edit="text" value="${esc(t.text)}" maxlength="80" placeholder="اسم المهمة">
            <input class="ds-in ds-in-n" data-edit="count" type="number" min="1" max="99" value="${t.count || ''}" placeholder="عدد">
            <button class="ds-icon-btn" data-a="saveedit" title="حفظ">✓</button>
            <button class="ds-icon-btn" data-a="canceledit" title="إلغاء">✕</button>
          </div>`;
        } else {
          h += `<div class="ds-task${t.done ? ' done' : ''}">
            <button class="ds-check" data-a="ttask" data-k="${esc(s.key)}" data-id="${esc(t.id)}" aria-pressed="${!!t.done}" ${canCheck ? '' : 'disabled'}>✓</button>
            <span class="ds-task-text">${esc(t.text)}</span>
            ${t.count ? `<span class="ds-count" title="عدد المحاضرات / الدروس">× ${t.count}</span>` : ''}
            ${editable ? `<span class="ds-row-btns">
              <button class="ds-icon-btn ds-sm" data-a="edittask" data-k="${esc(s.key)}" data-id="${esc(t.id)}" title="تعديل">✏️</button>
              <button class="ds-icon-btn ds-sm" data-a="deltask" data-k="${esc(s.key)}" data-id="${esc(t.id)}" title="حذف">🗑</button>
            </span>` : ''}
          </div>`;
        }
      });
      if (editable) {
        h += `<div class="ds-add"><input class="ds-in" data-add="${esc(s.key)}" placeholder="أضف مهمة…" maxlength="80">
          <button class="ds-icon-btn" data-a="addtask" data-k="${esc(s.key)}" title="إضافة">+</button></div>`;
      }
      h += '</div></div>';
    });

    // العادات
    const hOpen = !ui.closed.habits;
    h += `<div class="ds-subj ds-habits${hOpen ? '' : ' closed'}" style="--c:#4ade80">
      <div class="ds-subj-head" data-a="thabits" role="button" tabindex="0">
        <span class="ds-dot"></span><span class="ds-subj-name">🔁 Daily Habits</span>
        <span class="ds-subj-meta">${st.hd}/${st.ht}</span>
        <span class="ds-mini-bar"><i style="width:${st.ht ? Math.round(st.hd / st.ht * 100) : 0}%"></i></span>
        <span class="ds-chev">▾</span>
      </div>
      <div class="ds-subj-body">`;
    if (!rec.habits.length) {
      h += `<div class="ds-empty ds-empty-sm">${mode === 'today' ? 'أضف عاداتك الثابتة (مثل: الاستيقاظ، التمرين، القراءة، شرب الماء) وستظهر تلقائيًا كل يوم' : 'لا توجد عادات'}</div>`;
    }
    rec.habits.forEach(x => {
      const ed = S.editing && S.editing.t === 'habit' && S.editing.id === x.id && mode === 'today';
      if (ed) {
        h += `<div class="ds-task editing" data-id="${esc(x.id)}">
          <input class="ds-in" data-edit="hname" value="${esc(x.name)}" maxlength="40" placeholder="اسم العادة">
          <button class="ds-icon-btn" data-a="saveedit" title="حفظ">✓</button>
          <button class="ds-icon-btn" data-a="canceledit" title="إلغاء">✕</button>
        </div>`;
      } else {
        const conf = S.confirm === 'h:' + x.id;
        h += `<div class="ds-task${x.done ? ' done' : ''}">
          <button class="ds-check" data-a="thabit" data-id="${esc(x.id)}" aria-pressed="${!!x.done}" ${canCheck ? '' : 'disabled'}>✓</button>
          <span class="ds-task-text">${esc(x.name)}</span>
          ${mode === 'today' ? `<span class="ds-row-btns">
            <button class="ds-icon-btn ds-sm" data-a="edithabit" data-id="${esc(x.id)}" title="تعديل">✏️</button>
            <button class="ds-icon-btn ds-sm${conf ? ' ds-danger' : ''}" data-a="delhabit" data-id="${esc(x.id)}" title="حذف">${conf ? 'تأكيد؟' : '🗑'}</button>
          </span>` : ''}
        </div>`;
      }
    });
    if (mode === 'today') {
      h += `<div class="ds-add"><input class="ds-in" data-addhabit="1" placeholder="عادة جديدة…" maxlength="40">
        <button class="ds-icon-btn" data-a="addhabit" title="إضافة عادة">+</button></div>`;
    } else if (mode === 'future') {
      h += '<div class="ds-empty ds-empty-sm">العادات تتكرر تلقائيًا في كل يوم</div>';
    }
    h += '</div></div>';

    body.innerHTML = h;
    body.scrollTop = scroll;

    if (S.refocus) { const el = body.querySelector(S.refocus); S.refocus = null; if (el) { el.focus(); if (el.select && el.dataset.edit) el.select(); } }
  }

  function findSubj(rec, k) { return rec.subjects.find(s => s.key === k); }
  const clampCount = v => { const n = parseInt(v, 10); return n >= 1 ? Math.min(n, 99) : null; };

  function act(a, d) {
    const mode = modeOf(S.view);
    switch (a) {
      case 'prev': S.view = shiftDate(S.view, -1); S.editing = null; render(); break;
      case 'next': if (S.view < shiftDate(todayKey(), MAX_AHEAD)) { S.view = shiftDate(S.view, 1); S.editing = null; render(); } break;
      case 'gotoday': S.view = todayKey(); S.editing = null; render(); break;
      case 'tsubj': ui.closed[d.k] = !ui.closed[d.k]; saveUI(); render(); break;
      case 'thabits': ui.closed.habits = !ui.closed.habits; saveUI(); render(); break;
      case 'ttask':
        if (mode !== 'today') break;
        mutate(S.view, r => { const s = findSubj(r, d.k), t = s && s.tasks.find(x => x.id === d.id); if (t) t.done = !t.done; });
        render(); break;
      case 'thabit':
        if (mode !== 'today') break;
        mutate(S.view, r => { const x = r.habits.find(y => y.id === d.id); if (x) x.done = !x.done; });
        render(); break;
      case 'addtask': {
        if (mode === 'past') break;
        const inp = $('dsBody').querySelector(`[data-add="${d.k}"]`), text = inp ? inp.value.trim() : '';
        if (!text) { if (inp) inp.focus(); break; }
        mutate(S.view, r => { const s = findSubj(r, d.k); if (s) s.tasks.push({ id: uid(), text, count: null, done: false }); });
        S.refocus = `[data-add="${d.k}"]`; render(); break;
      }
      case 'edittask': S.editing = { t: 'task', k: d.k, id: d.id }; S.refocus = '[data-edit="text"]'; render(); break;
      case 'edithabit': S.editing = { t: 'habit', id: d.id }; S.refocus = '[data-edit="hname"]'; render(); break;
      case 'canceledit': S.editing = null; render(); break;
      case 'saveedit': saveEdit(); break;
      case 'deltask':
        mutate(S.view, r => { const s = findSubj(r, d.k); if (s) s.tasks = s.tasks.filter(x => x.id !== d.id); });
        render(); break;
      case 'addhabit': {
        if (mode !== 'today') break;
        const inp = $('dsBody').querySelector('[data-addhabit]'), name = inp ? inp.value.trim() : '';
        if (!name) { if (inp) inp.focus(); break; }
        const hs = getHabits(); hs.push({ id: uid(), name });
        if (!saveHabits(hs)) break;
        S.refocus = '[data-addhabit]'; render(); break;
      }
      case 'delhabit': {
        if (mode !== 'today') break;
        const key = 'h:' + d.id;
        if (S.confirm !== key) { S.confirm = key; render(); setTimeout(() => { if (S.confirm === key) { S.confirm = null; render(); } }, 3000); break; }
        S.confirm = null;
        saveHabits(getHabits().filter(x => x.id !== d.id)); render(); break;
      }
      case 'prepare': openPrepare(mode === 'past' ? todayKey() : S.view); break;
      case 'history': openHistory(); break;
      case 'bell': openReminder(); break;
    }
  }

  function saveEdit() {
    const body = $('dsBody'), e = S.editing;
    if (!e) return;
    if (e.t === 'task') {
      const text = (body.querySelector('[data-edit="text"]') || {}).value, cnt = (body.querySelector('[data-edit="count"]') || {}).value;
      if (!text || !text.trim()) { body.querySelector('[data-edit="text"]').focus(); return; }
      mutate(S.view, r => { const s = findSubj(r, e.k), t = s && s.tasks.find(x => x.id === e.id); if (t) { t.text = text.trim(); t.count = clampCount(cnt); } });
    } else {
      const name = (body.querySelector('[data-edit="hname"]') || {}).value;
      if (!name || !name.trim()) { body.querySelector('[data-edit="hname"]').focus(); return; }
      saveHabits(getHabits().map(x => x.id === e.id ? { ...x, name: name.trim() } : x));
    }
    S.editing = null; render();
  }

  function bindPanel() {
    const body = $('dsBody');
    body.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b || b.disabled) return;
      act(b.dataset.a, b.dataset);
    });
    body.addEventListener('keydown', e => {
      const t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t.matches && t.matches('.ds-subj-head')) { e.preventDefault(); act(t.dataset.a, t.dataset); return; }
      if (e.key === 'Enter') {
        if (t.dataset.add) { e.preventDefault(); act('addtask', { k: t.dataset.add }); }
        else if (t.dataset.addhabit) { e.preventDefault(); act('addhabit', {}); }
        else if (t.dataset.edit) { e.preventDefault(); saveEdit(); }
      } else if (e.key === 'Escape' && t.dataset.edit) { e.preventDefault(); e.stopPropagation(); S.editing = null; render(); }
    });
    $('dsCollapseBtn').addEventListener('click', e => { e.stopPropagation(); togglePanel(); });
    $('dsHead').addEventListener('click', () => { if (collapsedNow()) togglePanel(); });
  }

  function togglePanel() { ui.collapsed = !collapsedNow(); saveUI(); render(); }

  /* =====================================================
     النوافذ
     ===================================================== */
  const MODALS = { prepare: 'dsPrepare', reminder: 'dsReminder', history: 'dsHistory' };
  function showModal(name) {
    Object.keys(MODALS).forEach(k => $(MODALS[k]).classList.toggle('active', k === name));
    $('dsOverlay').classList.add('active');
    S.modal = name; S.escArm = false;
    setTimeout(() => { const m = $(MODALS[name]); if (m && !m.contains(document.activeElement)) m.focus(); }, 30);
  }
  function closeModal(force) {
    Object.keys(MODALS).forEach(k => $(MODALS[k]).classList.remove('active'));
    $('dsOverlay').classList.remove('active');
    S.modal = null; S.draft = null; S.escArm = false;
    $('dsPrepMsg').textContent = '';
    if (S.pendingReminder && !force && !state.activePopup) { S.pendingReminder = false; setTimeout(openReminder, 250); }
  }

  /* ---------- نافذة التذكير ---------- */
  function openReminder() {
    const rec = getView(todayKey()), st = stats(rec), prepared = isPrepared(rec);
    $('dsReminder').classList.toggle('ready', prepared);
    $('dsRemIcon').textContent = prepared ? '🌟' : '⏰';
    $('dsRemTitle').textContent = prepared ? 'جدولك اليومي جاهز، ابدأ بإنجاز مهامك!' : 'لم تجهز جدول اليوم بعد، جهّز مهامك حتى تبدأ يومك.';
    $('dsRemText').textContent = dateStr(todayKey());
    let sum = '';
    if (prepared) {
      sum += '<div class="ds-sum-chips">' + rec.subjects.map(s => {
        const x = subjStat(s);
        return `<span class="ds-sum-chip" style="--c:${esc(s.color)}">${esc(s.name)} <b>${x.d}/${x.t}</b></span>`;
      }).join('') + '</div>';
      sum += `<div class="ds-sum-line">📚 ${rec.subjects.length} مواد • ${st.tt} مهمة (${st.td} منجزة)</div>`;
    }
    sum += st.ht ? `<div class="ds-sum-line">🔁 ${st.ht} عادات يومية (${st.hd} منجزة)</div>`
                 : '<div class="ds-sum-line muted">لم تضف عادات يومية بعد</div>';
    $('dsRemSummary').innerHTML = sum;
    $('dsRemBtns').innerHTML = prepared
      ? `<button class="ds-btn ds-btn-primary" data-r="open">📅 فتح الجدول</button>
         <button class="ds-btn" data-r="edit">✏️ تعديل الجدول</button>
         <button class="ds-btn" data-r="close">إغلاق</button>`
      : `<button class="ds-btn ds-btn-primary" data-r="prep">📝 Prepare Today's Schedule</button>
         <button class="ds-btn" data-r="close">لاحقًا</button>`;
    showModal('reminder');
  }
  function remAction(r) {
    if (r === 'close') { closeModal(); return; }
    if (r === 'prep' || r === 'edit') { S.view = todayKey(); closeModal(true); openPrepare(todayKey()); return; }
    if (r === 'open') {
      S.view = todayKey(); ui.collapsed = false; saveUI(); closeModal(true); render();
      const p = $('dsPanel'); p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash');
      if (!isWide()) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /* ---------- نافذة تجهيز الجدول ---------- */
  function openPrepare(dk) {
    dk = dk || S.view;
    if (dk < todayKey()) dk = todayKey();
    const rec = getView(dk);
    S.draft = { dk, subjects: JSON.parse(JSON.stringify(rec.subjects)) };
    S.draft.subjects.forEach(s => s.tasks.forEach(t => { if (!t.id) t.id = uid(); }));
    S.draftStart = JSON.stringify(S.draft.subjects);
    S.stash = {};
    const isT = dk === todayKey();
    $('dsPrepTitle').textContent = isT ? "📝 Prepare Today's Schedule" : '📝 Prepare Schedule';
    $('dsPrepSub').textContent = dateStr(dk) + ' — اختر المواد، أضف مهامها، رتّبها، ثم احفظ';
    $('dsPrepMsg').textContent = '';
    renderPrepare();
    showModal('prepare');
    setTimeout(() => { const f = $('dsPrepBody').querySelector('[data-padd]') || $('dsPrepBody').querySelector('.ds-chip'); if (f) f.focus(); }, 60);
  }

  function renderPrepare() {
    const body = $('dsPrepBody'), sc = body.scrollTop, d = S.draft;
    if (!d) return;
    // لا نفقد ما كُتب في خانات الإضافة عند إعادة الرسم (ترتيب/إضافة مادة...)
    const keep = {};
    body.querySelectorAll('[data-padd],[data-pcount]').forEach(i => { if (i.value) keep[i.dataset.padd ? 'a' + i.dataset.padd : 'c' + i.dataset.pcount] = i.value; });
    let h = '<div class="ds-hint">1) اختر المواد التي تريد دراستها اليوم &nbsp;•&nbsp; 2) أضف المهام أو المحاضرات &nbsp;•&nbsp; 3) رتّبها بالأسهم ▲▼</div><div class="ds-chips">';
    SUBJECTS.forEach(s => {
      const on = d.subjects.some(x => x.key === s.key);
      h += `<button type="button" class="ds-chip${on ? ' on' : ''}" style="--c:${s.color}" data-a="psubj" data-k="${s.key}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(s.name)}</button>`;
    });
    h += '</div>';
    if (!d.subjects.length) h += '<div class="ds-empty">اضغط على مادة من الأعلى لإضافتها إلى جدول اليوم</div>';
    d.subjects.forEach((s, si) => {
      h += `<div class="ds-pcard" style="--c:${esc(s.color)}" data-k="${esc(s.key)}">
        <div class="ds-pcard-head">
          <span class="ds-dot"></span><b>${esc(s.name)}</b>${s.legacy ? '<span class="ds-tag">من الخطة القديمة</span>' : ''}
          <span class="ds-pc-count">${s.tasks.length} مهمة</span>
          <span class="ds-row-btns on">
            <button class="ds-icon-btn ds-sm" data-a="psup" data-k="${esc(s.key)}" title="للأعلى" ${si === 0 ? 'disabled' : ''}>▲</button>
            <button class="ds-icon-btn ds-sm" data-a="psdown" data-k="${esc(s.key)}" title="للأسفل" ${si === d.subjects.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="ds-icon-btn ds-sm" data-a="psrm" data-k="${esc(s.key)}" title="إزالة المادة من اليوم">✕</button>
          </span>
        </div>`;
      s.tasks.forEach((t, ti) => {
        h += `<div class="ds-prow" data-k="${esc(s.key)}" data-id="${esc(t.id)}">
          <span class="ds-pnum">${ti + 1}.</span>
          <input class="ds-in" data-f="text" value="${esc(t.text)}" maxlength="80" placeholder="اسم المهمة أو المحاضرة">
          <input class="ds-in ds-in-n" data-f="count" type="number" min="1" max="99" value="${t.count || ''}" placeholder="عدد" title="عدد المحاضرات / الدروس (اختياري)">
          <span class="ds-row-btns on">
            <button class="ds-icon-btn ds-sm" data-a="ptup" data-k="${esc(s.key)}" data-id="${esc(t.id)}" ${ti === 0 ? 'disabled' : ''}>▲</button>
            <button class="ds-icon-btn ds-sm" data-a="ptdown" data-k="${esc(s.key)}" data-id="${esc(t.id)}" ${ti === s.tasks.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="ds-icon-btn ds-sm" data-a="ptdel" data-k="${esc(s.key)}" data-id="${esc(t.id)}">🗑</button>
          </span>
        </div>`;
      });
      h += `<div class="ds-prow ds-padd">
          <input class="ds-in" data-padd="${esc(s.key)}" maxlength="80" placeholder="＋ مهمة أو محاضرة جديدة (Enter للإضافة)">
          <input class="ds-in ds-in-n" data-pcount="${esc(s.key)}" type="number" min="1" max="99" placeholder="عدد" title="عدد المحاضرات / الدروس (اختياري)">
          <button class="ds-btn ds-btn-sm" data-a="ptadd" data-k="${esc(s.key)}">+ إضافة</button>
        </div></div>`;
    });
    body.innerHTML = h;
    body.scrollTop = sc;
    body.querySelectorAll('[data-padd],[data-pcount]').forEach(i => {
      const v = keep[i.dataset.padd ? 'a' + i.dataset.padd : 'c' + i.dataset.pcount]; if (v) i.value = v;
    });
  }

  function prepAddTask(k) {
    const body = $('dsPrepBody'), inp = body.querySelector(`[data-padd="${k}"]`), cnt = body.querySelector(`[data-pcount="${k}"]`);
    const s = S.draft.subjects.find(x => x.key === k);
    if (!s || !inp) return false;
    const text = inp.value.trim();
    if (!text) { inp.focus(); return false; }
    s.tasks.push({ id: uid(), text, count: clampCount(cnt && cnt.value), done: false });
    inp.value = ''; if (cnt) cnt.value = '';
    renderPrepare();
    const n = $('dsPrepBody').querySelector(`[data-padd="${k}"]`); if (n) n.focus();
    return true;
  }
  function move(arr, i, dir) { const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }

  function prepAct(a, d) {
    const dr = S.draft; if (!dr) return;
    const subj = dr.subjects.find(x => x.key === d.k);
    switch (a) {
      case 'psubj': {
        if (subj) { S.stash[d.k] = subj; dr.subjects = dr.subjects.filter(x => x.key !== d.k); renderPrepare(); break; }
        const def = SUBJECTS.find(x => x.key === d.k);
        dr.subjects.push(S.stash[d.k] || { key: def.key, name: def.name, color: def.color, tasks: [] });
        renderPrepare();
        const f = $('dsPrepBody').querySelector(`[data-padd="${d.k}"]`); if (f) f.focus();
        break;
      }
      case 'psrm': dr.subjects = dr.subjects.filter(x => x.key !== d.k); if (!subj.legacy) S.stash[d.k] = subj; renderPrepare(); break;
      case 'psup': move(dr.subjects, dr.subjects.indexOf(subj), -1); renderPrepare(); break;
      case 'psdown': move(dr.subjects, dr.subjects.indexOf(subj), 1); renderPrepare(); break;
      case 'ptup': move(subj.tasks, subj.tasks.findIndex(t => t.id === d.id), -1); renderPrepare(); break;
      case 'ptdown': move(subj.tasks, subj.tasks.findIndex(t => t.id === d.id), 1); renderPrepare(); break;
      case 'ptdel': subj.tasks = subj.tasks.filter(t => t.id !== d.id); renderPrepare(); break;
      case 'ptadd': prepAddTask(d.k); break;
    }
  }

  function prepDirty() {
    if (!S.draft) return false;
    const body = $('dsPrepBody');
    if ([...body.querySelectorAll('[data-padd]')].some(i => i.value.trim())) return true;
    return JSON.stringify(S.draft.subjects) !== S.draftStart;
  }
  function requestClosePrepare() {
    if (prepDirty() && !S.escArm) {
      S.escArm = true; $('dsPrepMsg').textContent = 'توجد تغييرات غير محفوظة — اضغط Esc مرة أخرى للإلغاء';
      return;
    }
    closeModal();
  }

  function savePrepare() {
    const dr = S.draft; if (!dr) return;
    const body = $('dsPrepBody');
    // ما كُتب في خانة الإضافة ولم يُضَف بعد لا يضيع
    dr.subjects.forEach(s => {
      const inp = body.querySelector(`[data-padd="${s.key}"]`), cnt = body.querySelector(`[data-pcount="${s.key}"]`);
      if (inp && inp.value.trim()) s.tasks.push({ id: uid(), text: inp.value.trim(), count: clampCount(cnt && cnt.value), done: false });
    });
    dr.subjects.forEach(s => { s.tasks = s.tasks.map(t => ({ id: t.id, text: String(t.text || '').trim(), count: clampCount(t.count), done: !!t.done })).filter(t => t.text); });
    if (!dr.subjects.length) { $('dsPrepMsg').textContent = '⚠️ اختر مادة واحدة على الأقل'; return; }
    if (dr.dk < todayKey()) { dr.dk = todayKey(); toast('بدأ يوم جديد — تم حفظ الجدول في اليوم الحالي'); }
    mutate(dr.dk, r => { r.subjects = dr.subjects; r.prepared = true; });
    S.view = dr.dk; S.editing = null;
    closeModal(true); render();
    toast('✅ تم حفظ الجدول');
  }

  function bindPrepare() {
    const body = $('dsPrepBody');
    body.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && !b.disabled) prepAct(b.dataset.a, b.dataset); });
    body.addEventListener('input', e => {
      const t = e.target; if (!t.dataset.f || !S.draft) return;
      const row = t.closest('.ds-prow'), s = S.draft.subjects.find(x => x.key === row.dataset.k), task = s && s.tasks.find(x => x.id === row.dataset.id);
      if (!task) return;
      if (t.dataset.f === 'text') task.text = t.value; else task.count = clampCount(t.value);
      S.escArm = false;
    });
    body.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t.dataset.padd) { e.preventDefault(); prepAddTask(t.dataset.padd); }
      else if (t.dataset.pcount) { e.preventDefault(); prepAddTask(t.dataset.pcount); }
      else if (t.dataset.f) { e.preventDefault(); }
    });
    $('dsPrepSave').addEventListener('click', savePrepare);
    $('dsPrepCancel').addEventListener('click', requestClosePrepare);
    $('dsPrepClose').addEventListener('click', requestClosePrepare);
  }

  /* ---------- السجل ---------- */
  function openHistory() {
    const t = todayKey(), dks = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(K_DAY)) { const dk = k.slice(K_DAY.length); if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && dk <= t) dks.push(dk); }
    }
    dks.sort().reverse();
    let h = '', n = 0;
    dks.slice(0, 120).forEach(dk => {
      const rec = getView(dk), st = stats(rec);
      if (!st.tt && !st.ht) return;
      n++;
      h += `<button class="ds-hrow" data-dk="${dk}">
        <div class="ds-hrow-top"><b>${esc(relLabel(dk))}</b><span>${esc(dateStr(dk))}</span><span class="ds-hpct">${st.pct}%</span></div>
        <div class="ds-bar"><i style="width:${st.pct}%"></i></div>
        <small>مهام ${st.td}/${st.tt} • عادات ${st.hd}/${st.ht}</small>
      </button>`;
    });
    $('dsHistBody').innerHTML = n ? h : '<div class="ds-empty">لا يوجد سجل بعد — سيظهر هنا كل يوم تجهّز فيه جدولك</div>';
    showModal('history');
  }

  /* ---------- تغيّر اليوم ---------- */
  function tick() {
    const t = todayKey();
    if (t !== S.today) {
      const was = S.view === S.today;
      S.today = t; if (was) S.view = t;
      S.editing = null; S.confirm = null;
      render();
      S.pendingReminder = true;
    }
    if (S.pendingReminder && !S.modal && !state.activePopup) { S.pendingReminder = false; openReminder(); }
  }

  /* ---------- كيبورد (خاص بالجدول) ---------- */
  function bindKeys() {
    document.addEventListener('keydown', e => {
      if (S.modal) {
        if (state.activePopup) return;            // بوب آب التايمر الإجباري أولى
        if (e.key === 'Escape') { e.preventDefault(); S.modal === 'prepare' ? requestClosePrepare() : closeModal(); return; }
        if (S.modal === 'prepare' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); savePrepare(); }
        return;
      }
      const tag = (document.activeElement.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !state.activePopup) {
        e.preventDefault(); openPrepare(S.view < todayKey() ? todayKey() : S.view);
      }
    });
    $('dsOverlay').addEventListener('click', () => { if (S.modal === 'reminder' || S.modal === 'history') closeModal(); });
    $('dsRemBtns').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) remAction(b.dataset.r); });
    $('dsHistClose').addEventListener('click', () => closeModal());
    $('dsHistBody').addEventListener('click', e => {
      const b = e.target.closest('[data-dk]'); if (!b) return;
      S.view = b.dataset.dk; S.editing = null; closeModal(true); render();
    });
  }

  /* ---------- تهيئة ---------- */
  function measureTop() {
    const t = document.querySelector('.topbar');
    if (t) document.documentElement.style.setProperty('--topbar-h', t.offsetHeight + 'px');
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('dsPanel')) return;
    const saved = jget(K_UI, null);
    if (saved && typeof saved === 'object') ui = { collapsed: saved.collapsed ?? null, closed: saved.closed || {} };
    migrateLegacy();
    measureTop();
    if ('ResizeObserver' in window) new ResizeObserver(measureTop).observe(document.querySelector('.topbar'));
    window.addEventListener('resize', () => { measureTop(); render(); });
    bindPanel(); bindPrepare(); bindKeys();
    render();
    setInterval(tick, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    // تذكير عند فتح الموقع
    setTimeout(() => { if (!S.modal && !state.activePopup) openReminder(); }, 500);
  });

  window.DailySchedule = {
    togglePanel, openPrepare: () => openPrepare(S.view < todayKey() ? todayKey() : S.view),
    isModalOpen: () => !!S.modal,
  };
})();

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
