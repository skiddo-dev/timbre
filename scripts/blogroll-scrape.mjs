// Scrape the 16 crate-digging blogs for their actual download links, via each
// blog's Blogger JSON feed (full post HTML, no headless browser needed). Writes
// data/blogroll-manifest.json — a per-blog list of recent posts with the file-host
// links found in each. Read-only and polite (sequential, identifies itself).
//
//   node scripts/blogroll-scrape.mjs
//   node scripts/blogroll-scrape.mjs --max=40        # posts per blog (default 25)
//
// The downloader (blogroll-download.mjs) consumes the manifest.
import { writeFileSync, mkdirSync } from 'node:fs';

const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '').split('=')[1]) || 25;
const UA = 'TimbreBlogroll/0.1 (personal music library; contact: local)';

const HOSTS = [
	['monrakplengthai', 'monrakplengthai.blogspot.com'],
	['soi48', 'soi48.blogspot.com'],
	['madrotter', 'madrotter-treasure-hunt.blogspot.com'],
	['phyuniwarpyar', 'phyuniwarpyarmusic.blogspot.com'],
	['oriental-traditional', 'oriental-traditional-music.blogspot.com'],
	['moroccantapestash', 'moroccantapestash.blogspot.com'],
	['foundtapes', 'foundtapes.blogspot.com'],
	['bodegapop', 'bodegapop.blogspot.com'],
	['neosamzpoke', 'neosamzpoke.blogspot.com'],
	['1000flights', '1000flights.blogspot.com'],
	['nostalgie-de-la-boue', 'nostalgie-de-la-boue.blogspot.com'],
	['tapeattack', 'tapeattack.blogspot.com'],
	['disorder', 'disorderareyouexperienced.blogspot.com'],
	['dieordiy2', 'dieordiy2.blogspot.com'],
	['norecordshopsleft', 'norecordshopsleft.blogspot.com'],
	['public-embarrassment-blues', 'public-embarrassment-blues.blogspot.com']
];

// File-host patterns. Order matters only for classification; we keep every match.
const HOST_PATTERNS = [
	['mega', /https?:\/\/mega(?:\.co)?\.nz\/(?:file|folder)\/[^\s"'<>)]+/gi],
	['mediafire', /https?:\/\/(?:www\.)?mediafire\.com\/[^\s"'<>)]+/gi],
	['drive', /https?:\/\/drive\.google\.com\/[^\s"'<>)]+/gi],
	['archive', /https?:\/\/archive\.org\/(?:details|download)\/[^\s"'<>)]+/gi],
	['dropbox', /https?:\/\/(?:www\.)?dropbox\.com\/[^\s"'<>)]+/gi],
	['box', /https?:\/\/(?:app\.)?box\.com\/[^\s"'<>)]+/gi],
	['zippyshare', /https?:\/\/[a-z0-9]+\.zippyshare\.com\/[^\s"'<>)]+/gi],
	['direct', /https?:\/\/[^\s"'<>)]+\.(?:zip|rar|7z|mp3|flac|m4a|ogg)(?:\?[^\s"'<>)]*)?/gi]
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractLinks(html) {
	if (!html) return [];
	const found = new Map(); // href -> host
	for (const [host, re] of HOST_PATTERNS) {
		for (const m of html.matchAll(re)) {
			let href = m[0].replace(/&amp;/g, '&').replace(/[.,);]+$/, '');
			if (!found.has(href)) found.set(href, host);
		}
	}
	return [...found].map(([href, host]) => ({ href, host }));
}

async function fetchFeed(host) {
	// Full post bodies live in the feed's content; ask for the most recent MAX.
	const url = `https://${host}/feeds/posts/default?alt=json&max-results=${MAX}`;
	const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.json();
	const entries = data?.feed?.entry ?? [];
	return entries.map((e) => {
		const html = e.content?.$t ?? e.summary?.$t ?? '';
		const alt = (e.link ?? []).find((l) => l.rel === 'alternate');
		return {
			title: e.title?.$t ?? '(untitled)',
			url: alt?.href ?? null,
			published: e.published?.$t ?? null,
			links: extractLinks(html)
		};
	});
}

const manifest = [];
const tally = (posts, host) => posts.reduce((n, p) => n + p.links.filter((l) => l.host === host).length, 0);

console.log(`Scraping ${HOSTS.length} blogs (max ${MAX} posts each)…\n`);
for (const [slug, host] of HOSTS) {
	process.stdout.write(`  ${slug.padEnd(28)} `);
	try {
		const posts = await fetchFeed(host);
		manifest.push({ slug, host, posts });
		const mega = tally(posts, 'mega');
		const other = posts.reduce((n, p) => n + p.links.filter((l) => l.host !== 'mega').length, 0);
		const withLinks = posts.filter((p) => p.links.length).length;
		console.log(`${String(posts.length).padStart(2)} posts · ${withLinks} with links · ${mega} mega · ${other} other`);
	} catch (e) {
		manifest.push({ slug, host, posts: [], error: String(e.message ?? e) });
		console.log(`✗ ${e.message ?? e}`);
	}
	await sleep(800); // be polite between blogs
}

mkdirSync('data', { recursive: true });
writeFileSync('data/blogroll-manifest.json', JSON.stringify(manifest, null, 2));

const totalMega = manifest.reduce((n, b) => n + tally(b.posts, 'mega'), 0);
const totalPosts = manifest.reduce((n, b) => n + b.posts.length, 0);
console.log(`\n✓ wrote data/blogroll-manifest.json — ${totalPosts} posts, ${totalMega} Mega links total`);
