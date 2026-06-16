<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { player } from '$lib/audio/player.svelte';
	import { formatDuration, qualityLabel } from '$lib/format';
	import Cover from './Cover.svelte';

	let showQueue = $state(false);

	onMount(() => {
		player.hydrate();
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				goto('/search');
				return;
			}
			const el = e.target as HTMLElement;
			if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
			if (e.code === 'Space') {
				e.preventDefault();
				player.toggle();
			} else if (e.code === 'ArrowRight' && e.altKey) player.next();
			else if (e.code === 'ArrowLeft' && e.altKey) player.prev();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const cur = $derived(player.current);
	const pct = $derived(player.durationMs > 0 ? (player.positionMs / player.durationMs) * 100 : 0);

	// waveform overview (computed by the loudness WASM kernel), fetched per track
	let waveform = $state<number[]>([]);
	$effect(() => {
		const id = player.current?.id;
		if (id == null) {
			waveform = [];
			return;
		}
		let cancelled = false;
		fetch(`/api/tracks/${id}/waveform`)
			.then((r) => r.json())
			.then((d) => {
				if (!cancelled) waveform = d.peaks ?? [];
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});
</script>

<div class="dock" class:idle={!cur}>
	{#if cur}
		<div class="track">
			<a href={`/albums/${cur.albumId}`} class="art"><Cover albumId={cur.albumId} alt={cur.title} /></a>
			<div class="meta">
				<div class="title" title={cur.title}>{cur.title}</div>
				<a class="artist muted" href="/artists">{cur.artist}</a>
			</div>
			<div class="eq" class:on={player.playing} aria-hidden="true">
				{#each [0, 1, 2, 3] as b (b)}
					<span style:height={`${20 + player.level * 80 * (0.6 + ((b * 7) % 5) / 5)}%`}></span>
				{/each}
			</div>
		</div>

		<div class="center">
			<div class="transport">
				<button class="ico" class:active={player.shuffle} onclick={() => player.toggleShuffle()} title="Shuffle">⤮</button>
				<button class="ico" onclick={() => player.prev()} title="Previous">⏮</button>
				<button class="play" onclick={() => player.toggle()} title="Play / Pause (Space)">
					{player.playing ? '⏸' : '▶'}
				</button>
				<button class="ico" onclick={() => player.next()} title="Next">⏭</button>
				<button class="ico" class:active={player.repeat !== 'off'} onclick={() => player.cycleRepeat()} title={`Repeat: ${player.repeat}`}>
					{player.repeat === 'one' ? '🔂' : '🔁'}
				</button>
			</div>
			<div class="scrub">
				<span class="mono t">{formatDuration(player.positionMs)}</span>
				<div class="seek" class:has-wave={waveform.length > 0}>
					{#if waveform.length}
						<div class="wave" aria-hidden="true">
							{#each waveform as h, i (i)}
								<span
									class="wb"
									class:played={i / waveform.length <= pct / 100}
									style:height={`${Math.max(7, h * 100)}%`}
								></span>
							{/each}
						</div>
					{/if}
					<input
						type="range"
						min="0"
						max={Math.max(1, player.durationMs)}
						value={player.positionMs}
						oninput={(e) => player.seek(+(e.currentTarget as HTMLInputElement).value)}
						style:--pct={`${pct}%`}
					/>
				</div>
				<span class="mono t">{formatDuration(player.durationMs)}</span>
			</div>
		</div>

		<div class="right">
			<span class="chip">{qualityLabel(cur)}</span>
			<button class="ico" class:active={player.leveling} onclick={() => player.toggleLeveling()} title="Volume leveling (ReplayGain)">⚖</button>
			<button class="ico" class:active={showQueue} onclick={() => (showQueue = !showQueue)} title="Queue">≣</button>
			<div class="vol">
				<span class="ico-static">🔈</span>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={player.volume}
					oninput={(e) => player.setVolume(+(e.currentTarget as HTMLInputElement).value)}
				/>
			</div>
		</div>
	{:else}
		<div class="idle-msg muted">Nothing playing — pick an album to start.</div>
	{/if}

	{#if showQueue}
		<div class="queue-panel">
			<header>
				<strong>Queue</strong>
				<div>
					<button class="btn btn-ghost" onclick={() => player.clearQueue()}>Clear</button>
					<button class="btn btn-ghost" onclick={() => (showQueue = false)}>✕</button>
				</div>
			</header>
			<ol>
				{#each player.queue as t, i (t.id + '-' + i)}
					<li class:now={i === player.index}>
						<button class="q-track" onclick={() => player.playQueueAt(i)}>
							<span class="q-idx mono">{i === player.index ? '▶' : i + 1}</span>
							<span class="q-title">{t.title}</span>
							<span class="q-artist muted">{t.artist}</span>
						</button>
						<button class="ico sm" onclick={() => player.removeAt(i)} title="Remove">✕</button>
					</li>
				{:else}
					<li class="muted empty">Queue is empty.</li>
				{/each}
			</ol>
		</div>
	{/if}
</div>

<style>
	.dock {
		position: fixed;
		bottom: 0;
		left: var(--sidebar-w);
		right: 0;
		height: var(--dock-h);
		display: grid;
		grid-template-columns: minmax(220px, 1fr) minmax(320px, 2fr) minmax(220px, 1fr);
		align-items: center;
		gap: 1rem;
		padding: 0 1.4rem;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(14px);
		border-top: 1px solid var(--border);
		z-index: 30;
	}
	.dock.idle {
		grid-template-columns: 1fr;
	}
	.idle-msg {
		text-align: center;
		font-size: 0.9rem;
	}

	.track {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		min-width: 0;
	}
	.art {
		width: 52px;
		flex: none;
		border-radius: var(--radius-sm);
		overflow: hidden;
		box-shadow: var(--shadow-sm);
	}
	.meta {
		min-width: 0;
	}
	.title {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.artist {
		font-size: 0.82rem;
	}
	.artist:hover {
		color: var(--text);
	}

	.eq {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 22px;
		margin-left: auto;
		opacity: 0.35;
	}
	.eq.on {
		opacity: 1;
	}
	.eq span {
		width: 3px;
		background: var(--accent);
		border-radius: 2px;
		height: 20%;
		transition: height 0.08s linear;
	}

	.center {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.transport {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	.ico,
	.ico-static {
		background: none;
		border: none;
		color: var(--text-dim);
		font-size: 1rem;
		padding: 0.25rem;
		border-radius: 6px;
		line-height: 1;
	}
	.ico:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.ico.active {
		color: var(--accent);
	}
	.ico.sm {
		font-size: 0.78rem;
	}
	.play {
		background: var(--accent);
		color: var(--accent-contrast);
		border: none;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		font-size: 1rem;
		display: grid;
		place-items: center;
	}
	.play:hover {
		background: var(--accent-strong);
	}

	.scrub {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.scrub .t {
		font-size: 0.72rem;
		color: var(--text-faint);
		width: 3.2ch;
		text-align: center;
	}
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(
			to right,
			var(--accent) 0%,
			var(--accent) var(--pct, 0%),
			var(--surface-3) var(--pct, 0%)
		);
		cursor: pointer;
	}
	.vol input[type='range'] {
		background: var(--surface-3);
		width: 90px;
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--text);
		box-shadow: 0 0 0 3px var(--surface);
	}
	input[type='range']::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border: none;
		border-radius: 50%;
		background: var(--text);
	}

	.seek {
		position: relative;
		flex: 1;
		display: flex;
		align-items: center;
		height: 26px;
	}
	.seek input[type='range'] {
		position: relative;
		z-index: 2;
	}
	.seek.has-wave input[type='range'] {
		background: transparent;
	}
	.wave {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		gap: 1px;
		pointer-events: none;
	}
	.wb {
		flex: 1;
		min-width: 1px;
		background: var(--surface-3);
		border-radius: 1px;
	}
	.wb.played {
		background: var(--accent-dim);
	}

	.right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.vol {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.queue-panel {
		position: absolute;
		right: 1rem;
		bottom: calc(var(--dock-h) + 0.5rem);
		width: 360px;
		max-height: 60vh;
		overflow: auto;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	.queue-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.7rem 0.9rem;
		border-bottom: 1px solid var(--border-soft);
		position: sticky;
		top: 0;
		background: var(--surface-2);
	}
	.queue-panel ol {
		list-style: none;
		margin: 0;
		padding: 0.4rem;
	}
	.queue-panel li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		border-radius: 6px;
	}
	.queue-panel li.now {
		background: var(--surface-3);
	}
	.queue-panel li.empty {
		padding: 1rem;
		justify-content: center;
	}
	.q-track {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		background: none;
		border: none;
		color: inherit;
		text-align: left;
		padding: 0.45rem 0.5rem;
		min-width: 0;
	}
	.q-idx {
		width: 1.5rem;
		color: var(--text-faint);
		font-size: 0.78rem;
		flex: none;
	}
	.q-title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.q-artist {
		font-size: 0.78rem;
		max-width: 38%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (max-width: 680px) {
		.dock {
			left: 0;
			bottom: 56px;
			grid-template-columns: 1fr auto;
			height: 64px;
			padding: 0 0.8rem;
		}
		.center .scrub,
		.right .chip,
		.right .vol {
			display: none;
		}
		.queue-panel {
			right: 0.5rem;
			left: 0.5rem;
			width: auto;
		}
	}
</style>
