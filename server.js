/**
 * EduFlow — Teacher Dashboard & Substitution Management System (sample)
 * ----------------------------------------------------------------------
 * Zero-dependency local server. No database server, no npm packages.
 *   node server.js   →   http://localhost:3000
 */
'use strict';

require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const db = require('./lib/db');

// ── Twilio client (lazy init) ──
let twilioClient = null;
function getTwilio() {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  if (!sid || !token || sid.includes('your_')) return null;
  try {
    const twilio = require('twilio');
    twilioClient = twilio(sid, token);
    console.log('[call] Twilio client initialized.');
    return twilioClient;
  } catch (e) {
    console.error('[call] Twilio init failed:', e.message);
    return null;
  }
}

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'eduf_sid';

/* ------------------------------------------------------------------ *
 *  Tiny HTTP helpers
 * ------------------------------------------------------------------ */

function json(res, status, data) {
  const body = JSON.stringify(data);
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      let v = part.slice(i + 1).trim();
      try { v = decodeURIComponent(v); } catch (e) { /* keep raw */ }
      out[k] = v;
    }
  });
  return out;
}

function setCookie(res, value, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

/** Parse a multipart/form-data body into { fieldName: value|{filename,data} }. */
async function parseMultipart(req) {
  const buf = await readBody(req, 25 * 1024 * 1024);
  const ct = req.headers['content-type'] || '';
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error('Missing multipart boundary.');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {};
  let idx = 0;
  while (true) {
    const start = buf.indexOf(boundary, idx);
    if (start === -1) break;
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const chunk = buf.slice(start + boundary.length, next);
    const headEnd = chunk.indexOf('\r\n\r\n');
    if (headEnd === -1) { idx = next + boundary.length; continue; }
    const headers = chunk.slice(0, headEnd).toString('utf8');
    const content = chunk.slice(headEnd + 4, chunk.length >= 2 ? chunk.length - 2 : 0); // strip trailing CRLF
    const nameMatch = headers.match(/name="([^"]+)"/);
    const fileMatch = headers.match(/filename="([^"]+)"/);
    if (nameMatch) {
      fields[nameMatch[1]] = fileMatch
        ? { filename: fileMatch[1], data: content }
        : content.toString('utf8');
    }
    idx = next + boundary.length;
  }
  return fields;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    urlPath = '/';
  }
  if (urlPath === '/') urlPath = '/index.html';
  const base = path.resolve(PUBLIC_DIR);
  const resolved = path.resolve(base, '.' + urlPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return json(res, 403, { error: 'Forbidden' });
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>404</title><body style="font-family:sans-serif;display:grid;place-items:center;height:90vh"><div><h1>404</h1><p>Page not found — <a href="/">back to dashboard</a></p></div>');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ *
 *  Router
 * ------------------------------------------------------------------ */

function matchPath(pattern, pathname) {
  const pp = pattern.split('/');
  const up = pathname.split('/');
  if (pp.length !== up.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) {
      params[pp[i].slice(1)] = decodeURIComponent(up[i]);
    } else if (pp[i] !== up[i]) {
      return null;
    }
  }
  return params;
}

const routes = [];

function route(method, pattern, handler, opts = {}) {
  routes.push({ method, pattern, handler, auth: true, admin: false, ...opts });
}

/* ----- auth endpoints ----- */

route('POST', '/api/auth/login', async (req, res) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  const { username, password } = body;
  if (!username || !password) return json(res, 400, { error: 'Username and password are required.' });
  const user = db.findByCredentials(username, password);
  if (!user) return json(res, 401, { error: 'Invalid username or password.' });
  const sid = db.createSession(user.id);
  setCookie(res, sid, 60 * 60 * 8); // 8h
  json(res, 200, { user: db.publicUser(user) });
}, { auth: false });

