// ╔══════════════════════════════════════════════════════════════╗
// ║  app.js — Daxili Nəzarət Şöbəsi Qiymətləndirmə sistemi      ║
// ╚══════════════════════════════════════════════════════════════╝

import { db, auth } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc,
  updateDoc, deleteDoc, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';


// ─── SABİT MƏLUMATLAR ────────────────────────────────────────────
const ROLE_LABEL = {
  mudir:    'Şöbə müdiri',
  muavin:   'Müdir müavini',
  sektor:   'Sektor müdiri',
  bash:     'Baş məsləhətçi',
  boyuk:    'Böyük məsləhətçi',
  aparici:  'Aparıcı məsləhətçi',
  meslehchi:'Məsləhətçi',
  iscii:    'Digər icraçı'
};
const ROLE_BADGE = {
  mudir:'b-mudir', muavin:'b-muavin', sektor:'b-sektor',
  bash:'b-iscii', boyuk:'b-iscii', aparici:'b-iscii',
  meslehchi:'b-iscii', iscii:'b-iscii'
};
const SECTOR_LABEL = {
  rehberlik: 'Rəhbərlik',
  xidmeti:   'Xidməti araşdırma sektoru',
  riskler:   'Risklərin idarə olunması sektoru',
  audit:     'Daxili audit sektoru'
};
const SECTOR_ORDER = ['rehberlik','xidmeti','riskler','audit'];

// Əmsal sistemi: yekun bal = Σ(orta_bal_i × əmsal_i) / Σ(əmsal_i)
const WEIGHTS = {
  mudir: 3, muavin: 2, sektor: 1.5,
  bash: 1, boyuk: 1, aparici: 1, meslehchi: 1, iscii: 1
};

const CRITERIA_UMUMI = [
  {id:'c1', name:'İş yükü və tapşırıqların icra səviyyəsi',
   desc:'Verilən tapşırıqların vaxtında, tam və düzgün şəkildə yerinə yetirilməsi'},
  {id:'c2', name:'İşin keyfiyyəti və peşəkarlıq',
   desc:'Çıxarılan sənəd, hesabat və ya nəticənin keyfiyyəti; sahə üzrə peşəkarlıq göstəriciləri'},
  {id:'c3', name:'Məsuliyyətlilik və icra intizamı',
   desc:'Öhdəliklərə sadiqlik, müstəqil iş aparma, son tarixlərə riayət etmə'},
  {id:'c4', name:'Təhlil, problem həlli və təşəbbüskarlıq',
   desc:'Problemlərə yaradıcı yanaşma, müstəqil qərar qəbulu, yeni ideyalar irəli sürə bilmə'},
  {id:'c5', name:'Komandada işləmə və kommunikasiya',
   desc:'Həmkarlarla əməkdaşlıq, məlumat paylaşımı, konstruktiv ünsiyyət qurmaq bacarığı'}
];
const CRITERIA_MUAVIN = [
  {id:'m1', name:'Kurasiyasında olan sektorun koordinasiyası',
   desc:'Şöbə daxilində kurasiyadakı sektorun işlərinin koordinasiyası, sektorlararası əlaqələndirmə'},
  {id:'m2', name:'Rəhbərlik üçün qərar variantları hazırlamaq',
   desc:'Mürəkkəb məsələlər üzrə analitik yanaşma, müdirə əsaslandırılmış qərar variantları'},
  {id:'m3', name:'Rəhbəri əvəz etmə qabiliyyəti',
   desc:'Rəhbərin olmadığı hallarda şöbə fəaliyyətini idarə etmək, qərar qəbul etmək'},
  {id:'m4', name:'Riskləri əvvəlcədən görmək',
   desc:'Potensial problemləri vaxtında müəyyən edib rəhbərliyə çatdırmaq'},
  {id:'m5', name:'Əməkdaşların potensialından istifadə',
   desc:'Komanda üzvlərinin güclü tərəflərini tanımaq, tapşırıqları buna uyğun paylamaq'},
  {id:'m6', name:'Problemli əməkdaşlarla işləmək',
   desc:'Aşağı performanslı əməkdaşlara münasibətdə konstruktiv yanaşma'}
];
const CRITERIA_SEKTOR = [
  {id:'s1', name:'İş bölgüsü və gündəlik koordinasiya',
   desc:'Sektor əməkdaşları arasında tapşırıqların düzgün bölüşdürülməsi'},
  {id:'s2', name:'Nəzarət və nəticənin formalaşdırılması',
   desc:'Tapşırıqların icrasına nəzarət, sənədlərin ilkin yoxlanılması'},
  {id:'s3', name:'Əməkdaşların yönləndirilməsi',
   desc:'Zəif və ya təcrübəsiz əməkdaşlara izah, dəstək və istiqamət vermə'},
  {id:'s4', name:'Sektor üzrə icra intizamı',
   desc:'Sektora daxil olan tapşırıqların vaxtında və keyfiyyətli icrası'},
  {id:'s5', name:'Problem və riskləri vaxtında bildirmə',
   desc:'Gecikmə və ya keyfiyyət problemlərini rəhbərliyə vaxtında çatdırma'}
];

