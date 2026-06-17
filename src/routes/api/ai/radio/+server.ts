import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildRadio } from '$lib/server/discover';

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as {
		trackId?: number;
		albumId?: number;
		artistId?: number;
		count?: number;
	};
	const seed = {
		trackId: Number.isFinite(b.trackId) ? Number(b.trackId) : undefined,
		albumId: Number.isFinite(b.albumId) ? Number(b.albumId) : undefined,
		artistId: Number.isFinite(b.artistId) ? Number(b.artistId) : undefined
	};
	const count = Math.min(50, Math.max(5, Number(b.count) || 20));
	const tracks = await buildRadio(seed, count);
	return json({ tracks });
};
