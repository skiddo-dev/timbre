import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchIndexers } from '$lib/server/usenet/indexer';

// GET /api/usenet/search?q=… — fan a query across every enabled Newznab indexer.
export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') || '').trim();
	if (!q) return json({ results: [] });
	try {
		return json({ results: await searchIndexers(q) });
	} catch (e) {
		return json({ results: [], error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
};
