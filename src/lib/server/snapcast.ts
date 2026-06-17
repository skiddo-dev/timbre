// Snapcast control plane — talks to snapserver's line-delimited JSON-RPC over TCP
// (default port 1705). This is the "zones" layer: enumerate rooms (groups +
// clients), set per-client volume/mute/name, route a group to a stream, and
// regroup clients. Connect-per-request keeps it stateless and robust; the /zones
// UI polls. Degrades silently when SNAPCAST_HOST is unset (snapcastConfigured()).
//
// Audio gets INTO Snapcast via the FIFO feeder in streamer.ts → the "Timbre"
// stream defined in snapserver.conf (see README).
import net from 'node:net';
import { env } from '$env/dynamic/private';
import type { SnapClient, SnapGroup, SnapStream, ZoneStatus } from '$lib/types';

const HOST = () => (env.SNAPCAST_HOST || '').trim();
const PORT = () => Number(env.SNAPCAST_RPC_PORT) || 1705;

export function snapcastConfigured(): boolean {
	return HOST().length > 0;
}

type Json = Record<string, unknown>;

/** One JSON-RPC request over a short-lived TCP connection. */
function rpc(method: string, params: Json = {}, timeoutMs = 4000): Promise<Json> {
	return new Promise((resolve, reject) => {
		if (!HOST()) return reject(new Error('snapcast not configured'));
		const id = Math.floor(Math.random() * 1e9);
		const sock = net.createConnection({ host: HOST(), port: PORT() });
		let buf = '';
		const done = (fn: () => void) => {
			clearTimeout(timer);
			sock.removeAllListeners();
			sock.destroy();
			fn();
		};
		const timer = setTimeout(() => done(() => reject(new Error('snapcast timeout'))), timeoutMs);
		sock.on('connect', () => sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\r\n'));
		sock.on('data', (d) => {
			buf += d.toString('utf8');
			let nl: number;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line) continue;
				let msg: Json;
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (msg.id === id) {
					if (msg.error) {
						const e = msg.error as { message?: string };
						return done(() => reject(new Error(e?.message || 'snapcast rpc error')));
					}
					return done(() => resolve((msg.result as Json) ?? {}));
				}
				// ignore notifications / other ids
			}
		});
		sock.on('error', (e) => done(() => reject(e)));
	});
}

// ── status → zone model ──────────────────────────────────────────────────────
function mapClient(c: Json): SnapClient {
	const config = (c.config as Json) ?? {};
	const vol = (config.volume as Json) ?? {};
	const host = (c.host as Json) ?? {};
	return {
		id: String(c.id ?? ''),
		name: String(config.name || (host.name as string) || c.id || 'Client'),
		host: String(host.name || host.ip || ''),
		connected: !!c.connected,
		volume: Number(vol.percent ?? 0),
		muted: !!vol.muted,
		latency: Number(config.latency ?? 0)
	};
}

function mapGroup(g: Json): SnapGroup {
	const clients = Array.isArray(g.clients) ? (g.clients as Json[]).map(mapClient) : [];
	return {
		id: String(g.id ?? ''),
		name: String(g.name || clients[0]?.name || 'Group'),
		streamId: String(g.stream_id ?? ''),
		muted: !!g.muted,
		clients
	};
}

function mapStream(s: Json): SnapStream {
	return { id: String(s.id ?? ''), status: String(s.status ?? '') };
}

export async function getZones(): Promise<ZoneStatus> {
	if (!snapcastConfigured()) {
		return { configured: false, reachable: false, groups: [], streams: [], error: null };
	}
	try {
		const res = await rpc('Server.GetStatus');
		const server = (res.server as Json) ?? {};
		const groups = Array.isArray(server.groups) ? (server.groups as Json[]).map(mapGroup) : [];
		const streams = Array.isArray(server.streams) ? (server.streams as Json[]).map(mapStream) : [];
		return { configured: true, reachable: true, groups, streams, error: null };
	} catch (e) {
		return {
			configured: true,
			reachable: false,
			groups: [],
			streams: [],
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

// ── control actions ──────────────────────────────────────────────────────────
export const setClientVolume = (id: string, percent: number, muted: boolean) =>
	rpc('Client.SetVolume', { id, volume: { percent: Math.round(percent), muted } });

export const setClientName = (id: string, name: string) => rpc('Client.SetName', { id, name });

export const setClientLatency = (id: string, latency: number) =>
	rpc('Client.SetLatency', { id, latency: Math.round(latency) });

export const setGroupStream = (id: string, streamId: string) =>
	rpc('Group.SetStream', { id, stream_id: streamId });

export const setGroupMute = (id: string, mute: boolean) => rpc('Group.SetMute', { id, mute });

export const setGroupClients = (id: string, clients: string[]) =>
	rpc('Group.SetClients', { id, clients });
