import type { NeonQueryFunction } from '@neondatabase/serverless';

type Options = { fetchOptions?: { signal?: AbortSignal } };
type Statement = { text: string; values: unknown[] };
type Query = Statement & PromiseLike<any[]>;

/** HTTPS transport for hosts that block outbound PostgreSQL TCP connections. */
export function createPostgresHttpSql(endpoint: string, token: string) {
  if (new URL(endpoint).protocol !== 'https:' || !token) throw new Error('Private HTTPS database configuration is required');
  async function send(queries: Statement[], transaction: boolean, options?: Options): Promise<any[][]> {
    const signal = options?.fetchOptions?.signal
      ? AbortSignal.any([options.fetchOptions.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    const response = await fetch(endpoint, {
      method: 'POST', cache: 'no-store', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ queries, transaction }),
    });
    if (!response.ok) throw new Error(`Private database request failed (${response.status})`);
    const result = await response.json();
    if (!Array.isArray(result.results)) throw new Error('Invalid private database response');
    return result.results;
  }
  function query(text: string, values: unknown[] = [], options?: Options): Query {
    let pending: Promise<any[]> | undefined;
    const execute = () => pending ??= send([{ text, values }], false, options).then(results => results[0]);
    return { text, values,
      then: (resolve, reject) => execute().then(resolve, reject),
      catch: (reject: (error: unknown) => unknown) => execute().catch(reject),
      finally: (callback: () => void) => execute().finally(callback),
    } as Query;
  }
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => query(
    strings.reduce((text, part, index) => text + (index ? '$' + index : '') + part, ''), values);
  return Object.assign(tagged, { query,
    transaction: (queries: Query[]) => send(queries.map(({ text, values }) => ({ text, values })), true),
  }) as unknown as NeonQueryFunction<false, false>;
}
