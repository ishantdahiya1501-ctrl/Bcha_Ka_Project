/**
 * lib/db.js — Local data store + business logic (sample mode, classwise).
 *
 * Zero-dependency JSON-file store. The timetable is CLASS-WISE:
 *   classes × days × periods  →  { subject, teacher }
 * Teacher names are matched to subject cells automatically (when exactly one
 * teacher teaches a subject) or set explicitly by the admin. A default
 * classwise timetable is provided so the sample works out of the box.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('./xlsx');

// ── MongoDB adapter (used when MONGODB_URI is set) ──
let mongoClient = null;
let mongoDb = null;
const MONGODB_URI = process.env.MONGODB_URI || '';

async function connectMongo() {
  if (!MONGODB_URI) return;
  const { MongoClient } = require('mongodb');
  mongoClient = new MongoClient(MONGODB_URI);
  await mongoClient.connect();
  mongoDb = mongoClient.db();
  console.log('[db] Connected to MongoDB.');
}

async function disconnectMongo() {
  if (mongoClient) await mongoClient.close();
}

/** Get a MongoDB collection (returns null if not connected). */
function col(name) {
  return mongoDb ? mongoDb.collection(name) : null;
}

/** Load a collection as an array. Falls back to JSON file if no MongoDB. */
async function loadCol(name, fallback) {
  const c = col(name);
  if (c) {
    const docs = await c.find({}, { projection: { _id: 0 } }).toArray();
    return docs.length ? docs : JSON.parse(JSON.stringify(fallback));
  }
  // Fallback: JSON file
  return load(name, fallback);
}

/** Save an array to a MongoDB collection (replace-all). Falls back to JSON file. */
async function saveCol(name, data) {
  const c = col(name);
  if (c) {
    await c.deleteMany({});
    if (data.length) await c.insertMany(data.map((d) => ({ ...d })));
    return;
  }
  save(name, data);
}

// ── Session store (always in-memory for speed) ──
const sessionStore = new Map();

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROJECT_ROOT = path.join(__dirname, '..');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // prune sessions older than 30 days

/* ------------------------------------------------------------------ *
 *  Master data
 * ------------------------------------------------------------------ */

/** Subject dropdown used at teacher registration and in the timetable editor. */
const SUBJECTS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'English',
  'Hindi',
  'Sanskrit',
  'Social Studies',
  'History',
  'Geography',
  'Economics',
  'Accountancy',
  'Business Studies',
  'Computer Science',
  'Artificial Intelligence',
  'Physical Education',
  'Art',
  'Music',
];

const DEFAULT_CLASSES = ['9A', '9B', '10A', '10B'];

const SAMPLE_PERIODS = [
  'Period 1 · 08:00–08:45',
  'Period 2 · 08:45–09:30',
  'Period 3 · 09:30–10:15',
  'Period 4 · 10:30–11:15',
  'Period 5 · 11:15–12:00',
  'Period 6 · 12:00–12:45',
];

const SAMPLE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/** Default timetable = the weighted one (important subjects daily). */
function buildDefaultTimetable() {
  return buildWeightedTimetable();
}

/**
 * Weighted weekly subject pattern for one class (30 slots = 5 days × 6 periods).
 * Important subjects — Mathematics, the sciences and English — appear every
 * day; less important ones (SST, AI, …) appear 1–2 times a week. Classes are
 * rotated by CLASS_ROTATE (coprime with 30) so no two classes ever share a
 * subject in the same slot (a teacher is never double-booked).
 */
const WEIGHTED_WEEK = [
  'Mathematics', 'English', 'Physics', 'Hindi', 'Social Studies', 'Computer Science',
  'Mathematics', 'English', 'Biology', 'Artificial Intelligence', 'History', 'Geography',
  'Mathematics', 'English', 'Chemistry', 'Hindi', 'Sanskrit', 'Physical Education',
  'Mathematics', 'English', 'Physics', 'Economics', 'Chemistry', 'Social Studies',
  'Mathematics', 'English', 'Biology', 'Computer Science', 'Accountancy', 'Business Studies',
];
const CLASS_ROTATE = 7;

/**
 * Build the default classwise timetable with importance weighting:
 * Mathematics, English and a science subject every day per class; minor
 * subjects 1–2×/week. (Used for fresh installs and by the one-click setup.)
 */
function buildWeightedTimetable() {
  const slots = {};
  DEFAULT_CLASSES.forEach((cls, ci) => {
    slots[cls] = {};
    SAMPLE_DAYS.forEach((d, di) => {
      slots[cls][d] = {};
      SAMPLE_PERIODS.forEach((p, pi) => {
        const n = di * SAMPLE_PERIODS.length + pi;
        const idx = (n + CLASS_ROTATE * ci) % WEIGHTED_WEEK.length;
        slots[cls][d][p] = { subject: WEIGHTED_WEEK[idx], teacher: '' };
      });
    });
  });
  return { days: SAMPLE_DAYS, periods: SAMPLE_PERIODS, classes: DEFAULT_CLASSES, slots };
}

