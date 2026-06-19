import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { getTrackPath } from '$lib/server/repo';
import { getDspProfile, activeIrPath } from '$lib/server/dsp';
import { ffmpegDspArgs } from '$lib/dsp';

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

// Codecs browsers usually can't play natively → transcode on the fly when possible.
const EXOTIC = new Set(['.wma', '.ape', '.dsf', '.dff', '.wv', '.mpc', '.aiff', '.aif']);

const FFMPEG = () => env.FFMPEG_BIN || 'ffmpeg';
let ffmpegOk: boolean | null = null;
function hasFfmpeg(): Promise<boolean> {
	if (ffmpegOk !== null) return Promise.resolve(ffmpegOk);
	return new Promise((res) => {
		try {
			const p = spawn(FFMPEG(), ['-version'], { stdio: 'ignore' });
			p.on('error', () => res((ffmpegOk = false)));
			p.on('close', (c) => res((ffmpegOk = c === 0)));
		} catch {
			res((ffmpegOk = false));
		}
	});
}

export const GET: RequestHandler = async ({ params, request, url }) => {
	const id = Number(params.trackId);
	const path = Number.isFinite(id) ? getTrackPath(id) : null;
	if (!path) throw error(404, 'track not found');

	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		throw error(404, 'file missing'); // indexed but deleted on disk
	}

	const ext = extname(path).toLowerCase();
	const wantTranscode = url.searchParams.get('transcode') === '1' || EXOTIC.has(ext);

	// Transcode path: pipe through ffmpeg → MP3. No Range (it's a live re-encode),
	// so the browser buffers forward. Falls through to a raw serve if ffmpeg is absent.
	if (wantTranscode && (await hasFfmpeg())) {
		// Apply the shared DSP profile (EQ + optional room-correction IR) so transcoded
		// playback — including AirPlay, which streams via this path — honours it too.
		const { extraInputs, filterArgs } = ffmpegDspArgs(getDspProfile(), activeIrPath());
		const proc = spawn(
			FFMPEG(),
			['-v', 'quiet', '-i', path, ...extraInputs, ...filterArgs, '-f', 'mp3', '-b:a', '256k', '-'],
			{ stdio: ['ignore', 'pipe', 'ignore'] }
		);
		request.signal?.addEventListener('abort', () => {
			try {
				proc.kill('SIGKILL');
			} catch {
				/* gone */
			}
		});
		return new Response(Readable.toWeb(proc.stdout) as ReadableStream, {
			status: 200,
			headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' }
		});
	}

	const type = MIME[ext] || 'application/octet-stream';
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
