// Domain types shared between the server (snake_case SQLite rows are mapped to
// these in src/lib/server/repo.ts) and the Svelte UI. camelCase throughout.

export interface Artist {
	id: number;
	name: string;
	sortName: string;
	mbid: string | null;
	bio: string | null;
	hasImage: boolean;
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
