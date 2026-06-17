// Pure helper (client + server safe): map a non-local source to a playable Track.
// The player streams `streamUrl` directly; the rest of the fields are sensible
// defaults so the dock / TrackRow render a live stream without special-casing.
import type { RadioStation, Track } from './types';

export function stationToTrack(s: RadioStation): Track {
	return {
		id: -s.id, // negative ids never collide with real library tracks
		albumId: 0,
		artist: s.genre || 'Internet Radio',
		title: s.name,
		trackNo: null,
		discNo: null,
		durationMs: 0, // live
		codec: 'STREAM',
		sampleRate: 0,
		bitDepth: null,
		channels: null,
		bitrate: null,
		loudnessLufs: null,
		truePeak: null,
		gainDb: null,
		hasPeaks: false,
		playCount: 0,
		lastPlayedAt: null,
		streamUrl: s.url,
		isStream: true
	};
}
