import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { search } from '$lib/server/search';

export const GET: RequestHandler = ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
	return json(search(q, limit));
};
