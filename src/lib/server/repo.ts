// Every library query + the snake_case-row → camelCase-domain mapping lives here,
// so SQL stays in one place and the routes/pages just call typed functions.
import { db } from './db';
import type { Album, Artist, Playlist, Track } from '$lib/types';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const strN = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numN = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => !!Number(v);
const jsonArr = (v: unknown): string[] => {
	if (v == null) return [];
	try {
		const a = JSON.parse(String(v));
		return Array.isArray(a) ? a.map(String) : [];
	} catch {
		return [];
	}
};

const ARTIST_COLS = `id, name, sort_name, mbid, bio, (image_path IS NOT NULL) AS has_image`;
const ALBUM_COLS = `id, title, album_artist, year, mbid, source, (art_path IS NOT NULL) AS has_art,
	added_at, genre, mood, tags, descriptor`;
const TRACK_COLS = `id, album_id, artist, title, track_no, disc_no, duration_ms, codec, sample_rate,
	bit_depth, channels, bitrate, loudness_lufs, true_peak, gain_db,
	(peaks_blob IS NOT NULL) AS has_peaks, play_count, last_played_at, rating`;

export function mapArtist(r: Row): Artist {
	return {
		id: num(r.id),
		name: str(r.name),
		sortName: str(r.sort_name),
		mbid: strN(r.mbid),
		bio: strN(r.bio),
		hasImage: bool(r.has_image)
	};
}

export function mapAlbum(r: Row): Album {
	return {
		id: num(r.id),
		title: str(r.title),
		albumArtist: str(r.album_artist),
		year: numN(r.year),
		mbid: strN(r.mbid),
		source: str(r.source) || 'local',
		hasArt: bool(r.has_art),
		addedAt: str(r.added_at),
		trackCount: r.track_count == null ? undefined : num(r.track_count),
		durationMs: r.duration_ms == null ? undefined : num(r.duration_ms),
		genre: strN(r.genre),
		mood: strN(r.mood),
		tags: jsonArr(r.tags),
		descriptor: strN(r.descriptor)
	};
}

export function mapTrack(r: Row): Track {
	return {
		id: num(r.id),
		albumId: num(r.album_id),
		albumTitle: r.album_title == null ? undefined : str(r.album_title),
		artist: str(r.artist),
		title: str(r.title),
		trackNo: numN(r.track_no),
		discNo: numN(r.disc_no),
		durationMs: num(r.duration_ms),
		codec: str(r.codec),
		sampleRate: num(r.sample_rate),
		bitDepth: numN(r.bit_depth),
		channels: numN(r.channels),
		bitrate: numN(r.bitrate),
		loudnessLufs: numN(r.loudness_lufs),
		truePeak: numN(r.true_peak),
		gainDb: numN(r.gain_db),
		hasPeaks: bool(r.has_peaks),
		playCount: num(r.play_count),
		lastPlayedAt: strN(r.last_played_at),
		rating: numN(r.rating)
	};
}

// ── albums ───────────────────────────────────────────────────────────────────
const ALBUM_STATS = `LEFT JOIN tracks t ON t.album_id = a.id`;
const ALBUM_SELECT_STATS = `
	SELECT a.id, a.title, a.album_artist, a.year, a.mbid, a.source,
		(a.art_path IS NOT NULL) AS has_art, a.added_at, a.genre, a.mood, a.tags, a.descriptor,
		COUNT(t.id) AS track_count, COALESCE(SUM(t.duration_ms), 0) AS duration_ms
	FROM albums a ${ALBUM_STATS}`;

export type AlbumSort = 'added' | 'title' | 'artist' | 'year';

export function listAlbums(sort: AlbumSort = 'added'): Album[] {
	const order =
		sort === 'title'
			? 'a.title COLLATE NOCASE'
			: sort === 'artist'
				? 'a.album_artist COLLATE NOCASE, a.year'
				: sort === 'year'
					? 'a.year DESC, a.title COLLATE NOCASE'
					: 'a.added_at DESC';
	return (db.prepare(`${ALBUM_SELECT_STATS} GROUP BY a.id ORDER BY ${order}`).all() as Row[]).map(
		mapAlbum
	);
}

export function recentlyAddedAlbums(limit = 18): Album[] {
	return (
		db
			.prepare(`${ALBUM_SELECT_STATS} GROUP BY a.id ORDER BY a.added_at DESC LIMIT ?`)
			.all(limit) as Row[]
	).map(mapAlbum);
}

export function getAlbum(id: number): Album | null {
	const r = db
		.prepare(`${ALBUM_SELECT_STATS} WHERE a.id = ? GROUP BY a.id`)
		.get(id) as Row | undefined;
	return r ? mapAlbum(r) : null;
}

