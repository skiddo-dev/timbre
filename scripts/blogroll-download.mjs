// Download the album archives the blogs link to (from data/blogroll-manifest.json),
// unpack them into MUSIC_DIR/_blogroll/<slug>/, so Timbre's scanner turns them into
// real, playable local tracks. Polite + controllable; proves the chain on Mega first.
//
//   node scripts/blogroll-download.mjs --blog=monrakplengthai --limit=1            # 1 album
//   node scripts/blogroll-download.mjs --hosts=mega,dropbox --limit=2             # all blogs
//   node scripts/blogroll-download.mjs --blog=monrakplengthai --limit=3 --dry-run
//
// Hosts handled: mega (megajs), dropbox (?dl=1), mediafire (scrape direct link),
// drive (file links). Archives: .zip → unzip; .rar/.7z → SKIPPED (no extractor
// installed — `brew install sevenzip` to enable). Folders/zippyshare skipped.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, renameSync, rmSync, createWriteStream, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { File } from 'megajs';

// ── args ─────────────────────────────────────────────────────────────────────
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const ONLY_BLOG = arg('blog', null);
const LIMIT = Number(arg('limit', '1'));        // archives per blog
const HOSTS = new Set(arg('hosts', 'mega').split(',').map((s) => s.trim()));
const DRY = flag('dry-run');
const UA = 'TimbreBlogroll/0.1 (personal music library)';
const AUDIO = new Set(['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.wma']);

// ── music dir (DB override wins, matches src/lib/server/settings.ts) ──────────
const db = new DatabaseSync(process.env.DATABASE_PATH || 'data/timbre.db');
const musicRow = db.prepare("SELECT value FROM settings WHERE key = 'music_dir'").get();
db.close();
const MUSIC_DIR = (process.env.MUSIC_DIR || musicRow?.value || '').trim();
if (!MUSIC_DIR) { console.error('✗ no music_dir set (Settings page) and MUSIC_DIR unset'); process.exit(1); }
const ROOT = join(MUSIC_DIR, '_blogroll');

import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('data/blogroll-manifest.json', 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sanitize = (s) => s.replace(/[/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);

// ── per-host: resolve a link to a fetchable URL (or null if unsupported) ──────
async function resolveHttp(link) {
	const { host, href } = link;
	if (host === 'dropbox') return href.replace(/\?dl=0/, '?dl=1').replace(/(\?|&)dl=0/, '$1dl=1') + (/[?&]dl=/.test(href) ? '' : '?dl=1');
	if (host === 'drive') {
		const id = (href.match(/\/file\/d\/([^/]+)/) || href.match(/[?&]id=([^&]+)/) || [])[1];
		if (!id || /\/folders\//.test(href)) return null; // folders need the Drive API — skip
		return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
	}
	if (host === 'mediafire') {
		if (/\/folder\//.test(href)) return null; // folder pages — skip
		try {
			const html = await (await fetch(href, { headers: { 'User-Agent': UA } })).text();
			const m = html.match(/href="(https?:\/\/download[^"]+)"/) || html.match(/window\.location\.href\s*=\s*'(https?:\/\/[^']+)'/);
			return m ? m[1] : null;
		} catch { return null; }
	}
	if (host === 'direct') return /\.(zip|rar|7z|mp3|flac|m4a|ogg)(\?|$)/i.test(href) && !/zippyshare/.test(href) ? href : null;
	return null;
}

// ── extract / place a downloaded archive ──────────────────────────────────────
function run(cmd, args) {
	return new Promise((res) => { const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] }); p.on('error', () => res(1)); p.on('close', (c) => res(c ?? 1)); });
}
function countAudio(dir) {
	let n = 0;
	try { for (const e of readdirSync(dir, { recursive: true })) if (AUDIO.has(extname(String(e)).toLowerCase())) n++; } catch {}
	return n;
}
async function unpack(file, destDir) {
	const ext = extname(file).toLowerCase();
	mkdirSync(destDir, { recursive: true });
	if (ext === '.zip') {
		const code = await run('unzip', ['-o', '-q', file, '-d', destDir]);
		rmSync(file, { force: true });
		return code === 0 ? countAudio(destDir) : -1;
	}
	if (ext === '.rar') {
		// unrar handles all RAR5 methods (7-Zip chokes on the newer ones); 7zz as fallback.
		let code = await run('unrar', ['x', '-o+', '-idq', file, destDir + '/']);
		if (code !== 0) code = await run('7zz', ['x', '-y', `-o${destDir}`, file]);
		if (code === 0) { rmSync(file, { force: true }); return countAudio(destDir); }
		console.log(`      ⚠ .rar extract failed; left at ${file}`);
		return -1;
	}
	if (ext === '.7z') {
		const code = await run('7zz', ['x', '-y', `-o${destDir}`, file]);
		if (code === 0) { rmSync(file, { force: true }); return countAudio(destDir); }
		console.log(`      ⚠ .7z extract failed (7zz code ${code}); left at ${file}`);
		return -1;
	}
	if (AUDIO.has(ext)) { renameSync(file, join(destDir, basename(file))); return 1; }
	return 0;
}

