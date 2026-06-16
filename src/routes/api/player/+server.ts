import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlayerState, setPlayerState } from '$lib/server/playback';
import type { PlayerState } from '$lib/types';

export const GET: RequestHandler = () => json(getPlayerState());

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Partial<PlayerState>;
	setPlayerState(body);
	return json(getPlayerState());
};
