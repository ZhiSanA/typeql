const TYPEQL_LOADERS_KEY = Symbol('typeql-loaders');

type BatchFn<K, V> = (keys: readonly K[]) => Promise<readonly V[]>;

class BatchLoader<K, V> {
  private batch: Array<{ key: K; resolve: (v: V) => void; reject: (e: unknown) => void }> = [];
  private scheduled = false;

  constructor(private readonly batchFn: BatchFn<K, V>) {}

  load(key: K): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      this.batch.push({ key, resolve, reject });
      if (!this.scheduled) {
        this.scheduled = true;
        Promise.resolve().then(() => this.dispatch());
      }
    });
  }

  private async dispatch(): Promise<void> {
    const current = this.batch.splice(0);
    this.scheduled = false;
    try {
      const results = await this.batchFn(current.map(({ key }) => key));
      for (let i = 0; i < current.length; i++) {
        current[i]!.resolve(results[i] as V);
      }
    } catch (err) {
      for (const { reject } of current) {
        reject(err);
      }
    }
  }
}

/**
 * Returns a BatchLoader keyed by `key` on the GraphQL context object.
 * If context is absent, returns a fresh (unbatched) loader.
 */
export const getOrCreateLoader = <K, V>(
  context: any,
  key: string,
  batchFn: BatchFn<K, V>,
): BatchLoader<K, V> => {
  if (!context || typeof context !== 'object') {
    return new BatchLoader<K, V>(batchFn);
  }
  if (!context[TYPEQL_LOADERS_KEY]) {
    context[TYPEQL_LOADERS_KEY] = new Map<string, BatchLoader<any, any>>();
  }
  const loaders = context[TYPEQL_LOADERS_KEY] as Map<string, BatchLoader<any, any>>;
  if (!loaders.has(key)) {
    loaders.set(key, new BatchLoader<K, V>(batchFn));
  }
  return loaders.get(key) as BatchLoader<K, V>;
};