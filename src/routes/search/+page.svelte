<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { Track } from '$lib/types';
	import AlbumGrid from '$lib/components/AlbumGrid.svelte';
	import ArtistAvatar from '$lib/components/ArtistAvatar.svelte';
	import TrackRow from '$lib/components/TrackRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { player } from '$lib/audio/player.svelte';

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let q = $state(data.q); // editable copy; server nav updates data.q, not this
	let input: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout>;
	let mode = $state<'search' | 'ask'>('search');
	let asking = $state(false);
	let askTracks = $state<Track[]>([]);
	let askNote = $state('');

	onMount(() => input?.focus());

	function onInput() {
		if (mode !== 'search') return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			goto(`/search?q=${encodeURIComponent(q)}`, { keepFocus: true, noScroll: true, replaceState: true });
		}, 220);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && mode === 'ask') runAsk();
	}

	async function runAsk() {
		const query = q.trim();
		if (!query) return;
		asking = true;
		try {
			const res = await fetch(`/api/ai/ask?q=${encodeURIComponent(query)}`);
			const d = await res.json();
			askTracks = d.tracks ?? [];
			askNote = d.note ?? '';
		} finally {
			asking = false;
		}
	}

	const r = $derived(data.results);
	const hasResults = $derived(r.artists.length + r.albums.length + r.tracks.length > 0);
</script>

<svelte:head><title>Search · Timbre</title></svelte:head>

<div class="modes">
	<button class="mode" class:active={mode === 'search'} onclick={() => (mode = 'search')}>Search</button>
	<button class="mode" class:active={mode === 'ask'} onclick={() => (mode = 'ask')}><Icon name="spark" size={15} /> Ask AI</button>
</div>

<div class="searchbar">
	<span class="ico"><Icon name={mode === 'ask' ? 'spark' : 'search'} size={18} /></span>
	<input
		bind:this={input}
		bind:value={q}
		oninput={onInput}
		onkeydown={onKey}
		type="search"
		placeholder={mode === 'ask'
			? 'Describe a vibe, then press Enter — “mellow jazz for a rainy evening”'
			: 'Search artists, albums, tracks…'}
		autocomplete="off"
		spellcheck="false"
	/>
	{#if mode === 'ask'}
		<button class="ask-go" onclick={runAsk} disabled={asking}>{asking ? '…' : 'Ask'}</button>
	{/if}
</div>

{#if mode === 'ask'}
	{#if asking}
		<p class="hint muted">Thinking…</p>
	{:else if askTracks.length}
		<section>
			<div class="ask-head">
				<p class="note">{askNote}</p>
				<button class="btn" onclick={() => player.playContext(askTracks, 0)}><Icon name="play" size={15} /> Play all</button>
			</div>
			<div class="tracks">
				{#each askTracks as t, i (t.id)}
					<TrackRow track={t} index={i + 1} showArtist onplay={() => player.playContext(askTracks, i)} />
				{/each}
			</div>
		</section>
	{:else if askNote}
		<p class="hint muted">No matches — try “Analyze with AI” in Settings, or rephrase.</p>
	{:else}
		<p class="hint muted">
			Ask for a mood, era, or activity. Tip: run “Analyze with AI” in Settings first for the best results.
		</p>
	{/if}
{:else if !data.q}
	<p class="hint muted">Start typing to search your library.</p>
{:else if !hasResults}
	<p class="hint muted">No matches for “{data.q}”.</p>
{:else}
	{#if r.artists.length}
		<section>
			<h2>Artists</h2>
			<div class="artist-row">
				{#each r.artists as a (a.id)}
					<a class="ar" href={`/artists/${a.id}`}>
						<div class="ar-av"><ArtistAvatar artist={a} /></div>
						<span>{a.name}</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if r.albums.length}
		<section>
			<h2>Albums</h2>
			<AlbumGrid albums={r.albums} />
		</section>
	{/if}

	{#if r.tracks.length}
		<section>
			<h2>Tracks</h2>
			<div class="tracks">
				{#each r.tracks as t, i (t.id)}
					<TrackRow track={t} index={i + 1} showArtist onplay={() => player.playContext(r.tracks, i)} />
				{/each}
			</div>
		</section>
	{/if}
{/if}

<style>
	.searchbar {
		position: relative;
		max-width: 620px;
		margin-bottom: 1.8rem;
	}
	.searchbar .ico {
		position: absolute;
		display: flex;
		align-items: center;
		left: 0.8rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-faint);
	}
	.searchbar input {
		padding-left: 2.4rem;
		padding-right: 4.5rem;
		font-size: 1.05rem;
		height: 3rem;
	}
	.ask-go {
		position: absolute;
		right: 0.4rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 2;
		background: var(--accent);
		color: var(--accent-contrast);
		border: none;
		border-radius: var(--radius-sm);
		padding: 0.45rem 0.95rem;
		font-weight: 600;
		font-size: 0.85rem;
	}
	.ask-go:hover {
		background: var(--accent-strong);
	}
	.modes {
		display: flex;
		gap: 0.3rem;
		margin-bottom: 0.8rem;
	}
	.mode {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.9rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		font-size: 0.85rem;
		font-weight: 500;
	}
	.mode:hover {
		color: var(--text);
	}
	.mode.active {
		background: var(--accent);
		color: var(--accent-contrast);
		border-color: transparent;
	}
	.ask-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.9rem;
	}
	.note {
		margin: 0;
		color: var(--text-dim);
		font-style: italic;
	}
	.hint {
		margin-top: 2rem;
	}
	section {
		margin-bottom: 2.2rem;
	}
	section h2 {
		font-size: 1.1rem;
		margin-bottom: 1rem;
	}
	.artist-row {
		display: flex;
		gap: 1.4rem;
		flex-wrap: wrap;
	}
	.ar {
		width: 110px;
		text-align: center;
	}
	.ar-av {
		width: 110px;
	}
	.ar span {
		display: block;
		margin-top: 0.5rem;
		font-size: 0.85rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tracks {
		max-width: 820px;
	}
</style>
