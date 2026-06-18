// Last.fm scrobbling — the one deliberate cloud connection in an otherwise
// local-first player, and strictly opt-in. App credentials come from the
// environment (LASTFM_API_KEY / LASTFM_API_SECRET); a per-user *session key* is
// obtained through Last.fm's desktop auth flow and stored in `settings`, so no
// password ever touches Timbre.
//
// Everything degrades silently: if Last.fm is unset, unreachable, or the network
// is down, playback is never affected — scrobbles queue in the `scrobbles` table
// and are retried on the next reconnect/scrobble. TIMBRE_FAKE_LASTFM=1 short-
// circuits all HTTP so tests run fully offline (mirrors enrich.ts / llm.ts).
import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { getSetting, setSetting, deleteSetting } from './settings';
import type { Scrobble, LastfmStatus } from '$lib/types';

const API = 'https://ws.audioscrobbler.com/2.0/';
const apiKey = () => (env.LASTFM_API_KEY ?? '').trim();
const apiSecret = () => (env.LASTFM_API_SECRET ?? '').trim();

const SK = 'lastfm_session';
const USER = 'lastfm_user';

export function lastfmFake(): boolean {
	return env.TIMBRE_FAKE_LASTFM === '1' || env.TIMBRE_FAKE_LASTFM === 'true';
}

/** App credentials present (or fake mode) → the connect flow is available. */
export function lastfmConfigured(): boolean {
	return lastfmFake() || (apiKey().length > 0 && apiSecret().length > 0);
}

function sessionKey(): string | null {
	return getSetting(SK);
}
export function lastfmUser(): string | null {
	return getSetting(USER);
}
/** Connected = configured AND we hold a session key for a user. */
export function lastfmConnected(): boolean {
	return lastfmConfigured() && !!sessionKey();
}

// ── signed API access ─────────────────────────────────────────────────────────
// Last.fm signs every authenticated call: sort params by name, concatenate
// name+value, append the shared secret, md5 (utf-8, lowercase hex). `format` and
// `api_sig` itself are excluded from the signature.
function sign(params: Record<string, string>): string {
	let s = '';
	for (const k of Object.keys(params).sort()) {
		if (k === 'format' || k === 'callback') continue;
		s += k + params[k];
	}
	return createHash('md5').update(s + apiSecret(), 'utf8').digest('hex');
}

/** Call the REST API. Returns the parsed JSON (which may itself carry an `error`),
 * or null on network failure / timeout / bad JSON so callers can tell the two apart. */
async function apiCall(
	params: Record<string, string>,
	opts: { post?: boolean } = {}
): Promise<Record<string, unknown> | null> {
	const p: Record<string, string> = { ...params, api_key: apiKey() };
	p.api_sig = sign(p);
	p.format = 'json';
	const body = new URLSearchParams(p);
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 10_000);
	try {
		const res = opts.post
			? await fetch(API, { method: 'POST', body, signal: ctrl.signal })
			: await fetch(`${API}?${body.toString()}`, { signal: ctrl.signal });
		return (await res.json().catch(() => null)) as Record<string, unknown> | null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// ── desktop auth flow ─────────────────────────────────────────────────────────
/** Step 1: request an auth token to hand to the user-authorization page. */
export async function getAuthToken(): Promise<string | null> {
	if (lastfmFake()) return 'fake-token';
	const data = await apiCall({ method: 'auth.getToken' });
	return typeof data?.token === 'string' ? data.token : null;
}

/** The page the user visits to authorize Timbre against their Last.fm account. */
export function authUrl(token: string): string {
	return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey())}&token=${encodeURIComponent(token)}`;
}

/** Step 2: once the user authorized the token, exchange it for a permanent session. */
export async function completeAuth(token: string): Promise<{ user: string } | { error: string }> {
	if (lastfmFake()) {
		setSetting(SK, 'fake-session-key');
		setSetting(USER, 'verify-user');
		return { user: 'verify-user' };
	}
	const data = await apiCall({ method: 'auth.getSession', token });
	const session = data?.session as { key?: string; name?: string } | undefined;
	if (session?.key) {
		setSetting(SK, session.key);
		setSetting(USER, session.name ?? '');
		return { user: session.name ?? '' };
	}
	const message = typeof data?.message === 'string' ? data.message : null;
	return {
		error: message || 'Authorization not completed — approve Timbre on Last.fm, then try again.'
	};
}

export function disconnect(): void {
	deleteSetting(SK);
	deleteSetting(USER);
}

// ── now playing ───────────────────────────────────────────────────────────────
export interface ScrobbleMeta {
	trackId: number | null;
	artist: string;
	title: string;
	album?: string | null;
	albumArtist?: string | null;
	durationSec?: number | null;
}

function trackParams(m: ScrobbleMeta): Record<string, string> {
	const p: Record<string, string> = { artist: m.artist, track: m.title };
	if (m.album) p.album = m.album;
	if (m.albumArtist && m.albumArtist !== m.artist) p.albumArtist = m.albumArtist;
	if (m.durationSec && m.durationSec > 0) p.duration = String(m.durationSec);
	return p;
}

/** Tell Last.fm what's playing right now (not a scrobble; expires on its own). */
export async function updateNowPlaying(m: ScrobbleMeta): Promise<boolean> {
	if (!lastfmConnected() || !m.artist || !m.title) return false;
	if (lastfmFake()) return true;
	const data = await apiCall(
		{ method: 'track.updateNowPlaying', sk: sessionKey()!, ...trackParams(m) },
		{ post: true }
	);
	return !!data && !data.error;
}

// ── scrobble queue ────────────────────────────────────────────────────────────
interface QueueRow {
	id: number;
	artist: string;
	title: string;
	album: string | null;
	albumArtist: string | null;
	durationSec: number | null;
	playedAt: number;
}

/** Record a play in the local queue (state 'pending'). Returns the new row id. */
export function enqueueScrobble(m: ScrobbleMeta, playedAt: number): number {
	const r = db
		.prepare(
			`INSERT INTO scrobbles (track_id, artist, title, album, album_artist, duration_sec, played_at, state, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
		)
		.run(
			m.trackId ?? null,
			m.artist,
			m.title,
			m.album ?? null,
			m.albumArtist ?? null,
			m.durationSec ?? null,
			playedAt,
			new Date().toISOString()
		);
	return Number(r.lastInsertRowid);
}

