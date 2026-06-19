// Subsonic / OpenSubsonic provider — the first *real* remote-library streaming
// source, the one radio.ts promised ("write another provider that yields playable
// Tracks"). Unlike Apple Music (metadata + deep-link only, DRM never enters the
// pipeline), a Subsonic server (Navidrome / Airsonic / Gonic …) is a self-hosted
// library you actually stream from — which keeps Timbre's no-cloud, no-subscription
// identity intact while finally playing remote audio through the same transport.
//
// Posture, mirroring the rest of the app:
//   • One server, configured from Settings and stored in the `settings` k/v table
//     (a self-hosted personal credential, like SABNZBD_API_KEY — never returned to
//     the browser, only `hasPassword`). A .env fallback (SUBSONIC_URL/USER/PASS) is
//     honoured too; the DB value wins, exactly like getMusicDir().
//   • Remote content stays remote — browsed live, never scanned into the local DB.
//     A song maps to a Track whose `streamUrl` points at our auth-proxy
//     (/api/subsonic/stream/<remoteId>) so the player streams it like any other
//     track and the Subsonic credentials never touch the client.
//   • Everything degrades silently; TIMBRE_FAKE_SUBSONIC=1 short-circuits all HTTP
//     with deterministic fixtures (same contract as lastfm.ts / applemusicApi.ts),
//     and verify.mjs points the real client at scripts/mock-subsonic.mjs.
import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getSetting, setSetting, deleteSetting } from './settings';
import type { Track, SubsonicStatus, SubsonicAlbum, SubsonicArtist } from '$lib/types';

const URL_KEY = 'subsonic_url';
const USER_KEY = 'subsonic_user';
const PASS_KEY = 'subsonic_pass';

const CLIENT = 'timbre';
const API_VERSION = '1.16.1';

export function subsonicFake(): boolean {
	return env.TIMBRE_FAKE_SUBSONIC === '1' || env.TIMBRE_FAKE_SUBSONIC === 'true';
}

// DB override wins, else env — the getMusicDir() convention.
const serverUrl = () => (getSetting(URL_KEY) || env.SUBSONIC_URL || '').trim().replace(/\/+$/, '');
const username = () => (getSetting(USER_KEY) || env.SUBSONIC_USER || '').trim();
const password = () => getSetting(PASS_KEY) || env.SUBSONIC_PASS || '';

export function subsonicConfigured(): boolean {
	return subsonicFake() || (serverUrl().length > 0 && username().length > 0 && password().length > 0);
}

export function subsonicStatus(extra?: { reachable?: boolean; error?: string | null }): SubsonicStatus {
	return {
		configured: subsonicConfigured(),
		hasPassword: password().length > 0,
		url: serverUrl() || (subsonicFake() ? 'fake://subsonic' : ''),
		user: username() || (subsonicFake() ? 'demo' : ''),
		fake: subsonicFake(),
		reachable: extra?.reachable,
		error: extra?.error ?? null
	};
}

export function setServer(url: string, user: string, pass: string): void {
	setSetting(URL_KEY, url.trim().replace(/\/+$/, ''));
	setSetting(USER_KEY, user.trim());
	if (pass) setSetting(PASS_KEY, pass); // empty pass = keep the existing one
}
export function clearServer(): void {
	deleteSetting(URL_KEY);
	deleteSetting(USER_KEY);
	deleteSetting(PASS_KEY);
}

// ── auth + HTTP ────────────────────────────────────────────────────────────────
// Subsonic salted auth: token = md5(password + salt), so the password is never sent
// on the wire. f=json gives us the modern JSON envelope ({"subsonic-response": …}).
function authParams(): URLSearchParams {
	const salt = randomBytes(8).toString('hex');
	const token = createHash('md5').update(password() + salt).digest('hex');
	return new URLSearchParams({
		u: username(),
		t: token,
		s: salt,
		v: API_VERSION,
		c: CLIENT,
		f: 'json'
	});
}

/** Build a fully-authed REST URL (used by the stream/art proxies + JSON calls). */
export function restUrl(view: string, params: Record<string, string | number> = {}): string {
	const qs = authParams();
	for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
	return `${serverUrl()}/rest/${view}.view?${qs.toString()}`;
}

type Json = Record<string, unknown>;