export function albumTracks(albumId: number): Track[] {
	return (
		db
			.prepare(
				`SELECT ${TRACK_COLS} FROM tracks WHERE album_id = ?
				 ORDER BY disc_no NULLS FIRST, track_no NULLS FIRST, title COLLATE NOCASE`
			)
			.all(albumId) as Row[]
	).map(mapTrack);
}

// ── artists ──────────────────────────────────────────────────────────────────
export function listArtists(): Artist[] {
	return (
		db
			.prepare(`SELECT ${ARTIST_COLS} FROM artists ORDER BY sort_name COLLATE NOCASE, name COLLATE NOCASE`)
			.all() as Row[]
	).map(mapArtist);
}

export function getArtist(id: number): Artist | null {
	const r = db.prepare(`SELECT ${ARTIST_COLS} FROM artists WHERE id = ?`).get(id) as Row | undefined;
	return r ? mapArtist(r) : null;
}

export function getArtistByName(name: string): Artist | null {
	const r = db
		.prepare(`SELECT ${ARTIST_COLS} FROM artists WHERE name = ? COLLATE NOCASE`)
		.get(name) as Row | undefined;
	return r ? mapArtist(r) : null;
}

/** Albums whose album_artist matches this artist's name. */
export function artistAlbums(artist: Artist): Album[] {
	return (
		db
			.prepare(
				`${ALBUM_SELECT_STATS} WHERE a.album_artist = ? COLLATE NOCASE
				 GROUP BY a.id ORDER BY a.year DESC, a.title COLLATE NOCASE`
			)
			.all(artist.name) as Row[]
	).map(mapAlbum);
}

// ── tracks ─────────────────────────────────────────────────────────────────
export function getTrack(id: number): Track | null {
	const r = db
		.prepare(
			`SELECT ${TRACK_COLS}, (SELECT title FROM albums WHERE id = tracks.album_id) AS album_title
			 FROM tracks WHERE id = ?`
		)
		.get(id) as Row | undefined;
	return r ? mapTrack(r) : null;
}

/** Full file path for streaming — never exposed to the client. */
export function getTrackPath(id: number): string | null {
	const r = db.prepare('SELECT path FROM tracks WHERE id = ?').get(id) as Row | undefined;
	return r ? str(r.path) : null;
}

export function recentlyPlayedTracks(limit = 12): Track[] {
	return (
		db
			.prepare(
				`SELECT ${TRACK_COLS}, (SELECT title FROM albums WHERE id = tracks.album_id) AS album_title
				 FROM tracks WHERE last_played_at IS NOT NULL
				 ORDER BY last_played_at DESC LIMIT ?`
			)
			.all(limit) as Row[]
	).map(mapTrack);
}

export function markPlayed(id: number): void {
	db.prepare(
		`UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ?`
	).run(new Date().toISOString(), id);
}

export interface ScrobbleTrack {
	trackId: number;
	artist: string;
	title: string;
	album: string | null;
	albumArtist: string | null;
	durationSec: number | null;
}

/** Metadata snapshot a track needs to be scrobbled to Last.fm, or null if unknown. */
export function trackForScrobble(id: number): ScrobbleTrack | null {
	const r = db
		.prepare(
			`SELECT t.id, t.artist, t.title, t.duration_ms,
			        a.title AS album, a.album_artist AS album_artist
			 FROM tracks t JOIN albums a ON a.id = t.album_id
			 WHERE t.id = ?`
		)
		.get(id) as Row | undefined;
	if (!r) return null;
	const durMs = num(r.duration_ms);
	return {
		trackId: num(r.id),
		artist: str(r.artist),
		title: str(r.title),
		album: strN(r.album),
		albumArtist: strN(r.album_artist),
		durationSec: durMs > 0 ? Math.round(durMs / 1000) : null
	};
}

export interface LibraryStats {
	artists: number;
	albums: number;
	tracks: number;
}

export function libraryStats(): LibraryStats {
	const r = db
		.prepare(
			`SELECT (SELECT COUNT(*) FROM artists) AS artists,
			        (SELECT COUNT(*) FROM albums) AS albums,
			        (SELECT COUNT(*) FROM tracks) AS tracks`
		)
		.get() as Row;
	return { artists: num(r.artists), albums: num(r.albums), tracks: num(r.tracks) };
}

// ── AI discovery support (M7) ────────────────────────────────────────────────
const TRACK_COLS_T = `t.id, t.album_id, t.artist, t.title, t.track_no, t.disc_no, t.duration_ms,
	t.codec, t.sample_rate, t.bit_depth, t.channels, t.bitrate, t.loudness_lufs, t.true_peak,
	t.gain_db, (t.peaks_blob IS NOT NULL) AS has_peaks, t.play_count, t.last_played_at, t.rating,
	(SELECT title FROM albums WHERE id = t.album_id) AS album_title`;

