/**
 * firebase.js — نظام المزامنة والمقارنة Real-Time
 * يُحمَّل كـ ES Module منفصل
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, set, update, onValue, get }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// ─── إعدادات Firebase ───────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBW_cc4iRrBclqK6xSJDb_goaLt1WOTs-E",
  authDomain:        "waqti-97e97.firebaseapp.com",
  databaseURL:       "https://waqti-97e97-default-rtdb.firebaseio.com",
  projectId:         "waqti-97e97",
  storageBucket:     "waqti-97e97.firebasestorage.app",
  messagingSenderId: "227376312121",
  appId:             "1:227376312121:web:b01d54d2ef7ab51ce782e8",
  measurementId:     "G-YPNZ0S3CSH"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ─── الحالة الداخلية ─────────────────────────
const fbState = {
  myId:        null,
  friendId:    null,
  connected:   false,
  unsubMe:     null,
  unsubFriend: null,
  myData:      null,
  friendData:  null,
  autoSyncId:  null,   // ID المزامنة التلقائية كل 5 دقائق
};

// ─── مساعد: مفتاح اليوم بالتوقيت المحلي ────────
function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// ─── حساب إحصائيات اليوم من localStorage ────
function calcTodayStats() {
  const dk   = getTodayKey();
  const raw  = localStorage.getItem(`waqti_${dk}`);
  const data = raw ? JSON.parse(raw) : [];

  let studyTime        = 0; // بالدقائق
  let breakTime        = 0;
  let procrastination  = 0;

  data.forEach(e => {
    if (e.activity === 'دراسة')   studyTime       += (e.duration || 0);
    if (e.activity === 'استراحة') breakTime        += (e.duration || 0);
    if (e.activity === 'تسخيت')   procrastination  += (e.duration || 0);
  });

  const sessionsCount = data.length;

  // حساب الستريك
  let streak = 0;
  const today = new Date(); today.setHours(0,0,0,0);
  for (let i = 0; i < 365; i++) {
    const cur = new Date(today); cur.setDate(today.getDate()-i);
    const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    const day = JSON.parse(localStorage.getItem(`waqti_${key}`) || '[]');
    if (day.length > 0) streak++;
    else break;
  }

  // Focus Score = نسبة الدراسة / (دراسة + تسخيت) × 100
  const total  = studyTime + procrastination;
  const focusScore = total > 0 ? Math.round((studyTime / total) * 100) : 0;

  return { studyTime, breakTime, procrastination, sessionsCount, streak, focusScore };
}

// ─── رفع بيانات المستخدم لـ Firebase ─────────
export async function syncToFirebase() {
  if (!fbState.connected || !fbState.myId) return;
  try {
    const stats = calcTodayStats();
    const today = getTodayKey();
    await update(ref(db, `/users/${fbState.myId}`), {
      studyTime:           stats.studyTime,
      breakTime:           stats.breakTime,
      focusScore:          stats.focusScore,
      sessionsCount:       stats.sessionsCount,
      streak:              stats.streak,
      procrastinationTime: stats.procrastination,
      date:                today,          // ← نحفظ التاريخ
      updatedAt:           Date.now(),
    });
  } catch (e) {
    console.warn('Firebase sync error:', e);
  }
}

// ─── الاتصال والاستماع ───────────────────────
export function connectComparison(myId, friendId) {
  if (!myId || !friendId) return false;
  if (myId === friendId)  return false;

  fbState.myId      = myId.trim();
  fbState.friendId  = friendId.trim();
  fbState.connected = true;

  // حفظ في localStorage للمرة القادمة
  localStorage.setItem('waqti_fbMyId',     fbState.myId);
  localStorage.setItem('waqti_fbFriendId', fbState.friendId);

  // استمع لبيانات نفسي
  fbState.unsubMe = onValue(ref(db, `/users/${fbState.myId}`), snap => {
    fbState.myData = snap.val();
    renderComparison();
  });

  // استمع لبيانات الصديق
  fbState.unsubFriend = onValue(ref(db, `/users/${fbState.friendId}`), snap => {
    fbState.friendData = snap.val();
    renderComparison();
  });

  // ارفع بياناتي الحالية فوراً (حتى لو صفر — لتحديث الـ date)
  syncToFirebase();

  // كذلك زامن كل 5 دقائق تلقائياً
  fbState.autoSyncId = setInterval(syncToFirebase, 5 * 60 * 1000);
  return true;
}

export function disconnectComparison() {
  if (fbState.unsubMe)     { fbState.unsubMe();     fbState.unsubMe = null; }
  if (fbState.unsubFriend) { fbState.unsubFriend();  fbState.unsubFriend = null; }
  if (fbState.autoSyncId)  { clearInterval(fbState.autoSyncId); fbState.autoSyncId = null; }
  fbState.connected  = false;
  fbState.myData     = null;
  fbState.friendData = null;

  const board = document.getElementById('cmpBoard');
  const setup = document.getElementById('cmpSetupCard');
  if (board) board.style.display = 'none';
  if (setup) setup.style.display = 'block';
  updateStatus('', '');
}

// ─── عرض المقارنة ────────────────────────────
function fmt(min) {
  if (!min && min !== 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}س ${m}د` : `${m}د`;
}

/** إذا بيانات المستخدم من يوم سابق → أرجع صفر */
function freshData(rawData) {
  if (!rawData) return {};
  const today = getTodayKey();
  // إذا ما في date أو التاريخ مختلف → بيانات اليوم صفر
  if (!rawData.date || rawData.date !== today) {
    return {
      studyTime:           0,
      breakTime:           0,
      focusScore:          0,
      sessionsCount:       0,
      procrastinationTime: 0,
      streak:              rawData.streak || 0, // الستريك يبقى (مو يومي)
      date:                rawData.date || null,
      updatedAt:           rawData.updatedAt || 0,
    };
  }
  return rawData;
}

