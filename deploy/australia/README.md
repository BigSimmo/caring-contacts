# Caring Contacts — Sovereign Australian Container Deployment Runbook

> **OPERATIONAL SAFETY NOTICE (HAZARD H-36 / #NCAWAF)**
>
> This runbook specifies the operator procedures for deploying the sovereign Caring Contacts application container to Australian cloud infrastructure in Sydney (`ap-southeast-2` / `australiaeast`).
>
> **Hazard H-36 Mandate:** Real patient Protected Health Information (PHI) in suicide aftercare (patient names, preferred names, Australian mobile numbers, hospital UMRNs, care plans, and contact dispatch records) must never transit or reside in foreign jurisdictions. Because Railway has no Australian region, real-patient deployments are strictly prohibited on Railway and must use this sovereign container blueprint.
>
> **Standalone copy:** this app has no Sentry reporting and reads no Supabase keys; it reads only the
> `CARING_CONTACTS_*` variables, `PORT` and `NODE_ENV`. Steps below that mention Sentry are carried over from
> the PsychSift original and apply only if error reporting is added later. Live mode now has staff sign-in
> (see "Staff sign-in" below) but still needs the governance sign-off and the other items in the main
> README before it may hold real patients.
>
> **Detailed Specification:** [`docs/deployment/caring-contacts-sovereign-australia.md`](../../docs/deployment/caring-contacts-sovereign-australia.md)

---

## 1. Overview of Artifacts

| File                                            | Purpose                                                                                                             |
| :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `deploy/australia/Dockerfile.australia`         | Multi-stage production container for Next.js 16 on Node 24 with security hardening and non-root `nextjs` execution. |
| `deploy/australia/docker-compose.australia.yml` | Local and staging orchestration specifying isolated networking and deep `/api/caring-contacts/ready` probing.       |
| `deploy/australia/env.australia.example`        | Template for sovereign environment variables with explicit database separation and zero-egress controls.            |
| `deploy/australia/README.md`                    | This deployment and operational verification runbook.                                                               |

---

## 2. Prerequisites

1. **Docker Engine & Buildx:** Docker 24+ with `buildx` enabled.
2. **Cloud CLI Tools:**
   - For AWS: `aws-cli` v2 installed and configured with credentials for region `ap-southeast-2` (Sydney).
   - For Azure: `az` CLI installed and logged into an Australian subscription (`australiaeast`).
3. **Dedicated Sydney Supabase Project:**
   - A dedicated Supabase instance provisioned in AWS Sydney (`ap-southeast-2`).
   - **CRITICAL:** Do NOT reuse the PsychSift knowledge-base project (`sjrfecxgysukkwxsowpy`). The application executes `assertNotClinicalKbProject()` during startup and will crash intentionally if that project ref is supplied.
4. **Secrets Management:** Access to AWS Secrets Manager (Sydney) or Azure Key Vault (`australiaeast`).

---

## 3. Local Build & Smoke Verification

Before deploying to cloud container runtimes, verify the container builds cleanly and satisfies healthchecks locally.
Run every command from the repository root. The smoke test below uses demo mode with invented
data only: no database, no real secrets, and never live mode.

### 3.1 Step 1: Build the Container Image

```bash
docker build \
  --file deploy/australia/Dockerfile.australia \
  --tag caring-contacts-app-australia:latest \
  .
```

The finished image is about 1 GB on disk and runs as the unprivileged `nextjs` user (UID 1001).

### 3.2 Step 2: Prepare a Smoke-Test Environment File

Compose reads settings from `deploy/australia/env.australia`. It is excluded from the image, but
`.gitignore` does not cover it yet, so never `git add` it: it holds secrets. For a smoke test, create it with demo mode on and a throwaway session secret:

```bash
printf 'CARING_CONTACTS_DEMO_ENABLED=true\nCARING_CONTACTS_SESSION_HMAC_SECRET=%s\n' \
  "$(openssl rand -hex 32)" > deploy/australia/env.australia
```

Do not set `CARING_CONTACTS_DATABASE_URL` for a smoke test. For a real deployment, start from
`env.australia.example` instead (`cp deploy/australia/env.australia.example deploy/australia/env.australia`)
and fill in the dedicated Sydney database and secrets. Settings must go in this file: the compose
file deliberately does not pass database, secret or mode settings from your shell.

### 3.3 Step 3: Run via Docker Compose

```bash
docker compose -f deploy/australia/docker-compose.australia.yml config --quiet   # validates the file
docker compose -f deploy/australia/docker-compose.australia.yml up -d --no-build
```

### 3.4 Step 4: Verify Health & Readiness

```bash
# Check container logs (look for "Ready in")
docker compose -f deploy/australia/docker-compose.australia.yml logs caring-contacts-app

# Probe the readiness endpoint
curl -si http://127.0.0.1:3000/api/caring-contacts/ready

# Docker's own verdict: "healthy" after roughly 30 seconds
docker inspect -f '{{.State.Health.Status}}' caring-contacts-sovereign-app
```

Expected results in the demo smoke test:

- The readiness probe answers `HTTP/1.1 200 OK` with `Cache-Control: no-store` and
  `{"ok":true,"store":"in-memory","caringContactsDatabase":"skipped"}`.
- `http://127.0.0.1:3000/caring-contacts` shows the workspace with invented example patients.
- `/mockups/...` answers 404 (the design prototypes stay closed in production unless
  `CARING_CONTACTS_MOCKUPS_ENABLED=true`).

How the container fails closed when it is not deliberately switched on:

- **No `CARING_CONTACTS_DEMO_ENABLED` and no database:** it starts, but the workspace shows
  "could not be found", the Caring Contacts API answers 404, the readiness probe answers 503 and
  Docker marks it `unhealthy`.
- **`CARING_CONTACTS_DEMO_ENABLED=false` (live mode) without a database, secret, complete staff
  sign-in settings and signed governance attestation:** the server logs `Refusing to start: ...`
  (naming each missing setting, never its value) and answers 500 to every request; Docker marks it
  `unhealthy`.
- With a dedicated database configured, the probe answers 200 only when `select 1` succeeds
  against it, and 503 otherwise.

Stop and clean up afterwards:

```bash
docker compose -f deploy/australia/docker-compose.australia.yml down
rm deploy/australia/env.australia
```

---

## 4. Option A: AWS ECS Fargate Deployment (`ap-southeast-2`)

### 4.1 Step 1: Create Amazon ECR Repository in Sydney

```bash
aws ecr create-repository \
  --repository-name caring-contacts-app \
  --region ap-southeast-2 \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=KMS
```

### 4.2 Step 2: Push Image to ECR

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="${ACCOUNT_ID}.dkr.ecr.ap-southeast-2.amazonaws.com"

aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin "${REGISTRY}"

docker tag caring-contacts-app-australia:latest "${REGISTRY}/caring-contacts-app:latest"
docker push "${REGISTRY}/caring-contacts-app:latest"
```

### 4.3 Step 3: Store Production Secrets in AWS Secrets Manager (Sydney)

Store the sensitive connection strings and keys in Secrets Manager encrypted with an `ap-southeast-2` KMS Key:

```bash
aws secretsmanager create-secret \
  --name "caring-contacts/production" \
  --region ap-southeast-2 \
  --secret-string '{
    "CARING_CONTACTS_DATABASE_URL": "postgresql://postgres:[PASSWORD]@db.<sydney-project-ref>.supabase.co:5432/postgres?sslmode=require",
    "CARING_CONTACTS_SESSION_HMAC_SECRET": "<openssl rand -hex 32>"
  }'
