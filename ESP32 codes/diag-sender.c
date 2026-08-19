/*
 * ============================================================
 * OBSOLETE - DO NOT FLASH.
 * The system no longer uses ESP-NOW: senders now join the Master's
 * own Wi-Fi network and talk UDP (see sender1.c-4.c + master.c).
 * This sketch is kept only as a historical ESP-NOW test.
 * ============================================================
 * DIAGNOSTIC SENDER - ESP8266 (LOLIN/WEMOS D1 Mini)
 * ============================================================
 * Minimal ESP-NOW transmitter ONLY. No LCD, no buttons, no HTTP.
 *
 * Sends one test packet every 2 seconds and prints everything
 * on the Serial Monitor so you can see exactly where ESP-NOW
 * succeeds or fails:
 *
 *   - Wi-Fi connect result (IP + channel)
 *   - own MAC (STA)
 *   - target MAC (ESP32 Master)
 *   - esp_now_init() result
 *   - self role
 *   - esp_now_add_peer() result
 *   - esp_now_send() result  (true = accepted, false = REJECTED LOCALLY)
 *   - packet length + contents
 *   - send callback status   (0 = delivered, != 0 = delivery failed)
 *
 * THE FIX BEING VERIFIED: the sender now CONNECTS to the same
 * Wi-Fi network as the ESP32 Master. A connected ESP8266 is
 * automatically on the router's channel - the same channel the
 * Master listens on (it is connected too). No channel tricks
 * needed. An unconnected ESP8266 would sit on channel 1 and its
 * ESP-NOW packets would never reach the Master.
 *
 * Board: LOLIN(WEMOS) D1 mini   (ESP8266 core)
 * ============================================================
 */

#include <ESP8266WiFi.h>
#include <espnow.h>

// --- FILL IN: same network the ESP32 Master connects to ---
const char* WIFI_SSID = "Alfa";
const char* WIFI_PASSWORD = "112233445566";

// --- FILL IN: the ESP32 Master's STA MAC (printed by the Master) ---
uint8_t masterAddress[] = {
  0x1C, 0x69, 0x20, 0xA3, 0x1A, 0x14
};

// Shared packet layout (identical to the real project).
typedef struct {
  int senderID;
  char type[12];
  char text[40];
} Message;

Message data;

unsigned long lastSend = 0;
unsigned int packetCount = 0;

/** Called after every esp_now_send(): 0 = delivered, else failed. */
void OnDataSent(uint8_t *mac_addr, uint8_t status) {
  Serial.printf("[send_cb] mac=%02X:%02X:%02X:%02X:%02X:%02X status=%u (%s)\n",
                mac_addr[0], mac_addr[1], mac_addr[2],
                mac_addr[3], mac_addr[4], mac_addr[5],
                status, status == 0 ? "DELIVERED" : "DELIVERY FAIL");
}

void sendTestPacket() {
  packetCount++;

  data.senderID = 1;
  strcpy(data.type, "SIGNAL");
  data.text[0] = '\0';

  Serial.printf("\n--- attempt #%u ---\n", packetCount);
  Serial.printf("Wi-Fi channel now: %u\n", WiFi.channel());

  bool ok = esp_now_send(masterAddress, (uint8_t *)&data, sizeof(data));
  Serial.printf("[send] esp_now_send() -> %s (packet len = %d)\n",
                ok ? "true (accepted by ESP-NOW)" : "false (REJECTED LOCALLY)",
                (int)sizeof(data));
  if (ok) {
    Serial.printf("[send] contents: senderID=%d type=\"%s\" text=\"%s\"\n",
                  data.senderID, data.type, data.text);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("===== DIAG SENDER (ESP8266 D1 Mini) =====");

  // 1. Station mode, then connect to the SAME network as the Master.
  //    This is the fix: the channel comes from the router, so sender
  //    and Master are automatically on the same channel.
  WiFi.mode(WIFI_STA);
  delay(100);

  Serial.printf("Connecting to Wi-Fi \"%s\"", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 10000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[wifi] Channel: %u\n", WiFi.channel());
    Serial.println("[wifi] -> the Master must be on this channel too (it connects to the same router)");
  } else {
    Serial.println("[wifi] CONNECT FAILED - check SSID/password. ESP-NOW will NOT work without the connection.");
    return;
  }

  // 2. MAC addresses
  Serial.printf("Own   MAC (STA): %s\n", WiFi.macAddress().c_str());
  Serial.printf("Target MAC     : %02X:%02X:%02X:%02X:%02X:%02X\n",
                masterAddress[0], masterAddress[1], masterAddress[2],
                masterAddress[3], masterAddress[4], masterAddress[5]);

  // 3. ESP-NOW init
  int init = esp_now_init();
  Serial.printf("[espnow] esp_now_init() -> %d (%s)\n", init, init == 0 ? "OK" : "FAIL");
  if (init != 0) return;

  // 4. Role: CONTROLLER can send AND receive (we need receive for LCD status)
  esp_now_set_self_role(ESP_NOW_ROLE_CONTROLLER);
  Serial.printf("[espnow] self role -> %d (CONTROLLER = %d)\n",
                esp_now_get_self_role(), ESP_NOW_ROLE_CONTROLLER);

  // 5. Peer: the ESP32 Master. Channel 0 = use the current channel.
  int pa = esp_now_add_peer(masterAddress, ESP_NOW_ROLE_SLAVE, 0, NULL, 0);
  Serial.printf("[espnow] esp_now_add_peer() -> %d (%s)\n", pa, pa == 0 ? "OK" : "FAIL");
  if (pa != 0) return;

  // 6. Callback
  esp_now_register_send_cb(OnDataSent);

  Serial.println();
  Serial.println("READY - sending one test packet every 2 seconds...");
  Serial.println("(watch the ESP32's Serial Monitor for \"SIGNAL RECEIVED\")");
}

void loop() {
  if (millis() - lastSend >= 2000) {
    lastSend = millis();
    sendTestPacket();
  }
  delay(10);
}