/* ------------------------------------------------------------------ *
 *  Low-level store helpers
 * ------------------------------------------------------------------ */

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load(name, fallback) {
  ensureDir();
  const p = path.join(DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    save(name, fallback);
    return JSON.parse(JSON.stringify(fallback)); // copy, never share reference
  }
}

function save(name, data) {
  ensureDir();
  const p = path.join(DATA_DIR, name);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/* ------------------------------------------------------------------ *
 *  Password hashing (Node built-in scrypt)
 * ------------------------------------------------------------------ */

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  Public accessors
 * ------------------------------------------------------------------ */

function getUsers() {
  return load('users.json', []);
}

async function getUsersAsync() {
  return loadCol('users', []);
}

function saveUsers(users) {
  save('users.json', users);
}

async function saveUsersAsync(users) {
  await saveCol('users', users);
}

function getTimetable() {
  const tt = load('timetable.json', buildDefaultTimetable());
  // Guard: if the stored file predates the classwise model, use (and persist) the default
  if (!tt.classes || !Array.isArray(tt.classes) || !tt.classes.length) {
    const fresh = buildDefaultTimetable();
    save('timetable.json', fresh);
    return fresh;
  }
  return tt;
}

async function getTimetableAsync() {
  let tt = await loadCol('timetable', buildDefaultTimetable());
  if (!tt.classes || !Array.isArray(tt.classes) || !tt.classes.length) {
    const fresh = buildDefaultTimetable();
    await saveCol('timetable', fresh);
    return fresh;
  }
  return tt;
}

function saveTimetable(tt) {
  save('timetable.json', tt);
}

async function saveTimetableAsync(tt) {
  await saveCol('timetable', tt);
}

function getRequests() {
  return load('requests.json', []);
}

async function getRequestsAsync() {
  return loadCol('requests', []);
}

function saveRequests(reqs) {
  save('requests.json', reqs);
}

async function saveRequestsAsync(reqs) {
  await saveCol('requests', reqs);
}

/** Public (safe) view of a user — never exposes hash/salt. */
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    subject: u.subject,
    email: u.email,
    mobile: u.mobile || '',
    createdAt: u.createdAt,
  };
}

function findByUsername(username) {
  return getUsers().find((u) => String(u.username).toLowerCase() === String(username).toLowerCase());
}

function findByCredentials(username, password) {
  const u = findByUsername(username);
  if (!u) return null;
  if (!verifyPassword(password, u.salt, u.hash)) return null;
  return u;
}

/* ------------------------------------------------------------------ *
 *  Sessions
 * ------------------------------------------------------------------ */

let sessionsCache = null;

function getSessions() {
  if (!sessionsCache) {
    sessionsCache = load('sessions.json', {});
    const cutoff = Date.now() - SESSION_TTL_MS;
    let changed = false;
    Object.keys(sessionsCache).forEach((k) => {
      const rec = sessionsCache[k];
      if (!rec || !rec.createdAt || rec.createdAt < cutoff) {
        delete sessionsCache[k];
        changed = true;
      }
    });
    if (changed) persistSessions();
  }
  return sessionsCache;
}

function persistSessions() {
  save('sessions.json', getSessions());
}

function createSession(userId) {
  const sid = crypto.randomBytes(24).toString('hex');
  getSessions()[sid] = { userId, createdAt: Date.now() };
  persistSessions();
  return sid;
}

function getSessionUser(sid) {
  if (!sid) return null;
  const rec = getSessions()[sid];
  if (!rec) return null;
  return getUsers().find((u) => u.id === rec.userId) || null;
}

function destroySession(sid) {
  if (!sid) return;
  if (getSessions()[sid]) {
    delete getSessions()[sid];
    persistSessions();
  }
}

/* ------------------------------------------------------------------ *
 *  Teacher management
 * ------------------------------------------------------------------ */

function listTeachers() {
  return getUsers()
    .filter((u) => u.role === 'teacher')
    .map(publicUser);
}

function assertValidSubject(subject) {
  const s = String(subject || '').trim();
  if (!s) return s;
  if (!SUBJECTS.includes(s)) {
    throw new Error('Invalid subject. Please pick one from the list.');
  }
  return s;
}

function createTeacher({ name, username, password, email, subject, mobile }) {
  const users = getUsers();
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) throw new Error('Username is required.');
  if (users.some((u) => String(u.username).toLowerCase() === uname)) {
    throw new Error('That username is already taken.');
  }
  if (!password || String(password).length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }
  const { salt, hash } = hashPassword(password);
  const teacher = {
    id: 'u_' + crypto.randomBytes(6).toString('hex'),
    name: String(name || '').trim(),
    username: uname,
    role: 'teacher',
    subject: assertValidSubject(subject),
    email: String(email || '').trim(),
    mobile: String(mobile || '8750441860').trim(),
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };
  if (!teacher.name) throw new Error('Full name is required.');
  users.push(teacher);
  saveUsers(users);
  return publicUser(teacher);
}

