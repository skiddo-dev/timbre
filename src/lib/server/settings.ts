// Small key/value settings store so the music folder (and other prefs) can be set
// from the UI without editing .env. The DB value, when present, overrides env.
import { db } from './db';
import { env } from '$env/dynamic/private';

export function getSetting(key: string): string | null {
	const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return r ? r.value : null;
}

export function setSetting(key: string, value: string): void {
	db.prepare(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).run(key, value);
}

export function deleteSetting(key: string): void {
	db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/** Music folder: DB override wins, else MUSIC_DIR from env. */
export function getMusicDir(): string {
	return (getSetting('music_dir') || env.MUSIC_DIR || '').trim();
}
