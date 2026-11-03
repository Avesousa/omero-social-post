# Despliegue de omero en un VPS

Guía para instalar omero en un servidor propio pequeño (1 vCPU / 4 GB, Ubuntu 24.04), privado detrás de Tailscale. _English summary at the end._

| Archivo                  | Para qué                                                                        |
| ------------------------ | ------------------------------------------------------------------------------- |
| `bootstrap.sh`           | Prepara el servidor: usuario, SSH, firewall, actualizaciones, Docker, Tailscale |
| `docker-compose.yml`     | Stack de producción: postgres, redis, api, web (imágenes de GHCR)               |
| `.env.example`           | Variables de entorno (copiar a `/opt/omero/.env`)                               |
| `backup.sh`              | `pg_dump` diario con rotación de 14 días                                        |
| `tailscale/README.md`    | HTTPS con `tailscale serve`, `PUBLIC_BASE_URL` y callbacks de OAuth             |
| `docker-compose.dev.yml` | Solo desarrollo local (Postgres + Redis en 127.0.0.1)                           |

Las imágenes se construyen en GitHub Actions (`.github/workflows/release.yml`) y se publican en GHCR. El VPS nunca compila nada, solo descarga.

## 0. Antes de empezar: VPS de Hostinger con Traefik

La plantilla de Hostinger trae **Traefik** preinstalado y restos desconocidos. omero no necesita Traefik, porque Tailscale termina el HTTPS. Hay dos caminos:

- **Recomendado:** reinstalar el sistema desde hPanel → VPS → _OS & Panel_ → _Operating System_, eligiendo **Ubuntu 24.04 limpio** (sin "Docker" ni "Traefik"). Así se empieza de cero y `bootstrap.sh` deja todo en un estado conocido. Cargá tu clave SSH pública en el panel durante la reinstalación.
- **Alternativa:** conservar el sistema y quitar Traefik:

  ```sh
  docker ps -a                                   # ubicá el contenedor de traefik
  docker inspect traefik --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
  cd <ese directorio> && docker compose down     # o: docker rm -f traefik
  docker volume ls; docker network ls            # borrá lo que quede de Traefik
  ```

  Si Docker vino del paquete `docker.io` de Ubuntu, `bootstrap.sh` se detiene y te pide quitarlo, porque choca con Docker CE.

## 1. Bootstrap del servidor

Conectado como root (la primera y última vez):

```sh
curl -fsSLo bootstrap.sh https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/bootstrap.sh
sudo NEW_USER=omero \
     SSH_PUBKEY="ssh-ed25519 AAAA... vos@laptop" \
     TS_AUTHKEY=tskey-auth-... \
     TS_HOSTNAME=omero \
     bash bootstrap.sh
```

El script se puede correr varias veces: cada paso verifica el estado antes de actuar, y una segunda corrida no cambia nada. Lo que hace:

- crea el usuario `omero` con sudo y tu clave SSH (sin `SSH_PUBKEY` copia las claves de root);
- deshabilita el login de root y por contraseña (`/etc/ssh/sshd_config.d/00-omero-hardening.conf`, validado con `sshd -t`). **Se niega a hacerlo si el usuario no tiene una clave válida**, para no dejarte afuera;
- `ufw`: niega todo lo entrante, permite lo saliente, SSH y el tráfico del tailnet (`tailscale0`). No abre puertos de la app;
- activa `unattended-upgrades` (parches de seguridad diarios, sin reinicios automáticos);
- instala Docker Engine + plugin compose desde el repositorio oficial de Docker y agrega el usuario al grupo `docker`;
- instala Tailscale desde su repositorio oficial y ejecuta `tailscale up --ssh` si pasaste `TS_AUTHKEY`;
- crea `/opt/omero` (y `/opt/omero/backups`) con dueño `omero`.

**Antes de cerrar la sesión de root**, abrí otra terminal y probá `ssh omero@<ip>`. Cuando Tailscale SSH funcione (`ssh omero@omero`), podés cerrar el SSH público con `sudo ufw delete allow 22/tcp`.

## 2. Archivos y `.env`

Como `omero`:

```sh
cd /opt/omero
curl -fsSLO https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/backup.sh
curl -fsSL -o .env https://raw.githubusercontent.com/Avesousa/omero-social-post/main/infra/.env.example
chmod 600 .env && chmod +x backup.sh
```

Completá `.env`:

```sh
openssl rand -base64 32   # → ENCRYPTION_KEY
openssl rand -hex 24      # → POSTGRES_PASSWORD (y la misma en DATABASE_URL)
```

