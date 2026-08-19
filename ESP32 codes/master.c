#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include "esp_wifi.h"   // esp_wifi_get/set_channel() - keep the AP on the router's channel

// ================================
// CONFIG - fill these in!
// ================================

// Router Wi-Fi - used ONLY to reach the website over HTTP.
const char* WIFI_SSID = "Alfa";
const char* WIFI_PASSWORD = "112233445566";

// The EduFlow website endpoint.
// For LOCAL testing: use your laptop's LAN IP (e.g. http://192.168.29.62:3000)
// For RENDER deployment: use your Render URL (e.g. https://your-app.onrender.com)
const char* SIGNAL_URL = "https://your-app-name.onrender.com/api/signal";
const char* NOTIFY_URL = "https://your-app-name.onrender.com/api/signal/notifications";

// Optional: if the server was started with SIGNAL_TOKEN=..., set it here too.
const char* SIGNAL_TOKEN = "";

// The Master's OWN Wi-Fi network - the four D1 Mini senders join THIS AP,
// so sender and Master are always on the same channel, no matter what
// channel the router picks. Senders use these exact values.
const char* AP_SSID = "EduFlow";
const char* AP_PASSWORD = "eduflow2026";
#define AP_MAX_CLIENTS 8

// UDP port shared by the Master and every sender. The packets carry the
// same Message struct that used to travel over ESP-NOW - byte-for-byte
// identical, just a different transport.
#define UDP_PORT 4210

// How often the Master checks the website for new sender-LCD updates.
#define NOTIFY_POLL_MS 4000

// --- Status LEDs + reboot button (external LEDs, each with a ~220 ohm
//     resistor in series to GND, all ACTIVE HIGH) ---
//   Green LED: GPIO 34 - AP status: solid = "EduFlow" AP is running,
//                        slow blink = AP failed to start
//   Blue  LED: GPIO 35 - router Wi-Fi: blinking = connecting,
//                        solid = connected (website reachable)
//   Red   LED: GPIO 33 - signal/error: 2 s flash on each received signal,
//                        slow blink = no router Wi-Fi (admin unreachable)
//   Reboot button: wire a push button between GPIO 32 and GND (internal
//                  pull-up). Press = software reboot, like the EN button.
#define LED_AP_PIN 34
#define LED_WIFI_PIN 35
#define LED_ACT_PIN 33
#define REBOOT_BUTTON_PIN 32

// ================================

// LCD
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Shared packet layout (identical on Master + all senders).
//   sender -> master: { senderID, type: "SIGNAL"|"CANCEL"|"REGISTER", text: "" }
//   master -> sender: { senderID, type: ACCEPTED|REJECTED|MESSAGE|INFORMED|CANCELLED, text }
typedef struct {
  int senderID;
  char type[12];
  char text[40];
} Message;

WiFiUDP udp;

// Sender IPs learned from incoming UDP packets (index 1..4, [0] unused).
// Each sender announces itself with a REGISTER packet at boot, so the
// Master always knows where to send LCD updates - no MACs to configure.
IPAddress senderIPs[5];

// Timer
unsigned long signalTime = 0;
bool signalActive = false;

// Web-forward result, shown on the LCD for debugging:
//   0   = nothing forwarded yet
//   > 0 = HTTP status code from the website (201 = saved OK)
//   -1  = no Wi-Fi connection
//   < 0 = HTTP request failed (server down, wrong URL, firewall, ...)
int lastWebResult = 0;
unsigned long resultTime = 0;
bool resultActive = false;

// Pending forward to the website (posted from loop() so packet handling
// stays fast and non-blocking)
bool forwardPending = false;
int forwardSenderID = 0;
char forwardMessage[32];

// Sender-LCD notification polling
unsigned long lastNotifyPoll = 0;


// ================================
// STATUS LEDS - TYPES (defined here, above the first function, so the Arduino
// IDE's auto-generated function prototypes can reference LedState)
// ================================

// One mode per LED: 0 = off, 1 = solid, 2 = blink, 3 = flash-once.
struct LedState {
  uint8_t mode;
  unsigned long param;   // blink period ms (mode 2) or flash duration ms (mode 3)
  unsigned long started;
  bool on;
};

