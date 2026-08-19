# 📡 EduFlow ESP32 Signal System

How the ESP32 hardware talks to the EduFlow teacher dashboard — from button press in a classroom to a teacher alert on the website.

> This is the hardware companion to the main [`README.md`](README.md). The website part is described there; this file focuses on the **boards, firmware, wiring and the full end-to-end flow**.

---

## 🏗 Architecture

The website never talks to the classroom boards directly. One **ESP32 Master** and four **ESP8266 D1 Mini** senders work together:

```text
                    ┌──────────┐  ┌─────────────────────────┐  ┌─ POST /api/signal ──┐
                    │ ESP32    │  │ Router Wi-Fi (STA)      │  │                     ▼
ESP8266 Sender 1 ──►│ Master   │──► (to reach the website) │─►│───▶ Website (EduFlow)
ESP8266 Sender 2 ──►│  (AP +   │  └─────────────────────────┘  │  GET /api/signal/notifications
ESP8266 Sender 3 ──►│  UDP)    │◀──────────────────────────────┘  (polled every few s)
ESP8266 Sender 4 ──►│          │  status (UDP back to senders)
                    └──────────┘
        senders join the Master's own Wi-Fi network "EduFlow"
```

**Key idea — the Master runs its own Wi-Fi network.** The four senders join the Master's access point (`EduFlow`) instead of the school router. Because every board is on the **Master's own AP**, sender ↔ Master always shares one channel — no matter what channel the school router picks, and even if the router has multiple access points/extenders on the same SSID. This is what makes the link reliable without touching the router settings.

Transport is **UDP** (port `4210`), carrying the exact same `Message` struct that used to travel over ESP-NOW — **byte-for-byte identical, just a different radio path**. No MAC pairing, no ESP-NOW core compatibility issues.

Signals go **up**; status goes **down**:

1. A **Sender** (one per class, an ESP8266 D1 Mini in the classroom) sends `{senderID: 1-4, type: "SIGNAL"}` via UDP when its **FLASH button (GPIO 0)** is pressed, or `{senderID, type: "CANCEL"}` when the **cancel button (GPIO 14)** is pressed. Its **16×2 I2C LCD** shows `REQUEST SENT / TO ADMIN` (or `CANCEL SENT / TO ADMIN`). At boot each sender also sends a `REGISTER` packet so the Master knows its IP for the return path.
2. The **Master** receives the packet, flashes `SIGNAL RECEIVED / FROM: SENDER X` on its LCD for 2 seconds, then **forwards** it to the website with an HTTP `POST /api/signal` (over its router connection).
3. The website **validates + stores** the signal (`data/signals.json`), **broadcasts it in real time** to every open browser via Server-Sent Events, and queues a status update for the sender.
4. If the sender is mapped to a class, the website resolves who should be teaching that class **right now** (from the timetable + clock time): that teacher gets a real **message** on their Messages page and a **“Your class is waiting!”** alert with *Go to class* / *Request arrangement* actions.
5. The Master **polls `GET /api/signal/notifications`** every few seconds and forwards each pending update (accept/reject/admin message/informed) to the right sender **via UDP**; the sender shows it on its classroom LCD.

---

## 🧰 Hardware

| Board | Role | Needs |
|---|---|---|
| **ESP32 Master** | Runs the `EduFlow` Wi-Fi network, receives UDP, shows LCD, forwards over router Wi-Fi to the website, **polls status updates** for the senders | ESP32 dev board, **16×2 I2C LCD** (address `0x27`, SDA→GPIO 25, SCL→GPIO 26) + **status LEDs on GPIO 13 (green) / 12 (blue) / 14 (red)** + **reboot button on GPIO 32** |
| **ESP8266 D1 Mini Sender 1** | Sends `senderID = 1`, shows status LCD | D1 Mini + request button on **GPIO 0** (FLASH works) + **cancel button on GPIO 14** (D5) + **16×2 I2C LCD** (address `0x27`, SDA→D2/GPIO 4, SCL→D1/GPIO 5) + **status LEDs on D6 (blue) / D7 (red)** |
| **ESP8266 D1 Mini Sender 2** | Sends `senderID = 2`, shows status LCD | same as Sender 1 |
| **ESP8266 D1 Mini Sender 3** | Sends `senderID = 3`, shows status LCD | same as Sender 1 |
| **ESP8266 D1 Mini Sender 4** | Sends `senderID = 4`, shows status LCD | same as Sender 1 |

