// Room-correction impulse-response files. GET serves a WAV (the browser decodes it
// into a ConvolverNode; ?name= picks one, default = the active profile's IR). POST
// uploads a WAV as a raw binary body (?name=foo.wav) and returns the saved name.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readIr, saveIr, activeIrPath, listIrs } from '$lib/server/dsp';
import { readFileSync } from 'node:fs';

export const GET: RequestHandler = ({ url }) => {
	const name = url.searchParams.get('name');
	let bytes: Buffer | null = null;
	if (name) bytes = readIr(name);
	else {
		const p = activeIrPath();
		bytes = p ? readFileSync(p) : null;
	}
	if (!bytes) throw error(404, 'no impulse response');
	return new Response(new Uint8Array(bytes), {
		status: 200,
		headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=60' }
	});
};

export const POST: RequestHandler = async ({ request, url }) => {
	const name = url.searchParams.get('name') || 'room.wav';
	const buf = Buffer.from(await request.arrayBuffer());
	if (buf.length === 0) throw error(400, 'empty upload');
	if (buf.length > 16 * 1024 * 1024) throw error(413, 'impulse response too large (max 16 MB)');
	const saved = saveIr(name, buf);
	return json({ name: saved, irs: listIrs() });
};
