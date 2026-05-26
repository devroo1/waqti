// ==========================================
// 👑 نظام حاكم العقوبات — punishment.js
// ==========================================
// يُضاف هذا الملف بعد script.js في index.html
// <script src="punishment.js"></script>
// ==========================================

const PUNISHMENT_THRESHOLD_MIN = 15; // عتبة التسخيت المتتالية (دقائق)

// ---- قائمة العقوبات ----
const PUNISHMENTS = [
  {
    icon: '🏃',
    title: 'عقوبة رياضية!',
    task: 'قوم اعمل ٢٠ قرفصاء الحين قبل ما تكمل',
    color: '#4ade80',
  },
  {
    icon: '💧',
    title: 'عقوبة الترطيب!',
    task: 'قوم اشرب كأس ماء كامل وارجع',
    color: '#60a5fa',
  },
  {
    icon: '📖',
    title: 'عقوبة القراءة!',
    task: 'اقرأ صفحة واحدة من أي كتاب دراسي قبل ما تكمل',
    color: '#a78bfa',
  },
  {
    icon: '✍️',
    title: 'عقوبة الكتابة!',
    task: 'اكتب جملة واحدة عن شي تعلمته اليوم قبل ما تكمل',
    color: '#f59e0b',
  },
  {
    icon: '🧘',
    title: 'عقوبة التأمل!',
    task: 'خذ ٥ أنفاس عميقة وببطء... الحين',
    color: '#22d3ee',
  },
  {
    icon: '📝',
    title: 'عقوبة التخطيط!',
    task: 'اكتب ٣ أشياء تبي تذاكرها في الساعة الجاية',
    color: '#f97316',
  },
  {
    icon: '💪',
    title: 'عقوبة العضلات!',
    task: 'اعمل ١٥ ضغطة أرضية الحين — ما في تفاوض',
    color: '#f43f5e',
  },
  {
    icon: '🧠',
    title: 'عقوبة التركيز!',
    task: 'احفظ تعريفاً واحداً من مادتك في دقيقة واحدة',
    color: '#6c63ff',
  },
  {
    icon: '🌊',
    title: 'عقوبة الخروج!',
    task: 'قوم اغسل وجهك بالماء البارد وارجع منتعشاً',
    color: '#22d3ee',
  },
  {
    icon: '⏰',
    title: 'عقوبة التعهد!',
    task: 'قل بصوت عالٍ: "راح أذاكر الآن لمدة ٢٥ دقيقة بدون انقطاع"',
    color: '#f59e0b',
  },
];

// ---- حالة النظام ----
const punishState = {
  consecutiveWasteMin: 0,   // دقائق التسخيت المتتالية
  lastActivityWasWaste: false,
  popupOpen: false,
  pendingCommit: null,      // الـ callback للتسجيل بعد العقوبة
  countdown: 30,
  tickId: null,
};

// ---- Hook على confirmGuilt الأصلي ----
// ننتظر تحميل DOM ثم نعترض confirmGuilt
document.addEventListener('DOMContentLoaded', () => {
  // نحتفظ بالنسخة الأصلية
  const _originalConfirmGuilt = window.confirmGuilt || confirmGuilt;

  // نستبدلها بنسخة تمر عبر نظام العقوبات
  window.confirmGuilt = function() {
    // احسب المدة المسجّلة
    const dur = (typeof guilt !== 'undefined') ? guilt.pendingDur : state.intervalMinutes;

    // حدّث عداد التسخيت المتتالي
    punishState.consecutiveWasteMin += dur;
    punishState.lastActivityWasWaste = true;

    // تحقق هل وصلنا العتبة؟
    if (punishState.consecutiveWasteMin >= PUNISHMENT_THRESHOLD_MIN) {
      // أوقف العداد مؤقتاً — سيُعاد حسابه بعد العقوبة
      punishState.consecutiveWasteMin = 0;
      // احفظ الـ callback الأصلي
      punishState.pendingCommit = _originalConfirmGuilt;
      // أغلق بوب آب الضمير أولاً
      document.getElementById('guiltPopup').classList.remove('active');
      clearInterval(guilt.tickId);
      guilt.tickId = null;
      // أظهر بوب آب العقوبة
      setTimeout(() => showPunishmentPopup(), 200);
    } else {
      // مدة التسخيت أقل من العتبة — نفّذ الأصلي مباشرة
      _originalConfirmGuilt();
    }
  };

  // Hook على _commitActivity لإعادة تعيين العداد لما يختار غير تسخيت
  const _originalCommitActivity = window._commitActivity;
  window._commitActivity = function(activityName, durationMinutes) {
    if (activityName !== 'تسخيت') {
      punishState.consecutiveWasteMin = 0;
      punishState.lastActivityWasWaste = false;
    }
    _originalCommitActivity(activityName, durationMinutes);
  };

  // ربط أزرار بوب آب العقوبة
  document.getElementById('punishDoneBtn').addEventListener('click', completePunishment);
  document.getElementById('punishCheatBtn').addEventListener('click', cheatPunishment);

  document.addEventListener('keydown', e => {
    if (!punishState.popupOpen) return;
    if (e.key === 'Enter') { e.preventDefault(); completePunishment(); }
    if (e.key === 'Escape') { e.preventDefault(); cheatPunishment(); }
  });
});

