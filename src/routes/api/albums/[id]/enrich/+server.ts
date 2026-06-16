import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enrichAlbum } from '$lib/server/enrich';

export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) return json({ error: 'bad id' }, { status: 400 });
	return json(await enrichAlbum(id));
};
