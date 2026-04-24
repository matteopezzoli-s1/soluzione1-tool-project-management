# GCP Setup Guide — soluzione1-progetti-interni
## Prerequisiti per il deploy CI/CD con Cloud Build + Cloud Run

---

## 1. Artifact Registry — Crea il repository Docker

Esegui **una sola volta** da Cloud Shell o terminale con gcloud configurato:

```bash
gcloud artifacts repositories create docker-images \
  --repository-format=docker \
  --location=europe-west1 \
  --description="Immagini Docker BE e FE" \
  --project=soluzione1-progetti-interni
```

Configura Docker per autenticarsi con Artifact Registry:

```bash
gcloud auth configure-docker europe-west1-docker.pkg.dev
```

---

## 2. Secret Manager — Crea i secrets

### 2.1 Permetti alla shell di creare secrets

```bash
gcloud config set project soluzione1-progetti-interni
```

### 2.2 DATABASE_URL

Formato: `postgresql://UTENTE:PASSWORD@HOST:5432/NOME_DB`

```bash
# Develop
echo -n "postgresql://user:password@/dbname?host=/cloudsql/INSTANCE_CONNECTION_NAME" | \
  gcloud secrets create database-url-dev \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1

# Production
echo -n "postgresql://user:password@/dbname?host=/cloudsql/INSTANCE_CONNECTION_NAME" | \
  gcloud secrets create database-url-prod \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1
```

> ⚠️  Se usi Cloud SQL, il formato dell'host è `/cloudsql/PROJECT:REGION:INSTANCE`.
> Se usi un IP privato diretto, usa `@IP_ADDRESS:5432`.

### 2.3 GOOGLE_CLIENT_ID (OAuth)

```bash
# Develop
echo -n "IL_TUO_GOOGLE_CLIENT_ID_DEV" | \
  gcloud secrets create google-client-id-dev \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1

# Production
echo -n "IL_TUO_GOOGLE_CLIENT_ID_PROD" | \
  gcloud secrets create google-client-id-prod \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1
```

### 2.4 GOOGLE_CLIENT_SECRET (OAuth)

```bash
# Develop
echo -n "IL_TUO_GOOGLE_CLIENT_SECRET_DEV" | \
  gcloud secrets create google-client-secret-dev \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1

# Production
echo -n "IL_TUO_GOOGLE_CLIENT_SECRET_PROD" | \
  gcloud secrets create google-client-secret-prod \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1
```

### 2.5 JWT_SECRET

```bash
# Genera un valore sicuro (o usane uno tuo)
JWT_SECRET_DEV=$(openssl rand -base64 64)
JWT_SECRET_PROD=$(openssl rand -base64 64)

# Develop
echo -n "$JWT_SECRET_DEV" | \
  gcloud secrets create jwt-secret-dev \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1

# Production
echo -n "$JWT_SECRET_PROD" | \
  gcloud secrets create jwt-secret-prod \
    --data-file=- \
    --replication-policy=user-managed \
    --locations=europe-west1
```

### 2.6 Verifica tutti i secrets creati

```bash
gcloud secrets list --project=soluzione1-progetti-interni
```

Dovresti vedere:
- `database-url-dev`
- `database-url-prod`
- `google-client-id-dev`
- `google-client-id-prod`
- `google-client-secret-dev`
- `google-client-secret-prod`
- `jwt-secret-dev`
- `jwt-secret-prod`

---

## 3. Permessi Service Account — Cloud Build

Il service account di default di Cloud Build è:
`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`

Trova il PROJECT_NUMBER:
```bash
gcloud projects describe soluzione1-progetti-interni --format='value(projectNumber)'
```

### 3.1 Assegna i ruoli necessari

```bash
PROJECT_ID="soluzione1-progetti-interni"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Cloud Run Admin — per creare/aggiornare i servizi Cloud Run
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CB_SA" \
  --role="roles/run.admin"

# Artifact Registry Writer — per pushare le immagini Docker
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CB_SA" \
  --role="roles/artifactregistry.writer"

# Secret Manager Secret Accessor — per leggere i secrets durante il deploy
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CB_SA" \
  --role="roles/secretmanager.secretAccessor"

# Service Account User — per deployare su Cloud Run come SA
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$CB_SA" \
  --role="roles/iam.serviceAccountUser"
```

---

## 4. Bucket GCS — Crea i bucket per i file

```bash
# Develop
gcloud storage buckets create gs://PLACEHOLDER_BUCKET_DEV \
  --location=europe-west1 \
  --uniform-bucket-level-access \
  --project=soluzione1-progetti-interni

# Production
gcloud storage buckets create gs://PLACEHOLDER_BUCKET_PROD \
  --location=europe-west1 \
  --uniform-bucket-level-access \
  --project=soluzione1-progetti-interni
```

> ⚠️  Scegli nomi univoci globali (es. `soluzione1-files-dev`, `soluzione1-files-prod`).
> Aggiorna poi i PLACEHOLDER nei file `cloudbuild-backend.yaml` e nel codice applicativo.

---

## 5. Aggiorna i PLACEHOLDER dopo il primo deploy

Una volta completato il primo deploy, Cloud Run assegnerà URL definitivi ai servizi BE. Recuperale così:

```bash
# URL be-dev
gcloud run services describe soluzione1-progetti-interni-be-dev \
  --region=europe-west1 \
  --format='value(status.url)'

# URL be-prod
gcloud run services describe soluzione1-progetti-interni-be-prod \
  --region=europe-west1 \
  --format='value(status.url)'
```

Poi aggiorna `cloudbuild-frontend.yaml`:
```yaml
substitutions:
  _API_URL_DEV: https://URL-REALE-be-dev.a.run.app
  _API_URL_PROD: https://URL-REALE-be-prod.a.run.app
```

E aggiorna `cloudbuild-backend.yaml` con i nomi reali dei bucket GCS.

---

## 6. Configurazione Trigger Cloud Build su GCP

Hai già creato 2 trigger. Configura ciascuno così:

| Trigger | File YAML | Branch (regex) |
|---|---|---|
| backend-ci-cd | `cloudbuild-backend.yaml` | `^(develop\|main)$` |
| frontend-ci-cd | `cloudbuild-frontend.yaml` | `^(develop\|main)$` |

I YAML usano `$BRANCH_NAME` built-in per differenziare develop da main.

---

## 7. Prima esecuzione consigliata

```
1. Crea tutti i secrets (Sezione 2)
2. Assegna i ruoli al SA Cloud Build (Sezione 3)
3. Crea l'Artifact Registry repository (Sezione 1)
4. Crea i bucket GCS (Sezione 4)
5. Aggiorna i PLACEHOLDER nei YAML
6. Push su branch develop → verifica deploy dev
7. Recupera URL be-dev → aggiorna cloudbuild-frontend.yaml → push di nuovo
8. Merge su main → verifica deploy prod
```
