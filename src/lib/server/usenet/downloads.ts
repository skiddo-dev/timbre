// Usenet download orchestrator + queue/history repo. enqueueDownload() records a grab
// and kicks a background job that picks an engine — SABnzbd if configured (PAR2 +
// unrar), else the built-in NNTP engine — fetches the release into MUSIC_DIR/_usenet,
// then runs a library scan so the new files show up as ordinary local tracks. All
// progress lives in the usenet_downloads table (survives HMR), so the UI just polls.
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { db } from '../db';
import { getMusicDir } from '../settings';
import { scanNow } from '../scan';
import type { UsenetDownload, UsenetEngines, UsenetStatusValue } from '$lib/types';
import { sabConfigured, sabAddUrl, sabQueueSlot, sabHistorySlot, sabDelete } from './sab';
import { nntpConfigured, downloadNzb } from './nntp';
import { parseNzb } from './nzb';
import { maybeExtract } from './extract';
import { indexerCount } from './indexer';

const USENET_SUBDIR = '_usenet';
const AUDIO_EXT = new Set([
	'.flac', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.wma'
]);
const POLL_MS = 1_500;
const MAX_POLLS = 1_200; // ~30 min ceiling for a SABnzbd job

export function usenetEngines(): UsenetEngines {
	return { sab: sabConfigured(), nntp: nntpConfigured(), indexers: indexerCount() };
}

// ── repo ─────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
function mapDownload(r: Row): UsenetDownload {
	return {
		id: Number(r.id),
		title: String(r.title),
		indexerId: r.indexer_id == null ? null : Number(r.indexer_id),
		category: String(r.category),
		sizeBytes: Number(r.size_bytes),
		engine: String(r.engine ?? ''),
		status: String(r.status) as UsenetStatusValue,
		progress: Number(r.progress),
		bytesDone: Number(r.bytes_done),
		destDir: r.dest_dir == null ? null : String(r.dest_dir),
		files: Number(r.files),
		error: r.error == null ? null : String(r.error),
		createdAt: String(r.created_at),
		updatedAt: String(r.updated_at),
		completedAt: r.completed_at == null ? null : String(r.completed_at)
	};
}

