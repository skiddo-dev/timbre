// DSP profile control. GET returns the active profile + presets + IR files; PUT
// saves a profile (validated/clamped server-side, shared with the cast output);
// POST handles the EqualizerAPO/REW text import and IR deletion. IR upload + serve
// live in ./ir (binary bodies).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDspProfile, setDspProfile, listIrs, deleteIr } from '$lib/server/dsp';
import { PRESETS, parseEqualizerApo } from '$lib/dsp';

export const GET: RequestHandler = () =>
	json({ profile: getDspProfile(), presets: PRESETS, irs: listIrs() });

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (body == null || typeof body !== 'object') throw error(400, 'Expected a DSP profile object.');
	return json({ profile: setDspProfile(body) });
};

export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as { action?: string; text?: string; name?: string };
	switch (b.action) {
		case 'import-apo': {
			if (typeof b.text !== 'string') throw error(400, 'Missing text.');
			return json(parseEqualizerApo(b.text));
		}
		case 'delete-ir': {
			if (typeof b.name === 'string') deleteIr(b.name);
			return json({ irs: listIrs() });
		}
		default:
			throw error(400, 'Unknown action.');
	}
};
