/*
 * ============================================================
 * OBSOLETE - DO NOT FLASH.
 * The system no longer uses ESP-NOW: senders now join the Master's
 * own Wi-Fi network and talk UDP (see sender1.c-4.c + master.c).
 * This sketch is kept only as a historical ESP-NOW test.
 * ============================================================
 * DIAGNOSTIC MASTER - ESP32 (DOIT ESP32 DEVKIT V1)
 * ============================================================
 * Minimal ESP-NOW receiver ONLY. No LCD, no HTTP forwarding,
 * no notification polling.
 *
 * Connects to Wi-Fi (this locks the ESP32 to the router's
 * channel - print that channel and set ESP_NOW_CHANNEL to the
 * same value in the sender sketch), then prints every ESP-NOW
 * packet it receives:
 *
 *   - sender MAC
 *   - packet length
 *   - senderID / type / text (the shared Message struct)
 *
 * IMPORTANT: the ESP32 does NOT need the sender added as a peer
 * to RECEIVE ESP-NOW (peers are only required for SENDING).
 * So this sketch adds no peers at all.
 *
 * Board: ESP32 Dev Module   (ESP32 core, newer ESP-NOW API)
 * ============================================================
 */

#include <WiFi.h>
#include <esp_now.h>
#include "esp_mac.h"

// --- FILL IN: same network the senders' channel must match ---
const char* WIFI_SSID = "Alfa";
const char* WIFI_PASSWORD = "112233445566";

// Shared packet layout (identical to the real project).
typedef struct {
  int senderID;
  char type[12];
  char text[40];
} Message;

/** Newer ESP-NOW receive callback (esp_now_recv_info_t). */
void OnDataRecv(const esp_now_recv_info_t *info, const uint8_t *incomingData, int len) {
  Serial.printf("\n[recv] from %02X:%02X:%02X:%02X:%02X:%02X  len=%d\n",
                info->src_addr[0], info->src_addr[1], info->src_addr[2],
                info->src_addr[3], info->src_addr[4], info->src_addr[5],
                len);

  if (len == sizeof(Message)) {
    Message m;
    memcpy(&m, incomingData, sizeof(m));
    Serial.printf("[recv] senderID=%d type=\"%s\" text=\"%s\"\n",
                  m.senderID, m.type, m.text);
    Serial.println("***** SIGNAL RECEIVED *****");
    Serial.printf("FROM: SENDER %d\n", m.senderID);
  } else {
    Serial.printf("[recv] UNEXPECTED LENGTH %d (expected %d). Raw bytes: ",
                  len, (int)sizeof(Message));
    for (int i = 0; i < len; i++) {
      Serial.printf("%02X ", incomingData[i]);
    }
    Serial.println();
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("===== DIAG MASTER (ESP32) =====");

  // Connect to Wi-Fi: this locks the ESP32 to the router's channel,
  // which is the channel ESP-NOW receives on.
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("Wi-Fi connection FAILED - check SSID/password");
  }

  Serial.printf("WiFi Channel: %u\n", WiFi.channel());
  Serial.println("-> set ESP_NOW_CHANNEL in diag-sender.c to this value");

  // MAC the senders must target
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  Serial.printf("MASTER MAC: %02X:%02X:%02X:%02X:%02X:%02X\n",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  // ESP-NOW: no peers needed for receiving
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init FAILED");
    return;
  }
  esp_now_register_recv_cb(OnDataRecv);

  Serial.println("ESP-NOW initialized!");
  Serial.println("Master ready! Waiting for packets...");
}

void loop() {
  delay(50);
}
