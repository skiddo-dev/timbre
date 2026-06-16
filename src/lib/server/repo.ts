// Every library query + the snake_case-row → camelCase-domain mapping lives here,
// so SQL stays in one place and the routes/pages just call typed functions.
import { db } from './db';
import type { Album, Artist, Track } from '$lib/types';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const strN = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numN = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => !!Number(v);

const ARTIST_COLS = `id, name, sort_name, mbid, bio, (image_path IS NOT NULL) AS has_image`;
const ALBUM_COLS = `id, title, album_artist, year, mbid, source, (art_path IS NOT NULL) AS has_art, added_at`;
const TRACK_COLS = `id, album_id, artist, title, track_no, disc_no, duration_ms, codec, sample_rate,
	bit_depth, channels, bitrate, loudness_lufs, true_peak, gain_db,
	(peaks_blob IS NOT NULL) AS has_peaks, play_count, last_played_at`;

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
		durationMs: r.duration_ms == null ? undefined : num(r.duration_ms)
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
		lastPlayedAt: strN(r.last_played_at)
	};
}

// ── albums ───────────────────────────────────────────────────────────────────
const ALBUM_STATS = `LEFT JOIN tracks t ON t.album_id = a.id`;
const ALBUM_SELECT_STATS = `
	SELECT a.id, a.title, a.album_artist, a.year, a.mbid, a.source,
		(a.art_path IS NOT NULL) AS has_art, a.added_at,
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
