import type { PageServerLoad } from './$types';
import { search } from '$lib/server/search';

export const load: PageServerLoad = ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	return { q, results: q ? search(q, 24) : { artists: [], albums: [], tracks: [] } };
};
