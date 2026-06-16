import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLoudnessStatus, runLoudnessScan, startLoudnessScan } from '$lib/server/loudness';

export const GET: RequestHandler = () => json(getLoudnessStatus());

export const POST: RequestHandler = async ({ url }) => {
	const limit = Number(url.searchParams.get('limit')) || 0;
	if (url.searchParams.get('wait') === '1') return json(await runLoudnessScan(limit));
	return json(startLoudnessScan(limit));
};
