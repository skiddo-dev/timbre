import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ftsAvailable } from '$lib/server/db';
import { getMusicDir, setSetting } from '$lib/server/settings';
import { libraryStats } from '$lib/server/repo';

function payload() {
	return { musicDir: getMusicDir(), ftsAvailable, stats: libraryStats() };
}

export const GET: RequestHandler = () => json(payload());

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { musicDir?: unknown };
	if (typeof body.musicDir === 'string') setSetting('music_dir', body.musicDir.trim());
	return json(payload());
};
