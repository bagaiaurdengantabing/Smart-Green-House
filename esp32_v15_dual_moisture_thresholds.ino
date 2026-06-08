/*
  Smart Green House System V15
  ESP32 + Supabase + Website Adjustable Thresholds + Dual Soil Moisture Sensors

  Website threshold flow:
  Website Threshold Settings -> Supabase system_settings -> ESP32 reads every 5 seconds

  New update:
  - API URL/key is inside code, not pasted in website UI.
  - Two soil moisture sensors are used.
  - Overall soil moisture = (sensor 1 + sensor 2) / 2.
  - Auto irrigation pump is based on overall soil moisture.
  - Bottom tray water sensor controls tray return pump.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <BH1750.h>
#include <DHT.h>

// ================= WIFI + SUPABASE =================
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";

String SUPABASE_URL = "https://jtnqlzdrwosrgqoxvjxs.supabase.co";
String SUPABASE_KEY = "PASTE_YOUR_LONG_ANON_KEY_HERE";

String READINGS_TABLE = "sensor_readings";
String CONTROL_TABLE = "device_controls";
String EVENTS_TABLE = "device_events";
String ALERTS_TABLE = "system_alerts";
String SETTINGS_TABLE = "system_settings";

// ================= SENSOR PINS =================
#define SDA_PIN 21
#define SCL_PIN 22
#define BH1750_ADDR 0x23

#define DHT_PIN 4
#define DHT_TYPE DHT11

#define MOISTURE_1_PIN 34
#define MOISTURE_2_PIN 33

// This water level sensor is placed at the BOTTOM TRAY.
#define WATER_LEVEL_PIN 35

// ================= RELAY PINS =================
// Total 4 relay channels
#define LIGHT_RELAY_PIN 26
#define PUMP_RELAY_PIN 27              // irrigation pump
#define FERTILIZER_RELAY_PIN 25
#define TRAY_PUMP_RELAY_PIN 32         // pump tray water back to main water tank

// ================= SENSOR CALIBRATION =================
// Adjust these values after real sensor testing.
#define DRY_VALUE 4095
#define WET_VALUE 1500

#define WATER_EMPTY_VALUE 0
#define WATER_FULL_VALUE 2500

// ================= DEFAULT THRESHOLDS =================
// Website values will replace these after ESP32 reads Supabase.
int lightThresholdLux = 150;
int moistureThresholdPercent = 70;
int trayWaterThresholdPercent = 0;

// Relay module active LOW
#define RELAY_ON LOW
#define RELAY_OFF HIGH

BH1750 lightMeter;
DHT dht(DHT_PIN, DHT_TYPE);
bool bh1750Ready = false;

// ================= TIMERS =================
unsigned long lastUploadTime = 0;
unsigned long uploadInterval = 3000;

unsigned long lastControlCheck = 0;
unsigned long controlCheckInterval = 1000;

unsigned long lastSettingsCheck = 0;
unsigned long settingsCheckInterval = 5000;

unsigned long lastTimerUpdate = 0;

// ================= DEVICE CONTROL STATES =================
String lightMode = "auto";
bool lightTarget = false;

String pumpMode = "auto";
bool pumpTarget = false;

String trayPumpMode = "auto";
bool trayPumpTarget = false;

// Fertilizer pump remains manual only
bool fertilizerTarget = false;

// ================= PREVIOUS STATES =================
bool prevLightState = false;
bool prevPumpState = false;
bool prevTrayPumpState = false;
bool prevFertilizerState = false;

// ================= ON TIME COUNTERS =================
unsigned long lightOnSeconds = 0;
unsigned long pumpOnSeconds = 0;
unsigned long trayPumpOnSeconds = 0;
unsigned long fertilizerOnSeconds = 0;

// ================= ALERT FLAGS =================
bool pumpFiveMinAlertSent = false;
bool trayWaterAlertSent = false;

// ================= BASIC FUNCTIONS =================
bool checkI2CDevice(byte address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

int clampInt(int value, int minValue, int maxValue) {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

int readMoisturePercent(int pin) {
  int raw = analogRead(pin);
  int percent = map(raw, DRY_VALUE, WET_VALUE, 0, 100);
  return clampInt(percent, 0, 100);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting WiFi");

  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 40) {
    delay(500);
    Serial.print(".");
    retry++;
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi failed. Use 2.4GHz WiFi.");
  }
}

String postJSON(String table, String jsonData) {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return "NO_WIFI";

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String endpoint = SUPABASE_URL + "/rest/v1/" + table;
  http.begin(client, endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  int code = http.POST(jsonData);
  String response = http.getString();
  http.end();

  Serial.print("POST ");
  Serial.print(table);
  Serial.print(" code: ");
  Serial.println(code);

  if (code != 201) Serial.println(response);
  return String(code);
}

void uploadAlert(String type, String message) {
  String json = "{";
  json += "\"alert_type\":\"" + type + "\",";
  json += "\"message\":\"" + message + "\",";
  json += "\"severity\":\"warning\"";
  json += "}";

  postJSON(ALERTS_TABLE, json);
}

void uploadEvent(String deviceName, String eventType, int durationSeconds) {
  String json = "{";
  json += "\"device_name\":\"" + deviceName + "\",";
  json += "\"event_type\":\"" + eventType + "\",";
  json += "\"duration_seconds\":" + String(durationSeconds);
  json += "}";

  postJSON(EVENTS_TABLE, json);
}

// ================= READ THRESHOLDS FROM WEBSITE/SUPABASE =================
void fetchThresholdSettings() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String endpoint = SUPABASE_URL + "/rest/v1/" + SETTINGS_TABLE;
  endpoint += "?select=setting_value&setting_key=eq.thresholds";

  http.begin(client, endpoint);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + SUPABASE_KEY);

  int code = http.GET();

  if (code == 200) {
    String payload = http.getString();

    DynamicJsonDocument doc(2048);
    DeserializationError error = deserializeJson(doc, payload);

    if (!error && doc.is<JsonArray>() && doc.size() > 0) {
      JsonVariant settingValue = doc[0]["setting_value"];

      lightThresholdLux = settingValue["light_lux"] | lightThresholdLux;
      moistureThresholdPercent = settingValue["moisture_percent"] | moistureThresholdPercent;
      trayWaterThresholdPercent = settingValue["tray_water_percent"] | trayWaterThresholdPercent;

      lightThresholdLux = constrain(lightThresholdLux, 0, 100000);
      moistureThresholdPercent = constrain(moistureThresholdPercent, 0, 100);
      trayWaterThresholdPercent = constrain(trayWaterThresholdPercent, 0, 100);

      Serial.println("Threshold updated from website:");
      Serial.print("Light lux threshold: ");
      Serial.println(lightThresholdLux);
      Serial.print("Overall moisture threshold: ");
      Serial.println(moistureThresholdPercent);
      Serial.print("Tray water threshold: ");
      Serial.println(trayWaterThresholdPercent);
    }
  } else {
    Serial.print("Fetch threshold settings failed: ");
    Serial.println(code);
    Serial.println(http.getString());
  }

  http.end();
}

// ================= READ DEVICE BUTTON COMMANDS FROM WEBSITE =================
void fetchControlCommands() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;

  String endpoint = SUPABASE_URL + "/rest/v1/" + CONTROL_TABLE;
  endpoint += "?select=device_name,mode,target_state";

  http.begin(client, endpoint);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + SUPABASE_KEY);

  int code = http.GET();

  if (code == 200) {
    String payload = http.getString();

    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, payload);

    if (!error) {
      for (JsonObject obj : doc.as<JsonArray>()) {
        String deviceName = obj["device_name"] | "";
        String mode = obj["mode"] | "auto";
        bool targetState = obj["target_state"] | false;

        if (deviceName == "light_bulb") {
          lightMode = mode;
          lightTarget = targetState;
        } else if (deviceName == "water_pump") {
          pumpMode = mode;
          pumpTarget = targetState;
        } else if (deviceName == "tray_pump") {
          trayPumpMode = mode;
          trayPumpTarget = targetState;
        } else if (deviceName == "fertilizer_pump") {
          fertilizerTarget = targetState;
        }
      }
    }
  } else {
    Serial.print("Fetch control failed: ");
    Serial.println(code);
    Serial.println(http.getString());
  }

  http.end();
}

// ================= RELAY CONTROL =================
void setRelays(bool lightState, bool pumpState, bool trayPumpState, bool fertilizerState) {
  digitalWrite(LIGHT_RELAY_PIN, lightState ? RELAY_ON : RELAY_OFF);
  digitalWrite(PUMP_RELAY_PIN, pumpState ? RELAY_ON : RELAY_OFF);
  digitalWrite(TRAY_PUMP_RELAY_PIN, trayPumpState ? RELAY_ON : RELAY_OFF);
  digitalWrite(FERTILIZER_RELAY_PIN, fertilizerState ? RELAY_ON : RELAY_OFF);
}

void updateOnTimers(bool lightState, bool pumpState, bool trayPumpState, bool fertilizerState) {
  unsigned long now = millis();

  if (lastTimerUpdate == 0) {
    lastTimerUpdate = now;
    return;
  }

  unsigned long deltaMs = now - lastTimerUpdate;

  if (deltaMs >= 1000) {
    unsigned long deltaSeconds = deltaMs / 1000;

    if (lightState) lightOnSeconds += deltaSeconds;
    else lightOnSeconds = 0;

    if (pumpState) pumpOnSeconds += deltaSeconds;
    else pumpOnSeconds = 0;

    if (trayPumpState) trayPumpOnSeconds += deltaSeconds;
    else trayPumpOnSeconds = 0;

    if (fertilizerState) fertilizerOnSeconds += deltaSeconds;
    else fertilizerOnSeconds = 0;

    lastTimerUpdate += deltaSeconds * 1000;
  }
}

void handleDeviceEvents(bool lightState, bool pumpState, bool trayPumpState, bool fertilizerState) {
  if (lightState != prevLightState) {
    uploadEvent("light_bulb", lightState ? "ON" : "OFF", lightState ? 0 : lightOnSeconds);
    prevLightState = lightState;
  }

  if (pumpState != prevPumpState) {
    if (pumpState) pumpFiveMinAlertSent = false;
    uploadEvent("water_pump", pumpState ? "ON" : "OFF", pumpState ? 0 : pumpOnSeconds);
    prevPumpState = pumpState;
  }

  if (trayPumpState != prevTrayPumpState) {
    uploadEvent("tray_pump", trayPumpState ? "ON" : "OFF", trayPumpState ? 0 : trayPumpOnSeconds);
    prevTrayPumpState = trayPumpState;
  }

  if (fertilizerState != prevFertilizerState) {
    uploadEvent("fertilizer_pump", fertilizerState ? "ON" : "OFF", fertilizerState ? 0 : fertilizerOnSeconds);
    prevFertilizerState = fertilizerState;
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(LIGHT_RELAY_PIN, OUTPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  pinMode(TRAY_PUMP_RELAY_PIN, OUTPUT);
  pinMode(FERTILIZER_RELAY_PIN, OUTPUT);

  setRelays(false, false, false, false);

  connectWiFi();

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);
  delay(500);

  if (checkI2CDevice(BH1750_ADDR)) {
    bh1750Ready = lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, BH1750_ADDR, &Wire);
  } else {
    Serial.println("BH1750 not found. Check SDA/SCL wiring.");
  }

  dht.begin();

  pinMode(MOISTURE_1_PIN, INPUT);
  pinMode(MOISTURE_2_PIN, INPUT);
  pinMode(WATER_LEVEL_PIN, INPUT);

  fetchThresholdSettings();
  fetchControlCommands();

  Serial.println("Smart Green House V15 ready.");
}

// ================= MAIN LOOP =================
void loop() {
  if (millis() - lastControlCheck >= controlCheckInterval) {
    lastControlCheck = millis();
    fetchControlCommands();
  }

  if (millis() - lastSettingsCheck >= settingsCheckInterval) {
    lastSettingsCheck = millis();
    fetchThresholdSettings();
  }

  float lux = -1;
  if (bh1750Ready) {
    lux = lightMeter.readLightLevel();
  }

  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    humidity = -1;
    temperature = -1;
  }

  int moisture1Raw = analogRead(MOISTURE_1_PIN);
  int moisture2Raw = analogRead(MOISTURE_2_PIN);

  int moisture1Percent = map(moisture1Raw, DRY_VALUE, WET_VALUE, 0, 100);
  moisture1Percent = constrain(moisture1Percent, 0, 100);

  int moisture2Percent = map(moisture2Raw, DRY_VALUE, WET_VALUE, 0, 100);
  moisture2Percent = constrain(moisture2Percent, 0, 100);

  int overallMoisturePercent = (moisture1Percent + moisture2Percent) / 2;

  int waterRaw = analogRead(WATER_LEVEL_PIN);
  int waterPercent = map(waterRaw, WATER_EMPTY_VALUE, WATER_FULL_VALUE, 0, 100);
  waterPercent = constrain(waterPercent, 0, 100);

  // ================= AUTO / MANUAL LOGIC =================
  bool lightRelayStatus =
    (lightMode == "manual") ? lightTarget : (lux >= 0 && lux < lightThresholdLux);

  bool pumpRelayStatus =
    (pumpMode == "manual") ? pumpTarget : (overallMoisturePercent < moistureThresholdPercent);

  bool trayPumpRelayStatus =
    (trayPumpMode == "manual") ? trayPumpTarget : (waterPercent > trayWaterThresholdPercent);

  bool fertilizerRelayStatus = fertilizerTarget;

  setRelays(lightRelayStatus, pumpRelayStatus, trayPumpRelayStatus, fertilizerRelayStatus);
  updateOnTimers(lightRelayStatus, pumpRelayStatus, trayPumpRelayStatus, fertilizerRelayStatus);
  handleDeviceEvents(lightRelayStatus, pumpRelayStatus, trayPumpRelayStatus, fertilizerRelayStatus);

  if (waterPercent > trayWaterThresholdPercent && !trayWaterAlertSent) {
    uploadAlert("TRAY_WATER_DETECTED", "Water is detected in the bottom tray. Tray return pump is activated to recycle water back to the tank.");
    trayWaterAlertSent = true;
  }

  if (waterPercent <= trayWaterThresholdPercent) {
    trayWaterAlertSent = false;
  }

  if (pumpRelayStatus && pumpOnSeconds >= 300 && overallMoisturePercent < 60 && !pumpFiveMinAlertSent) {
    uploadAlert("PUMP_LONG_ON_DRY_SOIL", "Irrigation pump has been ON for about 5 minutes, but overall soil moisture is still lower than 60%.");
    pumpFiveMinAlertSent = true;
  }

  Serial.println();
  Serial.println("===== Smart Green House Status =====");
  Serial.print("Temp: "); Serial.println(temperature);
  Serial.print("Humidity: "); Serial.println(humidity);
  Serial.print("Lux: "); Serial.println(lux);

  Serial.print("Moisture Sensor 1: "); Serial.println(moisture1Percent);
  Serial.print("Moisture Sensor 2: "); Serial.println(moisture2Percent);
  Serial.print("Overall Soil Moisture: "); Serial.println(overallMoisturePercent);

  Serial.print("Tray Water Level: "); Serial.println(waterPercent);
  Serial.print("Light threshold: "); Serial.println(lightThresholdLux);
  Serial.print("Overall moisture threshold: "); Serial.println(moistureThresholdPercent);
  Serial.print("Tray threshold: "); Serial.println(trayWaterThresholdPercent);

  Serial.print("Light: "); Serial.print(lightRelayStatus ? "ON" : "OFF");
  Serial.print(" Time: "); Serial.println(lightOnSeconds);

  Serial.print("Irrigation Pump: "); Serial.print(pumpRelayStatus ? "ON" : "OFF");
  Serial.print(" Time: "); Serial.println(pumpOnSeconds);

  Serial.print("Tray Return Pump: "); Serial.print(trayPumpRelayStatus ? "ON" : "OFF");
  Serial.print(" Time: "); Serial.println(trayPumpOnSeconds);

  Serial.print("Fertilizer Pump: "); Serial.print(fertilizerRelayStatus ? "ON" : "OFF");
  Serial.print(" Time: "); Serial.println(fertilizerOnSeconds);

  if (millis() - lastUploadTime >= uploadInterval) {
    lastUploadTime = millis();

    String json = "{";
    json += "\"temperature\":" + String(temperature, 2) + ",";
    json += "\"humidity\":" + String(humidity, 2) + ",";
    json += "\"lux\":" + String(lux, 2) + ",";

    json += "\"moisture_raw\":" + String(moisture1Raw) + ",";
    json += "\"moisture_1_raw\":" + String(moisture1Raw) + ",";
    json += "\"moisture_1_percent\":" + String(moisture1Percent) + ",";
    json += "\"moisture_2_raw\":" + String(moisture2Raw) + ",";
    json += "\"moisture_2_percent\":" + String(moisture2Percent) + ",";
    json += "\"moisture_percent\":" + String(overallMoisturePercent) + ",";

    json += "\"water_level_raw\":" + String(waterRaw) + ",";
    json += "\"water_level_percent\":" + String(waterPercent) + ",";

    json += "\"light_relay\":" + String(lightRelayStatus ? "true" : "false") + ",";
    json += "\"pump_relay\":" + String(pumpRelayStatus ? "true" : "false") + ",";
    json += "\"tray_pump_relay\":" + String(trayPumpRelayStatus ? "true" : "false") + ",";
    json += "\"fertilizer_relay\":" + String(fertilizerRelayStatus ? "true" : "false") + ",";

    json += "\"light_on_seconds\":" + String(lightOnSeconds) + ",";
    json += "\"pump_on_seconds\":" + String(pumpOnSeconds) + ",";
    json += "\"tray_pump_on_seconds\":" + String(trayPumpOnSeconds) + ",";
    json += "\"fertilizer_on_seconds\":" + String(fertilizerOnSeconds);

    json += "}";

    postJSON(READINGS_TABLE, json);
  }

  delay(500);
}