// ---- فتح بوب آب العقوبة ----
function showPunishmentPopup() {
  const p = PUNISHMENTS[Math.floor(Math.random() * PUNISHMENTS.length)];

  document.getElementById('punishIcon').textContent    = p.icon;
  document.getElementById('punishTitle').textContent   = p.title;
  document.getElementById('punishTask').textContent    = p.task;
  document.getElementById('punishStreak').textContent  =
    `سجّلت ${PUNISHMENT_THRESHOLD_MIN}+ دقيقة تسخيت متتالية! 🚨`;

  // لون ديناميكي
  document.getElementById('punishPopup').style.setProperty('--p-color', p.color);

  // عداد تنازلي
  punishState.countdown = 30;
  document.getElementById('punishCountdown').textContent = 30;
  updatePunishArc(30, 30);

  punishState.popupOpen = true;
  state.activePopup = 'punishment';

  document.getElementById('overlay').classList.add('active');
  document.getElementById('punishPopup').classList.add('active');

  playPunishSound();
  startPunishCountdown();
}

// ---- عداد العقوبة ----
function startPunishCountdown() {
  clearInterval(punishState.tickId);
  punishState.tickId = setInterval(() => {
    punishState.countdown--;
    document.getElementById('punishCountdown').textContent = punishState.countdown;
    updatePunishArc(punishState.countdown, 30);

    if (punishState.countdown <= 5) playPunishTick();

    if (punishState.countdown <= 0) {
      clearInterval(punishState.tickId);
      // انتهى الوقت — يعني نفّذ العقوبة قسراً 😈
      completePunishment();
    }
  }, 1000);
}

function updatePunishArc(remaining, total) {
  const circ = 201.1; // 2π×32
  const offset = ((total - remaining) / total) * circ;
  const arc = document.getElementById('punishArc');
  if (arc) arc.setAttribute('stroke-dashoffset', offset);
}

// ---- إتمام العقوبة ----
function completePunishment() {
  clearInterval(punishState.tickId);
  punishState.tickId = null;
  punishState.popupOpen = false;
  state.activePopup = null;

  document.getElementById('punishPopup').classList.remove('active');

  // الآن سجّل التسخيت وأكمل الطابور
  if (punishState.pendingCommit) {
    punishState.pendingCommit();
    punishState.pendingCommit = null;
  }
}

// ---- الغش (يضاف وقت إضافي للعداد كعقوبة على الغش 😈) ----
function cheatPunishment() {
  // لا يُغلق — بس يهزه ويضيف ١٠ ثواني
  const popup = document.getElementById('punishPopup');
  popup.classList.add('punish-shake');
  setTimeout(() => popup.classList.remove('punish-shake'), 600);
  punishState.countdown = Math.min(punishState.countdown + 10, 60);
  document.getElementById('punishCountdown').textContent = punishState.countdown;

  // رسالة تحذير مؤقتة
  const warn = document.getElementById('punishWarn');
  warn.textContent = '😈 ما تنفع الغشّة! +١٠ ثواني عقاباً على محاولتك!';
  warn.style.opacity = '1';
  setTimeout(() => { warn.style.opacity = '0'; }, 2500);
}

// ---- الأصوات ----
function playPunishSound() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    // صوت حكم مُهيب
    [220, 185, 165].forEach((f, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 2, now + i * 0.15);
      osc.frequency.exponentialRampToValueAtTime(f, now + i * 0.15 + 0.3);
      gain.gain.setValueAtTime(0.12, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.35);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.4);
    });
  } catch(e) {}
}

function playPunishTick() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.start(now); osc.stop(now + 0.08);
  } catch(e) {}
}