function getCriteriaFor(role) {
  const base = CRITERIA_UMUMI.map(c => ({...c, group:'Ümumi meyarlar'}));
  if (role === 'muavin')
    return [...base, ...CRITERIA_MUAVIN.map(c => ({...c, group:'Rəhbərlik meyarları — müdir müavini'}))];
  if (role === 'sektor')
    return [...base, ...CRITERIA_SEKTOR.map(c => ({...c, group:'Rəhbərlik meyarları — sektor müdiri'}))];
  return base;
}


// ─── STATE ───────────────────────────────────────────────────────
let currentVoter  = null;  // { id, name, role, sector }
let currentToken  = null;  // token string from URL
let workers       = [];    // [] of { id, name, role, sector }
let activeCritTab = 'umumi';


// ─── DOM HELPERS ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = $('page-' + pageId);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

function showLoading(msg = 'Yüklənir...') {
  $('loading-msg').textContent = msg;
  showPage('loading');
}

function showError(msg) {
  $('error-msg').textContent = msg;
  showPage('error');
}

function av(w) { return (w.name || '??').slice(0, 2); }
function canBeRated(w) { return w.role !== 'mudir'; }

function genToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}


// ─── BAŞLANĞIC ───────────────────────────────────────────────────
async function init() {
  setupAdminBtn();
  setupAdminTabs();

  const params = new URLSearchParams(location.search);
  const token  = params.get('token');

  if (token) {
    await handleVoterToken(token);
  } else {
    showPage('landing');
  }

  onAuthStateChanged(auth, user => {
    if (user && $('page-admin').classList.contains('active')) {
      loadAdminDashboard();
    }
  });
}


// ─── VOTER FLOW ──────────────────────────────────────────────────
async function handleVoterToken(token) {
  showLoading('Token yoxlanılır...');
  try {
    const tokenSnap = await getDoc(doc(db, 'tokens', token));

    if (!tokenSnap.exists()) {
      showError('Bu link etibarsızdır. Zəhmət olmasa administratorla əlaqə saxlayın.');
      return;
    }

    const tData = tokenSnap.data();
    if (tData.used) {
      showError('Bu link artıq istifadə edilib. Hər link yalnız bir dəfə istifadə oluna bilər.');
      return;
    }

    // Load voter
    const workerSnap = await getDoc(doc(db, 'workers', tData.workerId));
    if (!workerSnap.exists()) {
      showError('İşçi məlumatı tapılmadı. Administratorla əlaqə saxlayın.');
      return;
    }

    currentVoter = { id: workerSnap.id, ...workerSnap.data() };
    currentToken = token;

    // Load all workers
    await loadWorkers();

    renderVoteForm();
    showPage('vote');

  } catch (err) {
    console.error(err);
    showError('Bağlantı xətası: ' + err.message);
  }
}

