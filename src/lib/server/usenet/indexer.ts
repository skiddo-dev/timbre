// Newznab indexer client — Usenet's "search". Indexers are user-added (from Settings,
// like radio stations): each is a Newznab-compatible API base + an api key. We query
// `t=search` in the music category and hand-parse the RSS items into grabbable
// results (plist/nzb style — no XML dependency). Each result carries the NZB get-link
// the downloader fetches (NNTP engine) or passes to SABnzbd.
import { db } from '../db';
import { unescapeXml } from './nzb';
import type { UsenetIndexer, UsenetResult } from '$lib/types';

const NEWZNAB_AUDIO_CAT = 3000; // Newznab category for "Audio"

type Row = Record<string, unknown>;

function mapIndexer(r: Row): UsenetIndexer {
	return {
		id: Number(r.id),
		name: String(r.name),
		url: String(r.url),
		hasKey: String(r.api_key ?? '').length > 0,
		enabled: Number(r.enabled) === 1
	};
}

export function listIndexers(): UsenetIndexer[] {
	return (
		db
			.prepare('SELECT id, name, url, api_key, enabled FROM usenet_indexers ORDER BY name COLLATE NOCASE')
			.all() as Row[]
	).map(mapIndexer);
}

export function enabledIndexers(): UsenetIndexer[] {
	return listIndexers().filter((i) => i.enabled);
}

export function indexerCount(): number {
	return enabledIndexers().length;
}

export function addIndexer(name: string, url: string, apiKey: string): number {
	const info = db
		.prepare('INSERT INTO usenet_indexers (name, url, api_key, enabled, added_at) VALUES (?, ?, ?, 1, ?)')
		.run(name.trim(), url.trim().replace(/\/+$/, ''), apiKey.trim(), new Date().toISOString());
	return Number(info.lastInsertRowid);
}

export function removeIndexer(id: number): void {
	db.prepare('DELETE FROM usenet_indexers WHERE id = ?').run(id);
}

export function setIndexerEnabled(id: number, enabled: boolean): void {
	db.prepare('UPDATE usenet_indexers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

interface IndexerRow {
	id: number;
	name: string;
	url: string;
	apiKey: string;
}
function fullIndexer(id: number): IndexerRow | null {
	const r = db.prepare('SELECT id, name, url, api_key FROM usenet_indexers WHERE id = ?').get(id) as
		| Row
		| undefined;
	return r
		? { id: Number(r.id), name: String(r.name), url: String(r.url), apiKey: String(r.api_key ?? '') }
		: null;
}

/** Fan a query out across every enabled indexer; merge, rank, and cap the results. */
export async function searchIndexers(query: string, limit = 60): Promise<UsenetResult[]> {
	const q = query.trim();
	if (!q) return [];
	const indexers = enabledIndexers();
	const results: UsenetResult[] = [];
	await Promise.all(
		indexers.map(async (ix) => {
			try {
				results.push(...(await searchOne(ix.id, q)));
			} catch {
				/* one flaky indexer shouldn't sink the whole search */
			}
		})
	);
	results.sort((a, b) => (b.grabs ?? 0) - (a.grabs ?? 0) || b.sizeBytes - a.sizeBytes);
	return results.slice(0, limit);
}

async function searchOne(indexerId: number, query: string): Promise<UsenetResult[]> {
	const ix = fullIndexer(indexerId);
	if (!ix) return [];
	const u = new URL(ix.url.replace(/\/+$/, '') + '/api');
	u.searchParams.set('t', 'search');
	u.searchParams.set('q', query);
	u.searchParams.set('cat', String(NEWZNAB_AUDIO_CAT));
	u.searchParams.set('extended', '1');
	if (ix.apiKey) u.searchParams.set('apikey', ix.apiKey);

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 15_000);
	let xml: string;
	try {
		const res = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'Timbre' } });
		if (!res.ok) throw new Error(`indexer ${res.status}`);
		xml = await res.text();
	} finally {
		clearTimeout(timer);
	}
	return parseNewznab(xml, ix);
}

function tagText(xml: string, tag: string): string | null {
	const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
	if (!m) return null;
	return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function attrFromTag(xml: string, tag: string, attr: string): string | null {
	const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i'));
	return m ? m[1] : null;
}

function newznabAttr(item: string, name: string): string | null {
	const m = item.match(
		new RegExp(`<newznab:attr\\b[^>]*\\bname="${name}"[^>]*\\bvalue="([^"]*)"`, 'i')
	);
	return m ? m[1] : null;
}

function parseNewznab(xml: string, ix: IndexerRow): UsenetResult[] {
	const out: UsenetResult[] = [];
	const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
	let m: RegExpExecArray | null;
	while ((m = itemRe.exec(xml))) {
		const item = m[1];
		const title = unescapeXml(tagText(item, 'title') || '');
		if (!title) continue;
		const guid = unescapeXml(tagText(item, 'guid') || title);
		// The NZB get-link: prefer <enclosure url>, fall back to <link>.
		const enclosureUrl = attrFromTag(item, 'enclosure', 'url');
		const link = tagText(item, 'link');
		const nzbUrl = unescapeXml(enclosureUrl || link || '');
		if (!nzbUrl) continue;
		const enclosureLen = Number(attrFromTag(item, 'enclosure', 'length') || 0);
		const sizeAttr = Number(newznabAttr(item, 'size') || 0);
		const grabsAttr = newznabAttr(item, 'grabs');
		const pubDate = tagText(item, 'pubDate');
		out.push({
			guid,
			title,
			indexerId: ix.id,
			indexerName: ix.name,
			nzbUrl,
			sizeBytes: sizeAttr || enclosureLen,
			category: 'music',
			pubDate: pubDate || null,
			grabs: grabsAttr != null ? Number(grabsAttr) : null
		});
	}
	return out;
}
