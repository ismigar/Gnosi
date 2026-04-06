
import https from 'https';
import fs from 'fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;

// Keywords Dictionary
const KEYWORDS = [
    { tag: "Afectivitat", terms: ["amor", "dolor", "sentimiento", "afecto", "emoción", "emotional", "felicidad", "cuidar", "ansiedad", "duelo", "sufrimiento"] },
    { tag: "Autors clàssics", terms: ["kant", "hegel", "aristóteles", "platón", "sócrates", "descartes", "hume", "spinoza", "nietzsche", "marx", "weber", "foucault", "arendt", "habermas", "heidegger", "wittgenstein", "kierkegaard", "ortega y gasset", "unamuno"] },
    { tag: "Cultura i educació", terms: ["educación", "pedagogía", "cultura", "enseñanza", "aprendizaje", "escuela", "universidad", "formación", "didáctica", "coaching", "taller", "curso"] },
    { tag: "Discerniment", terms: ["discernimiento", "sabiduría", "conciencia", "meditación", "contemplación", "atención", "espiritualidad", "mística"] },
    { tag: "Economia i sistema", terms: ["economía", "capitalismo", "neoliberalismo", "mercado", "trabajo", "empresa", "dinero", "consumo", "producción", "sistema", "crisis", "decrecimiento", "sostenible"] },
    { tag: "Epistemologia", terms: ["verdad", "conocimiento", "ciencia", "razón", "epistemología", "teoria", "cognitivo", "mente", "inteligencia", "saber"] },
    { tag: "Ètica", terms: ["ética", "moral", "bien", "mal", "virtud", "deber", "valores", "justicia", "responsabilidad", "libertad"] },
    { tag: "Fenomenología", terms: ["fenomenología", "husserl", "merleau-ponty", "sartre", "levinas", "experiencia", "conciencia", "percepción"] },
    { tag: "Filosofia de la religió", terms: ["religión", "dios", "fe", "sagrado", "teología", "biblia", "corán", "islam", "cristianismo", "zen", "budismo", "mística", "ateísmo"] },
    { tag: "Filosofia política", terms: ["política", "democracia", "poder", "estado", "gobierno", "ley", "derecho", "ciudadanía", "comunidad", "público", "nación", "guerra", "paz", "violencia"] },
    { tag: "Llenguatge i lògica", terms: ["lenguaje", "lógica", "argumentación", "retórica", "comunicación", "palabra", "discurso", "significado", "interpretación", "hermenéutica"] },
    { tag: "Metodologia", terms: ["metodología", "investigación", "método", "tesis", "escritura", "lectura", "bibliografía", "análisis", "técnica"] },
    { tag: "Pensament contemporani", terms: ["contemporáneo", "actualidad", "modernidad", "posmodernidad", "siglo xx", "siglo xxi", "bauman", "han", "zizek", "butler", "chul-han", "líquida"] },
    { tag: "Relacions humanes", terms: ["relación", "otro", "alteridad", "amistad", "familia", "pareja", "comunidad", "diálogo", "encuentro", "conflicto", "convivencia"] },
    { tag: "Societat i justícia", terms: ["sociedad", "justicia", "igualdad", "derechos", "feminismo", "género", "clase", "pobreza", "exclusión", "migración", "refugiados", "solidaridad", "ecología", "medio ambiente", "planeta"] },
    { tag: "Violència control i poder", terms: ["violencia", "poder", "control", "guerra", "paz", "conflicto", "agresión", "dominación", "resistencia", "seguridad", "prisión", "castigo"] }
];

function determineTags(title, authors) {
    const text = (title + " " + authors).toLowerCase();
    const foundTags = new Set();

    KEYWORDS.forEach(category => {
        if (category.terms.some(term => text.includes(term))) {
            foundTags.add(category.tag);
        }
    });

    // Default if likely philosophy academic
    if (foundTags.size === 0) {
        if (text.includes("historia") || text.includes("filosofía")) {
            foundTags.add("Pensament contemporani");
        }
    }

    return Array.from(foundTags);
}

function callNotion(path, method, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.notion.com',
            port: 443,
            path: `/v1${path}`,
            method: method,
            headers: {
                'Authorization': `Bearer ${NOTION_TOKEN}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let resBody = '';
            res.on('data', (chunk) => resBody += chunk);
            res.on('end', () => {
                // Resolve normally even on 429 to handle retry logic if needed, or simple error
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(resBody));
                } else {
                    resolve({ error: true, status: res.statusCode, message: resBody });
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function loadProcessedIds() {
    try {
        const content = fs.readFileSync('batch_tag_recursos_1.sh', 'utf8');
        const ids = [];
        const regex = /"([a-f0-9-]{36})"/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            ids.push(match[1]);
        }
        return new Set(ids);
    } catch (e) {
        return new Set();
    }
}

(async () => {
    try {
        const resources = JSON.parse(fs.readFileSync('untagged_recursos.json', 'utf8'));
        const processedIds = loadProcessedIds();

        console.log(`Total loaded: ${resources.length}`);
        console.log(`Already processed: ${processedIds.size}`);

        const toProcess = resources.filter(r => !processedIds.has(r.id));
        console.log(`Remaining to process: ${toProcess.length}`);

        for (let i = 0; i < toProcess.length; i++) {
            const r = toProcess[i];
            const tags = determineTags(r.title, r.authors);

            if (tags.length === 0) {
                console.log(`[SKIP] No keywords found for: ${r.title.substring(0, 50)}...`);
                continue;
            }

            const tagOptions = tags.map(name => ({ name }));

            process.stdout.write(`[${i + 1}/${toProcess.length}] Tagging ${r.id} with [${tags.join(", ")}]... `);

            const result = await callNotion(`/pages/${r.id}`, 'PATCH', {
                properties: {
                    Tags: {
                        multi_select: tagOptions
                    }
                }
            });

            if (result.error) {
                console.log(`FAILED (${result.status})`);
                // Simple rate limit handling: wait and retry once?
                if (result.status === 429) {
                    console.log("Rate limit hit, waiting 5s...");
                    await new Promise(res => setTimeout(res, 5000));
                }
            } else {
                console.log("OK");
            }

            // Be gentle with valid API rate limits (3 req/sec approx)
            await new Promise(res => setTimeout(res, 350));
        }

        console.log("Done.");

    } catch (e) {
        console.error("Critical error:", e);
    }
})();