Firmware lives in [`ESP32 codes/`](ESP32%20codes/):

- `master.c` — Master firmware (ESP32: **own AP** + UDP server + LCD + **HTTP forwarding** + **notification polling** + **status LEDs + reboot button**)
- `sender1.c`–`sender4.c` — Sender firmware (ESP8266 D1 Mini: button → **UDP**, **status I2C LCD**, senderID 1–4)

> ⚠️ `diag-sender.c` / `diag-master.c` are **obsolete** (old ESP-NOW test sketches). Do not flash them — they don't match the current system.

**Networking model:**

- **Master** — connects to the school router as a station (only to reach the website over HTTP) *and* runs its own access point `EduFlow` for the senders. Both interfaces share one radio, so the AP automatically sits on the same channel as the router connection (`WiFi Channel: N` at boot). If the router's channel ever changes, the Master re-syncs the AP every ~10 s.
- **Senders** — join `EduFlow` with **static IPs** (`192.168.4.11`–`.14`, sender N = `.1N`), so no DHCP and no router access is needed. The Master's AP IP is always `192.168.4.1`.

---

## 🔌 Wiring

All status LEDs are **active HIGH**: GPIO → **220 Ω resistor** → LED **anode (long leg)** → LED **cathode (short leg)** → GND. The firmware lights an LED by driving its pin high. Buttons use the board's **internal pull-up** (wire them between the pin and GND — no external resistor).

### ESP8266 D1 Mini — Sender (one per class, ×4)

| Component | Wire to | Notes |
|---|---|---|
| **16×2 I2C LCD** | **SDA → D2 (GPIO 4)** · **SCL → D1 (GPIO 5)** · **VCC → 5V** · **GND → GND** | address `0x27` (try `0x3F` if it stays dark); install the `LiquidCrystal_I2C` library |
| **FLASH request button** | **GPIO 0 (D3)** ↔ GND | the board's own FLASH button works out of the box; an external button on the same pin also works |
| **Cancel button** | **GPIO 14 (D5)** ↔ GND | set `BUTTON_CANCEL_PIN` to `-1` in the sketch to disable |
| 🔵 **Blue status LED** | anode → **D6 (GPIO 12)** via 220 Ω · cathode → **GND** | solid = ready · blinking = booting |
| 🔴 **Red status LED** | anode → **D7 (GPIO 13)** via 220 Ω · cathode → **GND** | blinking = Master/admin not found · short flash = UDP send failed |
| **Power** | **5V** and **GND** | share the LCD's 5 V supply |

### ESP32 dev board — Master

| Component | Wire to | Notes |
|---|---|---|
| **16×2 I2C LCD** | **SDA → GPIO 25** · **SCL → GPIO 26** · **VCC → 5V** · **GND → GND** | address `0x27` (try `0x3F`); same `LiquidCrystal_I2C` library |
| 🟢 **Green status LED (AP)** | anode → **GPIO 13** via 220 Ω · cathode → **GND** | solid = `EduFlow` AP running · slow blink = AP failed |
| 🔵 **Blue status LED (Wi-Fi)** | anode → **GPIO 12** via 220 Ω · cathode → **GND** | blinking = connecting · solid = website reachable |
| 🔴 **Red status LED (signal/error)** | anode → **GPIO 14** via 220 Ω · cathode → **GND** | 2 s flash = signal received · slow blink = no router Wi-Fi |
| **Reboot button** | **GPIO 32** ↔ GND | internal pull-up, no resistor needed; press = software reboot |
| **Power** | **5V** and **GND** (or USB) | shares the LCD's 5 V supply |

### Quick pin map