async function loadWorkers() {
  const snap = await getDocs(collection(db, 'workers'));
  workers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function renderVoteForm() {
  // Voter info bar
  $('v-avatar').textContent = av(currentVoter);
  $('v-name').textContent   = currentVoter.name;
  const rb = $('v-role');
  rb.textContent = ROLE_LABEL[currentVoter.role] || currentVoter.role;
  rb.className   = 'badge ' + (ROLE_BADGE[currentVoter.role] || 'b-iscii');
  $('v-sector').textContent = SECTOR_LABEL[currentVoter.sector] || '';

  // Workers to rate (exclude self and director from rated list — but director IS included here
  // because he can be a rater. We already store director with canBeRated=false in workers,
  // so we just filter by canBeRated AND not-self)
  const toRate = workers.filter(w => canBeRated(w) && w.id !== currentVoter.id);

  if (toRate.length === 0) {
    $('vote-form').innerHTML = '<p style="color:#6b7280;font-size:13px;padding:1rem 0">Qiymətləndiriləcək əməkdaş yoxdur.</p>';
    return;
  }

  let html = '';
  SECTOR_ORDER.forEach(sec => {
    const sw = toRate.filter(w => w.sector === sec);
    if (!sw.length) return;
    sw.forEach(w => {
      const crits   = getCriteriaFor(w.role);
      let lastGroup = '';
      html += `<div class="card">
        <div class="card-worker-header">
          <div class="avatar">${av(w)}</div>
          <div>
            <span style="font-weight:600">${w.name}</span>
            <span class="badge ${ROLE_BADGE[w.role]||'b-iscii'}" style="margin-left:6px">${ROLE_LABEL[w.role]||w.role}</span>
            <span style="font-size:11px;color:#9ca3af;margin-left:6px">${SECTOR_LABEL[w.sector]||''}</span>
          </div>
        </div>`;
      crits.forEach(c => {
        if (c.group !== lastGroup) {
          html += `<div class="crit-group-label">${c.group}</div>`;
          lastGroup = c.group;
        }
        html += `<div class="crit-item">
          <div style="font-size:13px;font-weight:500;margin-bottom:2px">${c.name}</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:8px;line-height:1.5">${c.desc}</div>
          <div class="stars-row" data-worker="${w.id}" data-crit="${c.id}" data-val="0">
            ${[1,2,3,4,5,6,7,8,9,10].map(i =>
              `<span class="star" data-val="${i}">★</span>`
            ).join('')}
            <span class="star-label">—</span>
          </div>
        </div>`;
      });
      html += '</div>';
    });
  });

  $('vote-form').innerHTML = html;

  // Star click listeners
  document.querySelectorAll('.stars-row').forEach(row => {
    row.querySelectorAll('.star').forEach(star => {
      star.addEventListener('click', () => {
        const val = +star.dataset.val;
        row.dataset.val = val;
        row.querySelectorAll('.star').forEach(s =>
          s.classList.toggle('on', +s.dataset.val <= val)
        );
        row.querySelector('.star-label').textContent = val + '/10';
      });
    });
  });
}

async function submitVotes() {
  const toRate = workers.filter(w => canBeRated(w) && w.id !== currentVoter.id);

  // Validate all criteria rated
  let allSet = true;
  toRate.forEach(w => {
    getCriteriaFor(w.role).forEach(c => {
      const row = document.querySelector(`.stars-row[data-worker="${w.id}"][data-crit="${c.id}"]`);
      if (!row || +row.dataset.val === 0) allSet = false;
    });
  });

  if (!allSet) {
    alert('Zəhmət olmasa bütün meyarlar üzrə qiymət verin.');
    return;
  }

  const btn = $('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Göndərilir...';

  try {
    const batch = writeBatch(db);

    // 1) Mark token as used (atomic with votes)
    batch.update(doc(db, 'tokens', currentToken), {
      used:   true,
      usedAt: serverTimestamp()
    });

    // 2) Write votes — only voterRole saved (konfidensiallıq)
    toRate.forEach(w => {
      const scores = {};
      getCriteriaFor(w.role).forEach(c => {
        const row = document.querySelector(`.stars-row[data-worker="${w.id}"][data-crit="${c.id}"]`);
        scores[c.id] = +row.dataset.val;
      });

      const subRef = doc(collection(db, 'votes', w.id, 'submissions'));
      batch.set(subRef, {
        voterRole: currentVoter.role,   // yalnız rol saxlanır, ad yox
        scores,
        timestamp: serverTimestamp()
      });
    });

    await batch.commit();

    currentToken = null;
    currentVoter = null;
    showPage('done');

  } catch (err) {
    console.error(err);
    alert('Xəta baş verdi: ' + err.message);
    btn.disabled    = false;
    btn.textContent = 'Göndər →';
  }
}


// ─── ADMIN AUTH ──────────────────────────────────────────────────
function setupAdminBtn() {
  $('admin-btn').addEventListener('click', () => {
    if (auth.currentUser) {
      goAdminTab('workers');
      showPage('admin');
    } else {
      showPage('admin-login');
    }
  });

  $('login-btn').addEventListener('click', doLogin);
  $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('logout-btn').addEventListener('click', () => signOut(auth).then(() => showPage('landing')));
}

async function doLogin() {
  const email = $('login-email').value.trim();
  const pass  = $('login-pass').value;
  const errEl = $('login-err');
  errEl.style.display = 'none';

  const btn = $('login-btn');
  btn.disabled    = true;
  btn.textContent = 'Yüklənir...';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    await loadAdminDashboard();
    showPage('admin');
  } catch (err) {
    errEl.textContent   = 'E-poçt və ya şifrə yanlışdır';
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Daxil ol →';
  }
}


// ─── ADMIN PANEL ─────────────────────────────────────────────────
function setupAdminTabs() {
  // Main tabs
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => goAdminTab(btn.dataset.tab));
  });

  // Criteria sub-tabs
  document.querySelectorAll('[data-ctab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCritTab = btn.dataset.ctab;
      document.querySelectorAll('[data-ctab]').forEach(b => b.classList.toggle('active', b === btn));
      renderCriteria();
    });
  });

  // Buttons
  $('add-worker-btn').addEventListener('click',      addWorker);
  $('gen-tokens-btn').addEventListener('click',      generateTokens);
  $('refresh-tokens-btn').addEventListener('click',  loadTokens);
  $('refresh-results-btn').addEventListener('click', loadResults);
  $('clear-votes-btn').addEventListener('click',     clearVotes);
  $('submit-btn').addEventListener('click',          submitVotes);
}

