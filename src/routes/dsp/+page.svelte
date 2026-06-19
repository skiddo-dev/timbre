<script lang="ts">
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import { player } from '$lib/audio/player.svelte';
	import {
		makeBand,
		presetProfile,
		normalizeProfile,
		type DspProfile,
		type EqBand,
		type EqBandType,
		MAX_BANDS
	} from '$lib/dsp';
	import Icon from '$lib/components/Icon.svelte';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let profile = $state<DspProfile>(structuredClone(data.profile));
	// svelte-ignore state_referenced_locally
	let irs = $state<string[]>(data.irs);
	let importText = $state('');
	let importOpen = $state(false);
	let busy = $state('');

	const TYPES: { v: EqBandType; label: string }[] = [
		{ v: 'peaking', label: 'Peak' },
		{ v: 'lowshelf', label: 'Low shelf' },
		{ v: 'highshelf', label: 'High shelf' },
		{ v: 'lowpass', label: 'Low-pass' },
		{ v: 'highpass', label: 'High-pass' },
		{ v: 'notch', label: 'Notch' }
	];
	const usesGain = (t: EqBandType) => t === 'peaking' || t === 'lowshelf' || t === 'highshelf';

	// ── apply (live to the graph) + persist (debounced) ──────────────────────
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	function apply() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => player.setDsp(normalizeProfile($state.snapshot(profile))), 180);
	}

	function setPreset(name: string) {
		profile = presetProfile(name, profile);
		apply();
	}
	function addBand() {
		if (profile.bands.length >= MAX_BANDS) return;
		profile.bands.push(makeBand({ type: 'peaking', freq: 1000, gain: 0, q: 1 }));
		apply();
	}
	function removeBand(id: string) {
		profile.bands = profile.bands.filter((b) => b.id !== id);
		apply();
	}

	// ── room correction: IR upload + EqualizerAPO/REW import ──────────────────
	async function uploadIr(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		busy = 'Uploading IR…';
		try {
			const res = await fetch(`/api/dsp/ir?name=${encodeURIComponent(file.name)}`, {
				method: 'POST',
				body: await file.arrayBuffer()
			});
			const d = await res.json();
			if (res.ok) {
				irs = d.irs ?? irs;
				profile.room = { enabled: true, irName: d.name };
				apply();
			}
		} finally {
			busy = '';
		}
	}
	async function deleteIr(name: string) {
		const d = await (await fetch('/api/dsp', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'delete-ir', name })
		})).json();
		irs = d.irs ?? [];
		if (profile.room.irName === name) {
			profile.room = { enabled: false, irName: null };
			apply();
		}
	}
	async function importApo() {
		busy = 'Importing…';
		try {
			const d = await (await fetch('/api/dsp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'import-apo', text: importText })
			})).json();
			if (Array.isArray(d.bands) && d.bands.length) {
				profile.bands = d.bands as EqBand[];
				profile.preampDb = d.preampDb ?? profile.preampDb;
				profile.enabled = true;
				importOpen = false;
				importText = '';
				apply();
			}
		} finally {
			busy = '';
		}
	}

	// ── live magnitude curve (matches the actual Web Audio nodes exactly) ─────
	const FREQS = (() => {
		const n = 220;
		const a = new Float32Array(n);
		for (let i = 0; i < n; i++) a[i] = 20 * Math.pow(20000 / 20, i / (n - 1));
		return a;
	})();
	const W = 760;
	const H = 200;
	const DB_RANGE = 24;
	const xFor = (i: number) => (i / (FREQS.length - 1)) * W;
	const yFor = (db: number) => H / 2 - (Math.max(-DB_RANGE, Math.min(DB_RANGE, db)) / DB_RANGE) * (H / 2 - 8);

	const curve = $derived.by(() => {
		// referencing profile.* keeps this reactive to every edit
		const bands = profile.bands;
		const pre = profile.preampDb;
		const enabled = profile.enabled;
		if (!browser) return '';
		const total = new Float32Array(FREQS.length).fill(enabled ? pre : 0);
		if (enabled) {
			const octx = new OfflineAudioContext(1, 1, 48000);
			const mag = new Float32Array(FREQS.length);
			const phase = new Float32Array(FREQS.length);
			for (const band of bands) {
				if (!band.enabled) continue;
				const f = octx.createBiquadFilter();
				f.type = band.type;
				f.frequency.value = band.freq;
				f.Q.value = band.q;
				f.gain.value = band.gain;
				f.getFrequencyResponse(FREQS, mag, phase);
				for (let i = 0; i < FREQS.length; i++) total[i] += 20 * Math.log10(Math.max(1e-6, mag[i]));
			}
		}
		let d = '';
		for (let i = 0; i < FREQS.length; i++) d += `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)} ${yFor(total[i]).toFixed(1)} `;
		return d;
	});

	const GRID_HZ = [50, 100, 500, 1000, 5000, 10000];
	const gridX = (hz: number) => (Math.log(hz / 20) / Math.log(20000 / 20)) * W;
	const fmtHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);
