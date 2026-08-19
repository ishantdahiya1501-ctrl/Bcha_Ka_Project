#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define SENDER_ID 2

// --- The Master's own Wi-Fi network (the ESP32 Master runs this AP) ---
const char* WIFI_SSID = "EduFlow";
const char* WIFI_PASSWORD = "eduflow2026";

// The Master's IP on its AP (default 192.168.4.1) + the shared UDP port.
IPAddress masterIP(192, 168, 4, 1);
#define UDP_PORT 4210

// Static address on the Master's network (sender N = 192.168.4.1N):
// sender 1 = .11, sender 2 = .12, sender 3 = .13, sender 4 = .14
IPAddress localIP(192, 168, 4, 10 + SENDER_ID);
IPAddress gateway(192, 168, 4, 1);
IPAddress subnet(255, 255, 255, 0);

// For the ESP8266 D1 Mini: the FLASH button is wired to GPIO 0 and works
// like the old ESP32 BOOT button. Want an external button? Wire it between
// the chosen GPIO and GND and change BUTTON_PIN.
#define BUTTON_PIN 0

// Second button: CANCEL the request that was sent. Wire a push button between
// the chosen GPIO and GND (D5/GPIO 14 by default) or set to -1 to disable.
#define BUTTON_CANCEL_PIN 14

// --- Status LEDs (external, each with a ~220 ohm resistor in series to GND) ---
//   Blue LED: D6 (GPIO 12)  SOLID = no errors | BLINKING = booting/connecting
//   Red  LED: D7 (GPIO 13)  BLINKING = the Master ("admin") is not reachable
//                            (a short red FLASH = a UDP packet failed to send)
//   Both are ACTIVE HIGH. Want to reuse the D1 Mini's onboard LED instead?
//   It is on D4/GPIO 2 and ACTIVE LOW, so the code below would need inverting.
#define BLUE_LED_PIN 12
#define RED_LED_PIN 13

// I2C LCD (16x2) on the D1 Mini: SDA -> D2 (GPIO 4), SCL -> D1 (GPIO 5).
// Try 0x3F if the LCD stays dark with 0x27.
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Shared packet layout (identical on Master + all senders).
//   sender -> master: { senderID, type: "SIGNAL"|"CANCEL"|"REGISTER", text: "" }
//   master -> sender: { senderID, type: ACCEPTED|REJECTED|MESSAGE|INFORMED|CANCELLED, text }
typedef struct {
  int senderID;
  char type[12];
  char text[40];
} Message;

Message data;
WiFiUDP udp;

bool lastButtonState = HIGH;
bool lastCancelState = HIGH;

// LCD status area
char lcdLine2[48] = "";
unsigned long lcdUntil = 0; // 0 = persistent READY screen
int scrollPos = 0;
unsigned long scrollTick = 0;
bool scrolling = false;

// --- Status LED state machine -------------------------------------------
enum LedMode { LED_BOOT_BLINK, LED_OK, LED_ERROR_BLINK, LED_RED_FLASH };
LedMode ledMode = LED_BOOT_BLINK;     // start: blue blinking (booting)
LedMode ledBaseMode = LED_BOOT_BLINK; // mode to return to after a red flash
unsigned long ledFlashUntil = 0;
unsigned long ledTick = 0;
bool ledOn = false;

/** Drives both LEDs from the current mode. Call every loop(). */
void updateLeds() {
  if (ledMode == LED_RED_FLASH) { // transient red flash (e.g. UDP send failed)
    digitalWrite(BLUE_LED_PIN, LOW);
    digitalWrite(RED_LED_PIN, HIGH);
    if (millis() >= ledFlashUntil) ledMode = ledBaseMode;
    return;
  }
  switch (ledMode) {
    case LED_OK: // solid blue - everything fine
      digitalWrite(BLUE_LED_PIN, HIGH);
      digitalWrite(RED_LED_PIN, LOW);
      break;
    case LED_BOOT_BLINK: // blue blinking - booting / connecting to the Master
      if (millis() - ledTick >= 250) { ledTick = millis(); ledOn = !ledOn; }
      digitalWrite(BLUE_LED_PIN, ledOn ? HIGH : LOW);
      digitalWrite(RED_LED_PIN, LOW);
      break;
    case LED_ERROR_BLINK: // red blinking - admin (Master) not found
      if (millis() - ledTick >= 500) { ledTick = millis(); ledOn = !ledOn; }
      digitalWrite(BLUE_LED_PIN, LOW);
      digitalWrite(RED_LED_PIN, ledOn ? HIGH : LOW);
      break;
    default: break;
  }
}

