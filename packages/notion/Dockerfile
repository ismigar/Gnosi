FROM node:20-alpine

WORKDIR /app

# Instal·lem el paquet oficial
RUN npm install -g @notionhq/notion-mcp-server

# Copiem el nostre shim index.js
COPY index.js .

# Això és només per defecte si es fa docker run, però el docker-compose fa override
CMD ["node", "index.js"]
