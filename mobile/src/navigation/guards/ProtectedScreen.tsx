import type { ComponentType } from 'react';
import { EmptyState, Screen } from '@/components';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { canAccess } from '../routeAccess';
import type { RouteName } from '../types';

function ForbiddenView() {
  return (
    <Screen>
      <EmptyState icon="lock-closed-outline" title="No access" message="Your role does not include this section. Ask your administrator if you need it." />
    </Screen>
  );
}

/**
 * Wraps a screen so it renders only for users allowed by ROUTE_ACCESS. Applied to every
 * gated screen in the navigator, which also covers deep links and notification taps
 * that land on a route directly.
 */
export function withAccess<P extends object>(route: RouteName, Component: ComponentType<P>): ComponentType<P> {
  function Guarded(props: P) {
    const user = useSessionStore(selectUser);
    return canAccess(route, user) ? <Component {...props} /> : <ForbiddenView />;
  }
  Guarded.displayName = `withAccess(${route})`;
  return Guarded;
}
