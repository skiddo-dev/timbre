import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listStations, addStation, removeStation } from '$lib/server/radio';

export const GET: RequestHandler = () => json({ stations: listStations() });

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as { name?: string; url?: string; genre?: string };
	const name = (b.name ?? '').trim();
	const url = (b.url ?? '').trim();
	if (!name || !/^https?:\/\//i.test(url)) {
		return json({ error: 'name and an http(s) url are required' }, { status: 400 });
	}
	addStation(name, url, b.genre ?? null);
	return json({ stations: listStations() });
};

export const DELETE: RequestHandler = ({ url }) => {
	const id = Number(url.searchParams.get('id'));
	if (Number.isFinite(id)) removeStation(id);
	return json({ stations: listStations() });
};