function goAdminTab(t) {
  ['workers','tokens','criteria','weights','results'].forEach(x => {
    const el = $('atab-' + x);
    if (el) el.style.display = x === t ? 'block' : 'none';
    const btn = document.querySelector(`[data-tab="${x}"]`);
    if (btn) btn.classList.toggle('active', x === t);
  });

  if (t === 'workers')   renderWorkers();
  if (t === 'tokens')    loadTokens();
  if (t === 'criteria')  renderCriteria();
  if (t === 'weights')   renderWeights();
  if (t === 'results')   loadResults();
}

async function loadAdminDashboard() {
  await loadWorkers();
  goAdminTab('workers');
}

// ── Workers ──────────────────────────────────────────────────────
function renderWorkers() {
  const el = $('worker-list');
  if (!workers.length) {
    el.innerHTML = '<p style="color:#6b7280;font-size:13px;padding:1rem 0">İşçi siyahısı boşdur. Yuxarıdan əlavə edin.</p>';
    return;
  }
  let html = '';
  SECTOR_ORDER.forEach(sec => {
    const sw = workers.filter(w => w.sector === sec);
    if (!sw.length) return;
    html += `<div class="sec-hdr">${SECTOR_LABEL[sec]}</div>`;
    sw.forEach(w => {
      html += `<div class="worker-row">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar">${av(w)}</div>
          <div>
            <span style="font-weight:500">${w.name}</span>
            <span class="badge ${ROLE_BADGE[w.role]||'b-iscii'}" style="margin-left:6px">${ROLE_LABEL[w.role]||w.role}</span>
            ${!canBeRated(w) ? '<span class="badge b-red" style="margin-left:4px">qiymətləndirilmir</span>' : ''}
          </div>
        </div>
        <button class="btn btn-sm btn-danger" data-delete-worker="${w.id}">Sil</button>
      </div>`;
    });
  });
  el.innerHTML = html;

  el.querySelectorAll('[data-delete-worker]').forEach(btn => {
    btn.addEventListener('click', () => removeWorker(btn.dataset.deleteWorker));
  });
}

