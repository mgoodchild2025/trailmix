// AI notes. Lines from the note-taker (<mark>) are shown bold in the primary text colour,
// the rest in secondary, matching the desktop's highlight.
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../lib/theme.js';

export function NotesMarkdown({ text, hideTitle = false }) {
  const t = useTheme();
  let md = (text || '').replace(/<mark>([\s\S]*?)<\/mark>/g, '**$1**');
  // The meeting screen already shows the title the notes start with.
  if (hideTitle) md = md.replace(/^\s*#\s+.*(\r?\n)+/, '');
  // Task lists: draw boxes instead of the raw "[ ]" / "[x]".
  md = md.replace(/^(\s*[-*+]\s+)\[ \]\s*/gm, '$1☐  ').replace(/^(\s*[-*+]\s+)\[[xX]\]\s*/gm, '$1☑  ');
  return (
    <Markdown
      style={{
        body: { color: t.label2, fontSize: 17, lineHeight: 25, letterSpacing: -0.43 },
        heading1: { color: t.label, fontSize: 22, lineHeight: 28, fontWeight: '700', marginBottom: 6 },
        heading2: { color: t.label, fontSize: 17, lineHeight: 22, fontWeight: '700', marginTop: 22, marginBottom: 4 },
        heading3: { color: t.label, fontSize: 17, fontWeight: '600', marginTop: 14 },
        strong: { color: t.label, fontWeight: '600' },
        paragraph: { marginTop: 4, marginBottom: 4 },
        bullet_list: { marginVertical: 2 },
        list_item: { marginVertical: 3 },
        bullet_list_icon: { color: t.label3, marginLeft: 2, marginRight: 8 },
        link: { color: t.red },
        code_inline: { backgroundColor: t.fill, color: t.label, borderRadius: 4 },
        hr: { backgroundColor: t.separator },
      }}
    >
      {md}
    </Markdown>
  );
}
