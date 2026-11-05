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
