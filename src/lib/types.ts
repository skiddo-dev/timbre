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
