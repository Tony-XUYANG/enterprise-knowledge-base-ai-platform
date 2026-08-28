import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { AuthResult } from './types';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
const accessCookieName = 'kh_access_token';
const refreshCookieName = 'kh_refresh_token';
const secureCookies = process.env.NODE_ENV === 'production';

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

async function setSessionCookies(session: AuthResult): Promise<void> {
  const cookieStore = await cookies();
  const common = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax' as const,
    path: '/',
  };

  cookieStore.set(accessCookieName, session.accessToken, {
    ...common,
    maxAge: session.accessTokenExpiresIn,
  });
  cookieStore.set(refreshCookieName, session.refreshToken, {
    ...common,
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(accessCookieName);
  cookieStore.delete(refreshCookieName);
}

export async function handleAuthentication(
  backendPath: '/register' | '/login',
  request: Request,
): Promise<NextResponse> {
  try {
    const userAgent = request.headers.get('user-agent');
    const upstream = await fetch(`${apiBaseUrl}/api/v1/auth${backendPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
      },
      body: await request.text(),
      cache: 'no-store',
    });
    const payload = (await upstream.json()) as { data?: AuthResult };

    if (!upstream.ok || !payload.data) {
      return NextResponse.json(payload, { status: upstream.status });
    }

    await setSessionCookies(payload.data);
    return NextResponse.json({ data: payload.data.user }, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_UNAVAILABLE', message: '服务暂时不可用，请稍后重试' } },
      { status: 502 },
    );
  }
}

async function backendFetch(path: string, accessToken: string, init?: RequestInit) {
  return fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
    cache: 'no-store',
  });
}

export async function authenticatedApiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(accessCookieName)?.value;

  if (!accessToken) {
    return jsonError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }

  try {
    let upstream = await backendFetch(path, accessToken, init);
    if (upstream.status !== 401) return upstream;

    const refreshToken = cookieStore.get(refreshCookieName)?.value;
    if (!refreshToken) {
      await clearSessionCookies();
      return upstream;
    }

    const refreshResponse = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });

    if (!refreshResponse.ok) {
      await clearSessionCookies();
      return jsonError(401, 'SESSION_EXPIRED', '登录状态已过期，请重新登录');
    }

    const payload = (await refreshResponse.json()) as { data: AuthResult };
    await setSessionCookies(payload.data);
    upstream = await backendFetch(path, payload.data.accessToken, init);
    return upstream;
  } catch {
    return jsonError(502, 'API_UNAVAILABLE', '服务暂时不可用，请稍后重试');
  }
}

export async function proxyResponse(upstream: Response): Promise<NextResponse> {
  const body = upstream.status === 204 ? null : await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: body
      ? { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' }
      : undefined,
  });
}

export async function hasSessionCookie(): Promise<boolean> {
  return Boolean((await cookies()).get(accessCookieName)?.value);
}

export async function logoutSession(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(refreshCookieName)?.value;

  if (refreshToken) {
    try {
      await fetch(`${apiBaseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
    } catch {
      // Local cookie removal still ends the browser session when the API is unavailable.
    }
  }

  await clearSessionCookies();
  return NextResponse.json({ data: null });
}