function renderComparison() {
  const me  = freshData(fbState.myData);
  const fr  = freshData(fbState.friendData);

  // ── قيم ──
  const vals = {
    myStudy:    me.studyTime           || 0,
    frStudy:    fr.studyTime           || 0,
    myStreak:   me.streak              || 0,
    frStreak:   fr.streak              || 0,
    myScore:    me.focusScore          || 0,
    frScore:    fr.focusScore          || 0,
    mySessions: me.sessionsCount       || 0,
    frSessions: fr.sessionsCount       || 0,
    myProc:     me.procrastinationTime || 0,
    frProc:     fr.procrastinationTime || 0,
  };

  // ── تحديث الخلايا ──
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  const setWin = (myId, frId, myV, frV, higherWins = true) => {
    const myEl = document.getElementById(myId);
    const frEl = document.getElementById(frId);
    if (!myEl || !frEl) return;
    myEl.classList.remove('cmp-win','cmp-lose');
    frEl.classList.remove('cmp-win','cmp-lose');
    if (myV === frV) return;
    const myWins = higherWins ? myV > frV : myV < frV;
    myEl.classList.add(myWins ? 'cmp-win' : 'cmp-lose');
    frEl.classList.add(myWins ? 'cmp-lose' : 'cmp-win');
  };

  set('cv-myStudy',    fmt(vals.myStudy));
  set('cv-frStudy',    fmt(vals.frStudy));
  set('cv-myStreak',   `${vals.myStreak} 🔥`);
  set('cv-frStreak',   `${vals.frStreak} 🔥`);
  set('cv-myScore',    `${vals.myScore}%`);
  set('cv-frScore',    `${vals.frScore}%`);
  set('cv-mySessions', vals.mySessions);
  set('cv-frSessions', vals.frSessions);
  set('cv-myProc',     fmt(vals.myProc));
  set('cv-frProc',     fmt(vals.frProc));

  // ── اللون الأخضر للفائز ──
  setWin('cv-myStudy',    'cv-frStudy',    vals.myStudy,    vals.frStudy);
  setWin('cv-myStreak',   'cv-frStreak',   vals.myStreak,   vals.frStreak);
  setWin('cv-myScore',    'cv-frScore',    vals.myScore,    vals.frScore);
  setWin('cv-mySessions', 'cv-frSessions', vals.mySessions, vals.frSessions);
  setWin('cv-myProc',     'cv-frProc',     vals.myProc,     vals.frProc, false); // أقل تسخيت = أفضل

  // ── تحديد الفائز الكلي ──
  let myPoints = 0, frPoints = 0;
  if (vals.myStudy    > vals.frStudy)    myPoints++; else if (vals.frStudy    > vals.myStudy)    frPoints++;
  if (vals.myStreak   > vals.frStreak)   myPoints++; else if (vals.frStreak   > vals.myStreak)   frPoints++;
  if (vals.myScore    > vals.frScore)    myPoints++; else if (vals.frScore    > vals.myScore)    frPoints++;
  if (vals.mySessions > vals.frSessions) myPoints++; else if (vals.frSessions > vals.mySessions) frPoints++;
  if (vals.myProc     < vals.frProc)     myPoints++; else if (vals.frProc     < vals.myProc)     frPoints++;

  const winCard = document.getElementById('cmpWinnerCard');
  const winText = document.getElementById('cmpWinnerText');
  if (winCard && winText) {
    winCard.className = 'cmp-winner-card';
    if (myPoints > frPoints) {
      winText.textContent = 'أنت المتقدم 🔥';
      winCard.classList.add('cmp-i-win');
    } else if (frPoints > myPoints) {
      winText.textContent = 'صديقك متفوق 😏';
      winCard.classList.add('cmp-fr-win');
    } else {
      winText.textContent = 'تعادل 🤝';
      winCard.classList.add('cmp-tie');
    }
  }

  // ── آخر تحديث ──
  const lastEl = document.getElementById('cmpLastUpdate');
  if (lastEl) {
    const ts = Math.max(me.updatedAt||0, fr.updatedAt||0);
    if (ts) {
      const d = new Date(ts);
      lastEl.textContent = `آخر تحديث: ${d.toLocaleTimeString('ar-IQ', {hour12:true})}`;
    }
  }
}

