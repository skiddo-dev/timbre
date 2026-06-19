// Subsonic provider control + live browse. GET returns status, or (with ?op=)
// browses / drills into / searches the remote library — already mapped to the
// app's Track/SubsonicAlbum shapes so the client just renders + enqueues. POST
// configures or disconnects the one server. Credentials live server-side only.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	subsonicStatus,
	subsonicConfigured,
	setServer,
	clearServer,
	ping,
	browseAlbums,
	albumWithTracks,
	search,
	type AlbumListType
} from '$lib/server/subsonic';

const ALBUM_TYPES: AlbumListType[] = ['newest', 'recent', 'frequent', 'random', 'alphabeticalByName', 'starred'];

export const GET: RequestHandler = async ({ url }) => {
	const op = url.searchParams.get('op');
	if (!op) return json(subsonicStatus());
	if (!subsonicConfigured()) throw error(400, 'Subsonic is not configured.');
	try {
		switch (op) {
			case 'albums': {
				const t = url.searchParams.get('type') as AlbumListType;
				const type = ALBUM_TYPES.includes(t) ? t : 'newest';
				const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size')) || 24));
				const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
				return json({ albums: await browseAlbums(type, size, offset) });
			}
			case 'album': {
				const id = url.searchParams.get('id');
				if (!id) throw error(400, 'Missing album id.');
				return json(await albumWithTracks(id));
			}
			case 'search':
				return json(await search(url.searchParams.get('q') ?? ''));
			default:
				throw error(400, `Unknown op: ${op}`);
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // re-throw SvelteKit errors
		throw error(502, e instanceof Error ? e.message : String(e));
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as {
		action?: string;
		url?: string;
		user?: string;
		pass?: string;
	};
	switch (b.action) {
		case 'configure': {
			const u = (b.url ?? '').trim();
			const user = (b.user ?? '').trim();
			if (!/^https?:\/\//i.test(u) || !user) {
				throw error(400, 'An http(s) server URL and a username are required.');
			}
			setServer(u, user, b.pass ?? '');
			const p = await ping();
			return json(subsonicStatus({ reachable: p.ok, error: p.error }));
		}
		case 'disconnect':
			clearServer();
			return json(subsonicStatus());
		case 'test': {
			const p = await ping();
			return json(subsonicStatus({ reachable: p.ok, error: p.error }));
		}
		default:
			throw error(400, 'Unknown action.');
	}
};
