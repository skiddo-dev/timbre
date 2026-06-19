# Timbre

A no-subscription, **self-hosted music player** — a free take on what Roon does well
(a metadata-rich library and a good-looking remote), with **no monthly fee and no cloud**.
Run it on the box that has your music (the basement 3090 or an M-series Mac); everything —
library, artwork, playback, analysis — stays on that machine.

> Project 6 in the local-first family (Hearth · Cadence · Aperture · Lattice). Same stack:
> SvelteKit 2 + Svelte 5, `node:sqlite`, a hand-authored WASM kernel, no cloud LLM fallback.

## What v1 does

- **Library** — scans a music folder (FLAC / ALAC / MP3 / AAC / OGG / WAV…), reads tags + embedded
  cover art with `music-metadata`, and indexes artist → album → track in SQLite. Re-scans are
  incremental (unchanged files are skipped; deleted files are pruned).
- **Browse** — album grid, album & artist pages, instant search (FTS5 with a LIKE fallback).
- **Play** — single-zone browser playback with a persistent now-playing dock: queue, seek
  (HTTP `Range`), shuffle/repeat, near-gapless, server-persisted state, a Web-Audio visualizer.
- **Metadata enrichment** — free, best-effort: MusicBrainz IDs, a Wikipedia artist bio + image,
  Cover Art Archive front covers. Rate-limited and degrades silently — never a hard dependency.
- **Volume leveling** — a hand-authored **WASM kernel** computes EBU R128 loudness + true peak +
  a waveform overview (≈2.7× faster than JS, verified bit-exact against a JS twin). The player can
  then play everything at a consistent volume.
- **Discovery brain (local AI)** — your local model (Ollama on the 3090/M5) auto-tags albums with
  genre/mood/vibe, powers **Radio** (a queue that flows from any track/album/artist) and
  natural-language **Ask** search ("mellow jazz for a rainy evening"). The model only ever resolves
  to tracks that exist in your library, and everything degrades to deterministic heuristics with no
  model — so it works offline and under `TIMBRE_FAKE_LLM=1`.
- **Streaming providers (Subsonic / OpenSubsonic)** — connect a self-hosted server (Navidrome,
  Airsonic, Gonic…) in **Settings** and browse + stream it from the **Streaming** page (`/subsonic`), right through
  Timbre's transport. Real audio in — no DRM, no subscription; your password is salted-hashed per
  request (Subsonic auth) and never reaches the browser (streams + art proxy through the server).
- **Parametric EQ + room correction** — the `/dsp` screen is a multi-band parametric EQ with a live
  magnitude curve, presets, a convolution slot for a measured room impulse response (a WAV), and REW /
  EqualizerAPO import. The profile is applied **everywhere Timbre plays** — in-browser via Web Audio
  and on every cast output via ffmpeg — and is bypassed in bit-perfect mode.
- **One transport, any output** — the now-playing dock's output picker plays the one shared queue on
  **this device**, a **Snapcast zone**, or an **AirPlay device**, with the same controls; switching
  output hands off the queue + position. Local, Subsonic and radio sources all cast (the server
  resolves each to an ffmpeg input).
