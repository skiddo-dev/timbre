// Client-side playback engine (single zone, browser). Svelte 5 runes class,
// exported as a singleton the whole app shares. Owns one <audio> element wired
// through a Web Audio graph (gain for volume + ReplayGain leveling, analyser for
// the visualizer), the play queue, and persists player_state back to the server.
//
// Multi-room (Snapcast) lands in M6 by swapping the output stage below for a
// zone controller — the queue/state API above this line is designed to be reused.
import { browser } from '$app/environment';
import type { PlayerState, Track } from '$lib/types';

const TARGET_LUFS = -18; // leveling reference, matches ReplayGain/Roon conventions

class Player {
	queue = $state<Track[]>([]);
	index = $state(-1);
	playing = $state(false);
	positionMs = $state(0);
	durationMs = $state(0);
	volume = $state(1);
	shuffle = $state(false);
	repeat = $state<'off' | 'all' | 'one'>('off');
	leveling = $state(true);
	ready = $state(false);
	/** 0..1 RMS level for the dock visualizer. */
	level = $state(0);

	#audio: HTMLAudioElement | null = null;
	#ctx: AudioContext | null = null;
	#gain: GainNode | null = null;
	#analyser: AnalyserNode | null = null;
	#freq: Uint8Array<ArrayBuffer> | null = null;
	#raf = 0;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;

	get current(): Track | null {
		return this.index >= 0 && this.index < this.queue.length ? this.queue[this.index] : null;
	}

	/** Load persisted state + queue from the server (called once on mount). */
	async hydrate() {
		if (!browser) return;
		try {
			const [stateRes, queueRes] = await Promise.all([
				fetch('/api/player'),
				fetch('/api/queue')
			]);
			const state = (await stateRes.json()) as PlayerState;
			const q = (await queueRes.json()) as { tracks: Track[] };
			this.volume = state.volume ?? 1;
			this.shuffle = !!state.shuffle;
			this.repeat = state.repeat ?? 'off';
			this.queue = q.tracks ?? [];
			if (state.currentTrackId != null) {
				const i = this.queue.findIndex((t) => t.id === state.currentTrackId);
				if (i >= 0) {
					this.index = i;
					this.#load(this.queue[i], false);
					this.positionMs = state.positionMs ?? 0;
				}
			}
		} catch {
			/* fresh start */
		}
		this.ready = true;
	}

