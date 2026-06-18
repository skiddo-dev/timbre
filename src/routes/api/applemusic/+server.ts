// Apple Music subscription control: status (GET) + the connect flow, library sync
// and catalog enrichment (POST). The developer token is minted server-side and
// handed to MusicKit JS in the browser to obtain a Music User Token, which is then
// stored here — no Apple password ever touches Timbre.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	appleMusicStatus,
	appleMusicConfigured,
	developerToken,
	setUserToken,
	disconnect
} from '$lib/server/applemusicApi';
import { syncLibrary, enrichAlbumFromApple, enrichAllFromApple } from '$lib/server/applemusicSync';

export const GET: RequestHandler = () => json(appleMusicStatus());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		action?: string;
		userToken?: string;
		storefront?: string;
		albumId?: number;
		limit?: number;
	};

	switch (body.action) {
		case 'devtoken': {
			// Hand MusicKit JS the developer token it needs to start authorization.
			if (!appleMusicConfigured()) throw error(400, 'Apple Music is not configured.');
			const token = developerToken();
			if (!token) throw error(502, 'Could not mint an Apple Music developer token — check your key.');
			return json({ token });
		}
		case 'session': {
			// Store the Music User Token returned by MusicKit JS after the user signed in.
			if (typeof body.userToken !== 'string' || !body.userToken) throw error(400, 'Missing user token.');
			setUserToken(body.userToken, body.storefront);
			return json(appleMusicStatus());
		}
		case 'disconnect':
			disconnect();
			return json(appleMusicStatus());
		case 'sync': {
			const res = await syncLibrary();
			if (res.error) throw error(400, res.error);
			return json({ ...res, status: appleMusicStatus() });
		}
		case 'enrich': {
			if (typeof body.albumId !== 'number') throw error(400, 'Missing albumId.');
			return json(await enrichAlbumFromApple(body.albumId));
		}
		case 'enrich-all':
			return json(await enrichAllFromApple(body.limit ?? 0));
		default:
			throw error(400, 'Unknown action.');
	}
};