LedState ledAP;   // green - AP "EduFlow" status
LedState ledWiFi; // blue  - router Wi-Fi (website) status
LedState ledAct;  // red   - signal activity / error


// ================================
// LCD HELPERS
// ================================

/** Write one full 16-char line (padded with spaces so old text is cleared). */
void lcdLine(int row, const char* text) {
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16.16s", text);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

/** Clear the LCD and print up to two lines (null = leave that row blank). */
void showMessage(const char* line1, const char* line2) {
  lcd.clear();
  if (line1) lcdLine(0, line1);
  if (line2) lcdLine(1, line2);
}

// ================================
// SHOW DEFAULT SCREEN
// ================================

void showDefaultScreen() {
  showMessage("MASTER ESP32", "READY");
}


// ================================
// STATUS LEDS + REBOOT BUTTON
// ================================

// NOTE: struct LedState and the ledAP/ledWiFi/ledAct instances are defined near
// the TOP of the file (before the first function) on purpose: the Arduino IDE
// auto-generates function prototypes and inserts them before the first function,
// so any type used in a signature must already be declared by then.

bool apUp = false;        // set in setup() once the AP result is known
bool lastRebootState = HIGH;

/** Apply a mode to one status LED (no-op if it is already in that mode). */
void ledSet(LedState &l, uint8_t mode, unsigned long param) {
  if (l.mode == mode && l.param == param) return;
  l.mode = mode;
  l.param = param;
  l.started = millis();
  l.on = false;
}

/** Refresh one LED from its mode. Call every loop(). */
void ledUpdate(LedState &l, uint8_t pin) {
  switch (l.mode) {
    case 0: // off
      digitalWrite(pin, LOW);
      break;
    case 1: // solid
      digitalWrite(pin, HIGH);
      break;
    case 2: // blink
      if (millis() - l.started >= l.param) { l.started = millis(); l.on = !l.on; }
      digitalWrite(pin, l.on ? HIGH : LOW);
      break;
    case 3: // flash once, then off
      digitalWrite(pin, millis() - l.started < l.param ? HIGH : LOW);
      break;
    default:
      digitalWrite(pin, LOW);
  }
}

/** Green = AP, blue = router link, red = signal flash / error blink. */
void updateLeds() {

  // Green: solid when the AP is up, slow blink if it failed to start.
  ledSet(ledAP, apUp ? 1 : 2, apUp ? 0 : 1000);
  ledUpdate(ledAP, LED_AP_PIN);

  // Blue: blinking = connecting, solid = connected, off = failed.
  wl_status_t st = WiFi.status();
  uint8_t wifiMode = 0;
  unsigned long wifiParam = 0;
  if (st == WL_CONNECTED) {
    wifiMode = 1;
  } else if (st == WL_IDLE_STATUS || st == WL_DISCONNECTED) {
    wifiMode = 2;
    wifiParam = 500;
  }
  ledSet(ledWiFi, wifiMode, wifiParam);
  ledUpdate(ledWiFi, LED_WIFI_PIN);

  // Red: 2 s flash per received signal, else slow blink when the
  // website/admin can't be reached (no router Wi-Fi), else off.
  if (signalActive) {
    ledSet(ledAct, 3, 2000);
  } else if (WiFi.status() != WL_CONNECTED) {
    ledSet(ledAct, 2, 1000);
  } else {
    ledSet(ledAct, 0, 0);
  }
  ledUpdate(ledAct, LED_ACT_PIN);
}

/** Returns true on a fresh button press (debounced, waits for release). */
bool buttonPressed(int pin, bool *lastState) {
  bool s = digitalRead(pin);
  if (*lastState == HIGH && s == LOW) {
    delay(50);
    if (digitalRead(pin) == LOW) {
      while (digitalRead(pin) == LOW) delay(10);
      *lastState = HIGH;
      return true;
    }
  }
  *lastState = s;
  return false;
}


// ================================
// FORWARD SIGNAL TO WEBSITE
// ================================

/** Show the outcome of the last web forward on the LCD (debug). */
void showWebResult() {
  char line[17];
  if (lastWebResult == -1) {
    showMessage("WEB RESULT", "NO WIFI");
  } else if (lastWebResult > 0) {
    snprintf(line, sizeof(line), "OK (HTTP %d)", lastWebResult);
    showMessage("WEB RESULT", line);
  } else {
    showMessage("WEB RESULT", "FAIL");
  }
}

int forwardToWebsite(int senderID, const char* message) {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi not connected - cannot forward");
    lastWebResult = -1;
    return -1;
  }

  HTTPClient http;
  http.begin(SIGNAL_URL);
  http.addHeader("Content-Type", "application/json");

  if (strlen(SIGNAL_TOKEN) > 0) {
    http.addHeader("x-signal-token", SIGNAL_TOKEN);
  }

  char payload[96];
  snprintf(
    payload,
    sizeof(payload),
    "{\"senderID\":%d,\"message\":\"%s\"}",
    senderID,
    message
  );

  int httpCode = http.POST(payload);
  lastWebResult = httpCode;

  if (httpCode > 0) {
    Serial.print("Forwarded to website (HTTP ");
    Serial.print(httpCode);
    Serial.println(")");
  } else {
    Serial.print("Forward FAILED: ");
    Serial.println(http.errorToString(httpCode).c_str());
  }

  http.end();
  return httpCode;
}


