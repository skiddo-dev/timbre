// Library scanner — walks MUSIC_DIR, reads tags with music-metadata, and upserts
// artist → album → track. Incremental: a file whose (path, mtime, size) is
// unchanged is skipped; rows for files that disappeared are pruned. Embedded
// cover art is extracted once per album into ART_CACHE_DIR.
import { readdirSync, statSync, mkdirSync, writeFileSync, type Dirent } from 'node:fs';
import { join, extname } from 'node:path';
import { parseFile } from 'music-metadata';
import { env } from '$env/dynamic/private';
import { db, ftsAvailable } from './db';
import { rebuildSearchIndex } from './search';
import { getMusicDir } from './settings';
import type { ScanStatus } from '$lib/types';

const AUDIO_EXT = new Set([
	'.flac', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.wma'
]);

const ART_DIR = () => env.ART_CACHE_DIR || 'data/art';
const MUSIC_DIR = () => getMusicDir();

// HMR-safe status singleton.
const g = globalThis as unknown as { __timbreScan?: ScanStatus };
function status(): ScanStatus {
	if (!g.__timbreScan) {
		g.__timbreScan = {
			running: false, scanned: 0, added: 0, updated: 0, removed: 0, total: 0,
			startedAt: null, finishedAt: null, error: null, musicDir: MUSIC_DIR()
		};
	}
	return g.__timbreScan;
}

export function getScanStatus(): ScanStatus {
	return { ...status(), musicDir: MUSIC_DIR() };
}

function reset(s: ScanStatus): void {
	Object.assign(s, {
		running: true, scanned: 0, added: 0, updated: 0, removed: 0, total: 0,
		startedAt: new Date().toISOString(), finishedAt: null, error: null
	});
}

/** Kick a scan in the background. Returns immediately; poll getScanStatus(). */
export function startScan(): ScanStatus {
	const s = status();
	if (s.running) return getScanStatus();
	reset(s);
	runScan(s).catch((e) => fail(s, e));
	return getScanStatus();
}

/** Run a scan to completion (used by tests that want a synchronous result). */
export async function scanNow(): Promise<ScanStatus> {
	const s = status();
	if (s.running) return getScanStatus();
	reset(s);
	try {
		await runScan(s);
	} catch (e) {
		fail(s, e);
	}
	return getScanStatus();
}

function fail(s: ScanStatus, e: unknown): void {
	s.error = e instanceof Error ? e.message : String(e);
	s.running = false;
	s.finishedAt = new Date().toISOString();
}

function listAudioFiles(root: string): string[] {
	const out: string[] = [];
	let entries: Dirent[];
	try {
		entries = readdirSync(root, { recursive: true, withFileTypes: true }) as Dirent[];
	} catch {
		return out;
	}
	for (const e of entries) {
		if (!e.isFile() || !AUDIO_EXT.has(extname(e.name).toLowerCase())) continue;
		// Node 20.12+: Dirent.parentPath holds the directory for recursive reads.
		const dir = (e as unknown as { parentPath?: string }).parentPath ?? root;
		out.push(join(dir, e.name));
	}
	return out;
}

async function runScan(s: ScanStatus): Promise<void> {
	const root = MUSIC_DIR();
	if (!root) {
		fail(s, new Error('MUSIC_DIR is not set'));
		return;
	}
	mkdirSync(ART_DIR(), { recursive: true });

	const files = listAudioFiles(root);
	s.total = files.length;
	const seen = new Set<string>();

	for (const path of files) {
		seen.add(path);
		try {
			const st = statSync(path);
			const mtime = Math.round(st.mtimeMs);
			const size = st.size;
			const existing = TRACK_GET.get(path) as
				| { id: number; mtime: number; file_size: number }
				| undefined;
			if (!(existing && existing.mtime === mtime && existing.file_size === size)) {
				await upsertFromFile(path, mtime, size, existing?.id ?? null, s);
			}
		} catch {
			/* skip unreadable file, keep going */
		}
		s.scanned++;
	}

	pruneMissing(seen, s);
	if (ftsAvailable) rebuildSearchIndex();

	s.running = false;
	s.finishedAt = new Date().toISOString();
}

