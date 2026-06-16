// Pure formatting helpers (no DOM, safe on server + client).
import type { Track } from './types';

/** ms → "m:ss" or "h:mm:ss". */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return '0:00';
	const total = Math.round(ms / 1000);
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const ss = String(s).padStart(2, '0');
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
	return `${m}:${ss}`;
}

/** 44100 → "44.1 kHz", 48000 → "48 kHz". */
export function formatSampleRate(hz: number): string {
	if (!hz) return '';
	const k = hz / 1000;
	return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;
}

/** Compact quality badge, e.g. "FLAC · 16/44.1" or "MP3 · 320k". */
export function qualityLabel(t: Pick<Track, 'codec' | 'bitDepth' | 'sampleRate' | 'bitrate'>): string {
	const codec = (t.codec || '').toUpperCase();
	const lossless = /FLAC|ALAC|WAV|AIFF|APE/.test(codec);
	if (lossless && t.bitDepth && t.sampleRate) {
		return `${codec} · ${t.bitDepth}/${(t.sampleRate / 1000).toFixed(1).replace(/\.0$/, '')}`;
	}
	if (t.bitrate) return `${codec} · ${Math.round(t.bitrate / 1000)}k`;
	return codec;
}

export function formatLufs(lufs: number | null): string {
	if (lufs == null) return '—';
	return `${lufs.toFixed(1)} LUFS`;
}

export function formatBytes(bytes: number): string {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** ISO date → "today" / "3 days ago" / "Mar 2024". */
export function relativeDate(iso: string | null): string {
	if (!iso) return '';
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return '';
	const days = Math.floor((Date.now() - then) / 86_400_000);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 30) return `${days} days ago`;
	return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
