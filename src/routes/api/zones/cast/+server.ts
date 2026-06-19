import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCastStatus, stopCast, skipCast } from '$lib/server/streamer';
import { castLocalTrackIds } from '$lib/server/transport';

export const GET: RequestHandler = () => json(getCastStatus());

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as {
		action?: string;
		trackIds?: number[];
		startIndex?: number;
	};
	switch (b.action) {
		case 'start':
			// /zones quick-cast: cast local library tracks (non-local ids are skipped).
			castLocalTrackIds((b.trackIds ?? []).map(Number), Number(b.startIndex) || 0);
			return json(getCastStatus());
		case 'stop':
			return json(stopCast());
		case 'next':
			return json(skipCast(1));
		case 'prev':
			return json(skipCast(-1));
		default:
			return json({ error: 'unknown action' }, { status: 400 });
	}
};
