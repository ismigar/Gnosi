import type { AiModelComparisonEntry } from '../../../shared/api/ai';

type Route = AiModelComparisonEntry['routes'][number];
type Assessment = NonNullable<AiModelComparisonEntry['role_assessments']>[number];

/** Mandatory capabilities must belong to an executable offer, not another host. */
function supportsRole(route: Route, role: Assessment['role']): boolean | null {
    if (role === 'director' || role === 'allrounder') return route.tool_call ?? null;
    if (role === 'administrative') {
        if (route.tool_call || route.tags.includes('json') || route.tags.includes('structured')) return true;
        return null; // The catalog has no explicit negative structured-output declaration.
    }
    if (role === 'documentalist') {
        return typeof route.context_window === 'number' && route.context_window > 0
            ? route.context_window >= 100_000 : null;
    }
    if (role === 'worker') {
        if (route.input_modes?.includes('text') || route.output_modes?.includes('text')) return true;
        return route.input_modes != null && route.output_modes != null ? false : null;
    }
    return true;
}

export function routeRoleAssessments(model: AiModelComparisonEntry): Assessment[] {
    return (model.role_assessments ?? []).map(assessment => {
        const support = model.routes.map(route => supportsRole(route, assessment.role));
        if (support.some(value => value === true)) return assessment;
        const status: Assessment['status'] = support.length > 0 && support.every(value => value === false)
            ? 'limitation' : 'insufficient_data';
        const metric = assessment.role === 'documentalist' ? 'long_context'
            : assessment.role === 'worker' ? 'text_support'
            : assessment.role === 'administrative' ? 'tool_or_structured_support' : 'tool_support';
        const proofs = (assessment.proofs ?? []).filter(proof => proof.metric !== metric);
        if (status === 'limitation') proofs.push({
            metric, source: 'declared', value: metric === 'long_context'
                ? Math.max(...model.routes.map(route => route.context_window ?? 0)) : false,
        });
        return { ...assessment, status, score: null, proofs,
            evidence: (assessment.evidence ?? []).filter(item => item !== metric),
            missing: status === 'insufficient_data' ? [...new Set([...(assessment.missing ?? []), metric])] : assessment.missing,
            coverage: status === 'insufficient_data'
                ? Math.max(0, assessment.coverage - (assessment.weights?.[metric] ?? 0) * 100)
                : assessment.coverage,
        };
    });
}
