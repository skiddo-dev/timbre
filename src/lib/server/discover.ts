// M7 — the local-AI discovery brain. Three features, each backed by the local
// LLM (Ollama on the 3090/M5) when configured, and each with a deterministic
// heuristic fallback so they still work with no model and run offline under
// TIMBRE_FAKE_LLM=1. Guiding rule (per the Books-AI pattern): the model PROPOSES
// but we only ever resolve to tracks that ACTUALLY EXIST in the library.
import { chatJson, useModel } from './llm';
import {
	getTrack,
	getAlbum,
	getArtist,
	getTracksByIds,
	tracksForPrompt,
	tracksByCriteria,
	albumsNeedingTags,
	albumTrackTitles,
	setAlbumTags
} from './repo';
import type { Track, ScanStatus } from '$lib/types';

// ── small helpers ─────────────────────────────────────────────────────────────
const clean = (v: unknown): string | null => {
	const s = (v == null ? '' : String(v)).trim();
	return s.length ? s.slice(0, 400) : null;
};
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : []);
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

const GENRES = ['Rock', 'Electronic', 'Jazz', 'Folk', 'Pop', 'Classical', 'Hip-Hop', 'Ambient', 'Soul', 'Metal'];
const MOODS = ['Mellow', 'Energetic', 'Reflective', 'Upbeat', 'Moody', 'Warm', 'Dreamy', 'Driving'];

// ── auto-tagging ───────────────────────────────────────────────────────────────
export interface AlbumTags {
	genre: string | null;
	mood: string | null;
	tags: string[];
	descriptor: string | null;
}

/** Tag one album. Returns null if there's no model and we're not faking (skip). */
export async function tagAlbum(id: number): Promise<AlbumTags | null> {
	const album = getAlbum(id);
	if (!album) return null;

	if (!useModel()) {
		// deterministic offline tags (fixtures / no-model). Stable per album.
		const h = hash(`${album.albumArtist}::${album.title}`);
		const tags: AlbumTags = {
			genre: GENRES[h % GENRES.length],
			mood: MOODS[(h >> 3) % MOODS.length],
			tags: [album.albumArtist, GENRES[h % GENRES.length].toLowerCase()],
			descriptor: `${album.title} by ${album.albumArtist}${album.year ? ` (${album.year})` : ''}.`
		};
		setAlbumTags(id, tags);
		return tags;
	}

	const titles = albumTrackTitles(id, 12);
	const sys =
		'You tag a music album for a personal library. Respond with ONLY a JSON object ' +
		'{"genre": string, "mood": string, "tags": string[], "descriptor": string}. ' +
		'genre is one common genre; mood is a single word; tags are 3–5 short descriptors; ' +
		'descriptor is one short sentence about the vibe. Use only the given info; do not invent facts.';
	const user = `Album: ${album.title}\nArtist: ${album.albumArtist}\nYear: ${album.year ?? 'unknown'}\nTracks: ${titles.join(', ')}`;
	const j = await chatJson(sys, user);
	if (!j || typeof j !== 'object') return null; // model down → leave untagged for retry
	const o = j as Record<string, unknown>;
	const tags: AlbumTags = {
		genre: clean(o.genre),
		mood: clean(o.mood),
		tags: arr(o.tags).slice(0, 6),
		descriptor: clean(o.descriptor)
	};
	setAlbumTags(id, tags);
	return tags;
}

// batch tag scan (background, status-polled — same shape as the loudness scan)
const g = globalThis as unknown as { __timbreTag?: ScanStatus };
function tagStatus(): ScanStatus {
	if (!g.__timbreTag)
		g.__timbreTag = {
			running: false, scanned: 0, added: 0, updated: 0, removed: 0, total: 0,
			startedAt: null, finishedAt: null, error: null, musicDir: ''
		};
	return g.__timbreTag;
}
export function getTagStatus(): ScanStatus {
	return { ...tagStatus() };
}

export async function runTagScan(limit = 0): Promise<ScanStatus> {
	const s = tagStatus();
	if (s.running) return getTagStatus();
	Object.assign(s, {
		running: true, scanned: 0, added: 0, updated: 0, removed: 0, total: 0,
		startedAt: new Date().toISOString(), finishedAt: null, error: null
	});
	try {
		const albums = albumsNeedingTags(limit);
		s.total = albums.length;
		for (const a of albums) {
			try {
				if (await tagAlbum(a.id)) s.updated++;
			} catch {
				/* skip */
			}
			s.scanned++;
		}
	} catch (e) {
		s.error = e instanceof Error ? e.message : String(e);
	}
	s.running = false;
	s.finishedAt = new Date().toISOString();
	return getTagStatus();
}

export function startTagScan(limit = 0): ScanStatus {
	const s = tagStatus();
	if (s.running) return getTagStatus();
	runTagScan(limit).catch((e) => {
		s.error = e instanceof Error ? e.message : String(e);
		s.running = false;
	});
	return getTagStatus();
}