```

### 4.4 Step 4: Register ECS Task Definition

Create `task-definition.json` ensuring:

- `requiresCompatibilities: ["FARGATE"]`
- `cpu: "2048"`, `memory: "4096"`
- `networkMode: "awsvpc"`
- Non-root user: `nextjs`
- Secrets mapped from `caring-contacts/production` ARN.
- Environment variables:
  - `CARING_CONTACTS_REGION=ap-southeast-2`
  - `ZERO_DATA_EGRESS_AUSTRALIA=true`
  - `SENTRY_PII_SCRUBBING=true`
  - `NEXT_PUBLIC_CARING_CONTACTS_TRAINING_MODE=false`
  - `CARING_CONTACTS_DEMO_ENABLED=false` (or `true` for staging)

Register the task definition:

```bash
aws ecs register-task-definition \
  --cli-input-json file://task-definition.json \
  --region ap-southeast-2
```

### 4.5 Step 5: Network Egress Lockdown

In your VPC configuration:

1. **Private Subnets:** ECS tasks run in private subnets with no public IPs.
2. **Security Group Egress:**
   - Allow Outbound TCP 443 (HTTPS) to Sydney Supabase IP range / AWS Endpoints.
   - Allow Outbound TCP 5432 (Postgres) to Sydney Supabase IP range.
   - Allow Outbound TCP 443 (HTTPS) to the identity provider used for staff sign-in (live mode).
   - Allow Outbound TCP 443 (HTTPS) to `products.api.telstra.com` only if real text messages are switched on (see "Text messages").
   - **Deny all other outbound traffic.**
3. **AWS Network Firewall:** Stateful rule drops any outbound traffic to US IP ranges or unauthorized domains (including `api.openai.com`).

### 4.6 Step 6: Create or Update ECS Service

```bash
aws ecs update-service \
  --cluster caring-contacts-sydney \
  --service caring-contacts-service \
  --task-definition caring-contacts-app \
  --force-new-deployment \
  --region ap-southeast-2
