// Apple Music subscription → local library, the ethos-preserving way. Two jobs:
//
//   syncLibrary()  — read your Apple library + playlists and reconcile each song to
//                    a LOCAL file by (artist, title). Matches play through Timbre's
//                    pipeline like any local track. Songs with no local file become
//                    `source='applemusic'` deep-link "wishlist" rows (non-playable,
//                    they 404 on stream and show a ↗ to Apple Music) — DRM audio
//                    never enters the player. Playlists are mirrored to those ids.
//
//   enrichAlbumFromApple() — fill an album's missing artwork / genre / one-line
//                    descriptor from Apple's catalog, plus its catalog id + deep
//                    link. COALESCE writes (only fill gaps), same as enrich.ts.
//
// All Apple I/O lives in applemusicApi.ts and degrades silently / fakes offline,
// so everything here is a pure DB transformation over whatever it returns.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { rebuildSearchIndex } from './search';
import {
	appleMusicConfigured,
	appleMusicConnected,
	searchCatalogAlbum,
	fetchLibrarySongs,
	fetchLibraryPlaylists,
	recordSync,
	type LibrarySong,
	type LibraryPlaylist
} from './applemusicApi';
import type { AppleSyncResult, AppleEnrichResult } from '$lib/types';

const ART_DIR = () => env.ART_CACHE_DIR || 'data/art';

// Normalize for matching: NFC, lowercase, drop "feat." credits, keep only letters/
// digits as space-separated tokens. Maps "Beyoncé (feat. JAY-Z)" ≈ "beyonce".
function normalize(s: string): string {
	return s
		.normalize('NFC')
		.toLowerCase()
		.replace(/\(feat\.?[^)]*\)|\[feat\.?[^\]]*\]|\bfeat\.?\b.*$|\bfeaturing\b.*$/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}
const songKey = (s: { artist: string; title: string }) => `${normalize(s.artist)}|${normalize(s.title)}`;

// ── library sync ────────────────────────────────────────────────────────────────
export async function syncLibrary(): Promise<AppleSyncResult> {
	const res: AppleSyncResult = { matched: 0, wishlist: 0, playlists: 0, error: null };
	if (!appleMusicConnected()) {
		res.error = 'Connect your Apple Music account first.';
		return res;
	}

	// All network reads happen up front; the DB writes are one synchronous txn.
	let songs: LibrarySong[];
	let playlists: LibraryPlaylist[];
	try {
		songs = await fetchLibrarySongs();
		playlists = await fetchLibraryPlaylists();
	} catch (e) {
		res.error = e instanceof Error ? e.message : 'could not read your Apple Music library';
		return res;
	}

	// path → local track id, for reconciling Apple songs to scanned files.
	const localIndex = new Map<string, number>();
	for (const r of db
		.prepare(`SELECT id, artist, title FROM tracks WHERE source = 'local'`)
		.all() as { id: number; artist: string; title: string }[]) {
		const k = songKey(r);
		if (!localIndex.has(k)) localIndex.set(k, r.id);
	}

	const now = new Date().toISOString();
	const wishlistAlbums = new Map<string, number>(); // album key → album id (this run)
	const resolved = new Map<string, { trackId: number; matched: boolean }>();

	const getWishlistAlbum = (albumArtist: string, title: string): number => {
		const key = `${normalize(albumArtist)}|${normalize(title)}`;
		const hit = wishlistAlbums.get(key);
		if (hit != null) return hit;
		const existing = db
			.prepare(
				`SELECT id FROM albums WHERE source = 'applemusic'
				 AND album_artist = ? COLLATE NOCASE AND title = ? COLLATE NOCASE`
			)
			.get(albumArtist, title) as { id: number } | undefined;
		const id =
			existing?.id ??
			Number(
				db
					.prepare(`INSERT INTO albums (title, album_artist, source, added_at) VALUES (?, ?, 'applemusic', ?)`)
					.run(title || 'Apple Music', albumArtist || 'Apple Music', now).lastInsertRowid
			);
		wishlistAlbums.set(key, id);
		return id;
	};

	const upsertWishlistTrack = db.prepare(
		`INSERT INTO tracks (album_id, artist, title, duration_ms, codec, path, mtime, file_size, source, source_url, apple_id, apple_url, added_at)
		 VALUES (?, ?, ?, ?, 'APPLEMUSIC', ?, 0, 0, 'applemusic', ?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		   album_id = excluded.album_id, artist = excluded.artist, title = excluded.title,
		   duration_ms = excluded.duration_ms, source_url = excluded.source_url,
		   apple_id = excluded.apple_id, apple_url = excluded.apple_url`
	);
	const idByPath = db.prepare('SELECT id FROM tracks WHERE path = ?');

	const resolveSong = (s: LibrarySong): { trackId: number; matched: boolean } | null => {
		if (!s.title) return null;
		const key = songKey(s);
		const cached = resolved.get(key);
		if (cached) return cached;

		const local = localIndex.get(key);
		if (local != null) {
			const r = { trackId: local, matched: true };
			resolved.set(key, r);
			return r;
		}
		// catalog-only → a deep-link wishlist row. Stable synthetic path keeps it
		// idempotent across re-syncs and (having no file) 404s gracefully on stream.
		const albumId = getWishlistAlbum(s.artist, s.album || s.title);
		const path = `applemusic:song:${s.catalogId ?? songKey(s).replace(/\s+/g, '_')}`;
		upsertWishlistTrack.run(albumId, s.artist, s.title, s.durationMs, path, s.url, s.catalogId, s.url, now);
		const row = idByPath.get(path) as { id: number } | undefined;
		if (!row) return null;
		const r = { trackId: row.id, matched: false };
		resolved.set(key, r);
		return r;
	};

	db.exec('BEGIN');
	try {
		// Count over every distinct song (library + playlist members).
		const all: LibrarySong[] = [...songs];
		for (const pl of playlists) all.push(...pl.tracks);
		for (const s of all) {
			const key = songKey(s);
			if (resolved.has(key)) continue;
			const r = resolveSong(s);
			if (!r) continue;
			if (r.matched) res.matched++;
			else res.wishlist++;
		}

		for (const pl of playlists) {
			const ids = pl.tracks
				.map((t) => resolveSong(t)?.trackId)
				.filter((id): id is number => id != null);
			if (ids.length === 0) continue;
			upsertPlaylist(pl, ids, now);
			res.playlists++;
		}
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		res.error = e instanceof Error ? e.message : String(e);
		return res;
	}

	recordSync();
	// Wishlist rows are real tracks — make them searchable alongside the local library.
	rebuildSearchIndex();
	return res;
}

