// Android stand-ins for the iOS-only native toolbars: header icon buttons, a bottom
// action bar with the primary action, and a bottom-sheet menu.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type } from '../lib/theme.js';
import { PressableScale, Symbol } from './ui.jsx';

// Icons for the right side of the header: [{ icon, label, onPress, disabled }].
export function HeaderIcons({ items }) {
  const t = useTheme();
  return (
    <View style={s.headerIcons}>
      {items.map((it) => (
        <PressableScale key={it.label} onPress={it.onPress} disabled={it.disabled} accessibilityLabel={it.label} style={s.iconBtn}>
          <Symbol name={it.icon} size={24} color={t.label} />
        </PressableScale>
      ))}
    </View>
  );
}

// Bottom bar: small icon actions on the left, one filled primary button on the right.
export function BottomBar({ actions = [], primary }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { backgroundColor: t.cell, borderTopColor: t.separator, paddingBottom: 10 + insets.bottom }]}>
      {actions.map((it) => (
        <PressableScale key={it.label} onPress={it.onPress} disabled={it.disabled} accessibilityLabel={it.label} style={s.iconBtn}>
          <Symbol name={it.icon} size={24} color={t.label} />
        </PressableScale>
      ))}
      <View style={{ flex: 1 }} />
      {primary ? (
        <PressableScale onPress={primary.onPress} disabled={primary.disabled} accessibilityLabel={primary.title} style={[s.primary, { backgroundColor: t.red }]}>
          <View style={s.primaryInner}>
            {primary.icon ? <Symbol name={primary.icon} size={20} color={t.onRed} /> : null}
            <Text style={[type.headline, { color: t.onRed }]}>{primary.title}</Text>
          </View>
        </PressableScale>
      ) : null}
    </View>
  );
}

// A bottom-sheet menu. useMenu() returns [sheet element to render, open(menu)].
// menu: { title?, items: [{ label, subtitle?, icon?, checked?, disabled?, destructive?, onPress, heading? }] }
export function useMenu() {
  const [menu, setMenu] = useState(null);
  const sheet = <MenuSheet menu={menu} onClose={() => setMenu(null)} />;
  return [sheet, setMenu];
}

function MenuSheet({ menu, onClose }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!menu} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[s.sheet, { backgroundColor: t.cell, paddingBottom: 12 + insets.bottom }]}>
        <View style={[s.grabber, { backgroundColor: t.fill2 }]} />
        {menu?.title ? <Text style={[type.footnote, s.sheetTitle, { color: t.label2 }]}>{menu.title}</Text> : null}
        <ScrollView>
          {menu?.items.map((it, i) =>
            it.heading ? (
              <Text key={`h${i}`} style={[type.footnote, s.heading, { color: t.label2 }]}>
                {it.label}
              </Text>
            ) : (
              <Pressable
                key={`${it.label}${i}`}
                disabled={it.disabled}
                onPress={() => {
                  onClose();
                  it.onPress?.();
                }}
                android_ripple={{ color: t.fill2 }}
                style={[s.item, it.disabled && { opacity: 0.4 }]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!it.disabled, checked: it.checked }}
              >
                {it.icon ? <Symbol name={it.icon} size={22} color={it.destructive ? t.red : t.label2} /> : <View style={{ width: 22 }} />}
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: it.destructive ? t.red : t.label }]}>{it.label}</Text>
                  {it.subtitle ? (
                    <Text style={[type.footnote, { color: t.label2 }]} numberOfLines={2}>
                      {it.subtitle}
                    </Text>
                  ) : null}
                </View>
                {it.checked ? <Symbol name="checkmark" size={20} color={t.red} /> : null}
              </Pressable>
            ),
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingHorizontal: 12, borderTopWidth: StyleSheet.hairlineWidth, elevation: 8 },
  primary: { minHeight: 48, borderRadius: 24, paddingHorizontal: 22, justifyContent: 'center' },
  primaryInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '75%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, marginBottom: 8 },
  sheetTitle: { paddingHorizontal: 24, paddingVertical: 8 },
  heading: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 4, textTransform: 'uppercase' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56, paddingHorizontal: 24, paddingVertical: 10 },
});
