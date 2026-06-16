// Library search. Uses FTS5 when this Node's SQLite has it (see db.setupSearch),
// otherwise falls back to LIKE — callers don't care which. The FTS index is
// content-less and rebuilt after each scan via rebuildSearchIndex().
import { db, ftsAvailable } from './db';
import { mapArtist, mapAlbum, mapTrack } from './repo';
import type { SearchResults } from '$lib/types';

type Row = Record<string, unknown>;

const ARTIST_COLS = `id, name, sort_name, mbid, bio, (image_path IS NOT NULL) AS has_image`;
const ALBUM_COLS = `id, title, album_artist, year, mbid, source, (art_path IS NOT NULL) AS has_art, added_at`;
const TRACK_COLS = `id, album_id, artist, title, track_no, disc_no, duration_ms, codec, sample_rate,
	bit_depth, channels, bitrate, loudness_lufs, true_peak, gain_db,
	(peaks_blob IS NOT NULL) AS has_peaks, play_count, last_played_at,
	(SELECT title FROM albums WHERE id = tracks.album_id) AS album_title`;

export function rebuildSearchIndex(): void {
	if (!ftsAvailable) return;
	db.exec('DELETE FROM search_fts');
	const ins = db.prepare('INSERT INTO search_fts (kind, ref_id, text) VALUES (?, ?, ?)');
	db.exec('BEGIN');
	try {
		for (const a of db.prepare('SELECT id, name FROM artists').all() as Row[])
			ins.run('artist', Number(a.id), String(a.name));
		for (const al of db.prepare('SELECT id, title, album_artist FROM albums').all() as Row[])
			ins.run('album', Number(al.id), `${al.title} ${al.album_artist}`);
		for (const t of db.prepare('SELECT id, title, artist FROM tracks').all() as Row[])
			ins.run('track', Number(t.id), `${t.title} ${t.artist}`);
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

/** Build a safe FTS5 prefix query: each token AND-ed, prefix-matched. */
function ftsQuery(q: string): string {
	const tokens = q.match(/[\p{L}\p{N}]+/gu) ?? [];
	return tokens.map((t) => `"${t}"*`).join(' ');
}

export function search(q: string, limit = 20): SearchResults {
	const term = q.trim();
	if (!term) return { artists: [], albums: [], tracks: [] };

	if (ftsAvailable) {
		const m = ftsQuery(term);
		if (m) return searchFts(m, limit);
	}
	return searchLike(term, limit);
}

function searchFts(match: string, limit: number): SearchResults {
	const ids = (kind: string) =>
		(
			db
				.prepare(
					`SELECT ref_id FROM search_fts WHERE kind = ? AND search_fts MATCH ? ORDER BY rank LIMIT ?`
				)
				.all(kind, match, limit) as Row[]
		).map((r) => Number(r.ref_id));

	const byIds = (table: string, cols: string, ids: number[]) => {
		if (ids.length === 0) return [] as Row[];
		const ph = ids.map(() => '?').join(',');
		return db.prepare(`SELECT ${cols} FROM ${table} WHERE id IN (${ph})`).all(...ids) as Row[];
	};

	return {
		artists: byIds('artists', ARTIST_COLS, ids('artist')).map(mapArtist),
		albums: byIds('albums', ALBUM_COLS, ids('album')).map(mapAlbum),
		tracks: byIds('tracks', TRACK_COLS, ids('track')).map(mapTrack)
	};
}

function searchLike(term: string, limit: number): SearchResults {
	const like = `%${term.replace(/[%_]/g, (c) => '\\' + c)}%`;
	const artists = (
		db
			.prepare(
				`SELECT ${ARTIST_COLS} FROM artists WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT ?`
			)
			.all(like, limit) as Row[]
	).map(mapArtist);
	const albums = (
		db
			.prepare(
				`SELECT ${ALBUM_COLS} FROM albums WHERE title LIKE ? ESCAPE '\\' OR album_artist LIKE ? ESCAPE '\\'
				 ORDER BY title COLLATE NOCASE LIMIT ?`
			)
			.all(like, like, limit) as Row[]
	).map(mapAlbum);
	const tracks = (
		db
			.prepare(
				`SELECT ${TRACK_COLS} FROM tracks WHERE title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\'
				 ORDER BY title COLLATE NOCASE LIMIT ?`
			)
			.all(like, like, limit) as Row[]
	).map(mapTrack);
	return { artists, albums, tracks };
}
