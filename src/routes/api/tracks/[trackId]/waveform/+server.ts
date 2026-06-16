import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

export const GET: RequestHandler = ({ params }) => {
	const id = Number(params.trackId);
	const row = Number.isFinite(id)
		? (db.prepare('SELECT peaks_blob FROM tracks WHERE id = ?').get(id) as
				| { peaks_blob: Uint8Array | null }
				| undefined)
		: undefined;
	const blob = row?.peaks_blob;
	if (!blob) return json({ peaks: [] });
	// stored 0..255 → normalized 0..1 for drawing
	const peaks = Array.from(blob, (v) => v / 255);
	return json({ peaks });
};
