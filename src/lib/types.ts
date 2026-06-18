// Domain types shared between the server (snake_case SQLite rows are mapped to
// these in src/lib/server/repo.ts) and the Svelte UI. camelCase throughout.

export interface Artist {
	id: number;
	name: string;
	sortName: string;
	mbid: string | null;
	bio: string | null;
	hasImage: boolean;
	// Factual metadata from MusicBrainz (null until enrichment runs).
	mbType: string | null; // 'Person' | 'Group' | …
	country: string | null; // ISO 3166 code, e.g. 'US'
	beginYear: number | null;
	endYear: number | null;
	genres: string[]; // MusicBrainz genres/tags, most-tagged first
}

export interface Album {
	id: number;
	title: string;
	albumArtist: string;
	year: number | null;
	mbid: string | null;
	source: string; // 'local' for v1; seam for streaming sources later
	hasArt: boolean;
	addedAt: string;
	trackCount?: number;
	durationMs?: number;
	// AI discovery tags (M7) — null until "Analyze with AI" runs
	genre: string | null;
	mood: string | null;
	tags: string[];
	descriptor: string | null;
	// Factual metadata from MusicBrainz (null until enrichment runs).
	mbPrimaryType: string | null; // 'Album' | 'EP' | 'Single' | …
	mbSecondaryTypes: string[]; // e.g. ['Live', 'Compilation']
	firstReleased: string | null; // MB first-release-date (YYYY[-MM[-DD]])
	mbGenres: string[]; // MusicBrainz genres/tags, most-tagged first
	// Apple Music catalog link (null until an Apple enrichment runs). A metadata
	// source only — appleUrl deep-links out to Apple Music, nothing streams in.
	appleId: string | null;
	appleUrl: string | null;
}

export interface Track {
	id: number;
	albumId: number;
	albumTitle?: string;
	artist: string;
	title: string;
	trackNo: number | null;
	discNo: number | null;
	durationMs: number;
	codec: string;
	sampleRate: number;
	bitDepth: number | null;
	channels: number | null;
	bitrate: number | null;
	// Loudness analysis (M4) — null until the kernel scan runs.
	loudnessLufs: number | null;
	truePeak: number | null;
	gainDb: number | null;
	hasPeaks: boolean;
	playCount: number;
	lastPlayedAt: string | null;
	rating: number | null; // 0..5 stars (from a Music library import)
	// Non-local source seam (M-followups): when set, the player streams this URL
	// directly instead of /api/stream/[id] (e.g. internet radio).
	streamUrl?: string;
	isStream?: boolean;
	// Where this track came from: 'local' (a scanned file) by default, or a tag like
	// 'blog' for curated, non-playable crate entries, or 'applemusic' for a synced
	// catalog track with no local file (a deep-link "wishlist" row). sourceUrl links back.
	source?: string;
	sourceUrl?: string | null;
	// Apple Music catalog link (deep-link out; never a stream into Timbre's pipeline).
	appleId?: string | null;
	appleUrl?: string | null;
}

export interface RadioStation {
	id: number;
	name: string;
	url: string;
	genre: string | null;
	favicon: string | null;
}

export interface Playlist {
	id: number;
	name: string;
	source: string;
	trackCount?: number;
}

export interface QueueItem {
	position: number;
	track: Track;
}

export interface PlayerState {
	currentTrackId: number | null;
	positionMs: number;
	volume: number; // 0..1
	shuffle: boolean;
	repeat: 'off' | 'all' | 'one';
}

// ── Last.fm scrobbling ───────────────────────────────────────────────────────
export interface Scrobble {
	id: number;
	artist: string;
	title: string;
	album: string | null;
	playedAt: number; // unix seconds
	state: 'pending' | 'sent' | 'failed';
	error: string | null;
}

