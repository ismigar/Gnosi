/** Keep units visible; retain the full description for hover and assistive tools. */
export function ComparisonLabel({ text, full }: { readonly text: string; readonly full: string }) {
    return <span className="model-comparison-label" title={full} aria-label={full}>
        {text.split('\n').map((line, index) => <span key={index}>{line}</span>)}
    </span>;
}
