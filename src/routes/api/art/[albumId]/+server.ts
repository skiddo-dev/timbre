import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { serveImage } from '$lib/server/files';

export const GET: RequestHandler = ({ params }) => {
	const id = Number(params.albumId);
	const row = Number.isFinite(id)
		? (db.prepare('SELECT art_path FROM albums WHERE id = ?').get(id) as
				| { art_path: string | null }
				| undefined)
		: undefined;
	return serveImage(row?.art_path);
};
