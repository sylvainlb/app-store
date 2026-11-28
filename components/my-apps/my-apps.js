// <my-apps> — "My apps" hub (route /my-apps, account-menu entry "My apps").
//
// The entry point of the component editors is NOT an editor: it is the LIST of the
// user's own components published in the /components/ container of the fap-ldp server
// (declarative stage of the app store, workstream 3 J12) — UI components (workstream 3)
// and AI components (workstream 4/5) together, each with a type badge.
//
// - "New" → choice UI component (/editor) or AI component (/ai-editor); the editors
//   remain reachable as deep links.
// - "Edit" per row → deep link /editor?component=<iri> or /ai-editor?component=<iri>:
//   the editor reopens the published document as a DERIVED DRAFT (F7.3 / C8), the
//   published version is never overwritten in place.
//
// v0.7 §1.4.4 — THREE storage levels (workstream 3 rev 9, F1.1/F1.2): the hub reads the
// participant's LOCAL container first (/users/<pk>/components/, badge `local`), then the
// app store /components/ (badge `published`), and aggregates both. Per row: "Publish" =
// transfer local → store (sha384 re-verified, PUT /components/<slug> + POST /features/),
// "Unpublish" = remove the store copy (the local copy is kept).
import { html, css } from 'lit';
import { OrbitComponent, getJson, resolveMembers } from '../boilerplate/index.js';
import {
  unwrapComponentResource, componentKind, componentLabel, componentEditLink,
  localComponentsPath, mergeLevels, verifyIntegrity, catalogueLineFor,
} from '../shared/logic.js';

const STR = {
  en: {
    title: 'My apps', new: '+ New component',
    colName: 'Component', colType: 'Type', colSource: 'Source', colVersion: 'Version', colActions: '',
    typeUi: 'UI', typeAi: 'AI', edit: 'Edit', empty: 'No component yet.',
    hint: 'Add an "AI block" inside a component to create and use an AI component.',
    loadError: 'Cannot read /components/ (published components container).',
    colLevel: 'Level', badgeLocal: 'local', badgePublished: 'published',
    publish: 'Publish', unpublish: 'Unpublish', busy: '…', delete: 'Delete',
    confirmDelete: 'Delete this component permanently (all copies)?',
    integrityError: 'Integrity check failed (sha384 mismatch) — not published.',
    actionError: 'Action failed',
  },
  fr: { title: 'Mes apps', new: '+ Nouveau composant', colName: 'Composant', colType: 'Type', colSource: 'Source', colVersion: 'Version', colActions: '', typeUi: 'UI', typeAi: 'IA', edit: 'Modifier', empty: 'Aucun composant pour l\'instant.', hint: 'Ajoutez un « bloc IA » dans un composant pour créer et utiliser un composant IA.', loadError: 'Lecture de /components/ impossible (conteneur des composants publiés).', colLevel: 'Niveau', badgeLocal: 'local', badgePublished: 'publié', publish: 'Publier', unpublish: 'Dépublier', busy: '…', delete: 'Supprimer', confirmDelete: 'Supprimer définitivement ce composant (toutes les copies) ?', integrityError: 'Vérification d\'intégrité échouée (sha384) — non publié.', actionError: 'Action échouée' },
};

export class MyApps extends OrbitComponent {
  static properties = {
    ...OrbitComponent.properties,
    locale: { type: String },
    entries: { type: Array, attribute: false }, // merged rows (local + published, v0.7)
    _busy: { state: true },
    _actionError: { state: true },
  };

  static styles = css`
    ${OrbitComponent.styles}
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .head h1 { margin: 0; font-size: 1.25rem; }
    .head .new { display: flex; gap: 8px; align-items: center; }
    .hint { margin: -8px 0 14px; font-size: .82rem; color: var(--muted); }
    table { width: 100%; }
    td.src { font-family: ui-monospace, monospace; font-size: .78rem; color: var(--muted); word-break: break-all; }
    .badge.ui { background: #e0e7ff; color: #3730a3; }
    .badge.ai { background: #fce7f3; color: #9d174d; }
    .badge.local { background: #fef3c7; color: #92400e; }
    .badge.published { background: #dcfce7; color: #166534; }
    .action-error { color: #b91c1c; font-size: .78rem; margin-bottom: 8px; }
    td.actions { white-space: nowrap; text-align: right; }
    td.actions button.danger { color: #b91c1c; border-color: #fecaca; }
    td.actions button.danger:hover { background: #fef2f2; }
  `;

