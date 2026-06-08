# Green House System

## New changes

- Reworked the cartoon background into a more interesting **小剧场** system.
- The robot now really looks like it is **watering the plant**.
- Added **6 different moving scenes**, not repeated:
  1. Robot watering garden
  2. Greenhouse scanner
  3. Auto pump filling water tank
  4. Solar powered scene
  5. Drone crop health check
  6. Fertilizer robot sprinkling plant food
- Background image is clearer and more greenhouse-like.
- Alert is now shown as a **popup modal** instead of a long banner.
- Speaker button remains for silent mode.

## BGM note
Modern browsers may still block autoplay sound. This version tries to start BGM automatically, and if blocked, the first click anywhere on the page will start it.

## Login
Default account:
- Username: `admin`
- Password: `12345678`


- Removed the BGM instruction wording from the login page.
- 小剧场 no longer stays fixed in one position.
- Each 小剧场 moves smoothly to different coordinates using left/right/top/bottom roaming zones.
- Animation is optimized with smoother transitions and less heavy movement.

## Final version

Final version name: Green House System



## Continuous BGM Fix Added

This package keeps your original system content, but fixes the sound reset problem.

- `index.html` is now a parent wrapper that keeps BGM alive.

- Your original dashboard page is now `dashboard.html`.

- `login.js` redirects to `dashboard.html` after login.

- `history.html` Back to Dashboard goes to `dashboard.html`.

- `bgm.js` runs only at the parent level, so sound continues when changing pages.

Use the normal Netlify root link:

`https://smartgreenhouse-e1g05.netlify.app`

Do not open `login.html` directly if you want continuous BGM.



## Added: Username and Password in Database

This version keeps your system content and adds user storage into Supabase.

### New table

Run the updated `supabase_schema.sql`. It creates:

- `app_users`

Columns:

- `username`
- `password`
- `created_at`
- `last_login_at`
- `login_count`

### Important setup

Open `supabase_config.js` and paste your long anon key:

```js
const SGHS_SUPABASE_ANON_KEY = "PASTE_YOUR_LONG_ANON_KEY_HERE";
```

The login page does not show the database link or key. It reads from this config file silently.

### Security note

This stores passwords in the database for demo/class checking only. Do not use real passwords.


## Updated Mute Button Behavior

The speaker button now pauses/resumes the same BGM.

- Click 🔊 → BGM pauses/stops only.
- Click 🔇 → same BGM resumes.
- It will not choose a new random song when using mute/unmute.
- To manually change song during testing, open Console and type:

```js
nextRandomBgm()
```


## Final BGM Design

This version uses the YouTube IFrame Player API.

BGM behavior:

- Website first opens: random song selected.
- Moving between Login, Dashboard, and History: song continues.
- Click 🔊: current song pauses only.
- Click 🔇: same song resumes, no reset.
- When a song ends: another random song automatically starts.
- Console test: type `nextRandomBgm()` to manually change song.

Use the normal Netlify root link:

`https://smartgreenhouse-e1g05.netlify.app`

Do not open `login.html` directly if you want continuous BGM.


## Water Recycling Tray Website Update

This version keeps the same overall dashboard layout but updates the content and colors for the new greenhouse water recycling design.

New website items:
- Bottom tray water collection design section.
- Tray water level display.
- Tray return pump control card.
- Tray return pump AUTO mode based on tray water sensor value.
- Fertilizer tank water level sensor wording removed.
- Darker and more colourful dashboard theme.

Database update:
- `tray_pump` added into `device_controls`.
- `tray_pump_relay` added into `sensor_readings`.
- `tray_pump_on_seconds` added into `sensor_readings`.

Run the updated `supabase_schema.sql` in Supabase SQL Editor before using the new tray pump fields.


## Latest Update: Remove Tray Design Section + User Threshold Settings

Removed from website:
- Water Recycling Tray Design section/card area.

Added:
- User adjustable threshold settings in the Settings modal.
- Threshold values are saved into Supabase table `system_settings`.
- Dashboard auto display uses these thresholds:
  - `light_lux`
  - `moisture_percent`
  - `tray_water_percent`

Important:
- Run the updated `supabase_schema.sql` again.
- If you want the ESP32 hardware to also follow these user thresholds, ESP32 code must read the `system_settings` table and update its threshold variables.


## Added Visible Threshold Button

A clear `Threshold Settings` button has been added on the dashboard action row.

There is also a smaller `Thresholds` button inside the Connection card.

Use it to edit:
- Light threshold
- Soil moisture threshold
- Tray water threshold


## Full Connected Design: Website Threshold → Supabase → ESP32

This package connects the website threshold settings to the ESP32 code.

Flow:

1. User opens website.
2. User clicks `Threshold Settings`.
3. User edits:
   - Light threshold
   - Soil moisture threshold
   - Tray water threshold
4. Website saves the values into Supabase table `system_settings`.
5. ESP32 reads `system_settings` every 5 seconds.
6. ESP32 updates real relay control using the new values.

ESP32 code file:

- `esp32_v14_connected_thresholds.ino`

For convenience, `esp32_v13_fixed_timers_graph.ino` is also replaced with the same V14 connected code.

New relay pins:

- Light relay: GPIO26
- Irrigation pump relay: GPIO27
- Fertilizer pump relay: GPIO25
- Tray return pump relay: GPIO32

New tray water sensor:

- Bottom tray water level sensor AO: GPIO35

Important:

- Run the updated `supabase_schema.sql` in Supabase SQL Editor.
- Paste WiFi name/password and Supabase anon key into the Arduino code.
- Paste Supabase anon key into `supabase_config.js` for the website.


## Final Update: Code-Based API, Theme Mode, Dual Soil Moisture

Website changes:
- Supabase URL/API key is no longer pasted inside website UI.
- The website reads them from `supabase_config.js`.
- Settings button is now for Dark Mode / Light Mode.
- Threshold button style is now the same as other buttons.
- Removed the top small `Smart Green House` badge.
- Removed `Fertilizer tank level sensor removed` sentence.
- Soil moisture is now shown as:
  - Moisture Sensor 1
  - Moisture Sensor 2
  - Overall Soil Moisture
- Auto irrigation pump is based on Overall Soil Moisture.
- Old fertilizer tank low alerts are filtered out from the website.
- Moisture and tray threshold values are clamped to 0–100%.

ESP32 code changes:
- Added second soil moisture sensor.
- Moisture Sensor 1 = GPIO34.
- Moisture Sensor 2 = GPIO33.
- Overall = (Sensor 1 + Sensor 2) / 2.
- Auto irrigation pump uses the overall value.
- Tray return pump remains GPIO32.
- Full connected ESP32 code is in:
  - `esp32_v15_dual_moisture_thresholds.ino`

Setup:
1. Run updated `supabase_schema.sql`.
2. Edit `supabase_config.js` and paste the Supabase anon/public key.
3. Edit ESP32 `.ino` and paste WiFi + Supabase anon/public key.
4. Upload website to Netlify.
5. Upload ESP32 code to the board.