</script>

<svelte:head><title>EQ · Timbre</title></svelte:head>

<header class="page-head">
	<div class="title-row">
		<h1>Equalizer</h1>
		<label class="master">
			<input type="checkbox" bind:checked={profile.enabled} onchange={apply} />
			<span>{profile.enabled ? 'On' : 'Off'}</span>
		</label>
	</div>
	<p class="muted">
		A parametric EQ + room correction applied everywhere Timbre plays — this device and every cast
		output (Snapcast / AirPlay) share these settings.
	</p>
	{#if player.bitPerfect}
		<p class="banner"><Icon name="target" size={15} /> Bit-perfect output is on — DSP is bypassed for untouched samples.</p>
	{/if}
</header>

<section class="card curve-card" class:off={!profile.enabled}>
	<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="curve">
		<line x1="0" y1={H / 2} x2={W} y2={H / 2} class="grid zero" />
		{#each [-12, 12] as db (db)}
			<line x1="0" y1={yFor(db)} x2={W} y2={yFor(db)} class="grid" />
		{/each}
		{#each GRID_HZ as hz (hz)}
			<line x1={gridX(hz)} y1="0" x2={gridX(hz)} y2={H} class="grid v" />
			<text x={gridX(hz) + 3} y={H - 5} class="axis">{fmtHz(hz)}</text>
		{/each}
		<path d={curve} class="response" />
	</svg>
</section>

<section class="card">
	<div class="row between">
		<div class="presets">
			<span class="muted small">Preset:</span>
			{#each data.presets as name (name)}
				<button class="chip-btn" onclick={() => setPreset(name)}>{name}</button>
			{/each}
		</div>
		<label class="preamp">
			Preamp <span class="mono">{profile.preampDb > 0 ? '+' : ''}{profile.preampDb} dB</span>
			<input type="range" min="-24" max="24" step="0.5" bind:value={profile.preampDb} oninput={apply} />
		</label>
	</div>
</section>

<section class="card">
	<div class="row between">
		<h2>Bands <span class="muted small">{profile.bands.length}/{MAX_BANDS}</span></h2>
		<button class="btn btn-accent sm" onclick={addBand} disabled={profile.bands.length >= MAX_BANDS}>
			<Icon name="plus" size={13} /> Add band
		</button>
	</div>

	{#if profile.bands.length === 0}
		<p class="muted small">No bands — the signal passes flat. Add a band or pick a preset.</p>
	{/if}

	<div class="bands">
		{#each profile.bands as band (band.id)}
			<div class="band" class:disabled={!band.enabled}>
				<input type="checkbox" bind:checked={band.enabled} onchange={apply} title="Enable band" />
				<select bind:value={band.type} onchange={apply}>
					{#each TYPES as t (t.v)}<option value={t.v}>{t.label}</option>{/each}
				</select>
				<label class="f">
					<span>Freq</span>
					<input type="range" min="20" max="20000" step="1" bind:value={band.freq} oninput={apply} />
					<span class="mono v">{band.freq < 1000 ? band.freq : (band.freq / 1000).toFixed(2) + 'k'} Hz</span>
				</label>
				<label class="f" class:dim={!usesGain(band.type)}>
					<span>Gain</span>
					<input type="range" min="-24" max="24" step="0.5" bind:value={band.gain} oninput={apply} disabled={!usesGain(band.type)} />
					<span class="mono v">{band.gain > 0 ? '+' : ''}{band.gain} dB</span>
				</label>
				<label class="f">
					<span>Q</span>
					<input type="range" min="0.1" max="12" step="0.1" bind:value={band.q} oninput={apply} />
					<span class="mono v">{band.q}</span>
				</label>
				<button class="ico" onclick={() => removeBand(band.id)} title="Remove band" aria-label="Remove band"><Icon name="x" size={14} /></button>
			</div>
		{/each}
	</div>
</section>

<section class="card">
	<h2>Room correction</h2>
	<p class="muted small" style="margin-top:0">
		Convolve with a measured impulse response (a WAV), or import a parametric filter set from REW /
		EqualizerAPO. The convolution applies in the browser; EQ bands apply on every output.
	</p>

	<label class="master" style="margin:0.4rem 0">
		<input type="checkbox" bind:checked={profile.room.enabled} onchange={apply} disabled={!profile.room.irName} />
		<span>Apply impulse response{profile.room.irName ? ` · ${profile.room.irName}` : ' (none loaded)'}</span>
	</label>

	<div class="row" style="flex-wrap:wrap; gap:0.5rem">
		<label class="btn sm file">
			Upload IR (.wav)
			<input type="file" accept=".wav,audio/wav,audio/x-wav" onchange={uploadIr} hidden />
		</label>
		<button class="btn sm" onclick={() => (importOpen = !importOpen)}>Import REW / EqualizerAPO</button>
		{#if busy}<span class="muted small">{busy}</span>{/if}
	</div>

	{#if irs.length}
		<ul class="irs">
			{#each irs as name (name)}
				<li>
					<button class="ir-name" class:active={profile.room.irName === name} onclick={() => { profile.room = { enabled: true, irName: name }; apply(); }}>
						{name}
					</button>
					<button class="ico sm" onclick={() => deleteIr(name)} title="Delete" aria-label="Delete IR"><Icon name="x" size={12} /></button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if importOpen}
		<div class="apo">
			<textarea bind:value={importText} rows="5" placeholder={'Preamp: -6 dB\nFilter 1: ON PK Fc 1000 Hz Gain -3.0 dB Q 1.41\nFilter 2: ON LS Fc 80 Hz Gain 4 dB Q 0.7'}></textarea>
			<button class="btn btn-accent sm" onclick={importApo} disabled={!importText.trim()}>Import bands</button>
		</div>
	{/if}
</section>

<style>
	.page-head {
		margin-bottom: 1.2rem;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.page-head h1 {
		font-size: 1.9rem;
	}
	.master {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.banner {
		margin-top: 0.6rem;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--accent);
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 1rem 1.1rem;
		margin-bottom: 1rem;
	}
	.curve-card {
		padding: 0.6rem;
	}
	.curve-card.off {
		opacity: 0.5;
	}
	.curve {
		width: 100%;
		height: 200px;
		display: block;
	}
	.grid {
		stroke: var(--border-soft);
		stroke-width: 1;
	}
	.grid.zero {
		stroke: var(--border);
	}
	.grid.v {
		stroke-dasharray: 2 4;
	}
	.axis {
		fill: var(--text-faint);
		font-size: 10px;
		font-family: var(--font-mono, monospace);
	}
	.response {
		fill: none;
		stroke: var(--accent);
		stroke-width: 2.5;
		vector-effect: non-scaling-stroke;
		stroke-linejoin: round;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.row.between {
		justify-content: space-between;
	}
	h2 {
		font-size: 1.05rem;
		margin: 0;
	}
	.presets {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}
	.chip-btn {
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		color: var(--text-dim);
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
		font-size: 0.8rem;
	}
	.chip-btn:hover {
		color: var(--text);
		border-color: var(--accent-dim, var(--border));
	}
	.preamp {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		white-space: nowrap;
	}
	.preamp input {
		width: 160px;
	}
	.bands {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.7rem;
	}
	.band {
		display: grid;
		grid-template-columns: auto 7rem 1fr 1fr 0.7fr auto;
		align-items: center;
		gap: 0.7rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.7rem;
	}
	.band.disabled {
		opacity: 0.5;
	}
	.band select {
		background: var(--surface-3);
		border: 1px solid var(--border-soft);
		color: var(--text);
		border-radius: 6px;
		padding: 0.25rem 0.4rem;
		font-size: 0.82rem;
	}
	.f {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.74rem;
		color: var(--text-dim);
		min-width: 0;
	}
	.f > span:first-child {
		width: 2.4rem;
		flex: none;
	}
	.f input[type='range'] {
		flex: 1;
		min-width: 0;
	}
	.f .v {
		width: 4.6rem;
		text-align: right;
		flex: none;
		color: var(--text);
	}
	.f.dim {
		opacity: 0.4;
	}
	.btn.sm {
		font-size: 0.8rem;
		padding: 0.3rem 0.7rem;
	}
	.btn.file {
		cursor: pointer;
	}
	.ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--text-faint);
		border-radius: 6px;
		padding: 0.2rem;
	}
	.ico:hover {
		color: var(--bad);
		background: var(--surface-3);
	}
	.irs {
		list-style: none;
		margin: 0.7rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.irs li {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
		padding: 0.1rem 0.3rem 0.1rem 0.6rem;
	}
	.ir-name {
		background: none;
		border: none;
		color: var(--text-dim);
		font-size: 0.78rem;
	}
	.ir-name.active {
		color: var(--accent);
	}
	.apo {
		margin-top: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.apo textarea {
		width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		color: var(--text);
		padding: 0.6rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.78rem;
	}
	@media (max-width: 680px) {
		.band {
			grid-template-columns: auto 1fr auto;
			grid-auto-rows: auto;
		}
		.preamp input {
			width: 110px;
		}
	}
</style>
