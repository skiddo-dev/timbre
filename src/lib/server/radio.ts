// Internet-radio source — the first non-local source over the albums.source seam.
// Stations are just (name, url, genre); the browser plays the URL directly, so
// there's no server-side streaming to manage. Adding Tidal/Qobuz/Subsonic later
// is "write another provider that yields playable Tracks" — same shape as this.
import { db } from './db';
import type { RadioStation } from '$lib/types';

type Row = Record<string, unknown>;
const map = (r: Row): RadioStation => ({
	id: Number(r.id),
	name: String(r.name),
	url: String(r.url),
	genre: r.genre == null ? null : String(r.genre),
	favicon: r.favicon == null ? null : String(r.favicon)
});

export function listStations(): RadioStation[] {
	return (
		db.prepare('SELECT id, name, url, genre, favicon FROM radio_stations ORDER BY name COLLATE NOCASE').all() as Row[]
	).map(map);
}

export function addStation(name: string, url: string, genre: string | null): number {
	const info = db
		.prepare('INSERT INTO radio_stations (name, url, genre, added_at) VALUES (?, ?, ?, ?)')
		.run(name.trim(), url.trim(), genre?.trim() || null, new Date().toISOString());
	return Number(info.lastInsertRowid);
}

export function removeStation(id: number): void {
	db.prepare('DELETE FROM radio_stations WHERE id = ?').run(id);
}
