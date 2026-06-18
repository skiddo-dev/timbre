// Built-in NNTP download engine — the from-scratch fallback used when no SABnzbd /
// NZBGet client is configured. Speaks RFC 3977 NNTP over a plain (119) or TLS (563)
// socket: greeting → optional AUTHINFO USER/PASS → GROUP → BODY <msgid> per segment.
// Article bodies are read as raw bytes (yEnc is binary), dot-unstuffed line by line,
// then decoded by the yEnc kernel. Reassembled files are written under
// MUSIC_DIR/_usenet/<slug> for the scanner to ingest as ordinary local tracks.
//
// No PAR2 repair or unrar is built in here (a SABnzbd client is the answer for those
// — see sab.ts); extract.ts attempts them best-effort if the binaries are on PATH.
import net from 'node:net';
import tls from 'node:tls';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { env } from '$env/dynamic/private';
import type { Nzb, NzbFile } from './nzb';
import { decodeYencArticle } from './yenc';

const HOST = () => (env.NNTP_HOST || '').trim();
const useSsl = () => env.NNTP_SSL !== '0' && env.NNTP_SSL !== 'false'; // default: TLS
const PORT = () => Number(env.NNTP_PORT) || (useSsl() ? 563 : 119);
const USER = () => (env.NNTP_USER || '').trim();
const PASS = () => (env.NNTP_PASS || '').trim();

export function nntpConfigured(): boolean {
	return HOST().length > 0;
}

export type NntpProgress = (bytesDoneDelta: number, file: string) => void;

interface Status {
	code: number;
	text: string;
}

// A strictly-sequential NNTP client: one command in flight at a time, so a single
// line/byte reader over the socket buffer is enough.
class Nntp {
	private sock: net.Socket | tls.TLSSocket | null = null;
	private buf: Buffer = Buffer.alloc(0);
	private wake: (() => void) | null = null;
	private closed = false;

	private onData(d: Buffer): void {
		this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
		const w = this.wake;
		this.wake = null;
		if (w) w();
	}
	private waitData(): Promise<void> {
		return new Promise((res) => (this.wake = res));
	}

	async connect(timeoutMs = 20_000): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.close();
				reject(new Error('nntp connect timeout'));
			}, timeoutMs);
			const onErr = (e: Error) => {
				clearTimeout(timer);
				reject(e);
			};
			const onReady = () => {
				this.sock?.removeListener('error', onErr);
				this.sock?.on('data', (d: Buffer) => this.onData(d));
				this.sock?.on('error', () => this.markClosed());
				this.sock?.on('close', () => this.markClosed());
				this.readStatus()
					.then((s) => {
						clearTimeout(timer);
						if (s.code === 200 || s.code === 201) resolve();
						else reject(new Error(`nntp greeting ${s.code}: ${s.text}`));
					})
					.catch(reject);
			};
			if (useSsl()) {
				this.sock = tls.connect(
					{ host: HOST(), port: PORT(), servername: HOST(), rejectUnauthorized: false },
					onReady
				);
			} else {
				this.sock = net.connect({ host: HOST(), port: PORT() }, onReady);
			}
			this.sock.once('error', onErr);
		});
	}

	private markClosed(): void {
		this.closed = true;
		const w = this.wake;
		this.wake = null;
		if (w) w();
	}

	private async readLine(): Promise<Buffer> {
		for (;;) {
			const i = this.buf.indexOf('\r\n');
			if (i >= 0) {
				const line = this.buf.subarray(0, i);
				this.buf = this.buf.subarray(i + 2);
				return line;
			}
			if (this.closed) throw new Error('nntp connection closed');
			await this.waitData();
		}
	}

	private async readStatus(): Promise<Status> {
		const line = (await this.readLine()).toString('latin1');
		return { code: parseInt(line.slice(0, 3), 10) || 0, text: line.slice(4) };
	}

	// Read a dot-terminated multi-line block as raw bytes, applying NNTP
	// dot-unstuffing (a body line starting with '.' had one prepended in transit).
	private async readBlock(): Promise<Uint8Array[]> {
		const lines: Uint8Array[] = [];
		for (;;) {
			const line = await this.readLine();
			if (line.length === 1 && line[0] === 0x2e) break; // "." terminator
			const body = line.length >= 1 && line[0] === 0x2e ? line.subarray(1) : line;
			lines.push(Uint8Array.from(body));
		}
		return lines;
	}

	private send(cmd: string): void {
		if (!this.sock) throw new Error('nntp not connected');
		this.sock.write(cmd + '\r\n', 'latin1');
	}

	async command(cmd: string): Promise<Status> {
		this.send(cmd);
		return this.readStatus();
	}

	async authenticate(): Promise<void> {
		if (!USER()) return;
		const u = await this.command(`AUTHINFO USER ${USER()}`);
		if (u.code === 281) return; // accepted on the username alone
		if (u.code !== 381) throw new Error(`nntp auth rejected: ${u.code} ${u.text}`);
		const p = await this.command(`AUTHINFO PASS ${PASS()}`);
		if (p.code !== 281) throw new Error(`nntp auth failed: ${p.code} ${p.text}`);
	}

	async group(name: string): Promise<boolean> {
		const r = await this.command(`GROUP ${name}`);
		return r.code === 211;
	}

	// Fetch one article body. null when the article is missing (4xx/5xx, no block).
	async body(messageId: string): Promise<Uint8Array[] | null> {
		this.send(`BODY <${messageId}>`);
		const st = await this.readStatus();
		if (st.code === 222) return this.readBlock();
		return null;
	}

	async quit(): Promise<void> {
		try {
			this.send('QUIT');
		} catch {
			/* socket may already be gone */
		}
		this.close();
	}
	close(): void {
		this.closed = true;
		try {
			this.sock?.destroy();
		} catch {
			/* noop */
		}
	}
}

