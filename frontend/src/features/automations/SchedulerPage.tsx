import { Navigate } from 'react-router-dom';

/** Preserve bookmarked scheduler routes while keeping one operational surface. */
export default function SchedulerPage() {
    return <Navigate to="/dashboard?tab=schedulers&kind=system" replace />;
}
