const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

// Firestore(서울)와 같은 지역에서 실행해야 트리거가 붙어요.
const REGION = "asia-northeast3";
const DEFAULT_TITLES = { mom: "엄마", dad: "아빠", kid1: "첫째", kid2: "둘째" };
const WD = ["일", "월", "화", "수", "목", "금", "토"];

async function memberTitle(fam, id) {
  const snap = await db.doc(`families/${fam}/members/${id}`).get();
  return snap.data()?.title || DEFAULT_TITLES[id] || "가족";
}

// 글쓴이를 뺀 나머지 기기로 보내고, 더 이상 쓰이지 않는 토큰은 지워요.
// notification 필드 없이 data만 보내야 서비스워커에서 한 번만 표시돼요.
async function notifyFamily(fam, authorId, data) {
  const snap = await db.collection(`families/${fam}/pushTokens`).get();
  const targets = snap.docs.filter((d) => d.data().token && d.data().member !== authorId);
  if (!targets.length) {
    logger.info("알림 받을 기기가 없어요", { fam, authorId });
    return;
  }
  const res = await getMessaging().sendEachForMulticast({
    tokens: targets.map((d) => d.data().token),
    data,
    webpush: { fcmOptions: { link: "https://oneulmohae-family.web.app/" } },
  });
  logger.info(`알림 전송: 성공 ${res.successCount} / 실패 ${res.failureCount}`, { title: data.title });
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      dead.push(targets[i].ref.delete());
    }
  });
  await Promise.all(dead);
}

function fmtWhen(date, time) {
  const [y, m, d] = String(date || "").split("-").map(Number);
  if (!y) return "";
  const wd = WD[new Date(y, m - 1, d).getDay()];
  if (!time) return `${m}/${d}(${wd})`;
  const [H, M] = time.split(":").map(Number);
  return `${m}/${d}(${wd}) ${H < 12 ? "오전" : "오후"} ${H % 12 || 12}:${String(M).padStart(2, "0")}`;
}

// 새 일정
exports.onFamilyEventCreated = onDocumentCreated(
  { document: "families/{fam}/events/{id}", region: REGION },
  async (event) => {
    const e = event.data?.data();
    if (!e) return;
    const { fam, id } = event.params;
    const who = await memberTitle(fam, e.createdBy);
    await notifyFamily(fam, e.createdBy, {
      title: `📅 ${who}님이 일정을 올렸어요`,
      body: `${e.emoji || ""} ${e.title || ""} · ${fmtWhen(e.date, e.time)}${e.endDate && e.endDate > e.date ? " ~ " + fmtWhen(e.endDate) : ""}`.trim(),
      type: "event",
      id,
      date: String(e.date || ""),
      tag: `event-${id}`,
    });
  }
);

// 새 메모 / 제안
exports.onFamilyNoteCreated = onDocumentCreated(
  { document: "families/{fam}/notes/{id}", region: REGION },
  async (event) => {
    const n = event.data?.data();
    if (!n) return;
    const { fam, id } = event.params;
    const who = await memberTitle(fam, n.by);
    const suggest = n.kind === "suggest";
    await notifyFamily(fam, n.by, {
      title: suggest ? `💡 ${who}님의 제안` : `📝 ${who}님이 메모를 남겼어요`,
      body: String(n.text || "").slice(0, 120),
      type: suggest ? "suggest" : "memo",
      id,
      tag: `note-${id}`,
    });
  }
);

// 새 칭찬
exports.onFamilyPraiseCreated = onDocumentCreated(
  { document: "families/{fam}/praises/{id}", region: REGION },
  async (event) => {
    const p = event.data?.data();
    if (!p) return;
    const { fam, id } = event.params;
    const [from, to] = await Promise.all([memberTitle(fam, p.from), memberTitle(fam, p.to)]);
    await notifyFamily(fam, p.from, {
      title: `👏 ${from}님이 ${to}님을 칭찬했어요 (+${p.pts || 10}점)`,
      body: String(p.text || "").slice(0, 120),
      type: "praise",
      id,
      tag: `praise-${id}`,
    });
  }
);

// 반복 일정 "이 날만" 변경 / 취소 / 되돌리기
exports.onFamilyChangeCreated = onDocumentCreated(
  { document: "families/{fam}/changes/{id}", region: REGION },
  async (event) => {
    const c = event.data?.data();
    if (!c) return;
    const { fam, id } = event.params;
    const who = await memberTitle(fam, c.by);
    const when = fmtWhen(c.date);
    const t = c.title || "일정";
    await notifyFamily(fam, c.by, {
      title: c.moved ? `📅 ${when} ${t} → ${fmtWhen(c.to)}로 옮겼어요` : c.skip ? `🚫 ${when} ${t} 이번엔 취소` : c.restore ? `↩️ ${when} ${t} 다시 해요` : `✏️ ${when} ${t} 변경`,
      body: c.moved ? `${who}님이 날짜를 옮겼어요${c.time ? " · " + fmtWhen(c.to, c.time).split(") ")[1] : ""}` : c.skip ? `${who}님이 이번 ${t}을(를) 취소했어요` : c.restore ? `${who}님이 취소를 되돌렸어요` : `${who}님이 이 날만 바꿨어요${c.time ? " · " + fmtWhen(c.date, c.time).split(") ")[1] : ""}`,
      type: "day",
      date: String((c.moved && c.to) || c.date || ""),
      id,
      tag: `change-${id}`,
    });
  }
);
