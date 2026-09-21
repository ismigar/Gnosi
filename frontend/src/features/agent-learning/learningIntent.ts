/** Only the user's current composer text can open the learning workflow. */
export function isLearningRequest(value: string): boolean {
    const text = value.trim();
    return /^(?:crea(?:['’]m)?|crear|create|crée)\b[\s\S]{0,160}(?:habilitat|habilidad|skill|compétence)\b/iu.test(text)
        || /^(?:aprèn|aprende|learn)\b[\s\S]{0,160}(?:conversa|conversation)/iu.test(text);
}