async function addWorker() {
  const name   = $('new-name').value.trim();
  const role   = $('new-role').value;
  const sector = $('new-sector').value;
  if (!name) { alert('Ad boş ola bilməz'); return; }

  const btn = $('add-worker-btn');
  btn.disabled    = true;
  btn.textContent = 'Əlavə edilir...';

  try {
    const ref = doc(collection(db, 'workers'));
    await setDoc(ref, { name, role, sector });
    $('new-name').value = '';
    await loadWorkers();
    renderWorkers();
  } catch (err) {
    alert('Xəta: ' + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = '+ Əlavə et';
  }
}

async function removeWorker(id) {
  if (!confirm('Bu işçini silmək istəyirsiniz?')) return;
  try {
    await deleteDoc(doc(db, 'workers', id));
    await loadWorkers();
    renderWorkers();
  } catch (err) {
    alert('Xəta: ' + err.message);
  }
}

// ── Tokens ───────────────────────────────────────────────────────
async function generateTokens() {
  if (!confirm('Hər işçi üçün yeni tokenlər yaradılacaq. İstifadə edilməmiş köhnə tokenlər silinəcək. Davam edilsin?')) return;

  const btn = $('gen-tokens-btn');
  btn.disabled    = true;
  btn.textContent = 'Yaradılır...';

  try {
    await loadWorkers();

    // Load existing tokens
    const existingSnap = await getDocs(collection(db, 'tokens'));
    const batch1 = writeBatch(db);
    existingSnap.forEach(d => {
      if (!d.data().used) batch1.delete(d.ref);
    });
    await batch1.commit();

    // Create new tokens for each worker
    const batch2 = writeBatch(db);
    workers.forEach(w => {
      const token   = genToken();
      const tokenRef = doc(db, 'tokens', token);
      batch2.set(tokenRef, {
        workerId:   w.id,
        workerName: w.name,
        workerRole: w.role,
        used:       false,
        createdAt:  serverTimestamp()
      });
    });
    await batch2.commit();

    await loadTokens();
  } catch (err) {
    alert('Xəta: ' + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = '🔗 Tokenlər yarat / yenilə';
  }
}

async function loadTokens() {
  const el = $('token-list');
  el.innerHTML = '<p style="color:#6b7280;font-size:13px">Yüklənir...</p>';

  try {
    const snap = await getDocs(collection(db, 'tokens'));
    if (snap.empty) {
      el.innerHTML = '<div class="alert alert-warn">Hələ token yoxdur. Yuxarıdakı düymə ilə yaradın.</div>';
      return;
    }

    // Group tokens by sector (using workers list)
    const tokensByWorker = {};
    snap.forEach(d => {
      tokensByWorker[d.data().workerId] = { token: d.id, ...d.data() };
    });

    const baseUrl = location.origin + location.pathname.replace('index.html','');
    let html = '';

    SECTOR_ORDER.forEach(sec => {
      const sw = workers.filter(w => w.sector === sec);
      if (!sw.length) return;
      html += `<div class="sec-hdr">${SECTOR_LABEL[sec]}</div>`;
      sw.forEach(w => {
        const t = tokensByWorker[w.id];
        if (!t) {
          html += `<div class="card" style="padding:10px 14px;display:flex;align-items:center;gap:10px">
            <div class="avatar">${av(w)}</div>
            <span style="font-weight:500">${w.name}</span>
            <span class="badge b-red">token yoxdur</span>
          </div>`;
          return;
        }
        const link = baseUrl + '?token=' + t.token;
        html += `<div class="card" style="padding:12px 14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <div class="avatar">${av(w)}</div>
              <span style="font-weight:500">${w.name}</span>
              <span class="badge ${ROLE_BADGE[w.role]||'b-iscii'}">${ROLE_LABEL[w.role]||w.role}</span>
              <span class="badge ${t.used ? 'b-red' : 'b-green'}">${t.used ? '✓ istifadə edilib' : '○ gözləyir'}</span>
            </div>
          </div>
          ${!t.used ? `
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="token-link" id="tl-${w.id}">${link}</span>
            <button class="btn btn-sm" data-copy="${link}" data-copy-id="tl-${w.id}">Kopyala</button>
            <span class="copy-ok" id="ok-${w.id}">✓ kopyalandı</span>
          </div>` : ''}
        </div>`;
      });
    });

    el.innerHTML = html;

    // Copy listeners
    el.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.copy).then(() => {
          const ok = document.getElementById('ok-' + btn.dataset.copyId.replace('tl-',''));
          if (ok) { ok.style.display = 'inline'; setTimeout(() => ok.style.display='none', 2000); }
        }).catch(() => prompt('Linki kopyalayın:', btn.dataset.copy));
      });
    });

  } catch (err) {
    el.innerHTML = `<div class="alert alert-err">Xəta: ${err.message}</div>`;
  }
}