function upsertPlaylist(pl: LibraryPlaylist, trackIds: number[], now: string): void {
	const pid = `applemusic-lib:${pl.id}`;
	const existing = db.prepare('SELECT id FROM playlists WHERE persistent_id = ?').get(pid) as
		| { id: number }
		| undefined;
	const plId =
		existing?.id ??
		Number(
			db
				.prepare(`INSERT INTO playlists (name, persistent_id, source, created_at) VALUES (?, ?, 'applemusic-sync', ?)`)
				.run(pl.name, pid, now).lastInsertRowid
		);
	if (existing) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(pl.name, plId);
	db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(plId);
	const ins = db.prepare('INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)');
	trackIds.forEach((tid, i) => ins.run(plId, i, tid));
}

// ── catalog enrichment ───────────────────────────────────────────────────────────
async function downloadArt(url: string, base: string): Promise<string | null> {
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		const ct = (res.headers.get('content-type') || '').split(';')[0];
		const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
		mkdirSync(ART_DIR(), { recursive: true });
		const path = join(ART_DIR(), `${base}.${ext}`);
		writeFileSync(path, Buffer.from(await res.arrayBuffer()));
		return path;
	} catch {
		return null;
	}
}

export async function enrichAlbumFromApple(albumId: number): Promise<AppleEnrichResult> {
	const empty: AppleEnrichResult = { appleId: null, appleUrl: null, art: false, genres: [], editorial: false, error: null };
	const row = db
		.prepare('SELECT id, title, album_artist, art_path, descriptor FROM albums WHERE id = ?')
		.get(albumId) as
		| { id: number; title: string; album_artist: string; art_path: string | null; descriptor: string | null }
		| undefined;
	if (!row) return { ...empty, error: 'album not found' };

	const hit = await searchCatalogAlbum(row.album_artist, row.title);
	if (!hit) return empty; // no match → silent, nothing to write

	// Fetch artwork only if we don't already have a cover.
	let art = !!row.art_path;
	if (!row.art_path && hit.artworkUrl) {
		const p = await downloadArt(hit.artworkUrl, `album-${albumId}`);
		if (p) {
			db.prepare('UPDATE albums SET art_path = ? WHERE id = ?').run(p, albumId);
			art = true;
		}
	}

	const editorial = !row.descriptor && !!hit.editorialNotes;
	db.prepare(
		`UPDATE albums SET apple_id = ?, apple_url = ?,
		 genre = COALESCE(genre, ?), descriptor = COALESCE(descriptor, ?) WHERE id = ?`
	).run(hit.id, hit.url, hit.genres[0] ?? null, hit.editorialNotes ?? null, albumId);

	return { appleId: hit.id, appleUrl: hit.url, art, genres: hit.genres, editorial, error: null };
}

/** Apple-enrich every local album that doesn't yet have a catalog link. */
export async function enrichAllFromApple(limit = 0): Promise<{ enriched: number; total: number; error: string | null }> {
	if (!appleMusicConfigured()) return { enriched: 0, total: 0, error: 'Apple Music is not configured.' };
	const rows = db
		.prepare(
			`SELECT id FROM albums WHERE source = 'local' AND apple_id IS NULL ORDER BY id${
				limit ? ' LIMIT ' + Math.floor(limit) : ''
			}`
		)
		.all() as { id: number }[];
	let enriched = 0;
	for (const r of rows) {
		const res = await enrichAlbumFromApple(r.id);
		if (res.appleId) enriched++;
	}
	return { enriched, total: rows.length, error: null };
}
