// Timbre's custom icon set — hand-drawn SVG glyphs, no icon-font or third-party
// pack. Rendered by $lib/components/Icon.svelte.
//
// Three layers, all riding `currentColor` so a glyph tints with its surrounding
// text / hover / active state everywhere:
//   • ICONS  — the crisp stroke line-work (fill none, stroke currentColor)
//   • FILLS  — an OPTIONAL soft same-hue wash behind the body shape, giving the
//              nav/feature glyphs a duotone sense of depth (fill-opacity 0.16)
//   • SOLID  — names that render fully filled with NO stroke. The transport
//              controls (play/pause/skip) and the rating star read better as
//              solid silhouettes, the way every player draws them.
//
// Drawing rules (keep new glyphs consistent):
//   • 24×24 grid, ~3.5px safe margin (small overshoot OK for round caps)
//   • ICONS / FILLS entries are bare shapes with NO fill/stroke/style of their
//     own — the <svg> wrapper supplies stroke=currentColor, width 1.75, round
//     caps/joins. SOLID entries are closed shapes filled by the wrapper.
//   • corner radii ≈ 1–2 on rectangles, soft round joins everywhere
//   • semantic names so a native client could map each to an SF Symbol
//
// Only static markup defined in this file may go through these strings —
// Icon.svelte injects them with {@html}.

const ICONS = {
	/* ── Brand ──────────────────────────────────────────────────────── */
	// Five pill bars in a symmetric waveform — "timbre" is the shape of a sound.
	// Echoes the equalizer that breathes in the now-playing dock.
	logo: '<path d="M4.8 9.5v5"/><path d="M8.4 6v12"/><path d="M12 3.5v17"/><path d="M15.6 6v12"/><path d="M19.2 9.5v5"/>',

	/* ── Main navigation ────────────────────────────────────────────── */
	home: '<path d="M3.75 11.25 12 4l8.25 7.25"/><path d="M5.5 9.7V20h13V9.7"/><path d="M9.75 20v-5.5h4.5V20"/>',
	// Vinyl record: outer edge, label ring, spindle hole.
	albums: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="0.6"/>',
	// Performer bust.
	artists: '<circle cx="12" cy="8.5" r="3.75"/><path d="M5 20c0-3.6 3.13-6.25 7-6.25S19 16.4 19 20"/>',
	// Track list with a note hung on the last line.
	playlists: '<path d="M4 7h12"/><path d="M4 12h8"/><path d="M4 17h6"/><circle cx="16.5" cy="17" r="2.5"/><path d="M19 17V9l2.5 1.5"/>',
	// Broadcast: a dot radiating signal arcs.
	radio: '<circle cx="12" cy="12" r="1.9"/><path d="M8.4 8.4a5 5 0 0 0 0 7.2"/><path d="M15.6 8.4a5 5 0 0 1 0 7.2"/><path d="M5.9 5.9a8.5 8.5 0 0 0 0 12.2"/><path d="M18.1 5.9a8.5 8.5 0 0 1 0 12.2"/>',
	// Download (Usenet acquisition): arrow into a tray.
	download: '<path d="M12 4v10"/><path d="m7.5 9.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
	search: '<circle cx="11" cy="11" r="5.75"/><path d="m15.45 15.45 4.05 4.05"/>',
	// Speaker cabinet — woofer + tweeter. Multi-room zones.
	zones: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><circle cx="12" cy="14" r="3.4"/><circle cx="12" cy="7.25" r="1.25"/>',
	// Mixer faders — settings, audio-style.
	settings: '<path d="M5 4v6"/><path d="M5 14v6"/><path d="M12 4v3"/><path d="M12 11v9"/><path d="M19 4v9"/><path d="M19 17v3"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="19" cy="15" r="2"/>',

	/* ── Transport (mostly SOLID) ───────────────────────────────────── */
	play: '<path d="M7 4.8v14.4L19.5 12Z"/>',
	pause: '<rect x="6.5" y="4.5" width="4" height="15" rx="1"/><rect x="13.5" y="4.5" width="4" height="15" rx="1"/>',
	prev: '<path d="M18 5.2v13.6L8.5 12Z"/><rect x="5" y="5" width="2.4" height="14" rx="1"/>',
	next: '<path d="M6 5.2v13.6L15.5 12Z"/><rect x="16.6" y="5" width="2.4" height="14" rx="1"/>',
	shuffle:
		'<path d="M4 6.75h3.4c1.2 0 2.3.58 3 1.57l4.2 5.86c.7.99 1.8 1.57 3 1.57H21"/><path d="M4 17.25h3.4c1.2 0 2.3-.58 3-1.57l1.1-1.53"/><path d="M12.5 8.32l1.1-1.52c.7-.99 1.8-1.57 3-1.57H21"/><path d="m17.8 4.7 3.2 2.53-3.2 2.52"/><path d="m17.8 14.25 3.2 2.53-3.2 2.52"/>',
	repeat: '<path d="M5 9V8a2.5 2.5 0 0 1 2.5-2.5H19"/><path d="m16 2.5 3.2 3-3.2 3"/><path d="M19 15v1a2.5 2.5 0 0 1-2.5 2.5H5"/><path d="m8 21.5-3.2-3 3.2-3"/>',
	'repeat-one':
		'<path d="M5 9V8a2.5 2.5 0 0 1 2.5-2.5H19"/><path d="m16 2.5 3.2 3-3.2 3"/><path d="M19 15v1a2.5 2.5 0 0 1-2.5 2.5H5"/><path d="m8 21.5-3.2-3 3.2-3"/><path d="M11.2 10.4 12.7 9.4v5.2"/>',

	/* ── Player controls / misc ─────────────────────────────────────── */
	// Bit-perfect: a precision crosshair on target.
	target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v3.5"/><path d="M12 19v3.5"/><path d="M22.5 12H19"/><path d="M5 12H1.5"/>',
	// Volume leveling (ReplayGain): horizontal faders.
	levels: '<path d="M3.5 8h8"/><path d="M15.5 8h5"/><path d="M3.5 16h5"/><path d="M12.5 16h8"/><circle cx="13.5" cy="8" r="2"/><circle cx="8.5" cy="16" r="2"/>',
	// Up-next queue.
	queue: '<path d="M4 6h11"/><path d="M4 11h11"/><path d="M4 16h7"/><path d="M15.5 13.75v6l5-3Z"/>',
	volume: '<path d="M4 9.5h3l4-3.25v11.5L7 14.5H4Z"/><path d="M15.5 9.25a4 4 0 0 1 0 5.5"/><path d="M18 6.75a7.5 7.5 0 0 1 0 10.5"/>',
	mute: '<path d="M4 9.5h3l4-3.25v11.5L7 14.5H4Z"/><path d="m15.5 9.75 5 4.5"/><path d="m20.5 9.75-5 4.5"/>',
	plus: '<path d="M12 5.25v13.5"/><path d="M5.25 12h13.5"/>',
	x: '<path d="m6.25 6.25 11.5 11.5"/><path d="m17.75 6.25-11.5 11.5"/>',
	// Open the original source out of app.
	external: '<path d="M13.5 4.5H19.5V10.5"/><path d="M19.5 4.5 11 13"/><path d="M18 13.75V18.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10.5"/>',
	star: '<path d="m12 3.5 2.6 5.66 6.15.62-4.6 4.12 1.34 6.04L12 16.95l-5.49 3-1.34-6.04-4.6-4.12 6.15-.62Z"/>',
	// Two beamed notes — placeholder / "now sounding".
	note: '<circle cx="7.75" cy="17.5" r="2.5"/><circle cx="16.25" cy="15" r="2.5"/><path d="M10.25 17.5V6l8.5-1.6v10.6"/><path d="M10.25 8.9 18.75 7.3"/>',
	// Discovery / AI sparkle.
	spark: '<path d="M11 3.5c.55 3.9 1.6 4.95 5.5 5.5-3.9.55-4.95 1.6-5.5 5.5-.55-3.9-1.6-4.95-5.5-5.5 3.9-.55 4.95-1.6 5.5-5.5Z"/><path d="M17.75 13.5c.28 1.55.83 2.1 2.4 2.4-1.57.3-2.12.85-2.4 2.4-.28-1.55-.83-2.1-2.4-2.4 1.57-.3 2.12-.85 2.4-2.4Z"/>',
	check: '<path d="m4.5 12.5 5 5 10-11"/>',
	'arrow-left': '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
	'arrow-right': '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'
} as const;

