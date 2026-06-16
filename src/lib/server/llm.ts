import { env } from '$env/dynamic/private';

/**
 * Local LLM client — talks to an OpenAI-compatible endpoint (Ollama / LM Studio)
 * at LOCAL_LLM_BASE_URL, e.g. the basement RTX 3090 or the M5 over Tailscale.
 * Privacy-first: there is deliberately NO cloud fallback.
 *
 * WIRED BUT UNUSED in v1. The M7 "discovery brain" (library radio, natural-language
 * search, auto mood/genre tagging) will call chatJson(); nothing here runs today.
 */

const baseUrl = () => (env.LOCAL_LLM_BASE_URL ?? '').replace(/\/$/, '');
const model = () => env.LOCAL_LLM_MODEL || 'llama3.1:8b';

export function llmConfigured(): boolean {
	return baseUrl().length > 0;
}

export function llmModel(): string {
	return model();
}

/** Ask the local model for a JSON object. Returns null if unset/unreachable/bad. */
export async function chatJson(system: string, user: string, timeoutMs = 60_000): Promise<unknown> {
	if (baseUrl().length === 0) return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${baseUrl()}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: model(),
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user }
				],
				temperature: 0.2,
				stream: false,
				response_format: { type: 'json_object' }
			}),
			signal: controller.signal
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
		return parseJsonLoose(data?.choices?.[0]?.message?.content ?? '');
	} catch {
		return null; // model down / timeout / bad JSON — degrade silently
	} finally {
		clearTimeout(timer);
	}
}

function parseJsonLoose(content: string): unknown {
	try {
		return JSON.parse(content);
	} catch {
		const m = content.match(/\{[\s\S]*\}/);
		if (m) {
			try {
				return JSON.parse(m[0]);
			} catch {
				/* fall through */
			}
		}
		return null;
	}
}
