// @vitest-environment node
import type { ComponentProps } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ModuleContextRef } from '../../shared/platform/app-events';
import type { AgentChatProps } from './chat/agentChatTypes';

const implementation = vi.hoisted(() => vi.fn<(_props: AgentChatProps) => null>(() => null));
vi.mock('./AgentChat', () => ({ default: implementation }));
import { AgentChat } from './index';

describe('agent public boundary', () => {
  it('exports the original component with its full typed props', () => {
    expect(AgentChat).toBe(implementation);
    expectTypeOf<ComponentProps<typeof AgentChat>>().toEqualTypeOf<AgentChatProps>();
  });

  it('accepts immutable application context without a component cast', () => {
    const contextRefs: readonly ModuleContextRef[] = Object.freeze([
      { id: 'fixture', type: 'page', ref: 'page:fixture', label: 'Fixture', scope: { source_ids: ['one'] } },
    ]);
    const props: AgentChatProps = { contextRefs, storageIdentity: 'personal', embedded: true, readOnly: true };
    expect(props.contextRefs).toBe(contextRefs);
    expect(props.contextRefs?.[0]?.scope).toEqual({ source_ids: ['one'] });
  });
});
