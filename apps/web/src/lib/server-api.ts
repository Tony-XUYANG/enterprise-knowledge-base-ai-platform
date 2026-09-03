import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type {
  AuthResult,
  MfaRequiredResult,
  RegistrationVerificationRequired,
} from './types';

const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
const accessCookieName = 'kh_access_token';
const refreshCookieName = 'kh_refresh_token';
const secureCookies = process.env.NODE_ENV === 'production';
// Let late parallel route handlers reuse the same rotation result without replaying the old token.
const refreshFlightRetentionMs = 2_000;

interface RefreshFlightResult {
  session: AuthResult | null;
}

const refreshFlights = new Map<string, Promise<RefreshFlightResult>>();

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export function clientContextHeaders(request: Request): Record<string, string> {
  const userAgent = request.headers.get('user-agent')?.trim().slice(0, 512);
  return userAgent ? { 'User-Agent': userAgent } : {};
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

function isMfaRequired(
  result: AuthResult | MfaRequiredResult | RegistrationVerificationRequired,
): result is MfaRequiredResult {
  return 'mfaRequired' in result && result.mfaRequired;
}

function isRegistrationVerificationRequired(
  result: AuthResult | MfaRequiredResult | RegistrationVerificationRequired,
): result is RegistrationVerificationRequired {
  return 'verificationRequired' in result && result.verificationRequired;
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
    const upstream = await fetch(`${apiBaseUrl}/api/v1/auth${backendPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...clientContextHeaders(request),
      },
      body: await request.text(),
      cache: 'no-store',
    });
    const payload = (await upstream.json()) as {
      data?: AuthResult | MfaRequiredResult | RegistrationVerificationRequired;
    };

    if (!upstream.ok || !payload.data) {
      return NextResponse.json(payload, { status: upstream.status });
    }

    if (isMfaRequired(payload.data)) {
      return NextResponse.json({ data: payload.data }, { status: upstream.status });
    }

    if (isRegistrationVerificationRequired(payload.data)) {
      await clearSessionCookies();
      return NextResponse.json({ data: payload.data }, { status: upstream.status });
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

export async function handleMfaVerification(request: Request): Promise<NextResponse> {
  try {
    const upstream = await fetch(`${apiBaseUrl}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...clientContextHeaders(request),
      },
      body: await request.text(),
      cache: 'no-store',
    });
    const payload = (await upstream.json()) as { data?: AuthResult };
    if (!upstream.ok || !payload.data) {
      return NextResponse.json(payload, { status: upstream.status });
    }

    await setSessionCookies(payload.data);
    return NextResponse.json({ data: payload.data.user });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_UNAVAILABLE', message: '服务暂时不可用，请稍后重试' } },
      { status: 502 },
    );
  }
}

export async function publicApiFetch(path: string, request: Request): Promise<Response> {
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        ...clientContextHeaders(request),
      },
      body: request.method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
    });
  } catch {
    return jsonError(502, 'API_UNAVAILABLE', '服务暂时不可用，请稍后重试');
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

function refreshSession(refreshToken: string): Promise<RefreshFlightResult> {
  const tokenKey = createHash('sha256').update(refreshToken).digest('hex');
  const existingFlight = refreshFlights.get(tokenKey);
  if (existingFlight) return existingFlight;

  const flight = (async () => {
    const response = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!response.ok) return { session: null };
    const payload = (await response.json()) as { data: AuthResult };
    return { session: payload.data };
  })();
  refreshFlights.set(tokenKey, flight);

  const clearFlight = () => {
    setTimeout(() => {
      if (refreshFlights.get(tokenKey) === flight) refreshFlights.delete(tokenKey);
    }, refreshFlightRetentionMs);
  };
  void flight.then(clearFlight, clearFlight);
  return flight;
}

export async function authenticatedApiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(accessCookieName)?.value;
  const refreshToken = cookieStore.get(refreshCookieName)?.value;

  if (!accessToken && !refreshToken) {
    return jsonError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
  }

  try {
    let upstream: Response | undefined;
    if (accessToken) {
      upstream = await backendFetch(path, accessToken, init);
      if (upstream.status !== 401) return upstream;
    }

    if (!refreshToken) {
      await clearSessionCookies();
      return upstream ?? jsonError(401, 'AUTHENTICATION_REQUIRED', '请先登录');
    }

    const refreshResult = await refreshSession(refreshToken);
    if (!refreshResult.session) {
      await clearSessionCookies();
      return jsonError(401, 'SESSION_EXPIRED', '登录状态已过期，请重新登录');
    }

    await setSessionCookies(refreshResult.session);
    upstream = await backendFetch(path, refreshResult.session.accessToken, init);
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

export async function proxyDownloadResponse(upstream: Response): Promise<NextResponse> {
  const headers = new Headers();
  for (const name of [
    'Cache-Control',
    'Content-Disposition',
    'Content-Type',
    'X-Export-Row-Count',
    'X-Export-Truncated',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers,
  });
}

export async function hasSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return Boolean(
    cookieStore.get(accessCookieName)?.value
    || cookieStore.get(refreshCookieName)?.value,
  );
}

export async function logoutSession(request?: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(refreshCookieName)?.value;

  if (refreshToken) {
    try {
      await fetch(`${apiBaseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(request ? clientContextHeaders(request) : {}),
        },
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
