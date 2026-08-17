<div align="center">

<img src="icon-512.png" alt="Pendulum" width="180">

# Pendulum

**Every bar can be a different bar.** Chart a song that changes time signature and
tempo bar by bar, then press start once and play the whole thing.

### [Open Pendulum](https://rohittabs.github.io/pendulum/)

![license MIT](https://img.shields.io/badge/license-MIT-333)
![price free forever](https://img.shields.io/badge/price-free%20forever-2ea44f)
![whole app 1 file](https://img.shields.io/badge/whole%20app-1%20file-555)
![account not needed](https://img.shields.io/badge/account-not%20needed-777)
![tracking none](https://img.shields.io/badge/tracking-none-333)
![works offline](https://img.shields.io/badge/works-offline-1f6feb)

### [Take the two minute tour](https://rohittabs.github.io/pendulum/slides.html)

</div>

---

## What is this?

Pendulum is a metronome that lives in a single HTML file. Open a link in a browser, add
it to a home screen like a real app, and it keeps working with no connection at all.

Most metronomes assume your song never changes. You set one tempo and one time signature,
press start, and that is the deal until you stop it. But the riff you are practising has a
bar of 7/8 in it, the show has a tempo change at letter C, and the film cue sits at 120.7
rather than 120. So you stop the click and count it yourself, which is the one thing the
click was supposed to fix.

Pendulum treats a song as a list of bars instead of a single number. Sixteen bars of 4/4,
then eight of 3/4, then four of 5/8, then a twelve bar accelerando. Press start once.

## The bit that matters

**Signature changes land exactly on the bar line.** `4/4 → 7/8 → 3/4` gives eight beats,
then seven, then six, with five downbeats and no dropped or doubled beat at either seam.
The bar counter runs continuously across the whole chart, so bar 23 is bar 23 whatever
meter it happens to be in.

**Tempo ramps are integrated, not averaged.** A ramp from 60 to 120 over eight bars is not
the same length as thirty-two beats at a flat 90, and getting this wrong is a silent
failure that only shows up when you try to line the click up with something else.

**Decimal BPM.** 120.7 is a real tempo, not a rounding error. Over a four minute take,
0.7 BPM is most of a beat.

## Everything else

| | |
|---|---|
| **Song mode** | Named sections with bars, meter, accents, tempo, target tempo, subdivision and repeats. Drag to reorder, duplicate, delete. Loop N times or forever. |
| **Stepped ramp generator** | Give it a start tempo, an end tempo, a step count and a duration. It lays out the sections and lands exactly on the target. |
| **Beat accents** | Tap any beat dot to cycle it: click, accent, mute. Type a grouping like `3+2+2` and it sets the dots, or tap the dots and read the grouping back. |
| **Bar patterns** | Always on, or 1/2/3/4/8 bars on and off, or a custom cycle, or a random silent bar at a percentage you choose. |
| **Subdivisions** | Eight presets from quarters to 32nds, plus any custom tuplet. |
| **Polyrhythms** | Seven presets from 3:2 to 7:8, or type your own X against Y, with its own sound and volume. |
| **Time signatures** | Twelve presets, or any numerator to 32 over a denominator of 1, 2, 4, 8, 16 or 32. |
| **BPM reference** | Choose whether the tempo number means the denominator note or always the quarter, because 6/8 at 120 is ambiguous and both readings are in common use. |
| **Sounds** | Fourteen, all synthesised, with separate voice and level for the main meter and the polyrhythm. |
| **Tap tempo** | Median of the last few taps, so one sloppy tap does not move the tempo. |
| **Presets and songs** | Both saved locally. Songs export and import as JSON, so a chart can be shared. |
| **Count-in** | Off, 1, 2, 4 or 8 bars. |
| **Also** | Light and dark themes, reduce-motion mode, silent practice, screen wake lock, full keyboard control. |

## Timing

The click is scheduled with the Web Audio lookahead pattern rather than `setInterval`. A
Web Worker ticks every 25 ms and the scheduler queues every event falling inside the next
150 ms, using exact `AudioContext` times. This matters for two reasons: main-thread timers
get throttled to roughly 1 Hz once a tab is backgrounded, and `setInterval` drift
accumulates over a long take.

Changing a setting mid-playback applies from the first event that has not been scheduled
yet, rather than rebuilding from the start, because rebuilding produces duplicate clicks
and backwards jumps at the boundary.

Thirty-second notes at 300 BPM are 25 ms apart and play evenly.

## Nothing is sent anywhere

There is no server. No account, no sign up, no tracking, no uploads. The whole app is one
HTML file, fonts and all, and your songs stay in your own browser.

It works in a rehearsal room with no signal, in a pit, on a plane.

## Install it

Open it once and it installs like a real app. No store, no download, no permissions.

- **iPhone:** Share, then Add to Home Screen.
- **Android:** it will offer by itself.
- **Desktop:** an install icon appears in the address bar.

After that it opens with no connection at all.

## Run it yourself

Every file is static. Clone the repo and serve the folder over HTTP:

```bash
git clone https://github.com/rohittabs/pendulum.git
cd pendulum
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

A plain `file://` open works too, but service workers only register over HTTP, so you will
not get the offline install that way.

| File | What it is |
|---|---|
| `index.html` | The whole app. Fonts, icons and scripts are inlined. |
| `slides.html` | The two minute tour. |
| `manifest.webmanifest` | Install metadata. |
| `sw.js` | Service worker, cache-first app shell. |
| `icon-*.png`, `apple-touch-icon.png`, `favicon.*` | Icons. Maskable variants are separate, since Android crops them. |

## Licence

MIT. See [LICENSE](LICENSE).