| | Sender (D1 Mini) | Master (ESP32) |
|---|---|---|
| LCD SDA / SCL | D2 / D1 (GPIO 4 / 5) | GPIO 25 / 26 |
| Request button | GPIO 0 (FLASH) | — |
| Cancel button | GPIO 14 (D5) | — |
| Blue LED | D6 (GPIO 12) | GPIO 12 |
| Red LED | D7 (GPIO 13) | GPIO 14 |
| Green LED | — | GPIO 13 |
| Reboot button | — | GPIO 32 |

### 📦 Packet format (identical on all boards)

All five sketches share one `Message` struct, so any board can talk to any other:

```c
typedef struct {
  int senderID;   // 1-4
  char type[12];  // SIGNAL | CANCEL | REGISTER   (sender -> master)
                  // ACCEPTED | REJECTED | MESSAGE | INFORMED | CANCELLED  (master -> sender)
  char text[40];  // cover teacher name / note / message / "was informed..." text
} Message;
```

- **Sender → Master:** `{senderID, type, text}` sent as a UDP datagram to `192.168.4.1:4210`. `REGISTER` is the boot-time hello (never forwarded to the website).
- **Master → Sender:** `{senderID, type, text}` sent via UDP to the sender's IP on port `4210`. The website sends lowercase types; the Master uppercases them before forwarding (`informed` → `INFORMED`, etc.).

---

## 🛠 Flashing & setup

Flash each board from the **Arduino IDE**. Senders need the **ESP8266 core** (Boards Manager → search `esp8266 by ESP8266 Community`); the Master needs the **ESP32 core**. Boards: senders → `LOLIN(WEMOS) D1 mini`; Master → `ESP32 Dev Module`.

### 1. Sender 1 → `sender1.c`

Open the sketch and check the top config block:

```c
#define SENDER_ID 1

// --- The Master's own Wi-Fi network (the ESP32 Master runs this AP) ---
const char* WIFI_SSID = "EduFlow";        // Master's AP SSID
const char* WIFI_PASSWORD = "edurock";    // Master's AP password

// The Master's IP on its AP (default 192.168.4.1) + the shared UDP port.
IPAddress masterIP(192, 168, 4, 1);
#define UDP_PORT 4210

// Static address on the Master's network (sender N = 192.168.4.1N):
IPAddress localIP(192, 168, 4, 10 + SENDER_ID);   // Sender 1 = .11
IPAddress gateway(192, 168, 4, 1);
IPAddress subnet(255, 255, 255, 0);
```

These values **must match `master.c`** (`AP_SSID` / `AP_PASSWORD` / `UDP_PORT`). Upload. The Serial Monitor should show:

```text
Connecting to Wi-Fi "EduFlow"...
Connected! IP: 192.168.4.11
Channel: 10
LED: OK (solid blue)
REGISTER SENT - SENDER 1 (UDP)
SENDER 1 READY
```

### 2. Sender 2, 3 & 4 → `sender2.c`, `sender3.c`, `sender4.c`

Same steps — only `SENDER_ID` differs (`#define SENDER_ID 2/3/4`), which automatically gives each its own IP (`.12`/`.13`/`.14`). Flash one D1 Mini per classroom.

> **📟 Sender LCD:** SDA → **D2 (GPIO 4)**, SCL → **D1 (GPIO 5)**, VCC → 5V, GND → GND, address `0x27` (try `0x3F` if it stays dark). Install the **`LiquidCrystal_I2C`** library (Library Manager → search `LiquidCrystal I2C` by Frank de Brabander).

> **🔘 Sender buttons:** GPIO 0 (D3, the **FLASH** button) sends the request; wire a second push button between **D5 (GPIO 14)** and GND for **cancel** (set `BUTTON_CANCEL_PIN` to `-1` to disable).

> **🚦 Sender status LEDs** — two external LEDs (each with a ~220 Ω resistor to GND), **blue on D6 (GPIO 12)**, **red on D7 (GPIO 13)** (both active HIGH):
>
> | LED | State | Meaning |
> |---|---|---|
> | 🔵 Blue | blinking | **Booting** — powering up / connecting to the Master's network |
> | 🔵 Blue | solid | **No errors** — linked to the Master, ready |
> | 🔴 Red | blinking | **Error — admin (Master) not found** — Wi-Fi to the Master's `EduFlow` AP is down (Master powered off, out of range, or wrong `WIFI_SSID`/`WIFI_PASSWORD`). The sender retries every 5 s and turns blue on its own once the link is back |
> | 🔴 Red | short flash | **Transient error** — a UDP packet failed to send (Serial: `UDP SEND FAILED`); just press the button again |

