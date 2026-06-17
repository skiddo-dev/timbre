// Ambient album-art colour. Samples a cover into a tiny canvas and distills one
// representative, vivid-but-restrained colour from it. The whole app uses this to
// softly tint the now-playing dock and detail-page heroes so the UI breathes with
// whatever is playing — the signature touch of a "listening room" player.
//
// Returns a space-separated "r g b" string ready for modern CSS colour syntax,
// e.g. `style="--art: {rgb}"` then `background: rgb(var(--art) / 0.12)`.
import { browser } from '$app/environment';

const ACCENT = '224 164 92'; // app.css --accent in rgb; the graceful default
const cache = new Map<number, string>();
const inflight = new Map<number, Promise<string>>();

/** Distill a representative colour from an album's cover art. Cached per album.
 *  Resolves to the accent fallback when there's no art or sampling fails. */
export function ambientColor(albumId: number | null | undefined): Promise<string> {
	if (!browser || albumId == null) return Promise.resolve(ACCENT);
	const hit = cache.get(albumId);
	if (hit) return Promise.resolve(hit);
	const pending = inflight.get(albumId);
	if (pending) return pending;

	const p = new Promise<string>((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			try {
				const rgb = distill(img);
				cache.set(albumId, rgb);
				resolve(rgb);
			} catch {
				resolve(ACCENT);
			} finally {
				inflight.delete(albumId);
			}
		};
		img.onerror = () => {
			inflight.delete(albumId);
			resolve(ACCENT);
		};
		img.src = `/api/art/${albumId}`;
	});
	inflight.set(albumId, p);
	return p;
}

const N = 18; // sample grid — small is plenty and fast
function distill(img: HTMLImageElement): string {
	const c = document.createElement('canvas');
	c.width = c.height = N;
	const ctx = c.getContext('2d', { willReadFrequently: true });
	if (!ctx) return ACCENT;
	ctx.drawImage(img, 0, 0, N, N);
	const { data } = ctx.getImageData(0, 0, N, N);

	// Weighted mean biased toward saturated, mid-bright pixels so the colour reads
	// as the art's "character" rather than washing out to grey or blowing to white.
	let wr = 0, wg = 0, wb = 0, ws = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
		if (a < 128) continue;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		const sat = max === 0 ? 0 : (max - min) / max;
		const lum = (max + min) / 510; // 0..1
		// down-weight near-grey, near-black and blown-out pixels
		const w = (0.12 + sat) * (1 - Math.abs(lum - 0.5) * 1.1) + 0.02;
		if (w <= 0) continue;
		wr += r * w; wg += g * w; wb += b * w; ws += w;
	}
	if (ws === 0) return ACCENT;
	let r = wr / ws, g = wg / ws, b = wb / ws;

	// Nudge toward a pleasant range on a dark UI: lift very dark results, gently
	// saturate flat ones, and cap brightness so the wash never glares.
	[r, g, b] = lift([r, g, b]);
	return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

function lift([r, g, b]: number[]): [number, number, number] {
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const lum = (max + min) / 510;
	if (lum < 0.32) {
		const k = 0.32 / Math.max(lum, 0.04);
		r *= k; g *= k; b *= k;
	}
	const m = Math.max(r, g, b);
	if (m > 215) {
		const k = 215 / m;
		r *= k; g *= k; b *= k;
	}
	return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}
