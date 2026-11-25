import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';

const DEFAULT_API_URL = 'https://proxyxoay.shop/api/get.php';
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_TTL_SECONDS = 600;
const TTL_SAFETY_MARGIN_SECONDS = 45;
const MIN_ROTATE_INTERVAL_MS = 60_000;

export interface ProxyEndpoint {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ProxyLease {
  endpoint: ProxyEndpoint;
  ip?: string;
  isp?: string;
  location?: string;
  obtainedAt: number;
  expiresAt: number;
}

export interface RotatingFetchOptions {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | Buffer | URLSearchParams;
  timeoutMs?: number;
  maxBytes?: number;
  /** Return true when the response looks blocked and warrants rotating the proxy IP. */
  shouldRotate?: (response: RotatingFetchResponse) => boolean;
}

export interface RotatingFetchResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: Buffer;
  text: () => string;
  json: <T = any>() => T;
}

interface ProxyVnApiResponse {
  status?: number;
  message?: string;
  proxyhttp?: string;
  proxysocks5?: string;
  ip?: string;
  'Nha Mang'?: string;
  'Vi Tri'?: string;
}

let currentLease: ProxyLease | null = null;
let nextRotateAllowedAt = 0;
let inFlightRefresh: Promise<ProxyLease | null> | null = null;

function proxyApiKey(): string {
  return process.env.PROXY_VN_API_KEY?.trim() || '';
}

export function isRotatingProxyEnabled(): boolean {
  return Boolean(proxyApiKey());
}

/** Reset internal in-memory lease state (primarily for tests). */
export function resetRotatingProxyState(): void {
  currentLease = null;
  nextRotateAllowedAt = 0;
  inFlightRefresh = null;
}

/** Parse proxy.vn `proxyhttp` format: `ip:port` or `ip:port:user:pass` (user/pass may be empty). */
export function parseProxyHttp(raw?: string | null): ProxyEndpoint | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.trim().split(':');
  if (parts.length < 2) return null;
  const host = parts[0].trim();
  const port = Number.parseInt(parts[1].trim(), 10);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const username = parts[2]?.trim() || undefined;
  const password = parts.length > 3 ? parts.slice(3).join(':').trim() || undefined : undefined;
  return { host, port, ...(username ? { username, password: password || '' } : {}) };
}

/** Extract remaining lifetime in seconds from messages like `"proxy nay se die sau 1746s"`. */
export function parseProxyTtlSeconds(message?: string | null): number {
  const match = message?.match(/(\d+)\s*s\b/i);
  const seconds = match ? Number.parseInt(match[1], 10) : DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_TTL_SECONDS;
  return Math.max(30, seconds - TTL_SAFETY_MARGIN_SECONDS);
}

/** Extract cooldown wait time in seconds from messages like `"Con 38s moi co the doi proxy"`. */
export function parseProxyCooldownSeconds(message?: string | null): number {
  const match = message?.match(/(\d+)\s*s\b/i);
  const seconds = match ? Number.parseInt(match[1], 10) : 30;
  if (!Number.isFinite(seconds) || seconds <= 0) return 30;
  return Math.min(300, seconds);
}

function buildProxyApiUrl(): string {
  const base = process.env.PROXY_VN_API_URL?.trim() || DEFAULT_API_URL;
  const url = new URL(base);
  url.searchParams.set('key', proxyApiKey());
  url.searchParams.set('nhamang', process.env.PROXY_VN_ISP?.trim() || 'random');
  url.searchParams.set('tinhthanh', process.env.PROXY_VN_PROVINCE?.trim() || '0');
  const whitelist = process.env.PROXY_VN_WHITELIST?.trim();
  if (whitelist) url.searchParams.set('whitelist', whitelist);
  return url.toString();
}

