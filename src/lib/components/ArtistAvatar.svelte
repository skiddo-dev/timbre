<script lang="ts">
	import type { Artist } from '$lib/types';
	let { artist, round = true }: { artist: Artist; round?: boolean } = $props();
	let failed = $state(false);
	const show = $derived(artist.hasImage && !failed);
	const initial = $derived((artist.name.trim()[0] || '♪').toUpperCase());
</script>

<div class="avatar" class:round aria-label={artist.name}>
	{#if show}
		<img src={`/api/artist-image/${artist.id}`} alt={artist.name} loading="lazy" onerror={() => (failed = true)} />
	{:else}
		<span class="ph">{initial}</span>
	{/if}
</div>

<style>
	.avatar {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
		overflow: hidden;
		background: linear-gradient(145deg, var(--surface-3), var(--surface));
		display: grid;
		place-items: center;
		border-radius: var(--radius);
		container-type: inline-size;
	}
	.avatar.round {
		border-radius: 50%;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.ph {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(1.2rem, 38cqw, 2.6rem);
		color: var(--text-faint);
		opacity: 0.55;
	}
</style>
