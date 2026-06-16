<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import AlbumGrid from '$lib/components/AlbumGrid.svelte';
	import ArtistAvatar from '$lib/components/ArtistAvatar.svelte';
	import TrackRow from '$lib/components/TrackRow.svelte';
	import { player } from '$lib/audio/player.svelte';

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let q = $state(data.q); // editable copy; server nav updates data.q, not this
	let input: HTMLInputElement;
	let timer: ReturnType<typeof setTimeout>;

	onMount(() => input?.focus());

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			goto(`/search?q=${encodeURIComponent(q)}`, { keepFocus: true, noScroll: true, replaceState: true });
		}, 220);
	}

	const r = $derived(data.results);
	const hasResults = $derived(r.artists.length + r.albums.length + r.tracks.length > 0);
</script>

<svelte:head><title>Search · Timbre</title></svelte:head>

<div class="searchbar">
	<span class="ico">⌕</span>
	<input
		bind:this={input}
		bind:value={q}
		oninput={onInput}
		type="search"
		placeholder="Search artists, albums, tracks…"
		autocomplete="off"
		spellcheck="false"
	/>
</div>

{#if !data.q}
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
		left: 0.8rem;
		top: 50%;
		transform: translateY(-50%);
		color: var(--text-faint);
		font-size: 1.1rem;
	}
	.searchbar input {
		padding-left: 2.4rem;
		font-size: 1.05rem;
		height: 3rem;
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
