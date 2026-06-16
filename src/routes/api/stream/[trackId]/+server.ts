import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { extname } from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTrackPath } from '$lib/server/repo';

const MIME: Record<string, string> = {
	'.flac': 'audio/flac',
	'.mp3': 'audio/mpeg',
	'.m4a': 'audio/mp4',
	'.mp4': 'audio/mp4',
	'.aac': 'audio/aac',
	'.ogg': 'audio/ogg',
	'.oga': 'audio/ogg',
	'.opus': 'audio/ogg',
	'.wav': 'audio/wav',
	'.aif': 'audio/aiff',
	'.aiff': 'audio/aiff',
	'.wma': 'audio/x-ms-wma'
};

export const GET: RequestHandler = ({ params, request }) => {
	const id = Number(params.trackId);
	const path = Number.isFinite(id) ? getTrackPath(id) : null;
	if (!path) throw error(404, 'track not found');

	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		throw error(404, 'file missing'); // indexed but deleted on disk
	}

	const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
	const baseHeaders: Record<string, string> = {
		'Content-Type': type,
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'private, max-age=3600'
	};

	const range = request.headers.get('range');
	if (range) {
		const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
		if (m) {
			let start = m[1] ? parseInt(m[1], 10) : 0;
			let end = m[2] ? parseInt(m[2], 10) : size - 1;
			if (Number.isNaN(start)) start = 0;
			if (Number.isNaN(end) || end >= size) end = size - 1;
			if (start > end || start >= size) {
				return new Response('range not satisfiable', {
					status: 416,
					headers: { 'Content-Range': `bytes */${size}` }
				});
			}
			const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
			return new Response(stream, {
				status: 206,
				headers: {
					...baseHeaders,
					'Content-Range': `bytes ${start}-${end}/${size}`,
					'Content-Length': String(end - start + 1)
				}
			});
		}
	}

	const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
	return new Response(stream, {
		status: 200,
		headers: { ...baseHeaders, 'Content-Length': String(size) }
	});
};