function updateTeacher(id, patch) {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error('Teacher not found.');
  const u = users[idx];
  if (u.role !== 'teacher') throw new Error('Can only edit teachers.');
  if (patch.name !== undefined) u.name = String(patch.name).trim();
  if (patch.email !== undefined) u.email = String(patch.email).trim();
  if (patch.subject !== undefined) u.subject = assertValidSubject(patch.subject);
  if (patch.mobile !== undefined) u.mobile = String(patch.mobile).trim();
  if (patch.username !== undefined && patch.username !== u.username) {
    const uname = String(patch.username).trim().toLowerCase();
    if (!uname) throw new Error('Username is required.');
    if (users.some((x) => x.id !== id && String(x.username).toLowerCase() === uname)) {
      throw new Error('That username is already taken.');
    }
    u.username = uname;
  }
  if (patch.password) {
    if (String(patch.password).length < 4) throw new Error('Password must be at least 4 characters.');
    const { salt, hash } = hashPassword(patch.password);
    u.salt = salt;
    u.hash = hash;
  }
  saveUsers(users);
  return publicUser(u);
}

function deleteTeacher(id) {
  const users = getUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error('Teacher not found.');
  if (users[idx].role !== 'teacher') throw new Error('Can only delete teachers.');
  const removed = users.splice(idx, 1)[0];
  saveUsers(users);

  // Clear explicit assignments to this teacher in the timetable
  const tt = getTimetable();
  let changed = false;
  (tt.classes || []).forEach((cls) => {
    (tt.days || []).forEach((d) => {
      (tt.periods || []).forEach((p) => {
        const cell = ((tt.slots[cls] || {})[d] || {})[p];
        if (cell && cell.teacher && cell.teacher.toLowerCase() === removed.name.toLowerCase()) {
          cell.teacher = '';
          changed = true;
        }
      });
    });
  });
  if (changed) saveTimetable(tt);
  return publicUser(removed);
}

/* ------------------------------------------------------------------ *
 *  Timetable (classwise)
 * ------------------------------------------------------------------ */

function slotCell(tt, cls, day, period) {
  return (((tt.slots || {})[cls] || {})[day] || {})[period];
}

/* ------------------------------------------------------------------ *
 *  One-click setup — build timetable + teachers automatically
 * ------------------------------------------------------------------ */

/**
 * Teachers created by the one-click setup (one entry per teacher).
 * Important subjects get more teachers; minor subjects get one.
 * Username = subject slug (+2/+3 suffix when there are several).
 * Password for every account: 1234
 */
const SETUP_TEACHERS = {
  Mathematics: ['Priya Verma', 'Rohit Sharma', 'Kavita Nair'],
  English: ['Farhan Khan', 'Neha Gupta', 'Aditya Bose'],
  Physics: ['Rahul Kapoor', 'Ananya Iyer'],
  Chemistry: ['Sneha Iyer', 'Vikram Mehta'],
  Biology: ['Meera Nair', 'Arjun Patel'],
  Hindi: ['Amit Joshi', 'Divya Malhotra'],
  'Social Studies': ['Rohan Das'],
  'Computer Science': ['Varun Khanna'],
  'Artificial Intelligence': ['Ishita Rao'],
  History: ['Anjali Singh'],
  Geography: ['Suresh Menon'],
  Sanskrit: ['Kavita Sharma'],
  'Physical Education': ['Manish Yadav'],
  Economics: ['Sunil Kumar'],
  Accountancy: ['Pooja Reddy'],
  'Business Studies': ['Ritu Sharma'],
};

const SETUP_PASSWORD = '1234';

