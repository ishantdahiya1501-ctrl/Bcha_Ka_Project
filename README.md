# 🎓 EduFlow — Teacher Dashboard & Substitution Management

A complete teacher dashboard with **two roles** (Admin + Teachers), **Excel timetable upload**, **smart auto-assigned substitution requests**, **Twilio-powered teacher calling**, and **MongoDB support** — built with vanilla HTML/CSS/JS frontend and Node.js backend.

> **Production-ready**: uses MongoDB for persistent storage and can be deployed to Render. Also works locally with zero dependencies (JSON file storage).

## 🆕 v2.0 — What's New

| Feature | Details |
|---|---|
| 📱 **Teacher mobile numbers** | Registration now collects a **mobile number** for each teacher. Existing teachers default to `8750441860`. |
| 📞 **Auto-call absent teachers** | When a D1 Mini button is pressed and the scheduled teacher is absent, the system **automatically calls them via Twilio** with an urgent TTS message. |
| 🧪 **Test call button** | Admin can **test-call any teacher** from the Teachers page to verify their Twilio integration. |
| 🗄️ **MongoDB support** | Set `MONGODB_URI` in `.env` to use MongoDB instead of local JSON files. Falls back to JSON when not configured. |
| 🚀 **Render deployment** | Ready for one-click deploy to Render. All secrets via `.env` file. |
| 📱 **Mobile-responsive UI** | Full phone support — hamburger sidebar, touch-friendly buttons, slide-up modals, iOS zoom prevention. |

---

## ✨ Features

