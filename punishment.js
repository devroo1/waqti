// ==========================================
// 👑 نظام حاكم العقوبات — punishment.js
// ==========================================

const PUNISHMENT_THRESHOLD_MIN = 15;

const PUNISHMENTS = [
  { icon:'🏃', title:'عقوبة رياضية!',    task:'قوم اعمل ٢٠ قرفصاء الحين قبل ما تكمل',                         color:'#4ade80' },
  { icon:'💧', title:'عقوبة الترطيب!',   task:'قوم اشرب كأس ماء كامل وارجع',                                  color:'#60a5fa' },
  { icon:'📖', title:'عقوبة القراءة!',   task:'اقرأ صفحة واحدة من أي كتاب دراسي قبل ما تكمل',                 color:'#a78bfa' },
  { icon:'✍️', title:'عقوبة الكتابة!',   task:'اكتب جملة واحدة عن شي تعلمته اليوم قبل ما تكمل',               color:'#f59e0b' },
  { icon:'🧘', title:'عقوبة التأمل!',    task:'خذ ٥ أنفاس عميقة وببطء... الحين، قبل ما تمسّ الجوال',          color:'#22d3ee' },
  { icon:'📝', title:'عقوبة التخطيط!',   task:'اكتب ٣ أشياء تبي تذاكرها في الساعة الجاية',                    color:'#f97316' },
  { icon:'💪', title:'عقوبة العضلات!',   task:'اعمل ١٥ ضغطة أرضية الحين — ما في تفاوض',                       color:'#f43f5e' },
  { icon:'🧠', title:'عقوبة التركيز!',   task:'احفظ تعريفاً واحداً من مادتك في دقيقة واحدة',                   color:'#6c63ff' },
  { icon:'🌊', title:'عقوبة الانتعاش!',  task:'قوم اغسل وجهك بالماء البارد وارجع منتعشاً',                     color:'#22d3ee' },
  { icon:'⏰', title:'عقوبة التعهد!',    task:'قل بصوت عالٍ: "راح أذاكر الآن لمدة ٢٥ دقيقة بدون انقطاع"',   color:'#f59e0b' },
  { icon:'🚶', title:'عقوبة الحركة!',    task:'قم وامشِ ١٠ خطوات، ثم ارجع واجلس وافتح كتابك',                 color:'#4ade80' },
  { icon:'🔇', title:'عقوبة الصمت!',     task:'أغلق كل التطبيقات المفتوحة خلال ١٠ ثواني الآن',                 color:'#a78bfa' },
  { icon:'🥶', title:'عقوبة الصدمة!',       task:'اغسل وجهك بماء بارد لمدة ٢٠ ثانية ورجع فوراً',                           color:'#38bdf8' },
  { icon:'🏋️', title:'عقوبة الوحش!',        task:'اعمل ٣٠ قرفصاء + ١٥ ضغطة بدون توقف',                                    color:'#ef4444' },
  { icon:'📵', title:'عقوبة الانفصال!',      task:'حط الجوال بعيد عنك لمدة ٣٠ دقيقة كاملة',                                 color:'#8b5cf6' },
  { icon:'🧠', title:'عقوبة الدماغ!',        task:'احفظ فقرة أو تعريف كامل خلال ٥ دقائق',                                   color:'#6366f1' },
  { icon:'⚡', title:'عقوبة السرعة!',        task:'رتب مكتبك أو مكان دراستك خلال دقيقتين فقط',                              color:'#f59e0b' },
  { icon:'🚫', title:'عقوبة الحظر!',         task:'امنع نفسك من أي سوشال ميديا لمدة ساعة كاملة',                            color:'#f43f5e' },
  { icon:'📚', title:'عقوبة الدراسة!',       task:'ذاكر ١٠ دقائق إضافية فوق وقتك الأساسي بدون نقاش',                        color:'#22c55e' },
  { icon:'💀', title:'عقوبة الجدية!',        task:'اكتب ٥ أسباب ليش لازم تنجح وتعلّقها قدامك',                              color:'#78716c' },
  { icon:'🏃‍♂️', title:'عقوبة الطاقة!',      task:'اركض بمكانك لمدة دقيقة ونصف بدون توقف',                                  color:'#14b8a6' },
  { icon:'🔕', title:'عقوبة التركيز القاسي!', task:'فعّل وضع الطيران وابدأ جلسة تركيز ٢٥ دقيقة حالاً',                      color:'#eab308' },
  { icon:'🪑', title:'عقوبة الكسل!',         task:'ممنوع تتكئ على الكرسي لمدة ١٥ دقيقة دراسة',                              color:'#f97316' },
  { icon:'📝', title:'عقوبة التلخيص!',       task:'لخّص آخر شي درسته في ٣ أسطر بيدك',                                      color:'#0ea5e9' },
  { icon:'🔥', title:'عقوبة التحدي!',        task:'إذا ما بدأت دراسة خلال دقيقة: اعمل ٢٠ burpees',                          color:'#dc2626' },
  { icon:'👀', title:'عقوبة الانتباه!',      task:'اقرأ بصوت مرتفع لمدة ٥ دقائق بدون ما تشتت',                              color:'#a855f7' },
  { icon:'⛔', title:'عقوبة التسويف!',       task:'احذف تطبيق واحد يضيع وقتك لمدة ٢٤ ساعة',                                color:'#ef4444' },
];

