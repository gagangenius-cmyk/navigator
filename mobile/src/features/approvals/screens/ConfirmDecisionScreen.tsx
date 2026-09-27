import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { queryClient } from '@/app/queryClient';
import { Button, EmptyState, Input, LoadingView, Screen, SegmentedControl, Text } from '@/components';
import { queryKeys } from '@/constants/queryKeys';
import type { AppStackParamList } from '@/navigation/types';
import { errorMessage } from '@/services/api/errors';
import { authenticate, getBiometricSupport } from '@/services/security/biometrics';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { ApprovalCard, type ApprovalItem } from '../components/ApprovalCards';
import { decisionLabels, requiresNote, validateNote, type Decision } from '../decisionRules';
import { submitDecision } from '../decisions';
import { useComplianceList, useDiscountList, usePaymentList } from '../hooks';

const confirmDialog = (title: string, message: string, confirm: string) =>
  new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirm, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });

/**
 * Where every approval is actually decided - from a list row, a notification tap, or a
 * notification action button (Approve / Reject / Sign-off). Nothing is ever sent from the
 * lock screen: the request is shown here for review, and the decision only leaves the
 * device after the user passes a biometric / passcode check.
 */
export function ConfirmDecisionScreen() {
  const { params } = useRoute<RouteProp<AppStackParamList, 'ConfirmDecision'>>();
  const navigation = useNavigation();
  const user = useSessionStore(selectUser);
  const { spacing } = useTheme();

  const [decision, setDecision] = useState<Decision>(params.decision);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState('Face ID');

  useEffect(() => {
    void getBiometricSupport().then((s) => setBiometricLabel(s.label));
  }, []);

  // Blocks the header back button, the swipe-back gesture and Android hardware back while a
  // decision is in flight (mid biometric prompt or mid API call) - without this, leaving the
  // screen doesn't cancel the pending submit, it just hides it, and the user has no idea
  // whether their approve/reject went through. Our own goBack() below sets allowLeave first.
  const allowLeave = useRef(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (busy && !allowLeave.current) e.preventDefault();
    });
    return unsubscribe;
  }, [navigation, busy]);

  // Decisions only apply to open items, so the pending list always contains the record.
  const discounts = useDiscountList('pending', params.approval === 'discount');
  const payments = usePaymentList('pending', params.approval === 'payment');
  const compliance = useComplianceList('pending', params.approval === 'compliance');
  const source = params.approval === 'discount' ? discounts : params.approval === 'payment' ? payments : compliance;

  const liveItem = useMemo<ApprovalItem | null>(() => {
    if (params.approval === 'discount') {
      const row = discounts.data?.data.items.find((r) => String(r.id) === params.recordId);
      return row ? { kind: 'discount', row } : null;
    }
    if (params.approval === 'payment') {
      const row = payments.data?.data.items.find((r) => String(r.id) === params.recordId);
      return row ? { kind: 'payment', row } : null;
    }
    const row = compliance.data?.data.find((r) => String(r.id) === params.recordId);
    return row ? { kind: 'compliance', row } : null;
  }, [params.approval, params.recordId, discounts.data, payments.data, compliance.data]);

  // A background refetch of the pending list can drop this record (e.g. someone else just
  // decided it) while a submission is still in flight. Keep showing the last known item
  // instead of the item flipping to null and the screen switching to "Already handled"
  // underneath the still-running biometric/submit flow. (Adjusting state during render,
  // not a ref: https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  const [lastItem, setLastItem] = useState<ApprovalItem | null>(null);
  if (liveItem && liveItem !== lastItem) setLastItem(liveItem);
  const item = liveItem ?? (busy ? lastItem : null);

  const labels = decisionLabels(params.approval, decision);
  const noteRequired = requiresNote(params.approval, decision);
  const approveLabels = decisionLabels(params.approval, 'approve');

  const submit = async () => {
    if (!user || !item) return;
    const problem = validateNote(params.approval, decision, note);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

    // Disable the button before anything async starts (including the biometric prompt
    // itself, which awaits a few native bridge calls first) - otherwise a fast double-tap
    // fires two concurrent submissions of the same approval/rejection.
    setBusy(true);
    try {
      // The gate: biometrics (or the device passcode) before any decision leaves the phone.
      const outcome = await authenticate(`${labels.title}`);
      if (outcome === 'cancelled') return;
      if (outcome === 'failed') {
        setError('Authentication failed. Nothing was sent.');
        return;
      }
      if (outcome === 'unavailable') {
        // No biometrics or passcode on this device: fall back to an explicit confirmation.
        const ok = await confirmDialog(labels.title, 'This device has no biometric or passcode lock. Confirm this decision?', labels.verb);
        if (!ok) return;
      }

      await submitDecision({ approval: params.approval, decision, recordId: params.recordId, notes: note.trim() || null, user });
      toast.success(labels.done);
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      allowLeave.current = true;
      navigation.goBack();
    } catch (e) {
      setError(errorMessage(e, 'The decision could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };

  if (source.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen>
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="Already handled"
          message="This request is no longer pending - it may have been decided by someone else."
          actionLabel="Back to approvals"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll keyboardAvoiding>
      <View style={{ gap: spacing.lg }}>
        <SegmentedControl
          options={[
            { value: 'approve', label: approveLabels.verb },
            { value: 'reject', label: 'Reject' },
          ]}
          value={decision}
          onChange={(value) => {
            setDecision(value);
            setError(null);
          }}
        />

        <ApprovalCard item={item} hideActions onDecide={() => undefined} />

        <Input
          label={noteRequired ? 'Reason (required)' : 'Note (optional)'}
          value={note}
          onChangeText={(text) => {
            setNote(text);
            if (error) setError(null);
          }}
          placeholder={decision === 'reject' ? 'What needs to be fixed?' : 'Add a note for the record'}
          multiline
          editable={!busy}
          error={error}
        />

        <Button
          title={`${labels.verb} with ${biometricLabel}`}
          icon="finger-print"
          variant={decision === 'reject' ? 'danger' : 'primary'}
          onPress={() => void submit()}
          loading={busy}
          fullWidth
        />
        <Text variant="caption" tone="muted" align="center">
          You will be asked to confirm with {biometricLabel} before this is sent.
        </Text>
      </View>
    </Screen>
  );
}
