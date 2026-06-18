<script lang="ts">
	import type { PageData } from './$types';
	import type { ScanStatus, LastfmStatus, Scrobble } from '$lib/types';

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

	// ── Last.fm scrobbling ───────────────────────────────────────────────────
	// svelte-ignore state_referenced_locally
	let lf = $state<LastfmStatus>(data.lastfm);
	// svelte-ignore state_referenced_locally
	let scrobbles = $state<Scrobble[]>(data.scrobbles);
	let lfToken = $state<string | null>(null); // pending auth token between the two connect steps
	let lfBusy = $state(false);
	let lfError = $state<string | null>(null);

	async function lfPost(action: string, extra: Record<string, unknown> = {}) {
		const res = await fetch('/api/lastfm', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ...extra })
		});
		if (!res.ok) {
			const p = await res.json().catch(() => ({}));
			throw new Error(p.message || 'Last.fm request failed.');
		}
		return res.json();
	}

	async function startConnect() {
		lfBusy = true;
		lfError = null;
		try {
			const { token, url } = await lfPost('connect');
			lfToken = token;
			window.open(url, '_blank', 'noopener'); // user authorizes Timbre over on Last.fm
		} catch (e) {
			lfError = (e as Error).message;
		} finally {
			lfBusy = false;
		}
	}

	async function finishConnect() {
		if (!lfToken) return;
		lfBusy = true;
		lfError = null;
		try {
			lf = await lfPost('session', { token: lfToken });
			lfToken = null;
			await refreshScrobbles();
		} catch {
			lfError = 'Authorization not completed yet — approve Timbre on Last.fm, then try again.';
		} finally {
			lfBusy = false;
		}
	}

	async function disconnectLastfm() {
		lfBusy = true;
		lfError = null;
		try {
			lf = await lfPost('disconnect');
			lfToken = null;
		} catch (e) {
			lfError = (e as Error).message;
		} finally {
			lfBusy = false;
		}
	}

	async function retryQueue() {
		lfBusy = true;
		lfError = null;
		try {
			const p = await (await fetch('/api/scrobble', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ flush: true })
			})).json();
			if (p.status) lf = p.status;
			await refreshScrobbles();
		} finally {
			lfBusy = false;
		}
	}

	async function refreshScrobbles() {
		const p = await (await fetch('/api/scrobble')).json();
		if (p.status) lf = p.status;
		scrobbles = p.scrobbles ?? scrobbles;
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
	<h2>Last.fm scrobbling</h2>
	<p class="muted small" style="margin-top:0">
		Scrobble what you play to your <strong>Last.fm</strong> profile. Opt-in, and the only cloud
		connection in Timbre — plays are logged locally and retried if Last.fm is unreachable, so
		nothing is lost offline.
	</p>

	{#if !lf.configured}
		<p class="muted small">
			Set <span class="mono">LASTFM_API_KEY</span> and <span class="mono">LASTFM_API_SECRET</span>
			in your <span class="mono">.env</span> (create a key at
			<a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener">last.fm/api/account/create</a>),
			then restart Timbre.
		</p>
	{:else if lf.connected}
		<p class="muted small">
			Connected as <strong>{lf.user || 'your account'}</strong>{#if lf.fake}
				<span class="faint">(test mode)</span>{/if}.
			{#if lf.pending > 0}<span class="faint"> · {lf.pending} queued</span>{/if}
		</p>
		<div class="row">
			<button class="btn" onclick={disconnectLastfm} disabled={lfBusy}>Disconnect</button>
			{#if lf.pending > 0}
				<button class="btn" onclick={retryQueue} disabled={lfBusy}>
					{lfBusy ? 'Retrying…' : `Retry ${lf.pending} queued`}
				</button>
			{/if}
		</div>
	{:else if !lfToken}
		<div class="row">
			<button class="btn btn-accent" onclick={startConnect} disabled={lfBusy}>
				{lfBusy ? 'Starting…' : 'Connect Last.fm'}
			</button>
		</div>
	{:else}
		<p class="muted small">A Last.fm tab opened — approve Timbre there, then finish here:</p>
		<div class="row">
			<button class="btn btn-accent" onclick={finishConnect} disabled={lfBusy}>
				{lfBusy ? 'Finishing…' : 'I’ve authorized — finish'}
			</button>
			<button class="btn" onclick={() => (lfToken = null)} disabled={lfBusy}>Cancel</button>
		</div>
	{/if}

	{#if lfError}<p class="err">{lfError}</p>{/if}

	{#if scrobbles.length}
		<ul class="scrobbles">
			{#each scrobbles as s (s.id)}
				<li>
					<span class="s-state {s.state}" title={s.error ?? s.state}></span>
					<span class="s-title">{s.title}</span>
					<span class="s-artist muted">{s.artist}</span>
				</li>
			{/each}
		</ul>
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
	.scrobbles {
		list-style: none;
		margin: 0.9rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.scrobbles li {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.85rem;
	}
	.s-state {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: none;
		background: var(--text-faint);
	}
	.s-state.sent {
		background: var(--good);
	}
	.s-state.pending {
		background: var(--warn, #d08770);
	}
	.s-state.failed {
		background: var(--bad);
	}
	.s-title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 55%;
	}
	.s-artist {
		font-size: 0.8rem;
	}
</style>
