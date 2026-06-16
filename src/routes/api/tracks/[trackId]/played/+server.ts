import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markPlayed } from '$lib/server/repo';

export const POST: RequestHandler = ({ params }) => {
	const id = Number(params.trackId);
	if (Number.isFinite(id)) markPlayed(id);
	return json({ ok: true });
};