// ================================
// RECEIVE SIGNAL (UDP)
// ================================

/** Send one status update (from the website) to the sender's LCD over UDP. */
void forwardNotification(int senderID, const char* type, const char* text) {
  if (senderID < 1 || senderID > 4) return;
  if (senderIPs[senderID] == IPAddress(0, 0, 0, 0)) {
    Serial.printf("Notify sender %d (%s): skipped - IP unknown (sender not registered yet)\n", senderID, type);
    return;
  }
  // The website sends lowercase types; the senders expect uppercase.
  char typeUp[12];
  int i = 0;
  for (; type[i] && i < (int)sizeof(typeUp) - 1; i++) {
    char c = type[i];
    typeUp[i] = (c >= 'a' && c <= 'z') ? (c - 'a' + 'A') : c;
  }
  typeUp[i] = '\0';
  Message m;
  m.senderID = senderID;
  strncpy(m.type, typeUp, sizeof(m.type) - 1);
  m.type[sizeof(m.type) - 1] = '\0';
  strncpy(m.text, text, sizeof(m.text) - 1);
  m.text[sizeof(m.text) - 1] = '\0';
  udp.beginPacket(senderIPs[senderID], UDP_PORT);
  udp.write((uint8_t*)&m, sizeof(m));
  udp.endPacket();
  Serial.printf("Notify sender %d (%s): sent -> %s (%s)\n", senderID, type, senderIPs[senderID].toString().c_str(), text);
}

/** Poll the website for undelivered sender notifications (plain text lines). */
void pollNotifications() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(NOTIFY_URL);
  if (strlen(SIGNAL_TOKEN) > 0) {
    http.addHeader("x-signal-token", SIGNAL_TOKEN);
  }
  int code = http.GET();
  if (code == 200) {
    String body = http.getString();
    int start = 0;
    while (start < (int)body.length()) {
      int nl = body.indexOf('\n', start);
      String line = (nl < 0) ? body.substring(start) : body.substring(start, nl);
      line.trim();
      if (line.length() > 0) {
        int p1 = line.indexOf('|');
        int p2 = line.indexOf('|', p1 + 1);
        if (p1 > 0 && p2 > p1) {
          int id = line.substring(0, p1).toInt();
          String type = line.substring(p1 + 1, p2);
          String text = line.substring(p2 + 1);
          forwardNotification(id, type.c_str(), text.c_str());
        }
      }
      if (nl < 0) break;
      start = nl + 1;
    }
  } else if (code > 0) {
    Serial.printf("Notification poll HTTP %d\n", code);
  }
  http.end();
}