// ── downloaders ───────────────────────────────────────────────────────────────
async function downloadMega(href, destDir) {
	const f = File.fromURL(href);
	await f.loadAttributes();
	const files = f.directory ? (f.children ?? []).filter((c) => !c.directory) : [f];
	let audio = 0;
	for (const item of files) {
		const tmp = join(destDir, sanitize(item.name || 'mega.bin'));
		mkdirSync(destDir, { recursive: true });
		if (DRY) { console.log(`      [dry] mega ${item.name} (${(item.size / 1e6).toFixed(1)} MB)`); continue; }
		await pipeline(f.directory ? item.download() : f.download(), createWriteStream(tmp));
		const n = await unpack(tmp, join(destDir, sanitize((item.name || 'album').replace(/\.[^.]+$/, ''))));
		if (n > 0) audio += n;
	}
	return audio;
}
async function downloadHttp(url, destDir, hintName) {
	const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
	if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
	const cd = res.headers.get('content-disposition') || '';
	const name = sanitize((cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1]) || hintName || 'download.zip');
	const tmp = join(destDir, name);
	mkdirSync(destDir, { recursive: true });
	if (DRY) { console.log(`      [dry] http ${name}`); return 0; }
	await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
	return unpack(tmp, join(destDir, sanitize(name.replace(/\.[^.]+$/, ''))));
}

// ── walk the manifest ──────────────────────────────────────────────────────────
let grandAudio = 0, grandArchives = 0;
for (const blog of manifest) {
	if (ONLY_BLOG && blog.slug !== ONLY_BLOG) continue;
	const destBase = join(ROOT, blog.slug);
	let done = 0;
	for (const post of blog.posts) {
		if (done >= LIMIT) break;
		// pick the best supported link in this post (prefer mega, then http hosts)
		const link = ['mega', 'dropbox', 'mediafire', 'drive', 'direct']
			.filter((h) => HOSTS.has(h))
			.flatMap((h) => post.links.filter((l) => l.host === h))[0];
		if (!link) continue;
		const tag = sanitize(post.title).slice(0, 70);
		if (countAudio(join(destBase, tag)) > 0) { console.log(`  [${blog.slug}] ${tag}\n      · already downloaded — skipped`); done++; continue; }
		console.log(`  [${blog.slug}] ${tag}\n      ↳ ${link.host}: ${link.href.slice(0, 90)}`);
		try {
			let audio = 0;
			if (link.host === 'mega') audio = await downloadMega(link.href, join(destBase, tag));
			else {
				const url = await resolveHttp(link);
				if (!url) { console.log('      · unsupported/needs-manual — skipped'); continue; }
				const n = await downloadHttp(url, join(destBase, tag), `${tag}${extname(link.href) || '.zip'}`);
				audio = n > 0 ? n : 0;
			}
			done++;
			grandArchives++;
			grandAudio += audio;
			if (!DRY) console.log(`      ✓ ${audio} audio file(s)`);
		} catch (e) {
			console.log(`      ✗ ${String(e.message ?? e).slice(0, 100)}`);
		}
		await sleep(1500); // polite pacing between downloads
	}
}
console.log(`\n${DRY ? '[dry-run] ' : ''}done — ${grandArchives} archive(s), ${grandAudio} audio file(s) into ${ROOT}`);
