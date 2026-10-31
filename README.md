# Polyrhythm Piano Trainer

A web app for practicing piano polyrhythms such as 2 against 3 and 3 against 4. Practice each hand alone or both together, train all five fingers of each hand, and get live visual, audio and timing feedback.

It is a plain static site (HTML, CSS and native JavaScript modules) with no build step. It deploys as-is to GitHub Pages and works offline once loaded. The interface is available in English and Traditional Chinese (Taiwan).

Tempo works like any metronome: beats per minute, where every beat holds the complete pattern — for example, 2 left-hand notes against 3 right-hand notes inside each beat.

## Features

**Rhythm and tempo**
- Any combination of 1–12 notes per hand, with one-click presets and a swap-hands button
- Tempo from 5 to 300 beats per minute: type it, drag the slider, nudge it with ↑ / ↓, or tap it in
- Speed trainer: raises the tempo by a set step every few beats, up to a target tempo, as long as your accuracy stays above a threshold you choose
- Silent beats: after a set number of beats, the hands go quiet for a set number of beats so you keep the rhythm on your own
- Session length limits (in beats or minutes)

**Hands**
- One switch for Listen / Left / Both / Right, usable while the music is playing
- While you practice, you only hear your own key presses (plus the metronome). Turn on Accompaniment to have the app play the other hand in Left or Right mode, or raise the guide volume to hear your own part
- A light on each side of the stage shows each hand's timing in real time: green = on time, yellow = a little early or late, red = missed, extra or wrong key. The offset in milliseconds appears under the light, and the ring around it shows that hand's recent accuracy. For a hand the app is playing, the light shows the note and finger instead
- Five-finger positions in all 12 keys, major or minor, with adjustable octaves
- 20 fingering patterns: single finger, finger sequences, broken chords, double notes and chords, a finger change every beat, random, and custom
- Play on the computer keyboard (`A S D F G` / `H J K L ;`), tap the on-screen piano, or connect a MIDI keyboard. Checking for the exact key and finger is optional and off by default

**Visuals**
- Five views:
  - Pulse: one big light per hand, with a ring that shrinks onto the light as the next note approaches
  - Orbit: each hand as a polygon on its own circle, with a sweeping playhead
  - Grid: both hands as bars on a shared subdivision grid
  - Falling notes: notes fall onto the piano keys they belong to
  - Score: a grand staff in proportional notation (horizontal position = time)
- An on-screen piano with a pair of hands that shows which finger plays, which finger comes next, and the finger numbers
- The left or right edge of the stage glows on each note of that hand
- Words that match the combined rhythm of both hands: "Nice cup of tea" for 2 against 3 and "Pass the golden butter" for 3 against 4; other rhythms show grid counts
- A timing meter that shows how early or late your recent notes were

**Metronome** (on by default, can be switched off)
- Follows the piece: one click per beat, and every beat holds the whole polyrhythm
- Time signature sets the beats per bar (presets from 1/4 to 12/8, or any 1–16 beats), with per-beat accent / normal / soft / mute
- Two modes: beats only, or subdivided — each beat split into the left hand's grouping and/or the right hand's (÷2 and ÷3 for 2 against 3), the common grid (÷6), or another division (÷2 to ÷9). Each grouping has its own pitch
- The count-in clicks the same beats and subdivisions, even when the metronome is off
- Eight synthesized sounds: mechanical (tick + bell), quartz, woodblock, claves, cowbell, side stick, digital beep, soft click. The mechanical, woodblock, claves, cowbell and side-stick sounds are modeled on the real instruments
- A swinging pendulum with a beat counter, and Italian tempo terms (Andante, Allegro, …)
- Randomly dropped subdivision clicks to test your inner pulse (the beat itself always clicks)
- An option to keep clicking during silent beats (on by default)
- Vibration on beat 1 of each bar (on phones that support it)

**Ear cues** (off by default, can be switched on)
- Left-hand notes tap in the left ear and right-hand notes in the right ear
- Adjustable sound, volume, stereo separation, and which hands get cues, with a left / right headphone test

**More**
- 46 progressive lessons with star ratings
- Session results: per-hand accuracy, average offset and steadiness, a timing histogram, and practice tips
- Practice history with a trend chart and JSON export
- Saved presets (a setlist) for rhythm, tempo, fingering, metronome and ear-cue settings
- Share links that carry the rhythm, tempo, hand mode, position, fingering, instrument and view
- Latency calibration
- Light, dark or system theme, and offline support (PWA)

## Language

The app follows the browser's preferred language: any Chinese variant (zh, zh-CN, zh-HK, zh-TW, …) shows Traditional Chinese (Taiwan); every other language shows English. You can switch manually in the top bar or in Settings.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / stop |
| `Esc` | Stop |
| `0` `1` `2` `3` | Listen / left / both / right |
| `←` `→` | Previous / next hand mode |
| `↑` `↓` | Tempo ±1 (±5 with `Shift`) |
| `[` `]` | Previous / next view |
| `Shift` + `M` | Metronome on / off |
| `Shift` + `A` | Accompaniment on / off |
| `Shift` + `E` | Ear cues on / off |
| `Shift` + `?` | Open the guide |
| `A S D F G` | Left hand, fingers 5 4 3 2 1 |
| `H J K L ;` | Right hand, fingers 1 2 3 4 5 |

## Run locally

ES modules must be served over HTTP (opening `index.html` directly from disk will not work):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (for example, the `main` branch).
2. In the repository, open **Settings → Pages**, set **Source** to **Deploy from a branch**, choose `main` and `/ (root)`, and click **Save**.
3. After about a minute the app is live at `https://<user>.github.io/<repository>/`.

All paths are relative, so the app also works from a subdirectory. The `.nojekyll` file makes GitHub Pages serve the files unchanged. The service worker loads files from the network first and only falls back to its cache when offline, so updates show up on the next online visit. GitHub Pages itself may cache files for a few minutes.

## Project structure

```
index.html            Markup
manifest.webmanifest  PWA manifest
sw.js                 Offline cache (service worker)
assets/               App icons
css/styles.css        Styles (light and dark themes)
js/main.js            Controller: settings UI, playback, input, dialogs, render loop
js/transport.js       Look-ahead scheduler and timeline (notes, metronome, ear cues)
js/audio.js           Web Audio: instruments, metronome and ear-cue sounds
js/rhythm.js          Polyrhythm math, hand positions and fingering patterns
js/scoring.js         Timing judgement and statistics
js/input.js           Computer keyboard, MIDI and pointer input
js/store.js           Settings, progress, presets and share links (localStorage)
js/lessons.js         Lesson curriculum
js/i18n.js            English and Traditional Chinese strings
js/charts.js          Results histogram and progress trend chart
js/views/*.js         Pulse, orbit, grid, falling notes, score, piano with hands, timing meter
```

## Browser support

Requires a current version of Chrome, Edge, Firefox or Safari. MIDI input needs Web MIDI: it works in Chrome, Edge and Opera, Firefox asks for permission per site, and Safari does not support it. On iPhone and iPad, turn off silent mode to hear sound.

## License

[MIT](LICENSE) © 2026 Yufei Cai (蔡于飛)
