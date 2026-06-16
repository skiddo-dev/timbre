<script lang="ts">
	import type { PageData } from './$types';
	import type { ScanStatus } from '$lib/types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let musicDir = $state(data.musicDir);
	// svelte-ignore state_referenced_locally
	let stats = $state(data.stats);
	// svelte-ignore state_referenced_locally
	let scan = $state<ScanStatus>(data.scan);
	let saving = $state(false);
	let saved = $state(false);
	let poll: ReturnType<typeof setInterval> | null = null;
	let loud = $state<ScanStatus | null>(null);
	let loudPoll: ReturnType<typeof setInterval> | null = null;

	async function analyzeLoudness() {
		loud = await (await fetch('/api/loudness', { method: 'POST' })).json();
		if (loudPoll) clearInterval(loudPoll);
		loudPoll = setInterval(async () => {
			loud = await (await fetch('/api/loudness')).json();
			if (!loud?.running) {
				clearInterval(loudPoll!);
				loudPoll = null;
			}
		}, 700);
	}

	async function save() {
		saving = true;
		saved = false;
		const res = await fetch('/api/settings', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ musicDir })
		});
		const p = await res.json();
		stats = p.stats;
		musicDir = p.musicDir;
		saving = false;
		saved = true;
		setTimeout(() => (saved = false), 2000);
	}

	async function rescan() {
		const res = await fetch('/api/scan', { method: 'POST' });
		scan = await res.json();
		startPolling();
	}

	function startPolling() {
		if (poll) clearInterval(poll);
		poll = setInterval(async () => {
			scan = await (await fetch('/api/scan')).json();
			if (!scan.running) {
				clearInterval(poll!);
				poll = null;
				stats = (await (await fetch('/api/settings')).json()).stats;
			}
		}, 600);
	}

	$effect(() => {
		if (data.scan.running) startPolling();
		return () => poll && clearInterval(poll);
	});
</script>

<svelte:head><title>Settings · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Settings</h1>
	<p class="muted">Point Timbre at your music and build the library. Everything stays on this machine.</p>
</header>

<section class="card">
	<h2>Music library</h2>
	<label class="field">
		<span>Music folder</span>
		<input type="text" bind:value={musicDir} placeholder="/Users/you/Music or /music" spellcheck="false" />
	</label>
	<div class="row">
		<button class="btn btn-accent" onclick={save} disabled={saving}>
			{saving ? 'Saving…' : 'Save folder'}
		</button>
		<button class="btn" onclick={rescan} disabled={scan.running || !musicDir}>
			{scan.running ? 'Scanning…' : 'Rescan library'}
		</button>
		{#if saved}<span class="ok mono">saved ✓</span>{/if}
	</div>

	{#if scan.running}
		<div class="progress">
			<div class="bar" style:width={`${scan.total ? (scan.scanned / scan.total) * 100 : 0}%`}></div>
		</div>
		<p class="muted mono small">
			{scan.scanned} / {scan.total} files · +{scan.added} new · {scan.updated} updated
		</p>
	{:else if scan.error}
		<p class="err">Scan error: {scan.error}</p>
	{:else if scan.finishedAt}
		<p class="muted small">
			Last scan: +{scan.added} added · {scan.updated} updated · {scan.removed} removed
		</p>
	{/if}
</section>

<section class="card">
	<h2>Library</h2>
	<div class="stats">
		<div><strong class="mono">{stats.artists}</strong><span class="muted">artists</span></div>
		<div><strong class="mono">{stats.albums}</strong><span class="muted">albums</span></div>
		<div><strong class="mono">{stats.tracks}</strong><span class="muted">tracks</span></div>
	</div>
</section>

<section class="card">
	<h2>Volume leveling</h2>
	<p class="muted small" style="margin-top:0">
		Analyze each track's loudness (EBU R128, computed by Timbre's WASM kernel) so the player can
		play everything at a consistent volume. Needs <span class="mono">ffmpeg</span> on PATH.
	</p>
	<div class="row">
		<button class="btn" onclick={analyzeLoudness} disabled={loud?.running}>
			{loud?.running ? 'Analyzing…' : 'Analyze loudness'}
		</button>
		{#if loud && !loud.running && loud.finishedAt}
			<span class="ok mono">analyzed {loud.updated}/{loud.total} ✓</span>
		{/if}
	</div>
	{#if loud?.running}
		<div class="progress">
			<div class="bar" style:width={`${loud.total ? (loud.scanned / loud.total) * 100 : 0}%`}></div>
		</div>
		<p class="muted mono small">{loud.scanned} / {loud.total} tracks</p>
	{:else if loud?.error}
		<p class="err">{loud.error}</p>
	{/if}
</section>

<section class="card">
	<h2>About</h2>
	<ul class="about">
		<li>Search index: <span class="mono">{data.ftsAvailable ? 'FTS5' : 'LIKE (fallback)'}</span></li>
		<li>Volume leveling reads each track's analyzed loudness (run the loudness scan) and is toggled from the player bar.</li>
		<li class="faint">Multi-room (Snapcast) and the local-AI discovery brain are planned next.</li>
	</ul>
</section>

<style>
	.page-head {
		margin-bottom: 1.4rem;
	}
	.page-head h1 {
		font-size: 1.8rem;
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 1.2rem 1.3rem;
		margin-bottom: 1.1rem;
		max-width: 680px;
	}
	.card h2 {
		font-size: 1.05rem;
		margin-bottom: 0.9rem;
	}
	.field {
		display: block;
		margin-bottom: 0.9rem;
	}
	.field span {
		display: block;
		font-size: 0.82rem;
		color: var(--text-dim);
		margin-bottom: 0.35rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.ok {
		color: var(--good);
		font-size: 0.8rem;
	}
	.err {
		color: var(--bad);
		margin-top: 0.7rem;
	}
	.small {
		font-size: 0.8rem;
	}
	.progress {
		height: 6px;
		background: var(--surface-3);
		border-radius: 3px;
		overflow: hidden;
		margin-top: 1rem;
	}
	.bar {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s ease;
	}
	.stats {
		display: flex;
		gap: 2.4rem;
	}
	.stats div {
		display: flex;
		flex-direction: column;
	}
	.stats strong {
		font-size: 1.8rem;
		font-weight: 600;
	}
	.stats span {
		font-size: 0.8rem;
	}
	.about {
		margin: 0;
		padding-left: 1.1rem;
		color: var(--text-dim);
		font-size: 0.9rem;
		line-height: 1.7;
	}
</style>