  constructor() {
    super();
    this.locale = (typeof navigator !== 'undefined' && navigator.language?.slice(0, 2)) || 'en';
    this.entries = [];
    this._busy = null;
    this._actionError = null;
  }

  _fetch() { return window.sibStore?.fetchAuthn ?? fetch; }

  _localPath() {
    try { return localComponentsPath(window.appStore?.mePrefsIri?.() ?? window.appSession?.info?.webId ?? '', window.appStore?.podUrl); }
    catch { return null; }
  }

  t(key) { return (STR[this.locale] ?? STR.en)[key] ?? STR.en[key] ?? key; }

  async load() {
    // v0.7: local container FIRST (participant's pod), then the app store /components/.
    const localPath = this._localPath();
    let local = [];
    if (localPath) {
      try {
        const idx = await getJson(localPath);
        local = (await resolveMembers(idx))
          .map((m) => ({ ...unwrapComponentResource(m), level: 'local' }))
          .filter((e) => e && componentKind(e.doc));
      } catch { /* no local container (older deployment) → published only */ }
    }
    const idx = await getJson('/components/');
    const published = (await resolveMembers(idx))
      .map((m) => ({ ...unwrapComponentResource(m), level: 'published' }))
      .filter((e) => e && componentKind(e.doc));
    this.entries = mergeLevels(local, published)
      .sort((a, b) => componentLabel(a.doc, this.locale).localeCompare(componentLabel(b.doc, this.locale)));
    this.objects = this.entries; // feeds isEmpty()
    return idx;
  }