/** Handle one incoming UDP packet from a sender. */
void handleUdp() {
  int len = udp.parsePacket();
  if (len <= 0) return;
  IPAddress src = udp.remoteIP();
  if (len != sizeof(Message)) {
    Serial.println("Invalid UDP packet!");
    return;
  }
  Message m;
  udp.read((uint8_t*)&m, sizeof(m));

  if (m.senderID >= 1 && m.senderID <= 4) {
    senderIPs[m.senderID] = src;
  } else {
    Serial.printf("UNKNOWN SENDER (id=%d from %s)\n", m.senderID, src.toString().c_str());
  }

  // Internal hello so the Master knows where to send LCD updates. Never
  // forwarded to the website.
  if (strcmp(m.type, "REGISTER") == 0) {
    Serial.printf("Sender %d registered (IP %s)\n", m.senderID, src.toString().c_str());
    return;
  }

  Serial.println();
  Serial.println("====================");
  Serial.println("SIGNAL RECEIVED");

  // Four senders (ESP8266 D1 Mini boards) report senderID 1..4 with type
  // "SIGNAL" (request) or "CANCEL" (withdraw the request).
  if (m.senderID >= 1 && m.senderID <= 4) {
    char fromLine[17];
    snprintf(fromLine, sizeof(fromLine), "FROM: SENDER %d", m.senderID);
    Serial.println(fromLine);
    if (strcmp(m.type, "CANCEL") == 0) {
      showMessage("CANCEL RECEIVED", fromLine);
    } else {
      showMessage("SIGNAL RECEIVED", fromLine);
    }
  } else {
    showMessage("SIGNAL RECEIVED", "UNKNOWN SENDER");
  }

  Serial.print("MESSAGE: ");
  Serial.println(m.type);

  Serial.println("====================");

  // Start 2-second timer
  signalTime = millis();
  signalActive = true;

  // Queue the HTTP forward (handled in loop())
  forwardPending = true;
  forwardSenderID = m.senderID;
  strncpy(forwardMessage, m.type, sizeof(forwardMessage) - 1);
  forwardMessage[sizeof(forwardMessage) - 1] = '\0';
}

/**
 * Keep the AP on the same channel as the router connection. Both interfaces
 * share one radio, so if the router's channel changes (auto-channel), the
 * senders' AP must follow or they lose the link.
 */
void syncChannels() {
  if (WiFi.status() != WL_CONNECTED) return;
  static unsigned long last = 0;
  if (millis() - last < 10000) return;
  last = millis();
  uint8_t want = WiFi.channel();
  uint8_t have = 0;
  wifi_second_chan_t second = WIFI_SECOND_CHAN_NONE;
  esp_wifi_get_channel(&have, &second);
  if (have != want) {
    esp_wifi_set_channel(want, WIFI_SECOND_CHAN_NONE);
    Serial.printf("AP channel synced to %u\n", want);
  }
}


// ================================
// SETUP
// ================================

