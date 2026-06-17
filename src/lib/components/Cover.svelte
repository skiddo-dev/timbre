<script lang="ts">
	// Album cover with a graceful placeholder. Art is served by /api/art/[albumId];
	// if a track has no embedded/fetched art we draw a tinted monogram instead.
	let {
		albumId,
		hasArt = true,
		alt = '',
		radius = 'var(--radius-sm)'
	}: { albumId: number | null; hasArt?: boolean; alt?: string; radius?: string } = $props();

	let failed = $state(false);
	const show = $derived(albumId != null && hasArt && !failed);
	const initial = $derived((alt.trim()[0] || '♪').toUpperCase());
	// deterministic hue from the title so placeholders read as designed, not broken
	const hue = $derived(
		[...alt].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
	);
</script>

<div
	class="cover"
	class:placeholder={!show}
	style:border-radius={radius}
	style:--h={hue}
	aria-label={alt}
>
	{#if show}
		<img
			src={`/api/art/${albumId}`}
			{alt}
			loading="lazy"
			onerror={() => (failed = true)}
		/>
	{:else}
		<span class="ph">{initial}</span>
	{/if}
</div>

<style>
	.cover {
		position: relative;
		width: 100%;
		aspect-ratio: 1 / 1;
		overflow: hidden;
		background: linear-gradient(145deg, var(--surface-3), var(--surface));
		display: grid;
		place-items: center;
	}
	.cover.placeholder {
		background:
			radial-gradient(120% 120% at 30% 20%, hsl(var(--h) 32% 24%), transparent 70%),
			linear-gradient(150deg, hsl(var(--h) 26% 20%), hsl(calc(var(--h) + 40) 22% 12%));
	}
	.cover.placeholder .ph {
		color: hsl(var(--h) 55% 82%);
		opacity: 0.85;
	}
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.ph {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: clamp(1.2rem, 40cqw, 3rem);
		color: var(--text-faint);
		opacity: 0.55;
	}
</style>
