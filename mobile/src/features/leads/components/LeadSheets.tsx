import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, ChipGroup, DateTimeField, Input, Sheet, Text } from '@/components';
import { createDiscount } from '@/features/discounts/api';
import { errorMessage } from '@/services/api/errors';
import { toast } from '@/store/uiStore';
import { useTheme } from '@/theme/ThemeProvider';
import { useAddRemark, useChangeStatus, useCreateFollowUp } from '../hooks';
import type { LeadStatusOption } from '../types';

interface BaseProps {
  visible: boolean;
  onClose: () => void;
  leadId: number;
}

export function StatusSheet({ visible, onClose, leadId, current, statuses }: BaseProps & { current: string | null; statuses: LeadStatusOption[] }) {
  const { spacing } = useTheme();
  const mutation = useChangeStatus(leadId);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setStatus(null);
    setNotes('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!status) return;
    // The web app requires a reason with every status change; keep the same audit trail.
    if (notes.trim().length < 3) {
      setError('Add a short note explaining the change.');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({ status, notes: notes.trim() });
      toast.success(`Status changed to ${status}`);
      close();
    } catch (e) {
      setError(errorMessage(e, 'Unable to change the status.'));
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Change status" dismissable={!mutation.isPending}>
      <View style={{ gap: spacing.md }}>
        <ChipGroup
          label="New status"
          options={statuses.map((s) => ({ value: s.name, label: s.name }))}
          value={status ?? current}
          onSelect={setStatus}
        />
        <Input label="Why is the status changing?" value={notes} onChangeText={setNotes} multiline editable={!mutation.isPending} error={error} />
        <Button title="Update status" onPress={() => void submit()} loading={mutation.isPending} disabled={!status || status === current} fullWidth />
      </View>
    </Sheet>
  );
}

/** Fixed vs percentage just changes how the entered number is interpreted client-side
 * before it's sent - the server only ever stores/validates an absolute discountAmount. */
const DISCOUNT_TYPES = [
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percentage', label: 'Percentage' },
] as const;

export function RequestDiscountSheet({
  visible,
  onClose,
  leadId,
  opportunityId,
  defaultOriginalAmount,
}: BaseProps & { opportunityId: number | null; defaultOriginalAmount: number }) {
  const { spacing } = useTheme();
  const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('fixed');
  const [originalText, setOriginalText] = useState(defaultOriginalAmount > 0 ? String(defaultOriginalAmount) : '');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { discountAmount: number; originalAmount: number; reason: string }) =>
      createDiscount({ leadId, opportunityId, discountType, discountAmount: input.discountAmount, originalAmount: input.originalAmount, reason: input.reason }),
  });

  const close = () => {
    setDiscountType('fixed');
    setOriginalText(defaultOriginalAmount > 0 ? String(defaultOriginalAmount) : '');
    setAmountText('');
    setReason('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    const originalAmount = Number(originalText.replace(',', '.'));
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      setError('Enter the original (pre-discount) amount.');
      return;
    }
    const entered = Number(amountText.replace(',', '.'));
    if (!Number.isFinite(entered) || entered <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    const discountAmount = discountType === 'percentage' ? (originalAmount * entered) / 100 : entered;
    if (discountAmount > originalAmount) {
      setError(discountType === 'percentage' ? 'That is more than 100% of the value.' : 'That is more than the original amount.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Explain why this discount is needed.');
      return;
    }
    setError(null);
    try {
      const result = await mutation.mutateAsync({ discountAmount, originalAmount, reason: reason.trim() });
      toast.success(result.message);
      close();
    } catch (e) {
      setError(errorMessage(e, 'Unable to submit the discount request.'));
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Request discount" dismissable={!mutation.isPending}>
      <View style={{ gap: spacing.md }}>
        <Input label="Original amount" value={originalText} onChangeText={setOriginalText} keyboardType="decimal-pad" editable={!mutation.isPending} />
        <ChipGroup label="Type" options={DISCOUNT_TYPES} value={discountType} onSelect={setDiscountType} />
        <Input
          label={discountType === 'percentage' ? 'Discount (%)' : 'Discount amount'}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          editable={!mutation.isPending}
        />
        <Input label="Reason" value={reason} onChangeText={setReason} multiline editable={!mutation.isPending} error={error} />
        <Button title="Submit request" onPress={() => void submit()} loading={mutation.isPending} fullWidth />
      </View>
    </Sheet>
  );
}

export function RemarkSheet({ visible, onClose, leadId }: BaseProps) {
  const { spacing } = useTheme();
  const mutation = useAddRemark(leadId);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setRemark('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (remark.trim().length < 2) {
      setError('Write a remark first.');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync(remark);
      toast.success('Remark added');
      close();
    } catch (e) {
      setError(errorMessage(e, 'Unable to save the remark.'));
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Add remark" dismissable={!mutation.isPending}>
      <View style={{ gap: spacing.md }}>
        <Input label="Remark" value={remark} onChangeText={setRemark} multiline autoFocus editable={!mutation.isPending} error={error} />
        <Button title="Save remark" onPress={() => void submit()} loading={mutation.isPending} fullWidth />
      </View>
    </Sheet>
  );
}

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

export function FollowUpSheet({ visible, onClose, leadId, employeeId }: BaseProps & { employeeId: number }) {
  const { spacing } = useTheme();
  const mutation = useCreateFollowUp();
  const [when, setWhen] = useState<Date | null>(null);
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setWhen(null);
    setMessage('');
    setPriority('medium');
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!when) {
      setError('Pick a date and time.');
      return;
    }
    if (when.getTime() < Date.now()) {
      setError('Choose a time in the future.');
      return;
    }
    if (message.trim().length < 2) {
      setError('Say what the follow-up is about.');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({ leadId, employeeId, scheduledAt: when.toISOString(), message, priority });
      toast.success('Follow-up scheduled');
      close();
    } catch (e) {
      setError(errorMessage(e, 'Unable to schedule the follow-up.'));
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Schedule follow-up" dismissable={!mutation.isPending}>
      <View style={{ gap: spacing.md }}>
        <DateTimeField label="When" value={when} onChange={setWhen} minimumDate={new Date()} />
        <Input label="What is it about?" value={message} onChangeText={setMessage} editable={!mutation.isPending} />
        <ChipGroup label="Priority" options={PRIORITIES} value={priority} onSelect={setPriority} />
        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button title="Schedule" onPress={() => void submit()} loading={mutation.isPending} fullWidth />
      </View>
    </Sheet>
  );
}
