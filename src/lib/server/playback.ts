// Server-persisted queue + player state, so the now-playing dock survives reloads
// and (later, M6) so a Snapcast zone can resume from the same place.
import { db } from './db';
import { mapTrack } from './repo';
import type { PlayerState, Track } from '$lib/types';

type Row = Record<string, unknown>;

const TRACK_COLS = `t.id, t.album_id, t.artist, t.title, t.track_no, t.disc_no, t.duration_ms,
	t.codec, t.sample_rate, t.bit_depth, t.channels, t.bitrate, t.loudness_lufs, t.true_peak,
	t.gain_db, (t.peaks_blob IS NOT NULL) AS has_peaks, t.play_count, t.last_played_at,
	(SELECT title FROM albums WHERE id = t.album_id) AS album_title`;

export function getQueue(): Track[] {
	return (
		db
			.prepare(
				`SELECT ${TRACK_COLS} FROM queue q JOIN tracks t ON t.id = q.track_id ORDER BY q.position`
			)
			.all() as Row[]
	).map(mapTrack);
}

export function setQueue(trackIds: number[]): void {
	const clear = db.prepare('DELETE FROM queue');
	const insert = db.prepare('INSERT INTO queue (position, track_id) VALUES (?, ?)');
	const exists = db.prepare('SELECT 1 FROM tracks WHERE id = ?');
	const tx = () => {
		clear.run();
		let pos = 0;
		for (const id of trackIds) {
			if (exists.get(id)) insert.run(pos++, id);
		}
	};
	// node:sqlite has no .transaction() helper; wrap manually.
	db.exec('BEGIN');
	try {
		tx();
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

export function getPlayerState(): PlayerState {
	const r = db.prepare('SELECT * FROM player_state WHERE id = 1').get() as Row;
	return {
		currentTrackId: r?.current_track_id == null ? null : Number(r.current_track_id),
		positionMs: Number(r?.position_ms ?? 0),
		volume: Number(r?.volume ?? 1),
		shuffle: !!Number(r?.shuffle ?? 0),
		repeat: (String(r?.repeat ?? 'off') as PlayerState['repeat']) || 'off'
	};
}

export function setPlayerState(p: Partial<PlayerState>): void {
	const cur = getPlayerState();
	const next = { ...cur, ...p };
	const repeat = ['off', 'all', 'one'].includes(next.repeat) ? next.repeat : 'off';
	db.prepare(
		`UPDATE player_state
		 SET current_track_id = ?, position_ms = ?, volume = ?, shuffle = ?, repeat = ?
		 WHERE id = 1`
	).run(
		next.currentTrackId,
		Math.max(0, Math.round(next.positionMs)),
		Math.min(1, Math.max(0, next.volume)),
		next.shuffle ? 1 : 0,
		repeat
	);
}