const punishState = {
  consecutiveWasteMin: 0,
  popupOpen: false,
  pendingCommit: null,
  countdown: 60,
  tickId: null,
};

document.addEventListener('DOMContentLoaded', () => {

  // ---- اعترض confirmGuilt ----
  const _originalConfirmGuilt = window.confirmGuilt;

  window.confirmGuilt = function() {
    const dur = (typeof guilt !== 'undefined') ? guilt.pendingDur : state.intervalMinutes;
    punishState.consecutiveWasteMin += dur;

    if (punishState.consecutiveWasteMin >= PUNISHMENT_THRESHOLD_MIN) {
      punishState.consecutiveWasteMin = 0;
      punishState.pendingCommit = _originalConfirmGuilt;

      // أغلق بوب آب الضمير
      document.getElementById('guiltPopup').classList.remove('active');
      if (typeof guilt !== 'undefined') {
        clearInterval(guilt.tickId);
        guilt.tickId = null;
      }

      setTimeout(() => showPunishmentPopup(), 250);
    } else {
      _originalConfirmGuilt();
    }
  };

  // ---- اعترض _commitActivity لإعادة العداد عند اختيار غير تسخيت ----
  const _originalCommitActivity = window._commitActivity;
  window._commitActivity = function(activityName, durationMinutes) {
    if (activityName !== 'تسخيت') {
      punishState.consecutiveWasteMin = 0;
    }
    _originalCommitActivity(activityName, durationMinutes);
  };

  // ---- ربط الأزرار ----
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

  document.getElementById('punishIcon').textContent  = p.icon;
  document.getElementById('punishTitle').textContent = p.title;
  document.getElementById('punishTask').textContent  = p.task;
  document.getElementById('punishWarn').textContent  = '';

  document.getElementById('punishPopup').style.setProperty('--p-color', p.color);

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

// ---- عداد تنازلي ----
function startPunishCountdown() {
  clearInterval(punishState.tickId);
  punishState.tickId = setInterval(() => {
    punishState.countdown--;
    document.getElementById('punishCountdown').textContent = punishState.countdown;
    updatePunishArc(punishState.countdown, 30);

    if (punishState.countdown <= 5) playPunishTick();

    if (punishState.countdown <= 0) {
      clearInterval(punishState.tickId);
      completePunishment();
    }
  }, 1000);
}

function updatePunishArc(remaining, total) {
  const circ   = 201.1;
  const offset = ((total - remaining) / total) * circ;
  const arc    = document.getElementById('punishArc');
  if (arc) arc.setAttribute('stroke-dashoffset', offset);
}

// ---- إتمام العقوبة ----
function completePunishment() {
  clearInterval(punishState.tickId);
  punishState.tickId = null;
  punishState.popupOpen = false;
  state.activePopup = null;

  document.getElementById('punishPopup').classList.remove('active');

  if (punishState.pendingCommit) {
    punishState.pendingCommit();
    punishState.pendingCommit = null;
  }
}

// ---- الغش → هزة + وقت إضافي ----
function cheatPunishment() {
  const popup = document.getElementById('punishPopup');
  popup.classList.remove('punish-shake');
  void popup.offsetWidth; // إعادة تشغيل الأنيميشن
  popup.classList.add('punish-shake');
  setTimeout(() => popup.classList.remove('punish-shake'), 600);

  punishState.countdown = Math.min(punishState.countdown + 10, 99);
  document.getElementById('punishCountdown').textContent = punishState.countdown;

  const warn = document.getElementById('punishWarn');
  warn.textContent = '😈 محاولة فاشلة! +١٠ ثواني عقاباً على الغشّة!';
  setTimeout(() => { warn.textContent = ''; }, 2800);
}

// ---- الأصوات ----
function playPunishSound() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    [440, 370, 330].forEach((f, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 2, now + i * 0.18);
      osc.frequency.exponentialRampToValueAtTime(f, now + i * 0.18 + 0.28);
      gain.gain.setValueAtTime(0.11, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.33);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.38);
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
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.start(now); osc.stop(now + 0.08);
  } catch(e) {}
}