```

---

## 5. Option B: Azure Container Apps Deployment (`australiaeast`)

### 5.1 Step 1: Create Azure Container Registry & Push

```bash
az acr create \
  --resource-group rg-caringcontacts-sydney \
  --name acrcaringcontactssyd \
  --sku Premium \
  --location australiaeast

az acr login --name acrcaringcontactssyd

docker tag caring-contacts-app-australia:latest acrcaringcontactssyd.azurecr.io/caring-contacts-app:latest
docker push acrcaringcontactssyd.azurecr.io/caring-contacts-app:latest
```

### 5.2 Step 2: Store Secrets in Azure Key Vault (`australiaeast`)

```bash
az keyvault secret set \
  --vault-name kv-caringcontacts-syd \
  --name CaringContactsDatabaseUrl \
  --value "postgresql://postgres:[PASSWORD]@db.<sydney-project-ref>.supabase.co:5432/postgres?sslmode=require"
```

### 5.3 Step 3: Deploy Azure Container App

Deploy inside a custom VNet with egress lockdown:

```bash
az containerapp create \
  --name ca-caringcontacts \
  --resource-group rg-caringcontacts-sydney \
  --environment cae-caringcontacts-sydney \
  --image acrcaringcontactssyd.azurecr.io/caring-contacts-app:latest \
  --target-port 3000 \
  --ingress external \
  --cpu 2.0 --memory 4.0Gi \
  --min-replicas 2 --max-replicas 10 \
  --env-vars \
    CARING_CONTACTS_REGION=ap-southeast-2 \
    ZERO_DATA_EGRESS_AUSTRALIA=true \
    SENTRY_PII_SCRUBBING=true \
    NEXT_PUBLIC_CARING_CONTACTS_TRAINING_MODE=false \
    CARING_CONTACTS_DEMO_ENABLED=false \
    CARING_CONTACTS_DATABASE_URL=keyvaultref:https://kv-caringcontacts-syd.vault.azure.net/secrets/CaringContactsDatabaseUrl
