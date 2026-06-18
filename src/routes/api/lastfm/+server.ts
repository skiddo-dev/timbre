// Last.fm connection control: status (GET) + the desktop auth flow and
// disconnect (POST). Credentials live in env; the per-user session key is stored
// server-side, so nothing sensitive crosses to the browser.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	lastfmStatus,
	getAuthToken,
	authUrl,
	completeAuth,
	disconnect,
	flushScrobbles
} from '$lib/server/lastfm';

export const GET: RequestHandler = () => json(lastfmStatus());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { action?: string; token?: string };

	switch (body.action) {
		case 'connect': {
			// Step 1: hand the client a token + the page to authorize it on.
			const token = await getAuthToken();
			if (!token) throw error(502, 'Could not reach Last.fm to start authorization.');
			return json({ token, url: authUrl(token) });
		}
		case 'session': {
			// Step 2: exchange an authorized token for a session, then drain any queue.
			if (typeof body.token !== 'string' || !body.token) throw error(400, 'Missing token.');
			const res = await completeAuth(body.token);
			if ('error' in res) throw error(400, res.error);
			await flushScrobbles();
			return json(lastfmStatus());
		}
		case 'disconnect':
			disconnect();
			return json(lastfmStatus());
		default:
			throw error(400, 'Unknown action.');
	}
};
