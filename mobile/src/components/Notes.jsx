// Enhanced notes. Lines from the note-taker (<mark>) are shown bold and tinted, like
// the desktop's highlight.
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../lib/theme.js';

export function NotesMarkdown({ text }) {
  const t = useTheme();
  const md = (text || '').replace(/<mark>([\s\S]*?)<\/mark>/g, '**$1**');
  return (
    <Markdown
      style={{
        body: { color: t.ink2, fontSize: 16, lineHeight: 24 },
        heading1: { color: t.ink, fontSize: 22, fontWeight: '700', marginBottom: 8 },
        heading2: { color: t.ink, fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 4 },
        heading3: { color: t.ink, fontSize: 16, fontWeight: '700', marginTop: 12 },
        strong: { color: t.ink, fontWeight: '700' },
        bullet_list: { marginVertical: 2 },
        list_item: { marginVertical: 3 },
        link: { color: t.blue },
        code_inline: { backgroundColor: t.sunk, color: t.ink },
      }}
    >
      {md}
    </Markdown>
  );
}
