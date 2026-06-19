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
	seedRadio(handle);
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
	},
	{
		id: '003_radio',
		sql: `
		CREATE TABLE radio_stations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			genre TEXT,
			favicon TEXT,
			added_at TEXT NOT NULL
		);
		`
	},
	{
		id: '004_playlists',
		sql: `
		ALTER TABLE tracks ADD COLUMN rating INTEGER;   -- 0..5 stars (from Music library import)

		CREATE TABLE playlists (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			persistent_id TEXT UNIQUE,
			source TEXT NOT NULL DEFAULT 'local',
			created_at TEXT NOT NULL
		);

		CREATE TABLE playlist_tracks (
			playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
			position INTEGER NOT NULL,
			track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
		);
		CREATE INDEX idx_playlist_tracks ON playlist_tracks(playlist_id, position);
		`
	},
	{
		id: '005_blog_source',
		sql: `
		ALTER TABLE tracks ADD COLUMN source TEXT NOT NULL DEFAULT 'local'; -- 'local' | 'blog' | …
		ALTER TABLE tracks ADD COLUMN source_url TEXT;                      -- link back to a non-local source (e.g. a music-blog post)
		`
	},
	{
		// Factual metadata sourced from MusicBrainz during enrichment. The MBID
		// (artists.mbid / albums.mbid) already existed; these hold the fields MB is
		// authoritative for, kept separate from the AI-guessed album genre/mood/tags.
		id: '006_musicbrainz_meta',
		sql: `
		ALTER TABLE artists ADD COLUMN mb_type TEXT;       -- 'Person' | 'Group' | …
		ALTER TABLE artists ADD COLUMN country TEXT;       -- ISO 3166 code, e.g. 'US'
		ALTER TABLE artists ADD COLUMN begin_year INTEGER; -- life-span begin
		ALTER TABLE artists ADD COLUMN end_year INTEGER;   -- life-span end (null = still active)
		ALTER TABLE artists ADD COLUMN mb_genres TEXT;     -- JSON array, ordered by MB tag count

		ALTER TABLE albums ADD COLUMN mb_primary_type TEXT;     -- 'Album' | 'EP' | 'Single' | …
		ALTER TABLE albums ADD COLUMN mb_secondary_types TEXT;  -- JSON array, e.g. ['Live','Compilation']
		ALTER TABLE albums ADD COLUMN first_released TEXT;       -- MB first-release-date (YYYY[-MM[-DD]])
		ALTER TABLE albums ADD COLUMN mb_genres TEXT;            -- JSON array, ordered by MB tag count
		`
	},
	{
		// Last.fm scrobble log + offline queue. Each row is a metadata snapshot
		// (so a scrobble survives the track being deleted) plus the played_at
		// timestamp Last.fm wants. state walks 'pending' → 'sent' | 'failed';
		// pending rows are retried whenever we reconnect or scrobble again, which
		// is how scrobbling stays correct while the network or Last.fm is down.
		id: '007_scrobbles',
		sql: `
		CREATE TABLE scrobbles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
			artist TEXT NOT NULL,
			title TEXT NOT NULL,
			album TEXT,
			album_artist TEXT,
			duration_sec INTEGER,
			played_at INTEGER NOT NULL,            -- unix seconds (the timestamp Last.fm wants)
			state TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed'
			error TEXT,
			created_at TEXT NOT NULL
		);
		CREATE INDEX idx_scrobbles_state ON scrobbles(state, played_at);
		CREATE INDEX idx_scrobbles_recent ON scrobbles(played_at DESC);
		`
	},
	{
		// Apple Music *subscription* link (catalog enrichment + library sync). The
		// subscription is a metadata/library source, never a player — Apple's catalog
		// data fills these IDs and `apple_url` deep-links back out to Apple Music.
		// Library tracks with no local file become `source='applemusic'` wishlist rows
		// (non-playable, like the blog crate) so the player pipeline never sees DRM.
		id: '008_applemusic',
		sql: `
		ALTER TABLE albums ADD COLUMN apple_id TEXT;   -- Apple Music catalog album id
		ALTER TABLE albums ADD COLUMN apple_url TEXT;  -- music.apple.com deep link
		ALTER TABLE tracks ADD COLUMN apple_id TEXT;   -- Apple Music catalog song id
		ALTER TABLE tracks ADD COLUMN apple_url TEXT;  -- music.apple.com deep link
		`
	},
	{
		// Usenet (NZB) acquisition. `usenet_indexers` are the Newznab-compatible
		// search sources (added from Settings, like radio stations). `usenet_downloads`
		// is the grab queue/history: a release is searched → grabbed → fetched by the
		// SABnzbd client or the built-in NNTP engine → its files land in
		// MUSIC_DIR/_usenet/<slug> for the scanner to ingest as ordinary local tracks.
		id: '009_usenet',
		sql: `
		CREATE TABLE usenet_indexers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			url TEXT NOT NULL,              -- Newznab base, e.g. https://api.nzbgeek.info
			api_key TEXT NOT NULL DEFAULT '',
			enabled INTEGER NOT NULL DEFAULT 1,
			added_at TEXT NOT NULL
		);

		CREATE TABLE usenet_downloads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			indexer_id INTEGER REFERENCES usenet_indexers(id) ON DELETE SET NULL,
			nzb_url TEXT NOT NULL,          -- indexer get-link for the .nzb
			category TEXT NOT NULL DEFAULT 'music',
			size_bytes INTEGER NOT NULL DEFAULT 0,
			engine TEXT NOT NULL DEFAULT '',          -- 'sab' | 'nntp'
			status TEXT NOT NULL DEFAULT 'queued',    -- queued|downloading|verifying|extracting|importing|completed|failed
			progress INTEGER NOT NULL DEFAULT 0,      -- 0..100
			bytes_done INTEGER NOT NULL DEFAULT 0,
			client_id TEXT,                 -- SABnzbd nzo_id when engine='sab'
			dest_dir TEXT,                  -- where files landed (under MUSIC_DIR)
			files INTEGER NOT NULL DEFAULT 0,         -- audio files produced
			error TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			completed_at TEXT
		);
		CREATE INDEX idx_usenet_downloads_created ON usenet_downloads(created_at DESC);
		`
	},
	{
		// Unified transport: the active output target for the one shared queue.
		// 'browser' (Web Audio on this device, the default), 'snapcast' (a zone),
		// or 'airplay' (a device); output_id holds the snapcast group / airplay
		// device id. See src/lib/server/transport.ts.
		id: '010_transport',
		sql: `
		ALTER TABLE player_state ADD COLUMN output TEXT NOT NULL DEFAULT 'browser';
		ALTER TABLE player_state ADD COLUMN output_id TEXT;
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

// A few well-known public internet-radio streams so /radio isn't empty on day one.
const DEFAULT_STATIONS: [name: string, url: string, genre: string][] = [
	['SomaFM — Groove Salad', 'https://ice1.somafm.com/groovesalad-128-mp3', 'Ambient / Downtempo'],
	['SomaFM — Drone Zone', 'https://ice1.somafm.com/dronezone-128-mp3', 'Ambient'],
	['SomaFM — Indie Pop Rocks', 'https://ice1.somafm.com/indiepop-128-mp3', 'Indie'],
	['SomaFM — Lush', 'https://ice1.somafm.com/lush-128-mp3', 'Vocal / Chill'],
	['WFMU', 'https://stream0.wfmu.org/freeform-128k', 'Freeform']
];

function seedRadio(handle: DatabaseSync): void {
	const n = handle.prepare('SELECT COUNT(*) AS c FROM radio_stations').get() as { c: number };
	if (Number(n.c) > 0) return;
	const ins = handle.prepare('INSERT INTO radio_stations (name, url, genre, added_at) VALUES (?, ?, ?, ?)');
	const now = new Date().toISOString();
	for (const [name, url, genre] of DEFAULT_STATIONS) ins.run(name, url, genre, now);
}

// Declared last so migrations/seed run before init() at module load. Cached on
// globalThis to survive HMR reloads in dev.
const globalForDb = globalThis as unknown as { __timbreDb?: DatabaseSync };

export const db: DatabaseSync = globalForDb.__timbreDb ?? (globalForDb.__timbreDb = init());