export interface LastfmStatus {
	configured: boolean; // app API key + secret present → the connect flow is available
	connected: boolean; // a user session key is held → scrobbling is live
	user: string | null; // the connected Last.fm username
	fake: boolean; // TIMBRE_FAKE_LASTFM — offline deterministic mode (tests)
	pending: number; // queued scrobbles not yet accepted by Last.fm
	lastScrobbleAt: number | null; // unix seconds of the most recent accepted scrobble
}

// ── Apple Music subscription (enrichment + library sync; never a player) ───────
export interface AppleMusicStatus {
	configured: boolean; // dev-token keys present (or fake) → catalog enrichment is available
	connected: boolean; // a Music User Token is held → library/playlist sync is available
	fake: boolean; // TIMBRE_FAKE_APPLEMUSIC — offline deterministic mode (tests)
	storefront: string; // e.g. 'us' — which Apple Music catalog to read
	lastSyncAt: string | null; // ISO time of the last library sync
}

export interface AppleSyncResult {
	matched: number; // library songs reconciled to a local file
	wishlist: number; // catalog-only songs added as deep-link rows (no local file)
	playlists: number; // library playlists mirrored
	error: string | null;
}

export interface AppleEnrichResult {
	appleId: string | null;
	appleUrl: string | null;
	art: boolean; // an artwork was fetched/kept
	genres: string[]; // Apple catalog genreNames
	editorial: boolean; // an editorial note filled the descriptor
	error: string | null;
}

export interface ScanStatus {
	running: boolean;
	scanned: number;
	added: number;
	updated: number;
	removed: number;
	total: number;
	startedAt: string | null;
	finishedAt: string | null;
	error: string | null;
	musicDir: string;
}

export interface SearchResults {
	artists: Artist[];
	albums: Album[];
	tracks: Track[];
}

// ── Snapcast multi-room (M6) ─────────────────────────────────────────────────
export interface SnapClient {
	id: string;
	name: string;
	host: string;
	connected: boolean;
	volume: number; // 0..100
	muted: boolean;
	latency: number;
}

export interface SnapGroup {
	id: string;
	name: string;
	streamId: string;
	muted: boolean;
	clients: SnapClient[];
}

export interface SnapStream {
	id: string;
	status: string; // 'playing' | 'idle' | …
}

export interface ZoneStatus {
	configured: boolean;
	reachable: boolean;
	groups: SnapGroup[];
	streams: SnapStream[];
	error: string | null;
}

// ── Usenet (NZB) acquisition ─────────────────────────────────────────────────
export interface UsenetIndexer {
	id: number;
	name: string;
	url: string; // Newznab API base
	hasKey: boolean; // api_key is never sent to the client
	enabled: boolean;
}

// A single search hit from a Newznab indexer (a grabbable release).
export interface UsenetResult {
	guid: string;
	title: string;
	indexerId: number;
	indexerName: string;
	nzbUrl: string; // get-link the downloader fetches / hands to SABnzbd
	sizeBytes: number;
	category: string;
	pubDate: string | null;
	grabs: number | null;
}

export type UsenetStatusValue =
	| 'queued'
	| 'downloading'
	| 'verifying'
	| 'extracting'
	| 'importing'
	| 'completed'
	| 'failed';

export interface UsenetDownload {
	id: number;
	title: string;
	indexerId: number | null;
	category: string;
	sizeBytes: number;
	engine: string; // 'sab' | 'nntp' | ''
	status: UsenetStatusValue;
	progress: number; // 0..100
	bytesDone: number;
	destDir: string | null;
	files: number;
	error: string | null;
	createdAt: string;
	updatedAt: string;
	completedAt: string | null;
}

// Which acquisition engines are wired up (drives the /usenet UI hints).
export interface UsenetEngines {
	sab: boolean; // a SABnzbd/NZBGet client is configured (handles PAR2 + unrar)
	nntp: boolean; // a direct NNTP provider is configured (built-in yEnc fallback)
	indexers: number; // count of enabled indexers
}

export interface UsenetStatus {
	indexers: UsenetIndexer[];
	downloads: UsenetDownload[];
	engines: UsenetEngines;
}
