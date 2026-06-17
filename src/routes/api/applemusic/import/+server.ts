import { json } from '@sveltejs/kit';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from './$types';
import { importLibraryXml } from '$lib/server/applemusic';

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as { path?: string };
	let path = (b.path ?? '').trim();
	if (!path) return json({ error: 'a path to the library XML is required' }, { status: 400 });
	if (path.startsWith('~')) path = join(homedir(), path.slice(1));
	return json(importLibraryXml(path));
};