// ══════════════════════════════════════════════
//   المحادثة الفورية (Chat)
// ══════════════════════════════════════════════

const chatState = {
  unsubChat: null,
  lastMsgCount: 0,
  isOnPage: false,   // هل المستخدم على صفحة المقارنة الآن؟
};

// ── صوت الإشعار بـ Web Audio API ──────────────────
function playMsgSound(isMine) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    if (isMine) {
      // صوت إرسال: نغمة خفيفة صاعدة (pop ناعم)
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(780, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
      osc.onended = () => ctx.close();

    } else {
      // صوت استقبال: نغمتان متتاليتان (ding-ding مميز)
      const t = ctx.currentTime;

      [0, 0.13].forEach((delay, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        const filt = ctx.createBiquadFilter();

        osc.connect(filt);
        filt.connect(gain);
        gain.connect(ctx.destination);

        filt.type = 'bandpass';
        filt.frequency.value = 1200;
        filt.Q.value = 0.8;

        osc.type = 'triangle';
        const freq = i === 0 ? 880 : 1046;
        osc.frequency.setValueAtTime(freq, t + delay);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.97, t + delay + 0.18);

        gain.gain.setValueAtTime(0, t + delay);
        gain.gain.linearRampToValueAtTime(0.22, t + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.28);

        osc.start(t + delay);
        osc.stop(t + delay + 0.3);
        if (i === 1) osc.onended = () => ctx.close();
      });
    }
  } catch(e) { /* صامت لو ما في Web Audio */ }
}