```

---

## Staff sign-in (live mode)

In live mode staff sign in with their normal work account through the health service's identity
provider (for example Microsoft Entra ID, Okta, Keycloak or ADFS), using standard OpenID Connect.
Caring Contacts keeps no passwords. After the provider confirms who someone is, the app checks
their groups: a group decides their role, another decides their team, and anyone without a mapped
role or with no single team is turned away with a plain message. A session lasts 8 hours.

What the owner must set up in the identity provider:

1. Register a new application (often called an "app registration" or "OIDC client") of the kind
   "web application" with a client secret. Name it Caring Contacts.
2. Set its sign-in redirect (callback) address to exactly
   `https://<your Caring Contacts address>/api/caring-contacts/auth/callback`.
3. Allow the "authorization code" flow with PKCE. Turn off the implicit flow.
4. Make the ID token include the person's groups in a claim called `groups` (or note the claim's
   name for `CARING_CONTACTS_OIDC_GROUPS_CLAIM`, for example `realm_access.roles` in Keycloak).
   Group names or group IDs both work, as long as the maps below use the same values.
5. Create one group per role you will use (for example `CC-Coordinators`, `CC-Team-Leads`,
   `CC-Auditors`) and one group per team (for example `CC-Team-North`), and add staff to one role
   group and exactly one team group.
6. Optionally register a sign-out return address and put it in
   `CARING_CONTACTS_OIDC_POST_LOGOUT_REDIRECT_URL`.
7. Copy the provider's issuer URL, the client ID and the client secret into the settings below.
   Keep the secret in Secrets Manager or Key Vault. The provider must be hosted in Australia (H-36)
   and reachable over HTTPS from the container.

Settings (all in `env.australia`, section 3a of the example file):

| Setting                                         | What to put                                                              |
| :---------------------------------------------- | :----------------------------------------------------------------------- |
| `CARING_CONTACTS_SESSION_ISSUER`                | The provider's issuer URL, exactly as its discovery document states it   |
| `CARING_CONTACTS_OIDC_CLIENT_ID`                | The client ID from step 1                                                |
| `CARING_CONTACTS_OIDC_CLIENT_SECRET`            | The client secret from step 1                                            |
| `CARING_CONTACTS_OIDC_REDIRECT_URL`             | The callback address from step 2                                         |
| `CARING_CONTACTS_OIDC_ROLE_MAP`                 | JSON, group to role, e.g. `{"CC-Coordinators":"coordinator"}`            |
| `CARING_CONTACTS_OIDC_TEAM_MAP`                 | JSON, group to team id, e.g. `{"CC-Team-North":"team-north"}`            |
| `CARING_CONTACTS_OIDC_GROUPS_CLAIM` (optional)  | The groups claim name if it is not `groups`                              |
| `CARING_CONTACTS_OIDC_SCOPES` (optional)        | Extra scopes if the provider needs one to release groups (e.g. `groups`) |
| `CARING_CONTACTS_OIDC_POST_LOGOUT_REDIRECT_URL` | Optional sign-out return address from step 6                             |

The roles are `coordinator`, `teamLead`, `auditor`, `clinicalProgrammeLead` and
`livedExperienceRepresentative`. The team ids must match the teams in the Caring Contacts database.

If anything is missing or malformed, the server refuses to start and names the setting. To check
the setup: open the workspace address, sign in at the provider, and confirm you land back in the
workspace. Signing out is `/api/caring-contacts/auth/sign-out`.

## Text messages

Caring Contacts can now send its scheduled messages as real text messages through the Telstra
Messaging API, an Australian carrier's own service. **Out of the box it sends nothing to anyone**:
the default is a simulated sender that only records what it would have done. Real sending is off
until every setting below is present, and the server refuses to send (rather than quietly
simulating) if real sending is switched on but only half set up.

How it works, in short:

- A **sender** runs every few minutes. It looks for contacts that are due now, skips anything the
  service safety stop, a paused or ended plan, or the 9 am to 6 pm Perth sending window rules out,
  builds each patient's message from the plan's approved wording with that patient's own preferred
  name, sends it, and records the result. A contact whose window has closed is recorded as missed,
  never sent late.
