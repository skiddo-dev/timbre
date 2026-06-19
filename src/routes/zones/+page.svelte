<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { ZoneStatus } from '$lib/types';
	import { player } from '$lib/audio/player.svelte';
	import Icon from '$lib/components/Icon.svelte';

	interface CastStatus {
		ready: boolean;
		casting: boolean;
		index: number;
		queueLength: number;
		currentTrackId: number | null;
		error: string | null;
	}

	let { data }: { data: PageData } = $props();
	// svelte-ignore state_referenced_locally
	let zones = $state<ZoneStatus>(data.zones);
	let cast = $state<CastStatus | null>(null);
	let poll: ReturnType<typeof setInterval> | null = null;
	let es: EventSource | null = null;

	interface AirStatus {
		enabled: boolean;
		casting: boolean;
		deviceId: string | null;
		devices?: { id: string; name: string; address: string }[];
	}
	let air = $state<AirStatus | null>(null);
	let scanningAir = $state(false);

	onMount(() => {
		refresh();
		loadAir();
		// live zone updates via SSE; cast status stays on a light poll
		es = new EventSource('/api/zones/events');
		es.onmessage = (e) => {
			try {
				zones = JSON.parse(e.data);
			} catch {
				/* ignore */
			}
		};
		poll = setInterval(refreshCast, 3000);
		return () => {
			es?.close();
			if (poll) clearInterval(poll);
		};
	});

	async function refreshCast() {
		try {
			cast = await (await fetch('/api/zones/cast')).json();
		} catch {
			/* keep last */
		}
	}

	async function refresh() {
		try {
			zones = await (await fetch('/api/zones')).json();
		} catch {
			/* keep last */
		}
		refreshCast();
	}

	async function castAct(body: Record<string, unknown>) {
		cast = await (await fetch('/api/zones/cast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})).json();
	}

	const castQueue = () =>
		castAct({ action: 'start', trackIds: player.queue.map((t) => t.id), startIndex: Math.max(0, player.index) });

	async function loadAir() {
		try {
			air = await (await fetch('/api/airplay')).json();
		} catch {
			/* ignore */
		}
	}
	async function scanAir() {
		scanningAir = true;
		try {
			air = await (await fetch('/api/airplay?scan=1')).json();
		} finally {
			scanningAir = false;
		}
	}
	async function airAct(body: Record<string, unknown>) {
		air = await (await fetch('/api/airplay', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		})).json();
	}
	function castAir(deviceId: string) {
		const cur = player.current;
		if (!cur) return;
		airAct(cur.isStream && cur.streamUrl ? { action: 'cast', deviceId, url: cur.streamUrl } : { action: 'cast', deviceId, trackId: cur.id });
	}

	async function act(body: Record<string, unknown>) {
		const res = await fetch('/api/zones', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const next = await res.json();
		if (!next.error) zones = next;
	}

	const streamOptions = $derived(zones.streams.map((s) => s.id));

	function moveClient(clientId: string, toGroupId: string) {
		const target = zones.groups.find((g) => g.id === toGroupId);
		if (!target) return;
		const ids = [...new Set([...target.clients.map((c) => c.id), clientId])];
		act({ action: 'groupClients', groupId: toGroupId, clientIds: ids });
	}
</script>

<svelte:head><title>Zones · Timbre</title></svelte:head>

<header class="page-head">
	<h1>Zones</h1>
	<p class="muted">Synchronized multi-room playback via Snapcast. Group rooms, route streams, balance volume.</p>
</header>

{#if zones.configured && cast?.ready}
	<section class="cast">
		{#if cast.casting}
			<span class="dot" aria-hidden="true"></span>
			<span class="cast-label">Casting to your rooms · track {cast.index + 1} of {cast.queueLength}</span>
			<button class="btn btn-ghost" onclick={() => castAct({ action: 'prev' })} title="Previous" aria-label="Previous"><Icon name="prev" size={15} /></button>
			<button class="btn btn-ghost" onclick={() => castAct({ action: 'next' })} title="Next" aria-label="Next"><Icon name="next" size={15} /></button>
			<button class="btn" onclick={() => castAct({ action: 'stop' })}>Stop casting</button>
		{:else}
			<span class="cast-label">Push the current play queue ({player.queue.length}) to your rooms via Snapcast.</span>
			<button class="btn btn-accent" onclick={castQueue} disabled={player.queue.length === 0}><Icon name="play" size={15} /> Cast queue</button>
		{/if}
		{#if cast.error}<span class="err small">· {cast.error}</span>{/if}
	</section>
{/if}

{#if !zones.configured}
	<section class="card setup">
		<h2>Snapcast isn't configured</h2>
		<p class="muted">
			Multi-room runs on <a href="https://github.com/badaix/snapcast" target="_blank" rel="noreferrer">Snapcast</a>.
			Run <span class="mono">snapserver</span> on this machine with a Timbre stream, run
			<span class="mono">snapclient</span> in each room, then point Timbre at the server:
		</p>
		<pre class="mono">{`# snapserver.conf
[stream]
source = pipe:///tmp/snapfifo?name=Timbre&sampleformat=48000:16:2

# Timbre .env
SNAPCAST_HOST=127.0.0.1
SNAPCAST_RPC_PORT=1705
SNAPCAST_FIFO=/tmp/snapfifo`}</pre>
		<p class="faint small">Tip: <span class="mono">node scripts/mock-snapserver.mjs</span> starts a fake server so you can preview this screen without the daemons.</p>
	</section>
{:else if !zones.reachable}
	<section class="card">
		<h2>Can't reach snapserver</h2>
		<p class="err">{zones.error ?? 'Connection failed.'}</p>
		<p class="muted small">Checked <span class="mono">SNAPCAST_HOST</span> on port {`1705`}. Is snapserver running?</p>
		<button class="btn" onclick={refresh}>Retry</button>
	</section>
{:else if zones.groups.length === 0}
	<p class="muted">No groups yet — start a <span class="mono">snapclient</span> in a room and it'll appear here.</p>
{:else}
	<div class="groups">
		{#each zones.groups as g (g.id)}
			<section class="card group" class:muted-group={g.muted}>
				<header class="g-head">
					<div>
						<h2>{g.name}</h2>
						<span class="faint small">{g.clients.length} {g.clients.length === 1 ? 'room' : 'rooms'}</span>
					</div>
					<div class="g-controls">
						<label class="stream-pick">
							<span class="faint small">Stream</span>
							<select value={g.streamId} onchange={(e) => act({ action: 'groupStream', groupId: g.id, streamId: (e.currentTarget as HTMLSelectElement).value })}>
								{#each streamOptions as sid (sid)}
									<option value={sid}>{sid}</option>
								{/each}
							</select>
						</label>
						<button class="btn btn-ghost" class:active={g.muted} onclick={() => act({ action: 'groupMute', groupId: g.id, mute: !g.muted })}>
							{g.muted ? '🔇 Muted' : '🔊 On'}
						</button>
					</div>
				</header>

				<ul class="clients">
					{#each g.clients as c (c.id)}
						<li class="client" class:offline={!c.connected}>
							<div class="c-top">
								<span class="c-name">{c.name}</span>
								<span class="c-host faint mono">{c.host}{c.connected ? '' : ' · offline'}</span>
							</div>
							<div class="c-row">
								<button class="ico" onclick={() => act({ action: 'clientVolume', clientId: c.id, percent: c.volume, muted: !c.muted })} title="Mute" aria-label={c.muted ? 'Unmute' : 'Mute'}>
									<Icon name={c.muted ? 'mute' : 'volume'} size={16} />
								</button>
								<input
									type="range"
									min="0"
									max="100"
									value={c.volume}
									style:--pct={`${c.volume}%`}
									onchange={(e) => act({ action: 'clientVolume', clientId: c.id, percent: +(e.currentTarget as HTMLInputElement).value, muted: c.muted })}
								/>
								<span class="c-vol mono">{c.volume}</span>
								{#if zones.groups.length > 1}
									<select class="move" title="Move to group" onchange={(e) => { moveClient(c.id, (e.currentTarget as HTMLSelectElement).value); (e.currentTarget as HTMLSelectElement).selectedIndex = 0; }}>
										<option>move…</option>
										{#each zones.groups.filter((og) => og.id !== g.id) as og (og.id)}
											<option value={og.id}>→ {og.name}</option>
										{/each}
									</select>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{/if}

{#if air?.enabled}
	<section class="card airplay">
		<div class="ap-head">
			<h2>AirPlay <span class="chip faint">experimental</span></h2>
			<button class="btn" onclick={scanAir} disabled={scanningAir}>{scanningAir ? 'Scanning…' : 'Scan'}</button>
		</div>
		{#if air.casting}
			<p class="muted small">Casting to <span class="mono">{air.deviceId}</span> · <button class="btn btn-ghost" onclick={() => airAct({ action: 'stop' })}>Stop</button></p>
		{/if}
		{#if air.devices?.length}
			<ul class="ap-list">
				{#each air.devices as d (d.id)}
					<li>
						<span>{d.name} <span class="faint mono small">{d.address}</span></span>
						<button class="btn btn-ghost" onclick={() => castAir(d.id)} disabled={!player.current}>Cast current <Icon name="arrow-right" size={14} /></button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="faint small">Scan to find AirPlay receivers (needs <span class="mono">pyatv</span> installed). Snapcast is the primary multi-room path.</p>
		{/if}
	</section>
{/if}

<style>
	.page-head {
		margin-bottom: 1.5rem;
	}
	.page-head h1 {
		font-size: 1.9rem;
	}
	.cast {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		flex-wrap: wrap;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.7rem 1rem;
		margin-bottom: 1.2rem;
	}
	.cast-label {
		font-size: 0.9rem;
		margin-right: auto;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 0 var(--accent);
		animation: pulse 1.6s ease-out infinite;
	}
	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent);
		}
		100% {
			box-shadow: 0 0 0 9px transparent;
		}
	}
	.card {
		background: var(--surface);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 1.2rem 1.3rem;
		margin-bottom: 1.1rem;
	}
	.card h2 {
		font-size: 1.05rem;
		margin-bottom: 0.6rem;
	}
	.setup pre {
		background: var(--bg);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
		padding: 0.9rem;
		font-size: 0.8rem;
		overflow-x: auto;
		white-space: pre;
		color: var(--text-dim);
	}
	.small {
		font-size: 0.8rem;
	}
	.err {
		color: var(--bad);
	}
	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
		gap: 1.1rem;
	}
	.group.muted-group {
		opacity: 0.7;
	}
	.g-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.g-head h2 {
		margin: 0;
	}
	.g-controls {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.stream-pick {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	select {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.3rem 0.5rem;
		font-family: inherit;
		font-size: 0.85rem;
	}
	.btn-ghost.active {
		color: var(--accent);
	}
	.clients {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.client {
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.75rem;
	}
	.client.offline {
		opacity: 0.55;
	}
	.c-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}
	.c-name {
		font-weight: 600;
	}
	.c-host {
		font-size: 0.72rem;
	}
	.c-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.ico {
		background: none;
		border: none;
		font-size: 1rem;
		color: var(--text-dim);
	}
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		flex: 1;
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(to right, var(--accent) var(--pct, 0%), var(--surface-3) var(--pct, 0%));
		cursor: pointer;
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--text);
		box-shadow: 0 0 0 3px var(--surface-2);
	}
	input[type='range']::-moz-range-thumb {
		width: 13px;
		height: 13px;
		border: none;
		border-radius: 50%;
		background: var(--text);
	}
	.c-vol {
		width: 2.5ch;
		text-align: right;
		font-size: 0.8rem;
		color: var(--text-dim);
	}
	.move {
		font-size: 0.78rem;
		padding: 0.2rem 0.4rem;
	}
	.airplay {
		max-width: 680px;
		margin-top: 0.4rem;
	}
	.ap-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.6rem;
	}
	.ap-head h2 {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.ap-list {
		list-style: none;
		margin: 0.6rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.ap-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: var(--surface-2);
		border-radius: var(--radius-sm);
		padding: 0.5rem 0.7rem;
	}
</style>