void setup() {

  Serial.begin(115200);

  // Status LEDs (green AP / blue Wi-Fi / red activity-error) + reboot button
  pinMode(LED_AP_PIN, OUTPUT);
  pinMode(LED_WIFI_PIN, OUTPUT);
  pinMode(LED_ACT_PIN, OUTPUT);
  digitalWrite(LED_AP_PIN, LOW);
  digitalWrite(LED_WIFI_PIN, LOW);
  digitalWrite(LED_ACT_PIN, LOW);
  pinMode(REBOOT_BUTTON_PIN, INPUT_PULLUP);

  // Never save/restore Wi-Fi settings to flash (NVS). Without this, a stale
  // AP/STA config left by a previous sketch on the board (e.g. a lab image
  // with a different AP name) can override or conflict with the AP we
  // configure here.
  WiFi.persistent(false);

  delay(1000);

  // LCD
  Wire.begin(25, 26);

  lcd.init();
  lcd.backlight();

  showMessage("MASTER ESP32", "BOOTING...");

  // Network setup - AP FIRST, then the router connection. Starting the AP
  // before the station is the most reliable ordering on the ESP32: the AP
  // comes up immediately, and when the STA joins the router the driver
  // moves BOTH interfaces onto the router's channel while keeping the AP
  // alive. (Starting the AP after the STA connected has been flaky on some
  // boards/cores and can leave the AP silent.)
  // Fully stop the WiFi stack first: some ESP32 cores restore a default or
  // stale AP config (e.g. "ESP_A31A15") on boot, which makes our softAP()
  // call fail. A full OFF -> AP_STA restart clears it.
  WiFi.mode(WIFI_OFF);
  delay(200);
  WiFi.mode(WIFI_AP_STA);
  delay(200); // let the WiFi driver settle after the mode change

  // Start the AP with retries - on some ESP32 cores the first softAP() call
  // right after a mode change fails spuriously (returns false), and a retry
  // succeeds.
  bool apOk = false;
  for (int attempt = 0; attempt < 3 && !apOk; attempt++) {
    apOk = WiFi.softAP(AP_SSID, AP_PASSWORD, 1, 0, AP_MAX_CLIENTS);
    if (!apOk) {
      Serial.printf("softAP attempt %d FAILED, retrying...\n", attempt + 1);
      delay(500);
    }
  }
  Serial.printf("softAP('%s') -> %s\n", AP_SSID, apOk ? "OK" : "FAILED");
  apUp = apOk; // green LED: solid = AP up, slow blink = AP failed
  // 802.11 b/g only + HT20: some ESP8266s can't associate with the ESP32's
  // default 802.11n AP.
  esp_wifi_set_protocol(WIFI_IF_AP, WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G);
  esp_wifi_set_bandwidth(WIFI_IF_AP, WIFI_BW_HT20);
  Serial.printf("AP SSID now: %s\n", WiFi.softAPSSID().c_str());
  Serial.printf("AP IP: %s\n", WiFi.softAPIP().toString().c_str());

  // Wi-Fi (STA) - for the website HTTP forwarding
  showMessage("MASTER ESP32", "Wi-Fi connecting");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");

  unsigned long wifiStart = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 10000) {
    delay(500);
    updateLeds(); // blue blinks while connecting
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected! IP: ");
    Serial.println(WiFi.localIP());

    // Both interfaces share one radio: force them onto the router's channel.
    esp_wifi_set_channel(WiFi.channel(), WIFI_SECOND_CHAN_NONE);
    Serial.print("WiFi Channel: ");
    Serial.println(WiFi.channel());

    char ipLine[24];
    snprintf(ipLine, sizeof(ipLine), "IP: %s", WiFi.localIP().toString().c_str());
    showMessage("WIFI CONNECTED", ipLine);
  } else {
    Serial.println("Wi-Fi connection FAILED - check SSID/password");
    showMessage("WIFI FAILED", "check SSID/pass");
  }

  delay(2000); // keep the boot status readable before UDP starts

  // UDP: receive signals from the senders, push LCD updates back
  udp.begin(UDP_PORT);
  Serial.printf("UDP listening on port %d\n", UDP_PORT);

  Serial.println("Master ready!");

  showMessage("UDP READY", "AP: EduFlow");
  delay(1500);
  showDefaultScreen();
}


// ================================
// LOOP
// ================================

void loop() {

  // Status LEDs (green AP / blue Wi-Fi / red signal-error)
  updateLeds();

  // Reboot button (GPIO 32): press to restart the Master, like the EN button
  if (buttonPressed(REBOOT_BUTTON_PIN, &lastRebootState)) {
    Serial.println("REBOOT BUTTON pressed - restarting Master...");
    showMessage("REBOOTING", "button pressed");
    delay(300);
    ESP.restart();
  }

  // Poll the website for sender-LCD updates (accepted/rejected/msg/informed)
  if (millis() - lastNotifyPoll >= NOTIFY_POLL_MS) {
    lastNotifyPoll = millis();
    pollNotifications();
  }

  // Keep the senders' AP on the router's channel
  syncChannels();

  // Handle anything the senders sent us
  handleUdp();

  // After the 2-second signal flash, show the web-forward result (debug)
  if (signalActive && millis() - signalTime >= 2000) {

    signalActive = false;

    if (lastWebResult != 0) {
      showWebResult();
      resultActive = true;
      resultTime = millis();
    } else {
      showDefaultScreen();
    }

    Serial.println("Signal display done - showing web result");
  }

  // Return to READY after the web result has been visible for 2 seconds
  if (resultActive && millis() - resultTime >= 2000) {

    resultActive = false;

    showDefaultScreen();

    Serial.println("Returned to READY");
  }

  // Forward the last received signal to the website (once)
  if (forwardPending) {

    forwardPending = false;

    forwardToWebsite(forwardSenderID, forwardMessage);
  }
}