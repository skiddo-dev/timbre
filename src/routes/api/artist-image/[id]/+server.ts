import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { serveImage } from '$lib/server/files';

export const GET: RequestHandler = ({ params }) => {
	const id = Number(params.id);
	const row = Number.isFinite(id)
		? (db.prepare('SELECT image_path FROM artists WHERE id = ?').get(id) as
				| { image_path: string | null }
				| undefined)
		: undefined;
	return serveImage(row?.image_path);
};