async function fetchNewLease(): Promise<ProxyLease | null> {
  const now = Date.now();
  try {
    const res = await fetch(buildProxyApiUrl(), {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return currentLease && now < currentLease.expiresAt ? currentLease : null;
    const data = (await res.json()) as ProxyVnApiResponse;
    if (data.status === 100) {
      const endpoint = parseProxyHttp(data.proxyhttp);
      if (!endpoint) return currentLease && now < currentLease.expiresAt ? currentLease : null;
      const ttlSeconds = parseProxyTtlSeconds(data.message);
      const lease: ProxyLease = {
        endpoint,
        ip: data.ip,
        isp: data['Nha Mang'],
        location: data['Vi Tri'],
        obtainedAt: now,
        expiresAt: now + ttlSeconds * 1000,
      };
      currentLease = lease;
      nextRotateAllowedAt = now + MIN_ROTATE_INTERVAL_MS;
      return lease;
    }
    if (data.status === 101) {
      const cooldownSeconds = parseProxyCooldownSeconds(data.message);
      nextRotateAllowedAt = now + cooldownSeconds * 1000;
      return currentLease && now < currentLease.expiresAt ? currentLease : null;
    }
    return currentLease && now < currentLease.expiresAt ? currentLease : null;
  } catch {
    return currentLease && now < currentLease.expiresAt ? currentLease : null;
  }
}

/**
 * Return an active rotating proxy lease from proxy.vn.
 * Reuses the cached lease until it expires or `forceRotate` is requested outside cooldown.
 */
export async function getRotatingProxy(forceRotate = false): Promise<ProxyLease | null> {
  if (!isRotatingProxyEnabled()) return null;
  const now = Date.now();
  if (!forceRotate && currentLease && now < currentLease.expiresAt) {
    return currentLease;
  }
  if (now < nextRotateAllowedAt) {
    return currentLease && now < currentLease.expiresAt ? currentLease : null;
  }
  if (!inFlightRefresh) {
    inFlightRefresh = fetchNewLease().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

function proxyAuthHeader(proxy: ProxyEndpoint): string | undefined {
  if (!proxy.username) return undefined;
  return 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
}

function normalizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

function decompressBody(buffer: Buffer, encoding?: string): Buffer {
  if (!buffer.length || !encoding) return buffer;
  const normalized = encoding.toLowerCase().trim();
  try {
    if (normalized === 'gzip' || normalized === 'x-gzip') return zlib.gunzipSync(buffer);
    if (normalized === 'deflate') return zlib.inflateSync(buffer);
    if (normalized === 'br') return zlib.brotliDecompressSync(buffer);
  } catch {
    // Return raw bytes if upstream sent a mismatched Content-Encoding header.
  }
  return buffer;
}

function serializeBody(body?: string | Buffer | URLSearchParams): Buffer | undefined {
  if (body === undefined) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8');
  return Buffer.from(body, 'utf8');
}

function buildResponse(status: number, headers: Record<string, string>, rawBody: Buffer): RotatingFetchResponse {
  const body = decompressBody(rawBody, headers['content-encoding']);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    body,
    text: () => body.toString('utf8'),
    json: <T = any>() => JSON.parse(body.toString('utf8')) as T,
  };
}

/**
 * Execute an HTTP or HTTPS request through an HTTP proxy.
 * Uses a raw TCP `CONNECT` tunnel + `tls.connect` for HTTPS so proxies that respond
 * with `HTTP/1.0 200 Connection established` (like proxy.vn) work reliably.
 */
export function requestThroughHttpProxy(
  targetUrl: string,
  proxy: ProxyEndpoint,
  options: RotatingFetchOptions = {}
): Promise<RotatingFetchResponse> {
  const url = new URL(targetUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return Promise.reject(new Error('Unsupported target protocol: ' + url.protocol));
  }

  const method = options.method || 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const payload = serializeBody(options.body);
  const auth = proxyAuthHeader(proxy);

  const reqHeaders: Record<string, string> = {
    Host: url.host,
    'Accept-Encoding': 'gzip, deflate, br',
    Connection: 'close',
    ...options.headers,
  };
  if (payload && !Object.keys(reqHeaders).some(k => k.toLowerCase() === 'content-length')) {
    reqHeaders['Content-Length'] = String(payload.length);
  }

  if (url.protocol === 'http:') {
    if (auth) reqHeaders['Proxy-Authorization'] = auth;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: Error, res?: RotatingFetchResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(res!);
      };

      const req = http.request(
        {
          host: proxy.host,
          port: proxy.port,
          method,
          path: url.toString(),
          headers: reqHeaders,
        },
        res => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              res.destroy();
              done(new Error('Proxy response exceeded size limit'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => done(undefined, buildResponse(res.statusCode || 502, normalizeHeaders(res.headers), Buffer.concat(chunks))));
          res.on('error', err => done(err));
        }
      );

      const timer = setTimeout(() => {
        req.destroy(new Error('Proxy request timed out'));
      }, timeoutMs);

      req.on('error', err => done(err));
      if (payload) req.write(payload);
      req.end();
    });
  }

  // HTTPS via explicit CONNECT tunnel
  const targetPort = url.port ? Number.parseInt(url.port, 10) : 443;
  const authority = `${url.hostname}:${targetPort}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: net.Socket | null = null;
    let tlsSocket: tls.TLSSocket | null = null;
    let upstreamReq: http.ClientRequest | null = null;

    const cleanup = () => {
      clearTimeout(timer);
      upstreamReq?.destroy();
      tlsSocket?.destroy();
      socket?.destroy();
    };

    const done = (err?: Error, res?: RotatingFetchResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        cleanup();
        reject(err);
      } else {
        resolve(res!);
      }
    };

    const timer = setTimeout(() => {
      done(new Error('Rotating proxy request timed out'));
    }, timeoutMs);

    socket = net.connect(proxy.port, proxy.host, () => {
      const lines = [
        `CONNECT ${authority} HTTP/1.1`,
        `Host: ${authority}`,
        'Proxy-Connection: Keep-Alive',
      ];
      if (auth) lines.push(`Proxy-Authorization: ${auth}`);
      socket!.write(lines.join('\r\n') + '\r\n\r\n');
    });

    socket.on('error', err => done(err));
    socket.on('end', () => {
      if (!tlsSocket) done(new Error('Proxy closed connection before CONNECT completed'));
    });

    let headerBuf = Buffer.alloc(0);
    const onConnectData = (chunk: Buffer) => {
      headerBuf = Buffer.concat([headerBuf, chunk]);
      if (headerBuf.length > 16_384) {
        done(new Error('Proxy CONNECT response headers too large'));
        return;
      }
      const sep = headerBuf.indexOf('\r\n\r\n');
      if (sep === -1) return;

      socket!.off('data', onConnectData);
      const statusLine = headerBuf.subarray(0, sep).toString('utf8').split('\r\n')[0] || '';
      if (!/^HTTP\/1\.[01]\s+200\b/.test(statusLine)) {
        done(new Error('Proxy CONNECT rejected: ' + statusLine));
        return;
      }

      const remainder = headerBuf.subarray(sep + 4);
      if (remainder.length) socket!.unshift(remainder);

      tlsSocket = tls.connect({
        socket: socket!,
        servername: url.hostname,
      });
      tlsSocket.once('error', err => done(err));

      upstreamReq = http.request(
        {
          hostname: url.hostname,
          port: targetPort,
          path: url.pathname + url.search,
          method,
          createConnection: () => tlsSocket!,
          headers: reqHeaders,
        },
        res => {
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total > maxBytes) {
              res.destroy();
              done(new Error('Proxy response exceeded size limit'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            done(undefined, buildResponse(res.statusCode || 502, normalizeHeaders(res.headers), Buffer.concat(chunks)));
          });
          res.on('error', err => done(err));
        }
      );

      upstreamReq.on('error', err => done(err));
      if (payload) upstreamReq.write(payload);
      upstreamReq.end();
    };

    socket.on('data', onConnectData);
  });
}

function defaultShouldRotate(response: RotatingFetchResponse): boolean {
  return response.status === 403 || response.status === 429 || response.status === 503;
}

/**
 * Fetch a URL via the proxy.vn rotating proxy.
 * Automatically rotates the proxy IP once if the request fails or appears blocked
 * (and rotation is outside proxy.vn's cooldown window).
 */
export async function fetchViaRotatingProxy(
  targetUrl: string,
  options: RotatingFetchOptions = {}
): Promise<RotatingFetchResponse> {
  const lease = await getRotatingProxy(false);
  if (!lease) {
    throw new Error('Rotating proxy is not configured or unavailable');
  }

  const checkRotate = options.shouldRotate || defaultShouldRotate;
  let firstResponse: RotatingFetchResponse | undefined;
  let firstError: unknown;

  try {
    firstResponse = await requestThroughHttpProxy(targetUrl, lease.endpoint, options);
    if (!checkRotate(firstResponse)) {
      return firstResponse;
    }
  } catch (error) {
    firstError = error;
  }

  // Attempt one rotation if cooldown allows.
  const rotated = await getRotatingProxy(true);
  const changed =
    rotated &&
    (rotated.obtainedAt !== lease.obtainedAt ||
      rotated.endpoint.host !== lease.endpoint.host ||
      rotated.endpoint.port !== lease.endpoint.port ||
      rotated.ip !== lease.ip);

  if (changed) {
    return requestThroughHttpProxy(targetUrl, rotated.endpoint, options);
  }

  if (firstResponse) return firstResponse;
  throw firstError instanceof Error ? firstError : new Error('Rotating proxy request failed');
}
