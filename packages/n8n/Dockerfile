FROM node:20-alpine

WORKDIR /app

# Inicialitzem, definim type=module (important per MCP stdio) i instal·lem dependencies
COPY package.json .
RUN npm install


# Copiem el codi
COPY . .

# Executem el wrapper
CMD ["node", "index.js"]