/** إرسال رسالة إلى Firebase */
export async function sendChatMessage(text) {
  if (!fbState.connected || !fbState.myId || !text.trim()) return;
  const chatKey = [fbState.myId, fbState.friendId].sort().join('_');
  const msgId   = Date.now() + '_' + Math.random().toString(36).slice(2,6);
  try {
    await set(ref(db, `/chats/${chatKey}/${msgId}`), {
      sender:    fbState.myId,
      text:      text.trim(),
      timestamp: Date.now(),
    });
    playMsgSound(true);  // صوت الإرسال
  } catch(e) { console.warn('Chat send error:', e); }
}

/** بدء الاستماع للمحادثة */
function subscribeChat() {
  if (!fbState.myId || !fbState.friendId) return;
  const chatKey = [fbState.myId, fbState.friendId].sort().join('_');

  chatState.unsubChat = onValue(ref(db, `/chats/${chatKey}`), snap => {
    const data = snap.val() || {};
    const msgs = Object.entries(data)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => a.timestamp - b.timestamp);

    renderChatMessages(msgs);

    // إشعار الصوت والنقطة الحمراء عند وصول رسالة جديدة
    const newCount = msgs.filter(m => m.sender !== fbState.myId).length;
    if (newCount > chatState.lastMsgCount) {
      playMsgSound(false);  // صوت الاستقبال دائماً
      if (!chatState.isOnPage) showChatNotif();
    }
    chatState.lastMsgCount = newCount;
  });
}

function unsubscribeChat() {
  if (chatState.unsubChat) { chatState.unsubChat(); chatState.unsubChat = null; }
}

