// Local, file-based storage. One JSON file per meeting plus settings.json, all under
// the app's userData folder. API keys are encrypted with the OS keychain via safeStorage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SECRET_KEYS = ['deepgramKey', 'anthropicKey', 'coreToken'];
export const CORE_DEFAULT_URL = 'https://core.cgtechnologies.com';

export const DEFAULT_SETTINGS = {
  myName: '',
  claudeModel: 'claude-opus-5-5',
  deepgramModel: 'nova-3',
  language: 'en',
  keyterms: 'CG Technologies',
  defaultTemplateId: 'general',
  autoEnhance: true,
  customTemplates: [],
  coreUrl: CORE_DEFAULT_URL,
  coreInfo: null, // last /me response from CG Core: staff, device, features, config
};

export class Store {
  constructor(root, safeStorage) {
    this.root = root;
    this.safe = safeStorage;
    this.dir = path.join(root, 'meetings');
    this.trash = path.join(root, 'trash');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.trash, { recursive: true });
    this.cache = new Map();
    this.timers = new Map();
  }

  // ---------- settings ----------
  get settingsPath() {
    return path.join(this.root, 'settings.json');
  }

  readSettingsRaw() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
    } catch {
      return {};
    }
  }

  // Secrets are decrypted only for main-process use; the renderer gets `has*` flags.
  secrets() {
    const raw = this.readSettingsRaw();
    const out = {};
    for (const k of SECRET_KEYS) {
      const v = raw[k];
      if (v?.enc && this.safe.isEncryptionAvailable()) {
        try {
          out[k] = this.safe.decryptString(Buffer.from(v.enc, 'base64'));
        } catch {
          out[k] = '';
        }
      } else if (v?.plain) out[k] = v.plain;
    }
    out.deepgramKey ||= process.env.DEEPGRAM_API_KEY || '';
    out.anthropicKey ||= process.env.ANTHROPIC_API_KEY || '';
    return out;
  }

  settings() {
    const raw = this.readSettingsRaw();
    const pub = { ...DEFAULT_SETTINGS };
    for (const [k, v] of Object.entries(raw)) if (!SECRET_KEYS.includes(k)) pub[k] = v;
    const s = this.secrets();
    const info = pub.coreInfo;
    delete pub.coreInfo;
    pub.core = s.coreToken
      ? { connected: true, url: pub.coreUrl, staff: info?.staff, device: info?.device, features: info?.features || {}, config: info?.config || {} }
      : { connected: false, url: pub.coreUrl };
    pub.ownKeys = { deepgram: !!s.deepgramKey, anthropic: !!s.anthropicKey };
    // "Available" means usable right now, through CG Core or the user's own key.
    pub.hasDeepgramKey = pub.ownKeys.deepgram || (pub.core.connected && pub.core.features.deepgram !== false);
    pub.hasAnthropicKey = pub.ownKeys.anthropic || (pub.core.connected && pub.core.features.claude !== false);
    pub.encryptionAvailable = this.safe.isEncryptionAvailable();
    return pub;
  }

  saveSettings(patch) {
    const raw = this.readSettingsRaw();
    for (const [k, v] of Object.entries(patch)) {
      if (k.startsWith('has') || ['encryptionAvailable', 'core', 'ownKeys', 'coreToken', 'coreInfo', 'coreUrl'].includes(k)) continue;
      if (SECRET_KEYS.includes(k)) {
        if (!v) delete raw[k];
        else if (this.safe.isEncryptionAvailable())
          raw[k] = { enc: this.safe.encryptString(v.trim()).toString('base64') };
        else raw[k] = { plain: v.trim() };
      } else raw[k] = v;
    }
    writeAtomic(this.settingsPath, JSON.stringify(raw, null, 2));
    return this.settings();
  }

  // CG Core connection: written only by the main process, never from the renderer.
  setCore({ token, info, url }) {
    const raw = this.readSettingsRaw();
    if (token !== undefined) {
      if (!token) delete raw.coreToken;
      else if (this.safe.isEncryptionAvailable()) raw.coreToken = { enc: this.safe.encryptString(token).toString('base64') };
      else raw.coreToken = { plain: token };
    }
    if (info !== undefined) raw.coreInfo = info;
    if (url !== undefined) raw.coreUrl = url;
    writeAtomic(this.settingsPath, JSON.stringify(raw, null, 2));
  }

  // ---------- meetings ----------
  file(id) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Bad meeting id');
    return path.join(this.dir, `${id}.json`);
  }

  create(fields = {}) {
    const now = Date.now();
    const m = {
      id: `${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      title: '',
      createdAt: now,
      updatedAt: now,
      notes: '',
      transcript: [],
      enhanced: '',
      templateId: null,
      chat: [],
      ...fields,
    };
    this.cache.set(m.id, m);
    this.flush(m.id);
    return m;
  }

  get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const m = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
    this.cache.set(id, m);
    return m;
  }

  all() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return this.get(f.slice(0, -5));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  list() {
    return this.all()
      .map((m) => ({
        id: m.id,
        title: m.title,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        hasEnhanced: !!m.enhanced,
        shared: !!m.share,
        segments: m.transcript.length,
        preview: (m.enhanced || m.notes || m.transcript.map((s) => s.text).join(' '))
          .replace(/<\/?mark>/g, '')
          .replace(/[#*>\-\[\]]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140),
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return this.all()
      .filter((m) =>
        [m.title, m.notes, m.enhanced, ...m.transcript.map((s) => s.text)]
          .join('\n')
          .toLowerCase()
          .includes(q),
      )
      .map((m) => m.id);
  }

  patch(id, fields) {
    const m = this.get(id);
    const allowed = ['title', 'notes', 'enhanced', 'templateId', 'chat', 'share'];
    for (const k of allowed) if (k in fields) m[k] = fields[k];
    m.updatedAt = Date.now();
    this.scheduleFlush(id);
    return m;
  }

  appendSegment(id, seg) {
    const m = this.get(id);
    m.transcript.push(seg);
    m.updatedAt = Date.now();
    this.scheduleFlush(id);
  }

  // Deleting moves the file to a trash folder rather than destroying it.
  remove(id) {
    this.flush(id);
    this.cache.delete(id);
    const src = this.file(id);
    if (fs.existsSync(src)) fs.renameSync(src, path.join(this.trash, `${id}.json`));
  }

  scheduleFlush(id) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.flush(id), 400));
  }

  flush(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const m = this.cache.get(id);
    if (m) writeAtomic(this.file(id), JSON.stringify(m, null, 1));
  }

  flushAll() {
    for (const id of [...this.timers.keys()]) this.flush(id);
  }
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