function slugify(subject) {
  return String(subject).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * One-click setup (admin button): rebuilds the weighted timetable and
 * creates the SETUP_TEACHERS accounts, then assigns each teacher to the
 * timetable cells of their subject (round-robin) so every schedule is
 * populated and visible. Replaces existing teacher accounts.
 */
function setupTeachers() {
  const tt = buildWeightedTimetable();

  // 1) Replace teacher accounts (test/demo accounts are wiped too).
  const users = getUsers().filter((u) => u.role !== 'teacher');
  const created = [];
  Object.keys(SETUP_TEACHERS).forEach((subject) => {
    SETUP_TEACHERS[subject].forEach((name, i) => {
      const username = slugify(subject) + (i ? String(i + 1) : '');
      const { salt, hash } = hashPassword(SETUP_PASSWORD);
      const teacher = {
        id: 'u_' + crypto.randomBytes(6).toString('hex'),
        name,
        username,
        role: 'teacher',
        subject,
        email: username + '@school.edu',
        mobile: '8750441860',
        salt,
        hash,
        createdAt: new Date().toISOString(),
      };
      users.push(teacher);
      created.push({ name, username, subject });
    });
  });
  saveUsers(users);

  // 2) Assign teachers to cells — round-robin per subject. The weighted
  //    pattern never puts the same subject in two classes at one slot, so
  //    no teacher is ever double-booked.
  const counters = {};
  (tt.classes || []).forEach((cls) =>
    (tt.days || []).forEach((d) =>
      (tt.periods || []).forEach((p) => {
        const cell = ((tt.slots[cls] || {})[d] || {})[p];
        if (!cell || !cell.subject) return;
        const names = SETUP_TEACHERS[cell.subject];
        if (!names || !names.length) return;
        const k = (counters[cell.subject] = (counters[cell.subject] || 0) + 1);
        cell.teacher = names[(k - 1) % names.length];
      })
    )
  );
  saveTimetable(tt);

  // 3) Drop stale requests/messages that reference the replaced accounts.
  save('requests.json', []);
  save('messages.json', []);

  return { created: created.length, teachers: created, classes: tt.classes };
}

function validateTimetable(tt) {
  if (!tt || !Array.isArray(tt.days) || !tt.days.length) throw new Error('Timetable needs at least one day.');
  if (!Array.isArray(tt.periods) || !tt.periods.length) throw new Error('Timetable needs at least one period.');
  if (!Array.isArray(tt.classes) || !tt.classes.length) throw new Error('Timetable needs at least one class.');
  const slots = tt.slots || {};
  tt.classes.forEach((cls) => {
    if (!slots[cls]) slots[cls] = {};
    tt.days.forEach((d) => {
      if (!slots[cls][d]) slots[cls][d] = {};
      tt.periods.forEach((p) => {
        const cell = slots[cls][d][p];
        if (!cell || typeof cell !== 'object') {
          slots[cls][d][p] = { subject: '', teacher: '' };
        } else {
          cell.subject = String(cell.subject || '').trim();
          cell.teacher = String(cell.teacher || '').trim();
        }
      });
    });
  });
  return { days: tt.days, periods: tt.periods, classes: tt.classes, slots };
}

function saveTimetableFromClient(tt) {
  const clean = validateTimetable(tt);
  saveTimetable(clean);
  return clean;
}

/** Map subject → registered teacher names (lowercased keys). */
function subjectToTeachers() {
  const map = {};
  getUsers()
    .filter((u) => u.role === 'teacher')
    .forEach((u) => {
      const key = String(u.subject || '').trim().toLowerCase();
      if (key) (map[key] = map[key] || []).push(u.name);
    });
  return map;
}

/**
 * Resolve the timetable for clients: each cell gets the effective teacher —
 * the explicitly assigned one, or the single teacher whose subject matches
 * the cell subject (auto-detect). Returns { days, periods, classes, subjects,
 * slots: { class: { day: { period: { subject, teacher, explicit } } } } }.
 */
function getTimetableResolved() {
  const tt = getTimetable();
  const bySubject = subjectToTeachers();
  const resolved = {
    days: tt.days,
    periods: tt.periods,
    classes: tt.classes,
    subjects: SUBJECTS,
    slots: {},
  };
  tt.classes.forEach((cls) => {
    resolved.slots[cls] = {};
    tt.days.forEach((d) => {
      resolved.slots[cls][d] = {};
      tt.periods.forEach((p) => {
        const cell = slotCell(tt, cls, d, p) || { subject: '', teacher: '' };
        const explicit = !!cell.teacher;
        let teacher = cell.teacher || '';
        if (!explicit && cell.subject) {
          const matches = bySubject[cell.subject.toLowerCase()] || [];
          if (matches.length === 1) teacher = matches[0];
        }
        resolved.slots[cls][d][p] = { subject: cell.subject, teacher, explicit };
      });
    });
  });
  return resolved;
}

/** Effective teacher of one cell ('' = none). */
function cellTeacher(tt, cls, day, period, bySubject) {
  const cell = slotCell(tt, cls, day, period);
  if (!cell || !cell.subject) return '';
  if (cell.teacher) return cell.teacher;
  const matches = (bySubject[cell.subject.toLowerCase()] || []);
  return matches.length === 1 ? matches[0] : '';
}

/**
 * Teachers who are NOT teaching at (day, period) across any class and are
 * not the excluded teacher.
 */
function freeTeachersAt(day, period, excludeId) {
  const tt = getTimetable();
  const bySubject = subjectToTeachers();
  const busy = new Set();
  (tt.classes || []).forEach((cls) => {
    const t = cellTeacher(tt, cls, day, period, bySubject);
    if (t) busy.add(t.toLowerCase());
  });
  return getUsers().filter((u) => {
    if (u.role !== 'teacher') return false;
    if (u.id === excludeId) return false;
    if (busy.has(u.name.toLowerCase())) return false;
    // …and are not already covering another request at the same slot.
    return !getRequests().some(
      (r) => r.status === 'approved' && r.day === day && r.period === period && r.assignedTo === u.id
    );
  });
}

function coverCount(teacherId) {
  return getRequests().filter((r) => r.status === 'approved' && r.assignedTo === teacherId).length;
}

/* ------------------------------------------------------------------ *
 *  Substitution requests
 * ------------------------------------------------------------------ */

function createRequest(user, { day, period, date, reason, senderID }) {
  const tt = getTimetable();
  if (!tt.days.includes(day)) throw new Error('That day is not in the timetable.');
  if (!tt.periods.includes(period)) throw new Error('That period is not in the timetable.');
  if (!reason || !String(reason).trim()) throw new Error('Please describe the reason for the request.');
  const req = {
    id: 'r_' + crypto.randomBytes(6).toString('hex'),
    teacherId: user.id,
    teacherName: user.name,
    day,
    period,
    date: String(date || '').trim(),
    reason: String(reason).trim(),
    status: 'pending',
    assignedTo: null,
    assignedName: '',
    adminNote: '',
    // If this request was started from a classroom sender's signal, remember
    // which sender so the approval/denial can be shown on its LCD.
    senderID: validSenderID(Number(senderID)) ? Number(senderID) : null,
    createdAt: new Date().toISOString(),
  };
  const reqs = getRequests();
  reqs.push(req);
  saveRequests(reqs);
  return req;
}

/**
 * Approve a request. If no assignee given, auto-assign the best free teacher.
 * Returns { request, autoAssigned, assignee?, needsManual? }.
 */
function approveRequest(reqId, assignedToId, note) {
  const reqs = getRequests();
  const r = reqs.find((x) => x.id === reqId);
  if (!r) throw new Error('Request not found.');
  if (r.status !== 'pending' && r.status !== 'needs-assignment') {
    throw new Error('This request has already been processed.');
  }
  const noteStr = String(note || '').trim();
  const manual = !!assignedToId;

  if (!assignedToId) {
    const free = freeTeachersAt(r.day, r.period, r.teacherId);
    free.sort((a, b) => coverCount(a.id) - coverCount(b.id) || a.name.localeCompare(b.name));
    if (free.length) {
      assignedToId = free[0].id;
    } else {
      r.status = 'needs-assignment';
      r.adminNote = noteStr;
      saveRequests(reqs);
      return { request: r, autoAssigned: false, needsManual: true };
    }
  }

  const assignee = getUsers().find((u) => u.id === assignedToId);
  if (!assignee) throw new Error('Assigned teacher not found.');
  if (assignee.id === r.teacherId) throw new Error('A teacher cannot cover their own period.');

  r.status = 'approved';
  r.assignedTo = assignee.id;
  r.assignedName = assignee.name;
  r.adminNote = noteStr || (manual ? '' : `Auto-assigned to ${assignee.name} — free that period.`);
  saveRequests(reqs);
  // Tell the classroom sender's LCD who is covering (if the request came from a signal).
  if (r.senderID) addSenderNotification(r.senderID, 'accepted', assignee.name);
  return {
    request: r,
    autoAssigned: !manual,
    needsManual: false,
    assignee: { id: assignee.id, name: assignee.name },
  };
}

function denyRequest(reqId, note) {
  const reqs = getRequests();
  const r = reqs.find((x) => x.id === reqId);
  if (!r) throw new Error('Request not found.');
  if (r.status !== 'pending' && r.status !== 'needs-assignment') {
    throw new Error('This request has already been processed.');
  }
  r.status = 'denied';
  r.adminNote = String(note || '').trim();
  saveRequests(reqs);
  // Tell the classroom sender's LCD the request was rejected.
  if (r.senderID) addSenderNotification(r.senderID, 'rejected', r.adminNote || 'Request denied by admin');
  return r;
}

function listRequestsFor(user) {
  const reqs = getRequests();
  const sorted = reqs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (user.role === 'admin') return sorted;
  return sorted.filter((r) => r.teacherId === user.id);
}

/** Cover duties assigned to a teacher (requests by other teachers assigned to them). */
function coversFor(userId) {
  return getRequests()
    .filter((r) => r.status === 'approved' && r.assignedTo === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/* ------------------------------------------------------------------ *
 *  Messages (admin <-> teacher, realtime via SSE)
 * ------------------------------------------------------------------ */

function getMessages() {
  return load('messages.json', []);
}

async function getMessagesAsync() {
  return loadCol('messages', []);
}

function saveMessages(msgs) {
  save('messages.json', msgs);
}

async function saveMessagesAsync(msgs) {
  await saveCol('messages', msgs);
}

/** Send a direct message from `fromUser` to the user with id `toId`. */
function sendMessage(fromUser, { toId, text, senderID }) {
  const to = getUsers().find((u) => u.id === toId);
  if (!to) throw new Error('Recipient not found.');
  const msgText = String(text == null ? '' : text).trim();
  if (!msgText) throw new Error('Message cannot be empty.');
  if (msgText.length > 1000) throw new Error('Message is too long (max 1000 characters).');
  const msg = {
    id: 'm_' + crypto.randomBytes(6).toString('hex'),
    fromId: fromUser.id,
    fromName: fromUser.name,
    toId: to.id,
    toName: to.name,
    text: msgText,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  const msgs = getMessages();
  msgs.push(msg);
  saveMessages(msgs);
  // Admin messages can also surface on the classroom sender's LCD.
  if (fromUser.role === 'admin' && validSenderID(Number(senderID))) {
    addSenderNotification(Number(senderID), 'message', msgText);
  }
  return msg;
}

/** All messages involving a user, newest first. */
function messagesFor(userId) {
  return getMessages()
    .filter((m) => m.fromId === userId || m.toId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Mark every message addressed to this user as read; returns true if any changed. */
function markMessagesRead(userId) {
  const msgs = getMessages();
  let changed = false;
  msgs.forEach((m) => {
    if (m.toId === userId && !m.readAt) {
      m.readAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) saveMessages(msgs);
  return changed;
}

/* ------------------------------------------------------------------ *
 *  Stats
 * ------------------------------------------------------------------ */

function getStats() {
  const reqs = getRequests();
  const tt = getTimetable();
  return {
    teachers: getUsers().filter((u) => u.role === 'teacher').length,
    classes: tt.classes.length,
    pending: reqs.filter((r) => r.status === 'pending').length,
    needsAssignment: reqs.filter((r) => r.status === 'needs-assignment').length,
    approved: reqs.filter((r) => r.status === 'approved').length,
    denied: reqs.filter((r) => r.status === 'denied').length,
    covers: reqs.filter((r) => r.status === 'approved' && r.assignedTo).length,
    totalPeriods: tt.classes.length * tt.days.length * tt.periods.length,
  };
}

/* ------------------------------------------------------------------ *
 *  ESP32 signal monitor
 * ------------------------------------------------------------------ */

/** Keep at most this many signals in the history. */
const SIGNAL_LIMIT = 500;

/** Load { master, history, senders } from signals.json (history stored newest-first). */
function getSignals() {
  const data = load('signals.json', { master: { lastSeenAt: null }, history: [] });
  if (!Array.isArray(data.history)) data.history = [];
  if (!Array.isArray(data.senders)) data.senders = [];
  if (!Array.isArray(data.notifications)) data.notifications = [];
  if (!data.master || typeof data.master !== 'object') data.master = { lastSeenAt: null };
  return data;
}

async function getSignalsAsync() {
  const c = col('signals');
  if (c) {
    const doc = await c.findOne({ _id: 'singleton' }, { projection: { _id: 0 } });
    if (!doc) return { master: { lastSeenAt: null }, history: [], senders: [], notifications: [] };
    if (!Array.isArray(doc.history)) doc.history = [];
    if (!Array.isArray(doc.senders)) doc.senders = [];
    if (!Array.isArray(doc.notifications)) doc.notifications = [];
    if (!doc.master || typeof doc.master !== 'object') doc.master = { lastSeenAt: null };
    return doc;
  }
  return getSignals();
}

function saveSignals(data) {
  save('signals.json', data);
}

async function saveSignalsAsync(data) {
  const c = col('signals');
  if (c) {
    await c.updateOne({ _id: 'singleton' }, { $set: data }, { upsert: true });
    return;
  }
  saveSignals(data);
}

function senderName(senderID) {
  return senderID >= 1 && senderID <= 4 ? 'Sender ' + senderID : '';
}

function validSenderID(id) {
  return Number.isInteger(id) && id >= 1 && id <= 4;
}

/**
 * Queue a status update for one sender's classroom LCD. The ESP32 Master
 * polls these and forwards them to the sender over UDP on its own network.
 */
function addSenderNotification(senderID, type, text) {
  const data = getSignals();
  data.notifications.push({
    id: 'n_' + crypto.randomBytes(6).toString('hex'),
    senderID,
    type,
    text: String(text || ''),
    createdAt: new Date().toISOString(),
    delivered: false,
  });
  if (data.notifications.length > 200) data.notifications = data.notifications.slice(-200);
  saveSignals(data);
}

/**
 * Undelivered notifications for the Master (marks them delivered, read-once).
 * Text is sanitized for the Master's line-based parser: no '|', no newlines.
 */
function getPendingNotifications() {
  const data = getSignals();
  const pending = (data.notifications || []).filter((n) => !n.delivered);
  if (pending.length) {
    (data.notifications || []).forEach((n) => { n.delivered = true; });
    saveSignals(data);
  }
  return pending.map((n) => ({
    senderID: n.senderID,
    type: String(n.type || '').replace(/[^A-Za-z]/g, '').slice(0, 12),
    text: String(n.text || '').replace(/[|\r\n]/g, ' ').slice(0, 40),
  }));
}

/** Today's timetable day name, e.g. "Monday" ('' if not a school day). */
function todayDayName() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * The timetable period currently in session, matched against the period
 * label's time range (e.g. "Period 3 · 10:30–11:15"). Returns '' when the
 * server clock is outside every period (lunch, breaks, after school).
 */
function currentPeriod(tt) {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const p of (tt.periods || [])) {
    const m = String(p).match(/(\d{1,2}):(\d{2})\s*(?:–|-|to)\s*(\d{1,2}):(\d{2})/i);
    if (!m) continue;
    const start = +m[1] * 60 + +m[2];
    const end = +m[3] * 60 + +m[4];
    if (mins >= start && mins < end) return p;
  }
  return '';
}

/**
 * Resolve the class/teacher context for a signal: which class the sender's
 * D1 Mini is mounted in, who is scheduled to teach it right now, and the
 * subject of the current period. This powers the "go to your class" flow.
 */
function resolveSignalContext(id) {
  const data = getSignals();
  const cfg = (data.senders || []).find((s) => s.senderID === id);
  const className = (cfg && cfg.className) || '';
  if (!className) return { className: '', day: '', period: '', subject: '', teacher: '' };
  const tt = getTimetable();
  const day = todayDayName();
  // Outside school days or outside every period's clock range → no class now.
  if (!day || !(tt.days || []).includes(day)) {
    return { className, day, period: '', subject: '', teacher: '' };
  }
  const period = currentPeriod(tt);
  if (!period) return { className, day, period: '', subject: '', teacher: '' };
  const cell = slotCell(tt, className, day, period) || { subject: '', teacher: '' };
  const bySubject = subjectToTeachers();
  return {
    className,
    day,
    period,
    subject: cell.subject || '',
    teacher: cellTeacher(tt, className, day, period, bySubject),
  };
}

/**
 * Validate + store a signal from the ESP32 Master.
 * Accepted payload: { senderID: 1-4, message: string, timestamp?: string }.
 * If the sender is assigned to a class, the record is enriched with the
 * class, current day/period, subject and the teacher who should be there.
 */
function addSignal({ senderID, message, timestamp }) {
  const id = Number(senderID);
  if (!validSenderID(id)) throw new Error('senderID must be an integer from 1 to 4.');
  const msg = String(message == null ? '' : message).trim();
  if (!msg) throw new Error('message is required.');
  if (msg.length > 64) throw new Error('message is too long (max 64 characters).');
  // A "CANCEL" message withdraws the still-pending request that sender started.
  if (msg.toUpperCase() === 'CANCEL') return cancelSignalRequest(id);
  const now = new Date();
  const given = String(timestamp || '').trim();
  const ctx = resolveSignalContext(id);
  const record = {
    id: 'sig_' + crypto.randomBytes(6).toString('hex'),
    senderID: id,
    sender: senderName(id),
    message: msg,
    timestamp: given || now.toISOString(),
    receivedAt: now.toISOString(),
    className: ctx.className,
    day: ctx.day,
    period: ctx.period,
    subject: ctx.subject,
    teacher: ctx.teacher,
  };
  const data = getSignals();
  data.history.unshift(record);
  if (data.history.length > SIGNAL_LIMIT) data.history.length = SIGNAL_LIMIT;
  data.master.lastSeenAt = now.toISOString();
  saveSignals(data);

  // If a teacher is scheduled for that class right now, message them directly
  // (they see it on their Messages page) and let the sender's LCD show that
  // they were informed of the class.
  if (record.teacher) {
    const absent = getUsers().find((u) => u.role === 'teacher' && u.name === record.teacher);
    const admin = getUsers().find((u) => u.role === 'admin');
    if (absent && admin) {
      sendMessage(admin, {
        toId: absent.id,
        text: `Your class ${record.className} · ${String(record.period).split(' · ')[0]} is waiting — no teacher has arrived. The admin has been notified.`,
      });
    }
    addSenderNotification(id, 'informed', `${record.teacher} was informed of the class`);
  }
  return { kind: 'signal', record };
}

/**
 * The sender's CANCEL button: withdraw the still-pending request that was
 * started from this classroom's signal (if any) and tell the sender's LCD.
 */
function cancelSignalRequest(senderID) {
  const reqs = getRequests();
  const r = reqs.find(
    (x) => x.senderID === senderID && (x.status === 'pending' || x.status === 'needs-assignment')
  );
  if (!r) {
    addSenderNotification(senderID, 'cancelled', 'No pending request to cancel');
    return { kind: 'cancel', cancelled: false, request: null };
  }
  r.status = 'cancelled';
  r.adminNote = 'Cancelled from the classroom sender.';
  saveRequests(reqs);
  addSenderNotification(senderID, 'cancelled', 'Request cancelled');
  return { kind: 'cancel', cancelled: true, request: r };
}

/** Admin assigns a sender (D1 Mini) to a class. Empty class name unassigns. */
function setSenderClass(senderID, className) {
  const id = Number(senderID);
  if (!validSenderID(id)) throw new Error('senderID must be an integer from 1 to 4.');
  const cls = String(className == null ? '' : className).trim();
  const tt = getTimetable();
  if (cls && !tt.classes.includes(cls)) throw new Error(`Unknown class "${cls}".`);
  const data = getSignals();
  let cfg = (data.senders || []).find((s) => s.senderID === id);
  if (!cfg) {
    cfg = { senderID: id, className: '' };
    data.senders.push(cfg);
  }
  cfg.className = cls;
  saveSignals(data);
  return getSignalState();
}

/** Clear the signal history (keeps the master's last-seen info). */
function clearSignals() {
  const data = getSignals();
  data.history = [];
  saveSignals(data);
  return getSignalState();
}

/** Public state for clients: master info + senders config + newest-first history. */
function getSignalState() {
  const data = getSignals();
  return {
    master: { lastSeenAt: data.master.lastSeenAt },
    senders: [1, 2, 3, 4].map((id) => {
      const cfg = (data.senders || []).find((s) => s.senderID === id);
      return { senderID: id, className: (cfg && cfg.className) || '' };
    }),
    history: data.history,
  };
}

/* ------------------------------------------------------------------ *
 *  Sample template files (not database data)
 * ------------------------------------------------------------------ */

/** Build the sample timetable rows (a blank per-class grid for .xlsx/.csv). */
function sampleRows() {
  const rows = [['Period', ...SAMPLE_DAYS]];
  SAMPLE_PERIODS.forEach((p) => rows.push([p, ...SAMPLE_DAYS.map(() => '')]));
  return rows;
}

/** Regenerate sample-timetable.xlsx / .csv in the project root (templates only). */
function writeSampleFiles() {
  const rows = sampleRows();
  try {
    fs.writeFileSync(path.join(PROJECT_ROOT, 'sample-timetable.xlsx'), xlsx.writeXlsx([{ name: 'Timetable', rows }]));
    fs.writeFileSync(path.join(PROJECT_ROOT, 'sample-timetable.csv'), xlsx.writeCsv(rows), 'utf8');
  } catch (e) {
    console.error('[db] Could not write sample files:', e.message);
  }
}

/* ------------------------------------------------------------------ *
 *  First-run bootstrap + migration
 * ------------------------------------------------------------------ */

/** Fixed IDs used by the v1.0 demo seeds (used for one-time cleanup). */
const LEGACY_DEMO_USER_IDS = ['u_priya', 'u_rahul', 'u_sneha', 'u_amit', 'u_farhan', 'u_meera'];

function removeIfExists(p) {
  try { fs.unlinkSync(p); } catch (e) { /* already gone */ }
}

function seedIfNeeded() {
  ensureDir();
  const usersPath = path.join(DATA_DIR, 'users.json');

  // Users: bootstrap admin only (no demo accounts)
  if (fs.existsSync(usersPath)) {
    const users = load('users.json', []);
    if (users.some((u) => LEGACY_DEMO_USER_IDS.includes(u.id))) {
      save('users.json', users.filter((u) => !LEGACY_DEMO_USER_IDS.includes(u.id)));
      removeIfExists(path.join(DATA_DIR, 'requests.json'));
      removeIfExists(path.join(DATA_DIR, 'sessions.json'));
      console.log('[db] Removed old v1.0 demo accounts — the sample starts clean.');
    }
  } else {
    const { salt, hash } = hashPassword('admin123');
    save('users.json', [
      {
        id: 'u_admin',
        name: 'Administrator',
        username: 'admin',
        role: 'admin',
        subject: 'Administration',
        email: 'admin@school.edu',
        salt,
        hash,
        createdAt: new Date().toISOString(),
      },
    ]);
    console.log('[db] Created initial admin account  →  admin / admin123');
  }

  // Timetable: default classwise timetable (created once, replaced if legacy)
  const ttPath = path.join(DATA_DIR, 'timetable.json');
  if (!fs.existsSync(ttPath)) {
    save('timetable.json', buildDefaultTimetable());
    console.log('[db] Seeded default classwise timetable (9A · 9B · 10A · 10B).');
  } else {
    const tt = load('timetable.json', null);
    if (!tt || !tt.classes || !tt.classes.length) {
      save('timetable.json', buildDefaultTimetable());
      console.log('[db] Replaced legacy timetable with the default classwise timetable.');
    }
  }

  writeSampleFiles();
  // Ensure all existing teachers have a mobile number (default: 8750441860)
  const users = load('users.json', []);
  let mobileFixed = 0;
  users.forEach((u) => {
    if (u.role === 'teacher' && !u.mobile) {
      u.mobile = '8750441860';
      mobileFixed++;
    }
  });
  if (mobileFixed) save('users.json', users);

  console.log('[db] Local data store ready (data/). Teachers and requests start empty.');
}

module.exports = {
  DATA_DIR,
  SUBJECTS,
  seedIfNeeded,
  connectMongo,
  disconnectMongo,
  getUsers,
  getUsersAsync,
  saveUsers,
  saveUsersAsync,
  getTimetable,
  saveTimetable,
  getTimetableAsync,
  saveTimetableAsync,
  getTimetableResolved,
  getRequests,
  getRequestsAsync,
  saveRequests,
  saveRequestsAsync,
  publicUser,
  findByUsername,
  findByCredentials,
  createSession,
  getSessionUser,
  destroySession,
  listTeachers,
  createTeacher,
  updateTeacher,
  deleteTeacher,
  setupTeachers,
  saveTimetableFromClient,
  slotCell,
  cellTeacher,
  freeTeachersAt,
  coverCount,
  createRequest,
  approveRequest,
  denyRequest,
  listRequestsFor,
  coversFor,
  getStats,
  getSignals,
  getSignalsAsync,
  saveSignalsAsync,
  addSignal,
  setSenderClass,
  clearSignals,
  getSignalState,
  getPendingNotifications,
  getMessages,
  getMessagesAsync,
  saveMessagesAsync,
  sendMessage,
  messagesFor,
  markMessagesRead,
  sampleRows,
  writeSampleFiles,
};