- **Multi-room (Snapcast)** — the `/zones` screen manages synchronized, bit-perfect whole-home audio
  via [Snapcast](https://github.com/badaix/snapcast): group rooms, route streams, balance per-room
  volume, and cast the play queue to your rooms. Disabled until you set `SNAPCAST_HOST`.
- **Apple Music / iTunes import** — bring your local Music library in: scan its media folder, then
  import the `Library.xml` (Settings) to pull **playlists, star ratings, and play counts**. Fully
  local, no account; Apple Music *subscription* downloads are DRM-locked and skipped.
- **Last.fm scrobbling** — opt-in, and the only cloud connection in Timbre. Connect your profile from
  **Settings** (a one-click desktop auth flow — no password touches Timbre), then plays are scrobbled
  with "now playing" + a track.scrobble once you've heard half the track (or 4 min). Submissions are
  logged in a local queue and **retried when Last.fm is reachable**, so nothing is lost offline.
  Disabled until you set `LASTFM_API_KEY` / `LASTFM_API_SECRET`; stubbed under `TIMBRE_FAKE_LASTFM=1`.
- **Usenet (NZB) acquisition** — the `/usenet` screen searches your Newznab indexers, grabs a release,
  and downloads it **straight into your library**. Two engines: a **SABnzbd / NZBGet** client (the
  recommended primary — it does PAR2 repair + unrar) and a **built-in NNTP + yEnc** downloader (a
  from-scratch RFC 3977 client whose decode hot-loop is a hand-authored WASM kernel, used when no
  download client is set). Finished files land in `MUSIC_DIR/_usenet`, so the scanner ingests them as
  ordinary local tracks. Indexers are added in the UI; everything's off until you configure an engine,
  and search still works without one.

## Quick start

```bash
npm install
npm run gen:wasm          # build + self-verify the WASM loudness kernel
cp .env.example .env      # then set MUSIC_DIR (or set the folder in Settings)
npm run dev               # http://localhost:5173
```

Open **Settings**, point Timbre at your music folder, hit **Rescan**, then (optionally)
**Analyze loudness** (needs `ffmpeg` on PATH — used only for the loudness scan).

## Configuration (`.env`)

| Var | Purpose |
| --- | --- |
| `DATABASE_PATH` | SQLite library DB (default `data/timbre.db`) |
| `MUSIC_DIR` | Folder to index (can also be set in Settings, which overrides this) |
| `ART_CACHE_DIR` | Where fetched art is cached (default `data/art`) |
| `FFMPEG_BIN` | ffmpeg binary — used by the loudness scan, on-the-fly transcode, and server-side DSP / cast feeder |
| `DSP_DIR` | Where room-correction impulse-response files are stored (default alongside the DB) |
| `SUBSONIC_URL` / `SUBSONIC_USER` / `SUBSONIC_PASS` | Subsonic/OpenSubsonic server (optional — usually set in Settings, which overrides this) |
| `TIMBRE_FAKE_SUBSONIC` | `1` → offline canned Subsonic fixtures (tests) |
| `MUSICBRAINZ_UA` | Required User-Agent for MusicBrainz |
| `TIMBRE_FAKE_ENRICH` | `1` → offline canned enrichment (tests) |
| `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL` | Wired but unused until the M7 discovery brain |
| `LASTFM_API_KEY` / `LASTFM_API_SECRET` | Last.fm app credentials — enables scrobbling ([create one](https://www.last.fm/api/account/create)) |
| `TIMBRE_FAKE_LASTFM` | `1` → stub Last.fm auth + scrobble submission (tests) |
| `SABNZBD_URL` / `SABNZBD_API_KEY` | SABnzbd (or NZBGet) download client — the primary Usenet engine (PAR2 + unrar) |
| `NNTP_HOST` / `NNTP_PORT` / `NNTP_SSL` / `NNTP_USER` / `NNTP_PASS` | Usenet provider for the built-in NNTP + yEnc fallback engine |

## Verify

```bash
rm -f /tmp/timbre.db*
DATABASE_PATH=/tmp/timbre.db MUSIC_DIR=/tmp/timbre-verify-music \
  ART_CACHE_DIR=/tmp/timbre-art TIMBRE_FAKE_ENRICH=1 TIMBRE_FAKE_LASTFM=1 \
  TIMBRE_FAKE_APPLEMUSIC=1 SNAPCAST_HOST=127.0.0.1 SNAPCAST_RPC_PORT=1799 \
  NNTP_HOST=127.0.0.1 NNTP_PORT=1819 NNTP_SSL=0 NNTP_USER=u NNTP_PASS=p \
  SABNZBD_URL=http://127.0.0.1:1820 SABNZBD_API_KEY=mock \
  npm run dev -- --port 5181 --host 127.0.0.1 &
MUSIC_DIR=/tmp/timbre-verify-music npm run verify
```

The harness writes tagged WAV fixtures, then asserts the full scan → stream(+Range) → search →
album page → queue/player → enrich → loudness → discovery → scrobble → **Usenet** → **Subsonic
provider** → **DSP** → **unified transport** pipeline over HTTP. It spins up mock Newznab / NNTP /
SABnzbd servers (Usenet), a mock snapserver (zones + transport routing, via `SNAPCAST_HOST`), and a
mock Subsonic server (the provider configures itself against it). The Usenet section grabs a release
through **both** engines, asserting the yEnc round-trip is byte-exact (NNTP → kernel → disk).

## Multi-room setup (Snapcast)

On the machine running Timbre, run `snapserver` with a Timbre stream, run `snapclient` in each room,
then point Timbre at the server in `.env`:

```ini
# snapserver.conf
[stream]
source = pipe:///tmp/snapfifo?name=Timbre&sampleformat=48000:16:2
```
```bash
# Timbre .env
SNAPCAST_HOST=127.0.0.1
SNAPCAST_RPC_PORT=1705
SNAPCAST_FIFO=/tmp/snapfifo
```

No daemons handy? `npm run mock:snap` starts a fake snapserver so you can open `/zones` and click
around. The audio feeder (decode → FIFO) needs `ffmpeg`; the control plane does not.

## Usenet setup

Add one or more Newznab-compatible indexers on the `/usenet` page (name + API base + key), then pick
a download engine in `.env`:

```bash
# Recommended: a SABnzbd (or NZBGet) client does the NNTP fetch + PAR2 repair + unrar.
# Point its completed/category folder INTO MUSIC_DIR so finished albums get scanned.
SABNZBD_URL=http://127.0.0.1:8080
SABNZBD_API_KEY=…

# Fallback: Timbre's built-in NNTP + yEnc engine (used when no SABnzbd client is set).
# Good for directly-posted audio; it shells out to par2/unrar/7z only if they're on PATH.
NNTP_HOST=news.your-provider.com
NNTP_PORT=563
NNTP_SSL=1
NNTP_USER=…
NNTP_PASS=…
```

No provider handy? `npm run mock:usenet` starts fake Newznab + NNTP servers (point an indexer at
`http://127.0.0.1:1818`) so you can search and grab through the built-in engine with nothing
installed. The yEnc decode runs on the same hand-authored WASM kernel as the loudness scan
(`npm run gen:wasm` self-verifies it bit-for-bit against a JS twin).

## Roadmap

- ✅ **Last.fm scrobbling**: opt-in now-playing + scrobble with an offline retry queue.
- ✅ **M7 — Local-AI discovery brain**: auto-tagging, Radio, natural-language Ask.
- ✅ **M6 — Snapcast multi-room**: `/zones` control plane + queue casting via the FIFO feeder.
- ✅ **Non-local sources**: internet radio (`/radio`) over the `streamUrl` seam — the model that the
  Subsonic provider below was built on.
- ✅ **On-the-fly transcode** for exotic codecs, **live zone updates** (SSE, no more polling), and a
  best-effort **AirPlay output** via pyatv (`AIRPLAY_ENABLED=1`).
- ✅ **Usenet (NZB) acquisition** (`/usenet`): Newznab search + a SABnzbd client and a from-scratch
  NNTP + yEnc engine (with a hand-authored WASM decode kernel) → straight into the library.
- ✅ **Real streaming providers**: a Subsonic / OpenSubsonic provider (`/subsonic`) — a self-hosted
  remote library streamed through the transport (no DRM, no subscription). Commercial services
  (Tidal/Qobuz/Spotify) stay out of scope by design — DRM can't enter a self-hosted pipeline.
- ✅ **Richer DSP** (`/dsp`): a multi-band parametric EQ + convolution room correction (REW /
  EqualizerAPO import), applied in-browser and on every cast output via ffmpeg.
- ✅ **One transport**: a single queue + controls with a selectable output (this device / a Snapcast
  zone / an AirPlay device); switching output hands off the queue + position.

## Architecture

`src/lib/server/` — `db.ts` (schema + migrations), `scan.ts` (indexer), `repo.ts` (all queries),
`search.ts`, `enrich.ts`, `loudness.ts`, `playback.ts`, `settings.ts`, `llm.ts`, `subsonic.ts`
(the streaming provider), `dsp.ts` (profile + IR storage), `transport.ts` (the output coordinator),
`streamer.ts` (Snapcast FIFO feeder), `snapcast.ts` (zone control plane), `airplay.ts`.
`src/lib/server/usenet/` — `indexer.ts` (Newznab search), `nzb.ts` + `yenc.ts` + `nntp.ts` (the
built-in download engine), `sab.ts` (SABnzbd client), `downloads.ts` (engine-picking orchestrator).
`src/lib/dsp.ts` — the isomorphic DSP profile (Web Audio + ffmpeg filter graph from one source).
`src/lib/wasm/` — the kernel loader + JS twins (`scripts/gen-wasm-kernels.mjs` authors the bytes).
`src/lib/audio/player.svelte.ts` — the client playback engine (target-aware: browser ↔ cast).
`src/routes/` — pages + `/api`.
