<script lang="ts">
	import { ICONS, FILLS, SOLID, type IconName } from '$lib/icons';

	// One glyph from Timbre's custom set ($lib/icons.ts). Most glyphs are duotone
	// — a soft `currentColor` wash (FILLS) behind crisp stroke line-work — while
	// the transport controls and the rating star are solid silhouettes (SOLID).
	// Everything rides `currentColor`, so an icon tints with its surrounding text
	// and hover/active state. Decorative by default; pass `label` only when the
	// icon stands alone with no adjacent text.
	let {
		name,
		size = 18,
		label,
		class: klass = ''
	}: { name: IconName; size?: number; label?: string; class?: string } = $props();

	const solid = $derived(SOLID.has(name));
	const fill = $derived(FILLS[name]);
</script>

<svg
	class={`t-icon ${klass}`}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={solid ? 'currentColor' : 'none'}
	stroke={solid ? 'none' : 'currentColor'}
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : true}
>
	{#if !solid && fill}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static markup from $lib/icons.ts only -->
		<g class="t-icon-fill">{@html fill}</g>
	{/if}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static markup from $lib/icons.ts only -->
	{@html ICONS[name]}
</svg>

<style>
	.t-icon {
		flex-shrink: 0;
		vertical-align: -0.18em;
	}
	/* Duotone body wash — same hue as the stroke (currentColor), low opacity,
	   no outline of its own. Renders first so the crisp stroke sits on top. */
	.t-icon-fill {
		fill: currentColor;
		fill-opacity: 0.16;
		stroke: none;
	}
</style>