- `ENCRYPTION_KEY` cifra los tokens de OAuth. **Guardala fuera del servidor** (gestor de contraseñas). Si se pierde, hay que reconectar todos los canales.
- `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` tienen que coincidir con `DATABASE_URL` (`postgres://omero:<password>@postgres:5432/omero`). Los hosts son los nombres de servicio de compose: `postgres` y `redis`.
- `PUBLIC_BASE_URL` se completa en el paso 4. Mientras tanto dejá un valor `https://...` válido.
- X, LinkedIn y Telegram son opcionales, pero cada par se completa entero.

## 3. Levantar el stack

Las imágenes de GHCR son privadas hasta que las hagas públicas (GitHub → tu perfil → _Packages_ → `omero-social-post-api` / `-web` → _Package settings_ → _Change visibility_). Mientras sean privadas, iniciá sesión con un token clásico con el scope `read:packages`:

```sh
echo "<token>" | docker login ghcr.io -u Avesousa --password-stdin
```

Después:

```sh
cd /opt/omero
docker compose pull
docker compose up -d
docker compose ps        # esperá a que los cuatro servicios estén "healthy"
```

La API aplica las migraciones de la base al arrancar. El orden lo garantizan los healthchecks: postgres + redis → api → web.

## 4. HTTPS con Tailscale

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status   # → https://omero.<tailnet>.ts.net
```

Copiá esa URL a `PUBLIC_BASE_URL` en `.env` y aplicá el cambio con `docker compose up -d`. Los detalles (MagicDNS, certificados, callbacks de OAuth, acceso desde el teléfono) están en [`tailscale/README.md`](tailscale/README.md).

## 5. Abrir la app y crear el dueño

Desde un dispositivo en tu tailnet, abrí `https://omero.<tailnet>.ts.net`. La primera vez te lleva a `/setup` para crear el usuario dueño, que es el único usuario. Después, en _Ajustes → Canales_, conectá X y LinkedIn. Las URLs de callback que hay que registrar están en `tailscale/README.md`.

## Actualizaciones

```sh
cd /opt/omero
./backup.sh                          # siempre antes de actualizar
docker compose pull
docker compose up -d                 # recrea solo lo que cambió; las migraciones corren solas
docker image prune -f
```

- `OMERO_VERSION` en `.env` elige la etiqueta de las imágenes: `latest` (último build de `main`), una versión (`0.1.0`, `0.1`) o un commit (`sha-abc1234`). Fijar una versión hace las actualizaciones explícitas.
- **Volver atrás:** poné la etiqueta anterior en `OMERO_VERSION` y corré `docker compose up -d`. Las migraciones solo avanzan: si la versión nueva migró la base, restaurá también el backup previo (ver abajo).

## Backups

`backup.sh` hace un `pg_dump` (formato custom, comprimido) dentro del contenedor de Postgres. Lo guarda en `/opt/omero/backups`, verifica que se pueda leer y borra los de más de 14 días. Programalo con `crontab -e` (usuario `omero`):

```cron
17 3 * * * /opt/omero/backup.sh >> /opt/omero/backups/backup.log 2>&1
```

Copiá los backups fuera del servidor de vez en cuando (`scp`/`rsync` por Tailscale), junto con `.env`, y sobre todo `ENCRYPTION_KEY`. Las imágenes subidas viven en el volumen `omero_media-data`. Para respaldarlas:

```sh
docker run --rm -v omero_media-data:/data:ro -v /opt/omero/backups:/out debian:bookworm-slim \
  tar -C /data -czf /out/media-$(date -u +%Y%m%d).tar.gz .
```

**Restaurar** la base:

```sh
cd /opt/omero
docker compose stop api web
docker compose exec -T postgres sh -c \
  'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  < backups/omero-20260101T031700Z.dump
docker compose start api web
```

## Presupuesto de memoria

Objetivo: el stack completo en reposo usa **≤ 1.2 GB** en un VPS de 1 vCPU / 4 GB, y deja margen para el sistema, Tailscale y la etapa futura del digest con IA.

| Servicio  | Límite (`mem_limit`) | Ajuste interno                          | Uso esperado en reposo |
| --------- | -------------------- | --------------------------------------- | ---------------------- |
| postgres  | 512 MB               | `shared_buffers=256MB`                  | ~300 MB                |
| redis     | 192 MB               | `maxmemory 128mb`, `noeviction`, AOF    | ~50 MB                 |
| api       | 640 MB               | `NODE_OPTIONS=--max-old-space-size=512` | ~150–250 MB            |
| web       | 512 MB               | `NODE_OPTIONS=--max-old-space-size=384` | ~120–200 MB            |
| **Total** | **1.85 GB (techo)**  |                                         | **~0.65–0.8 GB**       |

