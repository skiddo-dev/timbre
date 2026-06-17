import type { RequestHandler } from './$types';
import { openZoneStream } from '$lib/server/snapcast';
import type { ZoneStatus } from '$lib/types';

// Server-Sent Events feed of live zone status (replaces polling on /zones).
export const GET: RequestHandler = ({ request }) => {
	const enc = new TextEncoder();
	let stop = () => {};
	let keepAlive: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const send = (z: ZoneStatus) => {
				try {
					controller.enqueue(enc.encode(`data: ${JSON.stringify(z)}\n\n`));
				} catch {
					/* closed */
				}
			};
			stop = openZoneStream(send);
			keepAlive = setInterval(() => {
				try {
					controller.enqueue(enc.encode(': keepalive\n\n'));
				} catch {
					/* closed */
				}
			}, 25_000);
			request.signal.addEventListener('abort', () => {
				if (keepAlive) clearInterval(keepAlive);
				stop();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});
		},
		cancel() {
			if (keepAlive) clearInterval(keepAlive);
			stop();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
