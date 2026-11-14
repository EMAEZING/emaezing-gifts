const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORAGE_KEY = 'giftly.adminCode';
const state = { exclusions: [], adminCode: null, groupName: '' };

/* ---------- Custom Cursor Logic ---------- */
const cursor = $('#cursor');
const cursorFollower = $('#cursorFollower');
let mouseX = 0, mouseY = 0, followerX = 0, followerY = 0;

window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (cursor) cursor.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;
});

function animateFollower() {
  followerX += (mouseX - followerX) * 0.15;
  followerY += (mouseY - followerY) * 0.15;
  if (cursorFollower) cursorFollower.style.transform = `translate(${followerX}px, ${followerY}px) translate(-50%, -50%)`;
  requestAnimationFrame(animateFollower);
}
animateFollower();

const bindHover = (el) => {
  el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
  el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
};
$$('button, input, select, summary, .bento-card, .hero-visual').forEach(bindHover);

/* ---------- Scroll Reveal ---------- */
const revealElements = $$('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('active'); revealObserver.unobserve(entry.target); }
  });
}, { threshold: 0.1 });
revealElements.forEach((el) => revealObserver.observe(el));
setTimeout(() => revealElements.forEach(el => el.classList.add('active')), 100);

/* ---------- Utils & Logic ---------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

async function api(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || 'Something went wrong.');
  return data;
}

function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-go]').forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.go)));

/* ---------- Interactive Gift Box ---------- */
const giftTarget = $('#giftClickTarget');
const heroGift = $('#heroGift');
let isGiftOpen = false;

giftTarget.addEventListener('click', () => {
  if (isGiftOpen) return;
  isGiftOpen = true;
  
  giftTarget.classList.add('open');
  
  const rect = heroGift.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  
  burstConfetti(originX, originY);
  
  setTimeout(() => {
    giftTarget.classList.remove('open');
    isGiftOpen = false;
  }, 4000);
});

/* ---------- Host Login Logic ---------- */
$('#hostLoginBtn').addEventListener('click', async () => {
  const code = prompt("Enter your Host Passcode (e.g., XXXX-XXXX):");
  if (!code) return;
  
  const cleanCode = code.replace(/[^A-Za-z0-9]/g, '');
  if (cleanCode.length < 8) return toast('Passcode must be 8 characters.');

  try {
    const data = await api('/api/groups/' + encodeURIComponent(cleanCode));
    renderAdmin(data);
    show('admin');
    toast('Welcome back to your panel.');
  } catch (err) {
    toast('Invalid host passcode.');
  }
});

/* ---------- Form Logic ---------- */
function memberInputs() { return $$('#memberList .member-input'); }
function currentNames() { return memberInputs().map((i) => i.value.trim()).filter(Boolean); }

function renumber() {
  $$('#memberList .member-row').forEach((row, i) => {
    row.querySelector('.member-num').textContent = (i + 1).toString().padStart(2, '0');
  });
}

function refreshExclusionOptions() {
  const names = currentNames();
  [$('#exA'), $('#exB')].forEach((sel) => {
    const prev = sel.value;
    sel.innerHTML = '';
    if (!names.length) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'Add people first';
      sel.appendChild(opt); sel.disabled = true;
      return;
    }
    sel.disabled = false;
    names.forEach((n) => {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      sel.appendChild(opt);
    });
    if (names.includes(prev)) sel.value = prev;
  });

  if (!$('#exB').value && names.length > 1) $('#exB').value = names[1];

  const lower = names.map((n) => n.toLowerCase());
  const before = state.exclusions.length;
  state.exclusions = state.exclusions.filter(
    (e) => lower.includes(e.a.toLowerCase()) && lower.includes(e.b.toLowerCase())
  );
  if (state.exclusions.length !== before) renderExclusions();
}

function renderExclusions() {
  const list = $('#exclusionList');
  list.innerHTML = '';
  state.exclusions.forEach((rule, i) => {
    const item = document.createElement('div');
    item.className = 'exclusion-item';
    item.innerHTML = '<span>' + escapeHtml(rule.a) + ' &nbsp;✕&nbsp; ' + escapeHtml(rule.b) + '</span>';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = 'Remove'; btn.className = 'btn-text';
    btn.style.color = 'var(--err)'; btn.style.fontSize = '12px';
    btn.addEventListener('click', () => { state.exclusions.splice(i, 1); renderExclusions(); });
    item.appendChild(btn); list.appendChild(item);
  });
}