/** Switch to a persistent LED mode (boot / ok / error). */
void setLedMode(LedMode m) {
  if (ledMode == m && ledBaseMode == m) return; // already there
  ledBaseMode = m;
  ledMode = m;
  switch (m) {
    case LED_OK:
      Serial.println("LED: OK (solid blue)");
      break;
    case LED_BOOT_BLINK:
      Serial.println("LED: booting (blue blinking)");
      break;
    case LED_ERROR_BLINK:
      Serial.println("LED: ERROR (red blinking) - admin not found");
      break;
    default: break;
  }
}

/** Brief red flash for a transient error, then back to the base mode. */
void ledFlashRed(unsigned long ms) {
  ledFlashUntil = millis() + ms;
  ledMode = LED_RED_FLASH;
}

// --- Wi-Fi link to the Master -------------------------------------------
bool wifiConnected = false; // true while associated with the Master's AP
bool linkUp = false;        // UDP socket open + REGISTER sent once
unsigned long lastReconnect = 0;
#define RECONNECT_INTERVAL 5000 // ms between (re)connect attempts

/** Send one packet (SIGNAL / CANCEL / REGISTER) to the Master over UDP. */
void sendPacket(const char* type) {
  data.senderID = SENDER_ID;
  strcpy(data.type, type);
  data.text[0] = '\0';
  udp.beginPacket(masterIP, UDP_PORT);
  udp.write((uint8_t*)&data, sizeof(data));
  bool ok = udp.endPacket();
  if (ok) {
    Serial.printf("%s SENT - SENDER %d (UDP)\n", type, SENDER_ID);
  } else {
    Serial.println("UDP SEND FAILED");
    ledFlashRed(400); // brief red flash, then back to the normal state
  }
}

void sendSignal() { sendPacket("SIGNAL"); }

/** Tell the admin the request is being withdrawn (CANCEL button). */
void sendCancel() { sendPacket("CANCEL"); }

/** Show a line pair on the LCD; ms = how long before returning to READY (0 = keep). */
void lcdShow(const char* line1, const char* line2, unsigned long ms) {
  scrolling = false;
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  strncpy(lcdLine2, line2 ? line2 : "", sizeof(lcdLine2) - 1);
  lcdLine2[sizeof(lcdLine2) - 1] = '\0';
  if (strlen(lcdLine2) > 16) {
    scrollPos = 0;
    scrolling = true;
  } else {
    lcd.setCursor(0, 1);
    lcd.print(lcdLine2);
  }
  lcdUntil = ms ? millis() + ms : 0;
}

void showReady() {
  char line1[17];
  snprintf(line1, sizeof(line1), "SENDER %d", SENDER_ID);
  lcdShow(line1, "READY", 0);
}

/** Called from loop(): returns to READY after a status timeout, scrolls long lines. */
void updateLcd() {
  if (lcdUntil && millis() >= lcdUntil) {
    scrolling = false;
    lcdUntil = 0;
    showReady();
    return;
  }
  if (scrolling && millis() - scrollTick >= 300) {
    scrollTick = millis();
    int len = strlen(lcdLine2);
    char buf[17];
    for (int i = 0; i < 16; i++) {
      int idx = scrollPos + i;
      buf[i] = (idx < len) ? lcdLine2[idx] : ' ';
    }
    buf[16] = '\0';
    lcd.setCursor(0, 1);
    lcd.print(buf);
    scrollPos++;
    if (scrollPos >= len) scrollPos = 0;
  }
}

/** Master -> sender status packets (accepted/rejected, admin msg, informed). */
void handleUdp() {
  int len = udp.parsePacket();
  if (len <= 0) return;
  if (len != sizeof(Message)) return;
  Message m;
  udp.read((uint8_t*)&m, sizeof(m));
  if (m.senderID != SENDER_ID) return; // someone else's packet

  if (strcmp(m.type, "ACCEPTED") == 0) {
    char line2[48];
    snprintf(line2, sizeof(line2), "Cover: %s", m.text);
    lcdShow("ACCEPTED", line2, 6000);
    Serial.print("LCD ACCEPTED - cover: "); Serial.println(m.text);
  } else if (strcmp(m.type, "REJECTED") == 0) {
    lcdShow("REJECTED", m.text, 6000);
    Serial.println("LCD REJECTED");
  } else if (strcmp(m.type, "MESSAGE") == 0) {
    lcdShow("MSG FROM ADMIN", m.text, 6000);
    Serial.print("LCD ADMIN MSG: "); Serial.println(m.text);
  } else if (strcmp(m.type, "INFORMED") == 0) {
    lcdShow("INFORMED", m.text, 6000);
    Serial.print("LCD INFORMED: "); Serial.println(m.text);
  } else if (strcmp(m.type, "CANCELLED") == 0) {
    lcdShow("CANCELLED", m.text, 6000);
    Serial.print("LCD CANCELLED: "); Serial.println(m.text);
  }
}

