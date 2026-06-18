// End-to-end verify for Timbre against a dev server running with
// TIMBRE_FAKE_ENRICH=1 on a throwaway DB + music folder.
//
//   rm -f /tmp/timbre.db*
//   DATABASE_PATH=/tmp/timbre.db MUSIC_DIR=/tmp/timbre-verify-music \
//     ART_CACHE_DIR=/tmp/timbre-art TIMBRE_FAKE_ENRICH=1 TIMBRE_FAKE_LASTFM=1 \
//     TIMBRE_FAKE_APPLEMUSIC=1 \
//     NNTP_HOST=127.0.0.1 NNTP_PORT=1819 NNTP_SSL=0 NNTP_USER=u NNTP_PASS=p \
//     SABNZBD_URL=http://127.0.0.1:1820 SABNZBD_API_KEY=mock \
//     npm run dev -- --port 5181 &
//   MUSIC_DIR=/tmp/timbre-verify-music node scripts/verify.mjs
//
// Writes tagged WAV fixtures into MUSIC_DIR, then drives the scan → stream(+Range)
// → search → album page → queue/player → enrich → loudness → Usenet pipeline over
// HTTP. The Usenet section needs the NNTP_*/SABNZBD_* env above (mock ports).
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMockSnapserver } from './mock-snapserver.mjs';
import { createMockNntp, createMockNewznab, createMockSab, buildNzb } from './mock-usenet.mjs';

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

// fake snapserver for the zones control plane (the dev server connects to it via
// SNAPCAST_HOST/SNAPCAST_RPC_PORT). Harmless if the dev server has no SNAPCAST_HOST.
const mock = await createMockSnapserver(Number(process.env.SNAP_MOCK_PORT) || 1799);

const getJson = async (p) => (await fetch(`${BASE}${p}`)).json();
const post = (action, extra = {}) => ({
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ action, ...extra })
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror of usenet/downloads.ts slug() — keep these in lockstep.
const slugify = (title) =>
	title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || `grab-x`;

function readFileSafe(path) {
	try {
		return readFileSync(path);
	} catch {
		return null;
	}
}

// Poll the Usenet download list until a grab with `title` finishes (or times out).
async function pollDownload(title, timeoutMs = 25_000) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	for (;;) {
		const s = await getJson('/api/usenet');
		last = (s.downloads || []).find((x) => x.title === title) || last;
		if (last && (last.status === 'completed' || last.status === 'failed')) return last;
		if (Date.now() > deadline) return last;
		await sleep(300);
	}
}

async function readFirstSse(path, timeoutMs) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
		const reader = res.body.getReader();
		const { value } = await reader.read();
		await reader.cancel();
		return value ? new TextDecoder().decode(value) : '';
	} catch {
		return '';
	} finally {
		clearTimeout(t);
	}
}

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

// 7) enrichment (fake → deterministic, offline). MusicBrainz facts + genres persist
//    alongside the Wikipedia bio / Cover Art Archive cover.
const artistId = sa.artists[0].id;
const enr = await (await fetch(`${BASE}/api/artists/${artistId}/enrich`, { method: 'POST' })).json();
ok(enr.mbid === 'fake-artist-mbid' && typeof enr.bio === 'string', 'artist enrichment returns fake bio');
ok(enr.type === 'Group' && enr.country === 'US' && enr.genres.includes('rock'), 'artist enrichment carries MusicBrainz facts + genres');
const artistHtml = await (await fetch(`${BASE}/artists/${artistId}`)).text();
ok(/offline enrichment fixture/i.test(artistHtml), 'artist page shows the fetched bio');
ok(/Group/.test(artistHtml) && /rock/.test(artistHtml), 'artist page shows MusicBrainz facts + genre chips');

const ea = await (await fetch(`${BASE}/api/albums/${track.albumId}/enrich`, { method: 'POST' })).json();
ok(ea.mbid === 'fake-album-mbid' && ea.primaryType === 'Album', 'album enrichment returns MusicBrainz release info');
ok(ea.genres.includes('rock') && typeof ea.year === 'number', 'album enrichment carries genres + a year');
const albumEnrHtml = await (await fetch(`${BASE}/albums/${track.albumId}`)).text();
ok(/rock/.test(albumEnrHtml), 'album page shows the MusicBrainz genre chip');

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
// fresh DB → tags ≥2 albums; re-run on a warm DB → nothing left to tag (total 0).
ok(tag.updated >= 2 || tag.total === 0, `tagged ${tag.updated}/${tag.total} albums`);

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

