# Commands for desktop plugins. Add a tool here to make it available to plugins.
FROM node:22.23.4-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    pandoc python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/py \
  && /opt/py/bin/pip install --no-cache-dir \
    jupytext ipykernel jupyter_client nbformat nbclient numpy pandas matplotlib

COPY server.js /app/server.js

USER 1000:1000
ENTRYPOINT ["node", "/app/server.js"]
