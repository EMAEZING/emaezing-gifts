const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'groups.json');

const MAX_MEMBERS = 60;
const MAX_NAME_LEN = 40;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
}

function loadDB() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDB(db) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function formatCode(raw) {
  return raw.slice(0, 4) + '-' + raw.slice(4);
}

function normCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function usedCodes(db) {
  const used = new Set(Object.keys(db));
  for (const group of Object.values(db)) {
    for (const m of group.members || []) used.add(m.code);
  }
  return used;
}

function freshCode(used) {
  let raw;
  do { raw = randomCode(); } while (used.has(raw));
  used.add(raw);
  return raw;
}

function buildBlocked(members, exclusions) {
  const blocked = new Set();
  for (const [a, b] of exclusions) {
    const ia = members.findIndex((m) => m.id === a);
    const ib = members.findIndex((m) => m.id === b);
    if (ia >= 0 && ib >= 0) {
      blocked.add(ia + ':' + ib);
      blocked.add(ib + ':' + ia);
    }
  }
  return blocked;
}

function greedyDraw(n, isAllowed) {
  const order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
  const taken = new Array(n).fill(false);
  const result = new Array(n).fill(-1);

  function assign(k) {
    if (k === order.length) return true;
    const giver = order[k];
    const cands = [...Array(n).keys()].filter((t) => !taken[t] && isAllowed(giver, t));
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cands[i], cands[j]] = [cands[j], cands[i]];
    }
    for (const target of cands) {
      taken[target] = true;
      result[giver] = target;
      if (assign(k + 1)) return true;
      taken[target] = false;
      result[giver] = -1;
    }
    return false;
  }

  if (!assign(0)) {
    throw new Error('No valid pairing exists with those rules. Remove an exclusion and try again.');
  }
  return result;
}

function drawTargets(members, exclusions) {
  const n = members.length;
  if (n < 2) throw new Error('You need at least 2 people.');
  if (n > MAX_MEMBERS) throw new Error('Maximum ' + MAX_MEMBERS + ' people.');

  const blocked = buildBlocked(members, exclusions);
  const isAllowed = (giver, target) => giver !== target && !blocked.has(giver + ':' + target);

  for (let attempt = 0; attempt < 4000; attempt++) {
    const pool = [...Array(n).keys()];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let ok = true;
    for (let g = 0; g < n; g++) {
      if (!isAllowed(g, pool[g])) { ok = false; break; }
    }
    if (ok) return pool;
  }
  return greedyDraw(n, isAllowed);
}

function cleanNames(list) {
  return (Array.isArray(list) ? list : [])
    .map((n) => String(n).trim().slice(0, MAX_NAME_LEN))
    .filter(Boolean);
}

function publicGroup(adminCode, group) {
  return {
    adminCode: formatCode(adminCode),
    groupName: group.name,
    createdAt: group.createdAt,
    drawn: group.members.every((m) => m.targetId),
    members: group.members.map((m) => ({ name: m.name, code: formatCode(m.code) })),
  };
}

const hits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now > rec.reset) { rec = { count: 0, reset: now + 60000 }; hits.set(ip, rec); }
  rec.count++;
  if (hits.size > 5000) {
    for (const [key, value] of hits) if (now > value.reset) hits.delete(key);
  }
  if (rec.count > 60) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  next();
}

app.post('/api/groups', (req, res) => {
  try {
    const body = req.body || {};
    const groupName = String(body.groupName || '').trim().slice(0, 60) || 'Gift Exchange';
    const names = cleanNames(body.members);

    if (names.length < 2) return res.status(400).json({ error: 'Add at least 2 people.' });
    if (names.length > MAX_MEMBERS) return res.status(400).json({ error: 'Maximum ' + MAX_MEMBERS + ' people.' });

    const lower = names.map((n) => n.toLowerCase());
    if (new Set(lower).size !== names.length) {
      return res.status(400).json({ error: 'Every name must be different.' });
    }

    const db = loadDB();
    const used = usedCodes(db);
    const adminCode = freshCode(used);

    const members = names.map((name) => ({
      id: crypto.randomUUID(), name, code: freshCode(used), targetId: null,
    }));

    const exclusions = [];
    for (const raw of Array.isArray(body.exclusions) ? body.exclusions : []) {
      const a = String((raw && raw.a) || '').trim().toLowerCase();
      const b = String((raw && raw.b) || '').trim().toLowerCase();
      if (!a || !b || a === b) continue;
      const A = members.find((m) => m.name.toLowerCase() === a);
      const B = members.find((m) => m.name.toLowerCase() === b);
      if (A && B) exclusions.push([A.id, B.id]);
    }

    const targets = drawTargets(members, exclusions);
    members.forEach((m, i) => { m.targetId = members[targets[i]].id; });

    db[adminCode] = { name: groupName, createdAt: Date.now(), exclusions, members };
    saveDB(db);
    res.json(publicGroup(adminCode, db[adminCode]));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not create the group.' });
  }
});

app.get('/api/groups/:adminCode', (req, res) => {
  const key = normCode(req.params.adminCode);
  const db = loadDB();
  const group = db[key];
  if (!group) return res.status(404).json({ error: 'Group not found.' });
  res.json(publicGroup(key, group));
});

app.post('/api/groups/:adminCode/redraw', (req, res) => {
  try {
    const key = normCode(req.params.adminCode);
    const db = loadDB();
    const group = db[key];
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const targets = drawTargets(group.members, group.exclusions || []);
    group.members.forEach((m, i) => { m.targetId = group.members[targets[i]].id; });
    saveDB(db);
    res.json(publicGroup(key, group));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not redraw.' });
  }
});

app.post('/api/groups/:adminCode/members', (req, res) => {
  try {
    const key = normCode(req.params.adminCode);
    const db = loadDB();
    const group = db[key];
    if (!group) return res.status(404).json({ error: 'Group not found.' });

    const name = String((req.body && req.body.name) || '').trim().slice(0, MAX_NAME_LEN);
    if (!name) return res.status(400).json({ error: 'Enter a name.' });
    if (group.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'That name is already in the group.' });
    }
    if (group.members.length >= MAX_MEMBERS) return res.status(400).json({ error: 'Maximum reached.' });

    const used = usedCodes(db);
    group.members.push({ id: crypto.randomUUID(), name, code: freshCode(used), targetId: null });

    const targets = drawTargets(group.members, group.exclusions || []);
    group.members.forEach((m, i) => { m.targetId = group.members[targets[i]].id; });
    saveDB(db);
    res.json(publicGroup(key, group));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not add that person.' });
  }
});

app.get('/api/reveal/:code', rateLimit, (req, res) => {
  const raw = normCode(req.params.code);
  if (raw.length !== CODE_LENGTH) {
    return res.status(404).json({ error: 'That code does not look right. It should be 8 characters.' });
  }

  const db = loadDB();
  for (const group of Object.values(db)) {
    const me = (group.members || []).find((m) => m.code === raw);
    if (!me) continue;
    const target = (group.members || []).find((m) => m.id === me.targetId);
    if (!target) {
      return res.status(409).json({ error: 'Names have not been drawn yet. Ask the host to redraw.' });
    }
    return res.json({ groupName: group.name, you: me.name, target: target.name });
  }

  res.status(404).json({ error: 'Code not found. Double-check it with the host.' });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, () => {
  ensureStore();
  console.log('\n  Giftly is running -> http://localhost:' + PORT + '\n');
});