// Apple Music *subscription* link — the second deliberate cloud connection in an
// otherwise local-first player, and strictly opt-in. It is a METADATA + LIBRARY
// source, never a player: Apple's catalog data enriches the local library and your
// Apple library/playlists are mirrored onto local files. Nothing streams *in* —
// catalog audio is FairPlay-DRM and would bypass Timbre's whole pipeline (leveling,
// bit-perfect, Snapcast), so catalog-only tracks become deep-link "wishlist" rows.
//
// Auth has two layers, mirroring how Apple Music API actually works:
//   1. A *developer token* — an ES256 JWT signed with a MusicKit private key (.p8)
//      from an Apple Developer Program membership. Grants read access to the public
//      catalog (search, artwork, genres, editorial). Minted here, cached ~12h.
//   2. A *Music User Token* — obtained in the browser via MusicKit JS once the user
//      signs in with the Apple ID that holds the subscription. Required for reading
//      the user's library/playlists. Stored in `settings`, never a password.
//
// Everything degrades silently (a network failure never breaks the library) and
// TIMBRE_FAKE_APPLEMUSIC=1 short-circuits all HTTP so tests run fully offline —
// the same contract as enrich.ts / llm.ts / lastfm.ts.
import { createPrivateKey, sign as signRaw } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { env } from '$env/dynamic/private';
import { getSetting, setSetting, deleteSetting } from './settings';
import type { AppleMusicStatus } from '$lib/types';

const HOST = 'https://api.music.apple.com';

const USER_TOKEN = 'applemusic_user_token';
const STOREFRONT = 'applemusic_storefront';
const LAST_SYNC = 'applemusic_last_sync';

const teamId = () => (env.APPLE_MUSIC_TEAM_ID ?? '').trim();
const keyId = () => (env.APPLE_MUSIC_KEY_ID ?? '').trim();

function privateKeyPem(): string {
	const inline = (env.APPLE_MUSIC_PRIVATE_KEY ?? '').trim();
	if (inline) return inline.replace(/\\n/g, '\n'); // tolerate \n-escaped single-line env vars
	const path = (env.APPLE_MUSIC_PRIVATE_KEY_PATH ?? '').trim();
	if (path) {
		try {
			return readFileSync(path, 'utf8');
		} catch {
			return '';
		}
	}
	return '';
}

export function appleMusicFake(): boolean {
	return env.TIMBRE_FAKE_APPLEMUSIC === '1' || env.TIMBRE_FAKE_APPLEMUSIC === 'true';
}

/** All three developer-token ingredients present → catalog enrichment is available. */
function hasKeys(): boolean {
	return teamId().length > 0 && keyId().length > 0 && privateKeyPem().length > 0;
}
export function appleMusicConfigured(): boolean {
	return appleMusicFake() || hasKeys();
}

function userToken(): string | null {
	return getSetting(USER_TOKEN);
}
/** Connected = configured AND we hold a Music User Token → library sync is available. */
export function appleMusicConnected(): boolean {
	return appleMusicConfigured() && !!userToken();
}
export function storefront(): string {
	return (getSetting(STOREFRONT) || env.APPLE_MUSIC_STOREFRONT || 'us').trim().toLowerCase();
}

export function setUserToken(token: string, store?: string): void {
	setSetting(USER_TOKEN, token);
	if (store) setSetting(STOREFRONT, store.trim().toLowerCase());
}
export function disconnect(): void {
	deleteSetting(USER_TOKEN);
}
export function recordSync(): void {
	setSetting(LAST_SYNC, new Date().toISOString());
}

// ── developer token (ES256 JWT) ─────────────────────────────────────────────────
const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

function mintDeveloperToken(): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'ES256', kid: keyId(), typ: 'JWT' };
	const payload = { iss: teamId(), iat: now, exp: now + 12 * 3600 };
	const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
	const key = createPrivateKey(privateKeyPem());
	// ES256 wants the raw r‖s signature (64 bytes for P-256), not Node's default DER.
	const sig = signRaw('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
	return `${signingInput}.${b64url(sig)}`;
}

let cached: { token: string; exp: number } | null = null;
/** A valid developer token, minted on demand and cached. Safe to hand to MusicKit
 *  JS in the browser (that is exactly how Apple's client SDK consumes it). */
