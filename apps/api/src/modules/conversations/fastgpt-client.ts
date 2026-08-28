import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';

const fastGptResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(z.object({
    message: z.object({
      content: z.string().min(1),
    }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().min(0).optional(),
    completion_tokens: z.number().int().min(0).optional(),
  }).optional(),
});

export interface FastGptChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FastGptCompletionInput {
  apiKey: string;
  chatId: string;
  messages: FastGptChatMessage[];
  temperature: number;
}

export interface FastGptCompletion {
  content: string;
  externalMessageId: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}

interface FastGptClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export async function requestFastGptCompletion(
  input: FastGptCompletionInput,
  options: FastGptClientOptions = {},
): Promise<FastGptCompletion> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? env.FASTGPT_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? env.FASTGPT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetchImpl(
      new URL('chat/completions', `${baseUrl.replace(/\/$/u, '')}/`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatId: input.chatId,
          stream: false,
          detail: false,
          temperature: input.temperature,
          messages: input.messages,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AppError(502, 'FASTGPT_AUTHENTICATION_FAILED', 'FastGPT 凭据验证失败');
      }
      if (response.status === 429) {
        throw new AppError(503, 'FASTGPT_RATE_LIMITED', 'FastGPT 请求过于频繁，请稍后重试');
      }
      throw new AppError(502, 'FASTGPT_UPSTREAM_ERROR', 'FastGPT 服务返回异常');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError(502, 'FASTGPT_INVALID_RESPONSE', 'FastGPT 返回了无法解析的响应');
    }
    const parsed = fastGptResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError(502, 'FASTGPT_INVALID_RESPONSE', 'FastGPT 返回的数据格式不完整');
    }

    return {
      content: parsed.data.choices[0]!.message.content.trim(),
      externalMessageId: parsed.data.id ?? null,
      model: parsed.data.model ?? null,
      promptTokens: parsed.data.usage?.prompt_tokens ?? null,
      completionTokens: parsed.data.usage?.completion_tokens ?? null,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (controller.signal.aborted) {
      throw new AppError(504, 'FASTGPT_TIMEOUT', 'FastGPT 响应超时，请稍后重试');
    }
    throw new AppError(502, 'FASTGPT_UNAVAILABLE', '无法连接 FastGPT 服务');
  } finally {
    clearTimeout(timeout);
  }
}
