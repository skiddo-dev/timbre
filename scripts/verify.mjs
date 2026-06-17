// End-to-end verify for Timbre against a dev server running with
// TIMBRE_FAKE_ENRICH=1 on a throwaway DB + music folder.
//
//   rm -f /tmp/timbre.db*
//   DATABASE_PATH=/tmp/timbre.db MUSIC_DIR=/tmp/timbre-verify-music \
//     ART_CACHE_DIR=/tmp/timbre-art TIMBRE_FAKE_ENRICH=1 \
//     npm run dev -- --port 5181 &
//   MUSIC_DIR=/tmp/timbre-verify-music node scripts/verify.mjs
//
// Writes tagged WAV fixtures into MUSIC_DIR, then drives the scan → stream(+Range)
// → search → album page → queue/player → enrich → loudness pipeline over HTTP.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:5181';
const MUSIC_DIR = process.env.MUSIC_DIR || '/tmp/timbre-verify-music';
let failures = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) failures++; };

// ── build a small WAV with RIFF INFO tags (title/artist/album/year) ──────────
function infoList(tags) {
	const subs = [];
	for (const [id, val] of tags) {
		const data = Buffer.from(String(val) + '\0', 'latin1');
		const head = Buffer.alloc(8);
		head.write(id, 0, 'latin1');
		head.writeUInt32LE(data.length, 4);
		subs.push(head, data);
		if (data.length % 2) subs.push(Buffer.from([0]));
	}
	const body = Buffer.concat([Buffer.from('INFO', 'latin1'), ...subs]);
	const head = Buffer.alloc(8);
	head.write('LIST', 0, 'latin1');
	head.writeUInt32LE(body.length, 4);
	return Buffer.concat([head, body]);
}

function buildWav({ sampleRate = 8000, seconds = 1, freq = 440, title, artist, album, year }) {
	const n = sampleRate * seconds;
	const pcm = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++) {
		const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.6;
		pcm.writeInt16LE((v * 0x7fff) | 0, i * 2);
	}
	const fmt = Buffer.alloc(8 + 16);
	fmt.write('fmt ', 0, 'latin1');
	fmt.writeUInt32LE(16, 4);
	fmt.writeUInt16LE(1, 8); // PCM
	fmt.writeUInt16LE(1, 10); // mono
	fmt.writeUInt32LE(sampleRate, 12);
	fmt.writeUInt32LE(sampleRate * 2, 16);
	fmt.writeUInt16LE(2, 20);
	fmt.writeUInt16LE(16, 22);
	const list = infoList([
		['INAM', title],
		['IART', artist],
		['IPRD', album],
		['ICRD', String(year)]
	]);
	const dataHead = Buffer.alloc(8);
	dataHead.write('data', 0, 'latin1');
	dataHead.writeUInt32LE(pcm.length, 4);
	const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, list, dataHead, pcm]);
	const riff = Buffer.alloc(8);
	riff.write('RIFF', 0, 'latin1');
	riff.writeUInt32LE(body.length, 4);
	return Buffer.concat([riff, body]);
}

// ── fixtures: 2 artists, 2 albums, 3 tracks ──────────────────────────────────
rmSync(MUSIC_DIR, { recursive: true, force: true });
mkdirSync(MUSIC_DIR, { recursive: true });
const fixtures = [
	{ file: 'Verify One.wav', title: 'Verify Track One', artist: 'Aurora Test', album: 'Test Album One', year: 2021, freq: 330 },
	{ file: 'Verify Two.wav', title: 'Verify Track Two', artist: 'Aurora Test', album: 'Test Album One', year: 2021, freq: 440 },
	{ file: 'Verify Three.wav', title: 'Verify Track Three', artist: 'Borealis Test', album: 'Test Album Two', year: 2022, freq: 550 }
];
for (const f of fixtures) writeFileSync(join(MUSIC_DIR, f.file), buildWav(f));
console.log(`wrote ${fixtures.length} tagged WAV fixtures to ${MUSIC_DIR}`);

const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();

// 1) scan (synchronous)
const scan = await (await fetch(`${BASE}/api/scan?wait=1`, { method: 'POST' })).json();
ok(!scan.running && scan.error == null, `scan finished cleanly (${scan.error ?? 'no error'})`);
ok(scan.added + scan.updated >= 3, `scan ingested ${scan.added + scan.updated} tracks (added ${scan.added}, updated ${scan.updated})`);

const settings = await getJson('/api/settings');
ok(settings.stats.tracks >= 3, `library has ${settings.stats.tracks} tracks`);
ok(settings.stats.albums >= 2, `library has ${settings.stats.albums} albums`);
ok(settings.stats.artists >= 2, `library has ${settings.stats.artists} artists`);

