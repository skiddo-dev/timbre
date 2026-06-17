import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from '$env/dynamic/private';

const DB_PATH = env.DATABASE_PATH || 'data/timbre.db';

// Whether the SQLite built into this Node has FTS5. Detected at init; search.ts
// falls back to LIKE when false so the app never depends on it.
export let ftsAvailable = false;

function init(): DatabaseSync {
	mkdirSync(dirname(DB_PATH), { recursive: true });
	const handle = new DatabaseSync(DB_PATH);
	handle.exec('PRAGMA journal_mode = WAL');
	handle.exec('PRAGMA foreign_keys = ON');
	migrate(handle);
	ftsAvailable = setupSearch(handle);
	seedPlayer(handle);
	return handle;
}

interface Migration {
	id: string;
	sql: string;
}

const MIGRATIONS: Migration[] = [
	{
		id: '001_init',
		sql: `
		CREATE TABLE artists (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			sort_name TEXT NOT NULL DEFAULT '',
			mbid TEXT,
			bio TEXT,
			image_path TEXT
		);
		CREATE UNIQUE INDEX idx_artists_name ON artists(name COLLATE NOCASE);

		CREATE TABLE albums (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			album_artist TEXT NOT NULL DEFAULT '',
			year INTEGER,
			mbid TEXT,
			art_path TEXT,
			source TEXT NOT NULL DEFAULT 'local',
			added_at TEXT NOT NULL
		);
		CREATE INDEX idx_albums_lookup ON albums(album_artist COLLATE NOCASE, title COLLATE NOCASE, year);
		CREATE INDEX idx_albums_added ON albums(added_at DESC);

		CREATE TABLE tracks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
			artist TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL,
			track_no INTEGER,
			disc_no INTEGER,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			codec TEXT NOT NULL DEFAULT '',
			sample_rate INTEGER NOT NULL DEFAULT 0,
			bit_depth INTEGER,
			channels INTEGER,
			bitrate INTEGER,
			path TEXT NOT NULL UNIQUE,
			mtime INTEGER NOT NULL DEFAULT 0,
			file_size INTEGER NOT NULL DEFAULT 0,
			loudness_lufs REAL,
			true_peak REAL,
			gain_db REAL,
			peaks_blob BLOB,
			play_count INTEGER NOT NULL DEFAULT 0,
			last_played_at TEXT,
			added_at TEXT NOT NULL
		);
		CREATE INDEX idx_tracks_album ON tracks(album_id, disc_no, track_no);
		CREATE INDEX idx_tracks_played ON tracks(last_played_at DESC);

		CREATE TABLE queue (
			position INTEGER PRIMARY KEY,
			track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
		);

		CREATE TABLE player_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			current_track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
			position_ms INTEGER NOT NULL DEFAULT 0,
			volume REAL NOT NULL DEFAULT 1.0,
			shuffle INTEGER NOT NULL DEFAULT 0,
			repeat TEXT NOT NULL DEFAULT 'off'
		);

		CREATE TABLE settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
		`
	},
	{
		id: '002_ai_tags',
		sql: `
		ALTER TABLE albums ADD COLUMN genre TEXT;
		ALTER TABLE albums ADD COLUMN mood TEXT;
		ALTER TABLE albums ADD COLUMN tags TEXT;          -- JSON array of descriptors
		ALTER TABLE albums ADD COLUMN descriptor TEXT;    -- one-line vibe sentence
		ALTER TABLE albums ADD COLUMN analyzed_at TEXT;   -- when the AI last tagged it
		`
	}
];

function migrate(handle: DatabaseSync): void {
	handle.exec(
		'CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
	);
	const applied = new Set(
		(handle.prepare('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id)
	);
	const insert = handle.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)');
	for (const m of MIGRATIONS) {
		if (applied.has(m.id)) continue;
		handle.exec(m.sql);
		insert.run(m.id, new Date().toISOString());
	}
}

// Try to stand up an FTS5 index. If this Node's SQLite lacks FTS5 the CREATE
// throws and we return false — search.ts then uses LIKE. The index is content-less
// and rebuilt after each scan (see rebuildSearchIndex), so no triggers needed.
function setupSearch(handle: DatabaseSync): boolean {
	try {
		handle.exec(
			`CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
				kind UNINDEXED, ref_id UNINDEXED, text, tokenize = 'unicode61'
			)`
		);
		return true;
	} catch {
		return false;
	}
}

function seedPlayer(handle: DatabaseSync): void {
	handle.exec(
		`INSERT INTO player_state (id, current_track_id, position_ms, volume, shuffle, repeat)
		 VALUES (1, NULL, 0, 1.0, 0, 'off')
		 ON CONFLICT(id) DO NOTHING`
	);
}

// Declared last so migrations/seed run before init() at module load. Cached on
// globalThis to survive HMR reloads in dev.
const globalForDb = globalThis as unknown as { __timbreDb?: DatabaseSync };

export const db: DatabaseSync = globalForDb.__timbreDb ?? (globalForDb.__timbreDb = init());
