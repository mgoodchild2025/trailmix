import { useEffect, useState } from 'react';
import { api, isDemo } from '../lib/bridge.js';
import { BUILT_IN_TEMPLATES } from '../../shared/templates.js';
import { errMsg, uid } from '../lib/util.js';
import Icon from './Icon.jsx';

const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (best notes)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)'],
];

export default function Settings({ settings, onChange, toast, update }) {
  const [draft, setDraft] = useState(settings);
  const [keys, setKeys] = useState({ deepgramKey: '', anthropicKey: '' });
  const [perms, setPerms] = useState(null);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    api.system.permissions().then(setPerms);
  }, []);

  const save = async (patch) => {
    try {
      onChange(await api.settings.set(patch));
      toast('Saved', 'ok');
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const field = (k) => ({
    value: draft[k] ?? '',
    onChange: (e) => setDraft({ ...draft, [k]: e.target.value }),
    onBlur: () => draft[k] !== settings[k] && save({ [k]: draft[k] }),
  });

  return (
    <main className="main settings">
      <header className="page-head drag">
        <h1>Settings</h1>
      </header>
      <div className="settings-body">
        <CoreCard core={settings.core} ownKeys={settings.ownKeys} toast={toast} />

        <section className="card">
          <h2>You</h2>
          <label className="field">
            <span>Your name</span>
            <input {...field('myName')} placeholder="Used to label your side of the transcript" />
          </label>
        </section>

        <details className="card" open={!settings.core.connected && (settings.ownKeys.deepgram || settings.ownKeys.anthropic)}>
          <summary>
            <h2>Your own API keys</h2>
            <span className="muted small">{settings.core.connected ? 'Not needed while signed in to CG Core' : 'Advanced: only if you are not using CG Core'}</span>
          </summary>
          <p className="muted small">
            If you add a key here, Trailmix uses it instead of CG Core for that service.{' '}
            Keys are stored on this computer only{settings.encryptionAvailable ? ', encrypted with your system keychain' : ''}.
          </p>
          {[
            ['deepgramKey', 'Deepgram (transcription)', settings.ownKeys.deepgram, 'https://console.deepgram.com'],
            ['anthropicKey', 'Anthropic (AI notes and chat)', settings.ownKeys.anthropic, 'https://platform.claude.com'],
          ].map(([k, label, has, url]) => (
            <div className="field" key={k}>
              <span>
                {label} {has ? <span className="chip ok tiny">Saved</span> : <span className="chip tiny">Not set</span>}
              </span>
              <div className="row gap-s">
                <input type="password" value={keys[k]} onChange={(e) => setKeys({ ...keys, [k]: e.target.value })} placeholder={has ? '•••••••• (enter a new key to replace)' : 'Paste key'} />
                <button
                  className="btn"
                  disabled={!keys[k].trim()}
                  onClick={async () => {
                    await save({ [k]: keys[k].trim() });
                    setKeys({ ...keys, [k]: '' });
                  }}
                >
                  Save
                </button>
                {has && (
                  <button className="btn ghost" onClick={() => save({ [k]: '' })}>
                    Remove
                  </button>
                )}
              </div>
              <a className="small" href={url} target="_blank" rel="noreferrer">
                Get a key ↗
              </a>
            </div>
          ))}
        </details>

        <section className="card">
          <h2>Transcription</h2>
          <div className="grid2">
            <label className="field">
              <span>Language</span>
              <select className="select" {...field('language')} onChange={(e) => save({ language: e.target.value })}>
                <option value="en">English</option>
                <option value="en-GB">English (UK)</option>
                <option value="en-US">English (US)</option>
                <option value="multi">Multilingual (auto)</option>
              </select>
            </label>
            <label className="field">
              <span>Deepgram model</span>
              <input {...field('deepgramModel')} />
            </label>
          </div>
          <label className="field">
            <span>Custom vocabulary</span>
            <textarea rows={3} {...field('keyterms')} placeholder="Client names, products and jargon, separated by commas" />
            <small className="muted">Helps the transcript spell names like client companies, vendors and product names correctly.</small>
          </label>
        </section>

        <section className="card">
          <h2>AI notes</h2>
          <div className="grid2">
            <label className="field">
              <span>Claude model</span>
              <select className="select" value={draft.claudeModel} onChange={(e) => save({ claudeModel: e.target.value })}>
                {modelOptions(settings).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Default template</span>
              <select className="select" value={draft.defaultTemplateId} onChange={(e) => save({ defaultTemplateId: e.target.value })}>
                {[...BUILT_IN_TEMPLATES, ...(settings.customTemplates || [])].map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={!!draft.autoEnhance} onChange={(e) => save({ autoEnhance: e.target.checked })} />
            Enhance notes automatically when I stop recording
          </label>
        </section>

        <Templates custom={settings.customTemplates || []} onSave={(customTemplates) => save({ customTemplates })} />

        {perms && perms.platform === 'darwin' && (
          <section className="card">
            <h2>macOS permissions</h2>
            <p className="muted small">
              Trailmix needs the microphone for your voice, and <b>Screen &amp; System Audio Recording</b> to hear other people on the call. Nothing on your screen is
              recorded, and audio is never saved — only the transcript.
            </p>
            <div className="perm-row">
              <span>Microphone</span>
              <PermChip status={perms.mic} />
              <button className="btn small" onClick={() => api.system.openPrivacy('mic')}>
                Open settings
              </button>
            </div>
            <div className="perm-row">
              <span>Screen &amp; System Audio Recording</span>
              <PermChip status={perms.screen} />
              <button className="btn small" onClick={() => api.system.openPrivacy('screen')}>
                Open settings
              </button>
            </div>
          </section>
        )}

        <section className="card">
          <h2>Updates</h2>
          <div className="perm-row first">
            <span>
              Trailmix {update?.version || ''} <span className="muted small">— {updateText(update)}</span>
            </span>
            {update?.state === 'ready' ? (
              <button className="btn small primary" onClick={() => api.updates.install().catch((e) => toast(errMsg(e)))}>
                Restart to update
              </button>
            ) : (
              <button className="btn small" disabled={!update || ['dev', 'checking', 'downloading'].includes(update.state)} onClick={() => api.updates.check()}>
                Check now
              </button>
            )}
          </div>
        </section>

        <section className="card">
          <h2>Data</h2>
          <p className="muted small">Meetings are stored as JSON files on this computer. Deleted meetings go to a trash folder inside it.</p>
          <button className="btn" onClick={() => api.system.openDataFolder()} disabled={isDemo}>
            <Icon name="folder" /> Open data folder
          </button>
        </section>
      </div>
    </main>
  );
}

function modelOptions(settings) {
  const allowed = settings.core.connected && !settings.ownKeys.anthropic ? settings.core.config?.claudeModels : null;
  if (!allowed?.length) return MODELS;
  return allowed.map((id) => MODELS.find(([v]) => v === id) || [id, id]);
}

function CoreCard({ core, ownKeys, toast }) {
  const [urls, setUrls] = useState(null);
  const [server, setServer] = useState('production');
  const [waiting, setWaiting] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    api.core.urls().then((u) => {
      setUrls(u);
      const match = Object.entries(u).find(([, url]) => url === core.url);
      if (match) setServer(match[0]);
    });
    return api.core.onStatus((st) => {
      setWaiting(!!st.pairing);
      if (st.justConnected || st.error) setCode('');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    try {
      await api.core.connect({ url: urls?.[server] });
      setWaiting(true);
    } catch (e) {
      toast(errMsg(e));
    }
  };

  if (core.connected) {
    const f = core.features || {};
    return (
      <section className="card core-card">
        <h2>CG Core</h2>
        <p>
          Signed in as <b>{core.staff?.name || 'staff member'}</b> {core.staff?.email && <span className="muted">({core.staff.email})</span>}
          {core.device?.name && <span className="muted small"> on {core.device.name}</span>}
        </p>
        <div className="row gap-s wrap">
          <span className={`chip tiny ${f.deepgram === false ? 'warn' : 'ok'}`}>{f.deepgram === false ? 'Transcription not set up in Core' : 'Transcription'}</span>
          <span className={`chip tiny ${f.claude === false ? 'warn' : 'ok'}`}>{f.claude === false ? 'AI not set up in Core' : 'AI notes and chat'}</span>
          {(ownKeys.deepgram || ownKeys.anthropic) && <span className="chip tiny">Your own key overrides Core for {[ownKeys.deepgram && 'transcription', ownKeys.anthropic && 'AI'].filter(Boolean).join(' and ')}</span>}
        </div>
        <p className="muted small">
          Company keys stay in CG Core; nothing secret is stored on this computer except a device sign-in you can revoke in Core. {core.url !== urls?.production && <b>Connected to staging.</b>}
        </p>
        <div className="row gap-s">
          <button className="btn small" onClick={() => api.core.refresh()}>
            Refresh
          </button>
          <button className="btn small ghost" onClick={() => window.confirm('Sign this computer out of CG Core?') && api.core.signout()}>
            Sign out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card core-card">
      <h2>Sign in with CG Core</h2>
      <p className="muted small">
        Use your CG Technologies Microsoft 365 account. Trailmix then uses the company's transcription and AI service through CG Core, so you don't need API keys.
      </p>
      {!waiting ? (
        <div className="row gap-s">
          <button className="btn primary" onClick={start}>
            Sign in with CG Core
          </button>
          <select className="select" value={server} onChange={(e) => setServer(e.target.value)} title="CG Core server">
            <option value="production">core.cgtechnologies.com</option>
            <option value="staging">Staging</option>
          </select>
        </div>
      ) : (
        <div className="pairing">
          <p className="small">
            <b>Finish in your browser.</b> Click <b>Connect</b> in CG Core and Trailmix will sign in automatically.
          </p>
          <form
            className="row gap-s"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.core.pairCode(code);
              } catch (err) {
                toast(errMsg(err));
              }
            }}
          >
            <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Or paste the code CG Core shows" />
            <button className="btn" disabled={!code.trim()}>
              Connect
            </button>
            <button type="button" className="btn ghost" onClick={() => api.core.cancel()}>
              Cancel
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function updateText(u) {
  switch (u?.state) {
    case 'dev':
      return 'updates are off in development builds';
    case 'checking':
      return 'checking for updates…';
    case 'downloading':
      return `downloading ${u.next || 'update'}${u.percent ? ` (${u.percent}%)` : ''}…`;
    case 'ready':
      return `version ${u.next} is ready to install`;
    case 'current':
      return 'you have the latest version';
    case 'error':
      return `couldn't check for updates (${u.message})`;
    default:
      return 'updates are checked automatically';
  }
}

function PermChip({ status }) {
  const ok = status === 'granted';
  return <span className={`chip tiny ${ok ? 'ok' : 'warn'}`}>{ok ? 'Allowed' : status.replace('-', ' ')}</span>;
}

function Templates({ custom, onSave }) {
  const [editing, setEditing] = useState(null);

  const startFrom = (t) => setEditing({ id: `custom-${uid().slice(0, 8)}`, name: `${t.name} (copy)`, description: t.description || '', sections: t.sections, isNew: true });

  return (
    <section className="card">
      <h2>Templates</h2>
      <p className="muted small">Templates set the headings Claude uses for enhanced notes. Copy a built-in template to make your own.</p>
      <ul className="tpl-list">
        {BUILT_IN_TEMPLATES.map((t) => (
          <li key={t.id}>
            <div>
              <b>{t.name}</b> <span className="muted small">{t.description}</span>
            </div>
            <button className="link small" onClick={() => startFrom(t)}>
              Copy
            </button>
          </li>
        ))}
        {custom.map((t) => (
          <li key={t.id}>
            <div>
              <b>{t.name}</b> <span className="chip tiny">Custom</span> <span className="muted small">{t.description}</span>
            </div>
            <span className="row gap-s">
              <button className="link small" onClick={() => setEditing({ ...t })}>
                Edit
              </button>
              <button className="link small danger" onClick={() => window.confirm(`Delete template "${t.name}"?`) && onSave(custom.filter((c) => c.id !== t.id))}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={() => startFrom({ name: 'New template', description: '', sections: '## Summary\n\n## Action items' })}>
        <Icon name="plus" /> New template
      </button>

      {editing && (
        <div className="tpl-editor">
          <label className="field">
            <span>Name</span>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Description</span>
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </label>
          <label className="field">
            <span>Sections (Markdown headings, each with an optional line describing what goes in it)</span>
            <textarea className="mono" rows={12} value={editing.sections} onChange={(e) => setEditing({ ...editing, sections: e.target.value })} />
          </label>
          <div className="row gap-s">
            <button
              className="btn primary"
              onClick={() => {
                const { isNew, ...t } = editing;
                onSave(isNew ? [...custom, t] : custom.map((c) => (c.id === t.id ? t : c)));
                setEditing(null);
              }}
            >
              Save template
            </button>
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