// 2) search
const s = await getJson('/api/search?q=verify');
ok(s.tracks.length >= 3, `search "verify" → ${s.tracks.length} track(s)`);
const sa = await getJson('/api/search?q=aurora');
ok(sa.artists.length >= 1, `search "aurora" → ${sa.artists.length} artist(s)`);
ok(sa.tracks.every((t) => t.artist), 'tracks carry artist metadata (RIFF INFO parsed)');

const track = s.tracks[0];
ok(track && typeof track.id === 'number', `got a track id (${track?.id})`);
ok(track && typeof track.albumId === 'number', `track has albumId (${track?.albumId})`);

// 3) stream with Range
const full = await fetch(`${BASE}/api/stream/${track.id}`);
const len = Number(full.headers.get('content-length'));
ok(full.status === 200 && len > 0, `GET stream → 200, ${len} bytes, type ${full.headers.get('content-type')}`);
ok(full.headers.get('accept-ranges') === 'bytes', 'stream advertises Accept-Ranges: bytes');
const partial = await fetch(`${BASE}/api/stream/${track.id}`, { headers: { Range: 'bytes=0-99' } });
const body = new Uint8Array(await partial.arrayBuffer());
ok(partial.status === 206, `Range request → 206 (got ${partial.status})`);
ok(partial.headers.get('content-range') === `bytes 0-99/${len}`, `Content-Range correct (${partial.headers.get('content-range')})`);
ok(body.length === 100, `partial body is 100 bytes (got ${body.length})`);

// 4) album page renders
const albumHtml = await (await fetch(`${BASE}/albums/${track.albumId}`)).text();
ok(albumHtml.includes('Verify Track'), 'album page lists its tracks');

// 5) queue + player state
const ids = s.tracks.slice(0, 2).map((t) => t.id);
await fetch(`${BASE}/api/queue`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackIds: ids }) });
const q = await getJson('/api/queue');
ok(q.tracks.length === 2, `queue persisted ${q.tracks.length} tracks`);
await fetch(`${BASE}/api/player`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentTrackId: ids[0], positionMs: 1234, volume: 0.5 }) });
const ps = await getJson('/api/player');
ok(ps.currentTrackId === ids[0] && ps.positionMs === 1234 && ps.volume === 0.5, 'player_state round-trips');

// 6) play count
const played = await fetch(`${BASE}/api/tracks/${track.id}/played`, { method: 'POST' });
ok(played.ok, `mark played → ${played.status}`);

// 7) enrichment (fake → deterministic, offline)
const artistId = sa.artists[0].id;
const enr = await (await fetch(`${BASE}/api/artists/${artistId}/enrich`, { method: 'POST' })).json();
ok(enr.mbid === 'fake-artist-mbid' && typeof enr.bio === 'string', 'artist enrichment returns fake bio');
const artistHtml = await (await fetch(`${BASE}/artists/${artistId}`)).text();
ok(/offline enrichment fixture/i.test(artistHtml), 'artist page shows the fetched bio');

// 8) loudness (only if ffmpeg is available — otherwise gracefully skipped)
const loud = await (await fetch(`${BASE}/api/loudness?wait=1`, { method: 'POST' })).json();
ok(loud.error == null, `loudness scan ran without error (${loud.error ?? 'ok'})`);
if (loud.updated > 0) {
	const wf = await getJson(`/api/tracks/${track.id}/waveform`);
	ok(wf.peaks.length > 0, `waveform peaks computed by WASM kernel (${wf.peaks.length} buckets)`);
} else {
	console.log('  (ffmpeg not found — loudness analysis skipped, which is allowed)');
}

// 9) AI discovery brain (offline heuristic / TIMBRE_FAKE_LLM — deterministic)
const tag = await (await fetch(`${BASE}/api/ai/tag?wait=1`, { method: 'POST' })).json();
ok(tag.error == null, `AI tag scan ran (${tag.error ?? 'ok'})`);
ok(tag.updated >= 2, `tagged ${tag.updated} albums (expected ≥2)`);

const taggedAlbum = await (await fetch(`${BASE}/albums/${track.albumId}`)).text();
ok(/by Aurora Test/i.test(taggedAlbum) || /class="chip/.test(taggedAlbum), 'album page shows AI descriptor/chips');

const radio = await (await fetch(`${BASE}/api/ai/radio`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ albumId: track.albumId, count: 10 })
})).json();
ok(Array.isArray(radio.tracks) && radio.tracks.length >= 1, `radio built ${radio.tracks?.length ?? 0} track(s)`);
ok((radio.tracks ?? []).every((t) => typeof t.id === 'number'), 'radio returns only real library tracks');

const ask = await getJson(`/api/ai/ask?q=${encodeURIComponent('Aurora')}`);
ok(Array.isArray(ask.tracks) && ask.tracks.length >= 1, `ask "Aurora" → ${ask.tracks?.length ?? 0} track(s)`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
