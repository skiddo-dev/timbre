// The single control surface for the unified transport. GET reports where audio is
// playing + an estimated position; POST switches the output target or drives
// play/pause/next/prev/seek on whichever output is active. The browser dock uses
// this; the per-output mechanics live in $lib/server/transport.ts.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTransport, setOutput, transportCmd } from '$lib/server/transport';
import type { OutputTarget, Playable } from '$lib/types';

export const GET: RequestHandler = () => json(getTransport());

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as {
		action?: string;
		target?: OutputTarget;
		id?: string | null;
		playables?: Playable[];
		index?: number;
		positionMs?: number;
		ms?: number;
	};
	switch (b.action) {
		case 'setOutput': {
			const target = b.target ?? 'browser';
			if (!['browser', 'snapcast', 'airplay'].includes(target)) throw error(400, 'unknown output target');
			return json(setOutput(target, b.id ?? null, b.playables ?? [], Number(b.index) || 0, Number(b.positionMs) || 0));
		}
		case 'play':
		case 'pause':
		case 'next':
		case 'prev':
			return json(transportCmd(b.action));
		case 'seek':
			return json(transportCmd('seek', { ms: Number(b.ms) || 0 }));
		case 'index':
			return json(transportCmd('index', { index: Number(b.index) || 0 }));
		default:
			throw error(400, 'unknown action');
	}
};
