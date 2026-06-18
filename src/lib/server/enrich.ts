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

// ── MusicBrainz parsing helpers ───────────────────────────────────────────────
const strOrNull = (v: unknown): string | null => {
	const s = typeof v === 'string' ? v.trim() : '';
	return s.length ? s : null;
};

// Leading 4-digit year out of an MB date ('1973', '1973-03', '1973-03-01').
function yearOf(date: unknown): number | null {
	const m = /^(\d{4})/.exec(typeof date === 'string' ? date : '');
	return m ? Number(m[1]) : null;
}

// MB exposes both curated `genres` and folksonomy `tags` ([{name, count}]).
// Prefer genres, fall back to tags; return the most-tagged names, deduped.
function topGenres(obj: any, max = 6): string[] {
	const src: any[] = Array.isArray(obj?.genres) && obj.genres.length ? obj.genres : obj?.tags ?? [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of [...src].sort((a, b) => (Number(b?.count) || 0) - (Number(a?.count) || 0))) {
		const name = typeof t?.name === 'string' ? t.name.trim().toLowerCase() : '';
		if (name && !seen.has(name)) {
			seen.add(name);
			out.push(name);
			if (out.length >= max) break;
		}
	}
	return out;
}

const jsonOrNull = (a: string[]): string | null => (a.length ? JSON.stringify(a) : null);

export interface ArtistEnrichment {
	mbid: string | null;
	bio: string | null;
	image: boolean;
	type: string | null;
	country: string | null;
	beginYear: number | null;
	endYear: number | null;
	genres: string[];
}

export async function enrichArtist(id: number): Promise<ArtistEnrichment> {
	const row = db.prepare('SELECT id, name FROM artists WHERE id = ?').get(id) as
		| { id: number; name: string }
		| undefined;
	if (!row) return { mbid: null, bio: null, image: false, type: null, country: null, beginYear: null, endYear: null, genres: [] };

	if (fake()) {
		const bio = `${row.name} is an artist in your library. (Offline enrichment fixture.)`;
		const genres = ['rock', 'indie'];
		db.prepare(
			`UPDATE artists SET mbid = ?, bio = ?, mb_type = ?, country = ?, begin_year = ?, end_year = ?, mb_genres = ? WHERE id = ?`
		).run('fake-artist-mbid', bio, 'Group', 'US', 1970, null, JSON.stringify(genres), id);
		return { mbid: 'fake-artist-mbid', bio, image: false, type: 'Group', country: 'US', beginYear: 1970, endYear: null, genres };
	}

	await mbThrottle();
	const mb = await getJson(
		`https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(row.name)}&fmt=json&limit=1`
	);
	const hit = mb?.artists?.[0] ?? null;
	const mbid: string | null = hit?.id ?? null;

	// A direct lookup carries genres/tags + the structured facts MB is authoritative
	// for; fall back to the search hit if the lookup is unavailable.
	let type: string | null = null;
	let country: string | null = null;
	let beginYear: number | null = null;
	let endYear: number | null = null;
	let genres: string[] = [];
	if (mbid) {
		await mbThrottle();
		const detail = await getJson(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=genres+tags&fmt=json`);
		const src = detail ?? hit;
		type = strOrNull(src?.type);
		country = strOrNull(src?.country);
		beginYear = yearOf(src?.['life-span']?.begin);
		endYear = yearOf(src?.['life-span']?.end);
		genres = topGenres(detail ?? hit);
	}

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
		 image_path = COALESCE(?, image_path), mb_type = COALESCE(?, mb_type),
		 country = COALESCE(?, country), begin_year = COALESCE(?, begin_year),
		 end_year = COALESCE(?, end_year), mb_genres = COALESCE(?, mb_genres) WHERE id = ?`
	).run(mbid, bio, imagePath, type, country, beginYear, endYear, jsonOrNull(genres), id);
	return { mbid, bio, image: !!imagePath, type, country, beginYear, endYear, genres };
}

export interface AlbumEnrichment {
	mbid: string | null;
	art: boolean;
	year: number | null;
	primaryType: string | null;
	secondaryTypes: string[];
	firstReleased: string | null;
	genres: string[];
}

export async function enrichAlbum(id: number): Promise<AlbumEnrichment> {
	const row = db.prepare('SELECT id, title, album_artist, year, art_path FROM albums WHERE id = ?').get(id) as
		| { id: number; title: string; album_artist: string; year: number | null; art_path: string | null }
		| undefined;
	if (!row) return { mbid: null, art: false, year: null, primaryType: null, secondaryTypes: [], firstReleased: null, genres: [] };

	if (fake()) {
		const genres = ['rock'];
		db.prepare(
			`UPDATE albums SET mbid = ?, mb_primary_type = ?, first_released = ?, mb_genres = ?,
			 year = COALESCE(year, ?) WHERE id = ?`
		).run('fake-album-mbid', 'Album', '1971-01-01', JSON.stringify(genres), 1971, id);
		return {
			mbid: 'fake-album-mbid', art: !!row.art_path, year: row.year ?? 1971,
			primaryType: 'Album', secondaryTypes: [], firstReleased: '1971-01-01', genres
		};
	}

	await mbThrottle();
	const mb = await getJson(
		`https://musicbrainz.org/ws/2/release-group/?query=releasegroup:${encodeURIComponent(
			row.title
		)} AND artist:${encodeURIComponent(row.album_artist)}&fmt=json&limit=1`
	);
	const hit = mb?.['release-groups']?.[0] ?? null;
	const mbid: string | null = hit?.id ?? null;

	let primaryType: string | null = null;
	let secondaryTypes: string[] = [];
	let firstReleased: string | null = null;
	let genres: string[] = [];
	if (mbid) {
		await mbThrottle();
		const detail = await getJson(`https://musicbrainz.org/ws/2/release-group/${mbid}?inc=genres+tags&fmt=json`);
		const src = detail ?? hit;
		primaryType = strOrNull(src?.['primary-type']);
		secondaryTypes = Array.isArray(src?.['secondary-types'])
			? src['secondary-types'].map((t: unknown) => String(t)).filter(Boolean)
			: [];
		firstReleased = strOrNull(src?.['first-release-date']);
		genres = topGenres(detail ?? hit);
	}
	// Only fill year when the file tags didn't already provide one.
	const year = row.year ?? yearOf(firstReleased);

	// Fetch a front cover only if we don't already have embedded art.
	let artPath = row.art_path;
	if (!artPath && mbid) {
		artPath = await download(`https://coverartarchive.org/release-group/${mbid}/front`, `album-${id}`);
	}

	db.prepare(
		`UPDATE albums SET mbid = COALESCE(?, mbid), art_path = COALESCE(?, art_path),
		 year = COALESCE(year, ?), mb_primary_type = COALESCE(?, mb_primary_type),
		 mb_secondary_types = COALESCE(?, mb_secondary_types),
		 first_released = COALESCE(?, first_released), mb_genres = COALESCE(?, mb_genres) WHERE id = ?`
	).run(
		mbid, artPath, year, primaryType, jsonOrNull(secondaryTypes), firstReleased, jsonOrNull(genres), id
	);
	return { mbid, art: !!artPath, year, primaryType, secondaryTypes, firstReleased, genres };
}
