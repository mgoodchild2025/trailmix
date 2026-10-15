// Enhancing notes and asking questions, through CG Core (which holds the Claude key).
// Prompts are the desktop app's, from ../../../shared/prompts.js.
import { ENHANCE_SYSTEM, enhanceUserMessage, CHAT_SYSTEM, meetingContext } from '../../../shared/prompts.js';
import { findTemplate } from '../../../shared/templates.js';
import { coreClient, getSession } from './session.js';
import { getMeeting, patchMeeting } from './store.js';
import { meetingChanged } from './sync.js';
import { demoAnswer, demoEnhanced, streamText } from './demo.js';

function setup() {
  const core = coreClient();
  if (!core) throw new Error('Sign in to CG Core first.');
  const info = getSession().info || {};
  if (info.features?.claude === false) throw new Error('AI notes are not set up in CG Core yet. Ask a CG Core admin.');
  return { core, model: info.config?.defaultClaudeModel, myName: info.staff?.name?.split(' ')[0] || 'Me' };
}

export async function enhance(id, templateId, { onDelta, signal } = {}) {
  const m = getMeeting(id);
  const template = findTemplate(templateId || m.templateId || 'general');
  if (getSession().demo) {
    const text = await streamText(demoEnhanced(m), onDelta, signal);
    const fields = { enhanced: text, templateId: template.id };
    if (!m.title.trim()) fields.title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
    patchMeeting(id, fields);
    return fields;
  }
  const { core, model, myName } = setup();
  const { text } = await core.streamClaude({
    purpose: 'enhance',
    model,
    system: ENHANCE_SYSTEM,
    messages: [{ role: 'user', content: enhanceUserMessage(m, template, myName) }],
    effort: 'medium',
    maxTokens: 32000,
    onDelta,
    signal,
  });
  const fields = { enhanced: text.trim(), templateId: template.id };
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (title && !m.title.trim()) fields.title = title;
  patchMeeting(id, fields);
  meetingChanged(id);
  return fields;
}

export async function ask(id, messages, { onDelta, signal } = {}) {
  if (getSession().demo) return streamText(demoAnswer, onDelta, signal);
  const { core, model, myName } = setup();
  const { text } = await core.streamClaude({
    purpose: 'chat',
    model,
    system: [
      { type: 'text', text: CHAT_SYSTEM },
      { type: 'text', text: meetingContext(getMeeting(id), myName), cache_control: { type: 'ephemeral' } },
    ],
    messages,
    effort: 'low',
    maxTokens: 16000,
    onDelta,
    signal,
  });
  return text;
}
