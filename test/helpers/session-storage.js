export function createSessionStorage() {
  const stored = {};
  return {
    async get(key) { return structuredClone(key === null ? stored : { [key]: stored[key] }); },
    async set(values) { Object.assign(stored, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
  };
}
