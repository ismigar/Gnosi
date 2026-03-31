# DIRECTIVE: RSS_TO_AUDIO_PODCAST

> ID: rss-audio-gen
> Associated Script: scripts/rss_to_audio.py 
> Last Update: 2026-02-19
> Status: DRAFT

---

## 1. Objectives and Scope

- **Main Objective:** Automatitzar la lectura de feeds RSS (des d'OPML), sintetitzar el contingut amb l'API de Groq (Llama-3-70b) i generar un fitxer d'àudio diari tipus podcast utilitzant TTS (gTTS o Piper) per reduir la fatiga visual.
- **Success Criteria:** L'script s'executa correctament, llegeix el fitxer OPML, descarta articles antics (més de 24h), genera un resum de 10-15 minuts i guarda un fitxer `resum_YYYY_MM_DD.mp3`.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Required Arguments:** 
    - None per defecte (execució autònoma diària).
- **Environment Variables (.env_shared):**
    - `GROQ_API_KEY`: Clau d'accés a l'API de Groq per la síntesi.
- **Source Files:**
    - `feeds.opml`: Fitxer exportat des de Reeder ambs els feeds i carpetes. Ha d'estar a la mateixa carpeta o en una ruta coneguda.

### Outputs

- **Generated Artifacts:**
    - `resum_YYYY_MM_DD.mp3`: Arxiu d'àudio amb el podcast diari sintetitzat.
- **Console Output:** Logs d'execució, articles processats i confirmació de generació d'àudio.

## 3. Logical Flow (Algorithm)

1. **Initialization:** Carregar variables d'entorn i verificar l'existència del fitxer `feeds.opml`. Configurar el logging.
2. **Acquisition (OPML & RSS):** Analitzar l'OPML per extreure les URLs dels feeds filtrant per categories objectiu (Religió, ESS, Actualitat). Utilitzar `feedparser` per descarregar els articles. Filtrar els publicats exclusivament en les últimes 24 hores. Extreure títol, font i contingut, netejant el text HTML resultant per comptar tokens adientment.
3. **Processing (Groq API):** Juntar els textos dels articles rellevants supervisant el límit de tokens (per no saturar el context). Enviar els textos preparats a l'API de Groq (model Llama-3-70b, idealment versió tool-use o instruct) amb el següent prompt: "Ets un assistent editorial d'alt nivell. Resumeix els següents articles per a un oient amb formació en enginyeria i filosofia. No busquis el titular fàcil; cerca la profunditat, la connexió entre temes i les implicacions ètiques. Estructura el resum com un guió de podcast fluid de 10-15 minuts. Llengua: Català."
4. **Persistence (TTS):** Rebre el guió sintetitzat. Utilitzar `gTTS` com a motor gratuït i ràpid per convertir el text generat a àudio en llengua catalana (`lang='ca'`). Guardar l'arxiu d'àudio resultant al directori d'execució/sandbox amb el nom de data avui: `resum_YYYY_MM_DD.mp3`. 
5. **Cleanup & Robustness:** Implementar un bloc `try/except` per font RSS perquè una caiguda o un format defectuós d'un blog no aturi tota l'execució.

## 4. Tools and Libraries

- **Python libraries:** `feedparser`, `groq`, `gTTS`, `beautifulsoup4`, `python-dotenv`.
- **External APIs:** Groq API (`llama3-70b-8192`).

## 5. Restrictions and Edge Cases

- **Limits:** Groq permet fins a ~8k tokens (segons la versió del Llama-3-70b triada). Si hi ha masses articles, s'han de truncar el contingut o demanar resums parcials, però l'enfocament inicial serà recollir tot i truncar si excedeix limit.
- **Formats:** El contingut dels feeds RSS sol estar infestat de tags HTML que inflen els tokens. És absolutament obligatori netejar-lo amb BeautifulSoup abans d'enviar a Groq.
- **Robustesa:** Els nodes OPML a vegades no tenen el tag identificador de categoria, l'script ho ha de manejar.
- **VeuTTS:** La veu de gTTS en català depèn de Google, pot ser una mica robòtica, l'objectiu futur serà implementar `Piper` amb model neuronal local en català, però cal assegurar primer la funcionalitat base estandard.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 19/02 | Creació Inicial | N/A | N/A |

> Implementation Note: Si el script falla en parsing de cert XML malformat d'un feed, caldrà interceptar l'error i fer 'continue'.

## 7. Examples of Use

```bash
# Execució al sandbox
python merge_duplicates.py
# (En aquest cas, rss_to_audio.py)
python rss_to_audio.py
```

## 8. Pre-Execution Checklist

- [x] Environment variables configured in `.env`/`.env_shared` (`GROQ_API_KEY`).
- [x] Dependencies installed (`pip install -r requirements.txt`).
- [x] Input files `feeds.opml` disponibles.

## 9. Post-Execution Checklist

- [ ] Outputs generated correctly (`.mp3` creat).
- [ ] Logs reviewed for errors/warnings.
- [ ] Results validated against expected criteria.
- [ ] Guideline updated with new learnings (if applicable).