function renderChatMessages(msgs) {
  const container = document.getElementById('cmpChatMessages');
  if (!container) return;

  if (!msgs.length) {
    container.innerHTML = '<div class="cmp-chat-empty">لا توجد رسائل بعد — كن أول من يبدأ! 💪</div>';
    return;
  }

  container.innerHTML = msgs.map(m => {
    const isMine = m.sender === fbState.myId;
    const time   = new Date(m.timestamp).toLocaleTimeString('ar-IQ', { hour12: true, hour: '2-digit', minute: '2-digit' });
    return `
      <div class="cmp-msg ${isMine ? 'mine' : 'theirs'}">
        <div class="cmp-msg-bubble">${escapeHtml(m.text)}</div>
        <div class="cmp-msg-meta">${isMine ? 'أنت' : m.sender} · ${time}</div>
      </div>`;
  }).join('');

  // تمرير للأسفل
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showChatNotif() {
  const dot = document.getElementById('compareNotifDot');
  if (dot) dot.style.display = 'inline-block';
}

function hideChatNotif() {
  const dot = document.getElementById('compareNotifDot');
  if (dot) dot.style.display = 'none';
  chatState.lastMsgCount = 0;
}

// ══════════════════════════════════════════════
//   تايم لاين الخصم (Friend Timeline)
// ══════════════════════════════════════════════

/** ألوان الأنشطة */
const activityColors = {
  'دراسة':   '#4ade80',
  'استراحة': '#60a5fa',
  'صلاة':    '#f59e0b',
  'أكل':     '#f97316',
  'تسخيت':  '#f43f5e',
  'أخرى':   '#a78bfa',
};

/** رسم تايم لاين الصديق — يُستدعى عند تحديث بيانات الصديق في Firebase */
function renderFriendTimeline(rawData) {
  const container = document.getElementById('cmpFriendTimeline');
  const dateEl    = document.getElementById('cmpTLDate');
  if (!container) return;

  // لو ما في timeline — نعرض ملخص الإحصائيات بدلاً من رسالة فارغة
  if (!rawData || !rawData.timeline || !rawData.timeline.length) {
    const today = getTodayKey();
    const isToday = rawData && rawData.date === today;
    if (rawData && (rawData.studyTime || rawData.sessionsCount)) {
      const items = [
        { activity: 'دراسة',   duration: rawData.studyTime           || 0, time: '' },
        { activity: 'استراحة', duration: rawData.breakTime           || 0, time: '' },
        { activity: 'تسخيت',  duration: rawData.procrastinationTime || 0, time: '' },
      ].filter(x => x.duration > 0);
      if (items.length) {
        if (dateEl && rawData.date) dateEl.textContent = rawData.date;
        container.innerHTML = '<div style="font-size:.7rem;color:var(--text3);padding:6px 10px;text-align:center">ملخص إحصائيات اليوم</div>' +
          items.map(entry => {
            const color = activityColors[entry.activity] || '#a78bfa';
            const h = Math.floor(entry.duration / 60), m = entry.duration % 60;
            const durText = h > 0 ? `${h}س ${m}د` : `${m}د`;
            return `<div class="cmp-tl-item" style="border-right-color:${color}">
              <div class="cmp-tl-dot" style="background:${color}"></div>
              <div class="cmp-tl-info"><div class="cmp-tl-act">${entry.activity}</div></div>
              <div class="cmp-tl-dur">${durText}</div>
            </div>`;
          }).join('');
        return;
      }
    }
    container.innerHTML = '<p class="cmp-tl-empty">في انتظار بيانات الصديق...</p>';
    return;
  }

  // تحديث التاريخ
  if (dateEl && rawData.date) dateEl.textContent = rawData.date;

  container.innerHTML = rawData.timeline.map(entry => {
    const color = activityColors[entry.activity] || '#a78bfa';
    const h = Math.floor((entry.duration || 0) / 60);
    const m = (entry.duration || 0) % 60;
    const durText = h > 0 ? `${h}س ${m}د` : `${m}د`;
    const time = entry.time || '';
    return `
      <div class="cmp-tl-item" style="border-right-color:${color}">
        <div class="cmp-tl-dot" style="background:${color}"></div>
        <div class="cmp-tl-info">
          <div class="cmp-tl-act">${escapeHtml(entry.activity)}</div>
          <div class="cmp-tl-time">${time}</div>
        </div>
        <div class="cmp-tl-dur">${durText}</div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
//   توصيل التايم لاين ببيانات Firebase الحية
// ══════════════════════════════════════════════

/**
 * نضيف hook على fbState.friendData عند كل تحديث من onValue الصديق
 * نستخدم wrapper يطلب تفاصيل اليوم (timeline) من Firebase
 */
let _friendTimelineUnsub = null;

function subscribeFriendTimeline() {
  if (!fbState.friendId) return;
  _friendTimelineUnsub = onValue(
    ref(db, `/users/${fbState.friendId}/timeline`),
    snap => {
      const tl = snap.val();
      // نجمع مع بيانات الصديق الأخرى
      const combined = { ...(fbState.friendData || {}), timeline: tl ? Object.values(tl) : [] };
      renderFriendTimeline(combined);
    }
  );
}

function unsubscribeFriendTimeline() {
  if (_friendTimelineUnsub) { _friendTimelineUnsub(); _friendTimelineUnsub = null; }
}

// ══════════════════════════════════════════════
//   رفع تايم لاين اليوم مع بيانات المستخدم
// ══════════════════════════════════════════════

/** نضيف تايم لاين اليوم عند الرفع لـ Firebase */
const _origSync = syncToFirebase;

export async function syncToFirebaseWithTimeline() {
  if (!fbState.connected || !fbState.myId) return;
  try {
    const stats    = calcTodayStats();
    const today    = getTodayKey();
    const raw      = localStorage.getItem(`waqti_${today}`);
    const entries  = raw ? JSON.parse(raw) : [];

    // نبني الـ timeline بشكل مبسّط
    const timeline = entries.map((e, i) => ({
      activity: e.activity || 'أخرى',
      duration: e.duration || 0,
      time:     e.time || '',
    }));

    // نرفع الإحصائيات
    await update(ref(db, `/users/${fbState.myId}`), {
      studyTime:           stats.studyTime,
      breakTime:           stats.breakTime,
      focusScore:          stats.focusScore,
      sessionsCount:       stats.sessionsCount,
      streak:              stats.streak,
      procrastinationTime: stats.procrastination,
      date:                today,
      updatedAt:           Date.now(),
    });

    // نرفع التايم لاين كـ object مفهرس
    const tlObj = {};
    timeline.forEach((t, i) => { tlObj[i] = t; });
    await set(ref(db, `/users/${fbState.myId}/timeline`), tlObj);

  } catch(e) { console.warn('Firebase sync+timeline error:', e); }
}


// ══════════════════════════════════════════════
//   تهيئة واجهة الشات عند الاتصال
// ══════════════════════════════════════════════

function initChatUI() {
  const input   = document.getElementById('cmpChatInput');
  const sendBtn = document.getElementById('cmpChatSendBtn');

  const doSend = () => {
    if (!input) return;
    const txt = input.value.trim();
    if (!txt) return;
    sendChatMessage(txt);
    input.value = '';
    input.focus();
  };

  sendBtn?.addEventListener('click', doSend);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  // تتبّع هل المستخدم على صفحة المقارنة
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      chatState.isOnPage = (tab === 'compare');
      if (chatState.isOnPage) hideChatNotif();
    });
  });
}

// ── Init on DOMContentLoaded ─────────────────────

// ══════════════════════════════════════════════
//   تهيئة موحّدة عند تحميل الصفحة
// ══════════════════════════════════════════════
function updateStatus(msg, type) {
  const el = document.getElementById('cmpStatus');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'cmp-status' + (type ? ` cmp-status-${type}` : '');
}

window.addEventListener('DOMContentLoaded', () => {

  // ── استعادة الـ IDs المحفوظة ──
  const savedMy = localStorage.getItem('waqti_fbMyId');
  const savedFr = localStorage.getItem('waqti_fbFriendId');
  if (savedMy) { const el = document.getElementById('myUserId');     if(el) el.value = savedMy;  }
  if (savedFr) { const el = document.getElementById('friendUserId'); if(el) el.value = savedFr; }

  // ── توليد ID عشوائي ──
  document.getElementById('genIdBtn')?.addEventListener('click', () => {
    const id = 'user_' + Math.random().toString(36).slice(2,8);
    const el = document.getElementById('myUserId');
    if (el) { el.value = id; }
  });

  // ── تهيئة الشات ──
  initChatUI();

  // ── زر الاتصال الموحّد ──
  document.getElementById('cmpConnectBtn')?.addEventListener('click', () => {
    const myId = document.getElementById('myUserId')?.value?.trim();
    const frId = document.getElementById('friendUserId')?.value?.trim();
    if (!myId || !frId) { updateStatus('أدخل المعرّفين أولاً', 'err'); return; }
    if (myId === frId)   { updateStatus('لا يمكن مقارنة نفسك!', 'err'); return; }

    updateStatus('جارٍ الاتصال...', 'loading');
    const ok = connectComparison(myId, frId);
    if (ok) {
      // بدء الشات والتايم لاين
      subscribeChat();
      subscribeFriendTimeline();

      document.getElementById('cmpSetupCard').style.display = 'none';
      document.getElementById('cmpBoard').style.display     = 'block';
      document.getElementById('cmpMyName').textContent      = myId;
      document.getElementById('cmpFriendName').textContent  = frId;
      const fnEl = document.getElementById('cmpFriendNameTL');
      if (fnEl) fnEl.textContent = frId;
      document.getElementById('cmpIdsLabel').textContent    = `${myId} vs ${frId}`;
      chatState.isOnPage = true;
      updateStatus('متصل ✓', 'ok');
    } else {
      updateStatus('حدث خطأ في الاتصال', 'err');
    }
  });

  // ── زر قطع الاتصال الموحّد ──
  document.getElementById('cmpDisconnectBtn')?.addEventListener('click', () => {
    disconnectComparison();
    unsubscribeChat();
    unsubscribeFriendTimeline();
    chatState.isOnPage = false;
  });

  // ── تتبّع هل المستخدم على صفحة المقارنة ──
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      chatState.isOnPage = (tab === 'compare');
      if (chatState.isOnPage) hideChatNotif();
    });
  });
});

// ── تصدير ──
window._fbSync = syncToFirebaseWithTimeline;