// Last.fm transient error codes (rate-limit / temporary / service down) → keep
// the row pending and back off; anything else is a permanent reject.
const RETRIABLE = new Set([11, 16, 29]);

async function submitOne(row: QueueRow): Promise<{ ok: boolean; error?: string; retriable: boolean }> {
	if (lastfmFake()) return { ok: true, retriable: false };
	const sk = sessionKey();
	if (!sk) return { ok: false, error: 'not connected', retriable: true };
	const data = await apiCall(
		{
			method: 'track.scrobble',
			sk,
			timestamp: String(row.playedAt),
			...trackParams({
				trackId: null,
				artist: row.artist,
				title: row.title,
				album: row.album,
				albumArtist: row.albumArtist,
				durationSec: row.durationSec
			})
		},
		{ post: true }
	);
	if (!data) return { ok: false, error: 'network error', retriable: true };
	if (data.error) {
		const code = Number(data.error);
		const message = typeof data.message === 'string' ? data.message : `error ${code}`;
		return { ok: false, error: message, retriable: RETRIABLE.has(code) };
	}
	// A 200 can still *ignore* a scrobble (e.g. too short, art-of-noise filter);
	// Last.fm reports that per-scrobble, not as a top-level error.
	const sc = (data.scrobbles as { scrobble?: Record<string, unknown> } | undefined)?.scrobble;
	const ignored = sc?.ignoredMessage as { code?: string; '#text'?: string } | undefined;
	if (ignored && Number(ignored.code ?? 0) > 0) {
		return { ok: false, error: ignored['#text'] || `ignored (${ignored.code})`, retriable: false };
	}
	return { ok: true, retriable: false };
}

/** Try to send every pending scrobble (oldest first). Backs off on the first
 * transient failure so we don't hammer Last.fm while it's rate-limiting us. */
export async function flushScrobbles(limit = 50): Promise<{ sent: number; failed: number; pending: number }> {
	let sent = 0;
	let failed = 0;
	if (lastfmConnected()) {
		const rows = db
			.prepare(
				`SELECT id, artist, title, album, album_artist AS albumArtist,
				        duration_sec AS durationSec, played_at AS playedAt
				 FROM scrobbles WHERE state = 'pending' ORDER BY played_at ASC LIMIT ?`
			)
			.all(limit) as unknown as QueueRow[];
		for (const row of rows) {
			const res = await submitOne(row);
			if (res.ok) {
				db.prepare(`UPDATE scrobbles SET state = 'sent', error = NULL WHERE id = ?`).run(row.id);
				sent++;
			} else if (res.retriable) {
				db.prepare(`UPDATE scrobbles SET error = ? WHERE id = ?`).run(res.error ?? null, row.id);
				failed++;
				break; // transient — leave the rest pending for next time
			} else {
				db.prepare(`UPDATE scrobbles SET state = 'failed', error = ? WHERE id = ?`).run(
					res.error ?? null,
					row.id
				);
				failed++;
			}
		}
	}
	return { sent, failed, pending: pendingCount() };
}

export function pendingCount(): number {
	const r = db.prepare(`SELECT COUNT(*) AS c FROM scrobbles WHERE state = 'pending'`).get() as {
		c: number;
	};
	return Number(r.c);
}

export function recentScrobbles(limit = 25): Scrobble[] {
	const rows = db
		.prepare(
			`SELECT id, artist, title, album, played_at AS playedAt, state, error
			 FROM scrobbles ORDER BY played_at DESC, id DESC LIMIT ?`
		)
		.all(limit) as Record<string, unknown>[];
	return rows.map((r) => ({
		id: Number(r.id),
		artist: String(r.artist),
		title: String(r.title),
		album: r.album == null ? null : String(r.album),
		playedAt: Number(r.playedAt),
		state: r.state as Scrobble['state'],
		error: r.error == null ? null : String(r.error)
	}));
}

export function lastfmStatus(): LastfmStatus {
	const last = db
		.prepare(`SELECT MAX(played_at) AS t FROM scrobbles WHERE state = 'sent'`)
		.get() as { t: number | null };
	return {
		configured: lastfmConfigured(),
		connected: lastfmConnected(),
		user: lastfmUser(),
		fake: lastfmFake(),
		pending: pendingCount(),
		lastScrobbleAt: last.t == null ? null : Number(last.t)
	};
}