  // F1.2 — "Publish": transfer local → app store. sha384 re-verified (F6), then
  // PUT /components/<slug> (enbikepe) + POST /features/ (catalogue line, admin v1).
  async _publish(entry) {
    this._actionError = null;
    this._busy = entry.slug;
    try {
      if (!(await verifyIntegrity(entry))) throw new Error(this.t('integrityError'));
      const slug = entry.slug;
      const storeIri = `/components/${slug}`;
      const body = { slug, sri: entry.sri, document: { ...entry.doc, '@id': storeIri } };
      const headers = { 'content-type': 'application/ld+json' };
      // LDP: PUT updates an existing resource; creation = POST to the container (404 → POST)
      let res = await this._fetch()(storeIri, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (res.status === 404) {
        res = await this._fetch()('/components/', { method: 'POST', headers, body: JSON.stringify(body) });
      }
      if (!res.ok) throw new Error(`publish ${storeIri} → ${res.status}`);
      const line = catalogueLineFor({ ...entry, iri: storeIri });
      res = await this._fetch()('/features/', {
        method: 'POST', headers: { 'content-type': 'application/ld+json' }, body: JSON.stringify(line),
      });
      if (!res.ok) throw new Error(`POST /features/ → ${res.status}`);
      await this.load();
      this.requestUpdate();
    } catch (e) {
      const msg = String(e?.message ?? e);
      this._actionError = msg.startsWith('Integrity') || msg.includes(this.t('integrityError')) ? this.t('integrityError') : `${this.t('actionError')}: ${e?.message ?? e}`;
    } finally {
      this._busy = null;
    }
  }

  // "Unpublish": remove the store copy (catalogue line + /components/ resource);
  // the local-saved copy on the participant's pod is KEPT (F1.2).
  async _unpublish(entry) {
    this._actionError = null;
    this._busy = entry.slug;
    try {
      const slug = entry.slug;
      let res = await this._fetch()(`/components/${slug}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`DELETE /components/${slug} → ${res.status}`);
      res = await this._fetch()(`/features/${slug}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`DELETE /features/${slug} → ${res.status}`);
      await this.load();
      this.requestUpdate();
    } catch (e) {
      this._actionError = `${this.t('actionError')}: ${e?.message ?? e}`;
    } finally {
      this._busy = null;
    }
  }

  // "Delete": remove EVERY copy of the component — the local one on the
  // participant's pod (/users/<pk>/components/<slug>) and the published one
  // (/components/<slug> + its /features/ catalogue line). Unlike "Unpublish",
  // nothing is kept.
  async _delete(entry) {
    if (typeof window.confirm === 'function' && !window.confirm(this.t('confirmDelete'))) return;
    this._actionError = null;
    this._busy = entry.slug;
    try {
      const slug = entry.slug;
      const levels = entry.levels ?? [entry.level ?? 'published'];
      if (levels.includes('local')) {
        const localPath = this._localPath();
        if (localPath) {
          const res = await this._fetch()(`${localPath}${slug}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 404) throw new Error(`DELETE ${localPath}${slug} → ${res.status}`);
        }
      }
      if (levels.includes('published')) {
        let res = await this._fetch()(`/components/${slug}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`DELETE /components/${slug} → ${res.status}`);
        res = await this._fetch()(`/features/${slug}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`DELETE /features/${slug} → ${res.status}`);
      }
      await this.load();
      this.requestUpdate();
    } catch (e) {
      this._actionError = `${this.t('actionError')}: ${e?.message ?? e}`;
    } finally {
      this._busy = null;
    }
  }

  // Always render the hub chrome (header + "New component" gesture) — even with zero
  // components, the empty list is rendered INSIDE renderContent (localized message),
  // not by the OrbitComponent default "no items" which would hide the add button.
  isEmpty() { return false; }

  // Single creation entry point: a new component is a UI component (/editor).
  // AI components are created from the "AI block" panel inside the UI editor
  // (deep link /ai-editor), published in /components/, then referenced by AI blocks.
  _new() {
    this.navigate('ui-editor', '/editor');
  }

  _edit(entry) {
    const link = componentEditLink(entry);
    if (link) this.navigate(link.route, link.resource);
  }

  renderContent() {
    return html`
      <div class="head">
        <h1>${this.t('title')}</h1>
        <div class="new">
          <button data-kind="ui" @click=${() => this._new()}>${this.t('new')}</button>
        </div>
      </div>
      <p class="hint">${this.t('hint')}</p>
      ${this._actionError ? html`<div class="action-error">⚠ ${this._actionError}</div>` : null}
      ${this.entries.length === 0 ? html`<div class="empty">${this.t('empty')}</div>` : html`
      <table>
        <thead><tr>
          <th>${this.t('colName')}</th><th>${this.t('colType')}</th><th>${this.t('colLevel')}</th>
          <th>${this.t('colSource')}</th><th>${this.t('colVersion')}</th><th></th>
        </tr></thead>
        <tbody>
          ${this.entries.map((e) => {
            const kind = componentKind(e.doc);
            const src = e.doc['cmp:source'] ?? e.doc['cmp:contract'] ?? '';
            const ver = e.doc['cmp:promptVersion'] ?? '';
            const levels = e.levels ?? [e.level ?? 'published'];
            return html`<tr>
              <td>${componentLabel(e.doc, this.locale)}</td>
              <td><span class="badge ${kind}">${kind === 'ai' ? this.t('typeAi') : this.t('typeUi')}</span></td>
              <td>${levels.map((lv) => html`<span class="badge ${lv}">${lv === 'local' ? this.t('badgeLocal') : this.t('badgePublished')}</span>`)}</td>
              <td class="src">${src}</td>
              <td>${ver}</td>
              <td class="actions">
                <button class="secondary" @click=${() => this._edit(e)}>${this.t('edit')}</button>
                ${levels.includes('local') ? html`<button class="secondary" ?disabled=${this._busy === e.slug} @click=${() => this._publish(e)}>${this._busy === e.slug ? this.t('busy') : this.t('publish')}</button>` : null}
                ${levels.includes('published') ? html`<button class="secondary" ?disabled=${this._busy === e.slug} @click=${() => this._unpublish(e)}>${this._busy === e.slug ? this.t('busy') : this.t('unpublish')}</button>` : null}
                <button class="danger" ?disabled=${this._busy === e.slug} @click=${() => this._delete(e)}>${this._busy === e.slug ? this.t('busy') : this.t('delete')}</button>
              </td>
            </tr>`;
          })}
        </tbody>
      </table>`}`;
  }
}

customElements.define('my-apps', MyApps);
