<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { UsenetIndexer, UsenetDownload, UsenetResult, UsenetEngines } from '$lib/types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let indexers = $state<UsenetIndexer[]>(data.indexers);
	// svelte-ignore state_referenced_locally
	let downloads = $state<UsenetDownload[]>(data.downloads);
	// svelte-ignore state_referenced_locally
	let engines = $state<UsenetEngines>(data.engines);

	let query = $state('');
	let searching = $state(false);
	let searched = $state(false);
	let results = $state<UsenetResult[]>([]);
	let searchError = $state('');
	let grabbing = $state<Record<string, boolean>>({});
	let grabEngine = $state<'' | 'sab' | 'nntp'>(''); // '' = auto (SABnzbd if available)

	// indexer form
	let ixName = $state('');
	let ixUrl = $state('');
	let ixKey = $state('');
	let ixAdding = $state(false);
	let ixError = $state('');

	const ACTIVE = new Set(['queued', 'downloading', 'verifying', 'extracting', 'importing']);
	const anyActive = $derived(downloads.some((d) => ACTIVE.has(d.status)));
	const noEngine = $derived(!engines.sab && !engines.nntp);

	function applyStatus(s: { indexers: UsenetIndexer[]; downloads: UsenetDownload[]; engines: UsenetEngines }) {
		indexers = s.indexers;
		downloads = s.downloads;
		engines = s.engines;
	}

	async function refresh() {
		try {
			applyStatus(await (await fetch('/api/usenet')).json());
		} catch {
			/* transient; next tick retries */
		}
	}

	async function post(body: Record<string, unknown>) {
		const res = await fetch('/api/usenet', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const d = await res.json();
		if (d.error) return d.error as string;
		applyStatus(d);
		return '';
	}

	async function search() {
		const q = query.trim();
		if (!q) return;
		searching = true;
		searchError = '';
		try {
			const res = await fetch(`/api/usenet/search?q=${encodeURIComponent(q)}`);
			const d = await res.json();
			results = d.results ?? [];
			searchError = d.error ?? '';
			searched = true;
		} catch (e) {
			searchError = e instanceof Error ? e.message : String(e);
		} finally {
			searching = false;
		}
	}

	async function grab(r: UsenetResult) {
		grabbing = { ...grabbing, [r.guid]: true };
		try {
			await post({
				action: 'grab',
				title: r.title,
				nzbUrl: r.nzbUrl,
				indexerId: r.indexerId,
				sizeBytes: r.sizeBytes,
				category: r.category,
				engine: grabEngine || undefined
			});
		} finally {
			grabbing = { ...grabbing, [r.guid]: false };
		}
	}

	const cancel = (id: number) => post({ action: 'cancel', id });
	const clearFinished = () => post({ action: 'clear', id: 0 });
	const toggleIndexer = (ix: UsenetIndexer) => post({ action: 'setIndexerEnabled', id: ix.id, enabled: !ix.enabled });
	const removeIndexer = (id: number) => post({ action: 'removeIndexer', id });

	async function addIndexer() {
		ixAdding = true;
		ixError = '';
		try {
			const err = await post({ action: 'addIndexer', name: ixName, url: ixUrl, apiKey: ixKey });
			if (err) ixError = err;
			else ixName = ixUrl = ixKey = '';
		} finally {
			ixAdding = false;
		}
	}

	function fmtSize(bytes: number): string {
		if (!bytes) return '—';
		const u = ['B', 'KB', 'MB', 'GB', 'TB'];
		let n = bytes;
		let i = 0;
		while (n >= 1024 && i < u.length - 1) {
			n /= 1024;
			i++;
		}
		return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
	}

	const STATUS_LABEL: Record<string, string> = {
		queued: 'Queued',
		downloading: 'Downloading',
		verifying: 'Verifying',
		extracting: 'Extracting',
		importing: 'Importing',
		completed: 'Completed',
		failed: 'Failed'
	};

	// Poll while anything is in flight (and one extra beat after it settles).
	onMount(() => {
		const t = setInterval(() => {
			if (anyActive) refresh();
		}, 2000);
		return () => clearInterval(t);
	});
</script>

<svelte:head><title>Usenet · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Usenet</h1>
	<p class="muted">
		Search Newznab indexers, grab a release, and Timbre downloads it into your library.
	</p>
	<div class="engines">
		<span class="pill" class:on={engines.sab} title="SABnzbd / NZBGet download client">
			{engines.sab ? '●' : '○'} SABnzbd client
		</span>
		<span class="pill" class:on={engines.nntp} title="Built-in NNTP + yEnc engine">
			{engines.nntp ? '●' : '○'} NNTP fallback
		</span>
		<span class="pill" class:on={engines.indexers > 0} title="Enabled indexers">
			{engines.indexers} indexer{engines.indexers === 1 ? '' : 's'}
		</span>
	</div>
	{#if noEngine}
		<p class="warn">
			No download client configured. Add a SABnzbd client (<code class="mono">SABNZBD_URL</code> +
			<code class="mono">SABNZBD_API_KEY</code>) for PAR2 repair + unrar, or an NNTP provider
			(<code class="mono">NNTP_HOST…</code>) for the built-in fallback. Searching still works.
		</p>
	{/if}
</header>

<section class="search">
	<div class="search-row">
		<input
			type="search"
			bind:value={query}
			onkeydown={(e) => e.key === 'Enter' && search()}
			placeholder="Search releases — artist, album…"
			spellcheck="false"
		/>
		<button class="btn btn-accent" onclick={search} disabled={searching || !query.trim() || engines.indexers === 0}>
			{searching ? 'Searching…' : 'Search'}
		</button>
		{#if engines.sab && engines.nntp}
			<select class="engine-sel" bind:value={grabEngine} title="Which engine grabs handle">
				<option value="">Auto (SABnzbd)</option>
				<option value="sab">SABnzbd</option>
				<option value="nntp">NNTP direct</option>
			</select>
		{/if}
	</div>
	{#if engines.indexers === 0}
		<p class="muted hint">Add an indexer below to search.</p>
	{/if}
	{#if searchError}<p class="err">{searchError}</p>{/if}

	{#if results.length}
		<table class="results">
			<thead>
				<tr><th>Release</th><th class="r">Size</th><th class="r">Grabs</th><th>Indexer</th><th></th></tr>
			</thead>
			<tbody>
				{#each results as r (r.guid)}
					<tr>
						<td class="title" title={r.title}>{r.title}</td>
						<td class="r mono">{fmtSize(r.sizeBytes)}</td>
						<td class="r mono">{r.grabs ?? '—'}</td>
						<td class="muted">{r.indexerName}</td>
						<td class="r">
							<button class="btn btn-sm" onclick={() => grab(r)} disabled={grabbing[r.guid] || noEngine}>
								{grabbing[r.guid] ? '…' : 'Grab'}
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if searched && !searching}
		<p class="muted hint">No results.</p>
	{/if}
</section>

<section class="downloads">
	<div class="sec-head">
		<h2>Downloads <span class="count mono muted">{downloads.length}</span></h2>
		{#if downloads.some((d) => d.status === 'completed' || d.status === 'failed')}
			<button class="btn btn-sm ghost" onclick={clearFinished}>Clear finished</button>
		{/if}
	</div>
	{#if downloads.length === 0}
		<p class="muted hint">Nothing grabbed yet.</p>
	{:else}
		<ul class="dl-list">
			{#each downloads as d (d.id)}
				<li class="dl" class:failed={d.status === 'failed'} class:done={d.status === 'completed'}>
					<div class="dl-top">
						<span class="dl-title" title={d.title}>{d.title}</span>
						<span class="dl-status mono">{STATUS_LABEL[d.status] ?? d.status}</span>
						{#if ACTIVE.has(d.status)}
							<button class="rm" onclick={() => cancel(d.id)} title="Cancel">✕</button>
						{:else}
							<button class="rm" onclick={() => cancel(d.id)} title="Remove">✕</button>
						{/if}
					</div>
					<div class="bar"><div class="fill" style:width="{d.progress}%"></div></div>
					<div class="dl-meta muted mono">
						{#if d.engine}<span>{d.engine.toUpperCase()}</span>{/if}
						<span>{d.progress}%</span>
						{#if d.sizeBytes}<span>{fmtSize(d.bytesDone)} / {fmtSize(d.sizeBytes)}</span>{/if}
						{#if d.status === 'completed'}<span>{d.files} file{d.files === 1 ? '' : 's'} imported</span>{/if}
						{#if d.error}<span class="err">{d.error}</span>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="indexers">
	<h2>Indexers</h2>
	<ul class="ix-list">
		{#each indexers as ix (ix.id)}
			<li class="ix" class:off={!ix.enabled}>
				<button class="toggle" onclick={() => toggleIndexer(ix)} title={ix.enabled ? 'Disable' : 'Enable'}>
					{ix.enabled ? '●' : '○'}
				</button>
				<div class="ix-meta">
					<span class="ix-name">{ix.name}</span>
					<span class="ix-url muted mono">{ix.url}{ix.hasKey ? ' · key set' : ''}</span>
				</div>
				<button class="rm" onclick={() => removeIndexer(ix.id)} title="Remove">✕</button>
			</li>
		{:else}
			<li class="muted hint">No indexers yet. Add a Newznab-compatible one below.</li>
		{/each}
	</ul>
	<div class="ix-form">
		<input type="text" bind:value={ixName} placeholder="Name (e.g. NZBGeek)" />
		<input type="text" bind:value={ixUrl} placeholder="https://api.nzbgeek.info" spellcheck="false" />
		<input type="password" bind:value={ixKey} placeholder="API key" spellcheck="false" autocomplete="off" />
		<button class="btn btn-accent" onclick={addIndexer} disabled={ixAdding || !ixName || !ixUrl}>
			{ixAdding ? '…' : 'Add'}
		</button>
	</div>
	{#if ixError}<p class="err">{ixError}</p>{/if}
</section>

<style>
	.page-head {
		margin-bottom: 1.6rem;
	}
	.page-head h1 {
		font-size: 1.9rem;
	}
	.engines {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.8rem;
	}
	.pill {
		font-size: 0.78rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--border-soft);
		color: var(--text-faint);
		background: var(--surface);
	}
	.pill.on {
		color: var(--text);
		border-color: var(--accent-dim);
	}
	.warn {
		margin-top: 0.8rem;
		padding: 0.7rem 0.9rem;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border-soft);
		font-size: 0.85rem;
		line-height: 1.5;
	}
	section {
		margin-bottom: 2.2rem;
	}
	h2 {
		font-size: 1.05rem;
		margin-bottom: 0.7rem;
	}
	.sec-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.count {
		font-size: 0.9rem;
		font-weight: 400;
	}
	.hint {
		font-size: 0.85rem;
		margin-top: 0.5rem;
	}
	.err {
		color: var(--bad);
	}

	.search-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.5rem;
		max-width: 820px;
	}
	.engine-sel {
		font-size: 0.82rem;
		padding: 0 0.5rem;
	}
	.results {
		width: 100%;
		border-collapse: collapse;
		margin-top: 1rem;
		font-size: 0.85rem;
	}
	.results th {
		text-align: left;
		font-weight: 500;
		color: var(--text-faint);
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--border-soft);
	}
	.results td {
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--border-soft);
		vertical-align: middle;
	}
	.results .r {
		text-align: right;
		white-space: nowrap;
	}
	.results .title {
		max-width: 460px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dl-list,
	.ix-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.dl {
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 0.6rem 0.75rem;
	}
	.dl.done {
		border-color: var(--accent-dim);
	}
	.dl.failed {
		border-color: var(--bad);
	}
	.dl-top {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.dl-title {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dl-status {
		font-size: 0.75rem;
		color: var(--text-faint);
		flex: none;
	}
	.bar {
		height: 4px;
		border-radius: 2px;
		background: var(--surface-3);
		overflow: hidden;
		margin: 0.5rem 0 0.4rem;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.4s ease;
	}
	.dl-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
		font-size: 0.74rem;
	}

	.ix {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 0.5rem 0.7rem;
	}
	.ix.off {
		opacity: 0.55;
	}
	.toggle {
		flex: none;
		background: none;
		border: none;
		color: var(--accent);
		font-size: 0.9rem;
	}
	.ix.off .toggle {
		color: var(--text-faint);
	}
	.ix-meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.ix-name {
		font-weight: 600;
	}
	.ix-url {
		font-size: 0.74rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ix-form {
		display: grid;
		grid-template-columns: 1fr 1.5fr 1fr auto;
		gap: 0.5rem;
		margin-top: 0.9rem;
		max-width: 820px;
	}

	.rm {
		flex: none;
		background: none;
		border: none;
		color: var(--text-faint);
		font-size: 0.85rem;
	}
	.rm:hover {
		color: var(--bad);
	}
	.btn-sm {
		padding: 0.25rem 0.7rem;
		font-size: 0.8rem;
	}
	.ghost {
		background: var(--surface-3);
	}

	@media (max-width: 680px) {
		.ix-form {
			grid-template-columns: 1fr;
		}
		.results .title {
			max-width: 200px;
		}
	}
</style>