// ── Criteria ──────────────────────────────────────────────────────
function renderCriteria() {
  const el   = $('criteria-content');
  const list = activeCritTab === 'umumi' ? CRITERIA_UMUMI :
               activeCritTab === 'muavin' ? CRITERIA_MUAVIN : CRITERIA_SEKTOR;
  const desc = {
    umumi:  'Bütün işçilərə tətbiq olunur',
    muavin: 'Yalnız müdir müavinlərinə tətbiq olunur',
    sektor: 'Yalnız sektor müdirlərinə tətbiq olunur'
  }[activeCritTab];

  el.innerHTML = `<p style="font-size:12px;color:#6b7280;margin-bottom:1rem">${desc}</p>`
    + list.map((c, i) => `
      <div style="border:1px solid #e5e5e5;border-radius:8px;padding:11px;margin-bottom:8px">
        <div style="display:flex;gap:10px">
          <span style="min-width:22px;height:22px;border-radius:50%;background:#EEEDFE;color:#3C3489;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</span>
          <div>
            <div style="font-size:13px;font-weight:500;margin-bottom:2px">${c.name}</div>
            <div style="font-size:12px;color:#6b7280;line-height:1.5">${c.desc}</div>
          </div>
        </div>
      </div>`).join('');
}

// ── Weights ───────────────────────────────────────────────────────
function renderWeights() {
  const el  = $('weight-rows');
  const max = Math.max(...Object.values(WEIGHTS));
  el.innerHTML = Object.entries(WEIGHTS).map(([role, w]) => `
    <div style="display:flex;align-items:center;gap:12px">
      <span style="min-width:160px"><span class="badge ${ROLE_BADGE[role]||'b-iscii'}">${ROLE_LABEL[role]||role}</span></span>
      <div class="progress-wrap" style="flex:1">
        <div class="progress-fill" style="width:${(w/max)*100}%"></div>
      </div>
      <span style="font-size:12px;font-weight:600;min-width:60px;text-align:right;color:#374151">× ${w}</span>
    </div>`).join('');
}