/** Fetch tracks by id, preserving the order of `ids` (only real tracks returned). */
export function getTracksByIds(ids: number[]): Track[] {
	if (ids.length === 0) return [];
	const ph = ids.map(() => '?').join(',');
	const rows = db.prepare(`SELECT ${TRACK_COLS_T} FROM tracks t WHERE t.id IN (${ph})`).all(...ids) as Row[];
	const byId = new Map(rows.map((r) => [num(r.id), mapTrack(r)]));
	return ids.map((id) => byId.get(id)).filter((t): t is Track => !!t);
}

export interface PoolItem {
	id: number;
	artist: string;
	title: string;
	genre: string | null;
	mood: string | null;
}

/** A lightweight candidate pool (track + its album genre/mood) for AI prompts. */
export function tracksForPrompt(limit = 300): PoolItem[] {
	return (
		db
			.prepare(
				`SELECT t.id, t.artist, t.title, a.genre, a.mood
				 FROM tracks t JOIN albums a ON a.id = t.album_id ORDER BY t.id LIMIT ?`
			)
			.all(limit) as Row[]
	).map((r) => ({ id: num(r.id), artist: str(r.artist), title: str(r.title), genre: strN(r.genre), mood: strN(r.mood) }));
}

export function albumsNeedingTags(limit = 0): { id: number; title: string; albumArtist: string }[] {
	const sql = `SELECT id, title, album_artist FROM albums WHERE analyzed_at IS NULL ORDER BY id${limit ? ' LIMIT ' + Math.floor(limit) : ''}`;
	return (db.prepare(sql).all() as Row[]).map((r) => ({
		id: num(r.id),
		title: str(r.title),
		albumArtist: str(r.album_artist)
	}));
}

export function albumTrackTitles(albumId: number, limit = 20): string[] {
	return (
		db.prepare('SELECT title FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no LIMIT ?').all(albumId, limit) as Row[]
	).map((r) => str(r.title));
}

export function setAlbumTags(
	id: number,
	t: { genre: string | null; mood: string | null; tags: string[]; descriptor: string | null }
): void {
	db.prepare(
		`UPDATE albums SET genre = ?, mood = ?, tags = ?, descriptor = ?, analyzed_at = ? WHERE id = ?`
	).run(t.genre, t.mood, JSON.stringify(t.tags ?? []), t.descriptor, new Date().toISOString(), id);
}

/** Distinct tracks matching any of the given genres/moods/artists (+ optional year range). */
export function tracksByCriteria(c: {
	genres?: string[];
	moods?: string[];
	artists?: string[];
	yearFrom?: number | null;
	yearTo?: number | null;
	text?: string | null;
	limit?: number;
}): Track[] {
	const where: string[] = [];
	const args: (string | number)[] = [];
	const ors: string[] = [];
	for (const g of c.genres ?? []) { ors.push('a.genre LIKE ?'); args.push(`%${g}%`); }
	for (const m of c.moods ?? []) { ors.push('a.mood LIKE ?'); args.push(`%${m}%`); }
	for (const ar of c.artists ?? []) { ors.push('t.artist LIKE ?'); args.push(`%${ar}%`); }
	if (c.text) { ors.push('(t.title LIKE ? OR t.artist LIKE ? OR a.descriptor LIKE ?)'); args.push(`%${c.text}%`, `%${c.text}%`, `%${c.text}%`); }
	if (ors.length) where.push(`(${ors.join(' OR ')})`);
	if (c.yearFrom != null) { where.push('a.year >= ?'); args.push(c.yearFrom); }
	if (c.yearTo != null) { where.push('a.year <= ?'); args.push(c.yearTo); }
	if (where.length === 0) return [];
	const limit = Math.min(100, c.limit ?? 40);
	const rows = db
		.prepare(
			`SELECT ${TRACK_COLS_T} FROM tracks t JOIN albums a ON a.id = t.album_id
			 WHERE ${where.join(' AND ')} ORDER BY t.play_count DESC, t.id LIMIT ?`
		)
		.all(...args, limit) as Row[];
	return rows.map(mapTrack);
}

// ── playlists (from a Music library import) ──────────────────────────────────
export function listPlaylists(): Playlist[] {
	return (
		db
			.prepare(
				`SELECT p.id, p.name, p.source, COUNT(pt.track_id) AS track_count
				 FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
				 GROUP BY p.id ORDER BY p.name COLLATE NOCASE`
			)
			.all() as Row[]
	).map((r) => ({ id: num(r.id), name: str(r.name), source: str(r.source), trackCount: num(r.track_count) }));
}

export function getPlaylist(id: number): Playlist | null {
	const r = db.prepare('SELECT id, name, source FROM playlists WHERE id = ?').get(id) as Row | undefined;
	return r ? { id: num(r.id), name: str(r.name), source: str(r.source) } : null;
}

export function playlistTracks(id: number): Track[] {
	return (
		db
			.prepare(
				`SELECT ${TRACK_COLS_T} FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
				 WHERE pt.playlist_id = ? ORDER BY pt.position`
			)
			.all(id) as Row[]
	).map(mapTrack);
}