route('POST', '/api/auth/logout', async (req, res) => {
  const cookies = parseCookies(req);
  db.destroySession(cookies[SESSION_COOKIE]);
  clearCookie(res);
  json(res, 200, { ok: true });
}, { auth: false });

route('GET', '/api/me', async (req, res) => {
  json(res, 200, { user: db.publicUser(req.user) });
});

/* ----- teachers (admin) ----- */

route('GET', '/api/teachers', async (req, res) => {
  json(res, 200, { teachers: db.listTeachers() });
}, { admin: true });

route('POST', '/api/teachers', async (req, res) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  try {
    const teacher = db.createTeacher(body);
    pushToAdmins(); // staff list + stats update instantly
    json(res, 201, { teacher });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

route('PUT', '/api/teachers/:id', async (req, res, params) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  try {
    const teacher = db.updateTeacher(params.id, body);
    pushToAdmins();
    json(res, 200, { teacher });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

route('DELETE', '/api/teachers/:id', async (req, res, params) => {
  try {
    const removed = db.deleteTeacher(params.id);
    pushToAdmins();
    json(res, 200, { ok: true, teacher: removed });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

/** One-click setup: rebuild the weighted timetable + create ~24 teachers. */
route('POST', '/api/setup/teachers', async (req, res) => {
  try {
    const result = db.setupTeachers();
    pushToAllUsers(); // timetable + stats refresh everywhere instantly
    json(res, 200, result);
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

/* ----- timetable ----- */

route('GET', '/api/timetable', async (req, res) => {
  json(res, 200, { timetable: db.getTimetableResolved() });
});

route('POST', '/api/timetable', async (req, res) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  try {
    const tt = db.saveTimetableFromClient(body.timetable || body);
    pushToAllUsers(); // every teacher's schedule updates instantly
    json(res, 200, { timetable: tt });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

route('POST', '/api/timetable/upload', async (req, res) => {
  let fields;
  try {
    fields = await parseMultipart(req);
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
  const file = fields.file;
  if (!file || !file.data || !file.data.length) {
    return json(res, 400, { error: 'No file uploaded.' });
  }
  try {
    const current = db.getTimetable();
    const targetClass = String(fields.className || (current.classes[0] || '9A'));
    const parsed = require('./lib/xlsx').parseTimetableFile(file.filename || 'timetable.xlsx', file.data);

    // Map the teacher-based grid onto one class: each cell = { subject, teacher }
    // where the subject is auto-derived from the teacher's registered subject.
    const byName = new Map(db.getUsers().map((u) => [u.name.trim().toLowerCase(), u.subject || '']));
    const known = new Set(db.getUsers().map((u) => u.name.trim().toLowerCase()));
    const warnings = new Set();
    const slots = {};
    slots[targetClass] = {};
    parsed.days.forEach((d) => {
      slots[targetClass][d] = {};
      parsed.periods.forEach((p) => {
        const teacher = String(parsed.slots[d][p] || '').trim();
        const subject = teacher ? (byName.get(teacher.toLowerCase()) || '') : '';
        if (teacher && !known.has(teacher.toLowerCase())) warnings.add(teacher);
        slots[targetClass][d][p] = { subject, teacher };
      });
    });

    json(res, 200, {
      targetClass,
      days: parsed.days,
      periods: parsed.periods,
      slots,
      warnings: [...warnings],
      source: parsed.source,
    });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

/* ----- requests ----- */

route('GET', '/api/requests', async (req, res) => {
  json(res, 200, { requests: db.listRequestsFor(req.user) });
});

route('POST', '/api/requests', async (req, res) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  try {
    const r = db.createRequest(req.user, body);
    pushRealtime([req.user.id, ...adminIds()]); // admin sees it instantly; teacher's list stays in sync
    json(res, 201, { request: r });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { auth: true, admin: false });

route('POST', '/api/requests/:id/action', async (req, res, params) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  const { action, assignedTo, note } = body;
  try {
    if (action === 'approve') {
      const result = db.approveRequest(params.id, assignedTo || null, note || '');
      pushRealtime([result.request.teacherId, ...adminIds(), result.assignee ? result.assignee.id : null].filter(Boolean));
      json(res, 200, result);
    } else if (action === 'deny') {
      const r = db.denyRequest(params.id, note || '');
      pushRealtime([r.teacherId, ...adminIds()]);
      json(res, 200, { request: r });
    } else {
      json(res, 400, { error: 'Unknown action. Use "approve" or "deny".' });
    }
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

route('GET', '/api/covers', async (req, res) => {
  json(res, 200, { covers: db.coversFor(req.user.id) });
});

/* ----- stats (admin) ----- */

route('GET', '/api/stats', async (req, res) => {
  json(res, 200, { stats: db.getStats() });
}, { admin: true });

/* ----- ESP32 signal monitor ----- */

const SIGNAL_TOKEN = process.env.SIGNAL_TOKEN || '';
const SSE_KEEPALIVE_MS = 15000;
const sseClients = new Set();

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastSse(event, data) {
  sseClients.forEach((res) => {
    try {
      sseSend(res, event, data);
    } catch (e) {
      sseClients.delete(res);
    }
  });
}

/**
 * Endpoint the ESP32 Master calls (over the internet) to report a signal.
 *   POST /api/signal
 *   { "senderID": 1, "message": "SIGNAL", "timestamp": "2026-08-13T13:25:04" }
 * Validates the payload, stores it, and broadcasts it to every connected
 * browser via Server-Sent Events. If SIGNAL_TOKEN is set (env var), the
 * request must include an `x-signal-token` header with the same value.
 */
route('POST', '/api/signal', async (req, res) => {
  if (SIGNAL_TOKEN && req.headers['x-signal-token'] !== SIGNAL_TOKEN) {
    return json(res, 401, { error: 'Invalid signal token.' });
  }
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  try {
    const result = db.addSignal(body);
    if (result.kind === 'cancel') {
      // A sender's CANCEL button: withdraw the pending request, update the
      // requester's + admins' live dashboards.
      if (result.request) pushRealtime([result.request.teacherId, ...adminIds()]);
      json(res, 200, { ok: true, cancelled: result.cancelled });
    } else {
      broadcastSse('signal', { signal: result.record });
      json(res, 201, { ok: true, signal: result.record });
      // ── Auto-call the absent teacher via Twilio ──
      if (result.record && result.record.teacher) {
        callAbsentTeacher(result.record).catch((e) =>
          console.error('[call] Error calling teacher:', e.message)
        );
      }
    }
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { auth: false });

/** Server-Sent Events stream: pushes `state`, `signal` and `clear` events. */
route('GET', '/api/signal/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Send the current snapshot first, then keep the connection open.
  sseSend(res, 'state', db.getSignalState());
  sseClients.add(res);
  const keep = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (e) { /* client gone */ }
  }, SSE_KEEPALIVE_MS);
  req.on('close', () => {
    clearInterval(keep);
    sseClients.delete(res);
  });
}, { auth: false });

route('GET', '/api/signal/history', async (req, res) => {
  json(res, 200, db.getSignalState());
});

/**
 * Polled by the ESP32 Master: returns undelivered sender-LCD updates as
 * plain-text lines "senderID|type|text" and marks them delivered (read-once).
 *   type: informed | accepted | rejected | message
 * Kept text-only so the firmware doesn't need a JSON parser.
 */
route('GET', '/api/signal/notifications', async (req, res) => {
  if (SIGNAL_TOKEN && req.headers['x-signal-token'] !== SIGNAL_TOKEN) {
    return json(res, 401, { error: 'Invalid signal token.' });
  }
  const notes = db.getPendingNotifications();
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(notes.map((n) => `${n.senderID}|${n.type}|${n.text}`).join('\n'));
}, { auth: false });

/** Admin assigns a sender (D1 Mini) to a class: { senderID, className } */
route('POST', '/api/signal/senders', async (req, res) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  try {
    const state = db.setSenderClass(body.senderID, body.className);
    broadcastSse('state', state);
    json(res, 200, { ok: true, state });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
}, { admin: true });

route('DELETE', '/api/signal/history', async (req, res) => {
  const state = db.clearSignals();
  broadcastSse('clear', { ok: true });
  json(res, 200, { ok: true, state });
}, { admin: true });

/* ------------------------------------------------------------------ *
 *  Realtime (authenticated SSE) — requests, covers, messages, stats
 * ------------------------------------------------------------------ */

const userSse = new Map(); // userId -> Set<ServerResponse>

function userStreams(userId) {
  let set = userSse.get(userId);
  if (!set) { set = new Set(); userSse.set(userId, set); }
  return set;
}

function broadcastToUser(userId, event, data) {
  userStreams(userId).forEach((res) => {
    try { sseSend(res, event, data); } catch (e) { userStreams(userId).delete(res); }
  });
}

function adminIds() {
  return db.getUsers().filter((u) => u.role === 'admin').map((u) => u.id);
}

/** Fresh personalized snapshot for one user (sent on connect + after changes). */
function snapshotFor(user) {
  const snap = {
    requests: db.listRequestsFor(user),
    messages: db.messagesFor(user.id),
    timetable: db.getTimetableResolved(),
  };
  if (user.role === 'admin') snap.stats = db.getStats();
  else snap.covers = db.coversFor(user.id);
  return snap;
}

/** Push a fresh snapshot to every listed user who has an open stream. */
function pushRealtime(userIds) {
  const seen = new Set();
  userIds.forEach((id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (userStreams(id).size) {
      const u = db.getUsers().find((x) => x.id === id);
      if (u) broadcastToUser(id, 'data', snapshotFor(u));
    }
  });
}

function pushToAdmins() { pushRealtime(adminIds()); }
function pushToAllUsers() { pushRealtime(db.getUsers().map((u) => u.id)); }

route('GET', '/api/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  sseSend(res, 'data', snapshotFor(req.user));
  userStreams(req.user.id).add(res);
  const keep = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (e) { /* client gone */ }
  }, SSE_KEEPALIVE_MS);
  req.on('close', () => {
    clearInterval(keep);
    userStreams(req.user.id).delete(res);
  });
});

/* ----- messages (admin <-> teacher, realtime) ----- */

route('GET', '/api/messages', async (req, res) => {
  json(res, 200, { messages: db.messagesFor(req.user.id) });
});

route('POST', '/api/messages', async (req, res) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  try {
    const msg = db.sendMessage(req.user, body);
    pushRealtime([req.user.id, msg.toId]); // both sides see it in real time
    json(res, 201, { message: msg });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

route('POST', '/api/messages/read', async (req, res) => {
  db.markMessagesRead(req.user.id);
  json(res, 200, { messages: db.messagesFor(req.user.id) });
});

/* ----- test call (admin) ----- */

route('POST', '/api/call/test', async (req, res) => {
  const body = await parseJson(req);
  if (!body) return json(res, 400, { error: 'Invalid request body.' });
  const { teacherId } = body;
  if (!teacherId) return json(res, 400, { error: 'teacherId is required.' });
  const users = db.getUsers();
  const teacher = users.find((u) => u.id === teacherId && u.role === 'teacher');
  if (!teacher) return json(res, 404, { error: 'Teacher not found.' });
  if (!teacher.mobile) return json(res, 400, { error: 'Teacher has no mobile number.' });
  const client = getTwilio();
  if (!client || !TWILIO_PHONE || TWILIO_PHONE.includes('your_')) {
    return json(res, 400, { error: 'Twilio is not configured. Set TWILIO_* in .env file.' });
  }
  const to = teacher.mobile.startsWith('+') ? teacher.mobile : '+91' + teacher.mobile;
  try {
    const call = await client.calls.create({
      to,
      from: TWILIO_PHONE,
      twiml: `<Response><Say voice="Polly.Matthew">Hello ${teacher.name}. This is a test call from EduFlow. Your mobile number is registered correctly.</Say></Response>`,
    });
    json(res, 200, { ok: true, sid: call.sid, to, teacher: teacher.name });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}, { admin: true });

/* ------------------------------------------------------------------ *
 *  Twilio calling — auto-call absent teacher when D1 Mini button is pressed
 * ------------------------------------------------------------------ */

/**
 * When a signal arrives for an absent teacher, call their registered
 * mobile number via Twilio. Uses the Twilio REST API to initiate an
 * outbound call with a TwiML message.
 */
async function callAbsentTeacher(record) {
  const client = getTwilio();
  const from = TWILIO_PHONE;
  if (!client || !from || from.includes('your_')) {
    console.log('[call] Twilio not configured — skipping call for', record.teacher);
    return null;
  }
  // Find the absent teacher's mobile number
  const users = db.getUsers();
  const teacher = users.find(
    (u) => u.role === 'teacher' && u.name === record.teacher
  );
  if (!teacher || !teacher.mobile) {
    console.log('[call] No mobile number for', record.teacher, '— skipping call.');
    return null;
  }
  const to = teacher.mobile.startsWith('+') ? teacher.mobile : '+91' + teacher.mobile;
  const periodShort = String(record.period || '').split(' · ')[0];
  try {
    const call = await client.calls.create({
      to,
      from,
      twiml: `<Response><Say voice="Polly.Matthew">Attention ${teacher.name}. Your class ${record.className} ${periodShort} is waiting. No teacher has arrived. Please go to your class immediately. This is an automated call from EduFlow.</Say></Response>`,
    });
    console.log(`[call] Called ${teacher.name} (${to}) — SID: ${call.sid}`);
    return call;
  } catch (e) {
    console.error(`[call] Failed to call ${teacher.name} (${to}):`, e.message);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 *  Server
 * ------------------------------------------------------------------ */

async function handleApi(req, res, pathname) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const params = matchPath(r.pattern, pathname);
    if (!params) continue;

    // auth
    let user = null;
    if (r.auth) {
      const cookies = parseCookies(req);
      user = db.getSessionUser(cookies[SESSION_COOKIE]);
      if (!user) return json(res, 401, { error: 'Not authenticated. Please log in.' });
      req.user = user;
    }
    if (r.admin && user.role !== 'admin') {
      return json(res, 403, { error: 'Admin access required.' });
    }
    return r.handler(req, res, params);
  }
  json(res, 404, { error: 'API route not found.' });
}

const server = http.createServer(async (req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error.' });
  }
});

async function start() {
  // Connect to MongoDB if MONGODB_URI is configured
  try {
    await db.connectMongo();
  } catch (e) {
    console.error('[server] MongoDB connection failed:', e.message);
    console.log('[server] Falling back to local JSON file storage.');
  }

  db.seedIfNeeded();

  server.listen(PORT, () => {
    console.log('────────────────────────────────────────────────────');
    console.log('  EduFlow · Teacher Dashboard');
    console.log(`  →  http://localhost:${PORT}`);
    console.log('  Initial account : admin / admin123');
    if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('your_') && !process.env.MONGODB_URI.includes('<')) {
      console.log('  Storage         : MongoDB');
    } else {
      console.log('  Storage         : Local JSON files (data/)');
    }
    if (getTwilio()) {
      console.log('  Calling         : Twilio (auto-call absent teachers)');
    } else {
      console.log('  Calling         : Not configured (set TWILIO_* in .env)');
    }
    console.log('────────────────────────────────────────────────────');
  });
}

start().catch((e) => {
  console.error('[server] Fatal error:', e);
  process.exit(1);
});