- It never sends the same contact twice, even if two senders run at once, and it never re-sends a
  message whose outcome was unclear. Anything that did not clearly work shows as "needs review".
- It never invents wording. The current pathway has no approved wording for the **first** and
  **closing** messages, so those contacts are marked "needs review" instead of being sent, and with
  real sending on, a plan on a pathway missing wording for any of its messages **cannot be activated**.
- **The current message wording cannot be sent for real.** It still contains the prototype's
  invented support-line numbers, and the message rules refuse to send invented numbers to a real
  phone. Real patient messages will only go out once the clinical and lived-experience approval
  gate has approved final wording with real numbers and it has been put into a pathway version.
- The carrier reports delivery back to `/api/caring-contacts/delivery/webhook`. Each message gets its
  own signed address, so a forged report is refused. Receipts update the contact to delivered or
  not delivered. If no report arrives within a day, the contact is marked "status unavailable" for
  a person to check.

### What the owner needs to do

1. **Know what has and has not been checked.** On 26 September 2026 the Telstra connection was
   checked against Telstra's own published material for Messaging API v3 (its official software
   kits, because Telstra's developer website could not be read by the tools used) and corrected.
   The sign-in address, message address, request fields and status words now match. Four things
   could not be confirmed from anything published and must be confirmed with Telstra, or by the
   staff test in step 9, before patient use:
   - **Delivery reports are a paid feature.** Telstra only sends a delivery report when the
     account has delivery notifications switched on. Ask Telstra to enable it; without it no
     contact will ever show "delivered", and every contact will become "status unavailable".
   - **The exact shape of a delivery report**, and whether Telstra keeps the signed part of the
     report address (everything after the `?`). If it does not, every report will be refused.
   - **Rate limits and error formats.** Nothing was published. A refusal is recorded as not sent and
     is never retried automatically.
   - **Where Telstra stores and handles messages** (see step 2).
2. **Open a Telstra Messaging API account** for the health service (Telstra Developer portal or your
   Telstra account manager). Ask for written confirmation that messages are carried and stored in
   Australia (deployment spec section 4.2).
3. **Get an Australian sending number or approved sender name.** Buy a dedicated virtual mobile
   number in the Telstra portal, or apply for an alphanumeric sender name (for example
   "WAHealthCC"). The message wording says replies are not read, so the number must auto-respond
   as the approved wording describes before real use.
4. **Create API credentials** (a client ID and client secret) in the Telstra portal.
5. **Choose two long random secrets** (run `openssl rand -hex 32` twice): one for the sender and one
   for delivery reports. Store them, and the Telstra client secret, in Secrets Manager or Key Vault.
6. **Put the settings in** `env.australia` (section 3b of the example file):

   | Setting                                   | What to put                                                                         |
   | :---------------------------------------- | :---------------------------------------------------------------------------------- |
   | `CARING_CONTACTS_SMS_TRANSPORT`           | `telstra` to switch real sending on. Leave unset (or `simulated`) otherwise.        |
   | `CARING_CONTACTS_TELSTRA_CLIENT_ID`       | The client ID from step 4                                                           |
   | `CARING_CONTACTS_TELSTRA_CLIENT_SECRET`   | The client secret from step 4                                                       |
   | `CARING_CONTACTS_TELSTRA_FROM`            | The virtual number (e.g. `+61412345678`) or sender name from step 3                 |
   | `CARING_CONTACTS_TELSTRA_API_BASE_URL`    | Leave unset. Only Telstra's Australian addresses are accepted.                      |
   | `CARING_CONTACTS_PUBLIC_BASE_URL`         | This service's public https address, e.g. `https://caringcontacts.health.wa.gov.au` |
   | `CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET` | The delivery-report secret from step 5 (at least 32 characters)                     |
   | `CARING_CONTACTS_SENDER_SECRET`           | The sender secret from step 5 (at least 32 characters)                              |
   | `CARING_CONTACTS_SENDER_TEAM_IDS`         | The team ids the sender works for, comma-separated, e.g. `team-north`               |

   Real sending also requires live mode (`CARING_CONTACTS_DEMO_ENABLED=false` with staff sign-in and
   the database set up). In demo mode the server refuses to send real messages.

