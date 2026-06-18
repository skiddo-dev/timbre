// SABnzbd download client — the recommended primary engine. We hand the indexer's
// NZB url to SABnzbd (mode=addurl) and poll its queue + history until the job
// finishes; SABnzbd does the heavy lifting (NNTP fetch, PAR2 repair, unrar). Point
// SABnzbd's category/complete folder at MUSIC_DIR so finished albums land where the
// scanner can see them. NZBGet exposes a near-identical JSON API — same shape.
//
// Degrades silently: unset SABNZBD_URL/SABNZBD_API_KEY → sabConfigured() is false and
// the orchestrator falls back to the built-in NNTP engine (or reports no client).
import { env } from '$env/dynamic/private';

const BASE = () => (env.SABNZBD_URL || '').trim().replace(/\/+$/, '');
const KEY = () => (env.SABNZBD_API_KEY || '').trim();

export function sabConfigured(): boolean {
	return BASE().length > 0 && KEY().length > 0;
}

type Json = Record<string, unknown>;

async function call(params: Record<string, string>, timeoutMs = 15_000): Promise<Json> {
	const u = new URL(BASE() + '/api');
	u.searchParams.set('apikey', KEY());
	u.searchParams.set('output', 'json');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(u, { signal: ctrl.signal });
		if (!res.ok) throw new Error(`sabnzbd ${res.status}`);
		return (await res.json()) as Json;
	} finally {
		clearTimeout(timer);
	}
}

function arr(v: unknown): Json[] {
	return Array.isArray(v) ? (v as Json[]) : [];
}

/** Queue a release by its NZB url. Returns the SABnzbd nzo_id. */
export async function sabAddUrl(nzbUrl: string, name: string, category = ''): Promise<string> {
	const params: Record<string, string> = { mode: 'addurl', name: nzbUrl, nzbname: name };
	if (category) params.cat = category;
	const r = await call(params);
	if (r.status === false) throw new Error(String(r.error || 'sabnzbd rejected the nzb'));
	const ids = Array.isArray(r.nzo_ids) ? (r.nzo_ids as unknown[]) : [];
	const id = ids[0];
	if (typeof id !== 'string' || !id) throw new Error('sabnzbd returned no nzo_id');
	return id;
}

export interface SabSlot {
	id: string;
	status: string;
	percent: number;
	mb: number;
	mbLeft: number;
}

/** The queue slot for one job, or null once it has left the active queue. */
export async function sabQueueSlot(nzoId: string): Promise<SabSlot | null> {
	const r = await call({ mode: 'queue' });
	const queue = (r.queue as Json) ?? {};
	const slot = arr(queue.slots).find((s) => s.nzo_id === nzoId);
	if (!slot) return null;
	return {
		id: nzoId,
		status: String(slot.status ?? ''),
		percent: Number(slot.percentage ?? 0),
		mb: Number(slot.mb ?? 0),
		mbLeft: Number(slot.mbleft ?? 0)
	};
}

export interface SabHistory {
	id: string;
	status: string; // 'Completed' | 'Failed' | …
	storage: string; // final folder on disk
	failMessage: string;
}

/** The history slot for one job once it has finished (completed or failed). */
export async function sabHistorySlot(nzoId: string): Promise<SabHistory | null> {
	const r = await call({ mode: 'history' });
	const history = (r.history as Json) ?? {};
	const slot = arr(history.slots).find((s) => s.nzo_id === nzoId);
	if (!slot) return null;
	return {
		id: nzoId,
		status: String(slot.status ?? ''),
		storage: String(slot.storage ?? ''),
		failMessage: String(slot.fail_message ?? '')
	};
}

/** Best-effort cancel: remove from queue, else from history. */
export async function sabDelete(nzoId: string): Promise<void> {
	try {
		await call({ mode: 'queue', name: 'delete', value: nzoId, del_files: '1' });
	} catch {
		/* may already be in history */
	}
	try {
		await call({ mode: 'history', name: 'delete', value: nzoId, del_files: '1' });
	} catch {
		/* noop */
	}
}

/** Connectivity probe for the Settings panel. */
export async function sabReachable(): Promise<boolean> {
	if (!sabConfigured()) return false;
	try {
		const r = await call({ mode: 'version' }, 5_000);
		return r.version != null || r.status === true;
	} catch {
		return false;
	}
}
