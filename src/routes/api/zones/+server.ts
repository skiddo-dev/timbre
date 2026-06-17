import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getZones,
	setClientVolume,
	setClientName,
	setClientLatency,
	setGroupStream,
	setGroupMute,
	setGroupClients
} from '$lib/server/snapcast';

export const GET: RequestHandler = async () => json(await getZones());

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const action = String(b.action ?? '');
	try {
		switch (action) {
			case 'clientVolume':
				await setClientVolume(String(b.clientId), Number(b.percent), !!b.muted);
				break;
			case 'clientName':
				await setClientName(String(b.clientId), String(b.name));
				break;
			case 'clientLatency':
				await setClientLatency(String(b.clientId), Number(b.latency));
				break;
			case 'groupStream':
				await setGroupStream(String(b.groupId), String(b.streamId));
				break;
			case 'groupMute':
				await setGroupMute(String(b.groupId), !!b.mute);
				break;
			case 'groupClients':
				await setGroupClients(String(b.groupId), (b.clientIds as string[]) ?? []);
				break;
			default:
				return json({ error: `unknown action: ${action}` }, { status: 400 });
		}
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
	}
	// return fresh status so the UI reflects the change
	return json(await getZones());
};