7. **Allow the container to reach Telstra**: outbound HTTPS to `products.api.telstra.com` (section
   4.5), and make sure the delivery-report address
   `https://<your address>/api/caring-contacts/delivery/webhook` is reachable from the internet.
8. **Start the sender** in one of two ways (either is safe to run alongside the other):
   - **An external scheduler (recommended in the cloud):** every 5 minutes, send
     `POST https://<your address>/api/caring-contacts/dispatch-run` with the header
     `Authorization: Bearer <sender secret>` (Amazon EventBridge Scheduler, an Azure Container Apps
     job, or cron with curl).
   - **The built-in loop:** run this in a terminal or a small always-on container, with
     `CARING_CONTACTS_SENDER_URL` set to your address and `CARING_CONTACTS_SENDER_SECRET` set to the
     sender secret:

     ```
     npm run sender
     ```

     `npm run sender -- --once` does one run and stops, for use from cron. Change the gap with
     `CARING_CONTACTS_SENDER_INTERVAL_SECONDS` (default 300 seconds).
9. **Test with a staff phone first.** Before any patient plan is active, send one fixed test message
   to a staff member's own mobile:

   ```
   npm run sender -- --test-to 04xx xxx xxx
   ```

   It sends "Caring Contacts: this is a staff test of the text-message connection. No action is
   needed." and records nothing. Confirm the phone receives it and shows the right sender. The
   command prints `outcome=accepted` when Telstra took the message. The staff test records
   nothing, so it does not prove delivery reports work. Once approved wording is in place, make the
   first real caring contact go to a staff member on a test plan and confirm the plan screen shows
   it as delivered within a few minutes. That is the proof that delivery reports arrive and are
   accepted.

Each run prints only counts and reason codes (for example `sent=3 needsReview=1`), never names,
numbers or message text. If the service safety stop is raised, runs print "SERVICE STOPPED: nothing
sent" and make no changes.

---

## 6. Post-Deployment Verification Checklist

Execute these checks immediately following deployment to confirm sovereign integrity:

1. **Readiness Probe:**

   ```bash
   curl -f https://<caring-contacts-domain>/api/caring-contacts/ready
   ```

   Must return HTTP 200 within 500 ms.

2. **Database Separation Assertion:**
   Review container initialization logs in CloudWatch / Azure Log Analytics:
   - Confirm absence of `CaringContactsProjectSeparationError`.
   - Confirm active database mode is `postgres` (connected to Sydney host).

3. **Zero Data Egress Verification:**
   From an attached debugging task or container session:

   ```bash
   # Test outbound ping to foreign AI endpoints (MUST FAIL)
   nc -zvw3 api.openai.com 443
   ```

   Must report `Connection timed out` or `Network is unreachable`.

4. **Telemetry PII Scrubbing Verification:**
   - Trigger a handled warning event.
   - Inspect Sentry event dashboard:
     - Verify patient mobile numbers are scrubbed (`[REDACTED_PHONE]`).
     - Verify no request body containing recipient names or clinical notes is captured.

---

## 7. Incident Response & Emergency Procedures

1. **Suspected Cross-Border Leakage / Egress Breach:**
   - If an unauthorized egress attempt is logged, immediately isolate the container cluster:
     ```bash
     aws ecs update-service --cluster caring-contacts-sydney --service caring-contacts-service --desired-count 0 --region ap-southeast-2
     ```
   - Notify the Clinical Safety Officer (H-00) and Data Privacy Officer within 2 hours under the Mandatory Notifiable Data Breaches (NDB) scheme of the Privacy Act 1988.

2. **Service Emergency Stop:**
   - If a clinical incident or message misdelivery occurs, invoke the three-role service stop workflow defined in `src/lib/caring-contacts/service-state.ts` (Controls H-C21 and H-C22).
