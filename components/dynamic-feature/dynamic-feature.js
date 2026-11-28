// <dynamic-feature> — on-the-fly mount host for a feature (spec Part 2 §2.2.7).
//
//   <dynamic-feature slug="demo-weather"></dynamic-feature>
//
// - packaged feature (v1, component in orbit.json): waits for customElements.whenDefined(tag)
//   then mounts <tag>.
// - remote feature (v2, cdn_url + sri in the catalogue): loads via loader.js (SRI verified
//   before import, CA-A5), then mounts <tag>. The route of a remote feature is mounted
//   on the fly in the shell via this component.
// - SRI / network error → explicit error panel (no crash), CA-A5.
import { LitElement, html, css } from 'lit';
import appStore from '../shared/app-store-api.js';
import { get as getField, isDistant, isDeclarative, isInstalled } from '../shared/logic.js';
import { loadRemoteModule, SriMismatchError } from '../shared/loader.js';
import { documentHash } from '../shared/hash.js';

export class DynamicFeature extends LitElement {
  static properties = {
    slug: { type: String },
    state: { type: String, attribute: false },   // 'pending' | 'mounted' | 'error'
    error: { type: String, attribute: false },
    _tag: { type: String, attribute: false },
    _src: { type: String, attribute: false },   // v0.5: document IRI for declarative features
  };

  static styles = css`
    :host { display: block; }
    .pending { color: var(--muted, #64748b); font-size: .85rem; padding: 12px; }
    .error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 10px; padding: 12px; font-size: .85rem; }
  `;

  constructor() {
    super();
    this.slug = '';
    this.state = 'pending';
    this.error = '';
    this._tag = '';
    this._src = '';
  }

  willUpdate(changed) {
    if (changed.has('slug') && this.slug) this._load();
  }

  async _load() {
    this.state = 'pending';
    this.error = '';
    try {
      const feature = appStore.getFeature(this.slug);
      if (!feature) throw new Error(`unknown feature in catalogue: ${this.slug}`);
      const prefs = appStore.getPrefs();
      if (!appStore.isEnabled(this.slug)) throw new Error(`feature disabled: ${this.slug}`);
      const tag = getField(feature, 'tag') ?? getField(feature, 'component');
      if (!tag) throw new Error(`no tag/component for: ${this.slug}`);
      if (isDeclarative(feature)) {
        // v0.5 §1.4.3 — declarative stage: verify the document hash on EVERY mount
        // (analogue of the SRI re-check below); mismatch → explicit error, no render.
        if (!isInstalled(feature, prefs)) {
          throw new Error(`declarative feature not installed (document hash not verified): ${this.slug} — go to /store`);
        }
        const documentIri = getField(feature, 'document_iri');
        const res = await fetch(documentIri);
        if (!res.ok) throw new Error(`component document not found: ${documentIri} (${res.status})`);
        const body = await res.json();
        const actual = await documentHash(body.document ?? body); // /components/<slug> enbikepe
        if (actual !== getField(feature, 'sri')) {
          throw new Error(`document hash mismatch for ${this.slug} — rendering refused`);
        }
        this._tag = tag; // 'cmp-runtime'
        this._src = documentIri;
        this.state = 'mounted';
      } else if (isDistant(feature)) {
        if (!isInstalled(feature, prefs)) {
          throw new Error(`remote feature not installed (fingerprint not verified): ${this.slug} — go to /store`);
        }
        // re-checks the sri on every mount (the loader cache may be evicted on revocation)
        await loadRemoteModule({
          cdnUrl: getField(feature, 'cdn_url'),
          sri: getField(feature, 'sri'),
          tag,
        });
        this._tag = tag;
        this.state = 'mounted';
      } else {
        await customElements.whenDefined(tag);
        this._tag = tag;
        this.state = 'mounted';
      }
    } catch (e) {
      this.state = 'error';
      this.error = e instanceof SriMismatchError ? `${e.message} (${this.slug})` : (e.message ?? String(e));
    }
  }

  render() {
    if (this.state === 'error') return html`<div class="error">${this.error}</div>`;
    if (this.state === 'pending') return html`<div class="pending">Loading ${this.slug}…</div>`;
    return html`<div class="host"></div>`;
  }

  updated() {
    // imperative mount of the custom element (Lit does not bind tag names)
    if (this.state === 'mounted' && this._tag) {
      const host = this.renderRoot.querySelector('.host');
      if (host && !host.firstChild) {
        const el = document.createElement(this._tag);
        if (this._src) el.setAttribute('src', this._src); // v0.5: <cmp-runtime src=document_iri> (R3.2)
        host.appendChild(el);
      }
    }
  }
}

customElements.define('dynamic-feature', DynamicFeature);
