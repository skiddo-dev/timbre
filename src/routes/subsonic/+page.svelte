<script lang="ts">
	import type { PageData } from './$types';
	import type { SubsonicAlbum, Track } from '$lib/types';
	import { player } from '$lib/audio/player.svelte';
	import { formatDuration } from '$lib/format';
	import Icon from '$lib/components/Icon.svelte';

	let { data }: { data: PageData } = $props();

	const TABS = [
		{ type: 'newest', label: 'Newest' },
		{ type: 'frequent', label: 'Most played' },
		{ type: 'recent', label: 'Recent' },
		{ type: 'alphabeticalByName', label: 'A–Z' },
		{ type: 'random', label: 'Random' }
	] as const;

	// svelte-ignore state_referenced_locally
	let albums = $state<SubsonicAlbum[]>(data.albums);
	let tab = $state<(typeof TABS)[number]['type']>('newest');
	let q = $state('');
	let loading = $state(false);
	let error = $state('');

	// the drilled-in album (tracks fetched on demand)
	let openId = $state<string | null>(null);
	let openTracks = $state<Track[]>([]);
	let openAlbum = $state<SubsonicAlbum | null>(null);

	const configured = $derived(data.status.configured);

	async function loadAlbums(type: (typeof TABS)[number]['type']) {
		tab = type;
		q = '';
		loading = true;
		error = '';
		try {
			const r = await fetch(`/api/subsonic?op=albums&type=${type}&size=36`);
			const d = await r.json();
			if (!r.ok) throw new Error(d.message || 'Browse failed');
			albums = d.albums ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let searchTracks = $state<Track[]>([]);
	function onSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		const query = q.trim();
		if (!query) {
			searchTracks = [];
			void loadAlbums(tab);
			return;
		}
		searchTimer = setTimeout(async () => {
			loading = true;
			error = '';
			try {
				const r = await fetch(`/api/subsonic?op=search&q=${encodeURIComponent(query)}`);
				const d = await r.json();
				if (!r.ok) throw new Error(d.message || 'Search failed');
				albums = d.albums ?? [];
				searchTracks = d.tracks ?? [];
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			} finally {
				loading = false;
			}
		}, 280);
	}

	async function open(album: SubsonicAlbum) {
		if (openId === album.id) {
			openId = null;
			return;
		}
		openId = album.id;
		openAlbum = album;
		openTracks = [];
		try {
			const r = await fetch(`/api/subsonic?op=album&id=${encodeURIComponent(album.id)}`);
			const d = await r.json();
			openTracks = d.tracks ?? [];
		} catch {
			openTracks = [];
		}
	}

	const playAll = (tracks: Track[], start = 0) => tracks.length && player.playContext(tracks, start);
</script>

<svelte:head><title>Streaming · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Streaming</h1>
	<p class="muted">
		A self-hosted Subsonic / OpenSubsonic library, streamed straight through Timbre's transport —
		no cloud, no subscription.
		{#if configured}
			<span class="chip ok">Connected · {data.status.user}@{data.status.url.replace(/^https?:\/\//, '')}</span>
		{/if}
	</p>
</header>

{#if !configured}
	<div class="empty card">
		<span class="big"><Icon name="stream" size={34} /></span>
		<h2>No server connected</h2>
		<p class="muted">
			Add your Subsonic server (Navidrome, Airsonic, Gonic…) in
			<a href="/settings">Settings</a> to browse and stream it here.
		</p>
	</div>
{:else}
	<div class="controls">
		<div class="tabs">
			{#each TABS as t (t.type)}
				<button class="tab" class:active={tab === t.type && !q} onclick={() => loadAlbums(t.type)}>{t.label}</button>
			{/each}
		</div>
		<div class="search">
			<Icon name="search" size={15} />
			<input type="text" bind:value={q} oninput={onSearch} placeholder="Search the remote library…" spellcheck="false" />
		</div>
	</div>

	{#if error}<p class="err">{error}</p>{/if}

	{#if q && searchTracks.length}
		<section class="songs">
			<h2>Tracks</h2>
			<ol>
				{#each searchTracks as t, i (t.id)}
					<li>
						<button class="song" onclick={() => playAll(searchTracks, i)}>
							<span class="q-idx"><Icon name="play" size={12} /></span>
							<span class="t-title">{t.title}</span>
							<span class="t-artist muted">{t.artist}</span>
							<span class="t-dur mono muted">{formatDuration(t.durationMs)}</span>
						</button>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<div class="grid" class:dim={loading}>
		{#each albums as al (al.id)}
			<div class="album-cell">
				<button class="album" class:open={openId === al.id} onclick={() => open(al)}>
					<div class="art">
						{#if al.coverArtUrl}
							<img src={al.coverArtUrl} alt={al.name} loading="lazy" />
						{:else}
							<span class="art-fallback"><Icon name="albums" size={28} /></span>
						{/if}
						<span class="play-badge"><Icon name="play" size={16} /></span>
					</div>
					<div class="name" title={al.name}>{al.name}</div>
					<div class="artist muted" title={al.artist}>{al.artist}{al.year ? ` · ${al.year}` : ''}</div>
				</button>

				{#if openId === al.id}
					<div class="tracks">
						<div class="tracks-head">
							<button class="btn btn-accent sm" onclick={() => playAll(openTracks, 0)} disabled={!openTracks.length}>
								<Icon name="play" size={13} /> Play album
							</button>
							<span class="muted sm">{openTracks.length} tracks</span>
						</div>
						<ol>
							{#each openTracks as t, i (t.id)}
								<li>
									<button class="song" onclick={() => playAll(openTracks, i)}>
										<span class="q-idx mono">{t.trackNo ?? i + 1}</span>
										<span class="t-title">{t.title}</span>
										<span class="t-dur mono muted">{formatDuration(t.durationMs)}</span>
									</button>
									<button class="ico sm" title="Add to queue" aria-label="Add to queue" onclick={() => player.enqueue(t)}>
										<Icon name="plus" size={13} />
									</button>
								</li>
							{:else}
								<li class="muted empty">No tracks.</li>
							{/each}
						</ol>
					</div>
				{/if}
			</div>
		{:else}
			<p class="muted">{loading ? 'Loading…' : 'No albums found.'}</p>
		{/each}
	</div>
{/if}

<style>
	.page-head {
		margin-bottom: 1.2rem;
	}
	.page-head h1 {
		font-size: 1.9rem;
	}
	.chip.ok {
		font-size: 0.72rem;
		margin-left: 0.5rem;
		color: var(--accent);
		border: 1px solid var(--accent-dim, color-mix(in srgb, var(--accent) 45%, transparent));
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}
	.empty {
		max-width: 460px;
		margin: 3rem auto;
		text-align: center;
		padding: 2rem;
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}
	.empty .big {
		color: var(--accent);
		display: inline-flex;
	}
	.empty h2 {
		margin: 0.6rem 0 0.3rem;
	}
	.controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.2rem;
		flex-wrap: wrap;
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}
	.tab {
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		color: var(--text-dim);
		border-radius: 999px;
		padding: 0.32rem 0.8rem;
		font-size: 0.82rem;
	}
	.tab.active {
		background: var(--accent);
		color: var(--accent-contrast);
		border-color: transparent;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		padding: 0.35rem 0.6rem;
		color: var(--text-faint);
	}
	.search input {
		border: none;
		background: none;
		color: var(--text);
		min-width: 220px;
	}
	.search input:focus {
		outline: none;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 1rem;
		align-items: start;
	}
	.grid.dim {
		opacity: 0.55;
	}
	.album {
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		padding: 0;
		width: 100%;
		display: block;
	}
	.art {
		position: relative;
		aspect-ratio: 1;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--surface-3);
		box-shadow: var(--shadow-sm);
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.art-fallback {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--text-faint);
	}
	.play-badge {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-contrast);
		display: grid;
		place-items: center;
		opacity: 0;
		transform: translateY(6px);
		transition: opacity 0.15s ease, transform 0.15s ease;
		box-shadow: var(--shadow);
	}
	.album:hover .play-badge {
		opacity: 1;
		transform: none;
	}
	.name {
		font-weight: 600;
		margin-top: 0.5rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.artist {
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tracks {
		margin-top: 0.5rem;
		background: var(--surface-2);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		padding: 0.5rem;
	}
	.tracks-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.2rem 0.3rem 0.5rem;
	}
	.btn.sm,
	.ico.sm {
		font-size: 0.78rem;
		padding: 0.3rem 0.6rem;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.songs {
		margin-bottom: 1.6rem;
	}
	.songs h2 {
		font-size: 1rem;
		margin-bottom: 0.4rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.song {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		padding: 0.4rem 0.4rem;
		border-radius: 6px;
		min-width: 0;
	}
	.song:hover {
		background: var(--surface-3);
	}
	.q-idx {
		width: 1.6rem;
		text-align: center;
		color: var(--text-faint);
		font-size: 0.78rem;
		flex: none;
		display: inline-flex;
		justify-content: center;
	}
	.t-title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.t-artist {
		font-size: 0.8rem;
		max-width: 40%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.t-dur {
		font-size: 0.76rem;
	}
	.ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--text-faint);
		border-radius: 6px;
	}
	.ico:hover {
		color: var(--text);
		background: var(--surface-3);
	}
	.err {
		color: var(--bad);
		margin-bottom: 1rem;
	}
	.empty.card .big {
		font-size: 2rem;
	}
	li.empty {
		padding: 0.6rem;
		justify-content: center;
	}
</style>
