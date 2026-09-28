# Restaurar esta sandbox Linux

Use dependências já instaladas. Se `docker info` no socket abaixo responder, reutilize o daemon.

```bash
sudo dockerd --host unix:///home/vercel-sandbox/runtime/global-territory/docker.sock \
  --data-root /home/vercel-sandbox/runtime/global-territory/docker \
  --exec-root /home/vercel-sandbox/runtime/global-territory/docker-exec \
  --pidfile /home/vercel-sandbox/runtime/global-territory/docker.pid \
  --iptables=false --bridge=none --storage-driver=vfs \
  > /home/vercel-sandbox/runtime/global-territory/docker.log 2>&1 &
```

Aguarde a criação do socket, dê acesso ao usuário da sandbox com `sudo chown "$(id -u):$(id -g)" /home/vercel-sandbox/runtime/global-territory/docker.sock` e confirme:

```bash
export DOCKER_HOST=unix:///home/vercel-sandbox/runtime/global-territory/docker.sock
docker info
docker compose --env-file .env.local up -d
npm run db:deploy
npm run dev
```

Saúde: `curl --fail http://localhost:3001/api/health`; página em http://localhost:5173. Registre os serviços na prévia da tarefa. O Chromium compartilhado pode estar sem WebGL; nesse caso a aplicação utiliza automaticamente Canvas. Não é necessário instalar outro navegador.
