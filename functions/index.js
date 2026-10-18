const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

// 냉장고 안에 새 사진
exports.onFamilyPhotoCreated = onDocumentCreated(
  { document: "families/{fam}/photos/{id}", region: REGION },
  async (event) => {
    const p = event.data?.data();
    if (!p) return;
    const { fam, id } = event.params;
    const who = await memberTitle(fam, p.by);
    const n = Array.isArray(p.imgs) ? p.imgs.length : 1;
    await notifyFamily(fam, p.by, {
      title: `📷 ${who}님이 사진을 올렸어요${n > 1 ? ` (${n}장)` : ""}`,
      body: String(p.text || "냉장고를 열어 보세요").slice(0, 120),
      type: "photo",
      id,
      tag: `photo-${id}`,
    });
  }
);

// 앱이 보내는 가족 알림 (일정 날짜 변경·삭제, 반응·댓글·찬성, 오늘 저녁): 보내고 나면 지워요
exports.onFamilyPing = onDocumentCreated(
  { document: "families/{fam}/pings/{id}", region: REGION },
  async (event) => {
    const p = event.data?.data();
    if (!p) return;
    const { fam, id } = event.params;
    await notifyFamily(fam, p.by, {
      title: String(p.title || "오늘모해?").slice(0, 80),
      body: String(p.body || "").slice(0, 120),
      type: String(p.type || ""),
      id: String(p.ref || ""),
      date: String(p.date || ""),
      tag: String(p.tag || `ping-${id}`),
    });
    await event.data.ref.delete();
  }
);

// 매일 자정(한국 시간): 오늘이 생일·기념일·가족 고정 일정이면 가족 모두에게 알림
const pad2 = (n) => String(n).padStart(2, "0");
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// 앱(index.html)의 annOccurs와 같은 규칙
function annOccurs(a, y, m, d, wd, ds) {
  const ex = a.ex && a.ex[ds];
  if (a.kind === "family") {
    if (ex && ex.skip) return false;
    if (ex && ex.add) return true; // 다른 날에서 옮겨 옴
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (a.rule === "weekly") return wd === Number(a.wday);
    if (a.rule === "mday") return d === Math.min(Number(a.mday) || 1, last);
    if (a.rule === "nth") {
      if (wd !== Number(a.wday)) return false;
      return Number(a.nth) === -1 ? d + 7 > last : Math.ceil(d / 7) === Number(a.nth);
    }
  }
  let day = Number(a.day);
  if (Number(a.month) === 2 && day === 29 && !isLeap(y)) day = 28;
  return Number(a.month) === m && day === d;
}
// 앱의 annHost와 같은 규칙: hostRot 순서대로 hostStart 달부터 한 달씩
function annHostId(a, ds) {
  const rot = Array.isArray(a.hostRot) ? a.hostRot : [];
  if (!rot.length || !a.hostStart) return null;
  const ex = a.ex && a.ex[ds];
  const [y, m] = String(ex && ex.add ? ex.from : ds).split("-").map(Number);
  const [sy, sm] = String(a.hostStart).split("-").map(Number);
  const i = (y * 12 + m - 1) - (sy * 12 + sm - 1);
  return rot[((i % rot.length) + rot.length) % rot.length];
}
function fmtTime(t) {
  if (!t) return "";
  const [H, M] = t.split(":").map(Number);
  return `${H < 12 ? "오전" : "오후"} ${H % 12 || 12}:${pad2(M)}`;
}

exports.annivMidnight = onSchedule(
  { schedule: "0 0 * * *", timeZone: "Asia/Seoul", region: REGION },
  async () => {
    const k = new Date(Date.now() + 9 * 3600e3); // 한국 날짜
    const y = k.getUTCFullYear(), m = k.getUTCMonth() + 1, d = k.getUTCDate(), wd = k.getUTCDay();
    const ds = `${y}-${pad2(m)}-${pad2(d)}`;
    const fams = await db.collection("families").listDocuments();
    for (const famRef of fams) {
      const fam = famRef.id;
      const snap = await famRef.collection("anniv").get();
      for (const doc of snap.docs) {
        const a = doc.data();
        if (!annOccurs(a, y, m, d, wd, ds)) continue;
        const ex = (a.ex && a.ex[ds]) || {};
        const who = a.memberId ? await memberTitle(fam, a.memberId) : "";
        const yr = Number(a.year);
        let title, body = "";
        if (a.kind === "family") {
          const host = annHostId(a, ds);
          title = `🍽️ 오늘은 ${ex.title || a.title || "가족 고정 일정"}이에요`;
          body = [fmtTime(ex.time ?? a.time), host ? `주최 ${await memberTitle(fam, host)}` : ""].filter(Boolean).join(" · ");
        } else if (a.kind === "birthday") {
          title = `🎂 오늘은 ${a.title || (who ? who + " 생일" : "생일")}이에요!`;
          body = yr > 1900 ? `만 ${y - yr}세 생일 축하해요 🎉` : "생일 축하해요 🎉";
        } else if (a.kind === "anniv") {
          title = `💍 오늘은 ${a.title || "기념일"}이에요`;
          body = yr > 1900 ? `${y - yr}주년이에요` : "";
        } else {
          title = `⭐ 오늘은 ${a.title || "기념일"}이에요`;
        }
        await notifyFamily(fam, null, { title, body, type: "day", id: doc.id, date: ds, tag: `anniv-${doc.id}-${ds}` });
      }
    }
  }
);
