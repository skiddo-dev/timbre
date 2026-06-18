// Test doubles for the Usenet stack — the way mock-snapserver.mjs stands in for a
// real snapserver. Three tiny servers exercised over the SAME real protocols the app
// speaks, so verify.mjs can drive search → grab → download with no provider, indexer
// account or SABnzbd install:
//
//   createMockNntp()    — a real NNTP server (TCP) that yEnc-encodes + dot-stuffs an
//                         article body on demand. Exercises the built-in engine + the
//                         hand-authored yEnc kernel end-to-end.
//   createMockNewznab() — a Newznab indexer (HTTP): t=search returns an RSS item whose
//                         enclosure points at /get, which returns an NZB referencing
//                         the mock NNTP article.
//   createMockSab()     — a SABnzbd JSON API (HTTP): addurl "downloads" instantly by
//                         writing the fixture under MUSIC_DIR, then reports it complete.
//
//   node scripts/mock-usenet.mjs   # run all three standalone for manual poking
import net from 'node:net';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── yEnc encode (mirror of the kernel's decode) + crc32 + NZB builder ─────────
export function yencEncode(bytes) {
	const out = [];
	for (const b of bytes) {
		const e = (b + 42) & 0xff;
		if (e === 0x00 || e === 0x0a || e === 0x0d || e === 0x3d) out.push(0x3d, (e + 64) & 0xff);
		else out.push(e);
	}
	return Uint8Array.from(out);
}

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
export function crc32(bytes) {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

// Build a single-file NZB pointing at one article on the mock NNTP server.
export function buildNzb({ group, messageId, filename, bytes }) {
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">\n` +
		`  <file poster="mock@timbre" date="0" subject="&quot;${filename}&quot; yEnc (1/1)">\n` +
		`    <groups><group>${group}</group></groups>\n` +
		`    <segments>\n` +
		`      <segment bytes="${bytes}" number="1">${messageId}</segment>\n` +
		`    </segments>\n` +
		`  </file>\n` +
		`</nzb>\n`
	);
}

// ── mock NNTP server ──────────────────────────────────────────────────────────
// articles: Map<messageId, Uint8Array decodedBytes>
export function createMockNntp({ port = 1819, host = '127.0.0.1', articles = new Map() } = {}) {
	const server = net.createServer((sock) => {
		sock.setNoDelay(true);
		sock.write('200 mock NNTP service ready\r\n');
		let buf = Buffer.alloc(0);
		sock.on('data', (d) => {
			buf = Buffer.concat([buf, d]);
			let nl;
			while ((nl = buf.indexOf('\r\n')) >= 0) {
				const line = buf.subarray(0, nl).toString('latin1');
				buf = buf.subarray(nl + 2);
				handle(sock, line, articles);
			}
		});
		sock.on('error', () => {});
	});
	return new Promise((resolve) => {
		server.listen(port, host, () => resolve({ server, port, close: () => server.close() }));
	});
}

function handle(sock, line, articles) {
	const up = line.toUpperCase();
	if (up.startsWith('AUTHINFO USER')) return sock.write('381 enter passcode\r\n');
	if (up.startsWith('AUTHINFO PASS')) return sock.write('281 authentication accepted\r\n');
	if (up.startsWith('MODE READER')) return sock.write('200 reader mode\r\n');
	if (up.startsWith('GROUP')) return sock.write('211 1 1 1 ' + line.slice(6).trim() + '\r\n');
	if (up.startsWith('QUIT')) {
		sock.write('205 bye\r\n');
		return sock.end();
	}
	if (up.startsWith('BODY')) {
		const id = (line.match(/<([^>]+)>/) || [])[1] || line.slice(5).trim();
		const data = articles.get(id);
		if (!data) return sock.write('430 no such article\r\n');
		sock.write(`222 0 <${id}> body follows\r\n`);
		sock.write(encodeArticleBody(data));
		return sock.write('.\r\n');
	}
	sock.write('500 command not recognized\r\n');
}

// Wrap bytes in a yEnc single-part body, chunked to 128 cols (never splitting an
// escape) and NNTP dot-stuffed, ready to drop on the wire before the "." terminator.
function encodeArticleBody(bytes) {
	const enc = yencEncode(bytes);
	const header = Buffer.from(`=ybegin line=128 size=${bytes.length} name=fixture.bin\r\n`, 'latin1');
	const footer = Buffer.from(`=yend size=${bytes.length} crc32=${crc32(bytes)}\r\n`, 'latin1');
	const chunks = [header];
	let i = 0;
	while (i < enc.length) {
		let end = Math.min(i + 128, enc.length);
		if (end < enc.length && enc[end - 1] === 0x3d) end--; // keep '=' with its escapee
		const lineBytes = Buffer.from(enc.subarray(i, end));
		// dot-stuffing: a body line beginning with '.' gets an extra leading '.'
		const stuffed = lineBytes[0] === 0x2e ? Buffer.concat([Buffer.from([0x2e]), lineBytes]) : lineBytes;
		chunks.push(stuffed, Buffer.from('\r\n', 'latin1'));
		i = end;
	}
	chunks.push(footer);
	return Buffer.concat(chunks);
}

// ── mock Newznab indexer (HTTP) ───────────────────────────────────────────────
// items: [{ guid, title, sizeBytes, nzb }]
export function createMockNewznab({ port = 1818, host = '127.0.0.1', items = [] } = {}) {
	const byGuid = new Map(items.map((it) => [it.guid, it]));
	const server = http.createServer((req, res) => {
		const u = new URL(req.url, `http://${host}:${port}`);
		const base = `http://${host}:${port}`;
		if (u.pathname === '/get' || u.searchParams.get('t') === 'get') {
			const it = byGuid.get(u.searchParams.get('id') || '');
			if (!it) return end(res, 404, 'text/plain', 'not found');
			return end(res, 200, 'application/x-nzb', it.nzb);
		}
		if (u.searchParams.get('t') === 'search') {
			const q = (u.searchParams.get('q') || '').toLowerCase();
			const hits = items.filter((it) => !q || it.title.toLowerCase().includes(q));
			return end(res, 200, 'application/rss+xml', searchRss(hits, base));
		}
		if (u.searchParams.get('t') === 'caps') return end(res, 200, 'application/xml', '<caps/>');
		return end(res, 200, 'application/rss+xml', searchRss([], base));
	});
	return new Promise((resolve) => {
		server.listen(port, host, () => resolve({ server, port, close: () => server.close() }));
	});
}

function searchRss(items, base) {
	const xmlItems = items
		.map(
			(it) =>
				`<item><title>${escapeXml(it.title)}</title><guid>${escapeXml(it.guid)}</guid>` +
				`<link>${base}/get?id=${encodeURIComponent(it.guid)}</link>` +
				`<pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>` +
				`<enclosure url="${base}/get?id=${encodeURIComponent(it.guid)}" length="${it.sizeBytes}" type="application/x-nzb"/>` +
				`<newznab:attr name="size" value="${it.sizeBytes}"/>` +
				`<newznab:attr name="grabs" value="7"/></item>`
		)
		.join('');
	return (
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">\n` +
		`<channel>${xmlItems}</channel></rss>`
	);
}

// ── mock SABnzbd (HTTP JSON API) ──────────────────────────────────────────────
// On addurl, instantly "download" by writing the fixture under MUSIC_DIR, then report
// the job complete from history. fixture: { slug, name, bytes }
export function createMockSab({ port = 1820, host = '127.0.0.1', musicDir, fixture } = {}) {
	const jobs = new Map(); // nzo_id → { storage, name }
	let seq = 0;
	const server = http.createServer((req, res) => {
		const u = new URL(req.url, `http://${host}:${port}`);
		const mode = u.searchParams.get('mode');
		if (mode === 'version') return endJson(res, { version: '4.0.0-mock' });
		if (mode === 'addurl') {
			const id = `SABnzbd_nzo_mock${++seq}`;
			const storage = join(musicDir, '_usenet', `sab-${fixture.slug}`);
			mkdirSync(storage, { recursive: true });
			writeFileSync(join(storage, fixture.name), Buffer.from(fixture.bytes));
			jobs.set(id, { storage, name: u.searchParams.get('nzbname') || fixture.name });
			return endJson(res, { status: true, nzo_ids: [id] });
		}
		if (mode === 'queue') return endJson(res, { queue: { slots: [] } });
		if (mode === 'history') {
			const slots = [...jobs.entries()].map(([id, j]) => ({
				nzo_id: id,
				name: j.name,
				status: 'Completed',
				storage: j.storage,
				fail_message: ''
			}));
			return endJson(res, { history: { slots } });
		}
		return endJson(res, { status: false, error: 'unknown mode' });
	});
	return new Promise((resolve) => {
		server.listen(port, host, () => resolve({ server, port, close: () => server.close() }));
	});
}

// ── helpers ───────────────────────────────────────────────────────────────────
function end(res, status, type, body) {
	res.writeHead(status, { 'Content-Type': type });
	res.end(body);
}
function endJson(res, obj) {
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(obj));
}
function escapeXml(s) {
	return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

// run standalone for manual exploration
if (import.meta.url === `file://${process.argv[1]}`) {
	const articles = new Map([['demo@timbre.mock', Uint8Array.from(Buffer.from('hello from usenet'))]]);
	await createMockNntp({ articles });
	await createMockNewznab({
		items: [
			{ guid: 'g1', title: 'Demo Artist - Demo Album', sizeBytes: 17, nzb: buildNzb({ group: 'a.b.test', messageId: 'demo@timbre.mock', filename: 'demo.bin', bytes: 17 }) }
		]
	});
	console.log('mock newznab :1818, nntp :1819 (Ctrl-C to stop)');
}
