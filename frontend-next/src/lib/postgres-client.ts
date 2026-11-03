import { Pool, type PoolClient, type QueryResult } from 'pg';

type Options = { fetchOptions?: { signal?: AbortSignal } };
type Query = { text: string; values: unknown[]; options?: Options; execute: () => Promise<any[]> } & PromiseLike<any[]>;

/** Keep tagged queries lazy so a transaction can run every statement on one connection. */
export function createPostgresSql(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    allowExitOnIdle: true,
  });
  pool.on('error', () => console.error('Idle PostgreSQL connection failed.'));
  const rows = (result: QueryResult | QueryResult[]) => Array.isArray(result)
    ? result.flatMap(item => item.rows) : result.rows;
  async function run(client: PoolClient, query: Pick<Query, 'text' | 'values' | 'options'>) {
    query.options?.fetchOptions?.signal?.throwIfAborted();
    const config = { text: query.text, values: query.values,
      query_timeout: query.options?.fetchOptions?.signal ? 2000 : 15000 };
    return rows(await client.query(config));
  }
  function query(text: string, values: unknown[] = [], options?: Options): Query {
    let pending: Promise<any[]> | undefined;
    const execute = () => pending ??= (async () => {
      options?.fetchOptions?.signal?.throwIfAborted();
      const client = await pool.connect();
      let failed = false;
      try { return await run(client, { text, values, options }); }
      catch (error) { failed = true; throw error; }
      finally { client.release(failed); }
    })();
    return { text, values, options, execute,
      then: (resolve, reject) => execute().then(resolve, reject),
      catch: (reject: (reason: unknown) => unknown) => execute().catch(reject),
      finally: (callback: () => void) => execute().finally(callback),
    } as Query;
  }
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => query(
    strings.reduce((text, part, index) => text + (index ? '$' + index : '') + part, ''), values
  );
  return Object.assign(tagged, { query, end: () => pool.end(),
    async transaction(queries: Query[]) {
      const client = await pool.connect();
      let failed = false;
      try {
        await client.query('BEGIN');
        const results = [];
        for (const item of queries) results.push(await run(client, item));
        await client.query('COMMIT');
        return results;
      } catch (error) {
        failed = true;
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(failed); }
    },
  });
}
