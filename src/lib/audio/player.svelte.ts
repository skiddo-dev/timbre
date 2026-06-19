// Client-side playback engine (single zone, browser). Svelte 5 runes class,
// exported as a singleton the whole app shares. Owns one <audio> element wired
// through a Web Audio graph (gain for volume + ReplayGain leveling, analyser for
// the visualizer), the play queue, and persists player_state back to the server.
//
// Multi-room (Snapcast) lands in M6 by swapping the output stage below for a
// zone controller — the queue/state API above this line is designed to be reused.
import { browser } from '$app/environment';
import type { OutputTarget, Playable, PlayerState, Track, TransportStatus } from '$lib/types';
import { defaultProfile, type DspProfile } from '$lib/dsp';

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
	/** Bit-perfect output: bypass the gain node (no app volume / no ReplayGain
	 * leveling) so samples reach the output stage unaltered. Per-device preference,
	 * persisted in localStorage. */
	bitPerfect = $state(false);
	/** Actual AudioContext rate ≈ the OS output device rate; 0 until the graph is
	 * built (needs a user gesture). Compared to the source rate to tell the user
	 * whether their device is matched (a mismatch means the browser resamples). */
	outputRate = $state(0);
	ready = $state(false);
	/** 0..1 RMS level for the dock visualizer. */
	level = $state(0);
	/** Shared parametric-EQ + room-correction profile (also applied to the cast
	 * outputs server-side via ffmpeg — see $lib/dsp.ts). Bit-perfect bypasses it. */
	dsp = $state<DspProfile>(defaultProfile());
	/** Where audio is rendered: 'browser' (this device, Web Audio) or a remote
	 * output ('snapcast' zone / 'airplay' device). When remote, the local <audio>
	 * stays silent and the same transport controls drive the server output. */
	output = $state<OutputTarget>('browser');
	outputId = $state<string | null>(null);

	#audio: HTMLAudioElement | null = null;
	#ctx: AudioContext | null = null;
	#src: MediaElementAudioSourceNode | null = null;
	#gain: GainNode | null = null;
	#analyser: AnalyserNode | null = null;
	#freq: Uint8Array<ArrayBuffer> | null = null;
	// DSP graph: a chain of EQ biquads → optional room-correction convolver → preamp,
	// spliced between #src and #gain when the profile is enabled (and not bit-perfect).
	#eqNodes: BiquadFilterNode[] = [];
	#convolver: ConvolverNode | null = null;
	#preamp: GainNode | null = null;
	#irName: string | null = null; // name of the IR currently loaded into #convolver
	#raf = 0;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;
	#remotePoll: ReturnType<typeof setInterval> | null = null;
	// Scrobbling: unix-seconds the current play began, and whether we've already
	// scrobbled it. Reset per track load (and per repeat-one replay), not on a
	// pause/resume — so resuming the same track never double-scrobbles.
	#playStartedAt = 0;
	#scrobbled = false;

	get current(): Track | null {
		return this.index >= 0 && this.index < this.queue.length ? this.queue[this.index] : null;
	}

	/** True when audio is rendered somewhere other than this browser. */
	get isRemote(): boolean {
		return this.output !== 'browser';
	}

	/** Sample rate of the playing track, in Hz (0 when nothing is loaded). */
	get sourceRate(): number {
		return this.current?.sampleRate ?? 0;
	}

	/** True when the output (≈ device) rate equals the source rate, i.e. no
	 * sample-rate conversion happens in the path. Only meaningful once the graph
	 * is built (outputRate > 0). */
	get rateMatched(): boolean {
		return this.outputRate > 0 && this.sourceRate > 0 && this.outputRate === this.sourceRate;
	}

	/** Load persisted state + queue from the server (called once on mount). */
	async hydrate() {
		if (!browser) return;
		try {
			this.bitPerfect = localStorage.getItem('timbre:bitPerfect') === '1';
		} catch {
			/* localStorage unavailable — default to off */
		}
		try {
			const [stateRes, queueRes, dspRes] = await Promise.all([
				fetch('/api/player'),
				fetch('/api/queue'),
				fetch('/api/dsp')
			]);
			const state = (await stateRes.json()) as PlayerState;
			const q = (await queueRes.json()) as { tracks: Track[] };
			const dsp = (await dspRes.json().catch(() => null)) as { profile?: DspProfile } | null;
			if (dsp?.profile) this.dsp = dsp.profile;
			this.volume = state.volume ?? 1;
			this.shuffle = !!state.shuffle;
			this.repeat = state.repeat ?? 'off';
			this.output = state.output ?? 'browser';
			this.outputId = state.outputId ?? null;
			this.queue = q.tracks ?? [];
			if (state.currentTrackId != null) {
				const i = this.queue.findIndex((t) => t.id === state.currentTrackId);
				if (i >= 0) {
					this.index = i;
					this.positionMs = state.positionMs ?? 0;
					// Don't auto-play locally when a remote output is active — just attach.
					if (!this.isRemote) this.#load(this.queue[i], false);
				}
			}
			if (this.isRemote) this.#startRemotePoll();
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
				this.#maybeScrobble();
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
				// A default context adopts the output device's rate, so ctx.sampleRate
				// tells us what the hardware is running at — surfaced for bit-perfect.
				this.outputRate = this.#ctx.sampleRate;
				this.#src = this.#ctx.createMediaElementSource(this.#audio);
				this.#gain = this.#ctx.createGain();
				this.#preamp = this.#ctx.createGain();
				this.#analyser = this.#ctx.createAnalyser();
				this.#analyser.fftSize = 64;
				this.#freq = new Uint8Array(this.#analyser.frequencyBinCount);
				this.#buildEqNodes();
				void this.#loadIr();
				this.#wireGraph();
			} catch {
				this.#ctx = null; // Web Audio unavailable — fall back to element.volume
			}
		}
	}

	/** (Re)connect the output chain for the current mode. AnalyserNode is a
	 * spec-guaranteed pass-through (it copies samples for the meter without
	 * altering them), so the bit-perfect path stays sample-exact while keeping
	 * the visualizer; only the GainNode + DSP nodes touch samples, so bit-perfect
	 * drops them all. Chain (when not bit-perfect):
	 *   src → [eq…] → [convolver] → [preamp] → gain → analyser → dest
	 * where the bracketed DSP nodes are present only while the profile is enabled. */
	#wireGraph() {
		if (!this.#ctx || !this.#src || !this.#analyser || !this.#gain || !this.#preamp) return;
		this.#src.disconnect();
		this.#gain.disconnect();
		this.#analyser.disconnect();
		this.#preamp.disconnect();
		for (const n of this.#eqNodes) n.disconnect();
		this.#convolver?.disconnect();

		if (this.bitPerfect) {
			this.#src.connect(this.#analyser); // bit-perfect: nothing in the path
			this.#analyser.connect(this.#ctx.destination);
			this.#applyGain();
			return;
		}

		// Build the (possibly empty) DSP segment, then hand off to the gain stage.
		let head: AudioNode = this.#src;
		if (this.dsp.enabled) {
			for (const n of this.#eqNodes) {
				head.connect(n);
				head = n;
			}
			if (this.dsp.room.enabled && this.#convolver && this.#convolver.buffer) {
				head.connect(this.#convolver);
				head = this.#convolver;
			}
			head.connect(this.#preamp);
			head = this.#preamp;
		}
		head.connect(this.#gain);
		this.#gain.connect(this.#analyser);
		this.#analyser.connect(this.#ctx.destination);
		this.#applyGain();
	}

	/** Rebuild the EQ biquad chain from the current profile (a node per enabled
	 * band). EqBandType is exactly the Web Audio BiquadFilterType set, so the map
	 * is 1:1; pass/notch types ignore gain, matching the spec. */
	#buildEqNodes() {
		if (!this.#ctx || !this.#preamp) return;
		for (const n of this.#eqNodes) n.disconnect();
		this.#eqNodes = [];
		for (const band of this.dsp.bands) {
			if (!band.enabled) continue;
			const f = this.#ctx.createBiquadFilter();
			f.type = band.type;
			f.frequency.value = band.freq;
			f.Q.value = band.q;
			f.gain.value = band.gain;
			this.#eqNodes.push(f);
		}
		this.#preamp.gain.value = 10 ** (this.dsp.preampDb / 20);
	}

	/** Load the active room-correction impulse response into the convolver (decoded
	 * via the AudioContext). Skipped when room correction is off or already loaded. */
	async #loadIr() {
		if (!this.#ctx) return;
		const want = this.dsp.room.enabled ? this.dsp.room.irName : null;
		if (!want) {
			if (this.#convolver) this.#convolver.buffer = null;
			this.#irName = null;
			return;
		}
		if (this.#irName === want && this.#convolver?.buffer) return;
		try {
			const res = await fetch(`/api/dsp/ir?name=${encodeURIComponent(want)}`);
			if (!res.ok) throw new Error('no ir');
			const buf = await this.#ctx.decodeAudioData(await res.arrayBuffer());
			if (!this.#convolver) this.#convolver = this.#ctx.createConvolver();
			this.#convolver.buffer = buf;
			this.#irName = want;
		} catch {
			if (this.#convolver) this.#convolver.buffer = null; // missing/invalid IR → no convolution
			this.#irName = null;
		}
	}

	#applyGain() {
		// Bit-perfect bypasses the gain node entirely (see #wireGraph); just make
		// sure the no-Web-Audio fallback path is also at unity so nothing scales.
		if (this.bitPerfect) {
			if (this.#audio && !(this.#gain && this.#ctx)) this.#audio.volume = 1;
			return;
		}
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
		if (this.isRemote) {
			// A remote output owns playback; just reflect the track's metadata locally.
			this.durationMs = track.durationMs;
			this.positionMs = 0;
			return;
		}
		this.#ensureGraph();
		if (!this.#audio) return;
		// Non-local sources (internet radio) stream a remote URL directly.
		this.#audio.src = track.streamUrl ?? `/api/stream/${track.id}`;
		this.durationMs = track.durationMs;
		this.positionMs = 0;
		this.#playStartedAt = 0;
		this.#scrobbled = false;
		this.#applyGain();
		if (autoplay) void this.#start(track);
	}

	async #start(track: Track) {
		if (!this.#audio) return;
		if (this.#ctx?.state === 'suspended') await this.#ctx.resume();
		try {
			await this.#audio.play();
			if (!this.#raf) this.#raf = requestAnimationFrame(this.#tickLevel);
			if (this.#scrobbleEligible(track)) {
				if (this.#playStartedAt === 0) this.#playStartedAt = Math.floor(Date.now() / 1000);
				if (!track.streamUrl) fetch(`/api/tracks/${track.id}/played`, { method: 'POST' }).catch(() => {});
				fetch('/api/scrobble/nowplaying', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(this.#scrobbleBody(track))
				}).catch(() => {});
			}
		} catch {
			/* autoplay blocked — user can press play */
		}
	}

	/** What can be scrobbled: local files (by id) and Subsonic remote plays (by
	 * metadata — they have real artist/title). Live radio streams are skipped. */
	#scrobbleEligible(t: Track): boolean {
		return !t.streamUrl || t.source === 'subsonic';
	}
	#scrobbleBody(t: Track): Record<string, unknown> {
		return t.streamUrl
			? { artist: t.artist, title: t.title, album: t.albumTitle }
			: { trackId: t.id };
	}

	/** Scrobble the current track once it's been "consumed" — Last.fm's rule is
	 * ≥30s long and played past the halfway point or 4 minutes, whichever first.
	 * Fire-and-forget (the server queues + retries). */
	#maybeScrobble() {
		if (this.#scrobbled) return;
		const t = this.current;
		if (!t || !this.#scrobbleEligible(t)) return;
		const dur = this.durationMs;
		if (dur < 30_000) return;
		if (this.positionMs < Math.min(dur / 2, 240_000)) return;
		this.#scrobbled = true;
		fetch('/api/scrobble', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...this.#scrobbleBody(t), startedAt: this.#playStartedAt || undefined })
		}).catch(() => {});
	}

	#onEnded() {
		if (this.repeat === 'one') {
			this.seek(0);
			// A replay is a fresh play — let it scrobble again (#start re-stamps the time).
			this.#playStartedAt = 0;
			this.#scrobbled = false;
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
		this.#persistQueue();
		this.#scheduleSave();
		if (this.isRemote) void this.#sendCastQueue(true);
		else if (this.current) this.#load(this.current, true);
	}

	playQueueAt(i: number) {
		if (i < 0 || i >= this.queue.length) return;
		this.index = i;
		this.#scheduleSave();
		if (this.isRemote) void this.#transport('index', { index: i });
		else this.#load(this.current!, true);
	}

	enqueue(track: Track, next = false) {
		if (next && this.index >= 0) this.queue.splice(this.index + 1, 0, track);
		else this.queue.push(track);
		if (this.index === -1) {
			this.index = 0;
			if (!this.isRemote) this.#load(this.current!, false);
		}
		this.#persistQueue();
		// When casting, the new item takes effect on the next explicit play (the
		// running cast queue isn't interrupted mid-track).
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
		if (this.isRemote) {
			void this.#transport(this.playing ? 'pause' : 'play');
			return;
		}
		this.#ensureGraph();
		if (this.playing) this.pause();
		else void this.#start(this.current);
	}

	pause() {
		if (this.isRemote) {
			void this.#transport('pause');
			return;
		}
		this.#audio?.pause();
	}

	next(auto = false) {
		if (this.queue.length === 0) return;
		if (this.isRemote) {
			void this.#transport('next');
			return;
		}
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
		if (this.isRemote) {
			void this.#transport('prev');
			return;
		}
		if (this.positionMs > 3000) {
			this.seek(0);
			return;
		}
		if (this.index > 0) this.playQueueAt(this.index - 1);
		else this.seek(0);
	}

	seek(ms: number) {
		this.positionMs = ms;
		if (this.isRemote) {
			void this.#transport('seek', { ms });
			return;
		}
		if (this.#audio) this.#audio.currentTime = ms / 1000;
		this.#scheduleSave();
	}

	setVolume(v: number) {
		this.volume = Math.min(1, Math.max(0, v));
		this.#applyGain();
		this.#scheduleSave();
	}

	// ── output switching + remote transport ─────────────────────────────────────
	/** Build the resolvable queue for a remote output (the server re-derives each
	 * item's ffmpeg input, so we only send ids/urls + display metadata). */
	#playablesFromQueue(): Playable[] {
		return this.queue.map((t): Playable => {
			if (t.source === 'subsonic' && t.sourceUrl)
				return { source: 'subsonic', remoteId: t.sourceUrl, title: t.title, artist: t.artist, album: t.albumTitle, durationMs: t.durationMs };
			if (t.streamUrl) return { source: 'radio', url: t.streamUrl, title: t.title, artist: t.artist, durationMs: t.durationMs };
			return { source: 'local', trackId: t.id, title: t.title, artist: t.artist, durationMs: t.durationMs };
		});
	}

	/** Switch the output target. Hands the shared queue + current position to the
	 * server for a remote output, or resumes local playback for 'browser'. */
	async setOutput(target: OutputTarget, id: string | null = null) {
		const wasPlaying = this.playing;
		const resumeMs = this.positionMs;
		this.output = target;
		this.outputId = id;

		if (target === 'browser') {
			this.#stopRemotePoll();
			await fetch('/api/transport', this.#post({ action: 'setOutput', target: 'browser' })).catch(() => {});
			// resume on this device from where the cast was
			if (this.current) {
				this.#load(this.current, false);
				this.seek(resumeMs);
				if (wasPlaying) void this.#start(this.current);
			}
			return;
		}

		this.#audio?.pause(); // silence the local element while a remote output plays
		const st = await fetch(
			'/api/transport',
			this.#post({
				action: 'setOutput',
				target,
				id,
				playables: this.#playablesFromQueue(),
				index: Math.max(0, this.index),
				positionMs: resumeMs
			})
		)
			.then((r) => r.json())
			.catch(() => null);
		if (st) this.#applyRemote(st);
		this.#startRemotePoll();
	}

	/** (Re)send the current queue to the active remote output, optionally starting. */
	async #sendCastQueue(restart: boolean) {
		if (!this.isRemote) return;
		if (restart) {
			await this.setOutput(this.output, this.outputId);
		}
	}

	async #transport(action: string, extra: Record<string, unknown> = {}) {
		const st = await fetch('/api/transport', this.#post({ action, ...extra }))
			.then((r) => r.json())
			.catch(() => null);
		if (st) this.#applyRemote(st);
	}

	#applyRemote(st: TransportStatus) {
		this.positionMs = st.positionMs ?? 0;
		if (st.durationMs) this.durationMs = st.durationMs;
		this.playing = !!st.playing;
		if (typeof st.index === 'number' && st.index >= 0 && st.index < this.queue.length) this.index = st.index;
	}

	#startRemotePoll() {
		if (!browser) return;
		this.#stopRemotePoll();
		this.#remotePoll = setInterval(() => {
			if (!this.isRemote) return this.#stopRemotePoll();
			fetch('/api/transport')
				.then((r) => r.json())
				.then((st: TransportStatus) => this.#applyRemote(st))
				.catch(() => {});
		}, 1000);
	}
	#stopRemotePoll() {
		if (this.#remotePoll) clearInterval(this.#remotePoll);
		this.#remotePoll = null;
	}

	#post(body: unknown): RequestInit {
		return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
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

	/** Apply + persist a DSP profile. Re-applied live to the graph (when built) and
	 * PUT to the server so the cast/transcode outputs use the same settings. */
	setDsp(profile: DspProfile) {
		this.dsp = profile;
		if (browser) {
			fetch('/api/dsp', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(profile)
			}).catch(() => {});
		}
		if (this.#ctx) {
			this.#buildEqNodes();
			this.#wireGraph();
			void this.#loadIr().then(() => this.#wireGraph());
		}
	}

	/** Toggle bit-perfect output. Re-wires the graph to drop/restore the gain
	 * node and persists the choice per-device. */
	toggleBitPerfect() {
		this.bitPerfect = !this.bitPerfect;
		if (browser) {
			try {
				localStorage.setItem('timbre:bitPerfect', this.bitPerfect ? '1' : '0');
			} catch {
				/* localStorage unavailable — preference is in-memory only */
			}
		}
		this.#wireGraph(); // no-op until the graph is built; #ensureGraph reads bitPerfect
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
