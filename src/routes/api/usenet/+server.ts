import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listIndexers,
	addIndexer,
	removeIndexer,
	setIndexerEnabled
} from '$lib/server/usenet/indexer';
import {
	listDownloads,
	enqueueDownload,
	removeDownload,
	clearFinished,
	usenetEngines
} from '$lib/server/usenet/downloads';
import type { UsenetStatus } from '$lib/types';

function status(): UsenetStatus {
	return { indexers: listIndexers(), downloads: listDownloads(), engines: usenetEngines() };
}

// GET /api/usenet — indexers + grab queue/history + which engines are wired up.
export const GET: RequestHandler = () => json(status());

// POST /api/usenet — one endpoint, `action`-dispatched, returns fresh status.
export const POST: RequestHandler = async ({ request }) => {
	const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const action = String(b.action ?? '');

	switch (action) {
		case 'grab': {
			const title = String(b.title ?? '').trim();
			const nzbUrl = String(b.nzbUrl ?? '').trim();
			if (!title || !/^https?:\/\//i.test(nzbUrl)) {
				return json({ error: 'title and a valid nzbUrl are required' }, { status: 400 });
			}
			const engine = b.engine === 'sab' || b.engine === 'nntp' ? b.engine : undefined;
			enqueueDownload({
				title,
				nzbUrl,
				indexerId: b.indexerId == null ? null : Number(b.indexerId),
				sizeBytes: Number(b.sizeBytes ?? 0),
				category: b.category ? String(b.category) : undefined,
				engine
			});
			return json(status());
		}
		case 'addIndexer': {
			const name = String(b.name ?? '').trim();
			const url = String(b.url ?? '').trim();
			if (!name || !/^https?:\/\//i.test(url)) {
				return json({ error: 'name and an http(s) url are required' }, { status: 400 });
			}
			addIndexer(name, url, String(b.apiKey ?? ''));
			return json(status());
		}
		case 'removeIndexer':
			removeIndexer(Number(b.id));
			return json(status());
		case 'setIndexerEnabled':
			setIndexerEnabled(Number(b.id), !!b.enabled);
			return json(status());
		case 'cancel':
			removeDownload(Number(b.id));
			return json(status());
		case 'clear':
			clearFinished();
			return json(status());
		default:
			return json({ error: 'unknown action' }, { status: 400 });
	}
};
