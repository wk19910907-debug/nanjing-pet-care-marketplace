export type KeyValueStorage = {
  get(key: string): string | undefined;
  set(key: string, value: string): unknown;
  remove(key: string): unknown;
};

const SESSION_KEY = 'petcare.session';

export function createSessionStore(storage: KeyValueStorage) {
  return {
    read: () => storage.get(SESSION_KEY) ?? null,
    save: (opaqueToken: string) => storage.set(SESSION_KEY, opaqueToken),
    clear: () => storage.remove(SESSION_KEY),
  };
}