// ── prepared statements ──────────────────────────────────────────────────────
const ARTIST_GET = db.prepare('SELECT id FROM artists WHERE name = ? COLLATE NOCASE');
const ARTIST_INS = db.prepare('INSERT INTO artists (name, sort_name) VALUES (?, ?)');
const ALBUM_GET = db.prepare(
	'SELECT id, art_path FROM albums WHERE album_artist = ? COLLATE NOCASE AND title = ? COLLATE NOCASE AND IFNULL(year, -1) = IFNULL(?, -1)'
);
const ALBUM_INS = db.prepare(
	'INSERT INTO albums (title, album_artist, year, source, added_at) VALUES (?, ?, ?, ?, ?)'
);
const ALBUM_SET_ART = db.prepare('UPDATE albums SET art_path = ? WHERE id = ?');
const TRACK_GET = db.prepare('SELECT id, mtime, file_size FROM tracks WHERE path = ?');
const TRACK_INS = db.prepare(
	`INSERT INTO tracks (album_id, artist, title, track_no, disc_no, duration_ms, codec,
		sample_rate, bit_depth, channels, bitrate, path, mtime, file_size, added_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const TRACK_UPD = db.prepare(
	`UPDATE tracks SET album_id = ?, artist = ?, title = ?, track_no = ?, disc_no = ?,
		duration_ms = ?, codec = ?, sample_rate = ?, bit_depth = ?, channels = ?, bitrate = ?,
		mtime = ?, file_size = ?,
		loudness_lufs = NULL, true_peak = NULL, gain_db = NULL, peaks_blob = NULL
	 WHERE id = ?`
);

const PIC_EXT: Record<string, string> = {
	'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif'
};

function ensureArtist(name: string): void {
	if (!ARTIST_GET.get(name)) ARTIST_INS.run(name, name.replace(/^(the|a|an)\s+/i, ''));
}

async function upsertFromFile(
	path: string,
	mtime: number,
	size: number,
	existingId: number | null,
	s: ScanStatus
): Promise<void> {
	const meta = await parseFile(path, { duration: true });
	const c = meta.common;
	const f = meta.format;

	const title = (c.title || baseName(path)).trim();
	const albumArtist = (c.albumartist || c.artist || 'Unknown Artist').trim();
	const trackArtist = (c.artist || albumArtist).trim();
	const albumTitle = (c.album || 'Unknown Album').trim();
	const year = typeof c.year === 'number' ? c.year : null;

	ensureArtist(albumArtist);

	let album = ALBUM_GET.get(albumArtist, albumTitle, year) as
		| { id: number; art_path: string | null }
		| undefined;
	if (!album) {
		const info = ALBUM_INS.run(albumTitle, albumArtist, year, 'local', new Date().toISOString());
		album = { id: Number(info.lastInsertRowid), art_path: null };
	}

	// extract embedded art the first time we see this album
	if (!album.art_path && c.picture && c.picture[0]) {
		const pic = c.picture[0];
		const ext = PIC_EXT[(pic.format || '').toLowerCase()] || 'jpg';
		const artPath = join(ART_DIR(), `album-${album.id}.${ext}`);
		try {
			writeFileSync(artPath, Buffer.from(pic.data));
			ALBUM_SET_ART.run(artPath, album.id);
		} catch {
			/* art is best-effort */
		}
	}

	const codec = (f.codec || f.container || extname(path).slice(1)).toUpperCase();
	const core = [
		album.id,
		trackArtist,
		title,
		c.track?.no ?? null,
		c.disk?.no ?? null,
		Math.round((f.duration || 0) * 1000),
		codec,
		f.sampleRate ?? 0,
		f.bitsPerSample ?? null,
		f.numberOfChannels ?? null,
		f.bitrate ? Math.round(f.bitrate) : null
	];

	if (existingId) {
		TRACK_UPD.run(...core, mtime, size, existingId);
		s.updated++;
	} else {
		TRACK_INS.run(...core, path, mtime, size, new Date().toISOString());
		s.added++;
	}
}

function pruneMissing(seen: Set<string>, s: ScanStatus): void {
	const rows = db.prepare('SELECT id, path FROM tracks').all() as { id: number; path: string }[];
	const del = db.prepare('DELETE FROM tracks WHERE id = ?');
	db.exec('BEGIN');
	try {
		for (const r of rows) {
			if (!seen.has(r.path)) {
				del.run(r.id);
				s.removed++;
			}
		}
		db.exec('DELETE FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks)');
		db.exec('DELETE FROM artists WHERE lower(name) NOT IN (SELECT lower(album_artist) FROM albums)');
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

function baseName(p: string): string {
	return p.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Untitled';
}
