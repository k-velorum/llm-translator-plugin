FROM node:22-bookworm-slim

# Install dependencies needed to fetch/install Claude Code
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code (native build) into the container
RUN curl -fsSL https://claude.ai/install.sh | bash -s stable \
  && ln -s /root/.local/bin/claude /usr/local/bin/claude

WORKDIR /app

COPY package.json ./
COPY server.js ./

ENV PORT=11434
ENV HOST=0.0.0.0

EXPOSE 11434

CMD ["node", "server.js"]
