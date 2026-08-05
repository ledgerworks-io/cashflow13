# Attore Apify — cashflow13
#
# Qui gira una COPIA del server, non un puntatore a mcp.chiriba.it. Ogni
# modifica al motore va ricostruita anche di qua: e' il costo che si paga per
# stare su una piattaforma che ospita, ed e' il motivo per cui questa porta
# viene dopo il registro e non prima.

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
# Solo le dipendenze di produzione: l'immagine non deve portarsi dietro il
# compilatore e i test.
RUN npm ci --omit=dev --audit=false --fund=false \
 && npm cache clean --force

COPY --from=build /usr/src/app/dist ./dist
COPY LICENSE README.md ./

ENV NODE_ENV=production

# La porta la impone la piattaforma con ACTOR_WEB_SERVER_PORT; l'indirizzo
# pubblico arriva da ACTOR_STANDBY_URL. Non si cablano qui.
CMD ["node", "dist/index.js"]