/**
 * Keeps the link to the Master alive and drives the error LEDs.
 * - Not connected: red LED blinks ("admin not found"); retries every 5 s
 *   so the sender recovers by itself when the Master comes back.
 * - Connected: opens UDP + sends REGISTER once, blue LED turns solid.
 * - Link drops: back to red blinking until reconnected.
 */
void checkWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiConnected) {
      wifiConnected = true;
      setLedMode(LED_OK); // solid blue - no errors
      Serial.print("Connected! IP: ");
      Serial.println(WiFi.localIP());
      Serial.printf("Channel: %u\n", WiFi.channel());
    }
    if (!linkUp) { // first connect (or after a reconnect): open UDP + REGISTER
      linkUp = true;
      udp.begin(UDP_PORT);
      sendPacket("REGISTER");
      Serial.printf("SENDER %d READY\n", SENDER_ID);
      Serial.println("Type SEND or press FLASH button (GPIO 0)");
    }
    return;
  }
  // Not connected: red blinking - the Master ("admin") is unreachable.
  if (wifiConnected) {
    wifiConnected = false;
    linkUp = false;
    Serial.println("Wi-Fi LOST - is the Master powered on? Retrying...");
  }
  setLedMode(LED_ERROR_BLINK);
  if (millis() - lastReconnect >= RECONNECT_INTERVAL) {
    lastReconnect = millis();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // keep retrying so we recover on our own
  }
}

void setup() {

  Serial.begin(115200);

  // Status LEDs (blue on D6, red on D7) - start with blue blinking (booting)
  pinMode(BLUE_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  digitalWrite(BLUE_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, LOW);
  setLedMode(LED_BOOT_BLINK);

  // I2C LCD: SDA -> D2 (GPIO 4), SCL -> D1 (GPIO 5)
  Wire.begin(4, 5);
  lcd.init();
  lcd.backlight();
  showReady();

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  if (BUTTON_CANCEL_PIN >= 0) pinMode(BUTTON_CANCEL_PIN, INPUT_PULLUP);

  // Join the Master's own network. This puts sender and Master on the
  // SAME channel no matter what channel the router picks - no ESP-NOW,
  // no channel tricks, no MAC pairing.
  WiFi.mode(WIFI_STA);
  WiFi.config(localIP, gateway, subnet);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi \"");
  Serial.print(WIFI_SSID);
  Serial.print("\"");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 10000) {
    delay(500);
    updateLeds(); // keep the blue "booting" LED blinking
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi FAILED - is the Master powered on?");
    Serial.println("Scanning for nearby networks...");
    int n = WiFi.scanNetworks();
    for (int i = 0; i < n; i++) {
      Serial.printf("  %s (ch %d, %d dBm)%s\n",
                    WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i),
                    WiFi.SSID(i).equalsIgnoreCase(WIFI_SSID) ? "  <-- target" : "");
    }
    WiFi.scanDelete();
    // No early return: loop() keeps retrying to join the Master's AP and
    // the red LED blinks until the Master ("admin") is reachable again.
  }
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

void loop() {

  // Keep the link to the Master alive and update the status LEDs
  checkWifi();
  updateLeds();

  // -------------------------
  // FLASH / EXTERNAL BUTTON  (send request)
  // -------------------------

  if (buttonPressed(BUTTON_PIN, &lastButtonState)) {
    lcdShow("REQUEST SENT", "TO ADMIN", 4000);
    sendSignal();
  }

  // -------------------------
  // CANCEL BUTTON            (withdraw the sent request)
  // -------------------------

  if (BUTTON_CANCEL_PIN >= 0 && buttonPressed(BUTTON_CANCEL_PIN, &lastCancelState)) {
    lcdShow("CANCEL SENT", "TO ADMIN", 4000);
    sendCancel();
  }

  updateLcd();

  // Receive LCD status updates from the Master
  handleUdp();


  // -------------------------
  // SERIAL MONITOR
  // -------------------------

  if (Serial.available()) {

    String command = Serial.readStringUntil('\n');

    command.trim();

    if (command.equalsIgnoreCase("SEND")) {
      sendSignal();
    }
  }
}