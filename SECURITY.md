# Política de seguridad / Security policy

_English below._

## Versiones soportadas

omero-social-post todavía no tiene releases. Solo se mantiene la rama `main`.

| Versión                                  | Soportada |
| ---------------------------------------- | --------- |
| `main`                                   | ✅        |
| Cualquier otra rama, fork o commit viejo | ❌        |

## Cómo reportar una vulnerabilidad

**No abras una issue pública, un PR ni una discusión** sobre una vulnerabilidad.

Reportala en privado con **GitHub Security Advisories**:

1. Entrá a la pestaña [**Security**](https://github.com/Avesousa/omero-social-post/security) del repositorio.
2. Hacé clic en [**Report a vulnerability**](https://github.com/Avesousa/omero-social-post/security/advisories/new).
3. Contá:
   - qué encontraste y dónde (archivo, endpoint, commit);
   - cómo reproducirlo;
   - el impacto que ves.

   **No incluyas tokens ni secretos reales.**

Qué podés esperar:

- una primera respuesta dentro de los **7 días**;
- que coordinemos juntos la corrección y la publicación del advisory;
- crédito en el advisory, si lo querés.

Es un proyecto mantenido por una persona en su tiempo libre: los plazos son de buena fe, no un SLA.

### Qué entra en el alcance

- El código de este repositorio:
  - API, web y paquetes compartidos;
  - Dockerfiles, Compose y scripts de `infra/`;
  - workflows de CI.
- Por ejemplo:
  - bypass de autenticación o CSRF;
  - fuga o descifrado de tokens OAuth;
  - lectura de media sin sesión;
  - inyección;
  - SSRF;
  - secretos expuestos en logs.

### Qué no entra

- Instancias de terceros mal configuradas (por ejemplo, expuestas a internet sin Tailscale ni HTTPS).
- Vulnerabilidades de X, LinkedIn, Telegram, Tailscale u otros servicios: reportalas a cada proveedor.
- Dependencias con CVE sin un camino de explotación en este proyecto. Dependabot ya abre PRs para esas.

### Si filtraste un secreto propio

Si commiteaste por error un token o client secret de **tu** instancia, **rotalo ya** en el proveedor. Borrarlo del repo no alcanza: queda en el historial de git.

---

## Supported versions

There are no releases yet. Only the `main` branch is supported.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion.**

Report it privately through **GitHub Security Advisories**: go to the repository's [Security tab](https://github.com/Avesousa/omero-social-post/security) and click [**Report a vulnerability**](https://github.com/Avesousa/omero-social-post/security/advisories/new).

Include:

- what you found and where;
- steps to reproduce;
- the impact.

Never include real tokens or secrets.

You can expect a first response within **7 days**, coordinated disclosure, and credit in the advisory if you want it. This is a one-person, spare-time project, so timelines are best effort.

**In scope:** the code in this repository (API, web, shared packages, `infra/`, CI workflows).

**Out of scope:**

- misconfigured third-party instances;
- vulnerabilities in X, LinkedIn, Telegram or Tailscale themselves;
- dependency CVEs with no exploitable path in this project.