### 3. Master → `master.c`

Edit the **CONFIG block** at the top of the file:

```c
// Router Wi-Fi - used ONLY to reach the website over HTTP.
const char* WIFI_SSID = "Alfa";
const char* WIFI_PASSWORD = "112233445566";

// The EduFlow website endpoint. Use the computer's LAN IP when testing locally.
const char* SIGNAL_URL = "http://192.168.29.62:3000/api/signal";
const char* NOTIFY_URL = "http://192.168.29.62:3000/api/signal/notifications";

// Optional: if the server was started with SIGNAL_TOKEN=..., set it here too.
const char* SIGNAL_TOKEN = "";

// The Master's OWN Wi-Fi network - the four D1 Mini senders join THIS AP...
const char* AP_SSID = "EduFlow";
const char* AP_PASSWORD = "edurock";
```

- `SIGNAL_URL` **and `NOTIFY_URL`** must point at the computer running `node server.js` — use its **LAN IP** (`ipconfig` / `ifconfig`), not `localhost`.
- **The senders only need to reach the Master's AP** — they never touch the router, so router channel changes, multiple APs and extenders can't break the link.
- If you secured the endpoint, set `SIGNAL_TOKEN` to the same value used when starting the server, e.g. `SIGNAL_TOKEN=my-secret node server.js`. The Master sends it as the `x-signal-token` header on both `POST /api/signal` and the notification poll.
- Wire the Master's LCD (SDA → GPIO 25, SCL → GPIO 26, VCC → 5V, GND → GND, I2C address `0x27`) and upload.

> **🚦 Master status LEDs + reboot button** — three external LEDs (each with a ~220 Ω resistor to GND, active HIGH) and one push button:
>
> | LED | State | Meaning |
> |---|---|---|
> | 🟢 Green (GPIO 13) | solid | `EduFlow` AP is running — senders can join |
> | 🟢 Green (GPIO 13) | slow blink | AP failed to start — senders can't join |
> | 🔵 Blue (GPIO 12) | blinking | Connecting to the router Wi-Fi |
> | 🔵 Blue (GPIO 12) | solid | Connected to the router — website reachable |
> | 🔴 Red (GPIO 14) | 2 s flash | A signal was received from a sender |
> | 🔴 Red (GPIO 14) | slow blink | Error — no router Wi-Fi, the website/admin can't be reached |
>
> **Reboot button:** wire a push button between **GPIO 32 and GND** (internal pull-up) — pressing it performs a software reboot, exactly like the EN button.

Expected Master boot output:

```text
Connected! IP: 192.168.29.57
WiFi Channel: 10
AP 'EduFlow' started on channel 10, IP 192.168.4.1
UDP listening on port 4210
Master ready!
Sender 1 registered (IP 192.168.4.11)   <- as each sender boots
```

---

## 🏫 Per-class flow (one D1 Mini per class)

The idea: **every class gets its own sender board.** When a teacher doesn't arrive, anyone in the class presses the button, and the website tells that class's teacher what to do.

1. **Register teachers + set the timetable** on the website first (admin) — the app needs to know who teaches which class when.
2. **Assign senders to classes** (admin) — *Signal Monitor* page → each sender card has a **“D1 Mini installed in class”** dropdown (`POST /api/signal/senders`):
   - Sender 1 → e.g. `9A`, Sender 2 → `9B`, Sender 3 → `10A`, Sender 4 → `10B`
