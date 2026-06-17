import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { airplayStatus, scanDevices, castToDevice, castTrack, stopAirplay } from '$lib/server/airplay';

export const GET: RequestHandler = async ({ url }) => {
	const status = airplayStatus();
	if (url.searchParams.get('scan') === '1') return json({ ...status, devices: await scanDevices() });
	return json(status);
};

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as {
		action?: string;
		deviceId?: string;
		trackId?: number;
		url?: string;
	};
	if (b.action === 'stop') {
		stopAirplay();
		return json(airplayStatus());
	}
	if (b.action === 'cast' && b.deviceId) {
		const ok = b.url
			? castToDevice(b.deviceId, b.url)
			: Number.isFinite(b.trackId)
				? castTrack(b.deviceId, Number(b.trackId))
				: false;
		return json({ ...airplayStatus(), ok });
	}
	return json({ error: 'unknown action' }, { status: 400 });
};
