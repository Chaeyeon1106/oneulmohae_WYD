# 오늘모해?

우리 가족 일정 공유 웹앱 — 캘린더 · 냉장고 게시판 · 기념일/가족 고정 일정 · 오늘 저녁 집밥 · 칭찬합니다

- 배포: https://oneulmohae-family.web.app (Firebase Hosting)
- 데이터: Cloud Firestore (서울), 로그인한 가족만 접근 (`firestore.rules`)
- 알림: Firebase Cloud Messaging + Cloud Functions (`functions/`)

## 구성
| 파일 | 내용 |
|---|---|
| `index.html` | 앱 전체 (화면·디자인·기능) |
| `functions/index.js` | 알림 서버 (일정·메모·제안·칭찬·날짜 변경) |
| `firestore.rules` | 보안 규칙 |
| `firebase-messaging-sw.js` | 푸시 알림 수신 + 알림 누르면 해당 화면으로 |
| `manifest.json`, `images/` | 홈 화면 앱 설정·아이콘 |

## 배포
`main` 브랜치에 반영되면 GitHub Actions가 Hosting을 자동 배포합니다 (`.github/workflows/firebase-hosting-deploy.yml`, Secret `FIREBASE_SERVICE_ACCOUNT_ONEULMOHAE_FAMILY` 필요).
Functions·보안 규칙은 직접 배포:

```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```
