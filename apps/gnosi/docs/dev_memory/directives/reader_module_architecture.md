# Directiva: Mòdul de Lectura Natiu (Reader Module)

## 1. Objectiu
Proveir una eina nativa al Digital Brain de lectura lliure de distraccions, orientada a la recepció de fonts externes (Feeds RSS, Newsletters) i transformació a àudio periòdic, fomentant la reducció de fatiga visual per la lectura llarga.

## 2. Components

### Base de Dades Local (SQLite)
Tot i que el Digital Brain històricament utilitzava JSONs, `reader.db` introdueix SQLAlchemy com a prova de base de dades SQL local. Les entitats principals són:
- **FeedSource**: Rutes RSS URL o comptes de correus IMAP per a Newsletters.
- **Article**: Registre de l'entrada descarregada, contenint el text net i control d'estat (`is_read`).

### Ingesta de Contingut (Workers)
- `backend/services/feed_ingester.py`: Utilitza `feedparser` per obtenir de manera síncrona/desatesa (mitjançant l'Scheduler intern del backend) l'actualitat.
- `backend/services/mail_ingester.py`: Utilitza la llibreria `imaplib` que llegeix d'escombraries Newsletters per un correu i contrasenya fixats el flag `"UNSEEN"`. Requereix configurar `NEWSLETTERS_EMAIL` i `NEWSLETTERS_PASSWORD` a `.env_shared`.

### Generador d'Àudio (Groq + gTTS)
- `backend/services/audio_summarizer.py`: Quan el crida l'usuari (o l'Scheduler), envia el contingut dels textos "NO LLEGITS" a l'API de **Groq** (model LLaMA-3-70b) requerint resum i unificació de guió, i retorna el text al motor de `gTTS` generant l'arxiu `podcast_diari_YYYY_MM_DD.mp3` dins de `backend/data/audio`. Si s'arriba al límit de tokens a Groq (> 23000 caràcters per seguretat), els articles sobrants són omesos. Totes les interaccions des de React cridaran `/podcast/latest` per la publicació.

### Ui - Frontend
- S'introdueix el component `ReaderDashboard.jsx` encapsulant a l'esquerra el control d'articles pendents i un àrea dreta com a lector enfocat. Estils basats en una UX Premium gràcies a Tailwind CSS i llibreria `lucide-react`.

## 3. Limitacions Actuals i Lliçons Apreses
- **Model Groq deprecat:** El model original `llama3-70b-8192` ha estat decomissionat. S'ha substituït per `llama-3.3-70b-versatile` (reemplaçament oficial). Consultar sempre https://console.groq.com/docs/deprecations abans de seleccionar un model.
- **Límit TPM Groq Free Tier:** El tier gratuït de Groq té un límit de 12.000 tokens per minut. Solució: processament per lots (5 batches màx.) amb 65s d'espera entre crides. Frontend mostra progrés en temps real via polling a `/podcast/status`. Genera podcasts de ~15 min (2000+ paraules).
- **Parseig dels IMAPs Newsletters:** Alguns dissenys complexos en format multipart alteren the body real. S'ha encapsulat un extractor recurrent `get_email_body` i depurat HTML a Text bàsic gràcies a `BeautifulSoup`. Considerar afegir logs addicionals d'excepció quan la decoficació de charset falla.

## 4. Instruccions Operatives i Requeriments del Sistema
Cal la següent dependència en el fitxer `.env_shared`:
- `GROQ_API_KEY`: Clau base pel model d'IA de Llama.
- `NEWSLETTERS_EMAIL` & `NEWSLETTERS_PASSWORD` (Opcional): Si es fan servir Newsletters IMAP. 

Punt de partida dels requeriments: SQLAlchemy, python-multipart, gTTS, feedparser i BeautifulSoup.
