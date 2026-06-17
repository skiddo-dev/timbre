// Import an iTunes / Music "Library.xml" — the local, no-DRM way to bring an Apple
// Music library into Timbre. We match the XML's tracks to files Timbre has ALREADY
// scanned (by path), then pull over the things tags don't carry: star ratings, play
// counts, and playlists. Apple Music *subscription* downloads are DRM'd and have no
// usable local file, so they simply don't match and are reported as skipped.
//
// Export the XML from Music: Settings → Advanced → "Share Library XML with other
// applications" (writes e.g. ~/Music/Music/Library.xml or ~/Music/iTunes/iTunes Music Library.xml).
import { readFileSync } from 'node:fs';
import { db } from './db';
import { parsePlist } from './plist';

export interface ImportResult {
	matched: number;
	ratings: number;
	playCounts: number;
	playlists: number;
	unmatched: number;
	error: string | null;
}

const empty = (): ImportResult => ({ matched: 0, ratings: 0, playCounts: 0, playlists: 0, unmatched: 0, error: null });

/** "file:///Users/me/My%20Music/x.m4a" → "/Users/me/My Music/x.m4a" */
function urlToPath(loc: string): string {
	const stripped = loc.replace(/^file:\/\/(localhost)?/i, '');
	try {
		return decodeURIComponent(stripped);
	} catch {
		return stripped;
	}
}
const norm = (p: string) => p.normalize('NFC');

export function importLibraryXml(pathOrXml: string, isPath = true): ImportResult {
	const res = empty();
	let xml: string;
	try {
		xml = isPath ? readFileSync(pathOrXml, 'utf8') : pathOrXml;
	} catch {
		res.error = 'could not read the library XML file';
		return res;
	}

	let root: Record<string, unknown>;
	try {
		root = parsePlist(xml);
	} catch (e) {
		res.error = `could not parse the XML (${e instanceof Error ? e.message : 'bad plist'})`;
		return res;
	}

	const tracks = (root.Tracks as Record<string, Record<string, unknown>>) ?? {};
	const playlists = (root.Playlists as Record<string, unknown>[]) ?? [];

	// path → Timbre track id, for matching the XML's "Location" against scanned files
	const byPath = new Map<string, number>();
	for (const r of db.prepare('SELECT id, path FROM tracks').all() as { id: number; path: string }[]) {
		byPath.set(norm(r.path), r.id);
	}

	const xmlToTimbre = new Map<number, number>(); // XML "Track ID" → Timbre id
	const updTrack = db.prepare('UPDATE tracks SET play_count = MAX(play_count, ?), rating = ? WHERE id = ?');

	db.exec('BEGIN');
	try {
		for (const key of Object.keys(tracks)) {
			const t = tracks[key];
			const loc = typeof t.Location === 'string' ? t.Location : '';
			if (!loc.startsWith('file:')) continue; // cloud / DRM / no local file
			const tid = byPath.get(norm(urlToPath(loc)));
			if (tid == null) {
				res.unmatched++;
				continue;
			}
			const xmlId = Number(t['Track ID']);
			if (Number.isFinite(xmlId)) xmlToTimbre.set(xmlId, tid);
			res.matched++;
			const rating = t.Rating != null ? Math.round(Number(t.Rating) / 20) : null;
			const playCount = t['Play Count'] != null ? Number(t['Play Count']) : 0;
			updTrack.run(playCount, rating, tid);
			if (rating != null && rating > 0) res.ratings++;
			if (playCount > 0) res.playCounts++;
		}

		res.playlists = importPlaylists(playlists, xmlToTimbre);
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		res.error = e instanceof Error ? e.message : String(e);
	}
	return res;
}

function importPlaylists(playlists: Record<string, unknown>[], xmlToTimbre: Map<number, number>): number {
	const getPl = db.prepare('SELECT id FROM playlists WHERE persistent_id = ?');
	const insPl = db.prepare('INSERT INTO playlists (name, persistent_id, source, created_at) VALUES (?, ?, ?, ?)');
	const updPl = db.prepare('UPDATE playlists SET name = ? WHERE id = ?');
	const clearItems = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?');
	const insItem = db.prepare('INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?, ?, ?)');
	const now = new Date().toISOString();
	let count = 0;

	for (const pl of playlists) {
		// skip the master library, built-in "smart"/distinguished lists, and folders
		if (pl.Master || pl['Distinguished Kind'] != null || pl.Folder) continue;
		const items = pl['Playlist Items'] as Record<string, unknown>[] | undefined;
		if (!Array.isArray(items)) continue;
		const trackIds: number[] = [];
		for (const it of items) {
			const tid = xmlToTimbre.get(Number(it['Track ID']));
			if (tid != null) trackIds.push(tid);
		}
		if (trackIds.length === 0) continue;

		const name = String(pl.Name ?? 'Playlist');
		const pid = String(pl['Playlist Persistent ID'] ?? `${name}-${count}`);
		const existing = getPl.get(pid) as { id: number } | undefined;
		const plId = existing ? existing.id : Number(insPl.run(name, pid, 'applemusic', now).lastInsertRowid);
		if (existing) updPl.run(name, plId);
		clearItems.run(plId);
		trackIds.forEach((tid, i) => insItem.run(plId, i, tid));
		count++;
	}
	return count;
}
