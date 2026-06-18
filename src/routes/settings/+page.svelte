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

	let tags = $state<ScanStatus | null>(null);
	let tagPoll: ReturnType<typeof setInterval> | null = null;
	async function analyzeTags() {
		tags = await (await fetch('/api/ai/tag', { method: 'POST' })).json();
		if (tagPoll) clearInterval(tagPoll);
		tagPoll = setInterval(async () => {
			tags = await (await fetch('/api/ai/tag')).json();
			if (!tags?.running) {
				clearInterval(tagPoll!);
				tagPoll = null;
			}
		}, 700);
	}

	interface ImportResult {
		matched: number;
		ratings: number;
		playCounts: number;
		playlists: number;
		unmatched: number;
		error: string | null;
	}
	let xmlPath = $state('~/Music/Music/Library.xml');
	let importing = $state(false);
	let importResult = $state<ImportResult | null>(null);
	async function importLibrary() {
		importing = true;
		importResult = null;
		try {
			importResult = await (await fetch('/api/applemusic/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: xmlPath })
			})).json();
		} finally {
			importing = false;
		}
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
	<h2>Discovery (AI)</h2>
	<p class="muted small" style="margin-top:0">
		Tag every album with a genre, mood and a one-line vibe using your local model (Ollama on the
		3090/M5). Powers <strong>Radio</strong> and natural-language <strong>Ask</strong> search. Works
		offline with a built-in heuristic when no model is configured.
	</p>
	<div class="row">
		<button class="btn" onclick={analyzeTags} disabled={tags?.running}>
			{tags?.running ? 'Analyzing…' : 'Analyze with AI'}
		</button>
		{#if tags && !tags.running && tags.finishedAt}
			<span class="ok mono">tagged {tags.updated}/{tags.total} ✓</span>
		{/if}
	</div>
	{#if tags?.running}
		<div class="progress">
			<div class="bar" style:width={`${tags.total ? (tags.scanned / tags.total) * 100 : 0}%`}></div>
		</div>
		<p class="muted mono small">{tags.scanned} / {tags.total} albums</p>
	{:else if tags?.error}
		<p class="err">{tags.error}</p>
	{/if}
</section>

<section class="card">
	<h2>Apple Music / iTunes library</h2>
	<p class="muted small" style="margin-top:0">
		Import <strong>playlists, star ratings and play counts</strong> from your Music library. First
		set your music folder above and rescan, then export the XML from Music
		(Settings → Advanced → “Share Library XML…”) and point to it here. Apple Music subscription
		downloads are DRM-protected and are skipped.
	</p>
	<label class="field">
		<span>Library XML path</span>
		<input type="text" bind:value={xmlPath} placeholder="~/Music/Music/Library.xml" spellcheck="false" />
	</label>
	<div class="row">
		<button class="btn btn-accent" onclick={importLibrary} disabled={importing}>
			{importing ? 'Importing…' : 'Import library'}
		</button>
	</div>
	{#if importResult}
		{#if importResult.error}
			<p class="err">{importResult.error}</p>
		{:else}
			<p class="muted small">
				Matched {importResult.matched} tracks · {importResult.ratings} ratings ·
				{importResult.playCounts} play counts · {importResult.playlists} playlists imported.
				{#if importResult.unmatched}<br /><span class="faint">{importResult.unmatched} not in the library — scan their folder first.</span>{/if}
			</p>
		{/if}
	{/if}
</section>

<section class="card">
	<h2>Usenet</h2>
	<p class="muted small" style="margin-top:0">
		Search Newznab indexers and download releases straight into your library. Add a
		<strong>SABnzbd</strong> client (<span class="mono">SABNZBD_URL</span> +
		<span class="mono">SABNZBD_API_KEY</span>) for PAR2 repair + unrar, or an
		<strong>NNTP</strong> provider (<span class="mono">NNTP_HOST…</span>) for the built-in yEnc
		fallback. Manage indexers and grabs on the <a href="/usenet">Usenet</a> page.
	</p>
	<div class="row" style="flex-wrap:wrap; gap:0.5rem; margin-top:0.4rem">
		<span class="u-pill" class:on={data.usenet.sab}>{data.usenet.sab ? '●' : '○'} SABnzbd client</span>
		<span class="u-pill" class:on={data.usenet.nntp}>{data.usenet.nntp ? '●' : '○'} NNTP fallback</span>
		<span class="u-pill" class:on={data.usenet.indexers > 0}>
			{data.usenet.indexers} indexer{data.usenet.indexers === 1 ? '' : 's'}
		</span>
	</div>
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
	.u-pill {
		font-size: 0.76rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--border-soft);
		color: var(--text-faint);
	}
	.u-pill.on {
		color: var(--text);
		border-color: var(--accent-dim);
	}
</style>
