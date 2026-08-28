import { describe, expect, it, vi } from 'vitest';
import { requestFastGptCompletion } from '../src/modules/conversations/fastgpt-client.js';

const input = {
  apiKey: 'fastgpt-test-key',
  chatId: 'chat-test-id',
  temperature: 0.3,
  messages: [{ role: 'user' as const, content: '退款多久到账？' }],
};

describe('FastGPT client', () => {
  it('sends a non-streaming request and maps completion metadata', async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, _request?: RequestInit) => new Response(JSON.stringify({
      id: 'message-123',
      model: 'fastgpt-test',
      choices: [{ message: { content: '退款会在三个工作日内到账。' } }],
      usage: { prompt_tokens: 12, completion_tokens: 9 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await requestFastGptCompletion(input, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      baseUrl: 'https://fastgpt.example.com/api/v1',
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({
      content: '退款会在三个工作日内到账。',
      externalMessageId: 'message-123',
      model: 'fastgpt-test',
      promptTokens: 12,
      completionTokens: 9,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://fastgpt.example.com/api/v1/chat/completions');
    expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer fastgpt-test-key');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      chatId: 'chat-test-id',
      stream: false,
      detail: false,
      temperature: 0.3,
      messages: input.messages,
    });
  });

  it.each([
    [401, 'FASTGPT_AUTHENTICATION_FAILED', 502],
    [429, 'FASTGPT_RATE_LIMITED', 503],
    [500, 'FASTGPT_UPSTREAM_ERROR', 502],
  ])('maps upstream status %s to a stable application error', async (status, code, appStatus) => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, _request?: RequestInit) => (
      new Response('upstream details', { status })
    ));

    await expect(requestFastGptCompletion(input, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 1000,
    })).rejects.toMatchObject({ code, status: appStatus });
  });

  it('rejects malformed successful responses', async () => {
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, _request?: RequestInit) => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(requestFastGptCompletion(input, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 1000,
    })).rejects.toMatchObject({ code: 'FASTGPT_INVALID_RESPONSE', status: 502 });
  });

  it('aborts requests that exceed the configured timeout', async () => {
    const fetchMock = vi.fn((_url: URL | RequestInfo, request?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        request?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    ));

    await expect(requestFastGptCompletion(input, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'FASTGPT_TIMEOUT', status: 504 });
  });
});
