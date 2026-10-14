import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(md = '') {
  return DOMPurify.sanitize(marked.parse(md));
}

// For copying/exporting: drop the <mark> provenance tags.
export function stripMarks(md = '') {
  return md.replace(/<\/?mark>/g, '');
}