3. When a signal arrives from Sender 1 during 9A's Mathematics period, the server:
   - resolves the current **day + period** from the server clock (matched against the period label's time range),
   - looks up who is **scheduled to teach 9A right now** in the timetable,
   - **messages that teacher directly** (*“Your class 9A · Period 3 is waiting…”*) and queues an `informed` update for the sender's LCD,
   - **automatically calls the absent teacher via Twilio** (if `TWILIO_*` env vars are configured) with an urgent TTS message: *“Attention [name]. Your class [class] [period] is waiting. Please go to your class immediately.”*,
   - stores the context on the signal record and broadcasts it.
4. That teacher's dashboard shows **“Your class is waiting!”** with:
   - **Go to class** → dismisses the alert,
   - **Request arrangement** → opens the request form pre-filled with class, day, period, date and a reason.
5. Back in the classroom, the sender's LCD follows the request lifecycle (each update is pushed by the Master within a few seconds):

   | Website action | Sender LCD shows |
   |---|---|
   | Signal arrived | `INFORMED` / `{name} was informed of the class` |
   | Admin approves (cover auto-assigned) | `ACCEPTED` / `Cover: {cover teacher name}` |
   | Admin rejects | `REJECTED` / `{note}` |
   | Admin messages the teacher | `MSG FROM ADMIN` / `{message}` |
   | Cancel button pressed | `CANCEL SENT` / `TO ADMIN`, then `CANCELLED` / `Request cancelled` (or `No pending request to cancel`) |

A `CANCEL` press withdraws the sender's still-pending request — it shows as **Cancelled** on both dashboards and can no longer be approved.

Signals received **outside a scheduled period** (lunch, after school) are still logged with their class, but there is no scheduled teacher to alert or inform.

### 📞 Twilio auto-calling (v2.0)

When `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` are set in `.env`, the server **automatically calls the absent teacher** when a D1 Mini button is pressed. The call uses Twilio's TTS to say:

> *"Attention [Teacher Name]. Your class [Class] [Period] is waiting. No teacher has arrived. Please go to your class immediately. This is an automated call from EduFlow."*

The teacher's **mobile number** is stored in their profile (set during registration, defaults to `8750441860` for testing).

**Test calling without hardware:**

```bash
# Test-call a specific teacher (admin only, from the Teachers page or API):
curl -X POST http://localhost:3000/api/call/test \
  -H 'Content-Type: application/json' \
  -d '{"teacherId": "u_xxxx"}'
```

> ⚠️ Calling requires a **real Twilio account** with a purchased phone number. Free trial accounts can only call verified numbers.

---

## 🧪 Testing end-to-end

No hardware needed to test the website side:

```bash
npm install mongodb twilio dotenv
node server.js
# log in as admin → Signal Monitor → assign Sender 1 → 9A, Sender 2 → 9B, …
# then simulate the Master forwarding a signal (senderID 1-4 all work):
curl -X POST http://localhost:3000/api/signal \
  -H 'Content-Type: application/json' \
  -d '{"senderID":1,"message":"SIGNAL"}'
```

- Every open browser tab shows `SIGNAL RECEIVED / FROM: SENDER 1` for **2 seconds**, then back to `READY`.
- The signal appears in the **history** (newest first) with its class context (`9A · Period 3 · Teacher Name`).
- A teacher who is scheduled for 9A at the current period sees the **“Your class is waiting!”** banner **and a message on their Messages page**.

Test the notification pushback without hardware — POST a signal, then poll the queue (each item is returned once, then marked delivered):

```bash
curl -X POST http://localhost:3000/api/signal -H 'Content-Type: application/json' -d '{"senderID":1,"message":"SIGNAL"}'
curl http://localhost:3000/api/signal/notifications
# e.g. 1|informed|Priya Verma was informed of the class
# withdraw a still-pending request from that sender:
curl -X POST http://localhost:3000/api/signal -H 'Content-Type: application/json' -d '{"senderID":1,"message":"CANCEL"}'
```

With the hardware, press the sender's button and watch: Sender LCD shows `REQUEST SENT / TO ADMIN` → Master LCD flashes `SIGNAL RECEIVED / FROM: SENDER 1` → Master Serial prints `Forwarded to website (HTTP 201)` → within a few seconds the Master prints `Notify sender 1 (informed): sent -> 192.168.4.11` and the sender's LCD shows `INFORMED / {name} was informed of the class`.

---

## 🔒 Securing the endpoint

By default `POST /api/signal` is open (fine for local testing). Once the Master is on the internet, start the server with a token:

```bash
# In .env:
SIGNAL_TOKEN=my-secret
```

and set the same value in `master.c` → `SIGNAL_TOKEN`. The Master then sends `x-signal-token: my-secret` with every request; anything else gets `401`.

When deployed to **Render**, set all env vars (including `SIGNAL_TOKEN`) in Render's dashboard. The Master's `SIGNAL_URL` should point to your Render URL (e.g. `https://your-app.onrender.com/api/signal`).

---

## 🧯 Troubleshooting

| Symptom | Fix |
|---|---|
| Master prints `Wi-Fi connection FAILED` | Wrong router SSID/password in `master.c`, or the board can't reach the router. Check the CONFIG block. |
| Master prints `Forward FAILED` | Website not running, wrong `SIGNAL_URL`, or wrong IP. Test with `curl` from the computer first. |
| Master **red LED blinking** | No router Wi-Fi — the website/admin can't be reached. Check the router `WIFI_SSID`/`WIFI_PASSWORD` in `master.c`. |
| Master **green LED blinking** | The `EduFlow` AP failed to start — senders can't join. Reboot the Master (EN button or the GPIO 32 reboot button). |
| Master **blue LED off** | Router Wi-Fi not connected — check the CONFIG block in `master.c`. |
| Reboot button does nothing | Check the button is wired between GPIO 32 and GND (internal pull-up is used, no external resistor needed). |
| `Forwarded to website (HTTP 401)` | `SIGNAL_TOKEN` on the Master doesn't match the server's env var. |
| Sender prints `Wi-Fi FAILED - is the Master powered on?` / **red LED blinks** | The Master's `EduFlow` AP isn't reachable — wrong `WIFI_SSID`/`WIFI_PASSWORD` in the sender, Master not running/too far, or the Master's AP didn't start. The sender retries every 5 s and the blue LED comes on automatically when the link is back. |
| **Sender red LED blinking, blue LED off** | Same as above — the Master ("admin") can't be reached. Check the Master is powered on and the sender's `WIFI_SSID`/`WIFI_PASSWORD` match `master.c`. |
| Sender blue LED blinking for more than ~10 s at boot | Still connecting — it falls back to red blinking and keeps retrying if the Master's AP isn't found. |
| Sender red LED flashes briefly | Transient UDP failure (Serial: `UDP SEND FAILED`) — press the button again. |
| Sender prints `UDP SEND FAILED` | Rare — usually a transient radio hiccup; the button press can be retried. |
| Master LCD stays dark | Wrong I2C address (try `0x3F`), or SDA/SCL swapped (try GPIO 21/22). |
| Sender LCD stays dark | Wrong I2C address (try `0x3F`), SDA/SCL swapped (D1 Mini: SDA→D2/GPIO 4, SCL→D1/GPIO 5), or the `LiquidCrystal_I2C` library isn't installed. |
| Master prints `Notify sender X (...): skipped - IP unknown` | The sender hasn't registered yet — its `REGISTER` packet at boot tells the Master its IP. Reboot the sender (or press its FLASH button once, which also registers it). |
| Sender LCD never shows `ACCEPTED`/`REJECTED`/`INFORMED` | Sender not registered with the Master (see above), or the sender's `WIFI_SSID`/`UDP_PORT` don't match `master.c`. |
| Cancel button does nothing | Button not wired (D5/GPIO 14 → GND), `BUTTON_CANCEL_PIN` set to `-1`, or there is no pending request left for that sender (already approved). |
| Signal arrives but no teacher alert | The sender isn't assigned to a class, or the signal arrived outside that class's scheduled period. |
| Browser shows OFFLINE | No signal for 60 s, or the SSE stream dropped — it reconnects automatically. |
| Auto-call not triggered | Check `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in `.env`. The absent teacher must have a `mobile` number in their profile. Server logs `[call] Twilio not configured` if missing. |
| Twilio call fails | Free trial accounts can only call **verified numbers**. Add the teacher's number to your Twilio console → Verified Caller IDs. Check server logs for the specific Twilio error. |
| MongoDB not connecting | Check `MONGODB_URI` in `.env`. The server falls back to local JSON files if MongoDB is unreachable. Server logs `[server] MongoDB connection failed` on startup. |