// ── Results ───────────────────────────────────────────────────────
async function loadResults() {
  const listEl     = $('results-list');
  const statsEl    = $('res-stats');
  const progressEl = $('results-progress');

  listEl.innerHTML  = '<p style="color:#6b7280;font-size:13px">Hesablanır...</p>';
  statsEl.innerHTML = '';

  try {
    await loadWorkers();

    // Count voters (used tokens)
    const tokensSnap   = await getDocs(collection(db, 'tokens'));
    let usedCount = 0, totalTokens = 0;
    tokensSnap.forEach(d => {
      totalTokens++;
      if (d.data().used) usedCount++;
    });
    progressEl.textContent = `${usedCount} / ${totalTokens} nəfər qiymətləndirib`;

    // Calculate scores per worker
    const rateable = workers.filter(w => canBeRated(w));
    const allResults = [];

    for (const w of rateable) {
      const subsSnap = await getDocs(collection(db, 'votes', w.id, 'submissions'));
      let weightedSum = 0, weightTotal = 0;
      const count = subsSnap.size;

      subsSnap.forEach(sub => {
        const { voterRole, scores } = sub.data();
        const weight = WEIGHTS[voterRole] ?? 1;
        const vals   = Object.values(scores).filter(v => typeof v === 'number');
        if (!vals.length) return;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        weightedSum  += avg * weight;
        weightTotal  += weight;
      });

      const finalScore = weightTotal > 0
        ? Math.round((weightedSum / weightTotal) * 100) / 100
        : 0;

      allResults.push({ ...w, finalScore, count });
    }

    // Stats
    const totalVotes = allResults.reduce((s, w) => s + w.count, 0);
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-num">${workers.length}</div><div class="stat-label">Ümumi işçi</div></div>
      <div class="stat-card"><div class="stat-num">${usedCount}</div><div class="stat-label">Qiymətləndirən</div></div>
      <div class="stat-card"><div class="stat-num">${rateable.length}</div><div class="stat-label">Qiymətləndirilən</div></div>
      <div class="stat-card"><div class="stat-num">${totalVotes}</div><div class="stat-label">Səsvermə</div></div>`;

    if (totalVotes === 0) {
      listEl.innerHTML = '<p style="font-size:13px;color:#6b7280;padding:1rem 0">Hələ qiymət verilməyib.</p>';
      return;
    }

    // Render results grouped by sector
    let html = '';
    SECTOR_ORDER.forEach(sec => {
      const sw = allResults.filter(w => w.sector === sec);
      if (!sw.length) return;
      const sorted = [...sw].sort((a, b) => b.finalScore - a.finalScore);
      html += `<div class="sec-hdr">${SECTOR_LABEL[sec]}</div>`;
      sorted.forEach((w, i) => {
        const pct  = Math.round((w.finalScore / 10) * 100);
        const noV  = w.count === 0;
        html += `<div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;${noV?'':'margin-bottom:10px'}">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="rank-num">${i+1}</div>
              <div>
                <span style="font-weight:600">${w.name}</span>
                <span class="badge ${ROLE_BADGE[w.role]||'b-iscii'}" style="margin-left:6px">${ROLE_LABEL[w.role]||w.role}</span>
              </div>
            </div>
            <div style="text-align:right">
              ${noV
                ? '<span style="font-size:12px;color:#9ca3af">hələ qiymət yoxdur</span>'
                : `<div style="font-size:20px;font-weight:700;color:#534AB7">${w.finalScore.toFixed(2)} <span style="font-size:12px;font-weight:400;color:#9ca3af">/ 10</span></div>
                   <div style="font-size:11px;color:#6b7280">${w.count} qiymətləndirmə</div>`
              }
            </div>
          </div>
          ${!noV ? `<div class="progress-wrap"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
        </div>`;
      });
    });

    listEl.innerHTML = html;

  } catch (err) {
    listEl.innerHTML = `<div class="alert alert-err">Xəta: ${err.message}</div>`;
  }
}

async function clearVotes() {
  if (!confirm('Bütün qiymətlər və tokenlər silinəcək. Bu əməliyyat geri qaytarıla bilməz. Davam edilsin?')) return;

  try {
    // Delete all votes subcollections — we iterate worker docs
    for (const w of workers) {
      const subsSnap = await getDocs(collection(db, 'votes', w.id, 'submissions'));
      const batch = writeBatch(db);
      subsSnap.forEach(d => batch.delete(d.ref));
      if (subsSnap.size > 0) await batch.commit();
    }

    // Reset all tokens to unused
    const tokensSnap = await getDocs(collection(db, 'tokens'));
    const batch = writeBatch(db);
    tokensSnap.forEach(d => batch.update(d.ref, { used: false, usedAt: null }));
    await batch.commit();

    await loadResults();
    alert('Bütün qiymətlər silindi, tokenlər sıfırlandı.');
  } catch (err) {
    alert('Xəta: ' + err.message);
  }
}


// ─── START ───────────────────────────────────────────────────────
init();
