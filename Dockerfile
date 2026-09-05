# 먹투 서버 + 빌드된 프론트엔드를 한 컨테이너로 낸다.
# Cloud Run 은 하나의 포트만 열기 때문에, Express 가 API 와 정적 파일을 함께 담당한다.
FROM node:24-slim AS build
WORKDIR /app
# 의존성만 먼저 복사해서 소스가 바뀌어도 npm ci 층이 재사용되게 한다.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# tsc 로 타입을 확인하고 Vite 로 클라이언트를 만든다(dist/client).
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 운영 의존성만 남긴다. 빌드 도구는 이미지에서 빼서 공격 표면을 줄인다.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY db ./db
COPY public ./public
# 상권 통계 등 정적 데이터. server/commercial.ts 가 기동 중에 읽으므로 없으면 뜨지 않는다.
COPY data ./data
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
# Cloud Run 은 PORT 를 주입한다. 기본값은 로컬 실행용이다.
ENV PORT=8080
EXPOSE 8080
# root 로 돌리지 않는다. node 이미지에 이미 있는 계정을 쓴다.
USER node
# npx 가 아니라 설치된 실행파일을 직접 부른다.
# npx 는 캐시 디렉터리에 쓰려 하는데, 비-root 로 돌면 그 경로가 없어 기동이 실패할 수 있다.
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
