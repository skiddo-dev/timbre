import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTagStatus, runTagScan, startTagScan } from '$lib/server/discover';

export const GET: RequestHandler = () => json(getTagStatus());

export const POST: RequestHandler = async ({ url }) => {
	const limit = Number(url.searchParams.get('limit')) || 0;
	if (url.searchParams.get('wait') === '1') return json(await runTagScan(limit));
	return json(startTagScan(limit));
};