// 10) Snapcast zones control plane (against the in-process mock snapserver)
const zones = await getJson('/api/zones');
if (zones.configured) {
	ok(zones.reachable, `snapserver reachable (${zones.error ?? 'ok'})`);
	ok(zones.groups.length >= 2, `mapped ${zones.groups.length} group(s)`);
	ok(zones.streams.some((s) => s.id === 'Timbre'), 'Timbre stream present');
	const client = zones.groups[0]?.clients?.[0];
	ok(!!client, `group has a client (${client?.name})`);
	if (client) {
		const after = await (await fetch(`${BASE}/api/zones`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'clientVolume', clientId: client.id, percent: 42, muted: false })
		})).json();
		const updated = after.groups?.flatMap((g) => g.clients).find((c) => c.id === client.id);
		ok(updated?.volume === 42, `client volume persisted to 42 (got ${updated?.volume})`);
		const routed = await (await fetch(`${BASE}/api/zones`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'groupStream', groupId: zones.groups[0].id, streamId: 'default' })
		})).json();
		const g0 = routed.groups?.find((g) => g.id === zones.groups[0].id);
		ok(g0?.streamId === 'default', `group re-routed to 'default' stream (got ${g0?.streamId})`);
	}
} else {
	console.log('  (SNAPCAST_HOST not set on the dev server — zones control plane skipped)');
}

// 11) internet radio (the non-local source seam)
const radio0 = await getJson('/api/radio');
ok(Array.isArray(radio0.stations) && radio0.stations.length >= 1, `radio seeded ${radio0.stations?.length ?? 0} station(s)`);
const added = await (await fetch(`${BASE}/api/radio`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ name: 'Verify FM', url: 'https://example.com/stream.mp3', genre: 'Test' })
})).json();
const vfm = added.stations?.find((s) => s.name === 'Verify FM');
ok(!!vfm, 'added a custom station');
if (vfm) {
	const afterDel = await (await fetch(`${BASE}/api/radio?id=${vfm.id}`, { method: 'DELETE' })).json();
	ok(!afterDel.stations.some((s) => s.id === vfm.id), 'removed the custom station');
}
const bad = await fetch(`${BASE}/api/radio`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ name: 'x', url: 'not-a-url' })
});
ok(bad.status === 400, `rejects an invalid station url → ${bad.status}`);
const radioHtml = await (await fetch(`${BASE}/radio`)).text();
ok(/SomaFM/i.test(radioHtml), '/radio page lists seeded stations');

// 12) on-the-fly transcode (no ffmpeg here → graceful fallback to a raw audio body)
const tc = await fetch(`${BASE}/api/stream/${track.id}?transcode=1`);
ok(tc.ok && (tc.headers.get('content-type') || '').startsWith('audio/'), `transcode request served audio → ${tc.status} ${tc.headers.get('content-type')}`);

// 13) live zone updates via SSE — first event carries a snapshot
const sse = await readFirstSse('/api/zones/events', 5000);
ok(sse.includes('"groups"'), 'SSE zone feed pushed an initial snapshot');

// 14) AirPlay status (off unless AIRPLAY_ENABLED=1)
const ap = await getJson('/api/airplay');
ok(ap.enabled === false, 'AirPlay disabled by default');

// 15) Apple Music / iTunes library import (ratings, play counts, playlists)
const fileUrl = (file) => 'file://' + encodeURI(join(MUSIC_DIR, file));
const xmlTracks = [
	[1001, 'Verify Track One', 'Verify One.wav', 100, 7],
	[1002, 'Verify Track Two', 'Verify Two.wav', 80, 3],
	[1003, 'Verify Track Three', 'Verify Three.wav', 60, 1]
];
const tracksXml = xmlTracks
	.map(([id, nm, file, rating, pc]) =>
		`<key>${id}</key><dict><key>Track ID</key><integer>${id}</integer><key>Name</key><string>${nm}</string>` +
		`<key>Rating</key><integer>${rating}</integer><key>Play Count</key><integer>${pc}</integer>` +
		`<key>Location</key><string>${fileUrl(file)}</string></dict>`
	)
	.join('');
