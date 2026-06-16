import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getQueue, setQueue } from '$lib/server/playback';

export const GET: RequestHandler = () => json({ tracks: getQueue() });

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { trackIds?: unknown };
	const ids = Array.isArray(body.trackIds)
		? body.trackIds.map(Number).filter((n) => Number.isFinite(n))
		: [];
	setQueue(ids);
	return json({ ok: true, count: ids.length });
};