function addMemberRow(name) {
  const row = document.createElement('div');
  row.className = 'member-row';
  row.innerHTML =
    '<span class="member-num"></span>' +
    '<input type="text" class="member-input" placeholder="Name" maxlength="40" autocomplete="off" value="' + escapeHtml(name || '') + '" />' +
    '<button class="icon-btn" type="button" aria-label="Remove">✕</button>';

  row.querySelector('.icon-btn').addEventListener('click', () => {
    row.remove(); renumber(); refreshExclusionOptions();
  });
  row.querySelector('input').addEventListener('input', refreshExclusionOptions);
  
  bindHover(row.querySelector('input'));
  bindHover(row.querySelector('.icon-btn'));

  $('#memberList').appendChild(row);
  renumber(); refreshExclusionOptions();
  return row;
}

$('#addMemberBtn').addEventListener('click', () => {
  const row = addMemberRow();
  row.querySelector('input').focus();
});

$('#addExBtn').addEventListener('click', () => {
  const a = $('#exA').value, b = $('#exB').value;
  if (!a || !b) return toast('Add at least two people first.');
  if (a === b) return toast('Pick two different people.');
  const exists = state.exclusions.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  if (exists) return toast('That rule already exists.');
  state.exclusions.push({ a, b });
  renderExclusions(); toast('Rule added.');
});

$('#createBtn').addEventListener('click', async () => {
  const btn = $('#createBtn'), errEl = $('#createError');
  errEl.textContent = '';
  const groupName = $('#groupName').value.trim() || 'Private Exchange';
  const members = currentNames();

  if (members.length < 2) { errEl.textContent = 'Add at least 2 people.'; return; }
  const lower = members.map((n) => n.toLowerCase());
  if (new Set(lower).size !== members.length) { errEl.textContent = 'Every name must be unique.'; return; }

  btn.disabled = true; btn.textContent = 'Drawing…';
  try {
    const data = await api('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName, members, exclusions: state.exclusions }),
    });
    localStorage.setItem(STORAGE_KEY, data.adminCode.replace('-', ''));
    renderAdmin(data); show('admin');
    toast('Exchange created successfully.');
  } catch (err) { errEl.textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Draw Names Securely'; }
});

/* ---------- Admin Panel ---------- */
function renderAdmin(data) {
  state.adminCode = data.adminCode.replace('-', '');
  state.groupName = data.groupName;
  $('#adminGroupName').textContent = data.groupName;
  $('#adminMemberCount').textContent = data.members.length + ' People';
  $('#adminCode').textContent = data.adminCode;

  const list = $('#memberCodes');
  list.innerHTML = '';
  data.members.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'code-item';
    item.innerHTML =
      '<div><div class="code-name">' + escapeHtml(m.name) + '</div>' +
      '<div class="code-value">' + escapeHtml(m.code) + '</div></div>';
    const btn = document.createElement('button');
    btn.className = 'btn btn-text'; btn.type = 'button'; btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      const ok = await copyText(m.code);
      toast(ok ? 'Code for ' + m.name + ' copied.' : 'Copy failed.');
    });
    item.appendChild(btn); list.appendChild(item);
  });
}

$('#copyAdminBtn').addEventListener('click', async () => {
  const ok = await copyText($('#adminCode').textContent.trim());
  toast(ok ? 'Host passcode copied.' : 'Copy failed.');
});

$('#copyAllBtn').addEventListener('click', async () => {
  const lines = ['EMAEzing Gifts — ' + state.groupName, 'Host Code: ' + $('#adminCode').textContent.trim(), ''];
  $$('#memberCodes .code-item').forEach((item) => {
    const name = item.querySelector('.code-name').textContent;
    const code = item.querySelector('.code-value').textContent;
    lines.push(name + ': ' + code);
  });
  const ok = await copyText(lines.join('\n'));
  toast(ok ? 'All codes copied.' : 'Copy failed.');
});

