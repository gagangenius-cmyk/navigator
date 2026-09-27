import { Linking } from 'react-native';
import type { PushTarget } from '@/services/push/router';
import { dialUrl } from '@/utils/phone';
import { navigationRef } from './navigationRef';

/**
 * Performs a resolved push destination. Only ever called once the app is signed in,
 * unlocked and navigable (see PushNavigationBridge). Approve / Reject / Sign-off open
 * the confirm sheet - the decision itself is never sent from here.
 */
export function openTarget(target: PushTarget): void {
  if (!navigationRef.isReady()) return;

  switch (target.kind) {
    case 'lead':
      navigationRef.navigate('LeadDetail', { leadId: target.leadId });
      return;
    case 'call':
      if (target.phone) {
        void Linking.openURL(dialUrl(target.phone)).catch(() => navigationRef.navigate('LeadDetail', { leadId: target.leadId }));
      } else {
        navigationRef.navigate('LeadDetail', { leadId: target.leadId });
      }
      return;
    case 'approvals':
      navigationRef.navigate('Tabs', { screen: 'Approvals', params: { segment: target.segment, highlightId: target.highlightId } });
      return;
    case 'decision':
      navigationRef.navigate('ConfirmDecision', {
        approval: target.approval,
        decision: target.decision,
        recordId: target.recordId,
        leadId: target.leadId,
      });
      return;
  }
}
