import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { askLibrary } from '$lib/server/discover';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	return json(await askLibrary(q));
};
