# AI 명함 스튜디오 — 백엔드 서버

## 1. GitHub에 올리기

터미널(맥이면 터미널 앱, 윈도우면 명령프롬프트나 Git Bash)에서, 이 `server` 폴더
안으로 들어간 뒤:

```bash
git init
git add .
git commit -m "첫 서버 코드"
```

그 다음 GitHub 웹사이트(github.com)에서 오른쪽 위 "+" → "New repository" → 이름
입력(예: bizcard-studio-server) → "Create repository". 만들어진 페이지에 나오는
안내대로:

```bash
git remote add origin https://github.com/내계정/bizcard-studio-server.git
git branch -M main
git push -u origin main
```

## 2. Render에서 배포하기

1. Render 대시보드 → "New" → "Web Service"
2. 방금 만든 GitHub 저장소 선택(처음이면 GitHub 계정 연결 권한을 요청할 수 있습니다 — 허용)
3. 설정값:
   - **Name**: 아무 이름(예: bizcard-studio-server)
   - **Region**: Singapore (한국에서 제일 가까운 선택지)
   - **Branch**: main
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (일단 무료로 시작, 나중에 트래픽 늘면 업그레이드)
4. "Environment Variables" 섹션에서 `.env.example` 파일에 있는 값들을 하나씩 추가
   (Key/Value 쌍으로). `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 Supabase
   프로젝트의 "Project Settings → API"에서 복사해오시면 됩니다.
5. "Create Web Service" 클릭 → 몇 분 기다리면 배포됩니다.
6. 배포가 끝나면 화면 위쪽에 `https://bizcard-studio-server.onrender.com` 같은
   주소가 생깁니다. 그 주소를 브라우저로 열어서 `{"ok":true, ...}` 같은 응답이 보이면
   서버가 정상적으로 켜진 겁니다.

## 3. Supabase 테이블 만들기 (아직 안 하셨다면)

Supabase 프로젝트 → 왼쪽 메뉴 "SQL Editor" → "New query" → 같이 드린
`supabase_schema.sql` 내용 전체를 붙여넣고 "Run".

## 4. 확인하기

서버 주소가 살아있는 걸 확인하셨으면, 저에게 그 주소(`https://...onrender.com`)를
알려주세요 — 다음 단계로 프론트엔드(지금 쓰고 계신 명함 앱)가 이 서버를 실제로
호출하도록 연결해드리겠습니다.

## 참고 — 무료 요금제의 특성
Render 무료 웹 서비스는 15분 동안 요청이 없으면 서버가 잠들고(sleep), 다음 요청이
오면 다시 깨어나는 데 30초~1분 정도 걸릴 수 있습니다. 테스트 단계에서는 괜찮지만,
실제 서비스 오픈 시점에는 유료 플랜(월 7달러부터)으로 올리는 걸 권장합니다 —
그래야 손님이 결제할 때 서버가 잠들어서 느려지는 일이 없습니다.