| Area | What it does |
|---|---|
| 🔐 **Login / roles** | The site opens with a login screen. Admin sees the **admin panel**; teachers see their **personal dashboard**. |
| 👩‍🏫 **Teacher registration** | The admin registers teachers with a **subject picked from a dropdown** and a **mobile number** — subjects stay consistent, mobile enables Twilio calling. |
| 📅 **Class-wise timetable** | The timetable is organized **per class** (e.g. 9A, 9B, 10A, 10B). Each cell is a **subject + teacher** pair; teachers auto-match subject cells when they're the only teacher of that subject. Admin can **edit the period times** (Edit times button) — the signal monitor matches signals against the clock using these times. |
| 📊 **Default timetable** | A **weighted default classwise timetable** is seeded on first run — Maths, English and a science subject appear **every day** per class, minor subjects a few times a week — so the app is usable immediately, no upload required. |
| 🔁 **Substitution requests** | A teacher requests a period off (day + period + date + reason). |
| ✅ **Admin approval** | When the admin approves, the system **auto-assigns the best free teacher** for that period. If nobody is free, the admin is asked to **pick a teacher manually**. |
| 📋 **Cover duties** | Assigned teachers see their cover duties on their dashboard; the requesting teacher sees who is covering them. |
| 📡 **ESP32 signal monitor** | One **ESP32 Master** + four **ESP8266 D1 Mini** senders (one per class) report absent teachers in real time. Each sender has a **request + cancel button** and its own **classroom LCD** showing the outcome — accepted (with the cover teacher's name), rejected, admin message, or cancelled. |
| 💬 **Staff messaging** | Admin ↔ teacher messages with conversation threads, unread badges, and real-time delivery — admins can message a teacher straight from the Signal Monitor. |
| 📞 **Twilio calling** | When a D1 Mini button signals an absent teacher, the system **auto-calls their mobile** via Twilio with an urgent voice message. Admin can also test-call any teacher. |
| 🗄️ **MongoDB or local** | Set `MONGODB_URI` in `.env` for MongoDB; otherwise uses local JSON files. Works both ways. |
| 📱 **Mobile-responsive** | Full phone support — hamburger menu, touch-friendly buttons, slide-up modals, iOS zoom prevention. |

---

## 🚀 Quick start

**Requirements:** Node.js ≥ 14.

### Local mode (zero config)

```bash
npm install mongodb twilio dotenv   # one-time install
node server.js
# or: npm start
```

Then open **http://localhost:3000** → log in with **`admin` / `admin123`**.

### Production mode (MongoDB + Twilio + Render)

1. Copy `.env.example` → `.env` (or edit the existing `.env`)
2. Fill in your actual credentials:
   ```
   MONGODB_URI=mongodb+srv://...
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1234567890
   ```
3. `npm install` → `node server.js`

### Deploy to Render

1. Push this repo to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Set the same env vars from your `.env` in Render's dashboard
4. Render auto-detects `package.json` and runs `npm start`

> Without `MONGODB_URI` set, the app falls back to local JSON files in `data/` — perfect for development.

On first run the app creates a `data/` folder and generates a `sample-timetable.xlsx` template.

### 🔑 Accounts

| Role | Username | Password |
|---|---|---|
| **Admin** (bootstrap) | `admin` | `admin123` |

The sample starts **clean** — no fake teachers, requests, or timetable. Only the bootstrap admin is created so you can log in. Register teachers and upload a timetable through the UI to populate it.

> 👩‍🏫 **Quick teacher setup (one click, no typing):** on the admin **Teachers** page, hit **“Setup from timetable”** — the site rebuilds a weighted timetable (Maths, English & a science subject **every day**; minor subjects like SST/AI a few times a week) and auto-creates **~24 teacher accounts** with **more teachers for important subjects** (login: subject-based username, e.g. `mathematics`, `mathematics2` … · password `1234`). Replaces existing teacher accounts — safe to re-run anytime.

> 👩‍🏫 **Alternative — CLI script:** want one teacher per timetable subject (so every cell auto-matches)? Run `node scripts/add-timetable-teachers.js` once — it creates one account per subject used in the current timetable (login: `<subject-username>` / `1234`, e.g. `mathematics` / `1234`) and removes leftover test accounts. Safe to re-run.

> 📊 A **default classwise timetable** (classes 9A · 9B · 10A · 10B, five days × six periods, subject rotations with free periods) is seeded on first run so the dashboards and request flows work immediately. Edit or replace it from the admin **Timetable** page.

> 🔁 **Reset to a clean start:** stop the server, delete the `data/` folder, run `node server.js` again.

---

## 📅 Class-wise timetable

### The model

The timetable is **class-wise**: for every **class** (9A, 9B, …) and every day × period cell there is a `{ subject, teacher }` pair. Teachers are linked to cells **by subject**:

- Register teachers with their subject (dropdown) → when exactly **one** teacher teaches a subject, that teacher is **auto-detected** in every cell of that subject (a dashed “Auto · …” option).
- With **several** teachers of the same subject, the admin picks the teacher per cell from the dropdown.
- Teachers see their schedule as **“Class · Subject”** chips (e.g. `9A · Mathematics`) across all classes they teach.

### Editing in the browser (admin)

- **Timetable → class tabs** — switch between classes; add new classes (e.g. `11A`) or remove them.
- Each cell = **subject dropdown** + **teacher dropdown** (auto-filtered by the chosen subject).
- **Clear class** empties the current class; **Save timetable** applies everything.

### Excel upload (per class)

Upload via **Timetable → Upload Excel** (admin). Pick which class the file is for, then:

| Period | Monday | Tuesday | Wednesday | Thursday | Friday |
|---|---|---|---|---|---|
| Period 1 · 08:00–08:45 | Priya Verma | Meera Nair | Farhan Khan | Amit Joshi | Sneha Iyer |
| Period 2 · 08:45–09:30 | Rahul Kapoor | Priya Verma | Meera Nair | Farhan Khan | Amit Joshi |
| Period 3 · 09:30–10:15 | Sneha Iyer | Rahul Kapoor | Priya Verma | Meera Nair | Farhan Khan |
| Period 4 · 10:30–11:15 | Amit Joshi | Sneha Iyer | Rahul Kapoor | Priya Verma | Meera Nair |
| Period 5 · 11:15–12:00 | Farhan Khan | Amit Joshi | Sneha Iyer | Rahul Kapoor | Priya Verma |
| Period 6 · 12:00–12:45 | | | Amit Joshi | | Rahul Kapoor |

Rules:
- **Row 1** = `Period, Monday, Tuesday, …`
- **Column 1** = period labels (e.g. `Period 1 · 08:00–08:45`)
- **Cells** = the **teacher's full name** → the teacher's registered subject is auto-fitted to the cell (unknown names are flagged as warnings but the file is still usable)
- **Empty cell** = free period (this is who the auto-assigner can pick)

A ready-made `sample-timetable.xlsx` / `.csv` template is generated in the project root on first run.

---

## 🔁 How substitution works (the full flow)

1. **Teacher** → *Requests* → picks a **day + period** + reason → **Submit request** (status: `Pending`).
2. **Admin** → *Dashboard* or *Requests* → sees the pending request → clicks **Approve**.
3. **Auto-assignment**:
   - The system finds teachers who are **free at that exact slot** (not teaching, not already covering).
   - It prefers the teacher with the **fewest cover duties** so far.
   - ✅ **Found one** → request becomes `Approved`, assigned automatically. Both teachers see it on their dashboards.
   - ⚠️ **Nobody free** → status becomes `Needs assignment` and a dialog lets the **admin pick a teacher manually** (with an optional note).
4. The admin can also **deny** a request with a note to the teacher.

---

## 📡 ESP32 signal monitor

The website never talks to the classroom boards directly — the ESP32 Master forwards received signals to the site over the internet:

```text
ESP8266 Sender 1 ──┐                                     ┌─ POST /api/signal ─┐
ESP8266 Sender 2 ──┤   UDP over the Master's OWN Wi-Fi   │                    ▼
ESP8266 Sender 3 ──┼──────────►  ┌──────────┐  router  ──►│───▶ Website (EduFlow)
ESP8266 Sender 4 ──┘             │  ESP32    │◀───────────│  GET /api/signal/notifications
   all join "EduFlow"            │  Master   │────────────┘  (polled every few s)
   (the Master's AP)             └──────────┘
                                 status (UDP) back to the senders
```

The **Master runs its own Wi-Fi network** (`EduFlow`) that all four senders join, and talks to them over **UDP** (port 4210) with the same packet layout the system has always used. Because every board is on the Master's own AP, sender ↔ Master always shares one channel — the school router's channel, its auto-channel changes, and any extenders/mesh nodes with the same SSID can't break the link. The Master also connects to the router as a station, purely to reach the website over HTTP.

Signals go **up** (button → UDP → Master → `POST /api/signal`); status goes **down** (Master polls `GET /api/signal/notifications` and forwards updates to the right sender's LCD over UDP).

> ⚠️ **Senders not reaching the Master?** The senders join the Master's own network (`EduFlow` — `WIFI_SSID`/`WIFI_PASSWORD` at the top of each sender sketch). If a sender prints `Wi-Fi FAILED - is the Master powered on?`, the Master's AP isn't reachable: check the Master is on and the sender's SSID/password match `master.c`. See **ESP32-README.md**.

### 🏫 Per-class flow (one ESP8266 D1 Mini in every class)

Each class has its own **ESP8266 D1 Mini** (one sender per classroom) with **two buttons**: **FLASH (GPIO 0)** sends the request when a teacher doesn't arrive, and a second button on **D5 (GPIO 14)** **cancels** a request that was sent by mistake → the signal travels UDP → Master → `POST /api/signal`:

1. **Admin assigns senders to classes** — Signal Monitor page → each sender card has a *“D1 Mini installed in class”* dropdown (`POST /api/signal/senders`).
2. When a signal arrives, the server enriches it with the **class**, the **current day/period** (matched against the period's clock time) and the **teacher scheduled** for that slot (from the class-wise timetable). Outside school hours/days the monitor shows **NO CLASS NOW** instead of a teacher (and no Message button, since no one is scheduled).
3. The server **messages the absent teacher** directly (they see it on their **Messages** page: *“Your class 9A · Period 3 is waiting…”*) and their dashboard shows a **“Your class is waiting!”** banner with two actions:
   - **Go to class** — dismisses the alert (teacher heads over).
   - **Request arrangement** — jumps to the request form pre-filled with the class, day, period and reason, so the admin can arrange cover. The request remembers which sender started it.
4. The Signal Monitor history shows the class context (`9A · Period 3 · Teacher Name`) under each entry.

### 📟 Classroom LCD (one per D1 Mini sender)

Each sender board drives its own **16×2 I2C LCD**, so the classroom sees the request and its outcome without opening a browser:

| When | Sender LCD shows |
|---|---|
| FLASH button pressed (request) | `REQUEST SENT` / `TO ADMIN` |
| Cancel button pressed | `CANCEL SENT` / `TO ADMIN` |
| Absent teacher informed | `INFORMED` / `{name} was informed of the class` |
| Admin approves (cover assigned) | `ACCEPTED` / `Cover: {cover teacher name}` |
| Admin rejects | `REJECTED` / `{note}` |
| Admin messages the teacher | `MSG FROM ADMIN` / `{message}` |
| Request cancelled | `CANCELLED` / `Request cancelled` |

### 🚦 Sender status LEDs (one red, one blue)

Each D1 Mini sender drives two external status LEDs (each with a ~220 Ω resistor to GND): **blue on D6 (GPIO 12)**, **red on D7 (GPIO 13)**.

| LED | State | Meaning |
|---|---|---|
| 🔵 Blue | blinking | **Booting** — powering up / connecting to the Master's network |
| 🔵 Blue | solid | **No errors** — linked to the Master, ready |
| 🔴 Red | blinking | **Error — admin (Master) not found** — Wi-Fi to the Master's `EduFlow` AP is down (Master powered off, out of range, or wrong `WIFI_SSID`/`WIFI_PASSWORD`). The sender retries every 5 s and turns blue on its own once the link is back |
| 🔴 Red | short flash | **Transient error** — a UDP packet failed to send (Serial: `UDP SEND FAILED`); just press the button again |

The **ESP32 Master** has its own three status LEDs (external, ~220 Ω to GND, active HIGH) and a reboot button:

| LED | State | Meaning |
|---|---|---|
| 🟢 Green (GPIO 13) | solid | `EduFlow` AP is running — senders can join |
| 🟢 Green (GPIO 13) | slow blink | AP failed to start |
| 🔵 Blue (GPIO 12) | blinking | Connecting to the router Wi-Fi |
| 🔵 Blue (GPIO 12) | solid | Connected to the router — website reachable |
| 🔴 Red (GPIO 14) | 2 s flash | A signal was received from a sender |
| 🔴 Red (GPIO 14) | slow blink | Error — no router Wi-Fi, the website/admin can't be reached |

A **reboot button between GPIO 32 and GND** restarts the Master (like the EN button) — handy when it's mounted somewhere hard to reach.

### 🔌 Wiring at a glance

All LEDs are **active HIGH** — GPIO → 220 Ω resistor → LED anode (long leg) → LED cathode (short leg) → GND. Buttons use the internal pull-up (pin ↔ GND, no resistor). Full wiring tables in [`ESP32-README.md`](ESP32-README.md).

| Component | Sender (ESP8266 D1 Mini) | Master (ESP32) |
|---|---|---|
| **I2C LCD** | SDA → **D2 (GPIO 4)** · SCL → **D1 (GPIO 5)** · VCC → 5V · GND → GND | SDA → **GPIO 25** · SCL → **GPIO 26** · VCC → 5V · GND → GND |
| **Request button** | **GPIO 0** (FLASH) ↔ GND | — |
| **Cancel button** | **GPIO 14 (D5)** ↔ GND | — |
| 🔵 **Blue LED** | **D6 (GPIO 12)** via 220 Ω | **GPIO 12** via 220 Ω |
| 🔴 **Red LED** | **D7 (GPIO 13)** via 220 Ω | **GPIO 14** via 220 Ω |
| 🟢 **Green LED** | — | **GPIO 13** via 220 Ω |
| **Reboot button** | — | **GPIO 32** ↔ GND |

How it works: the server queues these as notifications; the ESP32 Master polls `GET /api/signal/notifications` every few seconds and forwards each one to the right sender over UDP on its own network. Long text scrolls on the LCD's second line, and each status returns to `READY` after ~6 s.

Cancelling: a `CANCEL` press (button 2) tells the server to withdraw the sender's still-pending request (status becomes **Cancelled** on both dashboards, admin can't approve it anymore). If there's nothing left to cancel — already approved or never requested — the LCD shows `CANCELLED / No pending request to cancel`.

> 📡 Full hardware companion — wiring, firmware flashing, sender↔Master pairing and end-to-end testing: see **[`ESP32-README.md`](ESP32-README.md)**.

When the Master receives `{senderID: 1-4, message: "SIGNAL"}` over its own Wi-Fi (UDP) it should `POST` to `/api/signal`:

```json
{ "senderID": 1, "message": "SIGNAL", "timestamp": "2026-08-13T13:25:04" }
```

The updated `ESP32 codes/master.c` already does this: it runs its own access point (`EduFlow`) that the four senders join, connects to the router (SSID/password configurable at the top of the file) to reach the website, POSTs every received signal to `SIGNAL_URL` (default `http://<your-pc-ip>:3000/api/signal`), optionally sends the `x-signal-token` header when `SIGNAL_TOKEN` is set, and **polls `NOTIFY_URL`** (`/api/signal/notifications`) to push accept/reject/message/informed status to the sender LCDs over UDP.

- `senderID` must be an integer `1`–`4` (one per ESP8266 D1 Mini sender); `message` is required (≤ 64 chars; `SIGNAL` = request, `CANCEL` = withdraw the sender's pending request); `timestamp` is optional (server time is used when missing).
- The server validates the payload, stores it in `data/signals.json`, and **broadcasts it in real time** to every open browser over Server-Sent Events — no polling.
- Every browser tab shows the signal for **2 seconds** then returns to `READY`, matching the Master LCD — `SIGNAL RECEIVED / FROM: SENDER 1` when the sender has no class, or **`TEACHER ABSENT / CLASS 9A`** when it does. The history stays until an admin clears it.
- Each history row with a scheduled teacher gets a **Message** button, so the admin can contact that teacher directly (they see it in real time on their **Messages** page).
- The Master card shows **ONLINE** while a signal arrives at least once per minute; otherwise **OFFLINE**. If the stream drops, the page reconnects automatically.

**Securing the endpoint (recommended for the internet):**

```bash
SIGNAL_TOKEN=my-secret node server.js
```

The Master must then send the header `x-signal-token: my-secret` with every `POST /api/signal` **and every notification poll** (`GET /api/signal/notifications`). Without the env var set, both are open (fine for local testing).

**Quick test:**

```bash
curl -X POST http://localhost:3000/api/signal -H 'Content-Type: application/json' -d '{"senderID":1,"message":"SIGNAL"}'

# sender-LCD updates queue here (each returned once, then marked delivered):
curl http://localhost:3000/api/signal/notifications
# e.g. 1|informed|Priya Verma was informed of the class

# withdraw a still-pending request from that sender:
curl -X POST http://localhost:3000/api/signal -H 'Content-Type: application/json' -d '{"senderID":1,"message":"CANCEL"}'
```

---

## 🗂 Project structure

```
├── README.md            # Project overview (this file)
├── ESP32-README.md      # ESP32 signal system — hardware, firmware, testing
├── .env                 # Environment variables (gitignored) — Twilio, MongoDB, etc.
├── server.js            # HTTP server + API routes + Twilio calling + MongoDB init
├── lib/
│   ├── db.js            # Data store (MongoDB or JSON) + business logic
│   └── xlsx.js          # Pure-JS Excel/CSV reader + writer (built on zlib)
├── ESP32 codes/
│   ├── master.c         # ESP32 Master firmware (AP + UDP + HTTP forwarding)
│   └── sender1–4.c      # ESP8266 D1 Mini sender firmware (button → UDP → LCD)
├── public/
│   ├── index.html       # SPA shell
│   ├── css/style.css    # Full design system (mobile-responsive)
│   └── js/app.js        # Login, dashboards, editor, request flows
├── scripts/
│   └── generate-sample.js
├── data/                # Created at runtime (gitignored): local JSON storage
└── sample-timetable.xlsx
```

**Storage:** When `MONGODB_URI` is set, data lives in MongoDB. Otherwise, plain JSON files in `data/` (`users.json`, `timetable.json`, `requests.json`, `sessions.json`, `messages.json`, `signals.json`). Passwords are hashed with Node's built-in `scrypt`; sessions auto-expire after 30 days.

**Environment variables** (set in `.env` file, gitignored):

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No | Server port (default: 3000) |
| `MONGODB_URI` | No | MongoDB connection string (falls back to local JSON) |
| `TWILIO_ACCOUNT_SID` | For calling | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | For calling | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | For calling | Twilio phone number (e.g. `+1234567890`) |
| `SIGNAL_TOKEN` | Recommended | Secures the ESP32 signal endpoint |

---

## 🔌 API reference

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | public | Log in → session cookie |
| POST | `/api/auth/logout` | public | Log out |
| GET | `/api/me` | any | Current user |
| GET/POST | `/api/teachers` | admin | List / register teachers |
| PUT/DELETE | `/api/teachers/:id` | admin | Edit / delete teacher |
| POST | `/api/setup/teachers` | admin | One-click setup — rebuild weighted timetable + create ~24 teachers (password `1234`) |
| GET | `/api/timetable` | any | Current timetable |
| POST | `/api/timetable` | admin | Save timetable (JSON) |
| POST | `/api/timetable/upload` | admin | Upload `.xlsx`/`.csv` → parsed preview + warnings |
| GET | `/api/requests` | any | Requests (admin: all · teacher: own) |
| POST | `/api/requests` | teacher | Create substitution request |
| POST | `/api/requests/:id/action` | admin | `{action:"approve"}` (auto-assign) / `{action:"deny"}` |
| GET | `/api/covers` | teacher | My cover duties |
| GET | `/api/stats` | admin | Dashboard stats |
| GET/POST | `/api/messages` | any | List my messages / send `{toId, text, senderID?}` (realtime; a `senderID` also shows the message on that sender's classroom LCD) |
| POST | `/api/messages/read` | any | Mark my incoming messages as read |
| POST | `/api/call/test` | admin | Test-call a teacher via Twilio `{teacherId}` — places an outbound voice call |
| GET | `/api/stream` | any | Realtime SSE feed — requests, covers, messages, stats & timetable push to every open session |
| POST | `/api/signal` | public* | ESP32 Master reports a signal `{senderID, message, timestamp?}` → broadcast to all browsers |
| GET | `/api/signal/stream` | public | Server-Sent Events feed (`state` / `signal` / `clear` events) |
| GET | `/api/signal/history` | any | Signal history + master status + sender→class mapping |
| GET | `/api/signal/notifications` | public* | Master polls sender-LCD updates — plain-text lines `senderID|type|text` (`informed`/`accepted`/`rejected`/`message`/`cancelled`), read-once |
| POST | `/api/signal/senders` | admin | Assign a sender (D1 Mini) to a class `{senderID, className}` (empty class = unassign) |
| DELETE | `/api/signal/history` | admin | Clear the signal history |

> \* `POST /api/signal` is public so the ESP32 Master can call it without a browser session. Set the `SIGNAL_TOKEN` environment variable to require an `x-signal-token` header with the same value (recommended once the Master is on the internet).

---

## 📋 Progress log (everything done so far)

**2026-08-19 — v2.0.0 (MongoDB + Twilio + mobile numbers + phone UI)**

- ✅ **Mobile number field** — teacher registration now collects a mobile number; existing teachers default to `8750441860`
- ✅ **Twilio auto-calling** — when a D1 Mini button signals an absent teacher, the server calls their mobile via Twilio with an urgent TTS message
- ✅ **Test call button** — admin can test-call any teacher from the Teachers page
- ✅ **MongoDB support** — `MONGODB_URI` env var switches storage from JSON files to MongoDB; falls back gracefully
- ✅ **Render deployment ready** — all secrets via `.env`; `package.json` has production scripts
- ✅ **`.env` file** — centralized config for Twilio, MongoDB, and signal token (gitignored)
- ✅ **Mobile-responsive UI** — hamburger sidebar, touch-friendly buttons (44px min), slide-up modals, iOS zoom prevention, stacked layouts on phones
- ✅ **Sidebar overlay** — clicking outside the sidebar closes it on mobile
- ✅ **README updates** — full documentation of v2.0 features, env vars, Render deploy guide

**2026-08-16 — v1.8.1 (cancel button on each sender)**

- ✅ Every D1 Mini sender gets a **second button (D5/GPIO 14)** that withdraws the still-pending request — the server marks it `Cancelled`, both dashboards update live, and the classroom LCD shows `CANCELLED`
- ✅ Master LCD shows `CANCEL RECEIVED` and forwards `message: "CANCEL"`; notification types are uppercased before being pushed to the senders

**2026-08-16 — v1.8.0 (classroom LCD + status pushback)**

- ✅ **Sender LCDs** — each D1 Mini sender drives a **16×2 I2C LCD**: `REQUEST SENT / TO ADMIN` on button press, then live status from the admin — `ACCEPTED` with the cover teacher's name, `REJECTED`, `MSG FROM ADMIN`, and `INFORMED` (the absent teacher's name)
- ✅ **Pushback channel** — the ESP32 Master polls `GET /api/signal/notifications` (plain-text, read-once) and forwards updates to the right sender over ESP-NOW; no JSON parsing on the firmware
- ✅ **Absent teacher informed** — when a signal arrives, the scheduled teacher is auto-messaged on their **Messages** page; requests started from a class call carry the sender, so approve/deny reaches that classroom's LCD

**2026-08-16 — v1.7.0 (4 × ESP8266 D1 Mini senders)**

- ✅ Hardware switched from **2 × ESP32 senders** to **4 × ESP8266 D1 Mini** senders (one per class) — the **ESP32 Master** stays the same
- ✅ Firmware: `sender1.c`–`sender4.c` rewritten for the ESP8266 (`ESP8266WiFi.h` + `espnow.h`, FLASH button on GPIO 0); the Master LCD now shows `FROM: SENDER 1`–`4`
- ✅ Server + Signal Monitor accept **senders 1–4**: validation, sender cards, and history badges all support four senders

**2026-08-13 — v1.6.1 (editable class times + smarter signal context)**

- ✅ **Edit period times** (admin → Timetable → Edit times) — change each period's start/end; drives signal time-matching and all schedules
- ✅ **“NO CLASS NOW” signal state** — a signal outside school hours/days shows *No class now* on the indicator, sender card and history instead of a misleading “Teacher absent”
- ✅ **Message button resolved live** — history rows look up the current timetable, so the Message teacher button appears whenever a teacher is scheduled for that slot (even if the signal predates the teacher)

**2026-08-13 — v1.6.0 (one-click auto-setup)**

- ✅ **“Setup from timetable” button** (admin → Teachers) — one click rebuilds a **weighted timetable** (Maths, English & a science subject **every day**; minor subjects like SST/AI a few times a week) and auto-creates **~24 teacher accounts** with **more teachers for important subjects** (e.g. 3 for Mathematics, 3 for English, 2 for each science)
- ✅ Accounts are ready to log in immediately — username is the subject slug (`mathematics`, `mathematics2`, …) with password `1234`; teachers are round-robin assigned into their subject's timetable cells so every schedule is populated
- ✅ Idempotent & replace-all — safe to re-run anytime (wipes teacher accounts, requests and messages first)
- ✅ Fresh installs now seed the weighted default timetable too

**2026-08-13 — v1.5.0 (realtime everywhere + class-based signals + staff messaging)**

- ✅ **Class-based signal labels** — the Signal Monitor now reads `TEACHER ABSENT / CLASS 9A` instead of `SIGNAL RECEIVED / FROM: SENDER 1`; sender cards show the assigned class (`Class 9A — Teacher absent`) and the history shows `Teacher absent · 9A · Period · Teacher`
- ✅ **Message the teacher** — every signal history row (and every teacher row) gets a **Message** button; the admin messages the teacher who should be in that class and replies flow back
- ✅ **Staff messaging** — new **Messages** page (both roles) with conversation threads, unread badge, and real-time delivery
- ✅ **Realtime everywhere** — a second SSE feed (`/api/stream`) pushes requests, covers, messages, stats and timetable changes to every open session: new requests appear on the admin dashboard instantly, approvals/denials reach the teacher instantly, cover duties and timetable edits update everyone without a page refresh
- ✅ **Signal Monitor is admin-only** — teachers still receive the **“Your class is waiting!”** alert in real time

**2026-08-13 — v1.4.1 (per-class NodeMCU flow)**

- ✅ **Sender → class assignment** (admin) — each sender card on the Signal Monitor page maps the NodeMCU to a class (`POST /api/signal/senders`)
- ✅ **Signal enrichment** — incoming signals are resolved against the timetable: current day/period (by clock time), subject and the teacher scheduled for that class
- ✅ **“Your class is waiting!” banner** — the scheduled teacher is notified in real time with **Go to class** / **Request arrangement** actions
- ✅ **Pre-filled request form** — the request page opens with class, day, period, date and reason already filled in from the signal
- ✅ **Class context in history** — signal log shows which class/period/teacher each signal refers to
- ✅ **Master firmware forwarding** — `ESP32 codes/master.c` now POSTs received signals to the website over HTTP (Wi-Fi SSID/password + server URL configurable at the top)

**2026-08-13 — v1.4.0 (ESP32 signal monitor)**

- ✅ **`POST /api/signal`** — the ESP32 Master reports `{senderID: 1|2, message, timestamp?}`; validated server-side and stored in `data/signals.json` (history persists until cleared)
- ✅ **Server-Sent Events feed** (`GET /api/signal/stream`) — zero-dependency real-time broadcast to every open browser; no polling
- ✅ **Signal Monitor page** (admin only) — Master ONLINE/OFFLINE pill, Sender 1 & Sender 2 status cards, active-signal indicator that shows `SIGNAL RECEIVED / FROM: SENDER X` for exactly **2 seconds** then returns to `READY` (mirrors the Master LCD), and a newest-first history table
- ✅ **Clear-history control** (admin) — deletes the log and broadcasts the clear to all connected clients
- ✅ **Graceful offline handling** — the Master shows OFFLINE when no contact arrives within 60 s or the stream drops (`EventSource` auto-reconnects); optional `SIGNAL_TOKEN` env var secures the signal endpoint

**2026-08-11 — v1.3.0 (class-wise timetable + subject dropdown)**

- ✅ **Class-wise timetable model**: `classes × days × periods → { subject, teacher }` — the timetable is now organized per class instead of a flat teacher grid
- ✅ **Subject dropdown at registration**: teachers pick their subject from a fixed list (Mathematics, Physics, Chemistry, …) instead of typing it — subjects stay consistent
- ✅ **Auto teacher-matching by subject**: cells with exactly one teacher for a subject auto-detect that teacher; admins can still override per cell
- ✅ **Default classwise timetable**: 4 classes (9A · 9B · 10A · 10B) × 5 days × 6 periods with a subject rotation and free periods — seeded on first run so the app works out of the box
- ✅ **Class-tab admin editor**: switch/edit/add/remove classes, per-cell subject + teacher dropdowns, per-class clear
- ✅ **Excel upload per class**: pick the target class; teacher names map to their registered subject with unknown-name warnings
- ✅ **Teacher views updated**: schedule shows `Class · Subject` chips, auto-matched across all classes they teach
- ✅ Auto-detects & replaces any legacy (pre-classwise) timetable file on startup

**2026-08-11 — v1.0.0 (initial build)**

- ✅ Zero-dependency Node server (HTTP + sessions + routing)
- ✅ Pure-JS Excel engine (`lib/xlsx.js`): reads/writes `.xlsx` (ZIP + XML via `zlib`), reads/writes CSV
- ✅ Auth & roles: login/logout, session cookies, admin-only route protection
- ✅ Admin — teacher management: register / edit / delete teachers
- ✅ Admin — timetable: Excel/CSV upload with preview & unknown-teacher warnings, in-browser editor, save & clear
- ✅ Teacher — timetable view: weekly grid with "my class" highlighting and cover badges
- ✅ Substitution requests: request form, admin approval with **auto-assign of the best free teacher**, manual-assignment fallback, deny with note
- ✅ Cover duties + role-based dashboards, stats, badges, tabs, modals, toasts
- ✅ Responsive, polished UI (dark sidebar, gradient login, mobile drawer)
- ✅ Initial demo seed data (later removed — see v1.2.0)

**2026-08-11 — v1.1.0 (backend experiment, later reverted)**

- ⚠️ Temporarily swapped the store to **MongoDB** (`mongodb` driver) — evaluated as a possible "production" backend
- ⚠️ Reverted in v1.2.0 — this is a sample, so no database server should be required

**2026-08-11 — v1.2.0 (sample mode: local-only, no seeds)**

- ✅ **Removed MongoDB** — back to the zero-dependency local store; runs anywhere with just `node server.js`
- ✅ **Removed all seeded data** — no demo teachers, no fake requests, no demo timetable. The sample starts clean with only the bootstrap **admin** account (required so the app can be logged into)
- ✅ Removed the "Demo accounts" login chips from the login page
- ✅ Kept all improvements from the earlier work: cover-duties bug fix, session auto-pruning, CSV BOM handling, null-safe empty states, code-review fixes

### Planned / next steps

- ⏳ Admin/teacher profile page (change own password)
- ⏳ CSV/Excel export of request history
- ⏳ Optional "demo mode" toggle that seeds sample data on demand
- ⏳ Packaging as a single runnable script or desktop-style launcher

---

## 🛠 Troubleshooting

- **Senders print `UDP SEND FAILED` / signals never arrive?** → the sender can't reach the Master's network. Check its Serial shows `Connected! IP: 192.168.4.1x`, the Master is powered on, and `WIFI_SSID`/`UDP_PORT` in the sender match `master.c` — see **ESP32-README.md**.
- **Sender red LED blinking / blue LED off?** → the sender can't reach the Master (the "admin" is not found) — Master powered off or out of range, or wrong `WIFI_SSID`/`WIFI_PASSWORD`. It retries every 5 s and turns blue on its own when the link is back.
- **Sender blue LED blinking at boot?** → normal — it's connecting to the Master's network. Solid blue = ready, red blinking = error.
- **Port in use?** → `PORT=3100 node server.js`.
- **Reset everything?** → stop the server, delete the `data/` folder, restart — only the admin account returns.
- **Forgot admin password?** → delete `data/users.json` and restart (resets to `admin / admin123`).
- **The upload says “unregistered teacher”** → register that teacher first (or edit the cell to an existing teacher's name) — the rest of the file still imports.
- **Excel upload fails on a weird file?** → save it as CSV in Excel and upload the `.csv` instead.

---

Built with ❤️ as a sample for schools. MIT licensed.