Los límites son techos para que un servicio desbocado no tumbe a los demás. No son reservas. Como referencia, fuera de Docker y recién arrancados, la API usó ~135 MB de RSS y la web ~115 MB.

> **Pendiente de medir en el VPS.** Las imágenes no se pudieron construir ni correr en el entorno donde se escribieron. El criterio de ≤ 1.2 GB en reposo se valida en el servidor real (tarea de aceptación) con `docker stats --no-stream` unos minutos después de `up -d`, sumando la columna `MEM USAGE`.

## Solución de problemas

| Síntoma                                            | Qué mirar                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Un servicio no llega a `healthy`                   | `docker compose ps` y `docker compose logs --tail 100 <servicio>`                                                         |
| La API se cierra al arrancar                       | Imprime qué variable de `.env` es inválida o falta (`ENCRYPTION_KEY`, `DATABASE_URL`, pares de X/LinkedIn…)               |
| `password authentication failed` en la API         | `POSTGRES_PASSWORD` y `DATABASE_URL` no coinciden. Ojo: Postgres solo usa `POSTGRES_*` al crear el volumen la primera vez |
| `unauthorized` / `denied` en `docker compose pull` | Imágenes privadas en GHCR: hacelas públicas o `docker login ghcr.io` (paso 3)                                             |
| `permission denied ... docker.sock`                | Cerrá sesión y volvé a entrar para que tome el grupo `docker`                                                             |
| Login rechazado o en loop                          | `PUBLIC_BASE_URL` distinto de la URL del navegador                                                                        |
| `redirect_uri` inválido al conectar una red        | Callback mal registrada en el portal (ver `tailscale/README.md`)                                                          |
| Un contenedor se reinicia solo                     | Posible OOM: `docker stats`, `docker inspect <c> --format '{{.State.OOMKilled}}'`, `sudo dmesg \| grep -i oom`            |
| Disco lleno                                        | `docker system df`, `docker image prune -f`, revisar `/opt/omero/backups`. Los logs rotan solos (3 × 10 MB por servicio)  |

---

## English summary

Deploying omero on a 1 vCPU / 4 GB Ubuntu 24.04 VPS, private behind Tailscale:

1. **Hostinger:** the template ships Traefik and unknown leftovers. Prefer reinstalling a plain Ubuntu 24.04 from hPanel. Otherwise stop and remove the Traefik container. Traefik is not needed because Tailscale terminates HTTPS.
2. **Bootstrap:** as root, run `sudo NEW_USER=omero SSH_PUBKEY="..." TS_AUTHKEY=... bash bootstrap.sh`. It is idempotent and covers the sudo user, key-only SSH (it refuses without a key), ufw, unattended-upgrades, Docker CE, Tailscale and `/opt/omero`.
3. **Files:** put `docker-compose.yml`, `backup.sh` and `.env` (from `.env.example`) in `/opt/omero`.
   - Generate `ENCRYPTION_KEY` with `openssl rand -base64 32` and keep a copy off the server.
   - Match `POSTGRES_*` with `DATABASE_URL`.
4. **Start:** `docker compose pull && docker compose up -d`. The GHCR packages are private until you make them public; until then, `docker login ghcr.io` with a `read:packages` token.
5. **HTTPS:** run `sudo tailscale serve --bg --https=443 http://127.0.0.1:3000`, then set `PUBLIC_BASE_URL` to the printed `https://<host>.<tailnet>.ts.net` and run `up -d` again.
6. **Open the app:** browse to the URL from a tailnet device and create the owner at `/setup`.
7. **Updates:** back up, `pull`, `up -d`, `image prune`. Choose the image tag with `OMERO_VERSION`. Migrations only go forward.
8. **Backups:** run `backup.sh` from cron daily. It writes a custom-format dump with 14-day rotation. Restore with `pg_restore --clean --if-exists`.
9. **Memory budget:** the target is ≤ 1.2 GB idle. Container limits are 512/192/640/512 MB, and Node heaps are capped at 512 MB (API) and 384 MB (web). **Not measured yet:** no Docker was available while writing this, so verify on the VPS with `docker stats --no-stream`.
