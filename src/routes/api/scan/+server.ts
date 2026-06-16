import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getScanStatus, scanNow, startScan } from '$lib/server/scan';

export const GET: RequestHandler = () => json(getScanStatus());

export const POST: RequestHandler = async ({ url }) => {
	// ?wait=1 runs the scan to completion before responding (used by tests).
	if (url.searchParams.get('wait') === '1') return json(await scanNow());
	return json(startScan());
};
