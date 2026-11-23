// v0.5 — content hash of a declarative component document (app-store-spec v0.5 §1.4.3).
// sha384 over the CANONICAL JSON-LD serialization, top-level @id EXCLUDED: the identity is
// carried by the versioned resource IRI; hashing @id would change the hash at each storage
// (decision ratified at J8, found by the chantier-3 TCK — app-ui-editor/src/publish.js).
// Same mechanics as the bundle SRI (sha384, base64).

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function hashableDoc(doc) {
  const { '@id': _omit, ...rest } = doc ?? {};
  return rest;
}

export async function sha384Base64(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('WebCrypto subtle unavailable');
  const buf = await subtle.digest('SHA-384', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export async function documentHash(doc, subtle) {
  return sha384Base64(canonicalJson(hashableDoc(doc)), subtle);
}
