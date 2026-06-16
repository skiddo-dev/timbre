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

## Roadmap (deliberately out of v1)

- **M6 — Snapcast multi-room.** Timbre Core becomes the controller for synchronized, bit-perfect
  whole-home audio (the part Roon people pay for). The player/queue API is seamed for this.
- **M7 — Local-AI discovery brain.** Ollama on the 3090/M5 for library "radio", natural-language
  search, and auto mood/genre tagging. `src/lib/server/llm.ts` is wired and waiting.
- Later: streaming sources (the `albums.source` seam), AirPlay endpoints, on-the-fly transcode.

## Architecture

`src/lib/server/` — `db.ts` (schema + migrations), `scan.ts` (indexer), `repo.ts` (all queries),
`search.ts`, `enrich.ts`, `loudness.ts`, `playback.ts`, `settings.ts`, `llm.ts`.
`src/lib/wasm/` — the kernel loader + JS twins (`scripts/gen-wasm-kernels.mjs` authors the bytes).
`src/lib/audio/player.svelte.ts` — the client playback engine. `src/routes/` — pages + `/api`.
