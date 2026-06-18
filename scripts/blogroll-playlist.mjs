// Build/refresh a PLAYABLE "Crate Diggers' Blogroll (Downloaded)" playlist from
// every local track that landed under MUSIC_DIR/_blogroll (i.e. what the downloader
// fetched + the scanner indexed). Run after scanning. Idempotent.
//
//   node scripts/blogroll-playlist.mjs
import { DatabaseSync } from 'node:sqlite';

const NAME = "Crate Diggers' Blogroll (Downloaded)";
const PID = 'blogroll:downloaded';
const db = new DatabaseSync(process.env.DATABASE_PATH || 'data/timbre.db');

const tracks = db
	.prepare("SELECT id FROM tracks WHERE source = 'local' AND path LIKE '%/_blogroll/%' ORDER BY path")
	.all();

if (tracks.length === 0) {
	console.log('No downloaded blogroll tracks indexed yet — run a scan first.');
	process.exit(0);
}

const now = new Date().toISOString();
db.exec('BEGIN');
try {
	db.prepare('DELETE FROM playlists WHERE persistent_id = ?').run(PID); // cascades playlist_tracks
	const pid = Number(
		db.prepare('INSERT INTO playlists (name, persistent_id, source, created_at) VALUES (?, ?, ?, ?)')
			.run(NAME, PID, 'blogroll', now).lastInsertRowid
	);
	const ins = db.prepare('INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)');
	tracks.forEach((t, i) => ins.run(pid, i, Number(t.id)));
	db.exec('COMMIT');
	console.log(`✓ playlist "${NAME}" (#${pid}) — ${tracks.length} playable tracks`);
} catch (e) {
	db.exec('ROLLBACK');
	console.error('✗', e);
	process.exitCode = 1;
}
db.close();
