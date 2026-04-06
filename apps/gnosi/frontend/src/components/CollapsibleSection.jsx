import React, { useState } from 'react';

/**
 * A collapsible section with a header that toggles visibility of its children.
 * Starts collapsed by default but can be controlled via defaultOpen prop.
 */
export function CollapsibleSection({ title, children, defaultOpen = false, badge }) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="section collapsible-section">
            <div
                className="collapsible-header"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    userSelect: 'none'
                }}
            >
                <h2 className="filter-title" style={{ margin: 0 }}>
                    {title}
                    {badge !== undefined && badge > 0 && (
                        <span style={{
                            marginLeft: '8px',
                            fontSize: '0.75rem',
                            backgroundColor: '#3498db',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '10px'
                        }}>
                            {badge}
                        </span>
                    )}
                </h2>
                <span style={{
                    fontSize: '0.9rem',
                    transition: 'transform 0.2s',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
                }}>
                    ▼
                </span>
            </div>
            <div style={{
                maxHeight: isOpen ? '1000px' : '0',
                overflow: 'hidden',
                transition: 'max-height 0.3s ease-in-out',
                marginTop: isOpen ? '8px' : '0'
            }}>
                {children}
            </div>
        </div>
    );
}