/** GET a Subsonic JSON endpoint, unwrap the `subsonic-response`, throw on failure. */
async function api(view: string, params: Record<string, string | number> = {}): Promise<Json> {
	if (!serverUrl() || !username()) throw new Error('Subsonic is not configured');
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 15_000);
	try {
		const res = await fetch(restUrl(view, params), { signal: ctrl.signal });
		if (!res.ok) throw new Error(`Subsonic HTTP ${res.status}`);
		const body = (await res.json().catch(() => null)) as { 'subsonic-response'?: Json } | null;
		const sr = body?.['subsonic-response'];
		if (!sr) throw new Error('malformed Subsonic response');
		if (sr.status !== 'ok') {
			const e = sr.error as { message?: string; code?: number } | undefined;
			throw new Error(e?.message || `Subsonic error ${e?.code ?? '?'}`);
		}
		return sr;
	} finally {
		clearTimeout(timer);
	}
}

// ── ping (connection test) ───────────────────────────────────────────────────
export async function ping(): Promise<{ ok: boolean; error: string | null }> {
	if (subsonicFake()) return { ok: true, error: null };
	try {
		await api('ping');
		return { ok: true, error: null };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ── mappers ────────────────────────────────────────────────────────────────────
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
/** A stable negative synthetic id for a remote song. The player keys the queue on
 * it but always streams `streamUrl`, so it only needs to be collision-free within a
 * session (the real remote id rides in streamUrl + sourceUrl). */
function synthId(remoteId: string): number {
	return -1_000_000 - (hash('subsonic:' + remoteId) % 2_000_000_000);
}

export function streamProxyUrl(remoteId: string): string {
	return `/api/subsonic/stream/${encodeURIComponent(remoteId)}`;
}
export function coverProxyUrl(coverArtId: string | null | undefined, size = 300): string | null {
	return coverArtId ? `/api/subsonic/art/${encodeURIComponent(coverArtId)}?size=${size}` : null;
}

/** A Subsonic song → a playable Track (source='subsonic', streams via the proxy). */
export function subsonicSongToTrack(song: Json): Track {
	const id = String(song.id ?? '');
	const durationSec = Number(song.duration ?? 0);
	const suffix = String(song.suffix ?? song.contentType ?? '').toUpperCase().replace(/^AUDIO\//, '');
	return {
		id: synthId(id),
		albumId: 0,
		albumTitle: song.album ? String(song.album) : undefined,
		artist: String(song.artist ?? song.albumArtist ?? 'Unknown Artist'),
		title: String(song.title ?? song.name ?? 'Untitled'),
		trackNo: song.track == null ? null : Number(song.track),
		discNo: song.discNumber == null ? null : Number(song.discNumber),
		durationMs: durationSec * 1000,
		codec: suffix || 'STREAM',
		sampleRate: Number(song.samplingRate ?? 0),
		bitDepth: song.bitDepth == null ? null : Number(song.bitDepth),
		channels: song.channelCount == null ? null : Number(song.channelCount),
		bitrate: song.bitRate == null ? null : Number(song.bitRate) * 1000, // Subsonic bitRate is kbps
		loudnessLufs: null,
		truePeak: null,
		gainDb: null,
		hasPeaks: false,
		playCount: 0,
		lastPlayedAt: null,
		rating: song.userRating == null ? null : Number(song.userRating),
		streamUrl: streamProxyUrl(id),
		isStream: false,
		source: 'subsonic',
		sourceUrl: id
	};
}

function mapAlbum(a: Json): SubsonicAlbum {
	return {
		id: String(a.id ?? ''),
		name: String(a.name ?? a.album ?? 'Untitled'),
		artist: String(a.artist ?? a.albumArtist ?? ''),
		artistId: a.artistId == null ? null : String(a.artistId),
		year: a.year == null ? null : Number(a.year),
		coverArtUrl: coverProxyUrl(a.coverArt as string | undefined),
		songCount: a.songCount == null ? null : Number(a.songCount),
		durationMs: a.duration == null ? null : Number(a.duration) * 1000
	};
}
function mapArtist(a: Json): SubsonicArtist {
	return {
		id: String(a.id ?? ''),
		name: String(a.name ?? ''),
		albumCount: a.albumCount == null ? null : Number(a.albumCount),
		coverArtUrl: coverProxyUrl(a.coverArt as string | undefined)
	};
}

// ── browse / search ──────────────────────────────────────────────────────────
export type AlbumListType =
	| 'newest'
	| 'recent'
	| 'frequent'
	| 'random'
	| 'alphabeticalByName'
	| 'starred';

export async function browseAlbums(type: AlbumListType, size = 24, offset = 0): Promise<SubsonicAlbum[]> {
	if (subsonicFake()) return fakeAlbums();
	const sr = await api('getAlbumList2', { type, size, offset });
	const list = (sr.albumList2 as Json)?.album;
	return Array.isArray(list) ? (list as Json[]).map(mapAlbum) : [];
}

export async function albumWithTracks(id: string): Promise<{ album: SubsonicAlbum; tracks: Track[] }> {
	if (subsonicFake()) {
		const album = fakeAlbums().find((a) => a.id === id) ?? fakeAlbums()[0];
		return { album, tracks: fakeSongs(album.id).map(subsonicSongToTrack) };
	}
	const sr = await api('getAlbum', { id });
	const album = (sr.album as Json) ?? {};
	const songs = Array.isArray(album.song) ? (album.song as Json[]) : [];
	return { album: mapAlbum(album), tracks: songs.map(subsonicSongToTrack) };
}

export async function search(
	query: string
): Promise<{ artists: SubsonicArtist[]; albums: SubsonicAlbum[]; tracks: Track[] }> {
	const q = query.trim();
	if (!q) return { artists: [], albums: [], tracks: [] };
	if (subsonicFake()) {
		const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
		const albums = fakeAlbums().filter((a) => match(a.name) || match(a.artist));
		const tracks = fakeAlbums()
			.flatMap((a) => fakeSongs(a.id))
			.filter((s) => match(String(s.title)) || match(String(s.artist)))
			.map(subsonicSongToTrack);
		return { artists: [], albums, tracks };
	}
	const sr = await api('search3', { query: q, songCount: 30, albumCount: 20, artistCount: 10 });
	const r = (sr.searchResult3 as Json) ?? {};
	return {
		artists: Array.isArray(r.artist) ? (r.artist as Json[]).map(mapArtist) : [],
		albums: Array.isArray(r.album) ? (r.album as Json[]).map(mapAlbum) : [],
		tracks: Array.isArray(r.song) ? (r.song as Json[]).map(subsonicSongToTrack) : []
	};
}

/** Resolve a remote song id → a fully-authed upstream stream URL. Server-side only
 * (used by the proxy + by the cast transport so a Subsonic track can play to a zone)
 * — never trust a client-supplied URL; we always rebuild it from the id. */
export function streamSourceUrl(remoteId: string, format?: string): string {
	const params: Record<string, string | number> = { id: remoteId };
	if (format) params.format = format;
	return restUrl('stream', params);
}
export function coverSourceUrl(coverArtId: string, size = 600): string {
	return restUrl('getCoverArt', { id: coverArtId, size });
}

// ── offline fixtures (TIMBRE_FAKE_SUBSONIC) ─────────────────────────────────────
// Mirror what scripts/mock-subsonic.mjs serves, so the /subsonic page and the
// no-network path both demo coherently.
function fakeAlbums(): SubsonicAlbum[] {
	return [
		{ id: 'al-1', name: 'Remote Sessions', artist: 'Navidrome Test', artistId: 'ar-1', year: 2023, coverArtUrl: coverProxyUrl('co-1'), songCount: 2, durationMs: 360_000 },
		{ id: 'al-2', name: 'Self-Hosted Nights', artist: 'Airsonic Test', artistId: 'ar-2', year: 2024, coverArtUrl: coverProxyUrl('co-2'), songCount: 1, durationMs: 200_000 }
	];
}
function fakeSongs(albumId: string): Json[] {
	if (albumId === 'al-2') {
		return [{ id: 'so-3', title: 'Tailnet Lullaby', artist: 'Airsonic Test', album: 'Self-Hosted Nights', duration: 200, track: 1, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: 2, bitRate: 900 }];
	}
	return [
		{ id: 'so-1', title: 'Over The Wire', artist: 'Navidrome Test', album: 'Remote Sessions', duration: 180, track: 1, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: 2, bitRate: 880 },
		{ id: 'so-2', title: 'Salted Token Blues', artist: 'Navidrome Test', album: 'Remote Sessions', duration: 180, track: 2, suffix: 'mp3', samplingRate: 44100, channelCount: 2, bitRate: 320 }
	];
}