	// ── graph setup (lazy, needs a user gesture for the AudioContext) ──────────
	#ensureGraph() {
		if (!browser) return;
		if (!this.#audio) {
			this.#audio = new Audio();
			this.#audio.preload = 'auto';
			this.#audio.crossOrigin = 'anonymous';
			this.#audio.addEventListener('timeupdate', () => {
				this.positionMs = this.#audio!.currentTime * 1000;
				this.#scheduleSave();
			});
			this.#audio.addEventListener('loadedmetadata', () => {
				this.durationMs = (this.#audio!.duration || 0) * 1000;
			});
			this.#audio.addEventListener('ended', () => this.#onEnded());
			this.#audio.addEventListener('play', () => (this.playing = true));
			this.#audio.addEventListener('pause', () => (this.playing = false));
		}
		if (!this.#ctx) {
			try {
				this.#ctx = new AudioContext();
				const src = this.#ctx.createMediaElementSource(this.#audio);
				this.#gain = this.#ctx.createGain();
				this.#analyser = this.#ctx.createAnalyser();
				this.#analyser.fftSize = 64;
				this.#freq = new Uint8Array(this.#analyser.frequencyBinCount);
				src.connect(this.#gain);
				this.#gain.connect(this.#analyser);
				this.#analyser.connect(this.#ctx.destination);
				this.#applyGain();
			} catch {
				this.#ctx = null; // Web Audio unavailable — fall back to element.volume
			}
		}
	}

	#applyGain() {
		const lvl =
			this.leveling && this.current?.gainDb != null
				? Math.min(4, Math.max(0.05, 10 ** (this.current.gainDb / 20)))
				: 1;
		if (this.#gain && this.#ctx) {
			this.#gain.gain.setTargetAtTime(this.volume * lvl, this.#ctx.currentTime, 0.02);
		} else if (this.#audio) {
			this.#audio.volume = Math.min(1, this.volume);
		}
	}

	#tickLevel = () => {
		if (this.#analyser && this.#freq) {
			this.#analyser.getByteFrequencyData(this.#freq);
			let sum = 0;
			for (let i = 0; i < this.#freq.length; i++) sum += this.#freq[i];
			this.level = sum / (this.#freq.length * 255);
		}
		this.#raf = requestAnimationFrame(this.#tickLevel);
	};

	#load(track: Track, autoplay: boolean) {
		this.#ensureGraph();
		if (!this.#audio) return;
		this.#audio.src = `/api/stream/${track.id}`;
		this.durationMs = track.durationMs;
		this.positionMs = 0;
		this.#applyGain();
		if (autoplay) void this.#start(track);
	}

	async #start(track: Track) {
		if (!this.#audio) return;
		if (this.#ctx?.state === 'suspended') await this.#ctx.resume();
		try {
			await this.#audio.play();
			if (!this.#raf) this.#raf = requestAnimationFrame(this.#tickLevel);
			fetch(`/api/tracks/${track.id}/played`, { method: 'POST' }).catch(() => {});
		} catch {
			/* autoplay blocked — user can press play */
		}
	}

	#onEnded() {
		if (this.repeat === 'one') {
			this.seek(0);
			void this.#start(this.current!);
			return;
		}
		this.next(true);
	}

	// ── public controls ───────────────────────────────────────────────────────
	/** Replace the queue with `tracks` and start at `start`. */
	playContext(tracks: Track[], start = 0) {
		this.queue = [...tracks];
		this.index = Math.min(Math.max(0, start), tracks.length - 1);
		if (this.current) this.#load(this.current, true);
		this.#persistQueue();
		this.#scheduleSave();
	}

	playQueueAt(i: number) {
		if (i < 0 || i >= this.queue.length) return;
		this.index = i;
		this.#load(this.current!, true);
		this.#scheduleSave();
	}

	enqueue(track: Track, next = false) {
		if (next && this.index >= 0) this.queue.splice(this.index + 1, 0, track);
		else this.queue.push(track);
		if (this.index === -1) {
			this.index = 0;
			this.#load(this.current!, false);
		}
		this.#persistQueue();
	}

	removeAt(i: number) {
		this.queue.splice(i, 1);
		if (i < this.index) this.index--;
		else if (i === this.index) this.index = Math.min(this.index, this.queue.length - 1);
		this.#persistQueue();
	}

	clearQueue() {
		this.pause();
		this.queue = [];
		this.index = -1;
		this.#persistQueue();
		this.#scheduleSave();
	}

	toggle() {
		if (!this.current) return;
		this.#ensureGraph();
		if (this.playing) this.pause();
		else void this.#start(this.current);
	}

	pause() {
		this.#audio?.pause();
	}

	next(auto = false) {
		if (this.queue.length === 0) return;
		if (this.shuffle && this.queue.length > 1) {
			let r = this.index;
			while (r === this.index) r = Math.floor(Math.random() * this.queue.length);
			this.playQueueAt(r);
			return;
		}
		if (this.index + 1 < this.queue.length) this.playQueueAt(this.index + 1);
		else if (this.repeat === 'all') this.playQueueAt(0);
		else if (auto) {
			this.pause();
			this.seek(0);
		}
	}

	prev() {
		if (this.positionMs > 3000) {
			this.seek(0);
			return;
		}
		if (this.index > 0) this.playQueueAt(this.index - 1);
		else this.seek(0);
	}

	seek(ms: number) {
		if (this.#audio) this.#audio.currentTime = ms / 1000;
		this.positionMs = ms;
		this.#scheduleSave();
	}

	setVolume(v: number) {
		this.volume = Math.min(1, Math.max(0, v));
		this.#applyGain();
		this.#scheduleSave();
	}

	toggleShuffle() {
		this.shuffle = !this.shuffle;
		this.#scheduleSave();
	}

	cycleRepeat() {
		this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
		this.#scheduleSave();
	}

	toggleLeveling() {
		this.leveling = !this.leveling;
		this.#applyGain();
	}

	// ── server persistence ─────────────────────────────────────────────────────
	#scheduleSave() {
		if (!browser) return;
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => this.#persistState(), 1500);
	}

	#persistState() {
		fetch('/api/player', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				currentTrackId: this.current?.id ?? null,
				positionMs: Math.round(this.positionMs),
				volume: this.volume,
				shuffle: this.shuffle,
				repeat: this.repeat
			})
		}).catch(() => {});
	}

	#persistQueue() {
		fetch('/api/queue', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ trackIds: this.queue.map((t) => t.id) })
		}).catch(() => {});
	}
}

export const player = new Player();