export function listDownloads(limit = 100): UsenetDownload[] {
	return (
		db.prepare('SELECT * FROM usenet_downloads ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]
	).map(mapDownload);
}

export function getDownload(id: number): UsenetDownload | null {
	const r = db.prepare('SELECT * FROM usenet_downloads WHERE id = ?').get(id) as Row | undefined;
	return r ? mapDownload(r) : null;
}

export function removeDownload(id: number): void {
	const d = getDownload(id);
	if (d?.engine === 'sab') {
		// best-effort: also pull it out of SABnzbd (fire and forget)
		const clientId = (db.prepare('SELECT client_id FROM usenet_downloads WHERE id = ?').get(id) as Row | undefined)?.client_id;
		if (typeof clientId === 'string' && clientId) void sabDelete(clientId);
	}
	db.prepare('DELETE FROM usenet_downloads WHERE id = ?').run(id);
}

export function clearFinished(): void {
	db.prepare("DELETE FROM usenet_downloads WHERE status IN ('completed', 'failed')").run();
}

// ── status mutators (all no-op if the row was removed mid-flight) ─────────────
function touch(id: number, fields: Record<string, string | number | null>): void {
	const keys = Object.keys(fields);
	if (!keys.length) return;
	const set = keys.map((k) => `${k} = ?`).join(', ');
	db.prepare(`UPDATE usenet_downloads SET ${set}, updated_at = ? WHERE id = ?`).run(
		...keys.map((k) => fields[k]),
		new Date().toISOString(),
		id
	);
}
function setStatus(id: number, status: UsenetStatusValue, extra: Record<string, string | number | null> = {}): void {
	touch(id, { status, ...extra });
}
function setProgress(id: number, progress: number, bytesDone: number): void {
	touch(id, { progress: Math.max(0, Math.min(100, Math.round(progress))), bytes_done: Math.round(bytesDone) });
}
function fail(id: number, e: unknown): void {
	setStatus(id, 'failed', { error: e instanceof Error ? e.message : String(e) });
}

// ── enqueue + run ─────────────────────────────────────────────────────────────
export interface GrabInput {
	title: string;
	nzbUrl: string;
	indexerId: number | null;
	sizeBytes: number;
	category?: string;
	engine?: 'sab' | 'nntp'; // optional override; auto-selects when omitted
}

// SABnzbd is preferred when present (it does PAR2 + unrar); the built-in NNTP engine
// is the fallback. An explicit `engine` wins, but only if that engine is configured.
function pickEngine(preferred?: 'sab' | 'nntp'): 'sab' | 'nntp' | '' {
	if (preferred === 'sab' && sabConfigured()) return 'sab';
	if (preferred === 'nntp' && nntpConfigured()) return 'nntp';
	return sabConfigured() ? 'sab' : nntpConfigured() ? 'nntp' : '';
}

export function enqueueDownload(input: GrabInput): UsenetDownload {
	const engine = pickEngine(input.engine);
	const now = new Date().toISOString();
	const info = db
		.prepare(
			`INSERT INTO usenet_downloads
			 (title, indexer_id, nzb_url, category, size_bytes, engine, status, progress, bytes_done, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 0, ?, ?)`
		)
		.run(input.title, input.indexerId, input.nzbUrl, input.category || 'music', input.sizeBytes, engine, now, now);
	const id = Number(info.lastInsertRowid);

	if (!engine) {
		fail(
			id,
			new Error(
				'No download client configured. Add a SABnzbd client (SABNZBD_URL + SABNZBD_API_KEY) or an NNTP provider (NNTP_HOST…).'
			)
		);
	} else {
		runDownload(id).catch((e) => fail(id, e));
	}
	return getDownload(id)!;
}

async function runDownload(id: number): Promise<void> {
	const d = getDownload(id);
	if (!d) return;
	const nzbUrl = getNzbUrl(id); // not exposed on the public type
	const destDir = join(getMusicDir(), USENET_SUBDIR, slug(d.title));
	mkdirSync(destDir, { recursive: true });
	setStatus(id, 'downloading', { dest_dir: destDir });
	if (d.engine === 'sab') await runViaSab(id, d, nzbUrl);
	else await runViaNntp(id, d, nzbUrl, destDir);
}

function getNzbUrl(id: number): string {
	const r = db.prepare('SELECT nzb_url FROM usenet_downloads WHERE id = ?').get(id) as Row | undefined;
	return r ? String(r.nzb_url) : '';
}

async function runViaSab(id: number, d: UsenetDownload, nzbUrl: string): Promise<void> {
	const nzoId = await sabAddUrl(nzbUrl, d.title, d.category);
	touch(id, { client_id: nzoId });
	for (let i = 0; i < MAX_POLLS; i++) {
		if (!getDownload(id)) return; // cancelled
		const slot = await sabQueueSlot(nzoId);
		if (slot) {
			setProgress(id, Math.min(99, slot.percent), slot.mb * 1e6);
		} else {
			const hist = await sabHistorySlot(nzoId);
			if (hist) {
				if (/completed/i.test(hist.status)) {
					// SABnzbd already repaired + unpacked; its complete/category folder
					// should live under MUSIC_DIR so the scan below sees the files.
					await finalize(id, hist.storage || d.destDir || '');
					return;
				}
				if (/fail/i.test(hist.status)) {
					fail(id, new Error(hist.failMessage || 'SABnzbd reported failure'));
					return;
				}
			}
		}
		await sleep(POLL_MS);
	}
	fail(id, new Error('timed out waiting for SABnzbd'));
}

async function runViaNntp(id: number, d: UsenetDownload, nzbUrl: string, destDir: string): Promise<void> {
	const xml = await fetchText(nzbUrl);
	const nzb = parseNzb(xml);
	if (!nzb.files.length) {
		fail(id, new Error('empty or invalid NZB'));
		return;
	}
	const total = nzb.totalBytes || d.sizeBytes || 1;
	let done = 0;
	await downloadNzb(nzb, destDir, (delta) => {
		if (!getDownload(id)) return; // cancelled
		done += delta;
		setProgress(id, (done / total) * 100, done);
	});
	setStatus(id, 'extracting');
	maybeExtract(destDir);
	await finalize(id, destDir);
}

// Run a library scan so the downloaded files become tracks, then mark complete.
async function finalize(id: number, dir: string): Promise<void> {
	if (!getDownload(id)) return;
	setStatus(id, 'importing', { dest_dir: dir });
	await scanNow();
	const files = countAudioFiles(dir);
	if (!getDownload(id)) return;
	touch(id, {
		status: 'completed',
		progress: 100,
		files,
		completed_at: new Date().toISOString()
	});
}

// ── helpers ────────────────────────────────────────────────────────────────────
async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Timbre' } });
		if (!res.ok) throw new Error(`nzb fetch ${res.status}`);
		return await res.text();
	} finally {
		clearTimeout(timer);
	}
}

function countAudioFiles(dir: string): number {
	let n = 0;
	let entries: { name: string; isFile: () => boolean; isDirectory: () => boolean }[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isDirectory()) n += countAudioFiles(full);
		else if (e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase())) {
			try {
				if (statSync(full).size > 0) n++;
			} catch {
				/* skip */
			}
		}
	}
	return n;
}

function slug(title: string): string {
	const s = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return s || `grab-${Date.now()}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}