const libraryXml =
	`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
	`<plist version="1.0"><dict><key>Tracks</key><dict>${tracksXml}</dict>` +
	`<key>Playlists</key><array>` +
	`<dict><key>Name</key><string>Verify Mix</string><key>Playlist Persistent ID</key><string>PIDVERIFY01</string>` +
	`<key>Playlist Items</key><array><dict><key>Track ID</key><integer>1001</integer></dict><dict><key>Track ID</key><integer>1002</integer></dict></array></dict>` +
	`<dict><key>Name</key><string>Library</string><key>Master</key><true/><key>Playlist Items</key><array><dict><key>Track ID</key><integer>1001</integer></dict></array></dict>` +
	`</array></dict></plist>`;
const xmlPath = '/tmp/timbre-verify-library.xml';
writeFileSync(xmlPath, libraryXml);
const imp = await (await fetch(`${BASE}/api/applemusic/import`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ path: xmlPath })
})).json();
ok(imp.error == null, `library import ran (${imp.error ?? 'ok'})`);
ok(imp.matched >= 3, `matched ${imp.matched} XML tracks to scanned files`);
ok(imp.ratings >= 3, `imported ${imp.ratings} star ratings`);
ok(imp.playlists === 1, `imported ${imp.playlists} playlist (Master library skipped)`);
const plHtml = await (await fetch(`${BASE}/playlists`)).text();
ok(/Verify Mix/.test(plHtml), '/playlists lists the imported playlist');

// 16) Last.fm scrobbling (TIMBRE_FAKE_LASTFM → full offline flow; else status only)
const lf0 = await getJson('/api/lastfm');
ok(typeof lf0.connected === 'boolean' && typeof lf0.configured === 'boolean', 'lastfm status returns a shape');
if (lf0.configured) {
	const c = await (await fetch(`${BASE}/api/lastfm`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect' })
	})).json();
	ok(typeof c.token === 'string' && /api\/auth/.test(c.url || ''), 'lastfm connect returns a token + auth url');
	const sess = await (await fetch(`${BASE}/api/lastfm`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'session', token: c.token })
	})).json();
	ok(sess.connected === true && typeof sess.user === 'string', `lastfm connected as ${sess.user}`);

	const np = await (await fetch(`${BASE}/api/scrobble/nowplaying`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: track.id })
	})).json();
	ok(np.ok === true, 'now-playing accepted while connected');

	const sc = await (await fetch(`${BASE}/api/scrobble`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ trackId: track.id, startedAt: Math.floor(Date.now() / 1000) - 200 })
	})).json();
	ok(sc.ok === true && (sc.flush?.sent ?? 0) >= 1, `scrobble submitted + flushed (sent ${sc.flush?.sent ?? 0})`);
	ok(sc.status?.pending === 0, 'no scrobbles left pending after flush');

	const hist = await getJson('/api/scrobble');
	ok((hist.scrobbles ?? []).some((s) => s.title === track.title && s.state === 'sent'), 'scrobble recorded in history as sent');

	const disc = await (await fetch(`${BASE}/api/lastfm`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disconnect' })
	})).json();
	ok(disc.connected === false, 'disconnect clears the session');

	// offline resilience: a play queues while disconnected, then drains on reconnect
	const off = await (await fetch(`${BASE}/api/scrobble`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ trackId: s.tracks[1].id, startedAt: Math.floor(Date.now() / 1000) - 50 })
	})).json();
	ok(off.status?.connected === false && (off.status?.pending ?? 0) >= 1, `play queued while disconnected (pending ${off.status?.pending})`);
	const re = await (await fetch(`${BASE}/api/lastfm`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect' })
	})).json();
	const re2 = await (await fetch(`${BASE}/api/lastfm`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'session', token: re.token })
	})).json();
	ok(re2.connected === true && re2.pending === 0, 'reconnect drains the queued scrobble');
} else {
	console.log('  (TIMBRE_FAKE_LASTFM not set & no Last.fm keys — scrobble flow skipped)');
}

// 17) Apple Music subscription — enrichment + library sync, deep-link out
//     (TIMBRE_FAKE_APPLEMUSIC → full offline flow; else status only). The whole
//     posture: matches reconcile to LOCAL files, catalog-only songs become
//     non-playable deep-link rows — DRM audio never enters the player pipeline.
const am0 = await getJson('/api/applemusic');
ok(typeof am0.configured === 'boolean' && typeof am0.connected === 'boolean', 'apple music status returns a shape');
if (am0.configured) {
	const dt = await (await fetch(`${BASE}/api/applemusic`, post('devtoken'))).json();
	ok(typeof dt.token === 'string' && dt.token.length > 0, 'apple music mints a developer token');

	const sess = await (await fetch(`${BASE}/api/applemusic`, post('session', { userToken: 'fake-user-token', storefront: 'us' }))).json();
	ok(sess.connected === true, 'apple music connected with a Music User Token');

	const sync = await (await fetch(`${BASE}/api/applemusic`, post('sync'))).json();
	ok(sync.matched >= 1, `sync reconciled ${sync.matched} song(s) to local files`);
	ok(sync.wishlist >= 1, `sync added ${sync.wishlist} catalog-only deep-link row(s)`);
	ok(sync.playlists >= 1, `sync mirrored ${sync.playlists} playlist(s)`);
	ok(!!sync.status?.lastSyncAt, 'last-sync time recorded');

	// the catalog-only song is an applemusic deep-link row that does NOT play
	const ghost = await getJson(`/api/search?q=${encodeURIComponent('Ghost Single')}`);
	const wish = (ghost.tracks ?? []).find((t) => t.title === 'Ghost Single');
	ok(!!wish && wish.source === 'applemusic' && !!wish.sourceUrl, 'catalog-only track is an applemusic deep-link row');
	if (wish) {
		const play = await fetch(`${BASE}/api/stream/${wish.id}`);
		ok(play.status === 404, `wishlist track is non-playable (stream → ${play.status})`);
	}
	const plHtml2 = await (await fetch(`${BASE}/playlists`)).text();
	ok(/Apple Faves/.test(plHtml2), '/playlists lists the synced Apple playlist');

	// catalog enrichment fills the album's Apple id + genres + deep link (COALESCE)
	const enrApple = await (await fetch(`${BASE}/api/applemusic`, post('enrich', { albumId: track.albumId }))).json();
	ok(typeof enrApple.appleId === 'string' && enrApple.appleId.length > 0, 'apple enrich returns a catalog id');
	ok(!!enrApple.appleUrl && /music\.apple\.com/.test(enrApple.appleUrl), 'apple enrich returns a deep link');
	ok(Array.isArray(enrApple.genres) && enrApple.genres.includes('Alternative'), 'apple enrich carries catalog genres');
	const albAppleHtml = await (await fetch(`${BASE}/albums/${track.albumId}`)).text();
	ok(/Apple Music/.test(albAppleHtml), 'album page shows the Apple Music deep link');

	const amDisc = await (await fetch(`${BASE}/api/applemusic`, post('disconnect'))).json();
	ok(amDisc.connected === false, 'apple music disconnect clears the user token');
} else {
	console.log('  (TIMBRE_FAKE_APPLEMUSIC not set & no Apple keys — subscription flow skipped)');
}

// 18) Usenet (NZB) acquisition — search a (mock) Newznab indexer, grab a release, and
//     download it into the library by BOTH engines: the built-in NNTP + yEnc engine
//     (drives the hand-authored kernel end-to-end) and a SABnzbd client. Both land a
//     real tagged WAV under MUSIC_DIR/_usenet so the scanner ingests it as a track.
{
	const NNTP_PORT = Number(process.env.NNTP_PORT) || 1819;
	const NZB_PORT = Number(process.env.USENET_NZB_PORT) || 1818;
	const SAB_PORT = Number(process.env.USENET_SAB_PORT) || 1820;

	const nntpWav = buildWav({ title: 'Usenet NNTP Track', artist: 'Usenet Test', album: 'Usenet NNTP Album', year: 2024, freq: 392 });
	const sabWav = buildWav({ title: 'Usenet SAB Track', artist: 'Usenet Test', album: 'Usenet SAB Album', year: 2024, freq: 494 });
	const nntpFile = 'Usenet NNTP.wav';
	const sabFile = 'Usenet SAB.wav';
	const msgId = 'usenet-verify-1@timbre.mock';
	const group = 'alt.binaries.timbre';

	const nntpMock = await createMockNntp({ port: NNTP_PORT, articles: new Map([[msgId, nntpWav]]) });
	const sabMock = await createMockSab({ port: SAB_PORT, musicDir: MUSIC_DIR, fixture: { slug: 'usenet-sab', name: sabFile, bytes: sabWav } });
	const nzMock = await createMockNewznab({
		port: NZB_PORT,
		items: [
			{ guid: 'nntp-1', title: 'Usenet Test - Usenet NNTP Album', sizeBytes: nntpWav.length, nzb: buildNzb({ group, messageId: msgId, filename: nntpFile, bytes: nntpWav.length }) },
			{ guid: 'sab-1', title: 'Usenet Test - Usenet SAB Album', sizeBytes: sabWav.length, nzb: buildNzb({ group, messageId: msgId, filename: sabFile, bytes: sabWav.length }) }
		]
	});

	const eng0 = await getJson('/api/usenet');
	if (!eng0.engines || (!eng0.engines.nntp && !eng0.engines.sab)) {
		console.log('  (NNTP_*/SABNZBD_* not set on the dev server — Usenet download skipped)');
	} else {
		const addIx = await (await fetch(`${BASE}/api/usenet`, post('addIndexer', { name: 'Mock Indexer', url: `http://127.0.0.1:${NZB_PORT}`, apiKey: 'x' }))).json();
		ok(addIx.indexers.some((i) => i.url === `http://127.0.0.1:${NZB_PORT}`), 'added a Newznab indexer');
		ok(addIx.engines.indexers >= 1, 'engine status counts the indexer');

		const sr = await getJson(`/api/usenet/search?q=${encodeURIComponent('Usenet')}`);
		ok(Array.isArray(sr.results) && sr.results.length >= 2, `indexer search → ${sr.results?.length ?? 0} result(s)`);
		const nntpHit = (sr.results || []).find((r) => /NNTP/.test(r.title));
		const sabHit = (sr.results || []).find((r) => /SAB/.test(r.title));
		ok(!!nntpHit && /^https?:/.test(nntpHit.nzbUrl || ''), 'result carries an nzb get-link');

		// engine 1 — built-in NNTP + yEnc (the hand-authored kernel path)
		if (eng0.engines.nntp && nntpHit) {
			await (await fetch(`${BASE}/api/usenet`, post('grab', { title: nntpHit.title, nzbUrl: nntpHit.nzbUrl, indexerId: nntpHit.indexerId, sizeBytes: nntpHit.sizeBytes, engine: 'nntp' }))).json();
			const d = await pollDownload(nntpHit.title);
			ok(d?.status === 'completed', `NNTP grab completed (${d?.status}${d?.error ? ': ' + d.error : ''})`);
			ok(d?.engine === 'nntp', `NNTP grab used the nntp engine (${d?.engine})`);
			ok((d?.files ?? 0) >= 1, `NNTP grab imported ${d?.files ?? 0} file(s)`);

			const onDisk = readFileSafe(join(MUSIC_DIR, '_usenet', slugify(nntpHit.title), nntpFile));
			ok(
				onDisk && onDisk.length === nntpWav.length && Buffer.compare(onDisk, Buffer.from(nntpWav)) === 0,
				'yEnc round-trip is byte-exact (NNTP → kernel → disk)'
			);
			const found = await getJson(`/api/search?q=${encodeURIComponent('Usenet NNTP')}`);
			ok((found.tracks ?? []).some((t) => t.title === 'Usenet NNTP Track'), 'downloaded NNTP track is in the library');
		} else {
			console.log('  (NNTP engine not configured — NNTP grab skipped)');
		}

		// engine 2 — SABnzbd client
		if (eng0.engines.sab && sabHit) {
			await (await fetch(`${BASE}/api/usenet`, post('grab', { title: sabHit.title, nzbUrl: sabHit.nzbUrl, indexerId: sabHit.indexerId, sizeBytes: sabHit.sizeBytes, engine: 'sab' }))).json();
			const d = await pollDownload(sabHit.title);
			ok(d?.status === 'completed', `SABnzbd grab completed (${d?.status}${d?.error ? ': ' + d.error : ''})`);
			ok(d?.engine === 'sab', `SABnzbd grab used the sab engine (${d?.engine})`);
			ok((d?.files ?? 0) >= 1, `SABnzbd grab imported ${d?.files ?? 0} file(s)`);
			const found = await getJson(`/api/search?q=${encodeURIComponent('Usenet SAB')}`);
			ok((found.tracks ?? []).some((t) => t.title === 'Usenet SAB Track'), 'downloaded SAB track is in the library');
		} else {
			console.log('  (SABnzbd client not configured — SAB grab skipped)');
		}

		const cleared = await (await fetch(`${BASE}/api/usenet`, post('clear'))).json();
		ok((cleared.downloads || []).every((x) => x.status !== 'completed'), 'cleared finished downloads from history');
	}

	nntpMock.close();
	sabMock.close();
	nzMock.close();
}

mock.close();

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
