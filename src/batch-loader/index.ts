const TYPEQL_LOADERS_KEY = Symbol('typeql-loaders');

type BatchFunction<K, V> = (keys: readonly K[]) => Promise<readonly V[]>;

interface LoaderContainer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Map stores generic BatchLoaders, cast on get
  [TYPEQL_LOADERS_KEY]?: Map<string, BatchLoader<any, any>>;
}

class BatchLoader<K, V> {
  private batch: Array<{
    key: K;
    resolve: (value: V) => void;
    reject: (error: unknown) => void;
  }> = [];
  private scheduled = false;

  constructor(private readonly batchFunction: BatchFunction<K, V>) {}

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
      const results = await this.batchFunction(current.map(({ key }) => key));
      for (let i = 0; i < current.length; i++) {
        current[i]!.resolve(results[i] as V);
      }
    } catch (error) {
      for (const { reject } of current) {
        reject(error);
      }
    }
  }
}

/**
 * Returns a BatchLoader keyed by `key` on the GraphQL context object.
 * If context is absent, returns a fresh (unbatched) loader.
 */
export const getOrCreateLoader = <K, V>(
  context: unknown,
  key: string,
  batchFunction: BatchFunction<K, V>,
): BatchLoader<K, V> => {
  if (!context || typeof context !== 'object') {
    return new BatchLoader<K, V>(batchFunction);
  }
  const container = context as LoaderContainer;
  if (!container[TYPEQL_LOADERS_KEY]) {
    container[TYPEQL_LOADERS_KEY] = new Map();
  }
  const loaders = container[TYPEQL_LOADERS_KEY]!;
  if (!loaders.has(key)) {
    loaders.set(key, new BatchLoader<K, V>(batchFunction));
  }
  return loaders.get(key) as BatchLoader<K, V>;
};