/** Download every file in an NZB to `destDir`. Returns the files actually written. */
export async function downloadNzb(
	nzb: Nzb,
	destDir: string,
	onProgress?: NntpProgress
): Promise<{ files: string[]; bytes: number }> {
	const client = new Nntp();
	await client.connect();
	try {
		await client.authenticate();
		const written: string[] = [];
		let bytes = 0;
		for (const file of nzb.files) {
			// .par2 recovery volumes are only useful with a par2 binary + repair logic
			// the NNTP fallback doesn't run; skip the bandwidth.
			if (/\.par2$/i.test(file.filename)) continue;
			const data = await downloadFile(client, file, (n) => {
				bytes += n;
				onProgress?.(n, file.filename);
			});
			if (!data.length) continue;
			const full = join(destDir, safeName(file.filename));
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, data);
			written.push(full);
		}
		return { files: written, bytes };
	} finally {
		await client.quit();
	}
}

async function downloadFile(
	client: Nntp,
	file: NzbFile,
	onBytes: (n: number) => void
): Promise<Uint8Array> {
	// GROUP is advisory for BODY <message-id> on most servers, but selecting one the
	// article lives in maximizes the odds the backend serves it. Try each in turn.
	for (const g of file.groups) {
		if (await client.group(g)) break;
	}
	const parts: Uint8Array[] = [];
	for (const seg of file.segments) {
		const lines = await client.body(seg.messageId);
		if (!lines) continue; // a missing segment yields an incomplete (skipped) file
		const { data } = decodeYencArticle(lines);
		parts.push(data);
		onBytes(data.length);
	}
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

// Keep only the basename and replace filesystem-unsafe characters (control chars and
// the Windows-reserved set). Spaces, dots, digits and letters are preserved so the
// extension and tags survive; the scanner walks subdirectories so flat is fine.
const UNSAFE = /[<>:"/\\|?*]/g;
function safeName(name: string): string {
	const base = basename(name.replace(/\\/g, '/'));
	let cleaned = '';
	for (const ch of base) {
		const code = ch.charCodeAt(0);
		cleaned += code < 0x20 || UNSAFE.test(ch) ? '_' : ch;
		UNSAFE.lastIndex = 0;
	}
	return cleaned.trim() || 'file.bin';
}
