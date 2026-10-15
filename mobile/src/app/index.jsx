import { useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  SectionList,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack } from "expo-router";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getSession,
  signIn,
  startDemo,
  subscribeSession,
} from "../lib/session.js";
import {
  createMeeting,
  listMeetings,
  removeMeeting,
  subscribeMeetings,
} from "../lib/store.js";
import { meetingChanged, meetingDeleted, subscribeSync } from "../lib/sync.js";
import { useRecording } from "../lib/recording.jsx";
import { formatTime, durationOf } from "../../../shared/transcript.js";
import { useTheme, type } from "../lib/theme.js";
import { Button, Glass, PressableScale, Symbol } from "../components/ui.jsx";

function useSession() {
  const [s, set] = useState(getSession());
  useEffect(() => subscribeSession(set), []);
  return s;
}

export default function Home() {
  const session = useSession();
  return session.token || session.demo ? (
    <MeetingList demo={session.demo} />
  ) : (
    <SignIn />
  );
}

// ---------- sign in ----------

function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const go = async (server) => {
    setBusy(true);
    try {
      await signIn(server);
    } catch (err) {
      Alert.alert("Couldn't sign in", err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={[
        s.signin,
        { backgroundColor: t.bg, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <Stack.Screen options={{ title: "", headerLargeTitleEnabled: false }} />
      <View style={s.signinHero}>
        <View style={[s.appIcon, { backgroundColor: t.red }]}>
          <View style={s.appIconDot} />
        </View>
        <Text style={[type.largeTitle, { color: t.label, marginTop: 20 }]}>
          Trailmix
        </Text>
        <Text style={[type.body, s.center, { color: t.label2, marginTop: 8 }]}>
          Record the meeting, jot a few notes, get clean notes back.
        </Text>
      </View>
      <View style={s.features}>
        {[
          [
            "waveform",
            "Transcribes as you talk",
            "Recording keeps going with the screen locked.",
          ],
          [
            "sparkles",
            "Writes your notes",
            "Your rough notes plus the transcript, in your template.",
          ],
          [
            "laptopcomputer.and.iphone",
            "Syncs with your computer",
            "The same meetings in Trailmix on your Mac or PC.",
          ],
        ].map(([icon, title, body]) => (
          <View key={title} style={s.feature}>
            <Symbol name={icon} size={26} color={t.red} />
            <View style={{ flex: 1 }}>
              <Text style={[type.headline, { color: t.label }]}>{title}</Text>
              <Text style={[type.subhead, { color: t.label2 }]}>{body}</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={s.signinActions}>
        <Button
          title={busy ? "Opening CG Core…" : "Sign in with CG Core"}
          kind="primary"
          onPress={() => go("production")}
          disabled={busy}
        />
        <Text style={[type.footnote, s.center, { color: t.label2 }]}>
          Uses your CG Technologies Microsoft 365 account.
        </Text>
        <View style={s.signinLinks}>
          <Pressable
            onPress={startDemo}
            hitSlop={12}
            style={s.linkBtn}
            accessibilityRole="button"
          >
            <Text style={[type.subhead, { color: t.red, fontWeight: "600" }]}>
              Try the demo
            </Text>
          </Pressable>
          <Text style={{ color: t.label3 }}>·</Text>
          <Pressable
            onPress={() => go("staging")}
            disabled={busy}
            hitSlop={12}
            style={s.linkBtn}
            accessibilityRole="button"
          >
            <Text style={[type.subhead, { color: t.label2 }]}>Use staging</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------- meeting list ----------

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

const preview = (m) =>
  (m.enhanced || m.notes || m.transcript?.map((x) => x.text).join(" ") || "")
    .replace(/<\/?mark>|^#.*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/[#*>\-\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const shareMeeting = (m) => {
  const body = (m.enhanced || m.notes || "").replace(/<\/?mark>/g, "").trim();
  if (!body)
    return Alert.alert(
      "Nothing to share yet",
      "Add notes or enhance the meeting first.",
    );
  Share.share({ title: m.title || "Meeting notes", message: body });
};

const confirmDelete = (m, after) =>
  Alert.alert(
    `Delete "${m.title || "Untitled meeting"}"?`,
    "It will be removed from this phone and your other devices.",
    [
      { text: "Cancel", style: "cancel", onPress: after },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          removeMeeting(m.id);
          meetingDeleted(m.id);
        },
      },
    ],
  );

// Touch and hold a row: Share or Delete, as a native action sheet on iOS.
function rowActions(m) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const title = m.title || "Untitled meeting";
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: ["Share notes", "Delete meeting", "Cancel"],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (i) => (i === 0 ? shareMeeting(m) : i === 1 ? confirmDelete(m) : null),
    );
  } else {
    Alert.alert(title, undefined, [
      { text: "Share notes", onPress: () => shareMeeting(m) },
      {
        text: "Delete meeting",
        style: "destructive",
        onPress: () => confirmDelete(m),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }
}

function MeetingRow({ m, first, last, live }) {
  const t = useTheme();
  const [pressed, setPressed] = useState(false);
  const duration = durationOf(m.transcript || []);
  const meta = [
    new Date(m.createdAt).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    duration > 0 ? formatTime(duration) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const text = preview(m);
  const radius = {
    borderTopLeftRadius: first ? 12 : 0,
    borderTopRightRadius: first ? 12 : 0,
    borderBottomLeftRadius: last ? 12 : 0,
    borderBottomRightRadius: last ? 12 : 0,
  };
  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={60}
      overshootRight={false}
      containerStyle={[s.swipe, radius]}
      renderRightActions={(_p, _d, methods) => (
        <Pressable
          onPress={() => confirmDelete(m, () => methods.close())}
          style={[s.swipeDelete, { backgroundColor: t.red }]}
          accessibilityLabel="Delete meeting"
        >
          <Symbol name="trash.fill" size={20} color="#fff" />
        </Pressable>
      )}
    >
      <Pressable
        onPress={() => router.push(`/meeting/${m.id}`)}
        onLongPress={() => rowActions(m)}
        delayLongPress={350}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="link"
        accessibilityLabel={m.title || "Untitled meeting"}
        accessibilityHint="Touch and hold for Share and Delete"
      >
        <View
          style={[
            s.row,
            { backgroundColor: pressed ? t.fill2 : t.cell },
            radius,
          ]}
        >
          <View style={{ flex: 1 }}>
            <View style={s.rowTitleLine}>
              {live ? (
                <View style={[s.liveDot, { backgroundColor: t.red }]} />
              ) : null}
              <Text
                numberOfLines={1}
                style={[type.headline, { color: t.label, flex: 1 }]}
              >
                {m.title || "Untitled meeting"}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={[type.subhead, { color: t.label2, marginTop: 2 }]}
            >
              <Text style={{ color: live ? t.red : t.label2 }}>
                {live ? "Recording" : meta}
              </Text>
              {text ? `  ${text}` : ""}
            </Text>
          </View>
          <View style={s.rowIcons}>
            {m.enhanced ? (
              <Symbol name="sparkles" size={15} color={t.label3} />
            ) : null}
            {m.source === "desktop" ? (
              <Symbol name="laptopcomputer" size={15} color={t.label3} />
            ) : null}
          </View>
        </View>
      </Pressable>
      {!last ? (
        <View style={[s.separator, { backgroundColor: t.separator }]} />
      ) : null}
    </ReanimatedSwipeable>
  );
}

function MeetingList({ demo }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { rec, start, elapsed } = useRecording();
  const [meetings, setMeetings] = useState(listMeetings());
  const [query, setQuery] = useState("");
  const [sync, setSync] = useState(null);
  useEffect(() => subscribeMeetings(() => setMeetings(listMeetings())), []);
  useEffect(() => subscribeSync(setSync), []);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? meetings.filter((m) =>
          [m.title, m.notes, m.enhanced].join(" ").toLowerCase().includes(q),
        )
      : meetings;
    const out = [];
    for (const m of list) {
      const g = dayLabel(m.createdAt);
      if (out.at(-1)?.title !== g) out.push({ title: g, data: [] });
      out.at(-1).data.push(m);
    }
    return out;
  }, [meetings, query]);

  const newMeeting = async (record) => {
    const m = createMeeting();
    meetingChanged(m.id);
    router.push(`/meeting/${m.id}`);
    if (record) {
      try {
        await start(m.id);
      } catch (err) {
        Alert.alert("Couldn't start recording", err.message);
      }
    }
  };
  const live = rec.status !== "idle";

  return (
    <>
      <Stack.Screen
        options={{
          title: "Meetings",
          headerLargeTitleEnabled: true,
          headerSearchBarOptions: {
            placeholder: "Search notes",
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            hideWhenScrolling: true,
          },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="gearshape"
          onPress={() => router.push("/settings")}
          accessibilityLabel="Settings"
        />
      </Stack.Toolbar>
      <Stack.Toolbar>
        <Stack.Toolbar.Button
          icon="square.and.pencil"
          onPress={() => newMeeting(false)}
          disabled={live}
          accessibilityLabel="New note"
        />
        <Stack.Toolbar.Spacer />
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={t.red}
          onPress={() =>
            live ? router.push(`/meeting/${rec.meetingId}`) : newMeeting(true)
          }
          accessibilityLabel={live ? "Return to recording" : "Record a meeting"}
        >
          {live ? "Back to recording" : "Record"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <SectionList
        sections={sections}
        keyExtractor={(m) => m.id}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: t.grouped }}
        contentContainerStyle={{
          paddingBottom: 120 + insets.bottom,
          paddingHorizontal: 16,
          flexGrow: 1,
        }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          demo || sync?.error ? (
            <View style={[s.notice, { backgroundColor: t.cell }]}>
              <Symbol
                name={demo ? "theatermasks" : "exclamationmark.icloud"}
                size={18}
                color={demo ? t.label2 : t.orange}
              />
              <Text style={[type.footnote, { color: t.label2, flex: 1 }]}>
                {demo
                  ? "Demo: sample meetings, nothing is saved or sent. Settings › Exit demo."
                  : `Sync problem: ${sync.error}`}
              </Text>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text
            style={[
              type.title3,
              {
                color: t.label,
                paddingTop: 22,
                paddingBottom: 8,
                paddingHorizontal: 4,
              },
            ]}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item, index, section }) => (
          <MeetingRow
            m={item}
            first={index === 0}
            last={index === section.data.length - 1}
            live={live && rec.meetingId === item.id}
          />
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Symbol
              name={query ? "magnifyingglass" : "waveform"}
              size={44}
              color={t.label3}
            />
            <Text style={[type.title3, { color: t.label, marginTop: 14 }]}>
              {query ? "No results" : "No meetings yet"}
            </Text>
            <Text
              style={[
                type.subhead,
                s.center,
                { color: t.label2, marginTop: 6 },
              ]}
            >
              {query
                ? `Nothing matches “${query}”.`
                : "Tap Record when your meeting starts. Your notes and the transcript become clean notes."}
            </Text>
          </View>
        }
      />

      {live ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={[s.livePill, { bottom: insets.bottom + 64 }]}
          layout={LinearTransition}
        >
          <PressableScale
            onPress={() => router.push(`/meeting/${rec.meetingId}`)}
            accessibilityLabel="Return to the meeting being recorded"
          >
            <Glass style={s.livePillInner}>
              <View style={[s.liveDot, { backgroundColor: t.red }]} />
              <Text
                style={[
                  type.subhead,
                  {
                    color: t.label,
                    fontWeight: "600",
                    fontVariant: ["tabular-nums"],
                  },
                ]}
              >
                Recording {Math.floor(elapsed / 60000)}:
                {String(Math.floor(elapsed / 1000) % 60).padStart(2, "0")}
              </Text>
              <Symbol
                name="chevron.right"
                size={12}
                color={t.label2}
                weight="semibold"
              />
            </Glass>
          </PressableScale>
        </Animated.View>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  center: { textAlign: "center" },
  signin: { flex: 1, paddingHorizontal: 28 },
  signinHero: { alignItems: "center", marginTop: 96 },
  appIcon: {
    width: 92,
    height: 92,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
  },
  appIconDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#fff",
  },
  features: { gap: 22, marginTop: 44, paddingHorizontal: 4 },
  feature: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  signinActions: { marginTop: "auto", gap: 12 },
  linkBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  signinLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  swipe: { overflow: "hidden" },
  swipeDelete: { width: 80, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 64,
    borderCurve: "continuous",
  },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowIcons: { flexDirection: "row", gap: 6, marginLeft: 10 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingTop: 120,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  livePill: { position: "absolute", alignSelf: "center" },
  livePillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
  },
});
