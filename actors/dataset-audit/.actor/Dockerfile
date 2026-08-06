# Attore Apify — dataset-audit
#
# Il contesto di compilazione e' la RADICE del repo, non questa cartella: cosi'
# l'immagine compila il TypeScript di `src/` invece di portarsi dietro una copia
# gia' compilata. Una sola fonte, allineata per costruzione.

FROM apify/actor-node:22 AS build

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --include=dev --audit=false --fund=false
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM apify/actor-node:22

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev --audit=false --fund=false \
 && npm cache clean --force

COPY --from=build /usr/src/app/dist ./dist
COPY LICENSE ./
COPY actors/dataset-audit/README.md ./

ENV NODE_ENV=production

CMD ["node", "dist/audit/actor.js"]