// ── library radio ────────────────────────────────────────────────────────────
export interface RadioSeed {
	trackId?: number;
	albumId?: number;
	artistId?: number;
}

export async function buildRadio(seed: RadioSeed, count = 20): Promise<Track[]> {
	let artist: string | null = null;
	let genre: string | null = null;
	let mood: string | null = null;
	const exclude = new Set<number>();
	let label = 'your library';

	if (seed.trackId) {
		const t = getTrack(seed.trackId);
		if (t) {
			exclude.add(t.id);
			artist = t.artist;
			label = `${t.title} — ${t.artist}`;
			const al = getAlbum(t.albumId);
			genre = al?.genre ?? null;
			mood = al?.mood ?? null;
		}
	} else if (seed.albumId) {
		const al = getAlbum(seed.albumId);
		if (al) {
			artist = al.albumArtist;
			genre = al.genre;
			mood = al.mood;
			label = `${al.title} — ${al.albumArtist}`;
		}
	} else if (seed.artistId) {
		const a = getArtist(seed.artistId);
		if (a) {
			artist = a.name;
			label = a.name;
		}
	}

	if (useModel()) {
		const pool = tracksForPrompt(250);
		const poolIds = new Set(pool.map((p) => p.id));
		const sys =
			'You are a radio DJ building a playlist from a personal music library. From the candidate ' +
			'tracks, pick up to ' + count + ' track IDs that flow well from the seed and share its mood/genre. ' +
			'Respond with ONLY JSON {"ids": number[]} using ONLY ids that appear in the candidates. Do not repeat the seed.';
		const user =
			`Seed: ${label}${genre ? ` · genre ${genre}` : ''}${mood ? ` · mood ${mood}` : ''}\n` +
			`Candidates (id | artist | title | genre | mood):\n` +
			pool.map((p) => `${p.id} | ${p.artist} | ${p.title} | ${p.genre ?? '?'} | ${p.mood ?? '?'}`).join('\n');
		const j = await chatJson(sys, user);
		const ids = nums((j as Record<string, unknown>)?.ids)
			.filter((id) => poolIds.has(id) && !exclude.has(id))
			.slice(0, count);
		const tracks = getTracksByIds([...new Set(ids)]);
		if (tracks.length) return tracks;
	}

	return heuristicRadio({ artist, genre, mood }, exclude, count);
}

/** No-model fallback: same-artist → same-genre → same-mood → popular, deduped. */
function heuristicRadio(
	sig: { artist: string | null; genre: string | null; mood: string | null },
	exclude: Set<number>,
	count: number
): Track[] {
	const picked: Track[] = [];
	const seen = new Set<number>(exclude);
	const add = (ts: Track[]) => {
		for (const t of ts) {
			if (picked.length >= count) break;
			if (seen.has(t.id)) continue;
			seen.add(t.id);
			picked.push(t);
		}
	};
	if (sig.artist) add(tracksByCriteria({ artists: [sig.artist], limit: count }));
	if (sig.genre) add(tracksByCriteria({ genres: [sig.genre], limit: count }));
	if (sig.mood) add(tracksByCriteria({ moods: [sig.mood], limit: count }));
	if (picked.length < count) add(getTracksByIds(tracksForPrompt(count * 2).map((p) => p.id)));
	return picked.slice(0, count);
}

// ── natural-language search ("ask the library") ──────────────────────────────
export interface AskResult {
	tracks: Track[];
	note: string;
}

export async function askLibrary(q: string): Promise<AskResult> {
	const query = q.trim();
	if (!query) return { tracks: [], note: '' };

	if (useModel()) {
		const sys =
			'Extract music-library search criteria from the request. Respond with ONLY JSON ' +
			'{"genres": string[], "moods": string[], "artists": string[], "yearFrom": number|null, ' +
			'"yearTo": number|null, "text": string|null, "note": string}. note is a one-line friendly summary.';
		const j = (await chatJson(sys, query)) as Record<string, unknown> | null;
		if (j && typeof j === 'object') {
			const tracks = tracksByCriteria({
				genres: arr(j.genres),
				moods: arr(j.moods),
				artists: arr(j.artists),
				yearFrom: typeof j.yearFrom === 'number' ? j.yearFrom : null,
				yearTo: typeof j.yearTo === 'number' ? j.yearTo : null,
				text: clean(j.text),
				limit: 40
			});
			if (tracks.length) return { tracks, note: clean(j.note) ?? `Results for “${query}”.` };
		}
	}

	// heuristic: treat each word as a possible genre/mood/artist + free text
	const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
	const tracks = tracksByCriteria({
		genres: tokens,
		moods: tokens,
		artists: tokens,
		text: query,
		limit: 40
	});
	return { tracks, note: `Showing results for “${query}”.` };
}
