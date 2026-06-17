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
- **Multi-room (Snapcast)** — the `/zones` screen manages synchronized, bit-perfect whole-home audio
  via [Snapcast](https://github.com/badaix/snapcast): group rooms, route streams, balance per-room
  volume, and cast the play queue to your rooms. Disabled until you set `SNAPCAST_HOST`.
- **Apple Music / iTunes import** — bring your local Music library in: scan its media folder, then
  import the `Library.xml` (Settings) to pull **playlists, star ratings, and play counts**. Fully
  local, no account; Apple Music *subscription* downloads are DRM-locked and skipped.

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
| `FFMPEG_BIN` | ffmpeg binary — optional, loudness scan only |
| `MUSICBRAINZ_UA` | Required User-Agent for MusicBrainz |
| `TIMBRE_FAKE_ENRICH` | `1` → offline canned enrichment (tests) |
| `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL` | Wired but unused until the M7 discovery brain |

## Verify

```bash
rm -f /tmp/timbre.db*
DATABASE_PATH=/tmp/timbre.db MUSIC_DIR=/tmp/timbre-verify-music \
  ART_CACHE_DIR=/tmp/timbre-art TIMBRE_FAKE_ENRICH=1 \
  npm run dev -- --port 5181 &
MUSIC_DIR=/tmp/timbre-verify-music npm run verify
```

The harness writes tagged WAV fixtures, then asserts the full scan → stream(+Range) → search →
album page → queue/player → enrich → loudness pipeline over HTTP.

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

## Roadmap

- ✅ **M7 — Local-AI discovery brain**: auto-tagging, Radio, natural-language Ask.
- ✅ **M6 — Snapcast multi-room**: `/zones` control plane + queue casting via the FIFO feeder.
- ✅ **Non-local sources**: internet radio (`/radio`) over the `streamUrl` seam — the model for
  adding Subsonic/Tidal/Qobuz providers later (those need accounts + unofficial APIs, so they're
  out of scope here).
- ✅ **On-the-fly transcode** for exotic codecs, **live zone updates** (SSE, no more polling), and a
  best-effort **AirPlay output** via pyatv (`AIRPLAY_ENABLED=1`).
- Later: real streaming-service providers, richer DSP (parametric EQ / room correction), and
  unifying the browser player with the Snapcast/AirPlay output stages behind one transport.

## Architecture

`src/lib/server/` — `db.ts` (schema + migrations), `scan.ts` (indexer), `repo.ts` (all queries),
`search.ts`, `enrich.ts`, `loudness.ts`, `playback.ts`, `settings.ts`, `llm.ts`.
`src/lib/wasm/` — the kernel loader + JS twins (`scripts/gen-wasm-kernels.mjs` authors the bytes).
`src/lib/audio/player.svelte.ts` — the client playback engine. `src/routes/` — pages + `/api`.
