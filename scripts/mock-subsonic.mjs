// A tiny fake Subsonic / OpenSubsonic server speaking the real REST API (JSON
// envelope on /rest/<view>.view, f=json). Two uses:
//   • verify.mjs imports createMockSubsonic() to exercise the provider end-to-end
//     (configure → ping → browse → album → search → stream) over real HTTP + the
//     salted-auth params + actual audio bytes, with no server installed.
//   • `node scripts/mock-subsonic.mjs [port]` runs it standalone so you can point
//     Timbre at it (Settings → Streaming server: http://127.0.0.1:<port>, any user,
//     any password) and click around /subsonic.
import http from 'node:http';

// ── fixtures (mirror the TIMBRE_FAKE_SUBSONIC set in src/lib/server/subsonic.ts) ──
const ALBUMS = [
	{ id: 'al-1', name: 'Remote Sessions', artist: 'Navidrome Test', artistId: 'ar-1', coverArt: 'co-1', year: 2023, songCount: 2, duration: 360 },
	{ id: 'al-2', name: 'Self-Hosted Nights', artist: 'Airsonic Test', artistId: 'ar-2', coverArt: 'co-2', year: 2024, songCount: 1, duration: 200 }
];
const SONGS = {
	'al-1': [
		{ id: 'so-1', parent: 'al-1', title: 'Over The Wire', album: 'Remote Sessions', artist: 'Navidrome Test', coverArt: 'co-1', duration: 180, track: 1, year: 2023, suffix: 'wav', contentType: 'audio/wav', samplingRate: 8000, bitDepth: 16, channelCount: 1, bitRate: 128, freq: 330 },
		{ id: 'so-2', parent: 'al-1', title: 'Salted Token Blues', album: 'Remote Sessions', artist: 'Navidrome Test', coverArt: 'co-1', duration: 180, track: 2, year: 2023, suffix: 'wav', contentType: 'audio/wav', samplingRate: 8000, bitDepth: 16, channelCount: 1, bitRate: 128, freq: 440 }
	],
	'al-2': [
		{ id: 'so-3', parent: 'al-2', title: 'Tailnet Lullaby', album: 'Self-Hosted Nights', artist: 'Airsonic Test', coverArt: 'co-2', duration: 200, track: 1, year: 2024, suffix: 'wav', contentType: 'audio/wav', samplingRate: 8000, bitDepth: 16, channelCount: 1, bitRate: 128, freq: 550 }
	]
};
const songById = (id) => Object.values(SONGS).flat().find((s) => s.id === id);

// A short sine WAV so the stream proxy serves real, Range-able audio bytes.
function buildWav({ sampleRate = 8000, seconds = 1, freq = 440 } = {}) {
	const n = sampleRate * seconds;
	const pcm = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++) pcm.writeInt16LE((Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.6 * 0x7fff) | 0, i * 2);
	const fmt = Buffer.alloc(24);
	fmt.write('fmt ', 0, 'latin1');
	fmt.writeUInt32LE(16, 4);
	fmt.writeUInt16LE(1, 8);
	fmt.writeUInt16LE(1, 10);
	fmt.writeUInt32LE(sampleRate, 12);
	fmt.writeUInt32LE(sampleRate * 2, 16);
	fmt.writeUInt16LE(2, 20);
	fmt.writeUInt16LE(16, 22);
	const dataHead = Buffer.alloc(8);
	dataHead.write('data', 0, 'latin1');
	dataHead.writeUInt32LE(pcm.length, 4);
	const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, dataHead, pcm]);
	const riff = Buffer.alloc(8);
	riff.write('RIFF', 0, 'latin1');
	riff.writeUInt32LE(body.length, 4);
	return Buffer.concat([riff, body]);
}

// 1×1 transparent PNG for getCoverArt.
const PNG_1x1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

const ok = (payload) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'timbre-mock', serverVersion: '0.0.0-mock', ...payload } });
const fail = (code, message) => ({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } } });

function route(view, query) {
	switch (view) {
		case 'ping':
			return { json: ok({}) };
		case 'getAlbumList2':
			return { json: ok({ albumList2: { album: ALBUMS } }) };
		case 'getAlbum': {
			const al = ALBUMS.find((a) => a.id === query.get('id'));
			if (!al) return { json: fail(70, 'Album not found') };
			return { json: ok({ album: { ...al, song: SONGS[al.id] ?? [] } }) };
		}
		case 'search3': {
			const q = (query.get('query') ?? '').toLowerCase();
			const m = (s) => !q || s.toLowerCase().includes(q);
			return {
				json: ok({
					searchResult3: {
						artist: ALBUMS.filter((a) => m(a.artist)).map((a) => ({ id: a.artistId, name: a.artist, albumCount: 1 })),
						album: ALBUMS.filter((a) => m(a.name) || m(a.artist)),
						song: Object.values(SONGS).flat().filter((s) => m(s.title) || m(s.artist))
					}
				})
			};
		}
		default:
			return { json: fail(0, `mock: unhandled view ${view}`) };
	}
}

function createServer() {
	return http.createServer((req, res) => {
		const url = new URL(req.url, 'http://localhost');
		const m = url.pathname.match(/\/rest\/([\w.]+?)(?:\.view)?$/);
		if (!m) {
			res.writeHead(404);
			return res.end('not found');
		}
		const view = m[1];
		const query = url.searchParams;

		// getCoverArt → image bytes
		if (view === 'getCoverArt') {
			res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG_1x1.length });
			return res.end(PNG_1x1);
		}

		// stream → real WAV bytes, with HTTP Range support (so the proxy can pass it through)
		if (view === 'stream') {
			const song = songById(query.get('id')) ?? { freq: 440 };
			const wav = buildWav({ freq: song.freq });
			const range = req.headers.range;
			const rm = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
			if (rm) {
				let start = rm[1] ? parseInt(rm[1], 10) : 0;
				let end = rm[2] ? parseInt(rm[2], 10) : wav.length - 1;
				if (end >= wav.length) end = wav.length - 1;
				res.writeHead(206, {
					'Content-Type': 'audio/wav',
					'Accept-Ranges': 'bytes',
					'Content-Range': `bytes ${start}-${end}/${wav.length}`,
					'Content-Length': end - start + 1
				});
				return res.end(wav.subarray(start, end + 1));
			}
			res.writeHead(200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': wav.length });
			return res.end(wav);
		}

		// JSON endpoints
		const { json } = route(view, query);
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(json));
	});
}

export function createMockSubsonic(port = 4533, host = '127.0.0.1') {
	const server = createServer();
	return new Promise((resolve) => {
		server.listen(port, host, () => resolve({ server, url: `http://${host}:${port}`, close: () => server.close() }));
	});
}

// run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
	const port = Number(process.argv[2]) || 4533;
	createMockSubsonic(port).then(({ url }) => console.log(`mock Subsonic on ${url} (any user/password; Ctrl-C to stop)`));
}
