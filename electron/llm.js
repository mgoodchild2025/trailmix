// Claude calls for enhancing notes and chatting with meetings. Streams text deltas
// to a callback so the UI can render notes as they're written.
import Anthropic from '@anthropic-ai/sdk';

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

export async function streamClaude({ apiKey, model, system, messages, effort = 'medium', maxTokens = 32000, onDelta, signal }) {
  if (!apiKey) throw new Error('Add your Anthropic API key in Settings to use AI features.');
  const client = new Anthropic({ apiKey });
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort },
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  try {
    const stream = client.beta.messages.stream(params, { signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onDelta?.(ev.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new Error('Claude declined to process this request.');
    }
    const text = final.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, truncated: final.stop_reason === 'max_tokens' };
  } catch (err) {
    throw friendlyError(err);
  }
}

function friendlyError(err) {
  if (err instanceof Anthropic.APIUserAbortError) return Object.assign(new Error('Cancelled'), { cancelled: true });
  if (err instanceof Anthropic.AuthenticationError) return new Error('Anthropic rejected the API key. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) return new Error(`This API key can't use that model: ${err.message}`);
  if (err instanceof Anthropic.NotFoundError) return new Error(`Model not found. Check the Claude model in Settings. (${err.message})`);
  if (err instanceof Anthropic.RateLimitError) return new Error('Anthropic rate limit hit. Wait a moment and try again.');
  if (err instanceof Anthropic.APIConnectionError) return new Error('Could not reach Anthropic. Check your internet connection.');
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic error ${err.status ?? ''}: ${err.message}`);
  return err;
}
