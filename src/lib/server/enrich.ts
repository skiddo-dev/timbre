// Free, best-effort metadata enrichment. Sources: MusicBrainz (canonical IDs),
// Wikipedia REST (artist bio + image), Cover Art Archive (album front cover).
// Everything degrades silently — a network failure never breaks the library, and
// nothing here is a hard dependency. TIMBRE_FAKE_ENRICH=1 returns canned data so
// tests run fully offline (mirrors the no-cloud-fallback contract of llm.ts).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { db } from './db';

const ART_DIR = () => env.ART_CACHE_DIR || 'data/art';
const UA = () => env.MUSICBRAINZ_UA || 'Timbre/0.1 ( https://github.com/skiddo-dev/timbre )';
const fake = () => env.TIMBRE_FAKE_ENRICH === '1' || env.TIMBRE_FAKE_ENRICH === 'true';

// MusicBrainz asks for ≤1 req/s. Serialise calls behind a shared gate.
const g = globalThis as unknown as { __mbLast?: number };
async function mbThrottle(): Promise<void> {
	const now = Date.now();
	const wait = Math.max(0, 1100 - (now - (g.__mbLast ?? 0)));
	if (wait) await new Promise((r) => setTimeout(r, wait));
	g.__mbLast = Date.now();
}

async function getJson(url: string, timeoutMs = 8000): Promise<any | null> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': UA(), Accept: 'application/json' },
			signal: ctrl.signal
		});
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	} finally {
		clearTimeout(t);
	}
}

const IMG_EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

async function download(url: string, base: string): Promise<string | null> {
	try {
		const res = await fetch(url, { headers: { 'User-Agent': UA() } });
		if (!res.ok) return null;
		const ext = IMG_EXT[(res.headers.get('content-type') || '').split(';')[0]] || 'jpg';
		mkdirSync(ART_DIR(), { recursive: true });
		const path = join(ART_DIR(), `${base}.${ext}`);
		writeFileSync(path, Buffer.from(await res.arrayBuffer()));
		return path;
	} catch {
		return null;
	}
}

export interface ArtistEnrichment {
	mbid: string | null;
	bio: string | null;
	image: boolean;
}

export async function enrichArtist(id: number): Promise<ArtistEnrichment> {
	const row = db.prepare('SELECT id, name FROM artists WHERE id = ?').get(id) as
		| { id: number; name: string }
		| undefined;
	if (!row) return { mbid: null, bio: null, image: false };

	if (fake()) {
		const bio = `${row.name} is an artist in your library. (Offline enrichment fixture.)`;
		db.prepare('UPDATE artists SET mbid = ?, bio = ? WHERE id = ?').run('fake-artist-mbid', bio, id);
		return { mbid: 'fake-artist-mbid', bio, image: false };
	}

	let mbid: string | null = null;
	await mbThrottle();
	const mb = await getJson(
		`https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(row.name)}&fmt=json&limit=1`
	);
	mbid = mb?.artists?.[0]?.id ?? null;

	// Wikipedia summary → bio + image (best-effort, name-based)
	let bio: string | null = null;
	let imagePath: string | null = null;
	const wiki = await getJson(
		`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(row.name)}?redirect=true`
	);
	if (wiki && wiki.type !== 'disambiguation' && typeof wiki.extract === 'string') {
		bio = wiki.extract;
		const thumb: string | undefined = wiki.thumbnail?.source || wiki.originalimage?.source;
		if (thumb) imagePath = await download(thumb, `artist-${id}`);
	}

	db.prepare(
		`UPDATE artists SET mbid = COALESCE(?, mbid), bio = COALESCE(?, bio),
		 image_path = COALESCE(?, image_path) WHERE id = ?`
	).run(mbid, bio, imagePath, id);
	return { mbid, bio, image: !!imagePath };
}

export interface AlbumEnrichment {
	mbid: string | null;
	art: boolean;
}

export async function enrichAlbum(id: number): Promise<AlbumEnrichment> {
	const row = db.prepare('SELECT id, title, album_artist, art_path FROM albums WHERE id = ?').get(id) as
		| { id: number; title: string; album_artist: string; art_path: string | null }
		| undefined;
	if (!row) return { mbid: null, art: false };

	if (fake()) {
		db.prepare('UPDATE albums SET mbid = ? WHERE id = ?').run('fake-album-mbid', id);
		return { mbid: 'fake-album-mbid', art: !!row.art_path };
	}

	await mbThrottle();
	const mb = await getJson(
		`https://musicbrainz.org/ws/2/release-group/?query=releasegroup:${encodeURIComponent(
			row.title
		)} AND artist:${encodeURIComponent(row.album_artist)}&fmt=json&limit=1`
	);
	const mbid: string | null = mb?.['release-groups']?.[0]?.id ?? null;

	// Fetch a front cover only if we don't already have embedded art.
	let artPath = row.art_path;
	if (!artPath && mbid) {
		artPath = await download(`https://coverartarchive.org/release-group/${mbid}/front`, `album-${id}`);
	}

	db.prepare(
		`UPDATE albums SET mbid = COALESCE(?, mbid), art_path = COALESCE(?, art_path) WHERE id = ?`
	).run(mbid, artPath, id);
	return { mbid, art: !!artPath };
}