// Soft duotone body wash — a copy of each glyph's closed "body" shape(s).
// Pure line-art glyphs (arrows, plus, check, shuffle, transport…) take none.
const FILLS: Partial<Record<keyof typeof ICONS, string>> = {
	logo: '<path d="M4.8 9.5v5"/><path d="M8.4 6v12"/><path d="M12 3.5v17"/><path d="M15.6 6v12"/><path d="M19.2 9.5v5"/>',
	home: '<path d="M5.5 9.7 12 4l6.5 5.7V20h-13Z"/>',
	albums: '<circle cx="12" cy="12" r="8.5"/>',
	artists: '<circle cx="12" cy="8.5" r="3.75"/><path d="M5 20c0-3.6 3.13-6.25 7-6.25S19 16.4 19 20Z"/>',
	playlists: '<circle cx="16.5" cy="17" r="2.5"/>',
	radio: '<circle cx="12" cy="12" r="1.9"/>',
	search: '<circle cx="11" cy="11" r="5.75"/>',
	zones: '<rect x="6" y="3.5" width="12" height="17" rx="2"/>',
	settings: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="19" cy="15" r="2"/>',
	target: '<circle cx="12" cy="12" r="3"/>',
	levels: '<circle cx="13.5" cy="8" r="2"/><circle cx="8.5" cy="16" r="2"/>',
	volume: '<path d="M4 9.5h3l4-3.25v11.5L7 14.5H4Z"/>',
	mute: '<path d="M4 9.5h3l4-3.25v11.5L7 14.5H4Z"/>',
	note: '<circle cx="7.75" cy="17.5" r="2.5"/><circle cx="16.25" cy="15" r="2.5"/>',
	spark: '<path d="M11 3.5c.55 3.9 1.6 4.95 5.5 5.5-3.9.55-4.95 1.6-5.5 5.5-.55-3.9-1.6-4.95-5.5-5.5 3.9-.55 4.95-1.6 5.5-5.5Z"/>'
};

// Fully filled, no stroke — the way players always draw these.
const SOLID = new Set<keyof typeof ICONS>(['play', 'pause', 'prev', 'next', 'star']);

export type IconName = keyof typeof ICONS;
export { ICONS, FILLS, SOLID };
