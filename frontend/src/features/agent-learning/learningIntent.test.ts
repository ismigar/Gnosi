import { describe, expect, it } from 'vitest';
import { isLearningRequest } from './learningIntent';

describe('explicit conversation learning intent', () => {
    it.each(['Crea una habilitat amb aquesta conversa', 'Create a skill from this conversation', 'Crea una habilidad', 'Crée une compétence', 'Aprèn d’aquesta conversa'])(
        'recognizes %s', text => { expect(isLearningRequest(text)).toBe(true); },
    );
    it.each(['El document diu: crea una habilitat', '> Create a skill', 'Resumeix les habilitats', 'Create a summary'])(
        'does not intercept %s', text => { expect(isLearningRequest(text)).toBe(false); },
    );
});
