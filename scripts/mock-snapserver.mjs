// A tiny fake snapserver speaking line-delimited JSON-RPC (the real port 1705
// protocol) over TCP. Two uses:
//   • verify.mjs imports createMockSnapserver() to exercise the zones control plane
//     with no daemons installed.
//   • `node scripts/mock-snapserver.mjs [port]` runs it standalone so you can open
//     /zones and click around (point SNAPCAST_HOST=127.0.0.1 SNAPCAST_RPC_PORT=<port>).
import net from 'node:net';

function initialState() {
	const mk = (id, name, host, percent) => ({
		id,
		connected: true,
		host: { name: host, ip: '127.0.0.1', mac: '00:00:00:00:00:00', os: 'linux', arch: 'arm' },
		config: { name, latency: 0, volume: { muted: false, percent }, instance: 1 },
		lastSeen: { sec: 0, usec: 0 }
	});
	return {
		groups: [
			{ id: 'g-living', name: 'Living Room', stream_id: 'Timbre', muted: false, clients: [mk('c-living', 'Living Room', 'living-pi', 70)] },
			{ id: 'g-kitchen', name: 'Kitchen', stream_id: 'Timbre', muted: false, clients: [mk('c-kitchen', 'Kitchen', 'kitchen-pi', 55)] }
		],
		streams: [
			{ id: 'Timbre', status: 'playing', uri: { raw: 'pipe:///tmp/snapfifo?name=Timbre' } },
			{ id: 'default', status: 'idle', uri: { raw: 'pipe:///tmp/default' } }
		],
		server: { host: { name: 'mock' }, snapserver: { version: '0.0.0-mock' } }
	};
}

function findClient(state, id) {
	for (const g of state.groups) for (const c of g.clients) if (c.id === id) return c;
	return null;
}

function handle(state, method, params) {
	switch (method) {
		case 'Server.GetStatus':
			return { server: state };
		case 'Client.SetVolume': {
			const c = findClient(state, params.id);
			if (c) c.config.volume = { percent: params.volume.percent, muted: !!params.volume.muted };
			return { volume: c?.config.volume ?? { percent: 0, muted: false } };
		}
		case 'Client.SetName': {
			const c = findClient(state, params.id);
			if (c) c.config.name = params.name;
			return { name: params.name };
		}
		case 'Client.SetLatency': {
			const c = findClient(state, params.id);
			if (c) c.config.latency = params.latency;
			return { latency: params.latency };
		}
		case 'Group.SetStream': {
			const g = state.groups.find((x) => x.id === params.id);
			if (g) g.stream_id = params.stream_id;
			return { stream_id: params.stream_id };
		}
		case 'Group.SetMute': {
			const g = state.groups.find((x) => x.id === params.id);
			if (g) g.muted = !!params.mute;
			return { mute: !!params.mute };
		}
		case 'Group.SetClients': {
			const wanted = new Set(params.clients ?? []);
			// pull the wanted clients out of every group, then drop them into the target
			const moving = [];
			for (const g of state.groups) {
				const keep = [];
				for (const c of g.clients) (wanted.has(c.id) ? moving : keep).push(c);
				g.clients = keep;
			}
			const target = state.groups.find((x) => x.id === params.id);
			if (target) for (const c of moving) target.clients.push(c);
			state.groups = state.groups.filter((g) => g.clients.length > 0);
			return { server: state };
		}
		default:
			return null;
	}
}

export function createMockSnapserver(port = 1705, host = '127.0.0.1') {
	const state = initialState();
	const server = net.createServer((sock) => {
		let buf = '';
		sock.on('data', (d) => {
			buf += d.toString('utf8');
			let nl;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line) continue;
				let req;
				try {
					req = JSON.parse(line);
				} catch {
					continue;
				}
				const result = handle(state, req.method, req.params ?? {});
				const reply =
					result == null
						? { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } }
						: { jsonrpc: '2.0', id: req.id, result };
				sock.write(JSON.stringify(reply) + '\r\n');
			}
		});
		sock.on('error', () => {});
	});
	return new Promise((resolve) => {
		server.listen(port, host, () => resolve({ server, state, close: () => server.close() }));
	});
}

// run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
	const port = Number(process.argv[2]) || 1705;
	createMockSnapserver(port).then(() => console.log(`mock snapserver on tcp://127.0.0.1:${port} (Ctrl-C to stop)`));
}
