// Shared helper for streaming a cached image file (cover art, artist image).
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { extname } from 'node:path';
import { error } from '@sveltejs/kit';

const IMG: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export function serveImage(path: string | null | undefined): Response {
	if (!path) throw error(404, 'not found');
	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		throw error(404, 'file missing');
	}
	const type = IMG[extname(path).toLowerCase()] || 'image/jpeg';
	return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
		headers: {
			'Content-Type': type,
			'Content-Length': String(size),
			'Cache-Control': 'public, max-age=86400'
		}
	});
}
