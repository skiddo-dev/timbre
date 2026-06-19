<script lang="ts">
	import type { PageData } from './$types';
	import type { RadioStation } from '$lib/types';
	import { player } from '$lib/audio/player.svelte';
	import { stationToTrack } from '$lib/stream';
	import Icon from '$lib/components/Icon.svelte';

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let stations = $state<RadioStation[]>(data.stations);
	let name = $state('');
	let url = $state('');
	let genre = $state('');
	let adding = $state(false);
	let error = $state('');

	const nowStreaming = $derived(player.current?.isStream ? player.current : null);

	function play(s: RadioStation) {
		player.playContext([stationToTrack(s)], 0);
	}

	async function add() {
		error = '';
		adding = true;
		try {
			const res = await fetch('/api/radio', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, url, genre })
			});
			const d = await res.json();
			if (d.error) {
				error = d.error;
			} else {
				stations = d.stations;
				name = url = genre = '';
			}
		} finally {
			adding = false;
		}
	}

	async function remove(id: number) {
		stations = (await (await fetch(`/api/radio?id=${id}`, { method: 'DELETE' })).json()).stations;
	}
</script>

<svelte:head><title>Radio · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Radio <span class="count mono muted">{stations.length}</span></h1>
	<p class="muted">Internet radio — the first non-local source. Add any direct stream URL.</p>
</header>

<div class="grid">
	{#each stations as s (s.id)}
		{@const playing = nowStreaming?.id === -s.id}
		<div class="station" class:playing>
			<button class="play" onclick={() => play(s)} title="Play" aria-label="Play">
				<span class="dial"><Icon name={playing && player.playing ? 'pause' : 'play'} size={15} /></span>
			</button>
			<div class="meta">
				<div class="name" title={s.name}>{s.name}</div>
				{#if s.genre}<div class="genre muted">{s.genre}</div>{/if}
			</div>
			<button class="rm" onclick={() => remove(s.id)} title="Remove" aria-label="Remove station"><Icon name="x" size={15} /></button>
		</div>
	{:else}
		<p class="muted">No stations yet — add one below.</p>
	{/each}
</div>

<section class="add">
	<h2>Add a station</h2>
	<div class="fields">
		<input type="text" bind:value={name} placeholder="Name" />
		<input type="text" bind:value={url} placeholder="https://stream.example/listen.mp3" spellcheck="false" />
		<input type="text" bind:value={genre} placeholder="Genre (optional)" />
		<button class="btn btn-accent" onclick={add} disabled={adding || !name || !url}>{adding ? '…' : 'Add'}</button>
	</div>
	{#if error}<p class="err">{error}</p>{/if}
</section>

<style>
	.page-head {
		margin-bottom: 1.4rem;
	}
	.page-head h1 {
		font-size: 1.9rem;
	}
	.count {
		font-size: 1rem;
		font-weight: 400;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.7rem;
		margin-bottom: 2rem;
	}
	.station {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 0.6rem 0.7rem;
	}
	.station.playing {
		border-color: var(--accent-dim);
	}
	.play {
		flex: none;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--surface-3);
		border: none;
		color: var(--text);
		display: grid;
		place-items: center;
	}
	.station.playing .play {
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.dial {
		font-size: 0.85rem;
	}
	.meta {
		flex: 1;
		min-width: 0;
	}
	.name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.genre {
		font-size: 0.78rem;
	}
	.rm {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--text-faint);
	}
	.rm:hover {
		color: var(--bad);
	}
	.add {
		max-width: 720px;
	}
	.add h2 {
		font-size: 1.05rem;
		margin-bottom: 0.7rem;
	}
	.fields {
		display: grid;
		grid-template-columns: 1fr 1.6fr 0.8fr auto;
		gap: 0.5rem;
	}
	.err {
		color: var(--bad);
		margin-top: 0.5rem;
	}
	@media (max-width: 680px) {
		.fields {
			grid-template-columns: 1fr;
		}
	}
</style>
