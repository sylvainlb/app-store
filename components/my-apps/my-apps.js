// <my-apps> — "Mes apps" hub (route /my-apps, account-menu entry "Mes apps").
//
// The entry point of the component editors is NOT an editor: it is the LIST of the
// user's own components published in the /components/ container of the fap-ldp server
// (declarative stage of the app store, chantier 3 J12) — UI components (chantier 3)
// and AI components (chantier 4/5) together, each with a type badge.
//
// - "New" → choice UI component (/editor) or AI component (/ai-editor); the editors
//   remain reachable as deep links.
// - "Edit" per row → deep link /editor?component=<iri> or /ai-editor?component=<iri>:
//   the editor reopens the published document as a DERIVED DRAFT (F7.3 / C8), the
//   published version is never overwritten in place.
//
// No own persistence: everything is read from /components/ via the authenticated
// fetch of the host (window.sibStore.fetchAuthn), like <app-store>.
import { html, css } from 'lit';
import { OrbitComponent, getJson, resolveMembers } from '../boilerplate/index.js';
import { unwrapComponentResource, componentKind, componentLabel, componentEditLink } from '../shared/logic.js';

const STR = {
  en: {
    title: 'My apps', new: 'New component', newUi: 'UI component', newAi: 'AI component',
    colName: 'Component', colType: 'Type', colSource: 'Source', colVersion: 'Version', colActions: '',
    typeUi: 'UI', typeAi: 'AI', edit: 'Edit', empty: 'No component yet — create your first one.',
    loadError: 'Cannot read /components/ (published components container).',
  },
  fr: {
    title: 'Mes apps', new: 'Nouveau composant', newUi: 'Composant UI', newAi: 'Composant IA',
    colName: 'Composant', colType: 'Type', colSource: 'Source', colVersion: 'Version', colActions: '',
    typeUi: 'UI', typeAi: 'IA', edit: 'Modifier', empty: 'Aucun composant — créez le premier.',
    loadError: 'Lecture de /components/ impossible (conteneur des composants publiés).',
  },
};

export class MyApps extends OrbitComponent {
  static properties = {
    ...OrbitComponent.properties,
    locale: { type: String },
    entries: { type: Array, attribute: false }, // unwrapped published components
  };

  static styles = css`
    ${OrbitComponent.styles}
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
    .head h1 { margin: 0; font-size: 1.25rem; }
    .head .new { display: flex; gap: 8px; align-items: center; }
    .head select { width: auto; }
    table { width: 100%; }
    td.src { font-family: ui-monospace, monospace; font-size: .78rem; color: var(--muted); word-break: break-all; }
    .badge.ui { background: #e0e7ff; color: #3730a3; }
    .badge.ai { background: #fce7f3; color: #9d174d; }
    td.actions { white-space: nowrap; text-align: right; }
  `;

  constructor() {
    super();
    this.locale = (typeof navigator !== 'undefined' && navigator.language?.slice(0, 2)) || 'en';
    this.entries = [];
  }

  t(key) { return (STR[this.locale] ?? STR.en)[key] ?? STR.en[key] ?? key; }

  async load() {
    const idx = await getJson('/components/');
    const members = await resolveMembers(idx);
    this.entries = members
      .map((m) => unwrapComponentResource(m))
      .filter((e) => e && componentKind(e.doc))
      .sort((a, b) => componentLabel(a.doc, this.locale).localeCompare(componentLabel(b.doc, this.locale)));
    this.objects = this.entries; // feeds isEmpty()
    return idx;
  }

  isEmpty() { return this.entries.length === 0; }

  _new(target) {
    if (target === 'ai') this.navigate('ai-editor', '/ai-editor');
    else this.navigate('ui-editor', '/editor');
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
          <select id="new-kind" @change=${(e) => this._new(e.target.value)}>
            <option value="" selected disabled>${this.t('new')}…</option>
            <option value="ui">${this.t('newUi')}</option>
            <option value="ai">${this.t('newAi')}</option>
          </select>
        </div>
      </div>
      ${this.entries.length === 0 ? html`<div class="empty">${this.t('empty')}</div>` : html`
      <table>
        <thead><tr>
          <th>${this.t('colName')}</th><th>${this.t('colType')}</th>
          <th>${this.t('colSource')}</th><th>${this.t('colVersion')}</th><th></th>
        </tr></thead>
        <tbody>
          ${this.entries.map((e) => {
            const kind = componentKind(e.doc);
            const src = e.doc['cmp:source'] ?? e.doc['cmp:contract'] ?? '';
            const ver = e.doc['cmp:promptVersion'] ?? '';
            return html`<tr>
              <td>${componentLabel(e.doc, this.locale)}</td>
              <td><span class="badge ${kind}">${kind === 'ai' ? this.t('typeAi') : this.t('typeUi')}</span></td>
              <td class="src">${src}</td>
              <td>${ver}</td>
              <td class="actions"><button class="secondary" @click=${() => this._edit(e)}>${this.t('edit')}</button></td>
            </tr>`;
          })}
        </tbody>
      </table>`}`;
  }
}

customElements.define('my-apps', MyApps);