export function developerToken(): string | null {
	if (appleMusicFake()) return 'fake-developer-token';
	if (!hasKeys()) return null;
	const now = Math.floor(Date.now() / 1000);
	if (cached && cached.exp - 60 > now) return cached.token;
	try {
		const token = mintDeveloperToken();
		cached = { token, exp: now + 12 * 3600 };
		return token;
	} catch {
		return null; // a malformed key never breaks the app — sync just stays unavailable
	}
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────
async function apiGet(pathOrUrl: string, withUserToken = false): Promise<Record<string, unknown> | null> {
	const dev = developerToken();
	if (!dev) return null;
	const headers: Record<string, string> = { Authorization: `Bearer ${dev}` };
	if (withUserToken) {
		const ut = userToken();
		if (!ut) return null;
		headers['Music-User-Token'] = ut;
	}
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 15_000);
	try {
		const res = await fetch(pathOrUrl.startsWith('http') ? pathOrUrl : `${HOST}${pathOrUrl}`, {
			headers,
			signal: ctrl.signal
		});
		if (!res.ok) return null;
		return (await res.json().catch(() => null)) as Record<string, unknown> | null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Apple artwork URLs are templates ending in `{w}x{h}…` — resolve to a fixed size. */
export function resolveArtwork(url: string, size = 1000): string {
	return url.replace('{w}', String(size)).replace('{h}', String(size));
}

// ── catalog (developer token only) ───────────────────────────────────────────────
export interface CatalogAlbum {
	id: string;
	url: string | null;
	artworkUrl: string | null; // already resolved to a concrete size
	genres: string[];
	editorialNotes: string | null;
}

export async function searchCatalogAlbum(artist: string, title: string): Promise<CatalogAlbum | null> {
	if (appleMusicFake()) {
		return {
			id: `fake-album-${slug(`${artist}-${title}`)}`,
			url: `https://music.apple.com/us/album/${slug(title)}/0000`,
			artworkUrl: null, // offline → no download
			genres: ['Alternative'],
			editorialNotes: `${title} by ${artist}. (Offline Apple Music fixture.)`
		};
	}
	const term = encodeURIComponent(`${artist} ${title}`.trim());
	const data = await apiGet(`/v1/catalog/${storefront()}/search?types=albums&limit=1&term=${term}`);
	const results = data?.results as { albums?: { data?: AppleResource[] } } | undefined;
	const album = results?.albums?.data?.[0];
	if (!album) return null;
	const a = album.attributes ?? {};
	const art = a.artwork as { url?: string } | undefined;
	const notes = a.editorialNotes as { standard?: string; short?: string } | undefined;
	return {
		id: String(album.id),
		url: typeof a.url === 'string' ? a.url : null,
		artworkUrl: art?.url ? resolveArtwork(art.url) : null,
		genres: Array.isArray(a.genreNames)
			? (a.genreNames as string[]).map(String).filter((g) => g && g !== 'Music')
			: [],
		editorialNotes: notes?.standard || notes?.short || null
	};
}

// ── user library (developer token + Music User Token) ──────────────────────────
export interface LibrarySong {
	artist: string;
	title: string;
	album: string | null;
	catalogId: string | null;
	url: string | null;
	durationMs: number;
}

interface AppleResource {
	id: string | number;
	attributes?: Record<string, unknown>;
}

function songFrom(it: AppleResource): LibrarySong {
	const a = it.attributes ?? {};
	const play = a.playParams as { catalogId?: string; id?: string } | undefined;
	const catalogId = play?.catalogId ?? play?.id ?? null;
	const sf = storefront();
	const url =
		typeof a.url === 'string'
			? (a.url as string)
			: catalogId
				? `https://music.apple.com/${sf}/song/${catalogId}`
				: null;
	return {
		artist: String(a.artistName ?? ''),
		title: String(a.name ?? ''),
		album: a.albumName ? String(a.albumName) : null,
		catalogId: catalogId ? String(catalogId) : null,
		url,
		durationMs: Number(a.durationInMillis ?? 0)
	};
}

// Walk Apple's `next`-cursored collections (offset paging) up to a cap.
async function paged(first: string, cap: number): Promise<AppleResource[]> {
	const out: AppleResource[] = [];
	let next: string | null = first;
	while (next && out.length < cap) {
		const data: Record<string, unknown> | null = await apiGet(next, true);
		if (!data) break;
		for (const it of (data.data as AppleResource[]) ?? []) out.push(it);
		next = typeof data.next === 'string' ? (data.next as string) : null;
	}
	return out;
}

export async function fetchLibrarySongs(max = 5000): Promise<LibrarySong[]> {
	if (appleMusicFake()) return fakeLibrarySongs();
	return (await paged('/v1/me/library/songs?limit=100', max)).map(songFrom);
}

export interface LibraryPlaylist {
	id: string;
	name: string;
	tracks: LibrarySong[];
}

export async function fetchLibraryPlaylists(maxLists = 200): Promise<LibraryPlaylist[]> {
	if (appleMusicFake()) return fakeLibraryPlaylists();
	const lists = await paged('/v1/me/library/playlists?limit=100', maxLists);
	const out: LibraryPlaylist[] = [];
	for (const pl of lists) {
		const id = String(pl.id);
		const tracks = (await paged(`/v1/me/library/playlists/${id}/tracks?limit=100`, 1000)).map(songFrom);
		out.push({ id, name: String(pl.attributes?.name ?? 'Playlist'), tracks });
	}
	return out;
}

export function appleMusicStatus(): AppleMusicStatus {
	return {
		configured: appleMusicConfigured(),
		connected: appleMusicConnected(),
		fake: appleMusicFake(),
		storefront: storefront(),
		lastSyncAt: getSetting(LAST_SYNC)
	};
}

// ── offline fixtures (TIMBRE_FAKE_APPLEMUSIC) ───────────────────────────────────
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// One song that matches the verify fixtures (→ reconciles to a local file) and one
// catalog-only song (→ becomes a deep-link wishlist row).
function fakeLibrarySongs(): LibrarySong[] {
	return [
		{
			artist: 'Aurora Test',
			title: 'Verify Track One',
			album: 'Test Album One',
			catalogId: '1111',
			url: 'https://music.apple.com/us/song/1111',
			durationMs: 1000
		},
		{
			artist: 'Phantom Cat',
			title: 'Ghost Single',
			album: 'Spectral Sessions',
			catalogId: '2222',
			url: 'https://music.apple.com/us/song/2222',
			durationMs: 222_000
		}
	];
}
function fakeLibraryPlaylists(): LibraryPlaylist[] {
	return [{ id: 'fake-pl-1', name: 'Apple Faves', tracks: fakeLibrarySongs() }];
}