$('#redrawBtn').addEventListener('click', async () => {
  if (!state.adminCode) return;
  if (!confirm('Redraw everyone? Current matches will be replaced.')) return;
  const btn = $('#redrawBtn'); btn.disabled = true;
  try {
    const data = await api('/api/groups/' + state.adminCode + '/redraw', { method: 'POST' });
    renderAdmin(data); toast('Names redrawn.');
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
});

$('#addLateBtn').addEventListener('click', async () => {
  if (!state.adminCode) return;
  const name = prompt('Name of the person joining:');
  if (!name || !name.trim()) return;
  const btn = $('#addLateBtn'); btn.disabled = true;
  try {
    const data = await api('/api/groups/' + state.adminCode + '/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    renderAdmin(data); toast(name.trim() + ' added.');
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
});

/* ---------- Reveal Logic ---------- */
const codeInput = $('#codeInput');

function formatCodeInput(value) {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4) : raw;
}

codeInput.addEventListener('input', () => {
  const pos = codeInput.selectionStart;
  const before = codeInput.value.length;
  codeInput.value = formatCodeInput(codeInput.value);
  const after = codeInput.value.length;
  codeInput.setSelectionRange(Math.max(0, pos + (after - before)), Math.max(0, pos + (after - before)));
});

codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#revealBtn').click(); });

$('#revealBtn').addEventListener('click', async () => {
  const errEl = $('#revealError'); errEl.textContent = '';
  const code = codeInput.value.replace(/[^A-Za-z0-9]/g, '');
  if (code.length !== 8) { errEl.textContent = 'Codes are 8 characters.'; return; }
  const btn = $('#revealBtn'); btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const data = await api('/api/reveal/' + encodeURIComponent(code));
    $('#resultGroup').textContent = data.groupName;
    $('#resultYou').textContent = data.you;
    $('#resultTarget').textContent = data.target;
    show('result'); 
    
    burstConfetti(window.innerWidth / 2, window.innerHeight * 0.4);
  } catch (err) { errEl.textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Reveal Match'; }
});

$('#resultDone').addEventListener('click', () => { codeInput.value = ''; show('home'); });

/* ---------- Interactive Cinematic Background ---------- */
const bgCanvas = $('#bgCanvas');
const bgCtx = bgCanvas.getContext('2d');
let bgParticles = [];
let bgMouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

window.addEventListener('mousemove', (e) => {
  bgMouse.x = e.clientX; bgMouse.y = e.clientY;
});

function initBgCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  bgCanvas.width = window.innerWidth * dpr;
  bgCanvas.height = window.innerHeight * dpr;
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  
  bgParticles = [];
  const count = window.innerWidth < 700 ? 30 : 80;
  
  for (let i = 0; i < count; i++) {
    bgParticles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      radius: Math.random() * 1.5 + 0.5,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      alpha: Math.random() * 0.5 + 0.1,
      pulse: Math.random() * 0.02 + 0.005,
      baseX: Math.random() * window.innerWidth,
      baseY: Math.random() * window.innerHeight
    });
  }
  requestAnimationFrame(drawBg);
}

function drawBg() {
  bgCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  
  for (let p of bgParticles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = window.innerWidth; if (p.x > window.innerWidth) p.x = 0;
    if (p.y < 0) p.y = window.innerHeight; if (p.y > window.innerHeight) p.y = 0;

    p.alpha += p.pulse;
    if (p.alpha > 0.6 || p.alpha < 0.1) p.pulse *= -1;

    const dx = bgMouse.x - window.innerWidth / 2;
    const dy = bgMouse.y - window.innerHeight / 2;
    const px = p.x + dx * (p.radius * 0.02);
    const py = p.y + dy * (p.radius * 0.02);

    bgCtx.beginPath();
    bgCtx.arc(px, py, p.radius, 0, Math.PI * 2);
    
    const gradient = bgCtx.createRadialGradient(px, py, 0, px, py, p.radius * 4);
    gradient.addColorStop(0, `rgba(212, 175, 55, ${p.alpha})`);
    gradient.addColorStop(1, 'rgba(212, 175, 55, 0)');
    
    bgCtx.fillStyle = gradient;
    bgCtx.fill();
  }
  requestAnimationFrame(drawBg);
}

/* ---------- Confetti Engine ---------- */
const canvas = $('#confetti');
const ctx = canvas.getContext('2d');
let particles = [], rafId = null;

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function burstConfetti(originX, originY) {
  const colors = ['#D4AF37', '#FCEABB', '#FFFFFF', '#8A8A8A'];
  for (let i = 0; i < 150; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 12;
    particles.push({
      x: originX, y: originY,
      vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.7),
      vy: Math.sin(angle) * speed - 8,
      size: 4 + Math.random() * 6, rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0], life: 1,
    });
  }
  if (!rafId) rafId = requestAnimationFrame(confettiTick);
}

function confettiTick() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (const p of particles) {
    p.vy += 0.25; p.vx *= 0.99;
    p.x += p.vx; p.y += p.vy;
    p.rot += p.vr; p.life -= 0.005;
  }
  particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 100);
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }
  if (particles.length) rafId = requestAnimationFrame(confettiTick);
  else { rafId = null; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
}

/* ---------- Init ---------- */
function init() {
  resizeCanvas();
  initBgCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); initBgCanvas(); });
  
  addMemberRow(); addMemberRow(); addMemberRow();
}

init();